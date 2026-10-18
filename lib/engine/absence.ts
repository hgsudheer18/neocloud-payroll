// Absence: opening balance + accrual − taken (± payout) = ending balance.
// Accrual posts at the END of the period (opening balances are pre-accrual).

import type { AbsenceBalance, AbsenceTaken, Worker } from "../data/types.ts";
import { PLAN, type AbsencePlan } from "../config/absencePlans.ts";
import { addDays, daysInclusive, maxDate, minDate, type ISODate } from "../util/dates.ts";

export interface AbsenceLine {
  employeeId: string;
  plan: AbsencePlan;
  unit: "hours" | "days";
  tracked: boolean; // false for unlimited plans
  opening: number;
  accrual: number;
  accrualExplain: string;
  taken: number;
  takenDates: ISODate[];
  pendingRequests: number;
  payoutQty: number;
  ending: number;
  flags: string[];
}

export interface AbsenceContext {
  periodStart: ISODate;
  periodEnd: ISODate;
  /** Hours worked in the period (non-exempt from time; salaried from work schedule). */
  hoursWorked: number;
  hoursWorkedBasis: string;
  terminated: boolean; // termination date falls in the period
  statutoryLeave: boolean;
  unpaidLeaveDays: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function calcAbsenceLine(
  worker: Worker,
  plan: AbsencePlan,
  opening: AbsenceBalance | undefined,
  taken: AbsenceTaken[],
  ctx: AbsenceContext,
): AbsenceLine {
  const flags: string[] = [];
  const approved = taken.filter((t) => t.status === "Approved" && t.date >= ctx.periodStart && t.date <= ctx.periodEnd);
  const pending = taken.filter((t) => t.status !== "Approved" && t.date >= ctx.periodStart && t.date <= ctx.periodEnd);
  const takenQty = r2(approved.reduce((s, t) => s + t.quantity, 0));
  const tracked = plan.accrualMethod !== "none" || (opening?.balance ?? null) !== null;
  const open = opening?.balance ?? 0;

  if (!plan.isEligible(worker)) {
    flags.push(`Eligibility mismatch: ${worker.id} is ${worker.flsa} but holds a ${plan.name} balance. Treated as a frozen legacy balance that remains a vested wage.`);
  }

  let accrual = 0;
  let explain = "No accrual (non-balance plan).";
  if (plan.accrualMethod === "per_hour_worked") {
    accrual = r2(ctx.hoursWorked * plan.accrualRate);
    explain = `${ctx.hoursWorked.toFixed(2)} hrs worked (${ctx.hoursWorkedBasis}) × ${plan.accrualRate.toFixed(4)} = ${accrual.toFixed(2)} hrs`;
  } else if (plan.accrualMethod === "monthly") {
    const mStart = ctx.periodStart;
    const mEnd = ctx.periodEnd;
    const from = maxDate(mStart, worker.hireDate);
    const to = worker.terminationDate ? minDate(mEnd, worker.terminationDate) : mEnd;
    const employedDays = to >= from ? daysInclusive(from, to) : 0;
    const monthDays = daysInclusive(mStart, mEnd);
    const suspended = ctx.unpaidLeaveDays > 0 && !ctx.statutoryLeave && !plan.accruesDuringUnpaidLeave ? ctx.unpaidLeaveDays : 0;
    const days = Math.max(0, employedDays - suspended);
    accrual = r2(plan.accrualRate * (days / monthDays));
    explain =
      days === monthDays
        ? `${plan.accrualRate.toFixed(4)} ${plan.unit}/month (full month${ctx.statutoryLeave ? ", continues during statutory leave" : ""})`
        : `${plan.accrualRate.toFixed(4)} × ${days}/${monthDays} days employed = ${accrual.toFixed(2)} ${plan.unit}`;
  }

  if (plan.balanceCap !== null && tracked) {
    const room = Math.max(0, plan.balanceCap - (open - takenQty));
    if (accrual > room) {
      flags.push(`Accrual capped at ${plan.balanceCap} ${plan.unit}: ${accrual.toFixed(2)} → ${r2(room).toFixed(2)}.`);
      accrual = r2(room);
    }
  }

  if (tracked && takenQty > open + accrual) flags.push(`Negative balance: taken ${takenQty} exceeds available ${r2(open + accrual)}.`);
  const tenureDays = daysInclusive(worker.hireDate, ctx.periodEnd);
  if (approved.length && plan.waitingPeriodDays && tenureDays < plan.waitingPeriodDays) {
    flags.push(`Used before the ${plan.waitingPeriodDays}-day waiting period.`);
  }

  let ending = r2(open + accrual - takenQty);
  let payoutQty = 0;
  if (ctx.terminated && tracked) {
    if (plan.payoutOnTermination) {
      payoutQty = Math.max(0, ending);
      ending = r2(ending - payoutQty);
    } else {
      flags.push(`Balance of ${ending} ${plan.unit} not paid out (${plan.payoutBasis})`);
    }
  }
  if (pending.length) flags.push(`${pending.length} request(s) awaiting approval are excluded until approved.`);

  return {
    employeeId: worker.id,
    plan,
    unit: plan.unit,
    tracked,
    opening: open,
    accrual,
    accrualExplain: explain,
    taken: takenQty,
    takenDates: approved.map((a) => a.date),
    pendingRequests: pending.length,
    payoutQty: r2(payoutQty),
    ending,
    flags,
  };
}

/** All plans for a worker: the plans they hold a balance in plus the plans they are eligible for. */
export function plansForWorker(worker: Worker, balances: AbsenceBalance[]): AbsencePlan[] {
  const codes = new Set(balances.filter((b) => b.employeeId === worker.id).map((b) => b.plan));
  for (const p of Object.values(PLAN)) if (p.isEligible(worker)) codes.add(p.code);
  return [...codes].map((c) => PLAN[c]).filter(Boolean);
}

export function lastDayOfMonth(month: string): ISODate {
  const [y, m] = month.split("-").map(Number);
  return addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);
}
