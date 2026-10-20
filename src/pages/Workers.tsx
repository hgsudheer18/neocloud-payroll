import { useMemo, useState } from "react";
import { useData } from "../state.tsx";
import { useErp } from "../erp.tsx";
import { go, setQuery } from "../router.tsx";
import { Money, PageHead, Pill, Section, Select } from "../ui.tsx";
import { BpStatus, CanInitiate, Checks, Field, FormGrid, Toast, today, who } from "../erpui.tsx";
import { buildTimeline } from "../../lib/engine/timeline.ts";
import { jobProfiles, nextWorkerId } from "../../lib/erp/apply.ts";
import { validateHire, type Check, type HireForm } from "../../lib/erp/validate.ts";
import { asOf, STATES } from "../../lib/config/usTax.ts";
import { pretty } from "../../lib/util/dates.ts";
import { toCents } from "../../lib/util/money.ts";
import type { Dataset, Worker } from "../../lib/data/types.ts";
import { BP_RULES, type BPType } from "../../lib/erp/types.ts";
import { NoAccess, useAccess } from "../access.tsx";
import { OrgChain } from "./Organisation.tsx";

const SUPPORTED_STATES = Object.keys(asOf(STATES, "2026-10-01"));

export function statusAsOf(w: Worker, ds: Dataset, date: string): string {
  if (w.workerType === "Contractor") return "Contractor";
  if (w.hireDate > date) return "Pre-hire";
  if (w.terminationDate && w.terminationDate < date) return "Terminated";
  const tl = buildTimeline(w, ds.events, date, date)[0];
  return tl.onLeave ? "On leave" : "Active";
}
const statusTone = (s: string) => (s === "Active" ? "ok" : s === "Terminated" ? "bad" : s === "On leave" ? "warn" : "info");

export default function Workers({ id, query }: { id?: string; query: URLSearchParams }) {
  const { me } = useErp();
  if (id === "new") return <Hire />;
  if (id) return <Profile id={id} action={query.get("action") ?? ""} />;
  // An employee's directory is just themselves: show their own profile.
  if (me.role === "Employee" && me.workerId) return <Profile id={me.workerId} action={query.get("action") ?? ""} />;
  return <Directory query={query} />;
}

