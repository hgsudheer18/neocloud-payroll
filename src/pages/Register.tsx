import { useMemo, useState } from "react";
import { useData } from "../state.tsx";
import { useErp } from "../erp.tsx";
import { BpStatus } from "../erpui.tsx";
import { pendingForWorker, previewPending } from "../../lib/erp/periods.ts";
import { PERIOD_LABEL } from "../../lib/config/period.ts";
import { go, setQuery } from "../router.tsx";
import { MaskedMoney, Money, PageHead, Pill, Section, Select, downloadText } from "../ui.tsx";
import { fmt, toDecimalString } from "../../lib/util/money.ts";
import { toCsv } from "../../lib/util/csv.ts";
import type { UsWorkerCalc } from "../../lib/engine/build.ts";
import { pretty } from "../../lib/util/dates.ts";

const GROUPS = ["Earning", "Pre-Tax Deduction", "Employee Tax", "Post-Tax Deduction", "Employer Tax", "Employer Benefit"] as const;
const HEADINGS: Record<(typeof GROUPS)[number], string> = { Earning: "Earnings", "Pre-Tax Deduction": "Pre-tax deductions", "Employee Tax": "Employee taxes", "Post-Tax Deduction": "Post-tax deductions", "Employer Tax": "Employer taxes", "Employer Benefit": "Employer benefits" };

