import { useState } from "react";
import { useData } from "../state.tsx";
import { useErp } from "../erp.tsx";
import { setQuery } from "../router.tsx";
import { PageHead, Pill, Section, Select } from "../ui.tsx";
import { ApproverJump, BpStatus, CanInitiate, Toast, today } from "../erpui.tsx";
import { useAccess } from "../access.tsx";
import { validateTimeEntry } from "../../lib/erp/validate.ts";
import { buildShift, calcWorkerTime } from "../../lib/engine/time.ts";
import { ruleForState, SHIFTS, CROSSING_SHIFTS_PAID_NEXT_FROM } from "../../lib/config/timeRules.ts";
import { NIGHT_DIFF_PER_HOUR } from "../../lib/config/payComponents.ts";
import { PERIOD_LABEL, US_PERIODS } from "../../lib/config/period.ts";
import { addDays, eachDay, isWeekday, minutesToHHMM, normalizeTime, pretty, workweekStart } from "../../lib/util/dates.ts";
import type { TimeRow, Worker } from "../../lib/data/types.ts";
import type { BusinessProcess } from "../../lib/erp/types.ts";

export const RANGES: [string, string, string][] = [
  ["2026-10-01|2026-10-15", "Oct 1–15 (parallel run)", "2026-10-01"],
  ["2026-10-16|2026-10-31", "Oct 16–31 (biweekly transition)", "2026-10-16"],
  ["2026-11-01|2026-11-14", "Nov 1–14 (biweekly)", "2026-11-01"],
];

const SCHEDULE = { Day: SHIFTS.Day.schedule, Night: SHIFTS.Night.schedule };

/** Workweeks (Sunday to Saturday) covering the demo's pay periods. */
const WEEKS = eachDay("2026-09-27", "2026-11-08").filter((d) => d === workweekStart(d));
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const FIELDS: [keyof TimeRow, string, string][] = [["timeIn", "Clock in", "08:00"], ["mealStart", "Meal start", "12:00"], ["mealEnd", "Meal end", "12:30"], ["timeOut", "Clock out", "16:30"]];
const filled = (r?: Partial<TimeRow>) => !!r && HHMM.test(r.timeIn ?? "") && HHMM.test(r.timeOut ?? "");
const worked = (r?: Partial<TimeRow>) => (filled(r) ? buildShift({ mealStart: "", mealEnd: "", ...r } as TimeRow).worked / 60 : 0);
const h2 = (min: number) => (min / 60).toFixed(2);

/**
 * Meal period check for a day. California (Labor Code 512): a shift over 5 hours needs
 * a 30-minute meal that starts before the end of the 5th hour, or a premium is paid.
 * Elsewhere a missing meal on a shift over 5 hours is flagged against company policy.
 */
export function mealCheck(r: Partial<TimeRow> | undefined, state: string): { due?: string; problem?: string; soft?: string } {
  if (!r || !HHMM.test(r.timeIn ?? "")) return {};
  const ca = ruleForState(state).mealPremium;
  const start = Number(r.timeIn!.slice(0, 2)) * 60 + Number(r.timeIn!.slice(3));
  const due = minutesToHHMM(start + 300);
  if (!filled(r)) return ca ? { due } : {};
  const s = buildShift({ mealStart: "", mealEnd: "", ...r } as TimeRow);
  if (s.worked <= 300) return ca ? { due } : {};
  if (!ca) return s.mealStart === null ? { soft: "No meal recorded on a shift over 5 hours" } : {};
  if (s.mealStart === null) return { due, problem: `No meal break: one is required by ${due}` };
  if (s.mealStart - s.start > 300) return { due, problem: `Meal started after ${due} (end of the 5th hour)` };
  if ((s.mealEnd as number) - s.mealStart < 30) return { due, problem: "Meal break shorter than 30 minutes" };
  return { due };
}
/** Keep the old name for the CA-only check. */
export const caMeal = (r: Partial<TimeRow> | undefined, state: string) => (state === "CA" ? mealCheck(r, state) : {});

