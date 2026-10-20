import { useState } from "react";
import { useData } from "../state.tsx";
import { useErp } from "../erp.tsx";
import { Money, PageHead, Pill, Section } from "../ui.tsx";
import { ApproverJump, BpStatus, CanInitiate, Field, FormGrid, Toast, who } from "../erpui.tsx";
import { PERIOD_LABEL, US_PERIOD, US_PERIODS } from "../../lib/config/period.ts";
import { pretty } from "../../lib/util/dates.ts";
import type { PayInput } from "../../lib/data/types.ts";

const KINDS: { code: string; label: string; deduction?: boolean; hint: string }[] = [
  { code: "ADJ_EARN", label: "Earnings adjustment (missed or corrected pay)", hint: "Missed hours, back pay, a correction. Negative reduces earnings." },
  { code: "BONUS", label: "Bonus", hint: "Supplemental wages." },
  { code: "COMMISSION", label: "Commission", hint: "Supplemental wages." },
  { code: "K401", label: "401(k) deduction adjustment", deduction: true, hint: "Catch-up of a missed deferral, or a refund (negative). Pre-tax." },
  { code: "MED", label: "Medical deduction adjustment", deduction: true, hint: "Missed or refunded medical premium. Pre-tax (Section 125)." },
];

/**
 * Payroll inputs: one-time pay or deduction adjustments for a pay period (current, or a
 * completed one, which is paid as retro in the next pay run), or ongoing inputs paid every
 * pay period between a start and end date. Entered by a Payroll Specialist and approved by
 * a Payroll Approver.
 */
