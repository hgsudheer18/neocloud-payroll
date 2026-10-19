// Employee-level reconciliation of Workday results to the legacy Rippling
// register.
//
// Method (what an auditor would accept):
//   1. Compare every register column per employee; a variance is any column off by ≥ $0.01.
//   2. For each variance, select the hypotheses that are PLAUSIBLE from the
//      worker's own data (an event in the period, a garnishment, a time
//      exception, YTD near the wage base…). Nothing here knows which errors
//      were seeded into the legacy file.
//   3. Re-perform the calculation under combinations of those hypotheses. A
//      variance is "explained" only when a re-performance reproduces the legacy
//      row on every column to the cent. Otherwise it stays "Unexplained".
//   4. Attribute the dollar impact to each root cause by applying them one at a time.

import type { Dataset, LegacyRow, Worker } from "../data/types.ts";
import type { PayPeriod } from "../config/period.ts";
import { calcUsWorker, type UsWorkerCalc, type Variant } from "./build.ts";
import { toLegacyColumns } from "./payroll.ts";
import { roundCents, type Cents } from "../util/money.ts";
import { ACTUAL_2026_SS_WAGE_BASE, asOf, FICA } from "../config/usTax.ts";
import { pretty } from "../util/dates.ts";

export type VarianceCategory = "Legacy error" | "Configuration difference" | "Timing" | "Data";

export interface Hypothesis {
  id: keyof Variant | "notInLegacy";
  label: string;
  category: VarianceCategory;
  correct: "Workday" | "Legacy" | "Confirm with owner";
  applies: (c: Ctx) => boolean;
  explain: (c: Ctx) => string;
  action: (c: Ctx) => string;
}

interface Ctx {
  ds: Dataset;
  worker: Worker;
  calc: UsWorkerCalc;
  period: PayPeriod;
}

export const COLUMNS = [
  "regularPay", "overtimePay", "premiumPay", "otherPay", "gross", "preTaxDeductions", "fit", "ssEe", "medicareEe", "stateTax",
  "stateOther", "postTaxDeductions", "net", "ssEr", "medicareEr", "futa", "sui", "employerTaxes", "benefits", "totalCost",
] as const;
export type Column = (typeof COLUMNS)[number];

const ev = (c: Ctx, field: string) => c.ds.events.find((e) => e.employeeId === c.worker.id && e.field === field && e.effectiveDate >= c.period.start && e.effectiveDate <= c.period.end);
const hasExc = (c: Ctx, code: string) => !!c.calc.time?.exceptions.some((e) => e.code === code);

