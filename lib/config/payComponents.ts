// Pay component catalog. This mirrors the Workday Pay Component setup:
// each component has a calculation basis, taxability, a feed (where its
// input comes from), a Workday ledger account (via posting rules), and the
// legacy Rippling register column it reconciles to.

export type ComponentType = "Earning" | "Pre-Tax Deduction" | "Post-Tax Deduction" | "Employee Tax" | "Employer Tax" | "Employer Benefit";
export type Feed = "Compensation" | "Time Tracking" | "Absence" | "One-Time Payment" | "Benefits" | "Manual / Court Order" | "Calculated" | "Payroll Input";

export interface Taxability {
  fit: boolean;
  fica: boolean; // Social Security + Medicare
  futaSui: boolean;
  state: boolean; // state income tax + state employee programs
}

export interface PayComponent {
  code: string;
  name: string;
  type: ComponentType;
  feed: Feed;
  basis: string;
  taxability?: Taxability; // earnings only
  /** Reduces these taxable wages (pre-tax deductions only). */
  reduces?: Taxability;
  k401Eligible?: boolean;
  glAccount: string; // Workday ledger account code
  legacyColumn: string; // Rippling register column used for reconciliation
  inScopeThisPeriod: boolean;
}

const ALL_TAXES: Taxability = { fit: true, fica: true, futaSui: true, state: true };