export default function PayrollInputs() {
  const { data } = useData();
  const { erp, submit } = useErp();
  const ds = data!.dsNow;
  const people = ds.workers.filter((w) => w.workerType === "Employee" && w.country === "USA").sort((a, b) => a.id.localeCompare(b.id));
  const [workerId, setWorkerId] = useState(people[0]?.id ?? "");
  const [kind, setKind] = useState<"one-time" | "ongoing">("one-time");
  const [code, setCode] = useState("ADJ_EARN");
  const [amount, setAmount] = useState("");
  const [hours, setHours] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [start, setStart] = useState("2026-10-16");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [lastBp, setLastBp] = useState("");
  const [ending, setEnding] = useState<{ id: string; date: string } | null>(null);

  const w = ds.workers.find((x) => x.id === workerId);
  const hourly = w?.payType === "Hourly";
  const periods = US_PERIODS.filter((p) => p.id === US_PERIOD.id || (hourly ? p.payGroup === "US Biweekly" : p.payGroup === "US Semi-Monthly"));
  const pid = periods.some((p) => p.id === periodId) ? periodId : periods.find((p) => erp.payRuns[p.id]?.status !== "Completed")?.id ?? periods[0]?.id;
  const completed = (id: string) => erp.payRuns[id]?.status === "Completed";
  const k = KINDS.find((x) => x.code === code)!;
  const byHours = code === "ADJ_EARN" && hourly && hours.trim() !== "";
  const value = byHours ? Math.round(Number(hours) * w!.hourlyRate * 100) / 100 : Number(amount.replace(/[$,]/g, ""));

  const send = () => {
    const errs: string[] = [];
    if (!w) errs.push("Choose a worker.");
    if (!value || Number.isNaN(value)) errs.push(byHours ? "Enter the hours." : "Enter an amount (negative to reduce or refund).");
    if (!reason.trim()) errs.push("Give a reason: it is recorded with the input and shown on the pay slip.");
    if (kind === "one-time" && k.deduction && completed(pid)) errs.push("Deduction adjustments apply to an open pay period; enter it in the next one.");
    if (kind === "ongoing" && (!start || (end && end < start))) errs.push("Choose a start date, and an end date on or after it (or leave it open).");
    setErrors(errs);
    if (errs.length || !w) return;
    const input: Omit<PayInput, "id" | "workerId"> = { code, amount: value, ...(byHours ? { hours: Number(hours) } : {}), kind, ...(kind === "one-time" ? { periodId: pid } : { start, ...(end ? { end } : {}) }), reason: reason.trim() };
    const when = kind === "one-time" ? `${PERIOD_LABEL[pid]}${completed(pid) ? " (completed: paid as retro in the next pay run)" : ""}` : `every pay period from ${pretty(start)}${end ? ` to ${pretty(end)}` : ""}`;
    const bp = submit({ type: "Payroll Input", subjectId: w.id, subjectName: w.name, effectiveDate: kind === "one-time" ? US_PERIODS.find((p) => p.id === pid)!.start : start, summary: `${k.label.split(" (")[0]}: ${value < 0 ? "−" : ""}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2 })}${byHours ? ` (${hours} hrs × $${w.hourlyRate.toFixed(2)})` : ""}, ${when}. ${reason.trim()}`, payload: { input } });
    setLastBp(bp.id);
    setMsg(`${bp.id} submitted for approval by a Payroll Approver.`);
    setAmount(""); setHours(""); setReason("");
  };
  const endEarly = () => {
    if (!ending) return;
    const src = erp.bps.find((b) => b.id === ending.id)!;
    const bp = submit({ type: "Payroll Input", subjectId: src.subjectId, subjectName: src.subjectName, effectiveDate: ending.date, summary: `End ${ending.id} on ${pretty(ending.date)}`, payload: { endsInput: ending.id, end: ending.date } });
    setLastBp(bp.id);
    setMsg(`${bp.id}: ending ${ending.id} on ${pretty(ending.date)} is waiting for approval.`);
    setEnding(null);
  };

  const inputs = erp.bps.filter((b) => b.type === "Payroll Input").reverse();
  return (
    <>
      <PageHead title="Payroll inputs">Enter missed earnings, bonuses, commissions and deduction adjustments. One-time inputs apply to one pay period; an input for a completed period is paid as retro in the next pay run. Ongoing inputs are paid every pay period between a start and end date. A Payroll Approver approves each input before it is paid.</PageHead>
      <Toast text={msg} tone="info" />
      {msg && <ApproverJump bp={erp.bps.find((b) => b.id === lastBp)} />}
      {errors.map((e) => <div key={e} className="callout bad">{e}</div>)}
      <CanInitiate type="Payroll Input">
        <Section title="New payroll input">
          <div className="sheet">
            <FormGrid>
              <Field label="Worker"><select value={workerId} onChange={(e) => setWorkerId(e.target.value)}>{people.map((p) => <option key={p.id} value={p.id}>{p.id} {p.name} ({p.payType === "Hourly" ? "hourly, biweekly" : "salaried, semi-monthly"})</option>)}</select></Field>
              <Field label="Input type"><select value={kind} onChange={(e) => setKind(e.target.value as "one-time" | "ongoing")}><option value="one-time">One-time (one pay period)</option><option value="ongoing">Ongoing (start and end date)</option></select></Field>
              <Field label="What" hint={k.hint}><select value={code} onChange={(e) => setCode(e.target.value)}>{KINDS.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</select></Field>
              {code === "ADJ_EARN" && hourly && <Field label="Hours (optional)" hint={`Paid at $${w!.hourlyRate.toFixed(2)}/hr; leave blank to enter an amount`}><input type="text" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>}
              {!byHours && <Field label={`Amount per ${kind === "ongoing" ? "pay period" : "input"} (USD)`} hint="Negative reduces earnings or refunds a deduction"><input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></Field>}
              {kind === "one-time" ? (
                <Field label="Pay period"><select value={pid} onChange={(e) => setPeriodId(e.target.value)}>{periods.map((p) => <option key={p.id} value={p.id}>{PERIOD_LABEL[p.id]}{completed(p.id) ? " — completed (retro)" : ""}</option>)}</select></Field>
              ) : (
                <>
                  <Field label="Start date"><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
                  <Field label="End date" hint="Leave blank to keep paying until ended"><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
                </>
              )}
              <Field label="Reason" wide><input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Missed 4 hours on Oct 9; on-call stipend" /></Field>
            </FormGrid>
            {byHours && <p className="small">= ${value.toFixed(2)} ({hours} hrs × ${w!.hourlyRate.toFixed(2)})</p>}
            {kind === "one-time" && completed(pid) && <div className="callout info">{PERIOD_LABEL[pid]} is completed, so this is paid as retro in the next pay run; the completed period stays as paid.</div>}
            <div className="row" style={{ marginTop: 12 }}><button className="btn" onClick={send}>Submit for approval</button></div>
          </div>
        </Section>
      </CanInitiate>

      <Section title="Payroll inputs" lede="Every input entered, with who approved it. Approved inputs are paid in the pay runs they apply to.">
        {inputs.length === 0 ? <p className="muted">None yet.</p> : (
          <div className="table-wrap">
            <table className="reg">
              <thead><tr><th>ID</th><th>Worker</th><th>Input</th><th>Entered by</th><th>Status</th><th /></tr></thead>
              <tbody>
                {inputs.map((b) => {
                  const inp = b.payload.input as PayInput | undefined;
                  const live = (ds.payInputs ?? []).find((x) => x.id === b.id);
                  return (
                    <tr key={b.id}>
                      <td>{b.id}</td>
                      <td><a href={`#/workers/${b.subjectId}`}>{b.subjectId}</a> {b.subjectName}</td>
                      <td className="small wrap">{b.summary}{live?.end && inp?.kind === "ongoing" && live.end !== inp.end ? <div><Pill>Ends {pretty(live.end)}</Pill></div> : null}{inp ? <div className="faint"><Money c={Math.round(inp.amount * 100)} /> {inp.kind === "ongoing" ? "per pay period" : ""}</div> : null}</td>
                      <td className="small">{who(b.initiatedBy)}</td>
                      <td><BpStatus bp={b} />{b.decidedBy && <div className="faint small">{who(b.decidedBy)}</div>}</td>
                      <td>
                        {inp?.kind === "ongoing" && b.status === "Approved" && (ending?.id === b.id ? (
                          <div className="row"><input type="date" value={ending.date} onChange={(e) => setEnding({ id: b.id, date: e.target.value })} /><button className="btn ghost" onClick={endEarly}>End</button></div>
                        ) : <button className="close" style={{ marginLeft: 0 }} onClick={() => setEnding({ id: b.id, date: live?.end ?? "2026-10-31" })}>End early</button>)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
