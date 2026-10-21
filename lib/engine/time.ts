// Time calculation for non-exempt workers.
//
// Order of evaluation (mirrors the Workday Time Calculation order):
//   1. Clean punches: drop exact duplicates, apply corrections (retro if prior period).
//   2. Build shifts: a shift belongs to the workday it STARTS on (a 22:00–06:30
//      shift is one workday, not two). Meal minutes are unpaid.
//   3. Night minutes: worked minutes falling in 22:00–06:00.
//   4. Meal compliance (CA only): missed / late (> end of 5th hour) / short (< 30 min);
//      > 12 hrs without a second meal. Max one premium per workday.
//   5. Daily categories (CA): 7th consecutive day in the workweek first, else
//      REG ≤ 8, OT 8–12, DT > 12.
//   6. Weekly OT: regular hours beyond 40 in the Sun–Sat workweek become OT,
//      allocated chronologically (the hours that cross 40 are the later ones).
//   7. Regular rate per workweek = (base × hours + differential) ÷ hours,
//      used for the OT adjustment and the meal premium.

import type { TimeRow } from "../data/types.ts";
import { addDays, dayOfWeek, hhmm, workweekStart, type ISODate } from "../util/dates.ts";
import { NIGHT_DIFF_PER_HOUR } from "../config/payComponents.ts";
import { ruleForState, SHIFTS, STATE_TIME_RULES } from "../config/timeRules.ts";

/** Code of the state rule set that applies (CA, AK, NV, CO), or FLSA for weekly overtime only. */
export type TimeRules = string;
export const rulesForState = (state: string): TimeRules => ruleForState(state).code;
const ruleOf = (rules: TimeRules) => STATE_TIME_RULES[rules] ?? STATE_TIME_RULES.FLSA;

export interface Cats {
  REG: number;
  OT_DAILY: number;
  OT_WEEKLY: number;
  DT_DAILY: number;
  SEVENTH_OT: number;
  SEVENTH_DT: number;
}
const zeroCats = (): Cats => ({ REG: 0, OT_DAILY: 0, OT_WEEKLY: 0, DT_DAILY: 0, SEVENTH_OT: 0, SEVENTH_DT: 0 });

export type MealStatus = "ok" | "missed" | "late" | "short" | "second_missed" | "n/a";

export interface Shift {
  rowId: string;
  start: number; // minutes after workDate 00:00
  end: number; // may exceed 1440 when crossing midnight
  mealStart: number | null;
  mealEnd: number | null;
  worked: number;
  night: number;
  crossesMidnight: boolean;
}

export interface DayCalc {
  date: ISODate;
  weekStart: ISODate;
  shifts: Shift[];
  workedMin: number;
  nightMin: number;
  mealStatus: MealStatus;
  mealPenalty: number; // 0 or 1
  secondMealWarning: boolean;
  seventhDay: boolean;
  cats: Cats;
}

export type ExceptionCode =
  | "DUPLICATE_PUNCH"
  | "OVERLAPPING_BLOCKS"
  | "RETRO_CORRECTION"
  | "LATE_ENTRY"
  | "IN_PERIOD_CORRECTION"
  | "MISSED_MEAL"
  | "LATE_MEAL"
  | "SHORT_MEAL"
  | "NO_SECOND_MEAL"
  | "SECOND_MEAL_WAIVER"
  | "SEVENTH_DAY"
  | "SEVEN_CONSECUTIVE_NOT_IN_WEEK"
  | "CROSSES_MIDNIGHT"
  | "CROSSES_PAY_PERIOD"
  | "DELETED_BLOCK"
  | "OVER_12_HOURS";

export interface TimeException {
  employeeId: string;
  rowId: string;
  date: ISODate;
  code: ExceptionCode;
  severity: "Critical" | "Warning" | "Info";
  message: string;
  treatment: string;
}

export interface Earn {
  hours: { REG: number; OT: number; DT: number; NIGHT: number; MEAL: number };
  amounts: { REG: number; OT: number; DT: number; OT_ADJ: number; SHIFT: number; MEAL: number };
}

