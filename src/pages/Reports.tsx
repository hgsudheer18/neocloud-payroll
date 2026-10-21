import { useMemo } from "react";
import { useData } from "../state.tsx";
import { useErp } from "../erp.tsx";
import { setQuery } from "../router.tsx";
import { Money, PageHead, Pill, Section, Select, downloadText } from "../ui.tsx";
import { computePeriod, type PeriodView } from "../../lib/erp/periods.ts";
import { PERIOD_LABEL, US_PERIODS } from "../../lib/config/period.ts";
import { pretty } from "../../lib/util/dates.ts";
import { toCsv } from "../../lib/util/csv.ts";
import type { ComponentType } from "../../lib/config/payComponents.ts";
import CustomReport from "./CustomReport.tsx";

const TABS: [string, string][] = [["custom", "Custom report"], ["schedule", "Pay schedule"], ["earnings", "Earnings"], ["deductions", "Deductions"], ["taxes", "Taxes"], ["workers", "By worker"]];
const SCHEDULES: [string, string][] = [["", "All pay groups"], ["US Semi-Monthly", "Semi-monthly (salaried)"], ["US Biweekly", "Biweekly (hourly)"]];
const dollars = (c: number) => (c / 100).toFixed(2);

/** Totals of each pay component (and its hours) for one pay run, over the given component types. */
function byComponent(v: PeriodView, types: ComponentType[]) {
  const m = new Map<string, { code: string; name: string; type: ComponentType; amount: number; hours: number; workers: number }>();
  for (const c of v.result.us) {
    const seen = new Set<string>();
    for (const l of c.pay.lines) {
      if (!types.includes(l.type)) continue;
      const e = m.get(l.code) ?? { code: l.code, name: l.name, type: l.type, amount: 0, hours: 0, workers: 0 };
      e.amount += l.amount;
      e.hours += l.hours ?? 0;
      if (!seen.has(l.code)) { e.workers++; seen.add(l.code); }
      m.set(l.code, e);
    }
  }
  return m;
}

/**
 * Payroll reports for every pay period: the pay schedule, and earnings, deductions and
 * taxes by pay component, filtered by pay group (semi-monthly salaried, biweekly hourly).
 * Each table downloads as CSV. Completed periods show what was paid; open ones are previews.
 */
