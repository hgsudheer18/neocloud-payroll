// Effective-dated data → a per-day timeline for the period.
//
// Workday never overwrites a worker's data; it stacks changes with effective
// dates. We do the same: the worker record is the state as of period start (or
// hire), and WorkerEvents are changes from an effective date onward. To pay a
// period we "materialize" one row per calendar day. Every proration, state
// allocation and cost-centre split is then just a group-by over these days.

import type { Worker, WorkerEvent } from "../data/types.ts";
import { eachDay, isWeekday, type ISODate } from "../util/dates.ts";
import { COMPANY_HOLIDAYS } from "../config/period.ts";

export interface DayState {
  date: ISODate;
  employed: boolean; // between hire and termination (inclusive)
  onLeave: boolean; // unpaid leave of absence
  paid: boolean; // employed && !onLeave
  workingDay: boolean; // Mon–Fri, not a holiday
  annualSalary: number;
  hourlyRate: number;
  workState: string;
  locationId: string;
  costCenterId: string;
}

export function buildTimeline(worker: Worker, events: WorkerEvent[], start: ISODate, end: ISODate): DayState[] {
  const mine = events
    .filter((e) => e.employeeId === worker.id)
    .sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : 1));

  // The worker file holds values as of period start (or hire). Each event
  // applies its new value from its effective date onward.
  return eachDay(start, end).map((date) => {
    const s: DayState = {
      date,
      employed: date >= worker.hireDate && (worker.terminationDate === "" || date <= worker.terminationDate),
      onLeave: false,
      paid: false,
      workingDay: isWeekday(date) && !COMPANY_HOLIDAYS.includes(date),
      annualSalary: worker.annualSalary,
      hourlyRate: worker.hourlyRate,
      workState: worker.workState,
      locationId: worker.locationId,
      costCenterId: worker.costCenterId,
    };
    for (const e of mine) {
      if (e.effectiveDate > date) continue;
      switch (e.field) {
        case "annualSalary":
          s.annualSalary = Number(e.newValue);
          break;
        case "hourlyRate":
          s.hourlyRate = Number(e.newValue);
          break;
        case "workState":
          s.workState = e.newValue;
          break;
        case "locationId":
          s.locationId = e.newValue;
          break;
        case "costCenterId":
          s.costCenterId = e.newValue;
          break;
        case "status":
          s.onLeave = e.newValue === "On Leave";
          break;
      }
    }
    s.paid = s.employed && !s.onLeave;
    return s;
  });
}

/** Group consecutive-or-not days by a key; preserves first-seen order. */
export function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(it);
  }
  return m;
}