export interface WeekCalc {
  weekStart: ISODate;
  closedInPeriod: boolean; // workweek ends on or before period end
  regularRate: number;
  current: Earn; // days inside the period
  priorOwed: Earn | null; // prior-period days, recalculated with corrections and full-week regular rate
  priorPaid: Earn | null; // prior-period days, as originally paid
}

export interface WorkerTimeResult {
  employeeId: string;
  rules: TimeRules;
  baseRate: number;
  days: DayCalc[]; // effective (corrected) days from first row through period end
  weeks: WeekCalc[];
  exceptions: TimeException[];
  hoursWorkedInPeriod: number;
  catsInPeriod: Cats & { NIGHT: number; MEAL_PEN: number };
}

// ---------------------------------------------------------------- cleaning

export function cleanRows(rows: TimeRow[], periodStart: ISODate, dedupe = true) {
  const exceptions: TimeException[] = [];
  const originals = rows.filter((r) => r.entryType !== "Correction");
  const corrections = rows.filter((r) => r.entryType === "Correction");

  const seen = new Map<string, TimeRow>();
  const kept: TimeRow[] = [];
  for (const r of originals) {
    const key = [r.employeeId, r.workDate, r.timeIn, r.timeOut, r.mealStart, r.mealEnd].join("|");
    const first = seen.get(key);
    if (first && dedupe) {
      exceptions.push({
        employeeId: r.employeeId,
        rowId: r.rowId,
        date: r.workDate,
        code: "DUPLICATE_PUNCH",
        severity: "Critical",
        message: `Row ${r.rowId} is identical to ${first.rowId} (${r.timeIn}–${r.timeOut}).`,
        treatment: "Excluded from calculation; one time block kept. Prevent with an overlapping-time-block critical validation on the time entry template.",
      });
      continue;
    }
    seen.set(key, r);
    kept.push(r);
  }

  const replaced = new Set(corrections.map((c) => c.correctsRowId));
  for (const c of corrections) {
    const orig = kept.find((k) => k.rowId === c.correctsRowId);
    const prior = c.workDate < periodStart;
    if (prior && c.enteredOn < periodStart) continue; // corrected and paid in an earlier period
    if (c.deleted) {
      exceptions.push({ employeeId: c.employeeId, rowId: c.rowId, date: c.workDate, code: "DELETED_BLOCK", severity: prior ? "Warning" : "Info", message: `${c.rowId} deletes ${c.correctsRowId}${orig ? ` (${orig.timeIn}–${orig.timeOut})` : ""}, entered ${c.enteredOn}.`, treatment: prior ? "Prior period recalculated without the block; the difference is recovered as RETRO in this period." : "Block removed before payment." });
      continue;
    }
    exceptions.push({
      employeeId: c.employeeId,
      rowId: c.rowId,
      date: c.workDate,
      code: prior ? "RETRO_CORRECTION" : "IN_PERIOD_CORRECTION",
      severity: prior ? "Warning" : "Info",
      message: `${c.rowId} corrects ${c.correctsRowId}${orig ? ` (${orig.timeIn}–${orig.timeOut} → ${c.timeIn}–${c.timeOut})` : ""}, entered ${c.enteredOn}.`,
      treatment: prior
        ? "Prior period recalculated with the corrected block; the difference versus what was paid is paid as RETRO in this period."
        : "Corrected block used; no retro needed.",
    });
  }

  // A deletion replaces the block it corrects and adds no time of its own.
  // A correction can itself be corrected or deleted later: only the latest in a chain counts.
  const effective = kept.filter((r) => !replaced.has(r.rowId)).concat(corrections.filter((c) => !c.deleted && !replaced.has(c.rowId)));
  // What was paid for days before this period: rows (and corrections) entered
  // before the period started. Anything entered later is paid now as retro.
  const paidCorrections = corrections.filter((c) => c.enteredOn < periodStart);
  const paidReplaced = new Set(paidCorrections.map((c) => c.correctsRowId));
  const asPaid = kept.filter((r) => r.enteredOn < periodStart && !paidReplaced.has(r.rowId)).concat(paidCorrections.filter((c) => !c.deleted && !paidReplaced.has(c.rowId)));
  for (const r of kept) {
    if (r.workDate < periodStart && r.enteredOn >= periodStart) {
      exceptions.push({
        employeeId: r.employeeId, rowId: r.rowId, date: r.workDate, code: "LATE_ENTRY", severity: "Warning",
        message: `${r.rowId} for a prior-period day was entered ${r.enteredOn}, after that period was paid.`,
        treatment: "Paid in this period as RETRO.",
      });
    }
  }
  return { effective, asPaid, exceptions };
}