export const PAY_COMPONENTS: PayComponent[] = [
  // ---------- Earnings ----------
  { code: "SAL", name: "Regular Salary", type: "Earning", feed: "Compensation", basis: "Annual salary ÷ 24 × (paid working days ÷ working days in period), per effective-dated comp segment", taxability: ALL_TAXES, k401Eligible: true, glAccount: "6100", legacyColumn: "regularPay", inScopeThisPeriod: true },
  { code: "REG", name: "Regular Hours", type: "Earning", feed: "Time Tracking", basis: "Regular hours × base hourly rate", taxability: ALL_TAXES, k401Eligible: true, glAccount: "6100", legacyColumn: "regularPay", inScopeThisPeriod: true },
  { code: "OT", name: "Overtime 1.5x", type: "Earning", feed: "Time Tracking", basis: "(Daily OT + Weekly OT + 7th-day first 8) hours × base rate × 1.5", taxability: ALL_TAXES, k401Eligible: true, glAccount: "6110", legacyColumn: "overtimePay", inScopeThisPeriod: true },
  { code: "DT", name: "Double Time 2.0x", type: "Earning", feed: "Time Tracking", basis: "(Daily >12 + 7th-day >8) hours × base rate × 2.0", taxability: ALL_TAXES, k401Eligible: true, glAccount: "6110", legacyColumn: "overtimePay", inScopeThisPeriod: true },
  { code: "OT_ADJ", name: "OT Regular-Rate Adjustment", type: "Earning", feed: "Calculated", basis: "(Weekly regular rate − base rate) × (0.5 × OT hrs + 1.0 × DT hrs). Regular rate includes shift differential (FLSA §778)", taxability: ALL_TAXES, k401Eligible: true, glAccount: "6110", legacyColumn: "overtimePay", inScopeThisPeriod: true },
  { code: "SHIFT", name: "Night Shift Differential", type: "Earning", feed: "Time Tracking", basis: "Hours worked between 22:00 and 06:00 × $3.00", taxability: ALL_TAXES, k401Eligible: true, glAccount: "6120", legacyColumn: "premiumPay", inScopeThisPeriod: true },
  { code: "MEAL", name: "Meal Period Premium (CA)", type: "Earning", feed: "Time Tracking", basis: "1 hour × weekly regular rate per workday with a missed, late or short meal (max 1 per day)", taxability: ALL_TAXES, k401Eligible: true, glAccount: "6120", legacyColumn: "premiumPay", inScopeThisPeriod: true },
  { code: "RETRO", name: "Retro Pay", type: "Earning", feed: "Calculated", basis: "Recalculated prior-period result − amount originally paid (time corrections, late comp changes, regular-rate true-up)", taxability: ALL_TAXES, k401Eligible: true, glAccount: "6100", legacyColumn: "otherPay", inScopeThisPeriod: true },
  { code: "VAC", name: "Vacation Taken (Hourly)", type: "Earning", feed: "Absence", basis: "Approved vacation hours × base rate (not hours worked: no OT, no accrual)", taxability: ALL_TAXES, k401Eligible: true, glAccount: "6100", legacyColumn: "otherPay", inScopeThisPeriod: true },
  { code: "SICK", name: "Sick Leave Taken (Hourly)", type: "Earning", feed: "Absence", basis: "Approved sick hours × regular rate of pay", taxability: ALL_TAXES, k401Eligible: true, glAccount: "6100", legacyColumn: "otherPay", inScopeThisPeriod: true },
  { code: "PTO_TAKEN", name: "Time Off Taken (Salaried)", type: "Earning", feed: "Absence", basis: "Approved time off hours × hourly equivalent (salary ÷ 2080), reclassified out of regular salary: gross is unchanged", taxability: ALL_TAXES, k401Eligible: true, glAccount: "6100", legacyColumn: "regularPay", inScopeThisPeriod: true },
  { code: "LEAVE_PAID", name: "Other Paid Leave (Hourly)", type: "Earning", feed: "Absence", basis: "Approved bereavement or jury duty hours × base rate (not hours worked: no OT, no accrual)", taxability: ALL_TAXES, k401Eligible: true, glAccount: "6100", legacyColumn: "otherPay", inScopeThisPeriod: true },
  { code: "PTO_PAYOUT", name: "Vacation Payout on Termination", type: "Earning", feed: "Absence", basis: "Ending vacation balance (after final accrual) × final hourly rate (salary ÷ 2080)", taxability: ALL_TAXES, k401Eligible: false, glAccount: "2150", legacyColumn: "otherPay", inScopeThisPeriod: true },
  { code: "BONUS", name: "Bonus", type: "Earning", feed: "One-Time Payment", basis: "One-time payment amount; supplemental wages (22% optional flat federal rate)", taxability: ALL_TAXES, k401Eligible: true, glAccount: "6130", legacyColumn: "otherPay", inScopeThisPeriod: false },
  { code: "COMMISSION", name: "Commission", type: "Earning", feed: "One-Time Payment", basis: "Commission amount entered by payroll; supplemental wages", taxability: ALL_TAXES, k401Eligible: true, glAccount: "6130", legacyColumn: "otherPay", inScopeThisPeriod: true },
  { code: "ADJ_EARN", name: "Earnings Adjustment", type: "Earning", feed: "Payroll Input", basis: "Missed or corrected earnings entered by payroll (amount, or hours × rate); negative reduces earnings", taxability: ALL_TAXES, k401Eligible: true, glAccount: "6100", legacyColumn: "otherPay", inScopeThisPeriod: true },

  // ---------- Deductions ----------
  { code: "K401", name: "401(k) Pre-Tax", type: "Pre-Tax Deduction", feed: "Benefits", basis: "Election % × 401(k)-eligible earnings", reduces: { fit: true, fica: false, futaSui: false, state: true }, glAccount: "2120", legacyColumn: "preTaxDeductions", inScopeThisPeriod: true },
  { code: "MED", name: "Medical Premium (Sec. 125)", type: "Pre-Tax Deduction", feed: "Benefits", basis: "Per-period employee premium from benefit election", reduces: { fit: true, fica: true, futaSui: true, state: true }, glAccount: "2121", legacyColumn: "preTaxDeductions", inScopeThisPeriod: true },
  { code: "ROTH", name: "Roth 401(k)", type: "Post-Tax Deduction", feed: "Benefits", basis: "Election % × eligible earnings", glAccount: "2120", legacyColumn: "postTaxDeductions", inScopeThisPeriod: false },
  { code: "GARN", name: "Child Support Garnishment", type: "Post-Tax Deduction", feed: "Manual / Court Order", basis: "min(order amount, CCPA % × disposable earnings); disposable = gross − mandatory taxes", glAccount: "2122", legacyColumn: "postTaxDeductions", inScopeThisPeriod: true },

  // ---------- Employee taxes ----------
  { code: "FIT", name: "Federal Income Tax", type: "Employee Tax", feed: "Calculated", basis: "Annualized percentage method on FIT wages (gross − 401k − Sec.125)", glAccount: "2110", legacyColumn: "fit", inScopeThisPeriod: true },
  { code: "SS_EE", name: "Social Security (EE)", type: "Employee Tax", feed: "Calculated", basis: "6.2% × FICA wages up to remaining wage base", glAccount: "2111", legacyColumn: "ssEe", inScopeThisPeriod: true },
  { code: "MED_EE", name: "Medicare (EE)", type: "Employee Tax", feed: "Calculated", basis: "1.45% × FICA wages + 0.9% over $200k YTD", glAccount: "2111", legacyColumn: "medicareEe", inScopeThisPeriod: true },
  { code: "SIT", name: "State Income Tax", type: "Employee Tax", feed: "Calculated", basis: "Per work state on wages allocated to that state", glAccount: "2114", legacyColumn: "stateTax", inScopeThisPeriod: true },
  { code: "STATE_EE", name: "State Employee Programs (SDI/PFL/LTC)", type: "Employee Tax", feed: "Calculated", basis: "CA SDI 1.3%, NY PFL 0.432%, WA Cares 0.58% on wages allocated to that state", glAccount: "2115", legacyColumn: "stateOther", inScopeThisPeriod: true },

  // ---------- Employer ----------
  { code: "SS_ER", name: "Social Security (ER)", type: "Employer Tax", feed: "Calculated", basis: "6.2% × FICA wages up to remaining wage base", glAccount: "6200", legacyColumn: "ssEr", inScopeThisPeriod: true },
  { code: "MED_ER", name: "Medicare (ER)", type: "Employer Tax", feed: "Calculated", basis: "1.45% × FICA wages, no cap", glAccount: "6200", legacyColumn: "medicareEr", inScopeThisPeriod: true },
  { code: "FUTA", name: "FUTA", type: "Employer Tax", feed: "Calculated", basis: "0.6% × wages up to $7,000 YTD", glAccount: "6200", legacyColumn: "futa", inScopeThisPeriod: true },
  { code: "SUI", name: "State Unemployment", type: "Employer Tax", feed: "Calculated", basis: "3.4% × wages up to $7,000 YTD (all states, per brief)", glAccount: "6200", legacyColumn: "sui", inScopeThisPeriod: true },
  { code: "BEN_LOAD", name: "Employer Benefits Load", type: "Employer Benefit", feed: "Benefits", basis: "10% of gross (US), 5% (international)", glAccount: "6300", legacyColumn: "benefits", inScopeThisPeriod: true },
];

