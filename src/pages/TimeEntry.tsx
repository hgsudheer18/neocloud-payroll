import { useState } from "react";
import { useData } from "../state.tsx";
import { useErp } from "../erp.tsx";
import { setQuery } from "../router.tsx";
import { PageHead, Pill, Section, Select } from "../ui.tsx";
import { ApproverJump, BpStatus, CanInitiate, Toast, today } from "../erpui.tsx";
import { validateTimeEntry } from "../../lib/erp/validate.ts";
import { buildShift } from "../../lib/engine/time.ts";
import { addDays, eachDay, isWeekday, minutesToHHMM, pretty, workweekStart } from "../../lib/util/dates.ts";
import type { TimeRow } from "../../lib/data/types.ts";
import type { BusinessProcess } from "../../lib/erp/types.ts";

export const RANGES: [string, string, string][] = [
  ["2026-10-01|2026-10-15", "Oct 1–15 (parallel run)", "2026-10-01"],
  ["2026-10-16|2026-10-31", "Oct 16–31 (biweekly transition)", "2026-10-16"],
  ["2026-11-01|2026-11-14", "Nov 1–14 (biweekly)", "2026-11-01"],
];

const SCHEDULE = {
  Day: { timeIn: "06:00", timeOut: "14:30", mealStart: "10:30", mealEnd: "11:00" },
  Night: { timeIn: "22:00", timeOut: "06:30", mealStart: "02:00", mealEnd: "02:30" },
};

/** Workweeks (Sunday to Saturday) covering the demo's pay periods. */
const WEEKS = eachDay("2026-09-27", "2026-11-08").filter((d) => d === workweekStart(d));
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const FIELDS: [keyof TimeRow, string, string][] = [["timeIn", "Clock in", "06:00"], ["mealStart", "Meal start", "10:30"], ["mealEnd", "Meal end", "11:00"], ["timeOut", "Clock out", "14:30"]];
const filled = (r?: Partial<TimeRow>) => !!r && HHMM.test(r.timeIn ?? "") && HHMM.test(r.timeOut ?? "");
const worked = (r?: Partial<TimeRow>) => (filled(r) ? buildShift({ mealStart: "", mealEnd: "", ...r } as TimeRow).worked / 60 : 0);

/**
 * California meal period (Labor Code 512): a shift over 5 hours needs a 30-minute
 * meal break that starts before the end of the 5th hour. Returns the due time and
 * any problem, or nothing outside California.
 */
export function caMeal(r: Partial<TimeRow> | undefined, state: string): { due?: string; problem?: string } {
  if (state !== "CA" || !r || !HHMM.test(r.timeIn ?? "")) return {};
  const start = Number(r.timeIn!.slice(0, 2)) * 60 + Number(r.timeIn!.slice(3));
  const due = minutesToHHMM(start + 300);
  if (!filled(r)) return { due };
  const s = buildShift({ mealStart: "", mealEnd: "", ...r } as TimeRow);
  if (s.worked <= 300) return { due };
  if (s.mealStart === null) return { due, problem: `No meal break: one is required by ${due}` };
  if (s.mealStart - s.start > 300) return { due, problem: `Meal started after ${due} (end of the 5th hour)` };
  if ((s.mealEnd as number) - s.mealStart < 30) return { due, problem: "Meal break shorter than 30 minutes" };
  return { due };
}

/**
 * Weekly timesheet grid: an hourly worker fills in the week (Sunday to Saturday),
 * which is saved as a draft as they type, then submits it for the manager to
 * approve in one go. Approved days can be corrected in the same grid.
 */
