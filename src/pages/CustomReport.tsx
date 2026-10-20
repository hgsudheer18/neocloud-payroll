import { useMemo, useState } from "react";
import { Money, Section, downloadText } from "../ui.tsx";
import { dailyLines, type DailyLine } from "../../lib/engine/costReport.ts";
import type { PeriodView } from "../../lib/erp/periods.ts";
import { PERIOD_LABEL, US_PERIODS } from "../../lib/config/period.ts";
import type { ComponentType } from "../../lib/config/payComponents.ts";
import { addDays, eachDay, pretty, workweekStart } from "../../lib/util/dates.ts";
import { toCsv } from "../../lib/util/csv.ts";

const FIRST = US_PERIODS[0].start;
const LAST = US_PERIODS[US_PERIODS.length - 1].end;
const GROUPS: { type: ComponentType; label: string }[] = [
  { type: "Earning", label: "Earnings" },
  { type: "Pre-Tax Deduction", label: "Pre-tax deductions" },
  { type: "Post-Tax Deduction", label: "Post-tax deductions" },
  { type: "Employee Tax", label: "Employee taxes" },
  { type: "Employer Tax", label: "Employer taxes" },
  { type: "Employer Benefit", label: "Employer benefits" },
];
const BY: [string, string][] = [["week", "Week (Sun–Sat)"], ["day", "Day"], ["period", "Pay period"], ["worker", "Worker"], ["department", "Department"], ["payGroup", "Pay group"], ["component", "Component"]];
const dollars = (c: number) => (c / 100).toFixed(2);

/** Ranges to pick from: each workweek, each pay period, the month, everything. */
const PRESETS: [string, string, string][] = [
  ...eachDay(workweekStart(FIRST), LAST).filter((d) => d === workweekStart(d)).map((ws): [string, string, string] => [`Week of ${pretty(ws)}`, ws < FIRST ? FIRST : ws, addDays(ws, 6) > LAST ? LAST : addDays(ws, 6)]),
  ...US_PERIODS.map((p): [string, string, string] => [PERIOD_LABEL[p.id], p.start, p.end]),
  ["October 2026", "2026-10-01", "2026-10-31"],
  ["Everything (Oct 1 – Nov 14)", FIRST, LAST],
];

const keyOf = (l: DailyLine, by: string) =>
  by === "week" ? workweekStart(l.date) : by === "day" ? l.date : by === "period" ? l.periodId : by === "worker" ? `${l.workerId} ${l.name}` : by === "department" ? l.department : by === "payGroup" ? l.payGroup : l.component;
const labelOf = (k: string, by: string) => (by === "week" ? `Week of ${pretty(k)}` : by === "day" ? pretty(k) : by === "period" ? PERIOD_LABEL[k] : k);

/**
 * Custom payroll report: any date range, any pay components, grouped by week, day, pay
 * period, worker, department or pay group. Built from daily cost lines, which add back to
 * each pay run; deductions and taxes are calculated per pay period and allocated to days
 * by each worker's earnings.
 */