export const COMPONENT = Object.fromEntries(PAY_COMPONENTS.map((c) => [c.code, c])) as Record<string, PayComponent>;

/** Time calculation categories and the pay component each one feeds. */
export const TIME_CATEGORY_FEEDS: { category: string; label: string; component: string; multiplier: string }[] = [
  { category: "REG", label: "Regular", component: "REG", multiplier: "1.0 × base" },
  { category: "OT_DAILY", label: "Daily OT (>8 hrs, CA)", component: "OT", multiplier: "1.5 × base" },
  { category: "OT_WEEKLY", label: "Weekly OT (>40 hrs)", component: "OT", multiplier: "1.5 × base" },
  { category: "DT_DAILY", label: "Daily DT (>12 hrs, CA)", component: "DT", multiplier: "2.0 × base" },
  { category: "SEVENTH_OT", label: "7th day first 8 hrs (CA)", component: "OT", multiplier: "1.5 × base" },
  { category: "SEVENTH_DT", label: "7th day over 8 hrs (CA)", component: "DT", multiplier: "2.0 × base" },
  { category: "NIGHT", label: "Night differential hours", component: "SHIFT", multiplier: "+$3.00/hr" },
  { category: "MEAL_PEN", label: "Meal premium (count)", component: "MEAL", multiplier: "1 hr × regular rate" },
];

export const US_BENEFITS_LOAD = 0.1;
export const INTL_BENEFITS_LOAD = 0.05;
export const NIGHT_DIFF_PER_HOUR = 3.0;