export const HYPOTHESES: Hypothesis[] = [
  {
    id: "treatAsEmployee",
    label: "Contingent worker paid through payroll",
    category: "Data",
    correct: "Workday",
    applies: (c) => c.worker.workerType === "Contractor",
    explain: (c) => `${c.worker.id} is a Contingent Worker (contractor). Legacy paid them as a W-2 employee.`,
    action: () => "Remove from the payroll pay group; pay through AP on vendor invoices (1099). Ask Legal/HR to review classification and whether any W-2 wages must be corrected (W-2c, 941-X).",
  },
  {
    id: "hireAtPeriodStart",
    label: "Hire date differs from legacy",
    category: "Data",
    correct: "Workday",
    applies: (c) => c.worker.hireDate > c.period.start && c.worker.hireDate <= c.period.end,
    explain: (c) => `Workday hire date ${pretty(c.worker.hireDate)}; legacy paid from ${pretty(c.period.start)} (overpaid the working days before the start date).`,
    action: () => "Workday is correct (hire date per signed offer and I-9). Log a legacy data defect; in production, an overpayment to a new hire is recovered with written authorization.",
  },
  {
    id: "ignoreLeave",
    label: "Unpaid leave not reflected in legacy",
    category: "Timing",
    correct: "Workday",
    applies: (c) => !!ev(c, "status"),
    explain: (c) => {
      const e = ev(c, "status")!;
      return `Unpaid leave from ${pretty(e.effectiveDate)} was entered ${pretty(e.enteredOn)}, after the legacy input cutoff (${pretty(c.period.legacyInputCutoff)}); legacy paid the full period.`;
    },
    action: () => "Expected timing difference in parallel. Workday is correct. Production control: leave BP must complete before payroll cutoff, or an overpayment is recovered (state-law authorization rules apply, e.g. NY Labor Law §193).",
  },
  {
    id: "compFromPeriodStart",
    label: "Mid-period comp change applied to full period",
    category: "Configuration difference",
    correct: "Workday",
    applies: (c) => !!ev(c, "annualSalary") || !!ev(c, "hourlyRate"),
    explain: (c) => {
      const e = ev(c, "annualSalary") ?? ev(c, "hourlyRate")!;
      return `Comp change ${Number(e.oldValue).toLocaleString("en-US")} → ${Number(e.newValue).toLocaleString("en-US")} effective ${pretty(e.effectiveDate)}. Legacy applies changes from the start of the period; Workday prorates by working days from the effective date.`;
    },
    action: () => "Confirm the proration policy with Total Rewards; Workday's working-day proration matches policy. Document as a known configuration difference, not a defect.",
  },
  {
    id: "ignoreLocationChange",
    label: "Work-state change not in legacy",
    category: "Data",
    correct: "Workday",
    applies: (c) => !!ev(c, "workState"),
    explain: (c) => {
      const e = ev(c, "workState")!;
      return `Work location moved ${e.oldValue} → ${e.newValue} effective ${pretty(e.effectiveDate)}. Legacy withheld ${e.oldValue} taxes on all wages.`;
    },
    action: (c) => {
      const e = ev(c, "workState")!;
      return `Workday is correct (wages sourced by work state). Production: register a ${e.newValue} withholding account before the move; refund ${e.oldValue} over-withholding in the same quarter.`;
    },
  },
  {
    id: "noGarnishment",
    label: "Garnishment not deducted in legacy",
    category: "Legacy error",
    correct: "Workday",
    applies: (c) => c.ds.garnishments.some((g) => g.employeeId === c.worker.id),
    explain: (c) => {
      const g = c.ds.garnishments.find((x) => x.employeeId === c.worker.id)!;
      return `Active ${g.type} order ${g.caseId} (${g.payee}) is not deducted in legacy.`;
    },
    action: () => "Workday is correct. Employer is liable for amounts not withheld: confirm the order date, deduct and remit, notify the agency.",
  },
  {
    id: "noTermPayout",
    label: "Vacation payout missing at termination",
    category: "Legacy error",
    correct: "Workday",
    applies: (c) => c.calc.absence.some((a) => a.payoutQty > 0),
    explain: (c) => {
      const a = c.calc.absence.find((x) => x.payoutQty > 0)!;
      return `Terminated ${pretty(c.worker.terminationDate)} with ${a.payoutQty.toFixed(2)} hrs of ${a.plan.name}. Legacy final pay omits the payout.`;
    },
    action: () => "Workday is correct: in CA accrued vacation is a wage due with final pay (Labor Code 201–203, 227.3; waiting-time penalties apply). Pay with the on-demand final check.",
  },
  {
    id: "ssBaseActual",
    label: "Social Security wage base",
    category: "Configuration difference",
    correct: "Legacy",
    applies: (c) => {
      const fica = asOf(FICA, c.period.checkDate);
      const ytd = c.ds.ytd.find((y) => y.employeeId === c.worker.id)?.ssWages ?? 0;
      return ytd + c.calc.pay.taxable.fica / 100 > fica.ssWageBase && ytd < ACTUAL_2026_SS_WAGE_BASE;
    },
    explain: (c) => {
      const ytd = c.ds.ytd.find((y) => y.employeeId === c.worker.id)?.ssWages ?? 0;
      return `YTD SS wages ${ytd.toLocaleString("en-US", { style: "currency", currency: "USD" })}. Workday uses the exercise wage base $168,600; legacy uses the actual 2026 SSA base $184,500, so legacy keeps withholding 6.2% (EE and ER).`;
    },
    action: () => "Legacy is right for real life. In a real parallel, correct the Workday tax configuration to $184,500 (the $168,600 figure is the 2024 base) and re-run. For this exercise we keep the brief's rate.",
  },
  {
    id: "keepDuplicatePunches",
    label: "Duplicate punch paid twice",
    category: "Data",
    correct: "Workday",
    applies: (c) => hasExc(c, "DUPLICATE_PUNCH"),
    explain: (c) => {
      const e = c.calc.time!.exceptions.find((x) => x.code === "DUPLICATE_PUNCH")!;
      return `${e.message} Legacy counted both blocks.`;
    },
    action: () => "Workday is correct. Add an overlapping-time-block critical validation so the duplicate cannot be submitted.",
  },
  {
    id: "noMealPremium",
    label: "CA meal premiums not calculated in legacy",
    category: "Configuration difference",
    correct: "Workday",
    applies: (c) => c.calc.time?.rules === "CA",
    explain: (c) => {
      const n = c.calc.time!.catsInPeriod.MEAL_PEN;
      return n
        ? `${n} missed, late or short meal period(s) in the period. Legacy time rules do not generate the CA meal premium.`
        : "No meal violations in the corrected time. Legacy does not calculate CA meal premiums, so the premium its duplicated hours would trigger is also absent; this offsets part of the duplicate-punch impact.";
    },
    action: () => "Workday is correct (CA Labor Code 226.7; premium at the regular rate per Ferra v. Loews). Quantify legacy exposure for prior periods and raise with Legal.",
  },
  {
    id: "noRetro",
    label: "Prior-period timesheet correction not yet in legacy",
    category: "Timing",
    correct: "Workday",
    applies: (c) => hasExc(c, "RETRO_CORRECTION"),
    explain: (c) => {
      const e = c.calc.time!.exceptions.find((x) => x.code === "RETRO_CORRECTION")!;
      return `${e.message} Legacy has not processed it in this run.`;
    },
    action: () => "Expected timing difference. Confirm legacy does not also pay it next cycle (double payment risk at cutover); after go-live only Workday pays retro.",
  },
  {
    id: "excludeErpEntries",
    label: "Changes entered in Workday after the legacy run",
    category: "Timing",
    correct: "Workday",
    applies: (c) =>
      c.ds.events.some((e) => e.employeeId === c.worker.id && e.source === "erp") ||
      c.ds.time.some((r) => r.employeeId === c.worker.id && r.source === "erp") ||
      c.ds.absences.some((a) => a.employeeId === c.worker.id && a.source === "erp"),
    explain: () => "Transactions entered through Workday business processes after the legacy register was produced (job, location, leave, termination, time or time off). Legacy never received them.",
    action: () => "Expected in a parallel run. Confirm each transaction is approved; in production Workday is the only system of record, so this cannot occur after cutover.",
  },
];

