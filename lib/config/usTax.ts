// US tax approximations. Every value is effective-dated so a new year (or a
// correction) is a new row, never an edit of history. Values marked EXERCISE
// come from the hiring team's "supplemental rates"; values marked ACTUAL are
// the real published 2026 figures, kept so the difference can be shown.
//
// We are explicitly NOT testing tax minutiae. The structure is what matters:
// each tax has its own taxable-wage definition, wage base and rate.

import type { ISODate } from "../util/dates.ts";

export interface Dated<T> {
  effective: ISODate;
  value: T;
  source: string;
}

export function asOf<T>(rows: Dated<T>[], date: ISODate): T {
  const hit = [...rows].sort((a, b) => (a.effective < b.effective ? 1 : -1)).find((r) => r.effective <= date);
  if (!hit) throw new Error(`No configuration effective on ${date}`);
  return hit.value;
}

export interface FicaConfig {
  ssRate: number;
  ssWageBase: number;
  medicareRate: number;
  addlMedicareRate: number;
  addlMedicareThreshold: number;
}

export const FICA: Dated<FicaConfig>[] = [
  {
    effective: "2026-01-01",
    value: { ssRate: 0.062, ssWageBase: 168_600, medicareRate: 0.0145, addlMedicareRate: 0.009, addlMedicareThreshold: 200_000 },
    source: "EXERCISE: brief says 7.65% FICA on wages up to $168,600. NOTE: the ACTUAL 2026 SSA wage base is $184,500.",
  },
];

/** The value the legacy system (Rippling) is configured with. Used to explain variances. */
export const ACTUAL_2026_SS_WAGE_BASE = 184_500;

export interface UnemploymentConfig {
  futaRate: number;
  futaWageBase: number;
  suiRate: number;
  suiWageBase: number;
}

export const UNEMPLOYMENT: Dated<UnemploymentConfig>[] = [
  {
    effective: "2026-01-01",
    value: { futaRate: 0.006, futaWageBase: 7_000, suiRate: 0.034, suiWageBase: 7_000 },
    source: "EXERCISE: FUTA 0.6% and SUI 3.4% on first $7,000; same SUI rate for every state.",
  },
];

export type Bracket = [upTo: number, rate: number];

export interface IncomeTaxTable {
  standardDeduction: { Single: number; MFJ: number };
  brackets: { Single: Bracket[]; MFJ: Bracket[] };
}

export const FEDERAL: Dated<IncomeTaxTable>[] = [
  {
    effective: "2026-01-01",
    source: "ACTUAL: IRS Rev. Proc. 2025-32 (2026 brackets and standard deduction), applied as an annualized percentage method (simplified Pub 15-T).",
    value: {
      standardDeduction: { Single: 16_100, MFJ: 32_200 },
      brackets: {
        Single: [[12_400, 0.1], [50_400, 0.12], [105_700, 0.22], [201_775, 0.24], [256_225, 0.32], [640_600, 0.35], [Infinity, 0.37]],
        MFJ: [[24_800, 0.1], [100_800, 0.12], [211_400, 0.22], [403_550, 0.24], [512_450, 0.32], [768_700, 0.35], [Infinity, 0.37]],
      },
    },
  },
];

export const CALIFORNIA: Dated<IncomeTaxTable & { sdiRate: number }>[] = [
  {
    effective: "2026-01-01",
    source: "APPROXIMATION: CA FTB rate schedule (prior-year thresholds), annualized; SDI 1.3% with no wage cap (ACTUAL 2026, EDD).",
    value: {
      sdiRate: 0.013,
      standardDeduction: { Single: 5_540, MFJ: 11_080 },
      brackets: {
        Single: [[10_756, 0.01], [25_499, 0.02], [40_245, 0.04], [55_866, 0.06], [70_606, 0.08], [360_659, 0.093], [432_787, 0.103], [721_314, 0.113], [Infinity, 0.123]],
        MFJ: [[21_512, 0.01], [50_998, 0.02], [80_490, 0.04], [111_732, 0.06], [141_212, 0.08], [721_318, 0.093], [865_574, 0.103], [1_442_628, 0.113], [Infinity, 0.123]],
      },
    },
  },
];

/** Flat effective-rate approximations for other work states, plus state employee-paid programs. */
export interface StateRule {
  name: string;
  pitRate: number; // 0 = no state income tax
  eePrograms: { code: string; name: string; rate: number }[];
}

export const STATES: Dated<Record<string, StateRule>>[] = [
  {
    effective: "2026-01-01",
    source: "APPROXIMATION for the exercise: flat effective rates; CA handled by its own table above.",
    value: {
      CA: { name: "California", pitRate: NaN, eePrograms: [{ code: "CA_SDI", name: "CA SDI", rate: 0.013 }] },
      TX: { name: "Texas", pitRate: 0, eePrograms: [] },
      WA: { name: "Washington", pitRate: 0, eePrograms: [{ code: "WA_CARES", name: "WA Cares LTC", rate: 0.0058 }] },
      NY: { name: "New York", pitRate: 0.0585, eePrograms: [{ code: "NY_PFL", name: "NY Paid Family Leave", rate: 0.00432 }] },
      CO: { name: "Colorado", pitRate: 0.044, eePrograms: [] },
      IL: { name: "Illinois", pitRate: 0.0495, eePrograms: [] },
      MA: { name: "Massachusetts", pitRate: 0.05, eePrograms: [] },
      FL: { name: "Florida", pitRate: 0, eePrograms: [] },
    },
  },
];

/** Progressive tax on an annual amount. */
export function progressiveTax(annualTaxable: number, brackets: Bracket[]): number {
  let tax = 0;
  let lower = 0;
  for (const [upTo, rate] of brackets) {
    if (annualTaxable <= lower) break;
    tax += (Math.min(annualTaxable, upTo) - lower) * rate;
    lower = upTo;
  }
  return tax;
}

/**
 * Annualized percentage-method withholding for one period, in cents.
 * periodWagesCents × periods − standard deduction → brackets → ÷ periods.
 */
export function annualizedWithholding(
  periodWagesCents: number,
  periodsPerYear: number,
  table: IncomeTaxTable,
  filing: "Single" | "MFJ",
): number {
  const annual = (periodWagesCents / 100) * periodsPerYear - table.standardDeduction[filing];
  if (annual <= 0) return 0;
  return (progressiveTax(annual, table.brackets[filing]) / periodsPerYear) * 100;
}

/** Garnishment: CCPA limit for support orders (no other family, < 12 weeks arrears). */
export const SUPPORT_ORDER_DEFAULT_LIMIT = 0.6;