function Directory({ query }: { query: URLSearchParams }) {
  const { data } = useData();
  const { erp } = useErp();
  const access = useAccess();
  const ds = data!.dsNow;
  const visible = ds.workers.filter((w) => access.seesWorker(w.id));
  const ref = today();
  const q = query.get("q") ?? "";
  const dept = query.get("dept") ?? "";
  const country = query.get("country") ?? "";
  const status = query.get("status") ?? "";
  const set = (k: string, v: string) => setQuery("/workers", { q, dept, country, status, [k]: v });
  const rows = useMemo(
    () =>
      visible
        .map((w) => ({ w, s: statusAsOf(w, ds, ref) }))
        .filter(({ w, s }) => (!dept || w.department === dept) && (!country || w.country === country) && (!status || s === status) && (!q || `${w.id} ${w.name} ${w.jobProfile}`.toLowerCase().includes(q.toLowerCase())))
        .sort((a, b) => (a.w.source === "erp" ? -1 : 0) - (b.w.source === "erp" ? -1 : 0) || a.w.id.localeCompare(b.w.id)),
    [visible, ds, ref, q, dept, country, status],
  );
  const pendingHires = erp.bps.filter((b) => b.type === "Hire" && b.status === "Awaiting Approval" && access.seesBp(b));
  return (
    <>
      <PageHead title="Workers">
        {visible.length} workers{access.all ? "" : " in your team"} as of today, {pretty(ref)}. Open a worker to see their effective-dated history and to change their job, pay, location, leave or employment.
      </PageHead>
      <div className="filters">
        <label>Search<input type="search" value={q} placeholder="ID, name or job" onChange={(e) => set("q", e.target.value)} /></label>
        <Select label="Department" value={dept} onChange={(v) => set("dept", v)} options={[...new Set(visible.map((w) => w.department))].sort()} />
        <Select label="Country" value={country} onChange={(v) => set("country", v)} options={["USA", "CAN", "GBR", "IND"]} />
        <Select label="Status" value={status} onChange={(v) => set("status", v)} options={["Active", "On leave", "Terminated", "Pre-hire", "Contractor"]} />
        <span className="spacer" />
        <a className="btn" href="#/workers/new">Hire a worker</a>
      </div>
      {pendingHires.length > 0 && (
        <div className="callout info">
          {pendingHires.length} hire{pendingHires.length > 1 ? "s" : ""} awaiting approval: {pendingHires.map((b) => `${b.subjectName} (${b.subjectId})`).join(", ")}. <a href="#/inbox">Open the inbox</a>
        </div>
      )}
      <div className="table-wrap" style={{ maxHeight: "68vh" }}>
        <table className="reg">
          <thead><tr><th>Worker</th><th>Job profile</th><th>Department</th><th>Location</th><th>Pay group</th><th className="n">Pay</th><th>Hire date</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map(({ w, s }) => (
              <tr key={w.id} className="click" onClick={() => go(`/workers/${w.id}`)}>
                <td><a href={`#/workers/${w.id}`} onClick={(e) => e.preventDefault()}>{w.id}</a> {w.name}{w.source === "erp" && <> <Pill tone="info">new</Pill></>}</td>
                <td>{w.jobProfile}</td>
                <td>{w.department}</td>
                <td>{ds.locations.find((l) => l.id === w.locationId)?.name ?? w.locationId}</td>
                <td className="small">{w.payGroup || "None (AP)"}</td>
                <td className="n">{!access.seesDetails(w.id) ? <span className="faint">hidden</span> : w.payType === "Hourly" ? `$${w.hourlyRate.toFixed(2)}/hr` : <Money c={toCents(w.annualSalary)} cur={w.currency} />}</td>
                <td>{w.hireDate}</td>
                <td><Pill tone={statusTone(s)}>{s}</Pill></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ hire

function Hire() {
  const { data } = useData();
  const { erp, submit } = useErp();
  const ds = data!.dsNow;
  const jps = jobProfiles(data!.base, erp.bps);
  const [f, setF] = useState<HireForm & { filingStatus: string; k401Pct: number; medicalPerPeriod: number; shift: string }>({
    name: "", hireDate: today(), jobProfile: "", flsa: "", payType: "", level: "", costCenterId: "", locationId: "", workState: "",
    annualSalary: 0, hourlyRate: 0, managerId: "", filingStatus: "Single", k401Pct: 0.05, medicalPerPeriod: 145, shift: "Day",
  });
  const [check, setCheck] = useState<Check | null>(null);
  const [done, setDone] = useState("");
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const loc = ds.locations.find((l) => l.id === f.locationId);
  const managers = ds.workers.filter((w) => /^M\d/.test(w.level) || ["E0000", "E0002", "E0005", "E0007", "E0010"].includes(w.id));

  const onJob = (name: string) => {
    const jp = jps.find((j) => j.name === name);
    set({ jobProfile: name, flsa: jp?.flsa ?? "", payType: jp?.payType ?? "", level: jp?.level ?? "" });
  };
  const onLoc = (id: string) => {
    const l = ds.locations.find((x) => x.id === id);
    set({ locationId: id, workState: l?.state ?? "" });
  };
  const doSubmit = () => {
    const c = validateHire(ds, f, SUPPORTED_STATES);
    setCheck(c);
    if (c.errors.length) return;
    const wid = nextWorkerId(ds, erp.bps);
    const bp = submit({
      type: "Hire", subjectId: wid, subjectName: f.name, effectiveDate: f.hireDate,
      summary: `Hire ${f.name} as ${f.jobProfile}, ${f.payType === "Hourly" ? `$${f.hourlyRate}/hr` : `${f.annualSalary.toLocaleString("en-US")} ${loc?.country === "USA" ? "USD" : ""}`.trim()}, ${loc?.name}, from ${f.hireDate}`,
      payload: { ...f, annualSalary: f.payType === "Hourly" ? 0 : f.annualSalary, hourlyRate: f.payType === "Hourly" ? f.hourlyRate : 0 },
      warnings: c.warnings,
    });
    setDone(`${bp.id} submitted: hire ${f.name} (${wid}) is awaiting approval by a Manager or HR Partner (not you). Approve it in the inbox.`);
  };

  return (
    <>
      <PageHead title="Hire a worker">Creates a Hire business process. Once approved, the worker is effective from the hire date: placed in the pay group for their country, with cost center and supervisory org from the position, and paid from the hire date.</PageHead>
      <p><a href="#/workers">All workers</a></p>
      <CanInitiate type="Hire">
        <div className="sheet">
          <FormGrid>
            <Field label="Legal name"><input type="text" value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Hire date" hint="Backdate into a completed period to see retro."><input type="date" value={f.hireDate} onChange={(e) => set({ hireDate: e.target.value })} /></Field>
            <Field label="Job profile" hint={f.jobProfile ? `${f.flsa}, ${f.payType}${f.level ? `, level ${f.level}` : ""}` : "Sets FLSA status and pay type"}>
              <select value={f.jobProfile} onChange={(e) => onJob(e.target.value)}>
                <option value="">Choose…</option>
                {jps.map((j) => <option key={j.name} value={j.name}>{j.name}</option>)}
              </select>
            </Field>
            <Field label="Supervisory org and cost center">
              <select value={f.costCenterId} onChange={(e) => set({ costCenterId: e.target.value })}>
                <option value="">Choose…</option>
                {ds.costCenters.map((c) => <option key={c.id} value={c.id}>{c.supervisoryOrg}: {c.id} {c.name}</option>)}
              </select>
            </Field>
            <Field label="Location">
              <select value={f.locationId} onChange={(e) => onLoc(e.target.value)}>
                <option value="">Choose…</option>
                {ds.locations.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.country})</option>)}
              </select>
            </Field>
            {loc?.country === "USA" && (
              <Field label="Work state" hint="Drives state tax and the time rules (CA or FLSA)">
                <select value={f.workState} onChange={(e) => set({ workState: e.target.value })} disabled={!!loc.state}>
                  <option value="">Choose…</option>
                  {SUPPORTED_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            )}
            {f.payType === "Hourly" ? (
              <Field label="Hourly rate (USD)"><input type="text" inputMode="decimal" value={f.hourlyRate || ""} onChange={(e) => set({ hourlyRate: Number(e.target.value) || 0 })} /></Field>
            ) : (
              <Field label={`Annual salary${loc ? ` (${loc.country === "USA" ? "USD" : loc.country === "GBR" ? "GBP" : loc.country === "CAN" ? "CAD" : "INR"})` : ""}`}><input type="text" inputMode="decimal" value={f.annualSalary || ""} onChange={(e) => set({ annualSalary: Number(e.target.value.replace(/,/g, "")) || 0 })} /></Field>
            )}
            <Field label="Manager">
              <select value={f.managerId} onChange={(e) => set({ managerId: e.target.value })}>
                <option value="">Choose…</option>
                {managers.map((m) => <option key={m.id} value={m.id}>{m.id} {m.name}</option>)}
              </select>
            </Field>
            {loc?.country === "USA" && (
              <>
                <Field label="Federal filing status"><select value={f.filingStatus} onChange={(e) => set({ filingStatus: e.target.value })}><option>Single</option><option value="MFJ">Married filing jointly</option></select></Field>
                <Field label="401(k) pre-tax %"><input type="text" inputMode="decimal" value={String(Math.round(f.k401Pct * 1000) / 10)} onChange={(e) => set({ k401Pct: (Number(e.target.value) || 0) / 100 })} /></Field>
                <Field label="Medical premium per period (USD)"><input type="text" inputMode="decimal" value={String(f.medicalPerPeriod)} onChange={(e) => set({ medicalPerPeriod: Number(e.target.value) || 0 })} /></Field>
              </>
            )}
            {f.payType === "Hourly" && <Field label="Shift"><select value={f.shift} onChange={(e) => set({ shift: e.target.value })}><option>Day</option><option>Night</option></select></Field>}
          </FormGrid>
          <Checks check={check} />
          <Toast text={done} />
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={doSubmit}>Submit hire</button>
            <span className="small muted">Checks: minimum wage and California exempt salary threshold (2026), supported work state, required fields.</span>
          </div>
        </div>
      </CanInitiate>
    </>
  );
}

// ------------------------------------------------------------------ profile

const ACTIONS: { key: string; type: BPType; label: string }[] = [
  { key: "comp", type: "Change Compensation", label: "Change pay" },
  { key: "cc", type: "Change Cost Center", label: "Change cost center" },
  { key: "location", type: "Change Location", label: "Change location" },
  { key: "leave", type: "Leave of Absence", label: "Start leave" },
  { key: "return", type: "Return from Leave", label: "Return from leave" },
  { key: "terminate", type: "Terminate", label: "Terminate" },
];

function Profile({ id, action }: { id: string; action: string }) {
  const { data } = useData();
  const { erp, me } = useErp();
  const access = useAccess();
  const ds = data!.dsNow;
  const w = ds.workers.find((x) => x.id === id);
  const pendingHire = erp.bps.find((b) => b.type === "Hire" && b.subjectId === id);
  if (!w && pendingHire && !access.seesBp(pendingHire)) return <NoAccess what={`worker ${id}`} />;
  if (!w) {
    return (
      <>
        <p><a href="#/workers">All workers</a></p>
        {pendingHire ? <div className="callout info">{pendingHire.subjectName} ({id}): hire is {pendingHire.status.toLowerCase()}. The worker record exists once the hire is approved.</div> : <div className="callout bad">Worker {id} not found.</div>}
      </>
    );
  }
  const ref = today();
  const tl = buildTimeline(w, ds.events, ref, ref)[0];
  const status = statusAsOf(w, ds, ref);
  const cc = ds.costCenters.find((c) => c.id === tl.costCenterId);
  const loc = ds.locations.find((l) => l.id === tl.locationId);
  const manager = w.managerId ? `${w.managerId} ${ds.workers.find((m) => m.id === w.managerId)?.name ?? ""}` : "—";
  // Outside your directory a profile shows name, job and org details only.
  if (!access.seesWorker(id)) {
    return (
      <>
        <div className="detail">
          <div className="detail-head">
            <h2>{w.id} {w.name}</h2>
            <span className="muted">{w.jobProfile}</span>
          </div>
          <dl className="kv">
            <dt>Department</dt><dd>{w.department}</dd>
            <dt>Supervisory org</dt><dd>{cc?.supervisoryOrg ?? w.supervisoryOrg}</dd>
            <dt>Location</dt><dd>{loc?.name}</dd>
            <dt>Company</dt><dd>{ds.companies.find((c) => c.id === w.companyId)?.name}</dd>
            <dt>Manager</dt><dd>{manager}</dd>
          </dl>
        </div>
        <Section title="Organisation hierarchy"><OrgChain id={w.id} /></Section>
        <p className="small muted">Only {w.name}'s managers and payroll can see their compensation, time and time off.</p>
      </>
    );
  }
  const details = access.seesDetails(id);
  const isComp = (field: string) => /salary|rate|comp|pay/i.test(field);
  const history = [
    { date: w.hireDate, what: "Hire", detail: `${w.jobProfile}, ${w.department}`, entered: w.enteredOn ?? w.hireDate, by: w.source === "erp" ? "Business process" : "Data package" },
    ...ds.events.filter((e) => e.employeeId === id && (details || !isComp(`${e.event} ${e.field}`))).map((e) => ({ date: e.effectiveDate, what: e.event, detail: `${e.field}: ${e.oldValue || "—"} → ${e.newValue}${e.reason && !e.reason.startsWith("BP-") ? ` (${e.reason})` : ""}`, entered: e.enteredOn, by: e.source === "erp" ? e.reason.startsWith("BP-") ? e.reason : "Business process" : "Data package" })),
    ...(w.terminationDate && !ds.events.some((e) => e.employeeId === id && e.event === "Termination") ? [{ date: w.terminationDate, what: "Termination", detail: "Last day worked", entered: w.terminationDate, by: "Data package" }] : []),
  ].sort((a, b) => (a.date < b.date ? -1 : 1));
  const bps = erp.bps.filter((b) => b.subjectId === id && access.seesBp(b)).reverse();
  const inRun = data!.result.us.find((c) => c.worker.id === id);
  const intl = data!.result.intl.find((c) => c.worker.id === id);
  const absence = inRun?.absence ?? intl?.absence ?? [];

  return (
    <>
      <p><a href="#/workers">All workers</a></p>
      <div className="detail">
        <div className="detail-head">
          <h2>{w.id} {w.name}</h2>
          <Pill tone={statusTone(status)}>{status}</Pill>
          <span className="muted">{w.jobProfile}</span>
        </div>
        <div className="grid2">
          <dl className="kv">
            <dt>As of</dt><dd>Today, {pretty(ref)}</dd>
            <dt>Department</dt><dd>{w.department}</dd>
            <dt>Supervisory org</dt><dd>{cc?.supervisoryOrg ?? w.supervisoryOrg}</dd>
            <dt>Cost center</dt><dd>{tl.costCenterId} {cc?.name}</dd>
            <dt>Location</dt><dd>{loc?.name} ({tl.workState})</dd>
            <dt>Company</dt><dd>{ds.companies.find((c) => c.id === w.companyId)?.name}</dd>
          </dl>
          <dl className="kv">
            <dt>Pay group</dt><dd>{w.payGroup || "None (contingent worker)"}</dd>
            <dt>FLSA / pay type</dt><dd>{w.flsa}, {w.payType}</dd>
            <dt>Pay</dt><dd>{!details ? <span className="faint">Hidden for your role</span> : w.payType === "Hourly" ? `$${tl.hourlyRate.toFixed(2)} per hour` : `${tl.annualSalary.toLocaleString("en-US")} ${w.currency} per year`}</dd>
            <dt>Manager</dt><dd>{manager}</dd>
            <dt>Hire date</dt><dd>{w.hireDate}</dd>
            <dt>Termination</dt><dd>{w.terminationDate || "—"}</dd>
          </dl>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          {w.workerType === "Employee" && ACTIONS.filter((a) => BP_RULES[a.type].initiators.includes(me.role)).map((a) => (
            <button key={a.key} className={`btn ${action === a.key ? "" : "ghost"}`} onClick={() => go(`/workers/${id}`, { action: action === a.key ? "" : a.key })}>{a.label}</button>
          ))}
          {details && w.payType === "Hourly" && access.canOpen("time-entry") && <a className="btn ghost" href={`#/time-entry?worker=${id}`}>Enter time</a>}
          {details && w.workerType === "Employee" && access.canOpen("time-off") && <a className="btn ghost" href={`#/time-off?worker=${id}`}>Request time off</a>}
          {inRun && (access.payResults ? <a className="btn ghost" href={`#/register/${id}`}>Payslip</a> : id === me.workerId && <a className="btn ghost" href="#/payslip">Pay Slip</a>)}
        </div>
      </div>

      {action && <ActionForm w={w} action={action} />}

      <Section title="Organisation hierarchy" lede="From the CEO down to this worker, with their direct reports."><OrgChain id={w.id} withReports /></Section>

      <div className="grid2">
        <Section title="Effective-dated history" lede="Nothing is overwritten: each change has an effective date and the date it was entered.">
          <div className="table-wrap">
            <table className="reg">
              <thead><tr><th>Effective</th><th>Change</th><th>Detail</th><th>Entered</th><th>Source</th></tr></thead>
              <tbody>{history.map((h, i) => <tr key={i}><td>{h.date}</td><td>{h.what}</td><td className="small">{h.detail}</td><td>{h.entered}</td><td className="small">{h.by}</td></tr>)}</tbody>
            </table>
          </div>
        </Section>
        <Section title="Time off balances" lede={`For the selected period (${data!.result.period.start} to ${data!.result.period.end}${intl ? "; international plans for October" : ""}).`}>
          {!details ? <p className="muted">Only {w.name}'s managers and payroll can see their time off.</p> : absence.length === 0 ? <p className="muted">Not in the selected pay run{w.payGroup ? `: ${w.payGroup} is paid in a different period` : ""}.</p> : (
            <div className="table-wrap">
              <table className="reg">
                <thead><tr><th>Plan</th><th className="n">Opening</th><th className="n">Accrued</th><th className="n">Taken</th><th className="n">Ending</th></tr></thead>
                <tbody>{absence.map((a) => <tr key={a.plan.code}><td>{a.plan.name}</td><td className="n">{a.tracked ? a.opening.toFixed(2) : "—"}</td><td className="n">{a.accrual.toFixed(2)}</td><td className="n">{a.taken.toFixed(2)}</td><td className="n">{a.tracked ? `${a.ending.toFixed(2)} ${a.unit}` : "not tracked"}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
      <Section title="Business processes">
        {bps.length === 0 ? <p className="muted">None entered in the app for this worker.</p> : (
          <div className="table-wrap">
            <table className="reg">
              <thead><tr><th>ID</th><th>Process</th><th>Summary</th><th>Effective</th><th>Initiated by</th><th>Decided by</th><th>Status</th></tr></thead>
              <tbody>{bps.map((b) => <tr key={b.id}><td>{b.id}</td><td>{b.type}</td><td className="small">{b.summary}</td><td>{b.effectiveDate}</td><td className="small">{who(b.initiatedBy)}</td><td className="small">{who(b.decidedBy)}</td><td><BpStatus bp={b} /></td></tr>)}</tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

function ActionForm({ w, action }: { w: Worker; action: string }) {
  const { data } = useData();
  const { submit, erp } = useErp();
  const details = useAccess().seesDetails(w.id);
  const ds = data!.dsNow;
  const a = ACTIONS.find((x) => x.key === action)!;
  const ref = today();
  const tl = buildTimeline(w, ds.events, ref, ref)[0];
  const [eff, setEff] = useState(ref);
  const [val, setVal] = useState("");
  const [state, setState] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "bad" }>({ text: "", tone: "ok" });
  if (!a) return null;
  const pending = erp.bps.some((b) => b.subjectId === w.id && b.type === a.type && b.status === "Awaiting Approval");

  const send = () => {
    const errs: string[] = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eff)) errs.push("Choose an effective date.");
    if (eff < w.hireDate) errs.push("Effective date is before the hire date.");
    let payload: Record<string, unknown> = { reason };
    let summary = "";
    switch (a.type) {
      case "Change Compensation": {
        const n = Number(val.replace(/,/g, ""));
        if (!(n > 0)) errs.push("Enter the new amount.");
        if (w.payType === "Hourly") {
          if (w.workState === "CA" && n < 16.9) errs.push("Below the 2026 California minimum wage ($16.90).");
          payload = { ...payload, hourlyRate: n, oldHourlyRate: tl.hourlyRate };
          summary = `Hourly rate ${details ? `\$${tl.hourlyRate.toFixed(2)} → ` : "to "}$${n.toFixed(2)} from ${eff}`;
        } else {
          payload = { ...payload, annualSalary: n, oldAnnualSalary: tl.annualSalary };
          summary = `Salary ${details ? `${tl.annualSalary.toLocaleString("en-US")} → ` : "to "}${n.toLocaleString("en-US")} ${w.currency} from ${eff}`;
        }
        break;
      }
      case "Change Cost Center":
        if (!val) errs.push("Choose the new cost center.");
        payload = { ...payload, costCenterId: val, oldCostCenterId: tl.costCenterId };
        summary = `Cost center ${tl.costCenterId} → ${val} from ${eff}`;
        break;
      case "Change Location": {
        const l = ds.locations.find((x) => x.id === val);
        if (!l) errs.push("Choose the new location.");
        if (l && l.country !== w.country) errs.push("Moving to another country is an international transfer (new worker in the other company), not a location change.");
        const ws = l?.state || state;
        if (l?.country === "USA" && !SUPPORTED_STATES.includes(ws)) errs.push("Choose a work state with payroll tax setup.");
        payload = { ...payload, locationId: val, oldLocationId: tl.locationId, workState: ws, oldWorkState: tl.workState };
        summary = `Location ${tl.locationId} (${tl.workState}) → ${val} (${ws}) from ${eff}`;
        break;
      }
      case "Leave of Absence":
        if (tl.onLeave) errs.push("Already on leave.");
        summary = `Unpaid leave from ${eff}${reason ? `: ${reason}` : ""}`;
        break;
      case "Return from Leave":
        if (!buildTimeline(w, ds.events, eff, eff)[0].onLeave && !tl.onLeave) errs.push("The worker is not on leave.");
        summary = `Return from leave on ${eff}`;
        break;
      case "Terminate":
        if (w.terminationDate) errs.push("Already terminated.");
        if (!reason) errs.push("Choose a termination reason.");
        summary = `Terminate, last day ${eff} (${reason || "no reason"})`;
        break;
    }
    if (pending) errs.push(`A ${a.type} for ${w.id} is already awaiting approval.`);
    if (errs.length) return setMsg({ text: errs.join(" "), tone: "bad" });
    const bp = submit({ type: a.type, subjectId: w.id, subjectName: w.name, effectiveDate: eff, payload, summary });
    setMsg({ text: `${bp.id} submitted and awaiting approval by someone else. Payroll uses it once approved.`, tone: "ok" });
  };

  return (
    <Section title={a.label}>
      <CanInitiate type={a.type}>
        <div className="sheet">
          <FormGrid>
            <Field label={a.type === "Terminate" ? "Last day worked" : "Effective date"} hint="A date in a completed period is paid as retro in the next period.">
              <input type="date" value={eff} onChange={(e) => setEff(e.target.value)} />
            </Field>
            {a.type === "Change Compensation" && (
              <Field label={w.payType === "Hourly" ? `New hourly rate${details ? ` (now \$${tl.hourlyRate.toFixed(2)})` : ""}` : `New annual salary (${w.currency})${details ? ` (now ${tl.annualSalary.toLocaleString("en-US")})` : ""}`}>
                <input type="text" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} />
              </Field>
            )}
            {a.type === "Change Cost Center" && (
              <Field label={`New cost center (now ${tl.costCenterId})`}>
                <select value={val} onChange={(e) => setVal(e.target.value)}>
                  <option value="">Choose…</option>
                  {ds.costCenters.filter((c) => c.id !== tl.costCenterId).map((c) => <option key={c.id} value={c.id}>{c.id} {c.name} ({c.companyId})</option>)}
                </select>
              </Field>
            )}
            {a.type === "Change Location" && (
              <>
                <Field label={`New location (now ${tl.locationId})`}>
                  <select value={val} onChange={(e) => setVal(e.target.value)}>
                    <option value="">Choose…</option>
                    {ds.locations.filter((l) => l.country === w.country).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </Field>
                {ds.locations.find((l) => l.id === val)?.state === "" && (
                  <Field label="Work state (remote)">
                    <select value={state} onChange={(e) => setState(e.target.value)}>
                      <option value="">Choose…</option>
                      {SUPPORTED_STATES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </Field>
                )}
              </>
            )}
            {a.type === "Terminate" ? (
              <Field label="Reason">
                <select value={reason} onChange={(e) => setReason(e.target.value)}>
                  <option value="">Choose…</option>
                  <option>Voluntary: resignation</option>
                  <option>Involuntary: performance</option>
                  <option>Involuntary: reduction in force</option>
                </select>
              </Field>
            ) : (
              <Field label="Reason or comment"><input type="text" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            )}
          </FormGrid>
          {a.type === "Terminate" && w.workState === "CA" && <div className="callout info">California: final pay, including accrued vacation, is due on the last day (involuntary) or within 72 hours (resignation without notice). Payroll will flag it as an on-demand payment.</div>}
          <Toast text={msg.text} tone={msg.tone} />
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={send}>Submit {a.label.toLowerCase()}</button>
          </div>
        </div>
      </CanInitiate>
    </Section>
  );
}
