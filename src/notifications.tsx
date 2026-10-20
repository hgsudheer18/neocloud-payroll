// Notifications for the signed-in person, worked out from the business process
// log and pay runs: nothing is sent, so there is nothing to keep in sync.

import { useEffect, useRef, useState } from "react";
import { useData } from "./state.tsx";
import { useErp } from "./erp.tsx";
import { useAccess } from "./access.tsx";
import { today } from "./erpui.tsx";
import { BP_RULES, persona } from "../lib/erp/types.ts";
import { PERIOD_LABEL, US_PERIOD, US_PERIODS } from "../lib/config/period.ts";
import { addDays, eachDay, isWeekday, pretty, workweekStart } from "../lib/util/dates.ts";
import type { TimeRow } from "../lib/data/types.ts";

export interface Note {
  id: string;
  text: string;
  href: string;
  at: string;
  /** Pay period to select when it is opened. */
  period?: string;
}

export function useNotifications(): { notes: Note[]; unread: Note[] } {
  const { data } = useData();
  const { erp, me } = useErp();
  const access = useAccess();
  const notes: Note[] = [];
  const ds = data?.dsNow;
  const w = ds?.workers.find((x) => x.id === me.workerId);

  // Waiting for me to approve.
  for (const b of erp.bps) {
    const r = BP_RULES[b.type].approvers;
    if (b.status === "Awaiting Approval" && r !== "auto" && r.includes(me.role) && b.initiatedBy !== me.id && b.subjectId !== me.workerId && access.seesBp(b)) {
      notes.push({ id: `wait:${b.id}`, text: `${persona(b.initiatedBy).name} is waiting for your approval: ${b.summary}`, href: `/inbox?bp=${b.id}`, at: b.initiatedAt });
    }
  }
  // My requests decided by someone else.
  for (const b of erp.bps) {
    if ((b.initiatedBy === me.id || (me.workerId && b.subjectId === me.workerId)) && b.decidedBy && b.decidedBy !== me.id && b.decidedBy !== "system" && b.status !== "Awaiting Approval") {
      const href = b.type === "Enter Time" ? "/time-entry" : b.type.includes("Time Off") ? "/time-off" : b.type.startsWith("Change") && ["Change Personal Information", "Change Payment Election", "Change Tax Withholding"].includes(b.type) ? "/my-information" : `/workers/${b.subjectId}`;
      notes.push({ id: `done:${b.id}`, text: `${persona(b.decidedBy).name} ${b.status.toLowerCase()} ${b.initiatedBy === me.id ? "your" : "a"} ${b.type === "Enter Time" ? "timesheet" : b.type.replace(/^(Change|Request|Correct) /, "").toLowerCase() + (b.type.startsWith("Change") ? " change" : b.type.startsWith("Correct") ? " correction" : b.type.startsWith("Request") ? " request" : "")}: ${b.summary}`, href, at: b.decidedAt ?? b.initiatedAt });
    }
  }
  if (w && w.country === "USA") {
    // Pay slips for completed pay runs in my pay group.
    const hourly = w.payType === "Hourly";
    for (const p of US_PERIODS.filter((x) => x.id === US_PERIOD.id || (hourly ? x.payGroup === "US Biweekly" : x.payGroup === "US Semi-Monthly"))) {
      const run = erp.payRuns[p.id];
      if (run?.status === "Completed") notes.push({ id: `pay:${p.id}`, text: `Your pay slip for ${PERIOD_LABEL[p.id]} is available (paid ${pretty(p.checkDate)}).`, href: "/payslip", at: run.completedAt ?? "", period: p.id });
    }
    // Timesheet not submitted for last week or this week.
    if (hourly) {
      const now = today();
      for (const ws of [addDays(workweekStart(now), -7), workweekStart(now)]) {
        const work = eachDay(ws, addDays(ws, 6)).filter((d) => isWeekday(d) && d <= now && d >= w.hireDate);
        if (!work.length) continue;
        const has = (d: string) =>
          ds!.time.some((t) => t.employeeId === w.id && t.workDate === d) ||
          ds!.absences.some((a) => a.employeeId === w.id && a.date === d) ||
          erp.bps.some((b) => b.type === "Enter Time" && b.subjectId === w.id && b.status === "Awaiting Approval" && (b.payload.rows as TimeRow[]).some((r) => r.workDate === d));
        const missing = work.filter((d) => !has(d));
        if (missing.length) notes.push({ id: `ts:${ws}:${missing.length}`, text: `Submit your timesheet for the week of ${pretty(ws)}: ${missing.length} workday(s) without time.`, href: `/time-entry?week=${ws}`, at: `${ws}T00:00:00Z` });
      }
    }
  }
  // SOX: every payroll input entered by someone else (same id as the pop-up, so reading one reads both).
  if (access.payResults) {
    for (const b of erp.bps.filter((x) => x.type === "Payroll Input" && x.initiatedBy !== me.id)) {
      notes.push({ id: `sox:${b.id}`, text: `SOX alert: ${persona(b.initiatedBy).name} entered a payroll input for ${b.subjectName}: ${b.summary}`, href: b.status === "Awaiting Approval" ? `/inbox?bp=${b.id}` : "/inputs", at: b.initiatedAt });
    }
  }
  // Payroll: completed pay runs not yet posted to NetSuite.
  if (access.payResults) {
    for (const p of US_PERIODS) {
      const run = erp.payRuns[p.id];
      if (run?.status === "Completed" && !run.posted) notes.push({ id: `post:${p.id}`, text: `${PERIOD_LABEL[p.id]} is completed: post the journals to NetSuite.`, href: "/gl", at: run.completedAt ?? "", period: p.id });
    }
  }
  notes.sort((a, b) => (a.at < b.at ? 1 : -1));
  const seen = new Set(erp.seen?.[me.id] ?? []);
  return { notes, unread: notes.filter((n) => !seen.has(n.id)) };
}

/** Bell with a count of unread notifications; opens a list that links to each item. */
export function Bell() {
  const { notes, unread } = useNotifications();
  const { markSeen, setPeriod } = useErp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const unreadIds = new Set(unread.map((n) => n.id));
  const go = (n: Note) => {
    markSeen([n.id]);
    if (n.period) setPeriod(n.period);
    window.location.hash = n.href;
    setOpen(false);
  };
  return (
    <div className="bell" ref={ref}>
      <button className="bell-button" aria-label={`Notifications: ${unread.length} unread`} onClick={() => setOpen(!open)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        {unread.length > 0 && <span className="badge">{unread.length}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <strong>Notifications</strong>
            {unread.length > 0 && <button className="close" onClick={() => markSeen(unread.map((n) => n.id))}>Mark all read</button>}
          </div>
          {notes.length === 0 ? <p className="small muted">Nothing new.</p> : (
            <ul className="bell-list">
              {notes.slice(0, 20).map((n) => (
                <li key={n.id} className={unreadIds.has(n.id) ? "unread" : ""}><button onClick={() => go(n)}>{n.text}</button></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
