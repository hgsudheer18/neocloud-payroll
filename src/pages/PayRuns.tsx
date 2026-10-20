import { useState } from "react";
import { useData } from "../state.tsx";
import { useErp } from "../erp.tsx";
import { Money, PageHead, Pill, Section } from "../ui.tsx";
import { RoleNote, Toast, who } from "../erpui.tsx";
import { PAYRUN_RULES, type PayRun } from "../../lib/erp/types.ts";
import { PERIOD_LABEL, PRIOR_PERIOD, US_PERIODS } from "../../lib/config/period.ts";
import { approvedCount } from "../../lib/erp/periods.ts";
import { pretty } from "../../lib/util/dates.ts";
import { fmt } from "../../lib/util/money.ts";
import { AutofillShifts } from "./TimeEntry.tsx";

const STEPS = ["Calculated", "Approved", "Completed"] as const;

export default function PayRuns() {
  const { data } = useData();
  const { erp, me, periodId, setPeriod, updatePayRun } = useErp();
  const r = data!.result;
  const view = data!.view;
  const period = view.period;
  const run: PayRun = erp.payRuns[period.id] ?? { periodId: period.id, status: "Not started" };
  const [ack, setAck] = useState("");
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "bad" | "info" }>({ text: "", tone: "ok" });
  const criticals = r.audit.filter((a) => a.severity === "Critical");
  const warnings = r.audit.filter((a) => a.severity === "Warning");
  const tiesOk = r.ties.every((t) => t.ok);
  const glOk = r.journal.issues.filter((i) => i.severity === "Error").length === 0;
  const stale = (run.status === "Calculated" || run.status === "Approved") && run.bpCountAtCalc !== approvedCount(erp.bps);
  const pendingTime = erp.bps.filter((b) => b.status === "Awaiting Approval" && (b.type === "Enter Time" || b.type === "Request Time Off") && b.effectiveDate <= period.end).length;
  const dependents = US_PERIODS.filter((p) => PRIOR_PERIOD[p.id] === period.id && (erp.payRuns[p.id]?.status ?? "Not started") !== "Not started");
  const has = (roles: string[]) => roles.includes(me.role);
  const now = () => new Date().toISOString();

  const calculate = () => {
    if (!view.priorCompleted) return setMsg({ text: `Complete ${PERIOD_LABEL[PRIOR_PERIOD[period.id]!]} first: this period starts from its year-to-date totals and balances.`, tone: "bad" });
    updatePayRun(period.id, { status: "Calculated", calculatedBy: me.id, calculatedAt: now(), bpCountAtCalc: approvedCount(erp.bps), approvedBy: undefined, approvedAt: undefined, acknowledged: undefined, completedAt: undefined, completedBy: undefined, totals: { gross: r.totals.gross, net: r.totals.net, burdened: r.totals.burdened, workers: r.us.length } });
    setMsg({ text: `Calculated ${r.us.length} workers. Review the audit, then a Payroll Approver approves.`, tone: "ok" });
  };
  const approve = () => {
    if (run.calculatedBy === me.id) return setMsg({ text: "Segregation of duties: you calculated this pay run, so someone else must approve it.", tone: "bad" });
    if (stale) return setMsg({ text: "Inputs changed after the calculation. Recalculate before approving.", tone: "bad" });
    if (!tiesOk) return setMsg({ text: "Control totals do not tie. Resolve before approving.", tone: "bad" });
    if (criticals.length && ack.trim().length < 10) return setMsg({ text: `Record how the ${criticals.length} critical finding(s) were resolved before approving.`, tone: "bad" });
    updatePayRun(period.id, { status: "Approved", approvedBy: me.id, approvedAt: now(), acknowledged: ack || undefined });
    setMsg({ text: "Approved. Complete the pay run to lock it, release settlement and post the journal.", tone: "ok" });
  };
  const complete = () => {
    if (stale) return setMsg({ text: "Inputs changed after the calculation. Recalculate and re-approve.", tone: "bad" });
    updatePayRun(period.id, { status: "Completed", completedBy: me.id, completedAt: now() });
    setMsg({ text: "Completed. The period is locked: later changes to it are paid as retro in the next period.", tone: "ok" });
  };
  const reopen = () => {
    if (dependents.length) return setMsg({ text: `Reopen ${dependents.map((d) => PERIOD_LABEL[d.id]).join(", ")} first; it builds on this period.`, tone: "bad" });
    updatePayRun(period.id, { status: "Not started", calculatedAt: undefined, calculatedBy: undefined, approvedAt: undefined, approvedBy: undefined, completedAt: undefined, completedBy: undefined });
    setMsg({ text: "Reopened.", tone: "info" });
  };

  const stepInfo = (s: (typeof STEPS)[number]) =>
    s === "Calculated" ? [run.calculatedBy, run.calculatedAt] : s === "Approved" ? [run.approvedBy, run.approvedAt] : [run.completedBy, run.completedAt];
  const reached = (s: (typeof STEPS)[number]) => STEPS.indexOf(s) <= STEPS.indexOf(run.status as (typeof STEPS)[number]) && run.status !== "Not started";

  return (
    <>
      <PageHead title="Pay runs">
        Calculate, review, approve and complete each pay period. A different person must approve than the one who calculated. Completing a period locks it and carries year-to-date totals and balances into the next period.
      </PageHead>

      <div className="table-wrap">
        <table className="reg">
          <thead><tr><th>Period</th><th>Pay group</th><th>Check date</th><th>Builds on</th><th>Status</th><th className="n">Gross at calculation</th></tr></thead>
          <tbody>
            {US_PERIODS.map((p) => {
              const pr = erp.payRuns[p.id];
              return (
                <tr key={p.id} className={`click ${p.id === periodId ? "sel" : ""}`} onClick={() => setPeriod(p.id)}>
                  <td>{PERIOD_LABEL[p.id]}</td>
                  <td>{p.payGroup}</td>
                  <td>{pretty(p.checkDate)}</td>
                  <td className="small">{PRIOR_PERIOD[p.id] ? PERIOD_LABEL[PRIOR_PERIOD[p.id]!] : "Converted balances (parallel run)"}</td>
                  <td><Pill tone={pr?.status === "Completed" ? "ok" : pr?.status ? "warn" : ""}>{pr?.status ?? "Not started"}</Pill></td>
                  <td className="n">{pr?.totals ? fmt(pr.totals.gross) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {me.role === "Payroll Specialist" && <AutofillShifts />}

      <Section title={PERIOD_LABEL[period.id]} lede={`${pretty(period.start)} to ${pretty(period.end)}, paid ${pretty(period.checkDate)}. ${r.reconciled ? "Parallel-run period: also reconciled to the Rippling register." : "Post go-live period: Workday is the only system."}`}>
        <div className="steps">
          {STEPS.map((s) => {
            const [by, at] = stepInfo(s);
            return (
              <div key={s} className={`step ${reached(s) ? "done" : ""}`}>
                <strong>{s}</strong>
                <span className="small">{reached(s) && by ? `${who(by)}, ${new Date(at!).toLocaleString()}` : "Not yet"}</span>
              </div>
            );
          })}
        </div>
        {!view.priorCompleted && <div className="callout">Waiting for {PERIOD_LABEL[PRIOR_PERIOD[period.id]!]} to be completed. Results below are provisional.</div>}
        {stale && <div className="callout bad">Inputs changed since this pay run was calculated ({approvedCount(erp.bps) - (run.bpCountAtCalc ?? 0)} newly approved business processes). Recalculate.</div>}
        {pendingTime > 0 && <div className="callout">{pendingTime} time or time-off entries for this period are still awaiting approval and are not paid. <a href="#/inbox">Open the inbox</a></div>}
        {view.retro.size > 0 && <div className="callout info">Retro from changes to the completed prior period: {[...view.retro.entries()].map(([id, v]) => `${id} ${fmt(v.amount)}`).join(", ")}.</div>}

        <div className="figures" style={{ marginTop: 12 }}>
          <div className="figure"><div className="v">{r.us.length}</div><div className="l">Workers in run</div></div>
          <div className="figure"><div className="v"><Money c={r.totals.gross} /></div><div className="l">Gross</div></div>
          <div className="figure"><div className="v"><Money c={r.totals.net} /></div><div className="l">Net pay (bank file)</div></div>
          <div className="figure"><div className="v"><Money c={r.totals.burdened} /></div><div className="l">Burdened cost</div></div>
          <div className="figure"><div className="v">{tiesOk ? "All tie" : "Check"}</div><div className="l">{r.ties.length} control totals</div></div>
          <div className="figure"><div className="v">{criticals.length} / {warnings.length}</div><div className="l">Critical / warning audit items</div></div>
          <div className="figure"><div className="v">{glOk ? "Ready" : "Blocked"}</div><div className="l">NetSuite journal</div></div>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <a href="#/register">Register</a><a href="#/controls">Audit findings</a><a href="#/">Control totals</a><a href="#/gl">Journal</a>{r.reconciled && <a href="#/reconciliation">Legacy reconciliation</a>}
        </div>

        <div className="sheet" style={{ marginTop: 16 }}>
          <Toast text={msg.text} tone={msg.tone} />
          {(run.status === "Not started" || stale) && (has(PAYRUN_RULES.calculate) ? <button className="btn" onClick={calculate}>{run.status === "Not started" ? "Calculate pay" : "Recalculate"}</button> : <RoleNote roles={PAYRUN_RULES.calculate} action="calculate pay" />)}
          {run.status === "Calculated" && !stale && (has(PAYRUN_RULES.approve) ? (
            <>
              {criticals.length > 0 && (
                <>
                  <p className="small"><strong>{criticals.length} critical finding(s)</strong> must be resolved or explained:</p>
                  <ul className="small">{criticals.map((c, i) => <li key={i}>{c.employeeId}: {c.message}</li>)}</ul>
                  <label className="field wide"><span className="field-label">Resolution (recorded with the approval)</span><input type="text" value={ack} placeholder="e.g. E0148 final pay issued as on-demand payment on Oct 9" onChange={(e) => setAck(e.target.value)} /></label>
                </>
              )}
              <div className="row" style={{ marginTop: 8 }}><button className="btn" onClick={approve}>Approve pay run</button><span className="small muted">Calculated by {who(run.calculatedBy)}</span></div>
            </>
          ) : <RoleNote roles={PAYRUN_RULES.approve} action="approve the pay run" />)}
          {run.status === "Approved" && !stale && (has(PAYRUN_RULES.complete) ? <button className="btn" onClick={complete}>Complete pay run</button> : <RoleNote roles={PAYRUN_RULES.complete} action="complete the pay run" />)}
          {run.status === "Completed" && (
            <div className="row">
              <span>Completed and locked. {run.acknowledged && <span className="small muted">Approval note: {run.acknowledged}</span>}</span>
              {has(PAYRUN_RULES.reopen) && <button className="btn ghost" onClick={reopen}>Reopen (demo)</button>}
            </div>
          )}
        </div>
      </Section>
    </>
  );
}
