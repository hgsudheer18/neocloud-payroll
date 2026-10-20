// Canonical in-memory model for one pay period. Every CSV maps to one of these.
// Monetary inputs from CSV are major units (e.g. 285000); the engine converts
// to integer cents at the boundary.

import type { ISODate } from "../util/dates.ts";

export type CountryCode = "USA" | "CAN" | "GBR" | "IND";
export type WorkerType = "Employee" | "Contractor";
export type Flsa = "Exempt" | "Non-Exempt" | "N/A";
export type PayType = "Salary" | "Hourly";

export interface Company {
  id: string; // Workday Company reference id, e.g. NC-US
  name: string;
  country: CountryCode;
  currency: string;
  netsuiteSubsidiaryId: string;
  netsuiteSubsidiaryName: string;
}

export interface Location {
  id: string; // e.g. SF, SJ, AUS, REMOTE-US, LON, TOR, BLR
  name: string;
  country: CountryCode;
  state: string;
  companyId: string;
  netsuiteLocationId: string;
}

export interface CostCenter {
  id: string; // e.g. CC2100
  name: string;
  department: string; // GPU Cloud | On-Prem | Engineering | G&A
  supervisoryOrg: string; // the supervisory org the cost center is defaulted from
  companyId: string; // entity that owns (budgets) the cost center
  netsuiteDepartmentId: string;
  netsuiteClass: string; // functional P&L line: Cost of Revenue | R&D | S&M | G&A
}

export interface Worker {
  id: string;
  name: string;
  workerType: WorkerType;
  department: string;
  supervisoryOrg: string;
  costCenterId: string;
  locationId: string;
  workState: string; // US state, Canadian province, UK nation, Indian state
  country: CountryCode;
  companyId: string;
  level: string;
  jobProfile: string;
  flsa: Flsa;
  payType: PayType;
  annualSalary: number; // major units, local currency; 0 for hourly
  hourlyRate: number; // major units; 0 for salaried
  currency: string;
  payGroup: string; // "US Semi-Monthly" | "UK Monthly" | ... | "" for contractors
  hireDate: ISODate;
  terminationDate: ISODate | ""; // last day worked
  managerId: string;
  status: string; // as supplied by HR (Active, New Hire, Termination Pending, On Leave, Contractor)
  filingStatus: "Single" | "MFJ";
  k401Pct: number; // 0.06 = 6% pre-tax 401(k)
  medicalPerPeriod: number; // major units, Section 125 pre-tax
  shift: "Day" | "Night" | "";
  /** Date the record was entered (ERP transactions); CSV workers default to hire date. */
  enteredOn?: ISODate;
  /** "erp" when created by a business process in the app rather than the CSV package. */
  source?: "erp";
}

/** Effective-dated change to one worker attribute. */
export interface WorkerEvent {
  employeeId: string;
  event: "Comp Change" | "Location Change" | "Leave of Absence" | "Return from Leave" | "Cost Center Change" | "Termination";
  effectiveDate: ISODate;
  field: "annualSalary" | "hourlyRate" | "workState" | "locationId" | "status" | "costCenterId";
  oldValue: string;
  newValue: string;
  enteredOn: ISODate;
  reason: string;
  source?: "erp";
}

export interface TimeRow {
  rowId: string;
  employeeId: string;
  workDate: ISODate;
  timeIn: string;
  timeOut: string;
  mealStart: string; // "" when no meal recorded
  mealEnd: string;
  shift: string;
  entryType: "Original" | "Correction";
  correctsRowId: string;
  enteredOn: ISODate;
  notes: string;
  source?: "erp";
  /** A correction that removes the time block it corrects (manager delete). */
  deleted?: boolean;
  /** Internal: minutes added because a night shift started after midnight belongs to the previous workday. */
  dayOffset?: number;
}

export interface AbsenceBalance {
  employeeId: string;
  plan: string; // plan code, e.g. US_HOURLY_VAC
  balance: number | null; // null = unlimited / not tracked
  unit: "hours" | "days";
  lastAccrualDate: string;
  notes: string;
}

export interface AbsenceTaken {
  employeeId: string;
  plan: string;
  date: ISODate;
  quantity: number;
  unit: "hours" | "days";
  status: "Approved" | "Submitted";
  source?: "erp";
}

export interface Ytd {
  employeeId: string;
  periods: number;
  gross: number;
  ssWages: number; // Social Security taxable wages YTD (already capped by the legacy system)
  medicareWages: number;
  futaWages: number;
  suiWages: number;
}

export interface Garnishment {
  employeeId: string;
  type: string;
  amountPerPeriod: number;
  maxPctDisposable: number; // CCPA limit applicable to this order, e.g. 0.6
  caseId: string;
  payee: string;
}

/** One row of the legacy Rippling payroll register (US only). */
export interface LegacyRow {
  employeeId: string;
  name: string;
  regularPay: number;
  overtimePay: number;
  premiumPay: number; // shift differential + meal premiums
  otherPay: number; // retro, PTO paid, PTO payout
  gross: number;
  preTaxDeductions: number;
  fit: number;
  ssEe: number;
  medicareEe: number;
  stateTax: number;
  stateOther: number; // SDI, PFL, WA Cares
  postTaxDeductions: number;
  net: number;
  ssEr: number;
  medicareEr: number;
  futa: number;
  sui: number;
  employerTaxes: number;
  benefits: number;
  totalCost: number;
}

export interface ProviderResult {
  employeeId: string;
  country: CountryCode;
  currency: string;
  month: string;
  gross: number;
  employerCost: number;
  net: number;
  providerRef: string;
}

export interface GlMapping {
  workdayAccount: string;
  workdayAccountName: string;
  netsuiteAccount: string;
  netsuiteAccountName: string;
  type: "Expense" | "Liability";
  owner: string;
}

export interface Dataset {
  companies: Company[];
  locations: Location[];
  costCenters: CostCenter[];
  workers: Worker[];
  events: WorkerEvent[];
  time: TimeRow[];
  balances: AbsenceBalance[];
  absences: AbsenceTaken[];
  ytd: Ytd[];
  garnishments: Garnishment[];
  legacy: LegacyRow[];
  provider: ProviderResult[];
  glMapping: GlMapping[];
}