// ---------------------------------------------------------------- shifts

function overlap(a0: number, a1: number, b0: number, b1: number) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

export function buildShift(r: TimeRow): Shift {
  const off = r.dayOffset ?? 0; // night shift after midnight: minutes after the previous workday's 00:00
  const start = hhmm(r.timeIn) + off;
  let end = hhmm(r.timeOut) + off;
  if (end <= start) end += 1440; // crosses midnight
  let ms: number | null = null;
  let me: number | null = null;
  if (r.mealStart && r.mealEnd && r.mealStart !== "—" && r.mealEnd !== "—") {
    ms = hhmm(r.mealStart) + off;
    if (ms < start) ms += 1440;
    me = hhmm(r.mealEnd);
    while (me < ms) me += 1440;
  }
  // Only the part of a meal inside the shift is unpaid, so hours never go negative
  // when a meal is typed outside clock in and clock out (validation flags that).
  const intervals: [number, number][] = ms !== null && me !== null ? [[start, Math.min(ms, end)], [Math.max(me, start), end]] : [[start, end]];
  let worked = 0;
  let night = 0;
  for (const [a, b] of intervals) {
    if (b <= a) continue;
    worked += b - a;
    for (let k = -1; k <= 2; k++) night += overlap(a, b, 1320 + 1440 * k, 1800 + 1440 * k); // 22:00–06:00
  }
  return { rowId: r.rowId, start, end, mealStart: ms, mealEnd: me, worked, night, crossesMidnight: end > 1440 };
}

function mealCheck(shifts: Shift[], worked: number): { status: MealStatus; secondWarning: boolean } {
  if (worked <= 300) return { status: "ok", secondWarning: false };
  const meals = shifts.filter((s) => s.mealStart !== null);
  if (meals.length === 0) return { status: "missed", secondWarning: false };
  const first = shifts[0];
  const m = meals[0];
  if ((m.mealStart as number) - first.start > 300) return { status: "late", secondWarning: worked > 600 };
  if ((m.mealEnd as number) - (m.mealStart as number) < 30) return { status: "short", secondWarning: worked > 600 };
  if (worked > 720) return { status: "second_missed", secondWarning: false }; // > 12 hrs: second meal cannot be waived
  return { status: "ok", secondWarning: worked > 600 };
}

/** The workday a block belongs to: a night shift starting before the night day-breaker (12:00) belongs to the previous workday. */
export function toWorkday(r: TimeRow): TimeRow {
  if (r.shift === "Night" && hhmm(r.timeIn) < hhmm(SHIFTS.Night.dayBreaker)) return { ...r, workDate: addDays(r.workDate, -1), dayOffset: 1440 };
  return r;
}

export function buildDays(rows: TimeRow[], rules: TimeRules): DayCalc[] {
  const byDate = new Map<ISODate, TimeRow[]>();
  for (const r of rows.map(toWorkday)) {
    if (!byDate.has(r.workDate)) byDate.set(r.workDate, []);
    byDate.get(r.workDate)!.push(r);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, rs]) => {
      const shifts = rs.map(buildShift).sort((a, b) => a.start - b.start);
      const workedMin = shifts.reduce((t, s) => t + s.worked, 0);
      const nightMin = shifts.reduce((t, s) => t + s.night, 0);
      const meal = ruleOf(rules).mealPremium ? mealCheck(shifts, workedMin) : { status: "n/a" as MealStatus, secondWarning: false };
      return {
        date,
        weekStart: workweekStart(date),
        shifts,
        workedMin,
        nightMin,
        mealStatus: meal.status,
        mealPenalty: meal.status === "ok" || meal.status === "n/a" ? 0 : 1,
        secondMealWarning: meal.secondWarning,
        seventhDay: false,
        cats: zeroCats(),
      };
    });
}

