// International (monthly, provider-calculated) payroll.
//
// Workday is the system of record for worker, comp, absence and one-time
// payments; the in-country provider calculates gross-to-net. We (1) build the
// outbound change file the provider receives, (2) re-perform the expected gross
// and employer cost, and (3) reconcile what the provider returned.

import type { Dataset, ProviderResult, Worker } from "../data/types.ts";
import type { MonthlyPeriod } from "../config/period.ts";
import { COUNTRY_RULES, PROVIDER_TOLERANCE_MINOR } from "../config/intl.ts";
import { buildTimeline } from "./timeline.ts";
import { calcAbsenceLine, plansForWorker, type AbsenceLine } from "./absence.ts";
import { pct, roundCents, type Cents } from "../util/money.ts";
import { pretty } from "../util/dates.ts";

export interface IntlLine {
  code: string;
  name: string;
  amount: Cents;
  explain: string;
}

export interface IntlWorkerResult {
  worker: Worker;
  currency: string;
  fx: number;
  lines: IntlLine[];
  gross: Cents;
  erStatutory: Cents;
  benefits: Cents;
  totalCost: Cents;
  totalCostUsd: Cents;
  absence: AbsenceLine[];
  costCenterId: string;
  flags: string[];
}

export interface ChangeRecord {
  employeeId: string;
  country: string;
  changeType: string;
  effectiveDate: string;
  detail: string;
  enteredOn: string;
  inCutoff: boolean;
}

export interface ProviderVariance {
  employeeId: string;
  country: string;
  currency: string;
  field: "gross" | "employerCost" | "missing" | "unexpected";
  expected: Cents;
  provider: Cents;
  delta: Cents;
  category: "Matched" | "Timing" | "Data" | "Provider error" | "Unexplained";
  explanation: string;
  action: string;
}

export function isIntlWorker(w: Worker): boolean {
  return w.workerType === "Employee" && w.country !== "USA";
}

export function calcIntlWorker(ds: Dataset, w: Worker, p: MonthlyPeriod): IntlWorkerResult {
  const rule = COUNTRY_RULES[w.country];
  const events = ds.events.filter((e) => e.employeeId === w.id);
  const tl = buildTimeline(w, events, p.start, p.end);
  const monthDays = tl.length;
  const lines: IntlLine[] = [];
  const flags: string[] = [];

  // Salary by calendar-day segment (monthly payrolls prorate on calendar days).
  const bySalary = new Map<number, number>();
  for (const d of tl) if (d.paid) bySalary.set(d.annualSalary, (bySalary.get(d.annualSalary) ?? 0) + 1);
  for (const [annual, days] of bySalary) {
    const amt = roundCents((annual / 12) * 100 * (days / monthDays));
    lines.push({ code: "SAL", name: "Monthly Salary", amount: amt, explain: `${annual.toLocaleString("en-US")} ${rule.currency} ÷ 12${days === monthDays ? "" : ` × ${days}/${monthDays} calendar days`}` });
  }

  const statutory = events.some((e) => e.field === "status" && /statutory/i.test(e.reason) && e.effectiveDate <= p.end);
  const terminated = !!w.terminationDate && w.terminationDate >= p.start && w.terminationDate <= p.end;
  const absence = plansForWorker(w, ds.balances).map((plan) =>
    calcAbsenceLine(
      w,
      plan,
      ds.balances.find((b) => b.employeeId === w.id && b.plan === plan.code),
      ds.absences.filter((a) => a.employeeId === w.id && a.plan === plan.code),
      { periodStart: p.start, periodEnd: p.end, hoursWorked: 0, hoursWorkedBasis: "n/a", terminated, statutoryLeave: statutory, unpaidLeaveDays: tl.filter((d) => d.employed && d.onLeave).length },
    ),
  );
  for (const al of absence) {
    if (al.payoutQty <= 0) continue;
    const annual = tl.filter((d) => d.employed).pop()?.annualSalary ?? w.annualSalary;
    const dayRate = w.country === "IND" ? (annual / 12) * 0.5 / 26 : annual / 260;
    const basis = w.country === "IND" ? "monthly basic (50% of gross) ÷ 26" : "annual salary ÷ 260";
    lines.push({
      code: "LEAVE_PAYOUT",
      name: w.country === "IND" ? "Leave Encashment" : "Holiday Pay in Lieu",
      amount: roundCents(al.payoutQty * dayRate * 100),
      explain: `${al.payoutQty.toFixed(2)} days × ${dayRate.toFixed(2)} ${rule.currency} (${basis})`,
    });
  }

  const gross = lines.reduce((s, l) => s + l.amount, 0);
  const erStatutory = roundCents(rule.employerStatutory(gross));
  const benefits = pct(gross, rule.benefitsLoad);
  const totalCost = gross + erStatutory + benefits;
  if (statutory) flags.push("On statutory family leave: absence accrual continues; provider calculates statutory pay.");
  if (terminated) flags.push(`Leaver ${pretty(w.terminationDate)}: leave payout sent as a one-time payment.`);

  return {
    worker: w,
    currency: rule.currency,
    fx: rule.fxToUsd,
    lines,
    gross,
    erStatutory,
    benefits,
    totalCost,
    totalCostUsd: roundCents(totalCost * rule.fxToUsd),
    absence,
    costCenterId: tl[tl.length - 1].costCenterId,
    flags,
  };
}