/** The go-live pay period a date is paid in, for hourly workers. */
const hourlyPeriodOf = (d: string) => US_PERIODS.find((p) => p.payGroup === "US Biweekly" && p.start <= d && d <= p.end);

/**
 * Weekly timesheet. Employees: fill in the week, saved as a draft as they type, then
 * submit it for the manager to approve. Managers (Team Timesheets): pick someone in
 * their team, see soft warnings for anything irregular, and edit or delete time for
 * current and past periods; a manager's edit is approved on entry and paid as retro
 * when the period was already paid.
 */
export default function TimeEntry({ query, manager = false }: { query: URLSearchParams; manager?: boolean }) {
  const { data } = useData();
  const { erp, me, submit, nextSeq, setDrafts } = useErp();
  const access = useAccess();
  const ds = data!.dsNow;
  const team = manager ? ds.workers.filter((x) => x.payType === "Hourly" && x.country === "USA" && !x.terminationDate && x.id !== me.workerId && access.seesDetails(x.id)) : [];
  const w: Worker | undefined = manager ? team.find((x) => x.id === query.get("worker")) ?? team[0] : ds.workers.find((x) => x.id === me.workerId);
  const now = today();
  const week = WEEKS.includes(query.get("week") ?? "") ? query.get("week")! : WEEKS.find((x) => x <= now && now <= addDays(x, 6)) ?? "2026-10-11";
  const days = eachDay(week, addDays(week, 6));
  const tab = query.get("tab") === "summary" ? "summary" : "sheet";
  const path = manager ? "/team-time" : "/time-entry";
  const nav = (k: string, v: string) => setQuery(path, { worker: manager ? w?.id ?? "" : "", week, tab, [k]: v });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [msg, setMsg] = useState("");
  const [lastBp, setLastBp] = useState("");
  if (!w) return <div className="callout info">{manager ? "There are no hourly workers in your team." : "Time entry is for hourly workers."}</div>;

  const schedule = SCHEDULE[(w.shift as "Day" | "Night") || "Day"];
  const draftKey = manager ? `${me.id}:${w.id}` : w.id;
  const drafts = (erp.drafts?.[draftKey] ?? []) as unknown as TimeRow[];
  const draftFor = (d: string) => drafts.find((r) => r.workDate === d);
  const approved = (d: string) => {
    const rows = ds.time.filter((t) => t.employeeId === w.id && t.workDate === d);
    const replaced = new Set(rows.filter((r) => r.entryType === "Correction").map((r) => r.correctsRowId));
    return rows.filter((r) => !replaced.has(r.rowId) && !r.deleted);
  };
  const pendingBp = (d: string) => erp.bps.find((b) => b.type === "Enter Time" && b.subjectId === w.id && b.status === "Awaiting Approval" && (b.payload.rows as TimeRow[]).some((r) => r.workDate === d));
  const pendingRow = (d: string) => (pendingBp(d)?.payload.rows as TimeRow[] | undefined)?.find((r) => r.workDate === d);
  const timeOff = (d: string) => ds.absences.filter((a) => a.employeeId === w.id && a.date === d);
  const shown = (d: string) => draftFor(d) ?? pendingRow(d) ?? approved(d)[0];

  const save = (rows: TimeRow[]) => setDrafts(draftKey, rows as unknown as Record<string, unknown>[]);
  const edit = (d: string, field: keyof TimeRow, value: string) => {
    const cur = draftFor(d) ?? ({ workDate: d, rowId: `W${String(nextSeq()).padStart(5, "0")}`, shift: w.shift || "Day", notes: "" } as TimeRow);
    const next = { ...cur, [field]: value } as TimeRow;
    const empty = !next.timeIn && !next.timeOut && !next.mealStart && !next.mealEnd && !next.correctsRowId;
    save([...drafts.filter((r) => r.workDate !== d), ...(empty ? [] : [next])]);
    setErrors({ ...errors, [d]: [] });
  };
  const fillSchedule = () => {
    const add = days.filter((d) => isWeekday(d) && !draftFor(d) && !approved(d).length && !pendingRow(d) && !timeOff(d).length);
    save([...drafts, ...add.map((d) => ({ workDate: d, rowId: `W${String(nextSeq()).padStart(5, "0")}`, shift: w.shift || "Day", notes: "", ...schedule }) as TimeRow)]);
  };
  const correct = (d: string) => {
    const r = approved(d)[0];
    save([...drafts.filter((x) => x.workDate !== d), { ...r, rowId: `W${String(nextSeq()).padStart(5, "0")}`, correctsRowId: r.rowId, entryType: "Correction", notes: "", source: undefined } as TimeRow]);
  };
  const clear = (d: string) => save(drafts.filter((r) => r.workDate !== d));
  const remove = (d: string) => {
    const r = approved(d)[0];
    if (!window.confirm(`Delete ${w.name}'s time on ${pretty(d)} (${r.timeIn}–${r.timeOut})? If that day was already paid, the amount is recovered as retro.`)) return;
    const bp = submit({ type: "Enter Time", subjectId: w.id, subjectName: w.name, effectiveDate: d, summary: `Delete time on ${pretty(d)} (${r.timeIn}–${r.timeOut}, ${worked(r).toFixed(2)} hrs)`, payload: { rows: [{ ...r, rowId: `W${String(nextSeq()).padStart(5, "0")}`, correctsRowId: r.rowId, deleted: true, notes: "Deleted by manager" }] }, approvedAs: "Deleted by the worker's manager" });
    setLastBp(bp.id);
    setMsg(`${bp.id}: time on ${pretty(d)} deleted.`);
  };

  const weekRows = days.map(draftFor).filter((r): r is TimeRow => !!r && (filled(r) || !!r.correctsRowId));
  const check = () => {
    const errs: Record<string, string[]> = {};
    const warns: string[] = [];
    for (const r of weekRows) {
      // The rest of this week's entries count as entered, so overlaps between days are caught.
      const others: BusinessProcess = { id: "week", type: "Enter Time", subjectId: w.id, subjectName: w.name, summary: "", effectiveDate: week, payload: { rows: weekRows.filter((x) => x !== r) }, status: "Awaiting Approval", initiatedBy: me.id, initiatedAt: "" };
      const c = validateTimeEntry(ds, [...erp.bps, others], w, r);
      if (c.errors.length) errs[r.workDate] = c.errors;
      warns.push(...c.warnings.map((x) => `${pretty(r.workDate)}: ${x}`));
    }
    setErrors(errs);
    return { ok: Object.keys(errs).length === 0, warns };
  };
  const submitWeek = () => {
    if (!weekRows.length) return setMsg("Nothing to submit: fill in at least one day.");
    const { ok, warns } = check();
    if (!ok) return setMsg("Fix the days marked below, then submit again.");
    const total = weekRows.reduce((s, r) => s + worked(r), 0);
    const fixes = weekRows.filter((r) => r.correctsRowId).length;
    const what = manager ? `Manager edit of ${w.name}'s time, week of ${pretty(week)}` : `Timesheet, week of ${pretty(week)}`;
    const bp = submit({ type: "Enter Time", subjectId: w.id, subjectName: w.name, effectiveDate: weekRows[0].workDate, summary: `${what}: ${weekRows.length} day(s), ${total.toFixed(2)} hrs${fixes ? ` (${fixes} correction${fixes > 1 ? "s" : ""})` : ""}`, payload: { rows: weekRows }, warnings: warns, ...(manager ? { approvedAs: "Entered by the worker's manager" } : {}) });
    save(drafts.filter((r) => !days.includes(r.workDate)));
    setLastBp(bp.id);
    setMsg(manager ? `${bp.id}: saved and approved. Days in a paid period are paid as retro.` : `${bp.id}: week of ${pretty(week)} submitted for manager approval.`);
  };

  // Week summary: approved, pending and draft time through the time engine for this workweek.
  const summaryRows: TimeRow[] = [
    ...ds.time.filter((t) => t.employeeId === w.id),
    ...erp.bps.filter((b) => b.type === "Enter Time" && b.subjectId === w.id && b.status === "Awaiting Approval").flatMap((b) => b.payload.rows as TimeRow[]),
    ...weekRows,
  ].map((r) => ({ ...r, employeeId: w.id, mealStart: (r as Partial<TimeRow>).mealStart || "", mealEnd: (r as Partial<TimeRow>).mealEnd || "", entryType: r.correctsRowId ? "Correction" : "Original", correctsRowId: r.correctsRowId ?? "", enteredOn: r.enteredOn ?? week, notes: r.notes ?? "", shift: r.shift || w.shift || "Day" }) as TimeRow);
  const sum = calcWorkerTime(w.id, summaryRows, w.workState, w.hourlyRate, week, addDays(week, 6));
  const c = sum.catsInPeriod;
  const rule = ruleForState(w.workState);

  // Soft warnings: anything irregular this week, for the employee and their manager.
  const irregular: string[] = [];
  for (const d of days) {
    const r = shown(d);
    if (r && filled(r)) {
      const others: BusinessProcess = { id: "x", type: "Enter Time", subjectId: w.id, subjectName: w.name, summary: "", effectiveDate: week, payload: { rows: [] }, status: "Approved", initiatedBy: me.id, initiatedAt: "" };
      for (const x of validateTimeEntry(ds, [others], w, { ...r, correctsRowId: r.correctsRowId || r.rowId }).warnings) irregular.push(`${pretty(d)}: ${x}`);
      const s = buildShift(r);
      const p = hourlyPeriodOf(d);
      if (s.end > 1440 && p && d === p.end && d >= CROSSING_SHIFTS_PAID_NEXT_FROM) irregular.push(`${pretty(d)}: shift crosses into the next pay period, so it is paid in the next period.`);
    } else if (isWeekday(d) && d <= now && d >= w.hireDate && !timeOff(d).length) {
      irregular.push(`${pretty(d)}: no time entered for a workday.`);
    }
  }
  for (const e of sum.exceptions.filter((x) => x.code === "SEVENTH_DAY" || x.code === "OVERLAPPING_BLOCKS")) irregular.push(`${pretty(e.date)}: ${e.message}`);

  const weekTotal = days.reduce((s, d) => s + worked(shown(d)), 0);
  const editable = (d: string) => !!draftFor(d) || (!pendingRow(d) && !approved(d).length);
  const cell = (d: string, field: keyof TimeRow, placeholder: string) => {
    if (!editable(d)) return <span>{(shown(d)?.[field] as string) || "—"}</span>;
    const value = (draftFor(d)?.[field] as string) ?? "";
    const bad = value !== "" && !HHMM.test(value);
    return (
      <input
        type="text"
        className={`grid-input${bad ? " bad" : ""}`}
        placeholder={placeholder}
        value={value}
        onChange={(e) => edit(d, field, e.target.value)}
        onBlur={(e) => { const t = normalizeTime(e.target.value); if (t !== e.target.value) edit(d, field, t); }}
        title={bad ? "Enter a time such as 18:30, 18.30, 1830 or 6:30pm" : undefined}
        aria-label={`${field} ${d}`}
        aria-invalid={bad || undefined}
      />
    );
  };
  const shiftDef = SHIFTS[(w.shift as "Day" | "Night") || "Day"];

  return (
    <>
      <PageHead title={manager ? "Team Timesheets" : "Enter time"}>
        {manager
          ? "Review your team's time week by week. Irregularities are shown as soft warnings. You can edit or delete time for the current and past pay periods: your changes are approved on entry, and anything in a paid period is paid or recovered as retro."
          : "Fill in your week, Sunday to Saturday. It is saved as a draft as you type; submit the week when it is complete and your manager approves it in one go. Payroll pays approved time only."}
      </PageHead>
      <div className="filters">
        {manager ? (
          <Select label="Worker" value={w.id} onChange={(v) => nav("worker", v)} options={team.map((x) => [x.id, `${x.id} ${x.name} (${x.workState}, ${x.shift || "Day"})`])} all={null} />
        ) : (
          <div><strong>{w.id} {w.name}</strong><div className="small muted">{w.shift || "Day"} shift</div></div>
        )}
        <Select label="Week" value={week} onChange={(v) => nav("week", v)} options={WEEKS.map((x) => [x, `Week of ${pretty(x)}`])} all={null} />
        <div className="small muted" style={{ maxWidth: 320 }}>{rule.label}: {rule.code === "FLSA" ? "weekly overtime over 40 hours" : `${rule.dailyOtAfter ? `daily OT over ${rule.dailyOtAfter / 60} hrs` : ""}${rule.dailyDtAfter ? `, double time over ${rule.dailyDtAfter / 60}` : ""}${rule.seventhDay ? ", 7th-day rule" : ""}, weekly OT over 40`}. {shiftDef.name} shift {shiftDef.window[0]}–{shiftDef.window[1]}; workday starts at {shiftDef.dayBreaker === "00:00" ? "midnight" : "noon"}.</div>
        <span className="spacer" />
        <button className="btn ghost" onClick={fillSchedule}>Fill in {manager ? "the" : "my"} schedule</button>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "sheet"} onClick={() => nav("tab", "sheet")}>Timesheet</button>
        <button role="tab" aria-selected={tab === "summary"} onClick={() => nav("tab", "summary")}>Week summary</button>
      </div>
      <Toast text={msg} tone="info" />
      {msg && <ApproverJump bp={erp.bps.find((b) => b.id === lastBp)} />}
      {irregular.length > 0 && (
        <div className="callout" style={{ marginBottom: 12 }}>
          <strong>{irregular.length} thing(s) to check this week</strong> <span className="small muted">(soft warnings: they do not block submission or approval)</span>
          <ul className="small" style={{ margin: "6px 0 0" }}>{irregular.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}

      {tab === "summary" ? (
        <Section title={`Week of ${pretty(week)}: summary`} lede="Approved, waiting and draft time, calculated by the time engine with the rules for this work location. Hours in hours and minutes as decimals.">
          <div className="table-wrap">
            <table className="reg">
              <thead><tr><th>Category</th><th className="n">Hours</th><th>How it is paid</th></tr></thead>
              <tbody>
                <tr><td>Regular</td><td className="n">{h2(c.REG)}</td><td className="small">Base rate ${w.hourlyRate.toFixed(2)}</td></tr>
                <tr><td>Daily overtime</td><td className="n">{h2(c.OT_DAILY)}</td><td className="small">{rule.dailyOtAfter ? `Over ${rule.dailyOtAfter / 60} hours in a workday, 1.5x` : "No daily overtime in this state"}</td></tr>
                <tr><td>Weekly overtime</td><td className="n">{h2(c.OT_WEEKLY)}</td><td className="small">Regular hours over 40 in the workweek, 1.5x</td></tr>
                <tr><td>Double time</td><td className="n">{h2(c.DT_DAILY)}</td><td className="small">{rule.dailyDtAfter ? `Over ${rule.dailyDtAfter / 60} hours in a workday, 2x` : "No daily double time in this state"}</td></tr>
                <tr><td>7th consecutive day: overtime</td><td className="n">{h2(c.SEVENTH_OT)}</td><td className="small">{rule.seventhDay ? "First 8 hours on the 7th day worked in the workweek, 1.5x" : "No 7th-day rule in this state"}</td></tr>
                <tr><td>7th consecutive day: double time</td><td className="n">{h2(c.SEVENTH_DT)}</td><td className="small">{rule.seventhDay ? "Over 8 hours on the 7th day, 2x" : "—"}</td></tr>
                <tr><td>Night shift differential</td><td className="n">{h2(c.NIGHT)}</td><td className="small">Hours worked 22:00–06:00, +${NIGHT_DIFF_PER_HOUR.toFixed(2)}/hr = ${((c.NIGHT / 60) * NIGHT_DIFF_PER_HOUR).toFixed(2)}</td></tr>
                <tr><td>Meal premiums</td><td className="n">{c.MEAL_PEN}</td><td className="small">{rule.mealPremium ? "1 hour at the regular rate per workday with a missed, late or short meal" : "No meal premium in this state"}</td></tr>
                <tr><td><strong>Total worked</strong></td><td className="n"><strong>{sum.hoursWorkedInPeriod.toFixed(2)}</strong></td><td className="small">Excludes time off and meal breaks</td></tr>
              </tbody>
            </table>
          </div>
          <p className="small muted">A shift belongs to the workday it starts on: day shifts break at midnight, night shifts at noon. From go-live, a shift crossing from the last day of a pay period into the next is paid in the next period.</p>
        </Section>
      ) : (
        <Section title={`Week of ${pretty(week)}`} lede={`${weekTotal.toFixed(2)} hours this week${weekRows.length ? `; ${weekRows.length} day(s) not yet ${manager ? "saved" : "submitted"}` : ""}.`}>
          <CanInitiate type="Enter Time">
            <div className="table-wrap">
              <table className="reg timesheet">
                <thead>
                  <tr><th />{days.map((d) => <th key={d} className={isWeekday(d) ? "" : "weekend"}>{pretty(d)}<div className="faint small">{hourlyPeriodOf(d) ? PERIOD_LABEL[hourlyPeriodOf(d)!.id].split(" (")[0] : ""}</div></th>)}</tr>
                </thead>
                <tbody>
                  <tr>
                    <th>Status</th>
                    {days.map((d) => {
                      const bp = pendingBp(d);
                      const off = timeOff(d);
                      return (
                        <td key={d}>
                          {draftFor(d)?.correctsRowId ? <Pill>correction</Pill> : draftFor(d) ? <Pill>draft</Pill> : bp ? <BpStatus bp={bp} /> : approved(d).length ? <Pill tone="ok">approved</Pill> : null}
                          {off.length > 0 && <div><Pill tone="info">{off[0].status === "Approved" ? "time off" : "time off requested"} {off.reduce((s, a) => s + a.quantity, 0)} {off[0].unit}</Pill></div>}
                        </td>
                      );
                    })}
                  </tr>
                  {FIELDS.map(([field, label, ph]) => (
                    <tr key={field}>
                      <th>{label}</th>
                      {days.map((d) => <td key={d}>{cell(d, field, field === "mealStart" && mealCheck(draftFor(d), w.workState).due ? `by ${mealCheck(draftFor(d), w.workState).due}` : (schedule[field as keyof typeof schedule] ?? ph))}</td>)}
                    </tr>
                  ))}
                  <tr>
                    <th>Hours</th>
                    {days.map((d) => { const hh = worked(shown(d)); return <td key={d} className="n">{hh ? hh.toFixed(2) : ""}</td>; })}
                  </tr>
                  <tr>
                    <th>Meal break{rule.mealPremium ? " (CA)" : ""}</th>
                    {days.map((d) => {
                      const m = mealCheck(shown(d), w.workState);
                      return <td key={d} className="small">{m.problem ? <span className="pos-var">{m.problem}. A meal premium (1 hour of pay) applies.</span> : m.soft ? <span className="pos-var">{m.soft}.</span> : m.due ? <span className="muted">30 min, start by {m.due}</span> : null}</td>;
                    })}
                  </tr>
                  <tr>
                    <th />
                    {days.map((d) => (
                      <td key={d}>
                        {approved(d).length > 0 && !draftFor(d) && !pendingRow(d) && <button className="close" style={{ marginLeft: 0 }} onClick={() => correct(d)}>{manager ? "Edit" : "Correct"}</button>}
                        {manager && approved(d).length > 0 && !draftFor(d) && !pendingRow(d) && <button className="close" style={{ marginLeft: 6 }} onClick={() => remove(d)}>Delete</button>}
                        {draftFor(d) && <button className="close" style={{ marginLeft: 0 }} onClick={() => clear(d)}>Clear</button>}
                        {errors[d]?.map((e) => <div key={e} className="small" style={{ color: "var(--red)" }}>{e}</div>)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="small muted">{rule.mealPremium ? "California law requires a 30-minute meal break that starts before the end of the 5th hour of work for shifts over 5 hours (Labor Code 512). If it is missed, late or short, one hour of pay is added as a meal premium. " : "A missing meal on a shift over 5 hours is flagged against company policy. "}Night shift differential: +${NIGHT_DIFF_PER_HOUR.toFixed(2)}/hr for hours worked 22:00–06:00. A night shift belongs to the day it starts (workday breaks at noon).</p>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" onClick={submitWeek}>{manager ? "Save changes" : "Submit week for approval"}</button>
              <button className="btn ghost" onClick={() => { const r = check(); setMsg(r.ok ? `No errors.${r.warns.length ? ` Warnings: ${r.warns.join(" ")}` : ""}` : "Some days need fixing: see below each day."); }}>Check week</button>
            </div>
          </CanInitiate>
        </Section>
      )}
    </>
  );
}


/** Payroll's time administration: submit scheduled shifts for every US technician with no time on file. */
export function AutofillShifts() {
  const { data } = useData();
  const { erp, submit, nextSeq } = useErp();
  const ds = data!.dsNow;
  const [range, setRange] = useState(RANGES[1][0]);
  const [msg, setMsg] = useState("");
  const [start, end] = range.split("|");
  const hourly = ds.workers.filter((w) => w.workerType === "Employee" && w.payType === "Hourly" && w.country === "USA");

  const autofill = () => {
    let count = 0;
    for (const t of hourly) {
      if (t.hireDate > end || (t.terminationDate && t.terminationDate < start)) continue;
      const days = eachDay(start, end).filter((d) => isWeekday(d) && d >= t.hireDate && (!t.terminationDate || d <= t.terminationDate));
      const have = new Set([
        ...ds.time.filter((r) => r.employeeId === t.id).map((r) => r.workDate),
        ...erp.bps.filter((b) => b.type === "Enter Time" && b.subjectId === t.id && b.status === "Awaiting Approval").flatMap((b) => (b.payload.rows as TimeRow[]).map((r) => r.workDate!)),
        ...ds.absences.filter((a) => a.employeeId === t.id).map((a) => a.date),
      ]);
      const rows = days.filter((d) => !have.has(d)).map((d) => ({ rowId: `W${String(nextSeq()).padStart(5, "0")}`, workDate: d, ...SCHEDULE[(t.shift as "Day" | "Night") || "Day"], shift: t.shift || "Day", notes: "Auto-filled from work schedule" }));
      if (!rows.length) continue;
      submit({ type: "Enter Time", subjectId: t.id, subjectName: t.name, effectiveDate: rows[0].workDate, summary: `Auto-fill ${rows.length} scheduled shifts, ${pretty(start)}–${pretty(end)} (${t.shift || "Day"} schedule)`, payload: { rows } });
      count++;
    }
    setMsg(count ? `Submitted scheduled time for ${count} technicians, ${pretty(start)}–${pretty(end)}. A manager approves it in the inbox ("Approve all I can approve").` : "Every technician already has time for these days.");
  };

  return (
    <Section title="Time administration" lede="Submit scheduled shifts for every hourly technician who has no time on file for these dates. Each goes to the technician's manager for approval.">
      <div className="filters">
        <Select label="Dates" value={range} onChange={setRange} options={RANGES.map(([k, l]) => [k, l])} all={null} />
        <span className="spacer" />
        <button className="btn ghost" onClick={autofill}>Auto-fill scheduled shifts for all technicians</button>
      </div>
      <Toast text={msg} tone="info" />
    </Section>
  );
}
