// Pay calendars for 2026 and 2027, generated from the same rules as the pay periods
// the app calculates:
//   US Semi-Monthly (salaried; everyone until go-live): 1st–15th and 16th–month end,
//     paid 5 days after the period ends (the business day before, if that is a weekend).
//   US Biweekly (hourly, from go-live): a transition period Oct 16–31, 2026, then two
//     Sunday–Saturday workweeks at a time from Nov 1, 2026, paid the Friday after.
// Cutoffs: time approved and payroll inputs by 3 business days before the check date;
// the pay run is approved by 1 business day before.

import { addDays, dayOfWeek } from "../util/dates.ts";
import { US_PERIODS } from "./period.ts";

export interface CalendarPeriod {
  id: string;
  payGroup: "US Semi-Monthly" | "US Biweekly";
  number: number;
  start: string;
  end: string;
  checkDate: string;
  inputCutoff: string;
  approveBy: string;
  note: string;
  /** Id of the pay period the app calculates, when it is one of them. */
  appPeriodId?: string;
}

const weekend = (d: string) => dayOfWeek(d) === 0 || dayOfWeek(d) === 6;
/** The day itself, or the business day before it when it falls on a weekend. */
const businessDayOnOrBefore = (d: string) => { let x = d; while (weekend(x)) x = addDays(x, -1); return x; };
/** n business days before a date. */
const businessDaysBefore = (d: string, n: number) => { let x = d; for (let i = 0; i < n; ) { x = addDays(x, -1); if (!weekend(x)) i++; } return x; };
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
const appId = (start: string, end: string, group: string) => US_PERIODS.find((p) => p.start === start && p.end === end && p.payGroup === group)?.id;

function period(group: CalendarPeriod["payGroup"], n: number, start: string, end: string, check: string, note = ""): CalendarPeriod {
  return { id: `${group === "US Biweekly" ? "BW" : "SM"}-${start}`, payGroup: group, number: n, start, end, checkDate: check, inputCutoff: businessDaysBefore(check, 3), approveBy: businessDaysBefore(check, 1), note, appPeriodId: appId(start, end, group) };
}

export function payCalendar(years: number[] = [2026, 2027]): CalendarPeriod[] {
  const out: CalendarPeriod[] = [];
  for (const y of years) {
    let n = 0;
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, "0");
      const first = `${y}-${mm}-01`;
      const mid = `${y}-${mm}-15`;
      const end = lastDay(y, m);
      const pre = `${y}-${mm}` <= "2026-10";
      out.push(period("US Semi-Monthly", ++n, first, mid, businessDayOnOrBefore(addDays(mid, 5)), pre ? "All US workers (hourly move to biweekly from Oct 16, 2026)" : "Salaried"));
      out.push(period("US Semi-Monthly", ++n, `${y}-${mm}-16`, end, businessDayOnOrBefore(addDays(end, 5)), pre && `${y}-${mm}` < "2026-10" ? "All US workers" : "Salaried"));
    }
  }
  // Biweekly from go-live: a transition period, then 14-day periods (Sunday to Saturday).
  let n = 1;
  out.push(period("US Biweekly", n, "2026-10-16", "2026-10-31", "2026-11-06", "Transition: completes the Oct 11–17 workweek, then two full workweeks"));
  for (let s = "2026-11-01"; s <= `${years[years.length - 1]}-12-31`; s = addDays(s, 14)) {
    const e = addDays(s, 13);
    out.push(period("US Biweekly", ++n, s, e, addDays(e, 6), "Hourly"));
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.payGroup < b.payGroup ? -1 : 1));
}
