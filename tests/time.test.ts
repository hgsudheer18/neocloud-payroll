// Overtime and time-calculation rules. Expected values are worked by hand
// (see docs/03-time-tracking.md) and asserted to the minute / cent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { calcWorkerTime, buildShift } from "../lib/engine/time.ts";
import type { TimeRow } from "../lib/data/types.ts";

const P = { start: "2026-10-01", end: "2026-10-15" };
let n = 0;
const row = (emp: string, date: string, i: string, o: string, ms = "", me = "", extra: Partial<TimeRow> = {}): TimeRow => ({
  rowId: `R${++n}`, employeeId: emp, workDate: date, timeIn: i, timeOut: o, mealStart: ms, mealEnd: me, shift: "Day", entryType: "Original", correctsRowId: "", enteredOn: date, notes: "", ...extra,
});
const day = (t: ReturnType<typeof calcWorkerTime>, d: string) => t.days.find((x) => x.date === d)!;

test("CA daily OT and DT: 12.75 hrs = 8 REG + 4 OT + 0.75 DT", () => {
  const t = calcWorkerTime("E1", [row("E1", "2026-10-02", "06:00", "19:15", "12:45", "13:15")], "CA", 42, P.start, P.end);
  const d = day(t, "2026-10-02");
  assert.equal(d.workedMin, 765);
  assert.deepEqual([d.cats.REG, d.cats.OT_DAILY, d.cats.DT_DAILY], [480, 240, 45]);
  // 8×42 + 4×63 + 0.75×84 = 336 + 252 + 63
  assert.equal(t.weeks[0].current.amounts.REG + t.weeks[0].current.amounts.OT + t.weeks[0].current.amounts.DT, 651);
});

test("Texas: no daily OT, weekly OT only beyond 40 regular hours", () => {
  const rows = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"].map((d) => row("E2", d, "06:00", "17:30", "10:30", "11:00")); // 11 hrs × 4 = 44
  const t = calcWorkerTime("E2", rows, "TX", 38, P.start, P.end);
  assert.equal(t.catsInPeriod.OT_DAILY, 0);
  assert.equal(t.catsInPeriod.REG, 2400);
  assert.equal(t.catsInPeriod.OT_WEEKLY, 240);
  assert.equal(day(t, "2026-10-08").cats.OT_WEEKLY, 240, "weekly OT falls on the day the 40th hour is crossed");
});

test("CA weekly OT counts only regular hours toward 40 (no pyramiding)", () => {
  // Mon–Fri 9.5 hrs/day: daily REG 8×5 = 40, daily OT 1.5×5 = 7.5. Weekly adds nothing.
  const rows = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"].map((d) => row("E3", d, "06:00", "16:00", "10:30", "11:00"));
  const t = calcWorkerTime("E3", rows, "CA", 40, P.start, P.end);
  assert.equal(t.catsInPeriod.REG, 2400);
  assert.equal(t.catsInPeriod.OT_DAILY, 450);
  assert.equal(t.catsInPeriod.OT_WEEKLY, 0);
});

test("CA seventh consecutive day in the workweek: first 8 at 1.5x, rest at 2x", () => {
  const rows = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"].map((d) => row("E4", d, "06:00", "14:30", "10:30", "11:00"));
  rows.push(row("E4", "2026-10-10", "06:00", "16:00", "10:30", "11:00")); // Saturday, 9.5 hrs
  const t = calcWorkerTime("E4", rows, "CA", 40, P.start, P.end);
  const sat = day(t, "2026-10-10");
  assert.equal(sat.seventhDay, true);
  assert.deepEqual([sat.cats.SEVENTH_OT, sat.cats.SEVENTH_DT, sat.cats.REG], [480, 90, 0]);
  assert.equal(day(t, "2026-10-09").cats.OT_WEEKLY, 480, "Sun–Fri = 48 regular hours, so Friday's 8 become weekly OT");
});

