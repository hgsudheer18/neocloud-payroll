// CSV files → Dataset, with validation. Pure (no fs) so it runs on the server
// for the bundled files and in the browser for uploaded files.

import { parseCsv, type Row } from "../util/csv.ts";
import type { Dataset } from "./types.ts";

export interface LoadIssue {
  file: string;
  row?: number;
  severity: "Error" | "Warning";
  message: string;
}

export const FILES = {
  companies: "companies.csv",
  locations: "locations.csv",
  costCenters: "cost_centers.csv",
  workers: "workers.csv",
  events: "worker_events.csv",
  time: "timesheets.csv",
  balances: "absence_balances.csv",
  absences: "absence_requests.csv",
  ytd: "ytd_balances.csv",
  garnishments: "garnishments.csv",
  legacy: "legacy_rippling_register.csv",
  provider: "provider_results.csv",
  glMapping: "gl_account_mapping.csv",
} as const;

const REQUIRED: Record<keyof typeof FILES, string[]> = {
  companies: ["company_id", "name", "country", "currency", "netsuite_subsidiary_id"],
  locations: ["location_id", "name", "country", "company_id", "netsuite_location_id"],
  costCenters: ["cost_center_id", "name", "department", "company_id", "netsuite_department_id", "netsuite_class"],
  workers: ["employee_id", "worker_type", "department", "cost_center_id", "location_id", "work_state", "country", "flsa", "pay_type", "pay_group", "hire_date"],
  events: ["employee_id", "event", "effective_date", "field", "new_value"],
  time: ["row_id", "employee_id", "work_date", "time_in", "time_out"],
  balances: ["employee_id", "plan", "balance", "unit"],
  absences: ["employee_id", "plan", "date", "quantity", "unit", "status"],
  ytd: ["employee_id", "ytd_gross", "ytd_ss_wages"],
  garnishments: ["employee_id", "amount_per_period"],
  legacy: ["employee_id", "gross", "net"],
  provider: ["employee_id", "gross", "employer_cost"],
  glMapping: ["workday_account", "netsuite_account", "type"],
};

