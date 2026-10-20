// Daily cost lines: every pay line of a pay run spread over the days it relates to,
// so payroll can report any date range (a week, a day, part of a pay period) and the
// days of a whole period always add back to the pay run to the cent.
//
//   Time earnings (REG, OT, DT, OT_ADJ, SHIFT, MEAL): by each workday's hours.
//   Salary (SAL): by paid working day. Time off (VAC, SICK, LEAVE_PAID, PTO_TAKEN): by the days taken.
//   One-time items (RETRO, PTO_PAYOUT, BONUS): on the last day of the pay period.
//   Deductions, taxes and employer benefits are calculated per pay period: they are
//   allocated to days in proportion to that worker's earnings on each day.

import { allocate, type Cents } from "../util/money.ts";
import type { ComponentType } from "../config/payComponents.ts";
import type { PeriodResult } from "./run.ts";
import type { UsWorkerCalc } from "./build.ts";
import type { DayCalc } from "./time.ts";

export interface DailyLine {
  date: string;
  periodId: string;
  workerId: string;
  name: string;
  payGroup: string;
  payType: string;
  department: string;
  costCenterId: string;
  code: string;
  component: string;
  type: ComponentType;
  amount: Cents;
  hours: number;
}

const TIME_WEIGHT: Record<string, (d: DayCalc) => number> = {
  REG: (d) => d.cats.REG,
  OT: (d) => d.cats.OT_DAILY + d.cats.OT_WEEKLY + d.cats.SEVENTH_OT,
  DT: (d) => d.cats.DT_DAILY + d.cats.SEVENTH_DT,
  OT_ADJ: (d) => 0.5 * (d.cats.OT_DAILY + d.cats.OT_WEEKLY + d.cats.SEVENTH_OT) + (d.cats.DT_DAILY + d.cats.SEVENTH_DT),
  SHIFT: (d) => d.nightMin,
  MEAL: (d) => d.mealPenalty,
};
const ABSENCE_PLANS_FOR: Record<string, (plan: string) => boolean> = {
  VAC: (p) => p === "US_HOURLY_VAC",
  SICK: (p) => p === "CA_SICK",
  LEAVE_PAID: (p) => p === "US_BEREAVEMENT" || p === "US_JURY_DUTY",
  PTO_TAKEN: () => true,
};

/** Days a line relates to, with weights; empty means "the last day of the period". */
function weightsFor(c: UsWorkerCalc, code: string, start: string, end: string): [string, number][] {
  const inPeriod = (d: string) => d >= start && d <= end;
  if (TIME_WEIGHT[code] && c.time) {
    return c.time.days.filter((d) => inPeriod(d.date)).map((d) => [d.date, TIME_WEIGHT[code](d)] as [string, number]).filter(([, w]) => w > 0);
  }
  if (code === "SAL") return c.input.timeline.filter((d) => d.workingDay && d.paid && inPeriod(d.date)).map((d) => [d.date, 1]);
  if (ABSENCE_PLANS_FOR[code]) {
    return c.input.absencesTaken.filter((a) => a.status === "Approved" && inPeriod(a.date) && ABSENCE_PLANS_FOR[code](a.plan)).map((a) => [a.date, a.quantity]);
  }
  return [];
}

/** Every pay line of the US workers in a pay run, spread over days. Days of the whole period add back to each line. */
export function dailyLines(result: PeriodResult): DailyLine[] {
  const { start, end, id: periodId } = result.period;
  const out: DailyLine[] = [];
  for (const c of result.us) {
    const w = c.worker;
    const base = { periodId, workerId: w.id, name: w.name, payGroup: w.payGroup, payType: w.payType, department: w.department, costCenterId: w.costCenterId };
    const push = (date: string, l: { code: string; name: string; type: ComponentType }, amount: Cents, hours: number) => {
      if (amount !== 0 || hours !== 0) out.push({ ...base, date, code: l.code, component: l.name, type: l.type, amount, hours });
    };
    // Earnings first: their days are the weights for everything calculated per period.
    const grossByDay = new Map<string, number>();
    const earnings = c.pay.lines.filter((l) => l.type === "Earning");
    for (const l of earnings) {
      const wts = weightsFor(c, l.code, start, end);
      const days = wts.length ? wts : ([[end, 1]] as [string, number][]);
      const amounts = allocate(l.amount, days.map(([, x]) => x));
      const total = days.reduce((s, [, x]) => s + x, 0);
      days.forEach(([d, x], i) => {
        push(d, l, amounts[i], l.hours ? (l.hours * x) / total : 0);
        grossByDay.set(d, (grossByDay.get(d) ?? 0) + amounts[i]);
      });
    }
    const gDays = [...grossByDay.entries()].filter(([, g]) => g > 0).sort(([a], [b]) => (a < b ? -1 : 1));
    for (const l of c.pay.lines.filter((x) => x.type !== "Earning")) {
      const days = gDays.length ? gDays : ([[end, 1]] as [string, number][]);
      const amounts = allocate(l.amount, days.map(([, x]) => x));
      days.forEach(([d], i) => push(d, l, amounts[i], 0));
    }
  }
  return out;
}
