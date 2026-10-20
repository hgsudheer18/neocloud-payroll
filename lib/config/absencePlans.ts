// Absence plan configuration: one record per Workday Time Off Plan /
// Accrual. Rules are data so the engine has no country-specific branches
// other than reading these fields.

import type { Worker } from "../data/types.ts";

export type AccrualMethod = "none" | "per_hour_worked" | "monthly";

export interface AbsencePlan {
  code: string;
  name: string;
  country: string;
  unit: "hours" | "days";
  eligibility: string;
  isEligible: (w: Worker) => boolean;
  accrualMethod: AccrualMethod;
  /** per_hour_worked: units per hour worked. monthly: units per full month. */
  accrualRate: number;
  accrualFrequency: string;
  waitingPeriodDays: number;
  balanceCap: number | null;
  carryover: string;
  payoutOnTermination: boolean;
  payoutBasis: string;
  /** Does accrual continue during an unpaid, non-statutory leave? */
  accruesDuringUnpaidLeave: boolean;
  /** Does accrual continue during statutory family/medical leave? */
  accruesDuringStatutoryLeave: boolean;
  onHire: string;
  onLeave: string;
  onTermination: string;
  /** Most that can be taken in a calendar year (no-balance plans). */
  maxPerYear?: number;
  /** Paid by the employer through payroll (US) or the provider. Unpaid leave is tracked only. */
  paid?: boolean;
}

