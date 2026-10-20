// Timesheet alerts that pop up on a schedule, in Pacific time:
//   Hourly workers: enter today's time (once each workday); submit the week (Fridays from 5:00 pm).
//   Managers: approve your team's time (Fridays at 5:00 pm and Mondays at 6:00 am).
// Each alert shows once per occurrence until dismissed. A demo clock lets a
// presenter jump to Friday 5 pm or Monday 6 am without waiting.

import { useEffect, useState } from "react";
import { useData } from "./state.tsx";
import { useErp } from "./erp.tsx";
import { useAccess } from "./access.tsx";
import { persona } from "../lib/erp/types.ts";
import { addDays, dayOfWeek, eachDay, isWeekday, pretty, workweekStart } from "../lib/util/dates.ts";
import type { TimeRow } from "../lib/data/types.ts";

const TZ = "America/Los_Angeles";
const CLOCK_KEY = "neocloud-demo-clock";

/** Demo clock presets: real time, or a moment just after an alert fires (Pacific time). */
export const DEMO_CLOCKS: [string, string][] = [
  ["", "Real time"],
  ["2026-10-23T17:05", "Fri Oct 23, 5:05 pm PT"],
  ["2026-10-26T06:05", "Mon Oct 26, 6:05 am PT"],
  ["2026-10-21T09:00", "Wed Oct 21, 9:00 am PT"],
];

const readClock = () => {
  try {
    return window.localStorage.getItem(CLOCK_KEY) ?? "";
  } catch {
    return "";
  }
};