export interface VarianceCause {
  hypothesis: Hypothesis;
  impact: Partial<Record<Column, Cents>>; // legacy − Workday attributable to this cause
  explanation: string;
  action: string;
}

export interface EmployeeRecon {
  employeeId: string;
  name: string;
  status: "Matched" | "Explained" | "Unexplained" | "Only in legacy" | "Only in Workday";
  workday: Record<Column, Cents> | null;
  legacy: Record<Column, Cents> | null;
  delta: Record<Column, Cents>;
  causes: VarianceCause[];
  residual: Record<Column, Cents>;
}

export function legacyToCents(r: LegacyRow): Record<Column, Cents> {
  const o = {} as Record<Column, Cents>;
  for (const c of COLUMNS) o[c] = roundCents((r[c] as number) * 100);
  return o;
}

const diff = (a: Record<Column, Cents> | null, b: Record<Column, Cents> | null) => {
  const o = {} as Record<Column, Cents>;
  for (const c of COLUMNS) o[c] = (a?.[c] ?? 0) - (b?.[c] ?? 0);
  return o;
};
const isZero = (d: Record<Column, Cents>) => COLUMNS.every((c) => Math.abs(d[c]) < 1);

function subsets<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let m = 1; m < 1 << items.length; m++) out.push(items.filter((_, i) => m & (1 << i)));
  return out.sort((a, b) => a.length - b.length);
}

