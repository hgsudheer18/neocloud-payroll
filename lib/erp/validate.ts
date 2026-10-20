// Validations on data entry, mirroring Workday time entry template validations
// and business process conditions. Errors block submission; warnings are shown
// and recorded on the business process.

import type { Dataset, TimeRow, Worker } from "../data/types.ts";
import { buildShift, rulesForState } from "../engine/time.ts";
import { ruleForState, SHIFTS } from "../config/timeRules.ts";
import { PLAN } from "../config/absencePlans.ts";
import { daysInclusive, isWeekday, type ISODate } from "../util/dates.ts";
import type { BusinessProcess } from "./types.ts";

export interface Check {
  errors: string[];
  warnings: string[];
}

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** California 2026 minimum wage and exempt salary threshold (2 × min wage × 2,080). */
export const CA_MIN_WAGE_2026 = 16.9;
export const CA_EXEMPT_MIN_SALARY_2026 = 70_304;
export const FEDERAL_MIN_WAGE = 7.25;

export function validateTimeEntry(ds: Dataset, pending: BusinessProcess[], worker: Worker, r: Partial<TimeRow>): Check {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (worker.payType !== "Hourly") errors.push(`${worker.id} is salaried (exempt); time entry is only for hourly, non-exempt workers.`);
  if (!r.workDate) errors.push("Choose a work date.");
  if (!HHMM.test(r.timeIn ?? "") || !HHMM.test(r.timeOut ?? "")) errors.push("Enter clock in and clock out as HH:MM (24-hour).");
  if (errors.length) return { errors, warnings };
  if (r.workDate! < worker.hireDate) errors.push(`Work date is before the hire date (${worker.hireDate}).`);
  if (worker.terminationDate && r.workDate! > worker.terminationDate) errors.push(`Work date is after the termination date (${worker.terminationDate}).`);
  if ((r.mealStart && !r.mealEnd) || (!r.mealStart && r.mealEnd)) errors.push("Enter both meal start and meal end, or neither.");
  if ((r.mealStart && !HHMM.test(r.mealStart)) || (r.mealEnd && !HHMM.test(r.mealEnd))) errors.push("Meal times must be HH:MM.");
  if (errors.length) return { errors, warnings };

  const s = buildShift({ rowId: "new", employeeId: worker.id, workDate: r.workDate!, timeIn: r.timeIn!, timeOut: r.timeOut!, mealStart: r.mealStart ?? "", mealEnd: r.mealEnd ?? "", shift: "", entryType: "Original", correctsRowId: "", enteredOn: r.workDate!, notes: "" });
  if (s.mealStart !== null && (s.mealStart < s.start || (s.mealEnd as number) > s.end)) errors.push("The meal must fall inside the shift.");
  if (s.end - s.start > 16 * 60) errors.push("Shift longer than 16 hours: check the times (critical validation).");
  if (s.worked <= 0) errors.push("Clock out must be after clock in.");

  // Overlap / duplicate against approved and pending time for the same workday.
  const others = [
    ...ds.time.filter((t) => t.employeeId === worker.id && t.workDate === r.workDate && t.rowId !== r.correctsRowId && !t.deleted),
    ...pending.filter((b) => b.type === "Enter Time" && b.subjectId === worker.id && b.status === "Awaiting Approval").flatMap((b) => (b.payload.rows as TimeRow[]).filter((x) => x.workDate === r.workDate)),
  ];
  for (const o of others) {
    const os = buildShift({ ...o, rowId: o.rowId ?? "x" } as TimeRow);
    if (os.start === s.start && os.end === s.end) errors.push(`Duplicate of ${o.rowId ?? "a pending entry"} (${o.timeIn}–${o.timeOut}). To change it, enter a correction instead.`);
    else if (s.start < os.end && os.start < s.end) errors.push(`Overlaps ${o.rowId ?? "a pending entry"} (${o.timeIn}–${o.timeOut}).`);
  }

  if (rulesForState(worker.workState) === "CA") {
    if (s.worked > 300 && s.mealStart === null) warnings.push("No meal recorded on a shift over 5 hours: a CA meal premium will be paid unless the worker attests it was waived.");
    else if (s.mealStart !== null && s.mealStart - s.start > 300) warnings.push("Meal started after the end of the 5th hour: a CA meal premium will be paid.");
    else if (s.mealStart !== null && (s.mealEnd as number) - s.mealStart < 30) warnings.push("Meal shorter than 30 minutes: a CA meal premium will be paid.");
    if (s.worked > 720) warnings.push("Over 12 hours: double time applies and a second meal was required.");
    else if (s.worked > 600) warnings.push("Over 10 hours: second meal required unless a waiver is on file.");
  } else {
    // Outside California: no meal premium, but a missing meal on a long shift is still flagged.
    if (s.worked > 300 && s.mealStart === null) warnings.push("No meal recorded on a shift over 5 hours: check it against the meal policy.");
    const rule = ruleForState(worker.workState);
    if (rule.dailyOtAfter !== null && s.worked > rule.dailyOtAfter) warnings.push(`Over ${rule.dailyOtAfter / 60} hours: ${rule.label} daily overtime applies.`);
    else if (s.worked > 720) warnings.push("Over 12 hours in one day (no daily overtime in this state; counts toward the weekly 40).");
  }
  // Soft warning: block outside the worker's shift window.
  const def = SHIFTS[(worker.shift as "Day" | "Night") || "Day"];
  const start = Number(r.timeIn!.slice(0, 2)) * 60 + Number(r.timeIn!.slice(3));
  const [w0, w1] = def.window.map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)));
  const inWindow = w0 < w1 ? start >= w0 && start < w1 : start >= w0 || start < w1;
  if (!inWindow) warnings.push(`Starts at ${r.timeIn}, outside the ${def.name.toLowerCase()} shift (${def.window[0]}–${def.window[1]}).`);
  return { errors, warnings };
}