export default function TimeEntry({ query }: { query: URLSearchParams }) {
  const { data } = useData();
  const { erp, me, submit, nextSeq, setDrafts } = useErp();
  const ds = data!.dsNow;
  const w = ds.workers.find((x) => x.id === me.workerId);
  const now = today();
  const week = WEEKS.includes(query.get("week") ?? "") ? query.get("week")! : WEEKS.find((x) => x <= now && now <= addDays(x, 6)) ?? "2026-10-11";
  const days = eachDay(week, addDays(week, 6));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [msg, setMsg] = useState("");
  const [lastBp, setLastBp] = useState("");
  if (!w) return <div className="callout info">Time entry is for hourly workers.</div>;

  const schedule = SCHEDULE[(w.shift as "Day" | "Night") || "Day"];
  const drafts = (erp.drafts?.[w.id] ?? []) as unknown as TimeRow[];
  const draftFor = (d: string) => drafts.find((r) => r.workDate === d);
  const approved = (d: string) => {
    const rows = ds.time.filter((t) => t.employeeId === w.id && t.workDate === d);
    const replaced = new Set(rows.filter((r) => r.entryType === "Correction").map((r) => r.correctsRowId));
    return rows.filter((r) => !replaced.has(r.rowId));
  };
  const pendingBp = (d: string) => erp.bps.find((b) => b.type === "Enter Time" && b.subjectId === w.id && b.status === "Awaiting Approval" && (b.payload.rows as TimeRow[]).some((r) => r.workDate === d));
  const pendingRow = (d: string) => (pendingBp(d)?.payload.rows as TimeRow[] | undefined)?.find((r) => r.workDate === d);
  const timeOff = (d: string) => ds.absences.filter((a) => a.employeeId === w.id && a.date === d);

  const save = (rows: TimeRow[]) => setDrafts(w.id, rows as unknown as Record<string, unknown>[]);
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
    save([...drafts.filter((x) => x.workDate !== d), { ...r, rowId: `W${String(nextSeq()).padStart(5, "0")}`, correctsRowId: r.rowId, entryType: "Correction", notes: "" }]);
  };
  const clear = (d: string) => save(drafts.filter((r) => r.workDate !== d));

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
    const bp = submit({ type: "Enter Time", subjectId: w.id, subjectName: w.name, effectiveDate: weekRows[0].workDate, summary: `Timesheet, week of ${pretty(week)}: ${weekRows.length} day(s), ${total.toFixed(2)} hrs${fixes ? ` (${fixes} correction${fixes > 1 ? "s" : ""})` : ""}`, payload: { rows: weekRows }, warnings: warns });
    save(drafts.filter((r) => !days.includes(r.workDate)));
    setLastBp(bp.id);
    setMsg(`${bp.id}: week of ${pretty(week)} submitted for manager approval.`);
  };

  const weekTotal = days.reduce((s, d) => s + worked(draftFor(d) ?? pendingRow(d) ?? approved(d)[0]), 0);
  const cell = (d: string, field: keyof TimeRow, placeholder: string) => {
    const draft = draftFor(d);
    const shown = draft ?? pendingRow(d) ?? approved(d)[0];
    const editable = !!draft || (!pendingRow(d) && !approved(d).length);
    if (!editable) return <span>{(shown?.[field] as string) || "—"}</span>;
    return <input type="text" className="grid-input" placeholder={placeholder} value={(draft?.[field] as string) ?? ""} onChange={(e) => edit(d, field, e.target.value)} aria-label={`${field} ${d}`} />;
  };

  return (
    <>
      <PageHead title="Enter time">
        Fill in your week, Sunday to Saturday. It is saved as a draft as you type; submit the week when it is complete and your manager approves it in one go. Payroll pays approved time only.
      </PageHead>
      <div className="filters">
        <div><strong>{w.id} {w.name}</strong><div className="small muted">{w.workState === "CA" ? "California: daily overtime and meal break rules apply" : "Weekly overtime over 40 hours"}</div></div>
        <Select label="Week" value={week} onChange={(v) => setQuery("/time-entry", { week: v })} options={WEEKS.map((x) => [x, `Week of ${pretty(x)}`])} all={null} />
        <span className="spacer" />
        <button className="btn ghost" onClick={fillSchedule}>Fill in my schedule</button>
      </div>
      <Toast text={msg} tone="info" />
      {msg && <ApproverJump bp={erp.bps.find((b) => b.id === lastBp)} />}

      <Section title={`Week of ${pretty(week)}`} lede={`${weekTotal.toFixed(2)} hours this week${weekRows.length ? `; ${weekRows.length} day(s) not yet submitted` : ""}.`}>
        <CanInitiate type="Enter Time">
          <div className="table-wrap">
            <table className="reg timesheet">
              <thead>
                <tr><th />{days.map((d) => <th key={d} className={isWeekday(d) ? "" : "weekend"}>{pretty(d)}</th>)}</tr>
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
                    {days.map((d) => <td key={d}>{cell(d, field, field === "mealStart" ? (caMeal(draftFor(d), w.workState).due ? `by ${caMeal(draftFor(d), w.workState).due}` : ph) : ph)}</td>)}
                  </tr>
                ))}
                <tr>
                  <th>Hours</th>
                  {days.map((d) => { const h = worked(draftFor(d) ?? pendingRow(d) ?? approved(d)[0]); return <td key={d} className="n">{h ? h.toFixed(2) : ""}</td>; })}
                </tr>
                {w.workState === "CA" && (
                  <tr>
                    <th>Meal break (CA)</th>
                    {days.map((d) => {
                      const m = caMeal(draftFor(d) ?? pendingRow(d) ?? approved(d)[0], "CA");
                      return <td key={d} className="small">{m.problem ? <span className="pos-var">{m.problem}. A meal premium (1 hour of pay) applies.</span> : m.due ? <span className="muted">30 min, start by {m.due}</span> : null}</td>;
                    })}
                  </tr>
                )}
                <tr>
                  <th />
                  {days.map((d) => (
                    <td key={d}>
                      {approved(d).length > 0 && !draftFor(d) && !pendingRow(d) && <button className="close" style={{ marginLeft: 0 }} onClick={() => correct(d)}>Correct</button>}
                      {draftFor(d) && <button className="close" style={{ marginLeft: 0 }} onClick={() => clear(d)}>Clear</button>}
                      {errors[d]?.map((e) => <div key={e} className="small" style={{ color: "var(--red)" }}>{e}</div>)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="small muted">{w.workState === "CA" ? "California law requires a 30-minute meal break that starts before the end of the 5th hour of work for shifts over 5 hours (Labor Code 512). If it is missed, late or short, one hour of pay is added as a meal premium. " : ""}A night shift belongs to the day it starts. Leave the meal times blank if no meal was taken.</p>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={submitWeek}>Submit week for approval</button>
            <button className="btn ghost" onClick={() => { const r = check(); setMsg(r.ok ? `No errors.${r.warns.length ? ` Warnings: ${r.warns.join(" ")}` : ""}` : "Some days need fixing: see below each day."); }}>Check week</button>
          </div>
        </CanInitiate>
      </Section>
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