export function outboundChanges(ds: Dataset, workers: Worker[], p: MonthlyPeriod): ChangeRecord[] {
  const out: ChangeRecord[] = [];
  const ids = new Set(workers.map((w) => w.id));
  for (const w of workers) {
    if (w.hireDate >= p.start && w.hireDate <= p.end)
      out.push({ employeeId: w.id, country: w.country, changeType: "Hire", effectiveDate: w.hireDate, detail: `${w.jobProfile}, ${w.annualSalary.toLocaleString("en-US")} ${w.currency}`, enteredOn: w.enteredOn ?? w.hireDate, inCutoff: (w.enteredOn ?? w.hireDate) <= p.changeCutoff });
    if (w.terminationDate && w.terminationDate >= p.start && w.terminationDate <= p.end)
      out.push({ employeeId: w.id, country: w.country, changeType: "Termination", effectiveDate: w.terminationDate, detail: "Leaver; final pay and leave payout", enteredOn: w.terminationDate, inCutoff: true });
  }
  for (const e of ds.events) {
    if (!ids.has(e.employeeId) || e.effectiveDate > p.end) continue;
    if (e.effectiveDate < p.start && e.enteredOn < p.start) continue;
    const w = workers.find((x) => x.id === e.employeeId)!;
    out.push({ employeeId: e.employeeId, country: w.country, changeType: e.event, effectiveDate: e.effectiveDate, detail: `${e.field}: ${e.oldValue} → ${e.newValue}${e.reason ? ` (${e.reason})` : ""}`, enteredOn: e.enteredOn, inCutoff: e.enteredOn <= p.changeCutoff });
  }
  for (const a of ds.absences) {
    if (!ids.has(a.employeeId) || a.date < p.start || a.date > p.end || a.status !== "Approved") continue;
    const w = workers.find((x) => x.id === a.employeeId)!;
    out.push({ employeeId: a.employeeId, country: w.country, changeType: "Time Off", effectiveDate: a.date, detail: `${a.plan} ${a.quantity} ${a.unit}`, enteredOn: a.date, inCutoff: true });
  }
  return out.sort((a, b) => (a.employeeId + a.effectiveDate < b.employeeId + b.effectiveDate ? -1 : 1));
}

export function reconcileProvider(ds: Dataset, results: IntlWorkerResult[], provider: ProviderResult[], p: MonthlyPeriod): ProviderVariance[] {
  const out: ProviderVariance[] = [];
  const byId = new Map(provider.map((r) => [r.employeeId, r]));
  for (const r of results) {
    const pr = byId.get(r.worker.id);
    if (!pr) {
      const entered = r.worker.enteredOn ?? r.worker.hireDate;
      if (entered > p.changeCutoff) {
        out.push({ employeeId: r.worker.id, country: r.worker.country, currency: r.currency, field: "missing", expected: r.gross, provider: 0, delta: -r.gross, category: "Timing", explanation: `Hire entered ${pretty(entered)}, after the ${pretty(p.changeCutoff)} cutoff, so it was not in this month's file.`, action: "The provider pays this month's salary as arrears next month, or run an off-cycle if the worker must be paid now." });
        continue;
      }
      out.push({ employeeId: r.worker.id, country: r.worker.country, currency: r.currency, field: "missing", expected: r.gross, provider: 0, delta: -r.gross, category: "Unexplained", explanation: "Worker expected but not in provider results.", action: "Hold GL posting for this entity; confirm with provider before funding." });
      continue;
    }
    const pg = roundCents(pr.gross * 100);
    const pe = roundCents(pr.employerCost * 100);
    const lateChange = ds.events.find((e) => e.employeeId === r.worker.id && e.field === "annualSalary" && e.effectiveDate <= p.end && e.enteredOn > p.changeCutoff);
    if (pg !== r.gross) {
      const timing = !!lateChange;
      out.push({
        employeeId: r.worker.id,
        country: r.worker.country,
        currency: r.currency,
        field: "gross",
        expected: r.gross,
        provider: pg,
        delta: pg - r.gross,
        category: timing ? "Timing" : "Unexplained",
        explanation: timing
          ? `Comp change effective ${pretty(lateChange!.effectiveDate)} was entered ${pretty(lateChange!.enteredOn)}, after the ${pretty(p.changeCutoff)} PECI cutoff, so the provider paid the old salary.`
          : "Provider gross differs from Workday expected gross.",
        action: timing
          ? "Accept for this cycle; the change flows in November's file and the provider pays retro. Track on the open-items log; GL posts provider actuals."
          : "Investigate before approval.",
      });
    }
    const expectedEr = roundCents(COUNTRY_RULES[r.worker.country].employerStatutory(pg));
    if (Math.abs(pe - expectedEr) > PROVIDER_TOLERANCE_MINOR) {
      out.push({ employeeId: r.worker.id, country: r.worker.country, currency: r.currency, field: "employerCost", expected: expectedEr, provider: pe, delta: pe - expectedEr, category: "Unexplained", explanation: "Provider employer cost outside tolerance of re-performed statutory cost.", action: "Query provider; obtain statutory calculation detail." });
    }
  }
  for (const pr of provider) {
    if (!results.find((r) => r.worker.id === pr.employeeId)) {
      out.push({ employeeId: pr.employeeId, country: pr.country, currency: pr.currency, field: "unexpected", expected: 0, provider: roundCents(pr.gross * 100), delta: roundCents(pr.gross * 100), category: "Unexplained", explanation: "Provider paid a worker not active in Workday.", action: "Stop payment; confirm termination was transmitted." });
    }
  }
  return out;
}