// ---------------------------------------------------------------- categories

/** Categorize the days of ONE workweek (sorted ascending). Mutates and returns days. */
export function categorizeWeek(days: DayCalc[], rules: TimeRules): DayCalc[] {
  const rule = ruleOf(rules);
  const ws = days[0]?.weekStart;
  const workedDates = new Set(days.filter((d) => d.workedMin > 0).map((d) => d.date));
  let weeklyReg = 0;
  for (const d of days) {
    const h = d.workedMin;
    const c = zeroCats();
    let reg: number;
    const seventh =
      rule.seventhDay &&
      dayOfWeek(d.date) === 6 &&
      [0, 1, 2, 3, 4, 5, 6].every((i) => workedDates.has(addDays(ws, i)));
    d.seventhDay = seventh;
    if (seventh) {
      c.SEVENTH_OT = Math.min(h, 480);
      c.SEVENTH_DT = Math.max(h - 480, 0);
      reg = 0;
    } else if (rule.dailyOtAfter !== null) {
      // Daily overtime by state: CA 8 hours (double time after 12), AK and NV 8, CO 12.
      const ot = rule.dailyOtAfter;
      const dt = rule.dailyDtAfter;
      reg = Math.min(h, ot);
      c.OT_DAILY = dt === null ? Math.max(h - ot, 0) : Math.min(Math.max(h - ot, 0), dt - ot);
      c.DT_DAILY = dt === null ? 0 : Math.max(h - dt, 0);
    } else {
      reg = h;
    }
    const over = Math.min(reg, Math.max(0, weeklyReg + reg - 2400));
    c.OT_WEEKLY = over;
    c.REG = reg - over;
    weeklyReg += c.REG;
    d.cats = c;
  }
  return days;
}

export function regularRate(days: DayCalc[], base: number): number {
  const worked = days.reduce((t, d) => t + d.workedMin, 0);
  if (worked === 0) return base;
  const night = days.reduce((t, d) => t + d.nightMin, 0);
  return base + (NIGHT_DIFF_PER_HOUR * night) / worked;
}

export function earn(days: DayCalc[], base: number, rr: number): Earn {
  const m = (f: (d: DayCalc) => number) => days.reduce((t, d) => t + f(d), 0) / 60;
  const REG = m((d) => d.cats.REG);
  const OT = m((d) => d.cats.OT_DAILY + d.cats.OT_WEEKLY + d.cats.SEVENTH_OT);
  const DT = m((d) => d.cats.DT_DAILY + d.cats.SEVENTH_DT);
  const NIGHT = m((d) => d.nightMin);
  const MEAL = days.reduce((t, d) => t + d.mealPenalty, 0);
  return {
    hours: { REG, OT, DT, NIGHT, MEAL },
    amounts: {
      REG: REG * base,
      OT: OT * base * 1.5,
      DT: DT * base * 2,
      OT_ADJ: (rr - base) * (0.5 * OT + 1.0 * DT),
      SHIFT: NIGHT * NIGHT_DIFF_PER_HOUR,
      MEAL: MEAL * rr,
    },
  };
}

function weeksOf(days: DayCalc[]): Map<ISODate, DayCalc[]> {
  const m = new Map<ISODate, DayCalc[]>();
  for (const d of days) {
    if (!m.has(d.weekStart)) m.set(d.weekStart, []);
    m.get(d.weekStart)!.push(d);
  }
  return m;
}

// ---------------------------------------------------------------- per worker