const num = (s: string | undefined) => {
  if (s === undefined || s === "") return 0;
  const n = Number(String(s).replace(/[$,£₹\s]|CAD|INR/g, ""));
  return Number.isFinite(n) ? n : NaN;
};
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export function loadDataset(texts: Partial<Record<string, string>>): { ds: Dataset; issues: LoadIssue[] } {
  const issues: LoadIssue[] = [];
  const get = (k: keyof typeof FILES): Row[] => {
    const name = FILES[k];
    const text = texts[name];
    if (text === undefined) {
      issues.push({ file: name, severity: ["legacy", "provider", "garnishments", "events"].includes(k) ? "Warning" : "Error", message: "File missing." });
      return [];
    }
    const rows = parseCsv(text);
    if (rows.length) {
      const missing = REQUIRED[k].filter((c) => !(c in rows[0]));
      if (missing.length) issues.push({ file: name, severity: "Error", message: `Missing columns: ${missing.join(", ")}` });
    }
    return rows;
  };
  const check = (file: string, i: number, cond: boolean, message: string, severity: "Error" | "Warning" = "Error") => {
    if (!cond) issues.push({ file, row: i + 2, severity, message });
  };

  const ds: Dataset = {
    companies: get("companies").map((r) => ({ id: r.company_id, name: r.name, country: r.country as never, currency: r.currency, netsuiteSubsidiaryId: r.netsuite_subsidiary_id, netsuiteSubsidiaryName: r.netsuite_subsidiary_name ?? "" })),
    locations: get("locations").map((r) => ({ id: r.location_id, name: r.name, country: r.country as never, state: r.state ?? "", companyId: r.company_id, netsuiteLocationId: r.netsuite_location_id })),
    costCenters: get("costCenters").map((r) => ({ id: r.cost_center_id, name: r.name, department: r.department, supervisoryOrg: r.supervisory_org ?? "", companyId: r.company_id, netsuiteDepartmentId: r.netsuite_department_id, netsuiteClass: r.netsuite_class })),
    workers: get("workers").map((r, i) => {
      const f = FILES.workers;
      check(f, i, isDate(r.hire_date), `${r.employee_id}: hire_date must be YYYY-MM-DD`);
      check(f, i, !r.termination_date || isDate(r.termination_date), `${r.employee_id}: termination_date must be YYYY-MM-DD`);
      check(f, i, !Number.isNaN(num(r.annual_salary)) && !Number.isNaN(num(r.hourly_rate)), `${r.employee_id}: salary/rate not numeric`);
      check(f, i, r.pay_type !== "Hourly" || num(r.hourly_rate) > 0 || r.worker_type === "Contractor", `${r.employee_id}: hourly worker without a rate`);
      check(f, i, r.worker_type !== "Contractor" || !r.pay_group, `${r.employee_id}: contractor assigned to pay group ${r.pay_group}`, "Warning");
      return {
        id: r.employee_id,
        name: r.name ?? r.employee_id,
        workerType: (r.worker_type as never) ?? "Employee",
        department: r.department,
        supervisoryOrg: r.supervisory_org ?? r.department,
        costCenterId: r.cost_center_id,
        locationId: r.location_id,
        workState: r.work_state,
        country: r.country as never,
        companyId: r.company_id,
        level: r.level ?? "",
        jobProfile: r.job_profile ?? "",
        flsa: r.flsa as never,
        payType: r.pay_type as never,
        annualSalary: num(r.annual_salary),
        hourlyRate: num(r.hourly_rate),
        currency: r.currency ?? "USD",
        payGroup: r.pay_group ?? "",
        hireDate: r.hire_date,
        terminationDate: r.termination_date ?? "",
        managerId: r.manager_id ?? "",
        status: r.status ?? "",
        filingStatus: (r.filing_status as never) || "Single",
        k401Pct: num(r.k401_pct),
        medicalPerPeriod: num(r.medical_per_period),
        shift: (r.shift as never) ?? "",
      };
    }),
    events: get("events").map((r, i) => {
      check(FILES.events, i, isDate(r.effective_date), `${r.employee_id}: effective_date must be YYYY-MM-DD`);
      return { employeeId: r.employee_id, event: r.event as never, effectiveDate: r.effective_date, field: r.field as never, oldValue: r.old_value ?? "", newValue: r.new_value, enteredOn: r.entered_on || r.effective_date, reason: r.reason ?? "" };
    }),
    time: get("time").map((r, i) => {
      check(FILES.time, i, /^\d{1,2}:\d{2}$/.test(r.time_in) && /^\d{1,2}:\d{2}$/.test(r.time_out), `${r.row_id}: in/out must be HH:MM (missing punch?)`);
      return { rowId: r.row_id, employeeId: r.employee_id, workDate: r.work_date, timeIn: r.time_in, timeOut: r.time_out, mealStart: r.meal_start === "—" ? "" : (r.meal_start ?? ""), mealEnd: r.meal_end === "—" ? "" : (r.meal_end ?? ""), shift: r.shift ?? "", entryType: (r.entry_type as never) || "Original", correctsRowId: r.corrects_row_id ?? "", enteredOn: r.entered_on || r.work_date, notes: r.notes ?? "" };
    }),
    balances: get("balances").map((r) => ({ employeeId: r.employee_id, plan: r.plan, balance: r.balance === "" || /unlimited|n\/a/i.test(r.balance) ? null : num(r.balance), unit: r.unit as never, lastAccrualDate: r.last_accrual_date ?? "", notes: r.notes ?? "" })),
    absences: get("absences").map((r) => ({ employeeId: r.employee_id, plan: r.plan, date: r.date, quantity: num(r.quantity), unit: r.unit as never, status: r.status as never })),
    ytd: get("ytd").map((r) => ({ employeeId: r.employee_id, periods: num(r.periods), gross: num(r.ytd_gross), ssWages: num(r.ytd_ss_wages), medicareWages: num(r.ytd_medicare_wages), futaWages: num(r.ytd_futa_wages), suiWages: num(r.ytd_sui_wages) })),
    garnishments: get("garnishments").map((r) => ({ employeeId: r.employee_id, type: r.type ?? "", amountPerPeriod: num(r.amount_per_period), maxPctDisposable: num(r.max_pct_disposable) || 0.6, caseId: r.case_id ?? "", payee: r.payee ?? "" })),
    legacy: get("legacy").map((r) => ({
      employeeId: r.employee_id, name: r.name ?? "", regularPay: num(r.regular_pay), overtimePay: num(r.overtime_pay), premiumPay: num(r.premium_pay), otherPay: num(r.other_pay), gross: num(r.gross),
      preTaxDeductions: num(r.pre_tax_deductions), fit: num(r.fit), ssEe: num(r.ss_ee), medicareEe: num(r.medicare_ee), stateTax: num(r.state_tax), stateOther: num(r.state_other),
      postTaxDeductions: num(r.post_tax_deductions), net: num(r.net), ssEr: num(r.ss_er), medicareEr: num(r.medicare_er), futa: num(r.futa), sui: num(r.sui), employerTaxes: num(r.employer_taxes), benefits: num(r.benefits), totalCost: num(r.total_cost),
    })),
    provider: get("provider").map((r) => ({ employeeId: r.employee_id, country: r.country as never, currency: r.currency, month: r.month, gross: num(r.gross), employerCost: num(r.employer_cost), net: num(r.net), providerRef: r.provider_ref ?? "" })),
    glMapping: get("glMapping").map((r) => ({ workdayAccount: r.workday_account, workdayAccountName: r.workday_account_name ?? "", netsuiteAccount: r.netsuite_account, netsuiteAccountName: r.netsuite_account_name ?? "", type: r.type as never, owner: r.owner ?? "" })),
  };

  // Referential checks
  const ids = new Set(ds.workers.map((w) => w.id));
  const dup = ds.workers.filter((w, i) => ds.workers.findIndex((x) => x.id === w.id) !== i);
  for (const d of dup) issues.push({ file: FILES.workers, severity: "Error", message: `Duplicate employee_id ${d.id}` });
  const ccs = new Set(ds.costCenters.map((c) => c.id));
  const locs = new Set(ds.locations.map((l) => l.id));
  for (const w of ds.workers) {
    if (!ccs.has(w.costCenterId)) issues.push({ file: FILES.workers, severity: "Error", message: `${w.id}: unknown cost center ${w.costCenterId}` });
    if (!locs.has(w.locationId)) issues.push({ file: FILES.workers, severity: "Error", message: `${w.id}: unknown location ${w.locationId}` });
  }
  for (const r of ds.time) if (!ids.has(r.employeeId)) issues.push({ file: FILES.time, severity: "Error", message: `${r.rowId}: unknown employee ${r.employeeId}` });
  for (const r of ds.events) if (!ids.has(r.employeeId)) issues.push({ file: FILES.events, severity: "Error", message: `Event for unknown employee ${r.employeeId}` });
  return { ds, issues };
}
