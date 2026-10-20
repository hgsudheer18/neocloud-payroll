import { useState } from "react";
import { useData } from "../state.tsx";
import { useErp } from "../erp.tsx";
import { setQuery } from "../router.tsx";
import { PageHead, Section, Select } from "../ui.tsx";
import { BpStatus, CanInitiate, Checks, Field, FormGrid, Toast, who } from "../erpui.tsx";
import { validateTimeOff, type Check } from "../../lib/erp/validate.ts";
import { plansForWorker } from "../../lib/engine/absence.ts";
import { eachDay, isWeekday, pretty } from "../../lib/util/dates.ts";
import { useAccess } from "../access.tsx";

export default function TimeOff({ query }: { query: URLSearchParams }) {
  const { data } = useData();
  const { erp, me, submit } = useErp();
  const access = useAccess();
  const ds = data!.dsNow;
  const employees = ds.workers.filter((w) => w.workerType === "Employee" && !w.terminationDate && access.seesDetails(w.id));
  const asked = query.get("worker") ?? "";
  const workerId = me.role === "Employee" ? me.workerId! : employees.some((e) => e.id === asked) ? asked : me.workerId ?? employees[0]?.id ?? "";
  const w = ds.workers.find((x) => x.id === workerId);
  const plans = w ? plansForWorker(w, ds.balances).filter((p) => p.code !== "US_FLEX_PTO" || p.isEligible(w)) : [];
  const [plan, setPlan] = useState("");
  const [from, setFrom] = useState("2026-10-26");
  const [to, setTo] = useState("2026-10-26");
  const [qty, setQty] = useState("");
  const [check, setCheck] = useState<Check | null>(null);
  const [msg, setMsg] = useState("");
  if (!w) return <div className="callout info">There are no workers you can request time off for.</div>;

  const p = plans.find((x) => x.code === plan) ?? plans[0];
  const perDay = Number(qty) || (p?.unit === "days" ? 1 : 8);
  const days = from && to && from <= to ? eachDay(from, to).filter(isWeekday).map((date) => ({ date, quantity: perDay })) : [];
  // Balance: latest calculated ending for this worker and plan, less pending requests.
  const line = [...data!.result.us, ...data!.result.intl].find((c) => c.worker.id === w.id)?.absence.find((a) => a.plan.code === p?.code);
  const opening = ds.balances.find((b) => b.employeeId === w.id && b.plan === p?.code)?.balance ?? null;
  const pendingQty = erp.bps.filter((b) => b.type === "Request Time Off" && b.subjectId === w.id && b.status === "Awaiting Approval" && b.payload.plan === p?.code).reduce((s, b) => s + (b.payload.days as { quantity: number }[]).reduce((a, d) => a + d.quantity, 0), 0);
  const base = line ? (line.tracked ? line.ending : null) : opening;
  const available = base === null ? null : base - pendingQty;

  const send = () => {
    if (!p) return;
    const c = validateTimeOff(ds, erp.bps, w, p.code, days, available);
    setCheck(c);
    if (c.errors.length) return;
    const bp = submit({ type: "Request Time Off", subjectId: w.id, subjectName: w.name, effectiveDate: days[0].date, summary: `${p.name}: ${days.length} day(s), ${pretty(days[0].date)}–${pretty(days[days.length - 1].date)}, ${days.reduce((s, d) => s + d.quantity, 0)} ${p.unit}`, payload: { plan: p.code, unit: p.unit, days }, warnings: c.warnings });
    setMsg(`${bp.id} submitted to the manager for approval.`);
  };
  const mine = erp.bps.filter((b) => b.type === "Request Time Off" && b.subjectId === w.id).reverse();

  return (
    <>
      <PageHead title="Request time off">Requests go to the manager. Approved hourly time off is paid from the balance and is not hours worked, so it never creates overtime. Exempt Flexible PTO has no balance and no pay impact.</PageHead>
      <div className="filters">
        {me.role === "Employee" ? <div><strong>{w.id} {w.name}</strong><div className="small muted">Your time off</div></div> : (
          <Select label="Worker" value={workerId} onChange={(v) => setQuery("/time-off", { worker: v })} options={employees.map((e) => [e.id, `${e.id} ${e.name}`])} all={null} />
        )}
      </div>
      <div className="grid2">
        <Section title="New request">
          <CanInitiate type="Request Time Off">
            <div className="sheet">
              <FormGrid>
                <Field label="Plan"><select value={p?.code ?? ""} onChange={(e) => setPlan(e.target.value)}>{plans.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></Field>
                <Field label="Available" hint={line ? `Ending balance for the selected period${pendingQty ? `, less ${pendingQty} pending` : ""}` : "Opening balance"}><input type="text" readOnly value={available === null ? "Not tracked (unlimited)" : `${available.toFixed(2)} ${p?.unit}`} /></Field>
                <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
                <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
                <Field label={`${p?.unit === "days" ? "Days" : "Hours"} per day`}><input type="text" inputMode="decimal" placeholder={p?.unit === "days" ? "1" : "8"} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
              </FormGrid>
              <p className="small muted">{days.length} weekday(s) selected: {days.reduce((s, d) => s + d.quantity, 0)} {p?.unit}. {p && `${p.name}: ${p.accrualFrequency}.`}</p>
              <Checks check={check} />
              <Toast text={msg} />
              <button className="btn" onClick={send}>Submit request</button>
            </div>
          </CanInitiate>
        </Section>
        <Section title="Requests">
          {mine.length === 0 ? <p className="muted">No requests entered in the app yet.</p> : (
            <div className="table-wrap">
              <table className="reg">
                <thead><tr><th>ID</th><th>Request</th><th>Decided by</th><th>Status</th></tr></thead>
                <tbody>{mine.map((b) => <tr key={b.id}><td>{b.id}</td><td className="small">{b.summary}</td><td className="small">{who(b.decidedBy)}</td><td><BpStatus bp={b} /></td></tr>)}</tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
