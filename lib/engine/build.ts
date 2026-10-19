// Builds the per-worker inputs for the US payroll from the dataset.
//
// A `Variant` lets us recalculate a worker under an alternative assumption
// (e.g. "the legacy system did not know about the leave of absence"). The
// reconciliation uses variants to PROVE a root cause by re-performance: if
// recalculating with the hypothesis reproduces the legacy number to the cent,
// the variance is explained.

import type { Dataset, Worker, WorkerEvent, TimeRow } from "../data/types.ts";
import type { PayPeriod } from "../config/period.ts";
import { ACTUAL_2026_SS_WAGE_BASE } from "../config/usTax.ts";
import { buildTimeline } from "./timeline.ts";
import { calcWorkerTime, type WorkerTimeResult } from "./time.ts";
import { calcAbsenceLine, plansForWorker, type AbsenceLine } from "./absence.ts";
import { calcUSWorker, type PayResult, type WorkerPayInput } from "./payroll.ts";
import { STANDARD_DAILY_HOURS } from "../config/period.ts";

export interface Variant {
  hireAtPeriodStart?: boolean;
  ignoreLeave?: boolean;
  compFromPeriodStart?: boolean;
  ignoreLocationChange?: boolean;
  noGarnishment?: boolean;
  noTermPayout?: boolean;
  ssBaseActual?: boolean;
  keepDuplicatePunches?: boolean;
  noMealPremium?: boolean;
  noRetro?: boolean;
  treatAsEmployee?: boolean;
  /** Leave out everything entered through the app's business processes (not known to legacy). */
  excludeErpEntries?: boolean;
}

export interface UsWorkerCalc {
  worker: Worker;
  input: WorkerPayInput;
  time?: WorkerTimeResult;
  absence: AbsenceLine[];
  pay: PayResult;
  hoursWorkedBasis: string;
}

export function isUsPayrollWorker(w: Worker): boolean {
  return w.workerType === "Employee" && w.payGroup === "US Semi-Monthly";
}

export function calcUsWorker(ds: Dataset, w0: Worker, period: PayPeriod, v: Variant = {}, retro?: WorkerPayInput["priorPeriodRetro"]): UsWorkerCalc {
  let w: Worker = { ...w0 };
  if (v.treatAsEmployee) w = { ...w, workerType: "Employee", payGroup: "US Semi-Monthly", flsa: "Exempt" };
  if (v.hireAtPeriodStart && w.hireDate > period.start) w = { ...w, hireDate: period.start };
  if (v.excludeErpEntries) {
    const t = ds.events.find((e) => e.employeeId === w.id && e.source === "erp" && e.event === "Termination");
    if (t) w = { ...w, terminationDate: t.oldValue };
  }

  let events: WorkerEvent[] = ds.events.filter((e) => e.employeeId === w.id && !(v.excludeErpEntries && e.source === "erp"));
  if (v.ignoreLeave) events = events.filter((e) => e.field !== "status");
  if (v.ignoreLocationChange) events = events.filter((e) => e.field !== "workState" && e.field !== "locationId");
  if (v.compFromPeriodStart)
    events = events.map((e) =>
      (e.field === "annualSalary" || e.field === "hourlyRate") && e.effectiveDate > period.start && e.effectiveDate <= period.end ? { ...e, effectiveDate: period.start } : e,
    );

  const timeline = buildTimeline(w, events, period.start, period.end);

  let time: WorkerTimeResult | undefined;
  if (w.payType === "Hourly") {
    let rows: TimeRow[] = ds.time.filter((r) => r.employeeId === w.id && !(v.excludeErpEntries && r.source === "erp"));
    if (v.noRetro) rows = rows.filter((r) => r.entryType !== "Correction");
    time = calcWorkerTime(w.id, rows, w.workState, w.hourlyRate, period.start, period.end, {
      dedupe: !v.keepDuplicatePunches,
      mealPremiums: !v.noMealPremium,
    });
  }

  const paidWorkingDays = timeline.filter((d) => d.workingDay && d.paid).length;
  const hoursWorked = time ? time.hoursWorkedInPeriod : paidWorkingDays * STANDARD_DAILY_HOURS;
  const hoursWorkedBasis = time ? "time tracking" : `work schedule: ${paidWorkingDays} paid days × ${STANDARD_DAILY_HOURS}`;
  const terminated = !!w.terminationDate && w.terminationDate >= period.start && w.terminationDate <= period.end;
  const unpaidLeaveDays = timeline.filter((d) => d.employed && d.onLeave).length;
  const taken = ds.absences.filter((a) => a.employeeId === w.id && !(v.excludeErpEntries && a.source === "erp"));

  const absence = plansForWorker(w, ds.balances).map((plan) =>
    calcAbsenceLine(
      w,
      plan,
      ds.balances.find((b) => b.employeeId === w.id && b.plan === plan.code),
      taken.filter((t) => t.plan === plan.code),
      { periodStart: period.start, periodEnd: period.end, hoursWorked, hoursWorkedBasis, terminated: terminated && !v.noTermPayout, statutoryLeave: false, unpaidLeaveDays },
    ),
  );

  const input: WorkerPayInput = {
    worker: w,
    timeline,
    time,
    absenceLines: absence,
    absencesTaken: taken,
    ytd: ds.ytd.find((y) => y.employeeId === w.id),
    garnishment: v.noGarnishment ? undefined : ds.garnishments.find((g) => g.employeeId === w.id),
    priorPeriodRetro: v.excludeErpEntries ? undefined : retro,
  };
  const pay = calcUSWorker(input, period, v.ssBaseActual ? { ssWageBase: ACTUAL_2026_SS_WAGE_BASE } : {});
  return { worker: w, input, time, absence, pay, hoursWorkedBasis };
}
