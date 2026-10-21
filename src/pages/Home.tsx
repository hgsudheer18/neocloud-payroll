import { useData } from "../state.tsx";
import { useErp } from "../erp.tsx";
import { MaskedMoney, Money, PageHead, Pill, Section } from "../ui.tsx";
import { today } from "../erpui.tsx";
import { reportingLine, useAccess } from "../access.tsx";
import { useNotifications } from "../notifications.tsx";
import { OPEN_POSITIONS } from "../../lib/config/org.ts";
import { PLAN } from "../../lib/config/absencePlans.ts";
import { PERIOD_LABEL, US_PERIOD, US_PERIODS } from "../../lib/config/period.ts";
import { addDays, eachDay, isWeekday, pretty, workweekStart } from "../../lib/util/dates.ts";
import type { TimeRow } from "../../lib/data/types.ts";

/** What matters today, by role: pay and time off for everyone, approvals and the team for managers, the pay run for payroll. */
export default function Home() {
  const { data } = useData();
  const { erp, me, periodId, setPeriod } = useErp();
  const access = useAccess();
  const { notes, unread } = useNotifications();
  const ds = data!.dsNow;
  const r = data!.result;
  const w = ds.workers.find((x) => x.id === me.workerId);
  const now = today();
  const weekStart = workweekStart(now);
  const weekEnd = addDays(weekStart, 6);
  const hourly = w?.payType === "Hourly" && w.country === "USA";
  const myPeriods = w?.country === "USA" ? US_PERIODS.filter((p) => p.id === US_PERIOD.id || (hourly ? p.payGroup === "US Biweekly" : p.payGroup === "US Semi-Monthly")) : [];
  const nextPay = myPeriods.find((p) => p.checkDate >= now);
  const lastPaid = [...myPeriods].reverse().find((p) => erp.payRuns[p.id]?.status === "Completed");
  const myCalc = r.us.find((c) => c.worker.id === w?.id);
  const balances = [...r.us, ...r.intl].find((c) => c.worker.id === w?.id)?.absence.filter((a) => a.tracked) ?? [];
  const myTimeOff = w ? ds.absences.filter((a) => a.employeeId === w.id && a.date >= now && a.date <= addDays(now, 30)).sort((a, b) => (a.date < b.date ? -1 : 1)) : [];
  // Approvals stay "waiting" until decided, read or not; other notifications only until read.
  const toApprove = notes.filter((n) => n.id.startsWith("wait:")).length;

  // Managers: who is off this week, and timesheets not submitted.
  const team = me.role === "Manager" && me.workerId ? [...reportingLine(ds, me.workerId)].filter((id) => id !== me.workerId && ds.workers.some((x) => x.id === id && !x.terminationDate)) : [];
  const directs = me.role === "Manager" ? ds.workers.filter((x) => x.managerId === me.workerId && !x.terminationDate) : [];
  const offThisWeek = ds.absences.filter((a) => team.includes(a.employeeId) && a.date >= weekStart && a.date <= weekEnd).sort((a, b) => (a.date < b.date ? -1 : 1));
  const name = (id: string) => ds.workers.find((x) => x.id === id)?.name ?? id;
  const lastWeek = addDays(weekStart, -7);
  const timesheetGaps = (ws: string) =>
    team
      .map((id) => ds.workers.find((x) => x.id === id)!)
      .filter((x) => x.payType === "Hourly" && x.country === "USA")
      .filter((x) => {
        const days = eachDay(ws, addDays(ws, 6)).filter((d) => isWeekday(d) && d <= now && d >= x.hireDate);
        return days.some((d) => !ds.time.some((t) => t.employeeId === x.id && t.workDate === d) && !ds.absences.some((a) => a.employeeId === x.id && a.date === d) && !erp.bps.some((b) => b.type === "Enter Time" && b.subjectId === x.id && b.status === "Awaiting Approval" && (b.payload.rows as TimeRow[]).some((row) => row.workDate === d)));
      });
  const missingLast = me.role === "Manager" ? timesheetGaps(lastWeek) : [];

  // Payroll: the selected pay run.
  const run = erp.payRuns[periodId]?.status ?? "Not started";
  const negatives = r.us.filter((c) => c.pay.totals.net < 0);
  const criticals = r.audit.filter((a) => a.severity === "Critical");
  const unapprovedTime = erp.bps.filter((b) => b.status === "Awaiting Approval" && ["Enter Time", "Request Time Off", "Correct Time Off"].includes(b.type) && b.effectiveDate <= r.period.end).length;

  return (
    <>
      <PageHead title={`Hello, ${me.name.split(" ")[0]}`}>{w ? `${w.jobProfile} · ${pretty(now)}` : pretty(now)}</PageHead>

      <div className="cards">
        <div className="card">
          <h3>Waiting on you</h3>
          <div className="big">{toApprove + unread.filter((n) => !n.id.startsWith("wait:")).length}</div>
          {unread.length > 0 ? <ul>{unread.slice(0, 4).map((n) => <li key={n.id}><a href={`#${n.href}`}>{n.text}</a></li>)}</ul> : <p className="small muted">Nothing new.</p>}
        </div>
        {w && w.country === "USA" && (
          <div className="card">
            <h3>Pay</h3>
            {nextPay && <p className="small" style={{ margin: 0 }}>Next pay date</p>}
            {nextPay && <div className="big">{pretty(nextPay.checkDate)}</div>}
            {myCalc && <p className="small">{PERIOD_LABEL[periodId]}: net <strong><MaskedMoney c={myCalc.pay.totals.net} /></strong>{erp.payRuns[periodId]?.status === "Completed" ? "" : " (preview)"}</p>}
            {lastPaid && <p className="small">Last paid: {PERIOD_LABEL[lastPaid.id]}</p>}
            <a href="#/payslip">Open pay slip</a>
          </div>
        )}
        {w && (
          <div className="card">
            <h3>Time off</h3>
            {balances.length ? <ul style={{ paddingLeft: 0, listStyle: "none" }}>{balances.map((a) => <li key={a.plan.code}><strong>{a.ending.toFixed(2)} {a.unit}</strong> {a.plan.name}</li>)}</ul> : <p className="small muted">{w.flsa === "Exempt" ? "Flexible PTO: no balance to track." : "No balances."}</p>}
            {myTimeOff.length > 0 && <p className="small">Coming up: {myTimeOff.slice(0, 3).map((a) => `${pretty(a.date)} (${PLAN[a.plan]?.name ?? a.plan})`).join(", ")}</p>}
            <a href="#/time-off">Request time off</a>
          </div>
        )}
        {hourly && (
          <div className="card">
            <h3>Timesheet</h3>
            <p className="small" style={{ margin: 0 }}>Week of {pretty(weekStart)}</p>
            <div className="big">{(erp.drafts?.[w!.id] ?? []).length ? "Draft" : "Open"}</div>
            <a href={`#/time-entry?week=${weekStart}`}>Enter time</a>
          </div>
        )}
      </div>

      {me.role === "Manager" && (
        <div className="grid2">
          <Section title="Your team" lede={`${directs.length} direct reports; ${team.length} people in your reporting line.`}>
            <h3>Off this week</h3>
            {offThisWeek.length === 0 ? <p className="small muted">Nobody is off this week.</p> : <ul className="small">{offThisWeek.map((a, i) => <li key={i}>{pretty(a.date)}: {name(a.employeeId)}, {PLAN[a.plan]?.name ?? a.plan} {a.quantity} {a.unit}{a.status === "Approved" ? "" : " (awaiting approval)"}</li>)}</ul>}
            <a href="#/time-off?tab=team">Team Time Off</a>
          </Section>
          <Section title="Timesheets" lede={`Hourly workers in your team without time for every workday of the week of ${pretty(lastWeek)}.`}>
            {missingLast.length === 0 ? <p className="small muted">Everyone has submitted.</p> : <ul className="small">{missingLast.slice(0, 12).map((x) => <li key={x.id}><a href={`#/team-time?worker=${x.id}&week=${lastWeek}`}>{x.name}</a> ({x.id})</li>)}{missingLast.length > 12 && <li>and {missingLast.length - 12} more</li>}</ul>}
          </Section>
        </div>
      )}

      {me.role === "HR Partner" && (
        <div className="grid2">
          <Section title="Workforce">
            <dl className="kv">
              <dt>Active employees</dt><dd>{ds.workers.filter((x) => x.workerType === "Employee" && !x.terminationDate).length}</dd>
              <dt>Contingent workers</dt><dd>{ds.workers.filter((x) => x.workerType === "Contractor").length}</dd>
              <dt>Open positions</dt><dd><a href="#/positions">8 to hire (4 hourly, 4 salaried)</a>; leadership: {OPEN_POSITIONS.map((p) => p.title).join(", ")}</dd>
            </dl>
            <div className="row"><a href="#/workers/new">Hire a worker</a><a href="#/organisation">Organisation</a></div>
          </Section>
          <Section title="Approvals">
            <p className="small">{toApprove} item(s) waiting for HR. <a href="#/inbox">Open the inbox</a></p>
          </Section>
        </div>
      )}

      {access.payResults && (
        <Section title={`Pay run: ${PERIOD_LABEL[periodId]}`} lede={`Paid ${pretty(r.period.checkDate)}. Change the pay period at the top right.`}>
          <div className="cards">
            <div className="card"><h3>Status</h3><div className="big">{negatives.length && run !== "Completed" ? <Pill tone="bad">Error</Pill> : run}</div><a href="#/payruns">Pay runs</a></div>
            <div className="card"><h3>Workers and gross</h3><div className="big">{r.us.length}</div><p className="small"><Money c={r.totals.gross} /> gross, <Money c={r.totals.net} /> net</p></div>
            <div className="card"><h3>To fix before approval</h3><div className="big">{negatives.length + criticals.length}</div><p className="small">{negatives.length} negative net pay; {criticals.length} critical audit item(s); controls {r.ties.every((t) => t.ok) ? "tie" : "do not tie"}</p><a href="#/controls">Audit findings</a></div>
            <div className="card"><h3>Time not yet approved</h3><div className="big">{unapprovedTime}</div><p className="small">Time and time off for this period still awaiting approval are not paid.</p><a href="#/inbox?tab=all">All awaiting approval</a></div>
          </div>
          <div className="row">{US_PERIODS.map((p) => <button key={p.id} className={`btn ${p.id === periodId ? "" : "ghost"}`} onClick={() => setPeriod(p.id)}>{PERIOD_LABEL[p.id]}: {erp.payRuns[p.id]?.status ?? "Not started"}</button>)}</div>
        </Section>
      )}
    </>
  );
}