export function reconcileEmployee(ds: Dataset, worker: Worker, period: PayPeriod, calc: UsWorkerCalc | null, legacyRow: LegacyRow | undefined): EmployeeRecon {
  const workday = calc ? (toLegacyColumns(calc.pay) as Record<Column, Cents>) : null;
  const legacy = legacyRow ? legacyToCents(legacyRow) : null;
  const delta = diff(legacy, workday);
  const base: EmployeeRecon = { employeeId: worker.id, name: worker.name, status: "Matched", workday, legacy, delta, causes: [], residual: delta };

  if (!legacy && workday) {
    const late = (worker.enteredOn ?? worker.hireDate) >= period.legacyInputCutoff;
    return {
      ...base,
      status: "Only in Workday",
      causes: [{
        hypothesis: { id: "notInLegacy", label: "Not in legacy register", category: "Timing", correct: "Workday", applies: () => true, explain: () => "", action: () => "" },
        impact: Object.fromEntries(COLUMNS.map((c) => [c, delta[c]])),
        explanation: late ? `New hire starting ${pretty(worker.hireDate)} was entered ${worker.enteredOn ? `on ${pretty(worker.enteredOn)}, ` : ""}after the legacy input cutoff (${pretty(period.legacyInputCutoff)}).` : "Worker paid in Workday but missing from legacy.",
        action: late ? "Expected timing difference. Confirm legacy pays them in the next run (or not at all after cutover) so they are not paid twice or missed." : "Investigate.",
      }],
      residual: late ? diff(null, null) : delta,
    };
  }
  if (isZero(delta)) return base;

  const effective = calc ?? calcUsWorker(ds, worker, period); // contractors: calc only to test the hypothesis
  const ctx: Ctx = { ds, worker, calc: effective, period };
  const candidates = HYPOTHESES.filter((h) => h.applies(ctx));
  const target = legacy!;
  for (const combo of subsets(candidates).filter((s) => s.length <= 4)) {
    const v: Variant = Object.fromEntries(combo.map((h) => [h.id, true]));
    const re = toLegacyColumns(calcUsWorker(ds, worker, period, v).pay) as Record<Column, Cents>;
    if (!isZero(diff(target, re))) continue;
    // Attribute impacts one cause at a time, cumulatively.
    const causes: VarianceCause[] = [];
    let prev = workday ?? diff(null, null);
    const acc: Variant = {};
    for (const h of combo) {
      (acc as Record<string, boolean>)[h.id] = true;
      const step = toLegacyColumns(calcUsWorker(ds, worker, period, { ...acc }).pay) as Record<Column, Cents>;
      const d = diff(step, prev);
      causes.push({ hypothesis: h, impact: Object.fromEntries(COLUMNS.filter((c) => d[c] !== 0).map((c) => [c, d[c]])), explanation: h.explain(ctx), action: h.action(ctx) });
      prev = step;
    }
    return { ...base, status: legacy && !workday ? "Only in legacy" : "Explained", causes, residual: diff(target, re) };
  }
  return { ...base, status: legacy && !workday ? "Only in legacy" : "Unexplained" };
}

export interface ReconSummary {
  employees: EmployeeRecon[];
  byCause: { id: string; label: string; category: VarianceCategory; correct: string; employees: string[]; grossImpact: Cents; netImpact: Cents; erTaxImpact: Cents }[];
  totals: { workday: Record<Column, Cents>; legacy: Record<Column, Cents> };
  counts: Record<EmployeeRecon["status"], number>;
}

export function summarize(recs: EmployeeRecon[]): ReconSummary {
  const totals = { workday: diff(null, null), legacy: diff(null, null) };
  const counts = { Matched: 0, Explained: 0, Unexplained: 0, "Only in legacy": 0, "Only in Workday": 0 } as ReconSummary["counts"];
  const map = new Map<string, ReconSummary["byCause"][0]>();
  for (const r of recs) {
    counts[r.status]++;
    for (const c of COLUMNS) {
      totals.workday[c] += r.workday?.[c] ?? 0;
      totals.legacy[c] += r.legacy?.[c] ?? 0;
    }
    for (const cause of r.causes) {
      const k = cause.hypothesis.id;
      if (!map.has(k)) map.set(k, { id: k, label: cause.hypothesis.label, category: cause.hypothesis.category, correct: cause.hypothesis.correct, employees: [], grossImpact: 0, netImpact: 0, erTaxImpact: 0 });
      const m = map.get(k)!;
      m.employees.push(r.employeeId);
      m.grossImpact += cause.impact.gross ?? 0;
      m.netImpact += cause.impact.net ?? 0;
      m.erTaxImpact += cause.impact.employerTaxes ?? 0;
    }
  }
  return { employees: recs, byCause: [...map.values()], totals, counts };
}