export function calcWorkerTime(
  employeeId: string,
  rows: TimeRow[],
  workState: string,
  baseRate: number,
  periodStart: ISODate,
  periodEnd: ISODate,
  opts: {
    dedupe?: boolean;
    mealPremiums?: boolean;
    /** A shift crossing from the last day of this period into the next is paid next period. */
    deferCrossing?: boolean;
    /** The prior period deferred its crossing shift: pay it in this one. */
    carryInCrossing?: boolean;
  } = {},
): WorkerTimeResult {
  const rules = rulesForState(workState);
  const mine = rows.filter((r) => r.employeeId === employeeId && r.workDate <= periodEnd);
  const cleaned = cleanRows(mine, periodStart, opts.dedupe ?? true);
  const exceptions = [...cleaned.exceptions];

  const effDays = buildDays(cleaned.effective, rules);
  // Pay-period attribution of a shift that crosses midnight on a period boundary.
  const crosses = (d: DayCalc) => d.shifts.some((s) => s.end > 1440);
  const deferred = (d: DayCalc) => !!opts.deferCrossing && d.date === periodEnd && crosses(d);
  const carried = (d: DayCalc) => !!opts.carryInCrossing && d.date === addDays(periodStart, -1) && crosses(d);
  const paysNow = (d: DayCalc) => (d.date >= periodStart && !deferred(d)) || carried(d);
  const paidDays = buildDays(cleaned.asPaid.filter((r) => r.workDate < periodStart), rules).filter((d) => !carried(d));
  for (const wk of weeksOf(effDays).values()) categorizeWeek(wk, rules);
  for (const wk of weeksOf(paidDays).values()) categorizeWeek(wk, rules);
  if (opts.mealPremiums === false) for (const d of [...effDays, ...paidDays]) d.mealPenalty = 0;

  // Overlapping blocks on the same workday (different times) are a data error.
  for (const d of effDays) {
    for (let i = 1; i < d.shifts.length; i++) {
      if (d.shifts[i].start < d.shifts[i - 1].end) {
        exceptions.push({ employeeId, rowId: d.shifts[i].rowId, date: d.date, code: "OVERLAPPING_BLOCKS", severity: "Critical", message: "Time blocks overlap on the same workday.", treatment: "Held for correction before payroll." });
      }
    }
  }

  const weeks: WeekCalc[] = [];
  const effWeeks = weeksOf(effDays);
  const paidWeeks = weeksOf(paidDays);
  // Only workweeks that touch this period, or that received entries after the prior period was paid.
  // Late corrections count too, including deletions that leave a paid week with no time at all.
  const lateWeeks = new Set(
    [...cleaned.effective, ...mine.filter((r) => r.entryType === "Correction")].filter((r) => r.enteredOn >= periodStart && r.workDate < periodStart).map((r) => workweekStart(r.workDate)),
  );
  const weekKeys = [...new Set([...effWeeks.keys(), ...[...paidWeeks.keys()].filter((ws) => lateWeeks.has(ws))])].sort();
  for (const ws of weekKeys) {
    const wdays = effWeeks.get(ws) ?? [];
    if (addDays(ws, 6) < periodStart && !lateWeeks.has(ws) && !wdays.some(carried)) continue;
    const inPeriod = wdays.filter(paysNow);
    const prior = wdays.filter((d) => d.date < periodStart && !carried(d));
    const rr = regularRate(wdays, baseRate);
    const paidPrior = paidWeeks.get(ws) ?? [];
    weeks.push({
      weekStart: ws,
      closedInPeriod: addDays(ws, 6) <= periodEnd,
      regularRate: rr,
      current: earn(inPeriod, baseRate, rr),
      priorOwed: prior.length ? earn(prior, baseRate, rr) : null,
      priorPaid: paidPrior.length ? earn(paidPrior, baseRate, regularRate(paidPrior, baseRate)) : null,
    });
  }

  // Exceptions that explain the numbers
  for (const d of effDays.filter((x) => deferred(x) || carried(x))) {
    exceptions.push({ employeeId, rowId: d.shifts[0]?.rowId ?? "", date: d.date, code: "CROSSES_PAY_PERIOD", severity: "Info", message: "Shift crosses from the last day of a pay period into the next.", treatment: deferred(d) ? "Paid in the next pay period." : "Paid in this pay period (carried from the previous period's last day)." });
  }
  for (const d of effDays.filter(paysNow)) {
    const rowId = d.shifts[0]?.rowId ?? "";
    const meal: Record<string, [ExceptionCode, string]> = {
      missed: ["MISSED_MEAL", "No meal period recorded on a shift over 5 hours."],
      late: ["LATE_MEAL", "Meal period started after the end of the 5th hour of work."],
      short: ["SHORT_MEAL", "Meal period shorter than 30 minutes."],
      second_missed: ["NO_SECOND_MEAL", "Shift over 12 hours with no second meal period (cannot be waived)."],
    };
    if (meal[d.mealStatus]) {
      exceptions.push({ employeeId, rowId, date: d.date, code: meal[d.mealStatus][0], severity: "Warning", message: meal[d.mealStatus][1], treatment: "One hour of pay at the regular rate (MEAL premium)." });
    }
    if (d.secondMealWarning) {
      exceptions.push({ employeeId, rowId, date: d.date, code: "SECOND_MEAL_WAIVER", severity: "Info", message: "Shift over 10 hours: second meal required unless a signed waiver is on file (allowed up to 12 hours).", treatment: "No premium; waiver assumed on file. Validate against waiver records." });
    }
    if (d.seventhDay) {
      exceptions.push({ employeeId, rowId, date: d.date, code: "SEVENTH_DAY", severity: "Info", message: "Seventh consecutive day worked in the workweek.", treatment: "First 8 hours at 1.5x, beyond 8 at 2x (CA)." });
    }
    if (d.shifts.some((s) => s.crossesMidnight)) {
      exceptions.push({ employeeId, rowId, date: d.date, code: "CROSSES_MIDNIGHT", severity: "Info", message: "Shift crosses midnight.", treatment: "Whole shift attributed to the workday it started; night minutes from 22:00 to 06:00 earn the differential." });
    }
    if (d.workedMin > 720) {
      exceptions.push({ employeeId, rowId, date: d.date, code: "OVER_12_HOURS", severity: "Info", message: `${(d.workedMin / 60).toFixed(2)} hours worked in one workday.`, treatment: rules === "CA" ? "Hours over 12 paid at double time." : "No daily overtime outside CA; counts toward the weekly 40." });
    }
  }

  // Seven consecutive calendar days that straddle two workweeks (not a CA 7th day).
  const worked = new Set(effDays.filter((d) => d.workedMin > 0).map((d) => d.date));
  for (const d of effDays.filter((x) => x.date >= periodStart)) {
    const run = [0, 1, 2, 3, 4, 5, 6].every((i) => worked.has(addDays(d.date, -i)));
    if (run && !d.seventhDay) {
      exceptions.push({
        employeeId,
        rowId: d.shifts[0]?.rowId ?? "",
        date: d.date,
        code: "SEVEN_CONSECUTIVE_NOT_IN_WEEK",
        severity: "Info",
        message: "Seventh consecutive calendar day worked.",
        treatment: rules === "CA" ? "Not a 7th-day premium: the run spans two workweeks (CA counts consecutive days within one workweek)." : "No 7th-day premium under FLSA (Texas); only the weekly 40-hour rule applies.",
      });
    }
  }

  const inP = effDays.filter(paysNow);
  const sumC = (k: keyof Cats) => inP.reduce((t, d) => t + d.cats[k], 0);
  return {
    employeeId,
    rules,
    baseRate,
    days: effDays,
    weeks,
    exceptions,
    hoursWorkedInPeriod: inP.reduce((t, d) => t + d.workedMin, 0) / 60,
    catsInPeriod: {
      REG: sumC("REG"),
      OT_DAILY: sumC("OT_DAILY"),
      OT_WEEKLY: sumC("OT_WEEKLY"),
      DT_DAILY: sumC("DT_DAILY"),
      SEVENTH_OT: sumC("SEVENTH_OT"),
      SEVENTH_DT: sumC("SEVENTH_DT"),
      NIGHT: inP.reduce((t, d) => t + d.nightMin, 0),
      MEAL_PEN: inP.reduce((t, d) => t + d.mealPenalty, 0),
    },
  };
}