test("Seven days in a row across two workweeks is NOT a CA seventh day", () => {
  const rows = ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"].map((d) => row("E5", d, "08:00", "16:30", "12:00", "12:30"));
  const t = calcWorkerTime("E5", rows, "CA", 40, P.start, P.end);
  assert.equal(t.days.some((d) => d.seventhDay), false);
  assert.ok(t.exceptions.some((e) => e.code === "SEVEN_CONSECUTIVE_NOT_IN_WEEK" && e.date === "2026-10-06"));
});

test("Night shift crossing midnight stays on the start day; differential on 22:00–06:00", () => {
  const s = buildShift(row("E6", "2026-10-01", "22:00", "06:30", "02:00", "02:30"));
  assert.equal(s.crossesMidnight, true);
  assert.equal(s.worked, 480);
  assert.equal(s.night, 450); // 22:00–02:00 (240) + 02:30–06:00 (210)
});

test("Regular rate includes the shift differential for OT", () => {
  // CA, 10-hr night shift 22:00–08:30 with 30-min meal: 2 hrs daily OT, 7.5 night hrs.
  const t = calcWorkerTime("E7", [row("E7", "2026-10-07", "22:00", "08:30", "02:00", "02:30")], "CA", 40, P.start, P.end);
  const w = t.weeks[0];
  assert.equal(w.regularRate, 40 + (3 * 450) / 600); // 42.25
  assert.equal(Math.round(w.current.amounts.OT_ADJ * 100), Math.round((42.25 - 40) * 0.5 * 2 * 100)); // $2.25
});

test("Meal premiums: late (after 5th hour), missed, short; max one per day", () => {
  const rows = [
    row("E8", "2026-10-01", "06:00", "16:30", "11:15", "11:45"), // late (11:15 > 11:00)
    row("E8", "2026-10-02", "06:00", "15:00"), // missed
    row("E8", "2026-10-05", "06:00", "14:30", "10:30", "10:50"), // short
    row("E8", "2026-10-06", "06:00", "14:30", "11:00", "11:30"), // exactly at end of 5th hour: compliant
  ];
  const t = calcWorkerTime("E8", rows, "CA", 42, P.start, P.end);
  assert.deepEqual(t.days.map((d) => d.mealStatus), ["late", "missed", "short", "ok"]);
  assert.equal(t.catsInPeriod.MEAL_PEN, 3);
});

test("Duplicate punch is excluded and reported", () => {
  const rows = [row("E9", "2026-10-07", "06:00", "14:30", "10:30", "11:00"), row("E9", "2026-10-07", "06:00", "14:30", "10:30", "11:00")];
  const t = calcWorkerTime("E9", rows, "CA", 40, P.start, P.end);
  assert.equal(day(t, "2026-10-07").workedMin, 480);
  assert.ok(t.exceptions.some((e) => e.code === "DUPLICATE_PUNCH"));
});

test("Retro correction to a prior-period day is paid as the difference", () => {
  const orig = row("E10", "2026-09-30", "06:00", "12:00", "11:00", "11:30");
  const corr = row("E10", "2026-09-30", "06:00", "16:30", "11:00", "11:30", { entryType: "Correction", correctsRowId: orig.rowId, enteredOn: "2026-10-06" });
  const t = calcWorkerTime("E10", [orig, corr], "CA", 40, P.start, P.end);
  const w = t.weeks.find((x) => x.weekStart === "2026-09-27")!;
  const owed = Object.values(w.priorOwed!.amounts).reduce((a, b) => a + b, 0);
  const paid = Object.values(w.priorPaid!.amounts).reduce((a, b) => a + b, 0);
  // Owed 8 REG + 2 OT = 320 + 120 = 440; paid 5.5 REG = 220; retro = 220.
  assert.equal(owed - paid, 220);
  assert.ok(t.exceptions.some((e) => e.code === "RETRO_CORRECTION"));
});