export default function Register({ id, query }: { id?: string; query: URLSearchParams }) {
  const { data } = useData();
  const r = data!.result;
  const q = query.get("q") ?? "";
  const dept = query.get("dept") ?? "";
  const loc = query.get("loc") ?? "";
  const type = query.get("type") ?? "";
  const set = (k: string, v: string) => setQuery(`/register${id ? `/${id}` : ""}`, { q, dept, loc, type, [k]: v });

  const rows = useMemo(
    () =>
      r.us.filter((c) => {
        const w = c.worker;
        if (dept && w.department !== dept) return false;
        if (loc && w.locationId !== loc) return false;
        if (type && w.payType !== type) return false;
        if (q && !`${w.id} ${w.name} ${w.jobProfile}`.toLowerCase().includes(q.toLowerCase())) return false;
        return true;
      }),
    [r, q, dept, loc, type],
  );
  const sel = id ? r.us.find((c) => c.worker.id === id) : undefined;
  const sum = (k: keyof UsWorkerCalc["pay"]["totals"]) => rows.reduce((s, c) => s + c.pay.totals[k], 0);

  const exportCsv = () => {
    const out = rows.map((c) => ({
          employee_id: c.worker.id, name: c.worker.name, department: c.worker.department, cost_center: c.worker.costCenterId, location: c.worker.locationId, work_state: c.worker.workState,
          ...Object.fromEntries(Array.from(c.pay.lines.reduce((m, l) => m.set(l.code, (m.get(l.code) ?? 0) + l.amount), new Map<string, number>()).entries(), ([k, v]) => [k, toDecimalString(v)])),
          ...(() => { const hs = (codes: string[]) => c.pay.lines.filter((l) => codes.includes(l.code)).reduce((t, l) => t + (l.hours ?? 0), 0).toFixed(2); return { regular_hours: hs(["SAL", "REG"]), overtime_hours: hs(["OT"]), double_time_hours: hs(["DT"]), time_off_hours: hs(["PTO_TAKEN", "VAC", "SICK", "LEAVE_PAID"]) }; })(),
          gross: toDecimalString(c.pay.totals.gross), net: toDecimalString(c.pay.totals.net), employer_taxes: toDecimalString(c.pay.totals.erTaxes), benefits: toDecimalString(c.pay.totals.benefits), cost_to_company: toDecimalString(c.pay.totals.burdened),
        }) as Record<string, string>);
    // Every pay code any worker has, in a fixed order, so no column is lost.
    const fixed = ["employee_id", "name", "department", "cost_center", "location", "work_state"];
    const tail = ["regular_hours", "overtime_hours", "double_time_hours", "time_off_hours", "gross", "net", "employer_taxes", "benefits", "cost_to_company"];
    const codes = [...new Set(out.flatMap((o) => Object.keys(o)))].filter((k) => !fixed.includes(k) && !tail.includes(k));
    downloadText(`payroll-register-${r.period.id}.csv`, toCsv(out.map((o) => Object.fromEntries([...fixed, ...codes, ...tail].map((k) => [k, o[k] ?? ""]))), [...fixed, ...codes, ...tail]));
  };

  return (
    <>
      <PageHead title="Payroll register">
        Gross to net for every eligible US worker, {pretty(r.period.start)} to {pretty(r.period.end)}. Select a worker to see each pay line and how it was calculated.
      </PageHead>

      {sel && <Payslip c={sel} />}

      <div className="filters">
        <label>
          Search
          <input type="search" value={q} placeholder="ID, name or job" onChange={(e) => set("q", e.target.value)} />
        </label>
        <Select label="Department" value={dept} onChange={(v) => set("dept", v)} options={[...new Set(r.us.map((c) => c.worker.department))].sort()} />
        <Select label="Location" value={loc} onChange={(v) => set("loc", v)} options={[...new Set(r.us.map((c) => c.worker.locationId))].sort()} />
        <Select label="Pay type" value={type} onChange={(v) => set("type", v)} options={["Salary", "Hourly"]} />
        <span className="spacer" />
        <button className="btn ghost" onClick={exportCsv}>Download register CSV</button>
      </div>

      <div className="table-wrap" style={{ maxHeight: "70vh" }}>
        <table className="reg">
          <thead>
            <tr>
              <th>Worker</th>
              <th>Department</th>
              <th>State</th>
              <th className="n">Gross</th>
              <th className="n">Pre-tax</th>
              <th className="n">EE taxes</th>
              <th className="n">Post-tax</th>
              <th className="n">Net</th>
              <th className="n">ER taxes</th>
              <th className="n">Benefits</th>
              <th className="n">Cost to Company</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const w = c.worker;
              const notes = noteFor(c);
              return (
                <tr key={w.id} className={`click ${id === w.id ? "sel" : ""}`} onClick={() => go(`/register/${w.id}`, { q, dept, loc, type })}>
                  <td>
                    <a href={`#/register/${w.id}`} onClick={(e) => e.preventDefault()}>{w.id}</a> {w.name}
                    <div className="faint small">{w.jobProfile}</div>
                  </td>
                  <td>{w.department}</td>
                  <td>{Object.keys(c.pay.taxable.byState).join(", ")}</td>
                  <td className="n"><Money c={c.pay.totals.gross} /></td>
                  <td className="n"><Money c={c.pay.totals.preTax} /></td>
                  <td className="n"><Money c={c.pay.totals.eeTaxes} /></td>
                  <td className="n"><Money c={c.pay.totals.postTax} /></td>
                  <td className="n"><Money c={c.pay.totals.net} /></td>
                  <td className="n"><Money c={c.pay.totals.erTaxes} /></td>
                  <td className="n"><Money c={c.pay.totals.benefits} /></td>
                  <td className="n"><Money c={c.pay.totals.burdened} /></td>
                  <td>{notes.map((n) => <Pill key={n} tone="info">{n}</Pill>)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>{rows.length} workers</td>
              <td className="n"><Money c={sum("gross")} /></td>
              <td className="n"><Money c={sum("preTax")} /></td>
              <td className="n"><Money c={sum("eeTaxes")} /></td>
              <td className="n"><Money c={sum("postTax")} /></td>
              <td className="n"><Money c={sum("net")} /></td>
              <td className="n"><Money c={sum("erTaxes")} /></td>
              <td className="n"><Money c={sum("benefits")} /></td>
              <td className="n"><Money c={sum("burdened")} /></td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="small muted">Not shown: {r.excluded.length} workers excluded from the run ({r.excluded.map((e) => `${e.worker.id} ${e.reason.split(":")[0].toLowerCase()}`).join("; ")}).</p>
    </>
  );
}

function noteFor(c: UsWorkerCalc): string[] {
  const n: string[] = [];
  const w = c.worker;
  if (w.hireDate > c.input.timeline[0].date) n.push("New hire");
  if (w.terminationDate) n.push("Final pay");
  if (c.input.timeline.some((d) => d.onLeave)) n.push("Unpaid leave");
  if (c.pay.lines.filter((l) => l.code === "SAL").length > 1 && new Set(c.input.timeline.map((d) => d.annualSalary)).size > 1) n.push("Comp change");
  if (Object.keys(c.pay.taxable.byState).length > 1) n.push("Multi-state");
  if (c.pay.lines.some((l) => l.code === "GARN")) n.push("Garnishment");
  if (c.pay.lines.some((l) => l.code === "RETRO")) n.push("Retro");
  if (c.worker.payType === "Hourly") n.push("Hourly");
  return n;
}

/** The full payslip; `mine` is the worker's own view, without payroll-only detail (employer cost, GL, links to payroll pages). */
export function Payslip({ c, mine = false, onClose }: { c: UsWorkerCalc; mine?: boolean; onClose?: () => void }) {
  const w = c.worker;
  const p = c.pay;
  return (
    <div className="detail" aria-label={`Payslip for ${w.id}`}>
      <div className="detail-head">
        <h2>
          {w.id} {w.name}
        </h2>
        <span className="muted">
          {w.jobProfile}, {w.department}, {w.costCenterId}, {w.locationId} ({w.workState})
        </span>
        {!mine && <button className="close" onClick={() => (onClose ? onClose() : go("/register"))}>Close</button>}
      </div>
      {p.flags.map((f) => (
        <div key={f} className={`callout ${f.startsWith("Final pay") ? "bad" : ""}`}>{f}</div>
      ))}
      {!mine && <PendingPreview c={c} />}
      <div className="grid2">
        <div>
          {GROUPS.filter((g) => !mine || !g.startsWith("Employer")).map((g) => {
            const ls = p.lines.filter((l) => l.type === g);
            if (!ls.length) return null;
            return (
              <div key={g} style={{ marginBottom: 16 }}>
                <h3>{HEADINGS[g]}</h3>
                <table className="reg" style={{ border: "1px solid var(--rule)" }}>
                  <tbody>
                    {ls.map((l, i) => (
                      <tr key={i}>
                        <td style={{ width: "62%" }}>
                          {l.name}
                          {l.state && <span className="faint small"> {l.state}</span>}
                          <div className="explain">{l.explain}</div>
                        </td>
                        <td className="n">{l.hours !== undefined ? `${l.hours.toFixed(2)} hrs` : ""}</td>
                        <td className="n"><Money c={l.amount} /></td>
                        {!mine && <td className="faint small">GL {l.glAccount}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
        <div>
          {hoursSummary(c).length > 0 && (
            <>
              <h3>Hours</h3>
              <dl className="kv" style={{ marginBottom: 20 }}>
                {hoursSummary(c).map(([label, h], i, all) => <span key={label} style={{ display: "contents" }}><dt>{i === all.length - 1 ? <strong>{label}</strong> : label}</dt><dd>{i === all.length - 1 ? <strong>{h.toFixed(2)}</strong> : h.toFixed(2)}</dd></span>)}
              </dl>
            </>
          )}
          <h3>Totals</h3>
          <dl className="kv">
            <dt>Gross pay</dt><dd><Money c={p.totals.gross} /></dd>
            <dt>Pre-tax deductions</dt><dd><Money c={-p.totals.preTax} /></dd>
            <dt>Employee taxes</dt><dd><Money c={-p.totals.eeTaxes} /></dd>
            <dt>Post-tax deductions</dt><dd><Money c={-p.totals.postTax} /></dd>
            <dt><strong>Net pay</strong></dt><dd><strong>{mine ? <MaskedMoney c={p.totals.net} /> : <Money c={p.totals.net} />}</strong></dd>
            {!mine && <>
            <dt>Employer taxes</dt><dd><Money c={p.totals.erTaxes} /></dd>
            <dt>Benefits load</dt><dd><Money c={p.totals.benefits} /></dd>
            <dt><strong>Cost to Company</strong></dt><dd><strong><Money c={p.totals.burdened} /></strong></dd>
            </>}
          </dl>
          <h3 style={{ marginTop: 20 }}>Taxable wages (each tax has its own base)</h3>
          <dl className="kv">
            <dt>Federal income tax</dt><dd>{fmt(p.taxable.fit)} <span className="faint small">gross − 401(k) − Sec. 125</span></dd>
            <dt>FICA (Medicare)</dt><dd>{fmt(p.taxable.fica)} <span className="faint small">gross − Sec. 125</span></dd>
            <dt>Social Security</dt><dd>{fmt(p.taxable.ssTaxable)} <span className="faint small">capped by remaining wage base</span></dd>
            <dt>FUTA / SUI</dt><dd>{fmt(p.taxable.futa)} / {fmt(p.taxable.sui)}</dd>
            {Object.entries(p.taxable.byState).map(([s, v]) => (
              <span key={s} style={{ display: "contents" }}>
                <dt>{s} wages</dt>
                <dd>{fmt(v.pit)} income tax, {fmt(v.programs)} SDI/PFL base</dd>
              </span>
            ))}
            <dt>Disposable earnings</dt><dd>{fmt(p.taxable.disposable)}</dd>
          </dl>
          {c.absence.length > 0 && (
            <>
              <h3 style={{ marginTop: 20 }}>Absence</h3>
              {c.absence.map((a) => (
                <p key={a.plan.code} className="small" style={{ margin: "0 0 6px" }}>
                  <strong>{a.plan.name}</strong>:{" "}
                  {a.tracked ? `${a.opening.toFixed(2)} + ${a.accrual.toFixed(2)} accrued − ${a.taken.toFixed(2)} taken${a.payoutQty ? ` − ${a.payoutQty.toFixed(2)} paid out` : ""} = ${a.ending.toFixed(2)} ${a.unit}` : `${a.taken.toFixed(2)} ${a.unit} taken (no balance)`}
                  <br />
                  <span className="faint">{a.accrualExplain}</span>
                </p>
              ))}
            </>
          )}
          {c.time && !mine && (
            <p className="small">
              <a href={`#/time/${w.id}`}>See the daily time calculation for {w.id}</a>
            </p>
          )}
          {!mine && <p className="small"><a href={`#/reconciliation/${w.id}`}>Compare with the legacy register</a></p>}
        </div>
      </div>
    </div>
  );
}

const TOTALS: [keyof UsWorkerCalc["pay"]["totals"], string][] = [["gross", "Gross pay"], ["preTax", "Pre-tax deductions"], ["eeTaxes", "Employee taxes"], ["postTax", "Post-tax deductions"], ["net", "Net pay"], ["erTaxes", "Employer taxes"], ["benefits", "Benefits load"], ["burdened", "Cost to Company"]];

/**
 * Preview of this worker's pay if their pending requests (time, time off, payroll
 * inputs, job changes) were approved now. Results already update on approval; this
 * shows the effect before it, without saving anything or touching the pay run.
 */
function PendingPreview({ c }: { c: UsWorkerCalc }) {
  const { data } = useData();
  const { erp, periodId } = useErp();
  const w = c.worker;
  const pending = pendingForWorker(erp.bps, w.id);
  const [open, setOpen] = useState(false);
  const completed = erp.payRuns[periodId]?.status === "Completed";
  const preview = useMemo(() => (open && pending.length && !completed ? previewPending(data!.base, erp, periodId, w.id) : null), [open, pending.length, completed, data, erp, periodId, w.id]);
  if (!pending.length)
    return <p className="small muted">No pending changes for {w.name}. Pay results update as soon as time, time off or a payroll input is approved.</p>;
  const after = preview?.view.result.us.find((x) => x.worker.id === w.id);
  const byCode = (x?: UsWorkerCalc) => (x ? x.pay.lines.reduce((m, l) => m.set(l.name, { amount: (m.get(l.name)?.amount ?? 0) + l.amount, hours: (m.get(l.name)?.hours ?? 0) + (l.hours ?? 0), type: l.type }), new Map<string, { amount: number; hours: number; type: (typeof GROUPS)[number] }>()) : new Map<string, { amount: number; hours: number; type: (typeof GROUPS)[number] }>());
  const now = byCode(c);
  const next = byCode(after);
  const changed = [...new Set([...now.keys(), ...next.keys()])].filter((k) => (now.get(k)?.amount ?? 0) !== (next.get(k)?.amount ?? 0))
    .sort((a, b) => GROUPS.indexOf((now.get(a) ?? next.get(a))!.type) - GROUPS.indexOf((now.get(b) ?? next.get(b))!.type));
  const hrs = (v?: { hours: number }) => (v && v.hours ? `${v.hours.toFixed(2)} hrs` : "");
  return (
    <div className="callout info" style={{ marginBottom: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <strong>{pending.length} pending change{pending.length > 1 ? "s" : ""} not yet in these results</strong>
        {!completed && <button className="btn ghost" onClick={() => setOpen(!open)}>{open ? "Hide preview" : "Preview pay with these approved"}</button>}
      </div>
      <ul className="small" style={{ margin: "8px 0" }}>
        {pending.map((b) => <li key={b.id}>{b.id} {b.type}, effective {pretty(b.effectiveDate)}: {b.summary} <BpStatus bp={b} /></li>)}
      </ul>
      {completed && <p className="small">{PERIOD_LABEL[periodId]} is completed, so once approved these are paid as retro in the next pay run. Choose the next open period to preview them.</p>}
      {preview && !after && <p className="small">With these approved, {w.name} would not be paid in {PERIOD_LABEL[periodId]}.</p>}
      {preview && after && (
        <div className="grid2" style={{ marginTop: 8 }}>
          <div>
            <h3>Totals</h3>
            <table className="reg">
              <thead><tr><th /><th className="n">Now</th><th className="n">If approved</th><th className="n">Change</th></tr></thead>
              <tbody>
                {TOTALS.map(([k, label]) => {
                  const d = after.pay.totals[k] - c.pay.totals[k];
                  return <tr key={k}><td>{k === "net" ? <strong>{label}</strong> : label}</td><td className="n"><Money c={c.pay.totals[k]} /></td><td className="n"><Money c={after.pay.totals[k]} /></td><td className="n">{d ? <strong><Money c={d} /></strong> : <span className="faint">–</span>}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
          <div>
            <h3>Pay lines that change</h3>
            {changed.length === 0 ? <p className="small muted">No pay line changes in {PERIOD_LABEL[periodId]}. A pending change dated in another period shows when that period is selected.</p> : (
              <table className="reg">
                <thead><tr><th>Line</th><th className="n">Now</th><th className="n">If approved</th><th className="n">Change</th></tr></thead>
                <tbody>
                  {changed.map((k) => {
                    const a = now.get(k);
                    const b = next.get(k);
                    return <tr key={k}><td>{k}</td><td className="n"><Money c={a?.amount ?? 0} /><div className="faint small">{hrs(a)}</div></td><td className="n"><Money c={b?.amount ?? 0} /><div className="faint small">{hrs(b)}</div></td><td className="n"><strong><Money c={(b?.amount ?? 0) - (a?.amount ?? 0)} /></strong></td></tr>;
                  })}
                </tbody>
              </table>
            )}
            <p className="small muted">Preview only: nothing is approved or saved, and the pay run is unchanged.</p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Paid hours by kind for the pay slip: regular (salary standard hours or hours worked), overtime, double time, time off, total. */
export function hoursSummary(c: UsWorkerCalc): [string, number][] {
  const sum = (codes: string[]) => c.pay.lines.filter((l) => codes.includes(l.code)).reduce((t, l) => t + (l.hours ?? 0), 0);
  const rows: [string, number][] = [
    [c.worker.payType === "Hourly" ? "Regular hours worked" : "Regular salary hours", sum(["SAL", "REG"])],
    ["Overtime (1.5x)", sum(["OT"])],
    ["Double time (2x)", sum(["DT"])],
    ["Time off", sum(["PTO_TAKEN", "VAC", "SICK", "LEAVE_PAID"])],
  ];
  const shown = rows.filter(([label, h]) => h > 0 || label.startsWith("Regular"));
  const total = shown.reduce((t, [, h]) => t + h, 0);
  return total > 0 ? [...shown, ["Total paid hours", total]] : [];
}