export function validateTimeOff(ds: Dataset, pending: BusinessProcess[], worker: Worker, plan: string, days: { date: ISODate; quantity: number }[], availableBalance: number | null): Check {
  const errors: string[] = [];
  const warnings: string[] = [];
  const p = PLAN[plan];
  if (!p) return { errors: ["Choose a time off plan."], warnings };
  if (!p.isEligible(worker) && !ds.balances.some((b) => b.employeeId === worker.id && b.plan === plan)) errors.push(`${worker.id} is not eligible for ${p.name} (${p.eligibility}).`);
  if (!days.length) errors.push("Choose at least one day.");
  for (const d of days) {
    if (d.quantity <= 0) errors.push(`${d.date}: quantity must be more than zero.`);
    if (d.date < worker.hireDate) errors.push(`${d.date} is before the hire date.`);
    if (worker.terminationDate && d.date > worker.terminationDate) errors.push(`${d.date} is after the termination date.`);
    if (!isWeekday(d.date)) warnings.push(`${d.date} is a weekend day; check it is a scheduled workday.`);
    const already = ds.absences.some((a) => a.employeeId === worker.id && a.date === d.date && a.plan === plan) || pending.some((b) => b.type === "Request Time Off" && b.subjectId === worker.id && b.status === "Awaiting Approval" && (b.payload.days as { date: string }[]).some((x) => x.date === d.date));
    if (already) errors.push(`${d.date}: time off already requested for this day.`);
    if (worker.payType === "Hourly" && ds.time.some((t) => t.employeeId === worker.id && t.workDate === d.date)) warnings.push(`${d.date}: the worker also has worked time that day.`);
  }
  const total = days.reduce((s, d) => s + d.quantity, 0);
  if (p.maxPerYear && days.length) {
    const year = days[0].date.slice(0, 4);
    const used = ds.absences.filter((a) => a.employeeId === worker.id && a.plan === plan && a.date.startsWith(year)).reduce((s, a) => s + a.quantity, 0);
    if (used + total > p.maxPerYear) errors.push(`${p.name} allows ${p.maxPerYear} ${p.unit} a year; ${used} already taken or requested in ${year}.`);
  }
  if (availableBalance !== null && p.accrualMethod !== "none" && total > availableBalance) errors.push(`Requested ${total} ${p.unit} but only ${availableBalance.toFixed(2)} available.`);
  if (p.waitingPeriodDays && days.length && daysInclusive(worker.hireDate, days[0].date) < p.waitingPeriodDays) warnings.push(`Within the ${p.waitingPeriodDays}-day waiting period: the plan does not allow use yet.`);
  return { errors, warnings };
}