export default function Reports({ query }: { query: URLSearchParams }) {
  const { data } = useData();
  const { erp } = useErp();
  const tab = TABS.some(([k]) => k === query.get("tab")) ? query.get("tab")! : "custom";
  const schedule = query.get("group") ?? "";
  const set = (k: string, v: string) => setQuery("/reports", { tab, group: schedule, period: query.get("period") ?? "", [k]: v });
  const periods = US_PERIODS.filter((p) => !schedule || p.payGroup === schedule || (schedule === "US Semi-Monthly" && p.id === "2026-10-SM1"));
  const views = useMemo(() => new Map(US_PERIODS.map((p) => [p.id, computePeriod(data!.base, erp, p.id)])), [data, erp]);
  const status = (id: string) => erp.payRuns[id]?.status ?? "Not started";
  const label = (id: string) => PERIOD_LABEL[id].split(" (")[0];

  const componentTable = (title: string, types: ComponentType[], file: string) => {
    const maps = periods.map((p) => byComponent(views.get(p.id)!, types));
    const codes = [...new Set(maps.flatMap((m) => [...m.keys()]))];
    const rows = codes.map((code) => {
      const any = maps.map((m) => m.get(code)).find(Boolean)!;
      return { code, name: any.name, type: any.type, per: maps.map((m) => m.get(code)) };
    }).sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : a.name.localeCompare(b.name)));
    const total = (i: number) => rows.reduce((s, r) => s + (r.per[i]?.amount ?? 0), 0);
    const csv = () =>
      downloadText(file, toCsv(rows.map((r) => ({ component: r.name, code: r.code, type: r.type, ...Object.fromEntries(periods.flatMap((p, i) => [[`${p.id}_amount`, dollars(r.per[i]?.amount ?? 0)], [`${p.id}_hours`, (r.per[i]?.hours ?? 0).toFixed(2)], [`${p.id}_workers`, r.per[i]?.workers ?? 0]])) }))));
    return (
      <Section title={title} right={<button className="btn ghost" onClick={csv}>Download CSV</button>}>
        <div className="table-wrap">
          <table className="reg">
            <thead><tr><th>Component</th><th>Type</th>{periods.map((p) => <th key={p.id} className="n">{label(p.id)}<div className="faint small">{p.payGroup.replace("US ", "")}</div></th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code}>
                  <td>{r.name}<div className="faint small">{r.code}</div></td>
                  <td className="small">{r.type}</td>
                  {r.per.map((e, i) => <td key={i} className="n">{e ? <><Money c={e.amount} />{e.hours ? <div className="faint small">{e.hours.toFixed(2)} hrs</div> : null}<div className="faint small">{e.workers} worker(s)</div></> : ""}</td>)}
                </tr>
              ))}
              <tr><td><strong>Total</strong></td><td />{periods.map((p, i) => <td key={p.id} className="n"><strong><Money c={total(i)} /></strong></td>)}</tr>
            </tbody>
          </table>
        </div>
      </Section>
    );
  };

  const pid = periods.some((p) => p.id === query.get("period")) ? query.get("period")! : periods[0]?.id;
  const v = pid ? views.get(pid)! : undefined;

  return (
    <>
      <PageHead title="Payroll reports">Build a report for any date range (a week, a day, a pay period) with the earnings, deductions and taxes you choose, grouped the way you need. Standard reports follow. Completed pay runs show what was paid; open ones are previews.</PageHead>
      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => set("tab", k)}>{l}</button>)}
      </div>
      {tab !== "custom" && (
        <div className="filters">
          <Select label="Pay group" value={schedule} onChange={(x) => set("group", x)} options={SCHEDULES.filter(([k]) => k).map(([k, l]) => [k, l])} all="All pay groups" />
        </div>
      )}

      {tab === "custom" && <CustomReport views={views} />}
      {tab === "schedule" && (
        <Section title="Pay schedule" lede="Each pay period with its dates, check date, status and totals." right={<button className="btn ghost" onClick={() => downloadText("pay-schedule.csv", toCsv(periods.map((p) => { const r = views.get(p.id)!.result; return { period: PERIOD_LABEL[p.id], pay_group: p.payGroup, start: p.start, end: p.end, check_date: p.checkDate, status: status(p.id), workers: r.us.length, gross: dollars(r.totals.gross), employee_taxes: dollars(r.totals.eeTaxes), deductions: dollars(r.totals.preTax + r.totals.postTax), net: dollars(r.totals.net), employer_taxes: dollars(r.totals.erTaxes), burdened_cost: dollars(r.totals.burdened) }; })))}>Download CSV</button>}>
          <div className="table-wrap">
            <table className="reg">
              <thead><tr><th>Pay period</th><th>Pay group</th><th>Dates</th><th>Check date</th><th>Status</th><th className="n">Workers</th><th className="n">Gross</th><th className="n">Employee taxes</th><th className="n">Deductions</th><th className="n">Net pay</th><th className="n">Employer taxes</th><th className="n">Cost to Company</th></tr></thead>
              <tbody>
                {periods.map((p) => {
                  const r = views.get(p.id)!.result;
                  return (
                    <tr key={p.id}>
                      <td>{PERIOD_LABEL[p.id]}</td>
                      <td>{p.payGroup}</td>
                      <td className="small">{pretty(p.start)} – {pretty(p.end)}</td>
                      <td>{pretty(p.checkDate)}</td>
                      <td><Pill tone={status(p.id) === "Completed" ? "ok" : ""}>{status(p.id) === "Completed" ? "Paid" : "Preview"}</Pill></td>
                      <td className="n">{r.us.length}</td>
                      <td className="n"><Money c={r.totals.gross} /></td>
                      <td className="n"><Money c={r.totals.eeTaxes} /></td>
                      <td className="n"><Money c={r.totals.preTax + r.totals.postTax} /></td>
                      <td className="n"><Money c={r.totals.net} /></td>
                      <td className="n"><Money c={r.totals.erTaxes} /></td>
                      <td className="n"><Money c={r.totals.burdened} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      {tab === "earnings" && componentTable("Earnings by pay component", ["Earning"], "earnings-by-period.csv")}
      {tab === "deductions" && componentTable("Deductions by pay component", ["Pre-Tax Deduction", "Post-Tax Deduction"], "deductions-by-period.csv")}
      {tab === "taxes" && componentTable("Employee and employer taxes", ["Employee Tax", "Employer Tax"], "taxes-by-period.csv")}
      {tab === "workers" && v && (
        <Section
          title={`By worker: ${PERIOD_LABEL[pid!]}`}
          right={<div className="row"><Select label="" value={pid!} onChange={(x) => set("period", x)} options={periods.map((p) => [p.id, PERIOD_LABEL[p.id]])} all={null} /><button className="btn ghost" onClick={() => downloadText(`register-${pid}.csv`, toCsv(v.result.us.map((c) => ({ employee_id: c.worker.id, name: c.worker.name, pay_group: c.worker.payGroup, hire_date: c.worker.hireDate, termination_date: c.worker.terminationDate, gross: dollars(c.pay.totals.gross), pre_tax: dollars(c.pay.totals.preTax), employee_taxes: dollars(c.pay.totals.eeTaxes), post_tax: dollars(c.pay.totals.postTax), net: dollars(c.pay.totals.net), employer_taxes: dollars(c.pay.totals.erTaxes), benefits: dollars(c.pay.totals.benefits) }))))}>Download CSV</button></div>}
        >
          <div className="table-wrap" style={{ maxHeight: "65vh" }}>
            <table className="reg">
              <thead><tr><th>Worker</th><th>Pay group</th><th className="n">Gross</th><th className="n">Pre-tax</th><th className="n">Employee taxes</th><th className="n">Post-tax</th><th className="n">Net</th><th className="n">Employer taxes</th><th>Notes</th></tr></thead>
              <tbody>
                {v.result.us.map((c) => (
                  <tr key={c.worker.id}>
                    <td><a href={`#/register/${c.worker.id}`}>{c.worker.id}</a> {c.worker.name}</td>
                    <td className="small">{c.worker.payGroup.replace("US ", "")}</td>
                    <td className="n"><Money c={c.pay.totals.gross} /></td>
                    <td className="n"><Money c={c.pay.totals.preTax} /></td>
                    <td className="n"><Money c={c.pay.totals.eeTaxes} /></td>
                    <td className="n"><Money c={c.pay.totals.postTax} /></td>
                    <td className="n"><Money c={c.pay.totals.net} /></td>
                    <td className="n"><Money c={c.pay.totals.erTaxes} /></td>
                    <td className="small">{[c.worker.hireDate >= views.get(pid!)!.period.start ? `Hired ${pretty(c.worker.hireDate)} (prorated)` : "", c.worker.terminationDate && c.worker.terminationDate <= views.get(pid!)!.period.end ? `Terminated ${pretty(c.worker.terminationDate)}` : "", c.pay.lines.some((l) => l.code === "PTO_PAYOUT") ? "Vacation paid out" : ""].filter(Boolean).join("; ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </>
  );
}
