import { useMemo, useState } from "react";
import { useData } from "../state.tsx";
import { useErp } from "../erp.tsx";
import { setQuery } from "../router.tsx";
import { PageHead, Pill, Section, Select } from "../ui.tsx";
import { CanInitiate, Checks, Field, FormGrid, RoleNote, Toast } from "../erpui.tsx";
import { validateTimeEntry, type Check } from "../../lib/erp/validate.ts";
import { buildShift } from "../../lib/engine/time.ts";
import { eachDay, isWeekday, pretty } from "../../lib/util/dates.ts";
import type { TimeRow } from "../../lib/data/types.ts";

const RANGES: [string, string, string][] = [
  ["2026-10-01|2026-10-15", "Oct 1–15 (parallel run)", "2026-10-01"],
  ["2026-10-16|2026-10-31", "Oct 16–31 (biweekly transition)", "2026-10-16"],
  ["2026-11-01|2026-11-14", "Nov 1–14 (biweekly)", "2026-11-01"],
];

const SCHEDULE = {
  Day: { timeIn: "06:00", timeOut: "14:30", mealStart: "10:30", mealEnd: "11:00" },
  Night: { timeIn: "22:00", timeOut: "06:30", mealStart: "02:00", mealEnd: "02:30" },
};

export default function TimeEntry({ query }: { query: URLSearchParams }) {
  const { data } = useData();
  const { erp, me, submit, nextSeq } = useErp();
  const ds = data!.dsNow;
  // Hourly workers enter their own time; payroll auto-fills schedules from Pay runs.
  const workerId = me.workerId ?? "";
  const range = query.get("range") ?? RANGES[1][0];
  const [start, end] = range.split("|");
  const w = ds.workers.find((x) => x.id === workerId);
  const set = (k: string, v: string) => setQuery("/time-entry", { range, [k]: v });

  const [f, setF] = useState<Partial<TimeRow>>({ workDate: start, ...SCHEDULE.Day, notes: "" });
  const [check, setCheck] = useState<Check | null>(null);
  const [msg, setMsg] = useState("");

  const approved = useMemo(() => ds.time.filter((t) => t.employeeId === workerId && t.workDate >= start && t.workDate <= end), [ds, workerId, start, end]);
  const corrected = new Set(approved.filter((r) => r.entryType === "Correction").map((r) => r.correctsRowId));
  const pending = erp.bps.filter((b) => b.type === "Enter Time" && b.subjectId === workerId && b.status === "Awaiting Approval");
  const pendingRows = pending.flatMap((b) => (b.payload.rows as TimeRow[]).map((r) => ({ ...r, bp: b.id })));
  const timeOff = ds.absences.filter((a) => a.employeeId === workerId && a.date >= start && a.date <= end);

  if (!w) return <div className="callout info">Time entry is for hourly workers.</div>;

  const validate = (row: Partial<TimeRow>) => validateTimeEntry(ds, erp.bps, w, row);
  const send = () => {
    const c = validate(f);
    setCheck(c);
    if (c.errors.length) return;
    const rowId = `W${String(nextSeq()).padStart(5, "0")}`;
    const s = buildShift({ rowId, employeeId: w.id, workDate: f.workDate!, timeIn: f.timeIn!, timeOut: f.timeOut!, mealStart: f.mealStart ?? "", mealEnd: f.mealEnd ?? "", shift: "", entryType: "Original", correctsRowId: "", enteredOn: "", notes: "" });
    const bp = submit({
      type: "Enter Time", subjectId: w.id, subjectName: w.name, effectiveDate: f.workDate!,
      summary: `${f.correctsRowId ? `Correct ${f.correctsRowId}: ` : ""}${pretty(f.workDate!)} ${f.timeIn}–${f.timeOut}${f.mealStart ? `, meal ${f.mealStart}–${f.mealEnd}` : ", no meal"} (${(s.worked / 60).toFixed(2)} hrs)`,
      payload: { rows: [{ ...f, rowId, shift: w.shift || "Day" }] },
      warnings: c.warnings,
    });
    setMsg(`${bp.id} submitted for manager approval.${c.warnings.length ? " Warnings recorded on the business process." : ""}`);
    setF({ workDate: f.workDate, ...SCHEDULE[(w.shift as "Day" | "Night") || "Day"], notes: "" });
  };

  const dayRows = eachDay(start, end).map((d) => ({
    d,
    rows: approved.filter((r) => r.workDate === d),
    pend: pendingRows.filter((r) => r.workDate === d),
    off: timeOff.filter((a) => a.date === d),
  }));

  return (
    <>
      <PageHead title="Enter time">
        Clock in and out for hourly, non-exempt workers. Entries are validated as you submit them (overlaps and duplicates are blocked; meal problems are warned) and go to the manager for approval. Payroll pays approved time only.
      </PageHead>
      <div className="filters">
        <div><strong>{w.id} {w.name}</strong><div className="small muted">Your timesheet</div></div>
        <Select label="Dates" value={range} onChange={(v) => set("range", v)} options={RANGES.map(([k, l]) => [k, l])} all={null} />
      </div>
      <Toast text={msg} tone="info" />

      <div className="grid2">
        <Section title={`${w.name}: ${pretty(start)} to ${pretty(end)}`}>
          <div className="table-wrap" style={{ maxHeight: 560 }}>
            <table className="reg">
              <thead><tr><th>Day</th><th>Time</th><th className="n">Hours</th><th>Status</th><th /></tr></thead>
              <tbody>
                {dayRows.map(({ d, rows, pend, off }) => (
                  <tr key={d}>
                    <td>{pretty(d)}</td>
                    <td className="small">
                      {rows.filter((r) => !corrected.has(r.rowId)).map((r) => <div key={r.rowId}>{r.timeIn}–{r.timeOut}{r.mealStart ? `, meal ${r.mealStart}` : ", no meal"} <span className="faint">{r.rowId}</span></div>)}
                      {pend.map((r) => <div key={r.rowId}>{r.timeIn}–{r.timeOut}{r.mealStart ? `, meal ${r.mealStart}` : ", no meal"} <span className="faint">{r.bp}</span></div>)}
                      {off.map((a) => <div key={a.plan}>{a.plan.replace(/_/g, " ").toLowerCase()} {a.quantity} {a.unit}</div>)}
                    </td>
                    <td className="n">{(() => { const m = [...rows.filter((r) => !corrected.has(r.rowId)), ...pend].reduce((t, r) => t + buildShift(r as TimeRow).worked, 0); return m ? (m / 60).toFixed(2) : ""; })()}</td>
                    <td>
                      {rows.length > 0 && <Pill tone="ok">approved</Pill>} {pend.length > 0 && <Pill tone="warn">awaiting approval</Pill>} {off.length > 0 && <Pill tone="info">{off[0].status === "Approved" ? "time off" : "time off requested"}</Pill>}
                    </td>
                    <td>
                      {rows.filter((r) => !corrected.has(r.rowId)).slice(0, 1).map((r) => (
                        <button key={r.rowId} className="close" style={{ marginLeft: 0 }} onClick={() => setF({ workDate: d, timeIn: r.timeIn, timeOut: r.timeOut, mealStart: r.mealStart, mealEnd: r.mealEnd, correctsRowId: r.rowId, notes: "" })}>Correct</button>
                      ))}
                      {rows.length === 0 && pend.length === 0 && <button className="close" style={{ marginLeft: 0 }} onClick={() => setF({ workDate: d, ...SCHEDULE[(w.shift as "Day" | "Night") || "Day"], notes: "" })}>Add</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        <Section title={f.correctsRowId ? `Correct ${f.correctsRowId}` : "Add a time block"}>
          <CanInitiate type="Enter Time">
            {me.role === "Manager" && w.managerId !== me.workerId ? <RoleNote roles={["Employee", "Payroll Specialist"]} action="enter time for workers outside your team" /> : (
              <div className="sheet">
                <FormGrid>
                  <Field label="Work date" hint="A night shift belongs to the day it starts"><input type="date" value={f.workDate ?? ""} onChange={(e) => setF({ ...f, workDate: e.target.value })} /></Field>
                  <Field label="Clock in"><input type="text" placeholder="06:00" value={f.timeIn ?? ""} onChange={(e) => setF({ ...f, timeIn: e.target.value })} /></Field>
                  <Field label="Clock out"><input type="text" placeholder="14:30" value={f.timeOut ?? ""} onChange={(e) => setF({ ...f, timeOut: e.target.value })} /></Field>
                  <Field label="Meal start" hint="Leave blank if no meal was taken"><input type="text" placeholder="10:30" value={f.mealStart ?? ""} onChange={(e) => setF({ ...f, mealStart: e.target.value })} /></Field>
                  <Field label="Meal end"><input type="text" placeholder="11:00" value={f.mealEnd ?? ""} onChange={(e) => setF({ ...f, mealEnd: e.target.value })} /></Field>
                  <Field label="Comment"><input type="text" value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
                </FormGrid>
                {f.correctsRowId && <div className="callout info">This replaces {f.correctsRowId}. If that day is in a completed pay period, the difference is paid as retro in the next period.</div>}
                <Checks check={check} />
                <div className="row" style={{ marginTop: 12 }}>
                  <button className="btn" onClick={send}>Submit for approval</button>
                  <button className="btn ghost" onClick={() => setCheck(validate(f))}>Check only</button>
                  {f.correctsRowId && <button className="btn ghost" onClick={() => setF({ workDate: f.workDate, ...SCHEDULE.Day, notes: "" })}>Cancel correction</button>}
                </div>
              </div>
            )}
          </CanInitiate>
        </Section>
      </div>
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