test("Daily overtime follows the work location: AK and NV over 8, CO over 12, TX weekly only", () => {
  const ten = (state: string, hrsOut: string) => day(calcWorkerTime("E9", [row("E9", "2026-10-05", "06:00", hrsOut, "10:00", "10:30")], state, 30, P.start, P.end), "2026-10-05").cats;
  assert.equal(ten("AK", "16:30").OT_DAILY, 120); // 10 hrs worked
  assert.equal(ten("NV", "16:30").OT_DAILY, 120);
  assert.equal(ten("CO", "16:30").OT_DAILY, 0);
  assert.equal(ten("CO", "19:30").OT_DAILY, 60); // 13 hrs worked
  assert.equal(ten("CO", "19:30").DT_DAILY, 0);
  assert.equal(ten("TX", "16:30").OT_DAILY, 0);
  assert.equal(ten("CA", "16:30").OT_DAILY, 120);
});

test("Night shift day-breaker is 12:00: a night shift starting after midnight belongs to the previous workday", () => {
  const t = calcWorkerTime("E9", [row("E9", "2026-10-06", "01:00", "09:00", "05:00", "05:30", { shift: "Night" })], "CA", 30, P.start, P.end);
  assert.ok(t.days.some((d) => d.date === "2026-10-05"), "workday Oct 5");
  assert.equal(day(t, "2026-10-05").workedMin, 450);
  assert.equal(day(t, "2026-10-05").nightMin, 270); // 01:00–05:00 and 05:30–06:00
  // A day shift starting at 06:00 stays on its own date (midnight day-breaker).
  const d = calcWorkerTime("E9", [row("E9", "2026-10-06", "06:00", "14:30", "10:00", "10:30")], "CA", 30, P.start, P.end);
  assert.ok(d.days.some((x) => x.date === "2026-10-06"));
});

test("A shift crossing into the next pay period is paid in the next period", () => {
  const rows = [row("E9", "2026-10-31", "22:00", "06:30", "02:00", "02:30", { shift: "Night" })];
  const thisPeriod = calcWorkerTime("E9", rows, "CA", 30, "2026-10-16", "2026-10-31", { deferCrossing: true });
  assert.equal(thisPeriod.hoursWorkedInPeriod, 0);
  assert.ok(thisPeriod.exceptions.some((e) => e.code === "CROSSES_PAY_PERIOD"));
  const next = calcWorkerTime("E9", rows, "CA", 30, "2026-11-01", "2026-11-14", { deferCrossing: true, carryInCrossing: true });
  assert.equal(next.hoursWorkedInPeriod, 8);
  assert.equal(next.catsInPeriod.NIGHT, 450); // 22:00–02:00 and 02:30–06:00
});

test("A deleted block is removed; deleting a paid prior-period block is recovered as retro", () => {
  const orig = row("E9", "2026-10-05", "06:00", "14:30", "10:00", "10:30", { enteredOn: "2026-10-05" });
  const del = row("E9", "2026-10-05", "06:00", "14:30", "10:00", "10:30", { entryType: "Correction", correctsRowId: orig.rowId, deleted: true, enteredOn: "2026-10-20" });
  const now = calcWorkerTime("E9", [orig, del], "CA", 30, P.start, P.end);
  assert.equal(now.hoursWorkedInPeriod, 0);
  const later = calcWorkerTime("E9", [orig, del], "CA", 30, "2026-10-16", "2026-10-31");
  const wk = later.weeks.find((w) => w.weekStart === "2026-10-04")!;
  assert.equal(wk.priorOwed, null); // nothing owed for the deleted day
  assert.ok(wk.priorPaid && wk.priorPaid.hours.REG === 8);
});

test("A correction that is later corrected or deleted no longer counts", () => {
  const orig = row("E9", "2026-10-05", "06:00", "14:30", "10:00", "10:30");
  const fix = row("E9", "2026-10-05", "06:00", "17:30", "10:00", "10:30", { entryType: "Correction", correctsRowId: orig.rowId });
  const del = row("E9", "2026-10-05", "06:00", "17:30", "10:00", "10:30", { entryType: "Correction", correctsRowId: fix.rowId, deleted: true });
  assert.equal(calcWorkerTime("E9", [orig, fix], "CA", 30, P.start, P.end).hoursWorkedInPeriod, 11);
  assert.equal(calcWorkerTime("E9", [orig, fix, del], "CA", 30, P.start, P.end).hoursWorkedInPeriod, 0);
});