/** Now in Pacific time as a date and minutes after midnight. */
function pacificNow(override: string): { date: string; minutes: number } {
  if (override) return { date: override.slice(0, 10), minutes: Number(override.slice(11, 13)) * 60 + Number(override.slice(14, 16)) };
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** Most recent occurrence (Pacific date) of a weekly time: day of week 0 = Sunday. */
function lastOccurrence(now: { date: string; minutes: number }, dow: number, minutes: number): string {
  let back = (dayOfWeek(now.date) - dow + 7) % 7;
  if (back === 0 && now.minutes < minutes) back = 7;
  return addDays(now.date, -back);
}

interface Alert {
  id: string;
  title: string;
  body: string;
  action: string;
  href: string;
}

export function DemoClock() {
  const [clock, setClock] = useState(readClock);
  return (
    <label className="side-select" style={{ marginTop: 8 }}>
      <span>Demo clock (alerts)</span>
      <select value={clock} onChange={(e) => { try { window.localStorage.setItem(CLOCK_KEY, e.target.value); } catch { /* storage unavailable */ } setClock(e.target.value); window.dispatchEvent(new Event("demo-clock")); }}>
        {DEMO_CLOCKS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

export function ScheduledAlerts() {
  const { data } = useData();
  const { erp, me, markSeen } = useErp();
  const access = useAccess();
  const [clock, setClock] = useState(readClock);
  const [, tick] = useState(0);
  // Snoozed alerts last for this browser session (Remind me later).
  const [later, setLater] = useState<string[]>(() => { try { return JSON.parse(window.sessionStorage.getItem("neocloud-alerts-later") ?? "[]"); } catch { return []; } });
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 60_000);
    const onClock = () => setClock(readClock());
    window.addEventListener("demo-clock", onClock);
    return () => { window.clearInterval(t); window.removeEventListener("demo-clock", onClock); };
  }, []);
  if (!data) return null;
  const ds = data.dsNow;
  const now = pacificNow(clock);
  const w = ds.workers.find((x) => x.id === me.workerId);
  const alerts: Alert[] = [];

  const hasTime = (id: string, d: string) =>
    ds.time.some((t) => t.employeeId === id && t.workDate === d && !t.deleted) ||
    ds.absences.some((a) => a.employeeId === id && a.date === d) ||
    erp.bps.some((b) => b.type === "Enter Time" && b.subjectId === id && b.status === "Awaiting Approval" && (b.payload.rows as TimeRow[]).some((r) => r.workDate === d));

  if (w && w.payType === "Hourly" && w.country === "USA" && !w.terminationDate) {
    const drafts = (erp.drafts?.[w.id] ?? []) as unknown as TimeRow[];
    // Daily: on a workday, enter today's time.
    if (isWeekday(now.date) && now.date >= w.hireDate && !hasTime(w.id, now.date) && !drafts.some((r) => r.workDate === now.date)) {
      alerts.push({ id: `alert:daily:${now.date}`, title: "Enter your time for today", body: `Add today's hours (${pretty(now.date)}) to your timesheet. Enter time daily, then submit the week on Friday.`, action: "Enter time", href: `/time-entry?week=${workweekStart(now.date)}` });
    }
    // Weekly: from Friday 5:00 pm PT, submit the week.
    const fri = lastOccurrence(now, 5, 17 * 60);
    const ws = workweekStart(fri);
    const workdays = eachDay(ws, fri).filter((d) => isWeekday(d) && d >= w.hireDate);
    const missing = workdays.filter((d) => !hasTime(w.id, d));
    const unsent = drafts.filter((r) => r.workDate >= ws && r.workDate <= addDays(ws, 6)).length;
    if (missing.length || unsent) {
      alerts.push({ id: `alert:weekly:${fri}`, title: "Submit your timesheet for the week", body: `${fri === now.date ? "It's Friday 5:00 pm PT: submit" : `Overdue since ${pretty(fri)}, 5:00 pm PT: submit`} your time for the week of ${pretty(ws)}.${unsent ? ` ${unsent} day(s) are filled in but not submitted.` : ""}${missing.length ? ` ${missing.length} workday(s) have no time yet.` : ""}`, action: "Open timesheet", href: `/time-entry?week=${ws}` });
    }
  }

  if (me.role === "Manager") {
    // Fridays 5:00 pm and Mondays 6:00 am PT: approve the team's time.
    const fri = lastOccurrence(now, 5, 17 * 60);
    const mon = lastOccurrence(now, 1, 6 * 60);
    const latest = fri > mon ? { at: fri, label: "Friday 5:00 pm PT" } : { at: mon, label: "Monday 6:00 am PT" };
    const waiting = erp.bps.filter((b) => b.type === "Enter Time" && b.status === "Awaiting Approval" && b.initiatedBy !== me.id && access.seesBp(b));
    const ws = workweekStart(latest.label.startsWith("Monday") ? addDays(latest.at, -3) : latest.at);
    const team = ds.workers.filter((x) => x.managerId === me.workerId || access.seesDetails(x.id)).filter((x) => x.id !== me.workerId && x.payType === "Hourly" && x.country === "USA" && !x.terminationDate);
    const notIn = team.filter((x) => eachDay(addDays(ws, 1), addDays(ws, 5)).some((d) => d <= now.date && d >= x.hireDate && !hasTime(x.id, d)));
    if (waiting.length || notIn.length) {
      alerts.push({
        id: `alert:approve:${latest.at}:${latest.label.slice(0, 3)}`,
        title: "Approve your team's time",
        body: `${latest.label}: ${[waiting.length ? `${waiting.length} timesheet(s) waiting for your approval` : "", notIn.length ? `${notIn.length} hourly worker(s) in your team still have missing time for the week of ${pretty(ws)}` : ""].filter(Boolean).join("; ")}. ${waiting.length ? "Approve time so payroll can pay it." : "Remind them to submit, or enter it for them in Team Timesheets."}`,
        action: waiting.length ? "Open inbox" : "Team Timesheets",
        href: waiting.length ? `/inbox?bp=${waiting[0].id}` : `/team-time?week=${ws}`,
      });
    }
  }

  // SOX: payroll is told about every payroll input someone else entered, before other reminders.
  if (access.payResults) {
    for (const b of erp.bps.filter((x) => x.type === "Payroll Input" && x.initiatedBy !== me.id)) {
      const by = persona(b.initiatedBy);
      alerts.unshift({ id: `sox:${b.id}`, title: "SOX alert: payroll input entered", body: `${by.name} (${by.role}) entered a payroll input for ${b.subjectName} (${b.subjectId}) on ${new Date(b.initiatedAt).toLocaleString()}: ${b.summary} Status: ${b.status.toLowerCase()}.`, action: b.status === "Awaiting Approval" ? "Review and approve" : "View payroll inputs", href: b.status === "Awaiting Approval" ? `/inbox?bp=${b.id}` : "/inputs" });
    }
  }
  const seen = new Set(erp.seen?.[me.id] ?? []);
  // No pop-up on the page the reminder points to: the person is already doing it.
  const page = window.location.hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  const onTarget = (a: Alert) => a.href.replace(/^\//, "").split(/[/?]/)[0] === page;
  const show = alerts.find((a) => !seen.has(a.id) && !later.includes(a.id) && !onTarget(a));
  if (!show) return null;
  const close = (dismiss: boolean) => {
    if (dismiss) return markSeen([show.id]);
    // Remind me later: snooze every reminder that is due now, not just this one.
    const next = [...new Set([...later, ...alerts.map((a) => a.id)])];
    try { window.sessionStorage.setItem("neocloud-alerts-later", JSON.stringify(next)); } catch { /* storage unavailable */ }
    setLater(next);
  };
  return (
    <div className="alert-backdrop" role="dialog" aria-modal="true" aria-labelledby="alert-title">
      <div className="alert-box">
        <p className="small muted" style={{ margin: 0 }}>{show.id.startsWith("sox:") ? "Audit alert" : "Reminder"}</p>
        <h2 id="alert-title">{show.title}</h2>
        <p>{show.body}</p>
        <div className="row">
          <button className="btn" onClick={() => { close(true); window.location.hash = show.href; }}>{show.action}</button>
          <button className="btn ghost" onClick={() => close(false)}>Remind me later</button>
          <button className="btn ghost" onClick={() => close(true)}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}