export const ABSENCE_PLANS: AbsencePlan[] = [
  {
    code: "US_FLEX_PTO",
    name: "US Flexible PTO",
    country: "USA",
    unit: "hours",
    eligibility: "US exempt employees",
    isEligible: (w) => w.country === "USA" && w.flsa === "Exempt",
    accrualMethod: "none",
    accrualRate: 0,
    accrualFrequency: "No accrual; time off tracked against a non-balance plan",
    waitingPeriodDays: 0,
    balanceCap: null,
    carryover: "Not applicable",
    payoutOnTermination: false,
    payoutBasis: "None. CA allows no payout only because nothing accrues (truly unlimited, documented policy).",
    accruesDuringUnpaidLeave: false,
    accruesDuringStatutoryLeave: false,
    onHire: "Eligible from day one; no balance created.",
    onLeave: "Not usable during leave of absence (leave plan governs).",
    onTermination: "No payout. Any legacy accrued vacation converted at policy change is a vested wage and must be paid (see E0148).",
  },
  {
    code: "US_HOURLY_VAC",
    name: "US Hourly Vacation",
    country: "USA",
    unit: "hours",
    eligibility: "US non-exempt employees; legacy balances for workers who changed to exempt",
    isEligible: (w) => w.country === "USA" && w.flsa === "Non-Exempt",
    accrualMethod: "per_hour_worked",
    accrualRate: 1 / 26, // 80 hrs per 2,080 hrs worked = 0.0385 hrs per hour
    accrualFrequency: "Each pay period, on hours worked (regular + OT; excludes paid time off)",
    waitingPeriodDays: 90,
    balanceCap: 120,
    carryover: "Balance carries over; accrual stops at 120 hrs (1.5× annual). No use-it-or-lose-it (prohibited in CA).",
    payoutOnTermination: true,
    payoutBasis: "Final base hourly rate (salaried: salary ÷ 2,080); paid with final pay (CA Labor Code 201–203, 227.3).",
    accruesDuringUnpaidLeave: false,
    accruesDuringStatutoryLeave: false,
    onHire: "Accrues from hire date; usable after 90 days.",
    onLeave: "No hours worked, so no accrual; balance preserved.",
    onTermination: "Final-period accrual posts first, then full balance is paid out and balance set to zero.",
  },
  {
    code: "CA_SICK",
    name: "California Paid Sick Leave",
    country: "USA",
    unit: "hours",
    eligibility: "California non-exempt employees (exempt CA employees are covered by Flexible PTO)",
    isEligible: (w) => w.country === "USA" && w.workState === "CA" && w.flsa === "Non-Exempt",
    accrualMethod: "per_hour_worked",
    accrualRate: 1 / 30,
    accrualFrequency: "Each pay period, 1 hr per 30 hrs worked",
    waitingPeriodDays: 90,
    balanceCap: 80,
    carryover: "Carries over; accrual cap 80 hrs; usage may be limited to 40 hrs (5 days) per year.",
    payoutOnTermination: false,
    payoutBasis: "Not paid out. Reinstated if rehired within 12 months.",
    accruesDuringUnpaidLeave: false,
    accruesDuringStatutoryLeave: false,
    onHire: "Accrues from first day; usable from day 90.",
    onLeave: "No accrual (no hours worked).",
    onTermination: "Forfeited (not wages); held for reinstatement 12 months.",
  },
  {
    code: "UK_ANNUAL",
    name: "UK Annual Leave",
    country: "GBR",
    unit: "days",
    eligibility: "All UK employees",
    isEligible: (w) => w.country === "GBR",
    accrualMethod: "monthly",
    accrualRate: 25 / 12,
    accrualFrequency: "Monthly at month end, 25 days/yr + 8 bank holidays (bank holidays tracked separately)",
    waitingPeriodDays: 0,
    balanceCap: null,
    carryover: "Holiday year Jan–Dec; up to 5 days carried to 31 March, remainder forfeited (statutory 20 days protected if prevented by sickness/family leave).",
    payoutOnTermination: true,
    payoutBasis: "Accrued untaken days × (annual salary ÷ 260); excess taken may be recovered if the contract allows.",
    accruesDuringUnpaidLeave: false,
    accruesDuringStatutoryLeave: true,
    onHire: "Pro-rated for the first month by calendar days employed.",
    onLeave: "Continues to accrue during maternity, paternity, adoption, shared parental and sick leave.",
    onTermination: "Pro-rated to leaving date, payout sent to provider as a one-time payment.",
  },
  {
    code: "CAN_ON_VAC",
    name: "Ontario Vacation",
    country: "CAN",
    unit: "days",
    eligibility: "Canadian employees in Ontario",
    isEligible: (w) => w.country === "CAN",
    accrualMethod: "monthly",
    accrualRate: 15 / 12,
    accrualFrequency: "Monthly at month end, 15 days/yr (3 weeks; above the ESA 2-week minimum)",
    waitingPeriodDays: 0,
    balanceCap: null,
    carryover: "Must be taken within 10 months of the end of the entitlement year (ESA).",
    payoutOnTermination: true,
    payoutBasis: "Accrued untaken days × daily rate, and not less than 4% (6% after 5 yrs) of vacationable wages.",
    accruesDuringUnpaidLeave: false,
    accruesDuringStatutoryLeave: true,
    onHire: "Pro-rated for the first month by calendar days employed.",
    onLeave: "ESA leaves count toward entitlement; accrual continues.",
    onTermination: "Paid out with final pay; provider computes vacation pay floor.",
  },
  {
    code: "IND_EL",
    name: "India Earned Leave (Karnataka)",
    country: "IND",
    unit: "days",
    eligibility: "All India employees (Karnataka Shops & Establishments Act)",
    isEligible: (w) => w.country === "IND",
    accrualMethod: "monthly",
    accrualRate: 18 / 12,
    accrualFrequency: "Monthly at month end, 18 days/yr (1 day per 20 days worked)",
    waitingPeriodDays: 0,
    balanceCap: 45,
    carryover: "Carry forward up to 45 days.",
    payoutOnTermination: true,
    payoutBasis: "Encashment: days × (monthly basic ÷ 26); basic = 50% of gross.",
    accruesDuringUnpaidLeave: false,
    accruesDuringStatutoryLeave: true,
    onHire: "Pro-rated by days employed in the month.",
    onLeave: "Maternity benefit leave counts as days worked.",
    onTermination: "Encashed in full and settlement within 2 working days of separation.",
  },
  // ---- Time off types without a balance: tracked, limited per year where policy says so ----
  ...(
    [
      ["US_SICK_EXEMPT", "US Sick Time", "USA", "hours", "US exempt employees", (w: Worker) => w.country === "USA" && w.flsa === "Exempt", "Paid sick time, tracked separately from Flexible PTO (CA paid sick leave law met by the unlimited policy)", undefined, true],
      ["US_BEREAVEMENT", "US Bereavement Leave", "USA", "hours", "All US employees", (w: Worker) => w.country === "USA", "Up to 40 hours a year (CA: up to 5 days, Gov. Code 12945.7)", 40, true],
      ["US_JURY_DUTY", "US Jury Duty", "USA", "hours", "All US employees", (w: Worker) => w.country === "USA", "Paid for days on jury service; proof of service required", undefined, true],
      ["UK_SICK", "UK Sick Leave", "GBR", "days", "All UK employees", (w: Worker) => w.country === "GBR", "Statutory Sick Pay from the fourth qualifying day; provider calculates SSP", undefined, true],
      ["CAN_ON_SICK", "Ontario Sick Days (ESA)", "CAN", "days", "All Ontario employees", (w: Worker) => w.country === "CAN", "Up to 3 unpaid, job-protected days a year (ESA s. 50.0.1)", 3, false],
      ["IND_SL", "India Sick and Casual Leave", "IND", "days", "All India employees", (w: Worker) => w.country === "IND", "Up to 12 days a year; not carried over or encashed", 12, true],
    ] as const
  ).map(([code, name, country, unit, eligibility, isEligible, accrualFrequency, maxPerYear, paid]): AbsencePlan => ({
    code,
    name,
    country,
    unit,
    eligibility,
    isEligible,
    accrualMethod: "none",
    accrualRate: 0,
    accrualFrequency,
    waitingPeriodDays: 0,
    balanceCap: null,
    carryover: "Not applicable",
    payoutOnTermination: false,
    payoutBasis: "None.",
    accruesDuringUnpaidLeave: false,
    accruesDuringStatutoryLeave: false,
    onHire: "Available from day one.",
    onLeave: "Not used during a leave of absence (leave plan governs).",
    onTermination: "No payout.",
    maxPerYear,
    paid,
  })),
];

export const PLAN = Object.fromEntries(ABSENCE_PLANS.map((p) => [p.code, p])) as Record<string, AbsencePlan>;