/** A change to approved time off for one day and plan: a new amount, or zero to cancel it. */
export function validateTimeOffCorrection(ds: Dataset, bps: BusinessProcess[], worker: Worker, plan: string, date: ISODate, quantity: number, availableBalance: number | null): Check {
  const errors: string[] = [];
  const warnings: string[] = [];
  const p = PLAN[plan];
  const current = ds.absences.filter((a) => a.employeeId === worker.id && a.plan === plan && a.date === date && a.status === "Approved").reduce((s, a) => s + a.quantity, 0);
  if (!p) errors.push("Choose a time off plan.");
  if (!current) errors.push(`${date}: there is no approved time off to change.`);
  if (!(quantity >= 0)) errors.push("Enter the new amount, or 0 to cancel.");
  if (quantity === current) errors.push("The new amount is the same as the approved amount.");
  if (bps.some((b) => b.type === "Correct Time Off" && b.subjectId === worker.id && b.status === "Awaiting Approval" && b.payload.date === date && b.payload.plan === plan)) errors.push(`${date}: a change for this day is already awaiting approval.`);
  if (p && availableBalance !== null && p.accrualMethod !== "none" && quantity - current > availableBalance) errors.push(`Adds ${(quantity - current).toFixed(2)} ${p.unit} but only ${availableBalance.toFixed(2)} available.`);
  return { errors, warnings };
}

export interface HireForm {
  name: string;
  hireDate: ISODate;
  jobProfile: string;
  flsa: string;
  payType: string;
  level: string;
  costCenterId: string;
  locationId: string;
  workState: string;
  annualSalary: number;
  hourlyRate: number;
  managerId: string;
}

export function validateHire(ds: Dataset, f: HireForm, supportedStates: string[]): Check {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (f.name.trim().length < 3) errors.push("Enter the worker's legal name.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.hireDate)) errors.push("Choose a hire date.");
  if (!f.jobProfile) errors.push("Choose a job profile.");
  const loc = ds.locations.find((l) => l.id === f.locationId);
  if (!loc) errors.push("Choose a location.");
  if (!ds.costCenters.some((c) => c.id === f.costCenterId)) errors.push("Choose a cost center (supervisory org).");
  if (loc?.country === "USA" && !supportedStates.includes(f.workState)) errors.push(`Work state ${f.workState || "(blank)"} has no payroll tax setup. Supported: ${supportedStates.join(", ")}.`);
  if (f.payType === "Hourly") {
    if (!(f.hourlyRate > 0)) errors.push("Enter an hourly rate.");
    if (f.workState === "CA" && f.hourlyRate > 0 && f.hourlyRate < CA_MIN_WAGE_2026) errors.push(`Below the 2026 California minimum wage ($${CA_MIN_WAGE_2026.toFixed(2)}).`);
    else if (loc?.country === "USA" && f.hourlyRate > 0 && f.hourlyRate < FEDERAL_MIN_WAGE) errors.push("Below the federal minimum wage.");
  } else {
    if (!(f.annualSalary > 0)) errors.push("Enter an annual salary.");
    if (f.flsa === "Exempt" && f.workState === "CA" && f.annualSalary > 0 && f.annualSalary < CA_EXEMPT_MIN_SALARY_2026) errors.push(`Exempt in California requires at least $${CA_EXEMPT_MIN_SALARY_2026.toLocaleString("en-US")} a year (2026).`);
  }
  if (f.flsa === "Non-Exempt" && f.payType === "Salary") warnings.push("Salaried non-exempt workers must still record time for overtime.");
  if (f.managerId && !ds.workers.some((w) => w.id === f.managerId)) errors.push(`Manager ${f.managerId} not found.`);
  return { errors, warnings };
}