export default function CustomReport({ views }: { views: Map<string, PeriodView> }) {
  const all = useMemo(() => [...views.values()].flatMap((v) => dailyLines(v.result)), [views]);
  const components = useMemo(() => {
    const m = new Map<string, { code: string; name: string; type: ComponentType }>();
    for (const l of all) if (!m.has(l.code)) m.set(l.code, { code: l.code, name: l.component, type: l.type });
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [all]);
  // Opens on a full week with hourly time in the data package.
  const [from, setFrom] = useState("2026-10-04");
  const [to, setTo] = useState("2026-10-10");
  const [by, setBy] = useState("worker");
  const [group, setGroup] = useState("");
  const [kind, setKind] = useState("Hourly");
  const [dept, setDept] = useState("");
  const [hours, setHours] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(["REG", "OT", "DT", "SHIFT", "MEAL", "SS_ER", "MED_ER", "FUTA", "SUI", "BEN_LOAD"]));
  const toggle = (codes: string[], on: boolean) => setPicked((s) => { const n = new Set(s); for (const c of codes) (on ? n.add(c) : n.delete(c)); return n; });

  const cols = components.filter((c) => picked.has(c.code));
  const lines = all.filter((l) => l.date >= from && l.date <= to && picked.has(l.code) && (!group || l.payGroup === group) && (!kind || l.payType === (kind === "Salaried" ? "Salary" : "Hourly")) && (!dept || l.department === dept));
  const rows = new Map<string, Map<string, { amount: number; hours: number }>>();
  const rowCode = by === "component" ? "_" : "";
  for (const l of lines) {
    const k = keyOf(l, by);
    if (!rows.has(k)) rows.set(k, new Map());
    const cell = rows.get(k)!.get(rowCode || l.code) ?? { amount: 0, hours: 0 };
    cell.amount += l.amount;
    cell.hours += l.hours;
    rows.get(k)!.set(rowCode || l.code, cell);
  }
  const keys = [...rows.keys()].sort();
  const sumType = (m: Map<string, { amount: number }>, types: ComponentType[]) => cols.filter((c) => types.includes(c.type)).reduce((s, c) => s + (m.get(c.code)?.amount ?? 0), 0);
  const showCost = cols.some((c) => c.type === "Earning") && cols.some((c) => c.type === "Employer Tax" || c.type === "Employer Benefit");
  const people = new Set(lines.map((l) => l.workerId)).size;
  const depts = [...new Set(all.map((l) => l.department))].sort();
  const preset = PRESETS.find(([, a, b]) => a === from && b === to)?.[0] ?? "";

  const download = () => {
    const rowsCsv = by === "component"
      ? keys.map((k) => ({ component: k, amount: dollars(rows.get(k)!.get("_")!.amount), hours: rows.get(k)!.get("_")!.hours.toFixed(2) }))
      : keys.map((k) => {
          const m = rows.get(k)!;
          return { [BY.find(([b]) => b === by)![1]]: labelOf(k, by), ...Object.fromEntries(cols.flatMap((c) => [[c.name, dollars(m.get(c.code)?.amount ?? 0)], ...(hours && c.type === "Earning" ? [[`${c.name} hours`, (m.get(c.code)?.hours ?? 0).toFixed(2)]] : [])])), ...(showCost ? { "Labor cost": dollars(sumType(m, ["Earning", "Employer Tax", "Employer Benefit"])) } : {}) };
        });
    downloadText(`payroll-report-${from}-to-${to}.csv`, toCsv(rowsCsv as Record<string, unknown>[]));
  };

  return (
    <>
      <Section title="Report settings">
        <div className="filters" style={{ alignItems: "flex-end" }}>
          <label>Quick range<select value={preset} onChange={(e) => { const p = PRESETS.find(([l]) => l === e.target.value); if (p) { setFrom(p[1]); setTo(p[2]); } }}><option value="">Custom dates</option>{PRESETS.map(([l]) => <option key={l}>{l}</option>)}</select></label>
          <label>From<input type="date" min={FIRST} max={LAST} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>To<input type="date" min={FIRST} max={LAST} value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label>Group by<select value={by} onChange={(e) => setBy(e.target.value)}>{BY.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>Workers<select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">All</option><option>Hourly</option><option>Salaried</option></select></label>
          <label>Pay group<select value={group} onChange={(e) => setGroup(e.target.value)}><option value="">All</option><option>US Semi-Monthly</option><option>US Biweekly</option></select></label>
          <label>Department<select value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All</option>{depts.map((d) => <option key={d}>{d}</option>)}</select></label>
          <label className="inline-check"><input type="checkbox" checked={hours} onChange={(e) => setHours(e.target.checked)} /> Show hours</label>
        </div>
        <div className="component-picker">
          {GROUPS.map((g) => {
            const list = components.filter((c) => c.type === g.type);
            if (!list.length) return null;
            const allOn = list.every((c) => picked.has(c.code));
            return (
              <fieldset key={g.type}>
                <legend><label><input type="checkbox" checked={allOn} onChange={(e) => toggle(list.map((c) => c.code), e.target.checked)} /> {g.label}</label></legend>
                {list.map((c) => <label key={c.code} className="small"><input type="checkbox" checked={picked.has(c.code)} onChange={(e) => toggle([c.code], e.target.checked)} /> {c.name}</label>)}
              </fieldset>
            );
          })}
        </div>
        <p className="small muted">Earnings are reported on the days they were earned (time by day worked, salary by working day, time off by the day taken; retro and payouts on the last day of the pay period). Deductions and taxes are calculated per pay period, so for part of a period they are allocated by each worker&apos;s earnings on each day. A whole pay period always adds back to the pay run to the cent.</p>
      </Section>

      <Section
        title={`${pretty(from)} – ${pretty(to)}: ${cols.length} component(s), ${people} worker(s)`}
        right={<button className="btn ghost" onClick={download} disabled={!keys.length}>Download CSV</button>}
      >
        {!cols.length ? <p className="muted">Choose at least one earning, deduction or tax above.</p> : !keys.length ? <p className="muted">Nothing paid for these dates and filters.</p> : by === "component" ? (
          <div className="table-wrap">
            <table className="reg">
              <thead><tr><th>Component</th><th className="n">Amount</th>{hours && <th className="n">Hours</th>}</tr></thead>
              <tbody>
                {keys.map((k) => <tr key={k}><td>{k}</td><td className="n"><Money c={rows.get(k)!.get("_")!.amount} /></td>{hours && <td className="n">{rows.get(k)!.get("_")!.hours ? rows.get(k)!.get("_")!.hours.toFixed(2) : ""}</td>}</tr>)}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="table-wrap" style={{ maxHeight: "65vh" }}>
            <table className="reg">
              <thead>
                <tr>
                  <th>{BY.find(([b]) => b === by)![1]}</th>
                  {cols.map((c) => <th key={c.code} className="n">{c.name}<div className="faint small">{c.type}</div></th>)}
                  {showCost && <th className="n">Labor cost<div className="faint small">earnings + employer taxes + benefits</div></th>}
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const m = rows.get(k)!;
                  return (
                    <tr key={k}>
                      <td>{labelOf(k, by)}</td>
                      {cols.map((c) => { const v = m.get(c.code); return <td key={c.code} className="n">{v ? <><Money c={v.amount} />{hours && c.type === "Earning" && v.hours ? <div className="faint small">{v.hours.toFixed(2)} hrs</div> : null}</> : ""}</td>; })}
                      {showCost && <td className="n"><strong><Money c={sumType(m, ["Earning", "Employer Tax", "Employer Benefit"])} /></strong></td>}
                    </tr>
                  );
                })}
                <tr>
                  <td><strong>Total</strong></td>
                  {cols.map((c) => { const t = keys.reduce((s, k) => s + (rows.get(k)!.get(c.code)?.amount ?? 0), 0); const h = keys.reduce((s, k) => s + (rows.get(k)!.get(c.code)?.hours ?? 0), 0); return <td key={c.code} className="n"><strong><Money c={t} /></strong>{hours && c.type === "Earning" && h ? <div className="faint small">{h.toFixed(2)} hrs</div> : null}</td>; })}
                  {showCost && <td className="n"><strong><Money c={keys.reduce((s, k) => s + sumType(rows.get(k)!, ["Earning", "Employer Tax", "Employer Benefit"]), 0)} /></strong></td>}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
