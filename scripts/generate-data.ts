// Generates the full NeoCloud data package from the hiring team's samples.
//
// The package we received contained only sample rows ("Extend the samples to
// the full population before sending"). This script extends them
// deterministically (seeded PRNG), keeping every sample row exactly as given,
// and adds each edge case the brief describes. It then produces:
//   - the legacy Rippling register, by re-running the engine with the legacy
//     system's known configuration and the seeded errors listed in LEGACY_ERRORS;
//   - the provider results file, with one late-change timing difference.
// The reconciliation engine never reads LEGACY_ERRORS: it has to rediscover
// every variance from the data.
//
// Run: npm run generate   (writes ./data/*.csv)

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toCsv } from "../lib/util/csv.ts";
import { addDays, eachDay, dayOfWeek } from "../lib/util/dates.ts";
import { loadDataset } from "../lib/data/load.ts";
import { calcUsWorker, isUsPayrollWorker, type Variant } from "../lib/engine/build.ts";
import { calcIntlWorker, isIntlWorker } from "../lib/engine/intl.ts";
import { toLegacyColumns } from "../lib/engine/payroll.ts";
import { US_PERIOD, INTL_PERIOD } from "../lib/config/period.ts";
import { COUNTRY_RULES } from "../lib/config/intl.ts";

const OUT = join(process.cwd(), "data");
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- PRNG
let seed = 20261015;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(a: T[]): T => a[Math.floor(rand() * a.length)];
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);

const FIRST = ["Ava", "Liam", "Noah", "Mia", "Ethan", "Zoe", "Arjun", "Priya", "Lucas", "Emma", "Diego", "Sofia", "Kenji", "Aisha", "Omar", "Grace", "Mateo", "Chloe", "Ravi", "Isla", "Jonah", "Leah", "Wei", "Nina", "Caleb", "Maya", "Hugo", "Elena", "Sami", "Iris", "Theo", "Lena", "Rohan", "Ana", "Felix", "Hana", "Victor", "Julia", "Kai", "Nora"];
const LAST = ["Patel", "Nguyen", "Garcia", "Kim", "Smith", "Chen", "Johnson", "Singh", "Lopez", "Brown", "Okafor", "Martin", "Rossi", "Silva", "Tanaka", "Murphy", "Khan", "Davis", "Ivanova", "Reyes", "Walker", "Sato", "Ali", "Moreau", "Hughes", "Costa", "Bauer", "Iyer", "Fischer", "Novak"];
let nameIdx = 0;
const name = () => `${FIRST[nameIdx % FIRST.length]} ${LAST[(nameIdx++ * 7) % LAST.length]}`;

// ---------------------------------------------------------------- reference data
const companies = [
  { company_id: "NC-US", name: "NeoCloud Inc.", country: "USA", currency: "USD", netsuite_subsidiary_id: "1", netsuite_subsidiary_name: "NeoCloud Inc. (US)" },
  { company_id: "NC-CA", name: "NeoCloud Canada Ltd.", country: "CAN", currency: "CAD", netsuite_subsidiary_id: "2", netsuite_subsidiary_name: "NeoCloud Canada Ltd." },
  { company_id: "NC-UK", name: "NeoCloud UK Ltd.", country: "GBR", currency: "GBP", netsuite_subsidiary_id: "3", netsuite_subsidiary_name: "NeoCloud UK Ltd." },
  { company_id: "NC-IN", name: "NeoCloud India Pvt. Ltd.", country: "IND", currency: "INR", netsuite_subsidiary_id: "4", netsuite_subsidiary_name: "NeoCloud India Pvt. Ltd." },
];
const locations = [
  { location_id: "SF", name: "San Francisco HQ", country: "USA", state: "CA", company_id: "NC-US", netsuite_location_id: "101" },
  { location_id: "SJ", name: "San Jose Data Center", country: "USA", state: "CA", company_id: "NC-US", netsuite_location_id: "102" },
  { location_id: "AUS", name: "Austin Data Center", country: "USA", state: "TX", company_id: "NC-US", netsuite_location_id: "103" },
  { location_id: "REMOTE-US", name: "Remote - US", country: "USA", state: "", company_id: "NC-US", netsuite_location_id: "199" },
  { location_id: "LON", name: "London", country: "GBR", state: "ENG", company_id: "NC-UK", netsuite_location_id: "301" },
  { location_id: "TOR", name: "Toronto", country: "CAN", state: "ON", company_id: "NC-CA", netsuite_location_id: "201" },
  { location_id: "BLR", name: "Bangalore", country: "IND", state: "KA", company_id: "NC-IN", netsuite_location_id: "401" },
];
const costCenters = [
  ["CC1100", "GPU Cloud - Product & Sales", "GPU Cloud", "GPU Cloud (E0002)", "NC-US", "110", "Sales & Marketing"],
  ["CC1200", "GPU Cloud - Cloud Operations", "GPU Cloud", "Cloud Operations (E0002)", "NC-US", "120", "Cost of Revenue"],
  ["CC1300", "GPU Cloud - UK Sales", "GPU Cloud", "GPU Cloud UK (E0002)", "NC-UK", "130", "Sales & Marketing"],
  ["CC2100", "On-Prem - Data Center Operations", "On-Prem", "Data Center Ops (E0005)", "NC-US", "210", "Cost of Revenue"],
  ["CC2200", "On-Prem - Solutions & Field Sales", "On-Prem", "On-Prem Solutions (E0005)", "NC-US", "220", "Sales & Marketing"],
  ["CC2300", "On-Prem - UK Field Operations", "On-Prem", "On-Prem UK (E0005)", "NC-UK", "230", "Cost of Revenue"],
  ["CC3100", "Engineering - Platform", "Engineering", "Platform Engineering (E0007)", "NC-US", "310", "Research & Development"],
  ["CC3200", "Engineering - Infrastructure", "Engineering", "Infrastructure Engineering (E0007)", "NC-US", "320", "Research & Development"],
  ["CC3300", "Engineering - India", "Engineering", "Engineering India (E0007)", "NC-IN", "330", "Research & Development"],
  ["CC3400", "Engineering - Canada", "Engineering", "Engineering Canada (E0007)", "NC-CA", "340", "Research & Development"],
  ["CC4100", "G&A - Finance & Accounting", "G&A", "Finance (E0010)", "NC-US", "410", "General & Administrative"],
  ["CC4200", "G&A - People", "G&A", "People (E0010)", "NC-US", "420", "General & Administrative"],
  ["CC4300", "G&A - Legal, IT & Security", "G&A", "Legal & IT (E0010)", "NC-US", "430", "General & Administrative"],
].map(([cost_center_id, n, department, supervisory_org, company_id, netsuite_department_id, netsuite_class]) => ({ cost_center_id, name: n, department, supervisory_org, company_id, netsuite_department_id, netsuite_class }));
const soFor = (cc: string) => costCenters.find((c) => c.cost_center_id === cc)!.supervisory_org;

const glMapping = [
  ["6100", "Salaries & Wages", "60100", "Payroll : Salaries and Wages", "Expense", "Controller"],
  ["6110", "Overtime & Double Time", "60110", "Payroll : Overtime", "Expense", "Controller"],
  ["6120", "Shift Differential & Premium Pay", "60120", "Payroll : Premium Pay", "Expense", "Controller"],
  ["6130", "Bonus", "60130", "Payroll : Bonus", "Expense", "Controller"],
  ["6200", "Employer Payroll Taxes", "60200", "Payroll : Employer Taxes", "Expense", "Controller"],
  ["6300", "Employee Benefits (Employer)", "60300", "Payroll : Benefits", "Expense", "Controller"],
  ["6400", "Intercompany Service Cost", "60400", "Intercompany : Service Cost", "Expense", "Controller"],
  ["6900", "Intercompany Recharge (contra)", "60900", "Intercompany : Payroll Recharge", "Expense", "Controller"],
  ["1300", "Intercompany Receivable", "13000", "Intercompany Receivable", "Liability", "Controller"],
  ["2100", "Net Pay Payable", "21000", "Accrued Payroll : Net Pay Clearing", "Liability", "Payroll Manager"],
  ["2110", "Federal Income Tax Withheld", "21100", "Payroll Liabilities : Federal Withholding", "Liability", "Payroll Manager"],
  ["2111", "FICA Payable (EE + ER)", "21110", "Payroll Liabilities : FICA", "Liability", "Payroll Manager"],
  ["2112", "FUTA Payable", "21120", "Payroll Liabilities : FUTA", "Liability", "Payroll Manager"],
  ["2113", "SUI Payable", "21130", "Payroll Liabilities : SUI", "Liability", "Payroll Manager"],
  ["2114", "State Income Tax Withheld", "21140", "Payroll Liabilities : State Withholding", "Liability", "Payroll Manager"],
  ["2115", "State Disability / PFL / LTC Withheld", "21150", "Payroll Liabilities : State Programs", "Liability", "Payroll Manager"],
  ["2116", "Employer Statutory Contributions (Intl)", "21160", "Payroll Liabilities : Employer Statutory", "Liability", "Payroll Manager"],
  ["2117", "Employee Statutory Withholdings (Intl)", "21170", "Payroll Liabilities : Employee Statutory", "Liability", "Payroll Manager"],
  ["2120", "401(k) Deferrals Payable", "21200", "Benefit Liabilities : 401(k)", "Liability", "Benefits Manager"],
  ["2121", "Medical Premiums Payable", "21210", "Benefit Liabilities : Medical", "Liability", "Benefits Manager"],
  ["2122", "Garnishments Payable", "21220", "Payroll Liabilities : Garnishments", "Liability", "Payroll Manager"],
  ["2130", "Accrued Benefits (Employer)", "21300", "Accrued Benefits", "Liability", "Benefits Manager"],
  ["2150", "Accrued PTO", "21500", "Accrued Vacation", "Liability", "Controller"],
  ["2300", "Intercompany Payable", "23000", "Intercompany Payable", "Liability", "Controller"],
].map(([workday_account, workday_account_name, netsuite_account, netsuite_account_name, type, owner]) => ({ workday_account, workday_account_name, netsuite_account, netsuite_account_name, type, owner }));

// ---------------------------------------------------------------- workers
type W = Record<string, string | number>;
const workers: W[] = [];
const used = new Set<string>();
const id = (n: number) => `E${String(n).padStart(4, "0")}`;

const BANDS: Record<string, number> = { IC1: 110_000, IC2: 130_000, IC3: 155_000, IC4: 180_000, IC5: 205_000, IC6: 255_000, M3: 195_000, M4: 205_000, M5: 260_000, M6: 300_000 };
const JOB: Record<string, string> = {
  "GPU Cloud": "Cloud Solutions", "On-Prem": "Infrastructure Solutions", Engineering: "Software Engineer", "G&A": "Business Operations",
};

function avoidWageBaseBand(s: number): number {
  // Keep most generated salaries out of the band where the exercise and actual
  // Social Security wage bases differ (pre-tax medical can still pull a few in).
  return s >= 212_000 && s <= 247_000 ? (s < 230_000 ? 208_000 : 250_000) : s;
}

function us(o: Partial<W> & { id: string }): W {
  const level = (o.level as string) ?? "IC3";
  const dept = (o.department as string) ?? "Engineering";
  const salary = o.annual_salary ?? (o.pay_type === "Hourly" ? 0 : avoidWageBaseBand(Math.round((BANDS[level] ?? 150_000) * between(0.92, 1.08) / 1000) * 1000));
  const cc = (o.cost_center_id as string) ?? "CC3100";
  const w: W = {
    employee_id: o.id,
    name: o.name ?? name(),
    worker_type: "Employee",
    department: dept,
    supervisory_org: soFor(cc),
    cost_center_id: cc,
    location_id: o.location_id ?? "SF",
    work_state: o.work_state ?? "CA",
    country: "USA",
    company_id: "NC-US",
    level,
    job_profile: o.job_profile ?? `${JOB[dept]} ${level}`,
    flsa: o.flsa ?? "Exempt",
    pay_type: o.pay_type ?? "Salary",
    annual_salary: salary,
    hourly_rate: o.hourly_rate ?? 0,
    currency: "USD",
    pay_group: "US Semi-Monthly",
    hire_date: o.hire_date ?? `20${pick(["19", "20", "21", "22", "23", "24", "25"])}-${String(1 + Math.floor(rand() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rand() * 27)).padStart(2, "0")}`,
    termination_date: o.termination_date ?? "",
    manager_id: o.manager_id ?? "E0007",
    status: o.status ?? "Active",
    filing_status: o.filing_status ?? (rand() < 0.6 ? "Single" : "MFJ"),
    k401_pct: o.k401_pct ?? pick([0, 0.03, 0.05, 0.06, 0.06, 0.08, 0.1]),
    medical_per_period: o.medical_per_period ?? pick([0, 85, 145, 145, 210]),
    shift: o.shift ?? "",
  };
  used.add(o.id);
  workers.push(w);
  return w;
}

// Sample rows from the brief, exactly as given (plus the fields the brief did not include).
us({ id: "E0000", name: "Morgan Hale", department: "G&A", level: "M6", annual_salary: 400_000, cost_center_id: "CC4100", job_profile: "Chief Executive Officer", manager_id: "", hire_date: "2019-02-01" });
us({ id: "E0001", department: "GPU Cloud", location_id: "SF", work_state: "CA", level: "M5", annual_salary: 285_000, hire_date: "2022-03-15", manager_id: "E0000", cost_center_id: "CC1100" });
us({ id: "E0002", department: "GPU Cloud", level: "M6", annual_salary: 300_000, hire_date: "2020-05-04", manager_id: "E0000", cost_center_id: "CC1100", job_profile: "VP, GPU Cloud" });
us({ id: "E0003", department: "GPU Cloud", level: "M4", annual_salary: 230_000, hire_date: "2021-06-14", manager_id: "E0002", cost_center_id: "CC1200" });
us({ id: "E0004", department: "GPU Cloud", location_id: "REMOTE-US", work_state: "WA", level: "IC3", annual_salary: 160_000, hire_date: "2023-08-20", manager_id: "E0002", cost_center_id: "CC1100" });
us({ id: "E0005", department: "On-Prem", location_id: "SJ", level: "M6", annual_salary: 280_000, hire_date: "2020-09-01", manager_id: "E0000", cost_center_id: "CC2100", job_profile: "VP, On-Prem" });
us({ id: "E0007", department: "Engineering", level: "M6", annual_salary: 310_000, hire_date: "2020-01-13", manager_id: "E0000", cost_center_id: "CC3100", job_profile: "VP, Engineering" });
us({ id: "E0010", department: "G&A", level: "M6", annual_salary: 300_000, hire_date: "2021-01-11", manager_id: "E0000", cost_center_id: "CC4100", job_profile: "Chief Financial Officer" });
us({ id: "E0012", department: "Engineering", level: "M4", annual_salary: 220_000, hire_date: "2022-02-07", manager_id: "E0007", cost_center_id: "CC3200" });
us({ id: "E0015", department: "G&A", level: "M4", annual_salary: 240_000, hire_date: "2022-10-03", manager_id: "E0010", cost_center_id: "CC4100", job_profile: "Corporate Controller" });

// Non-exempt data center technicians (sample E0021 CA, E0022 TX + extension to 25).
const CA_TECHS = ["E0021", ...Array.from({ length: 14 }, (_, i) => id(23 + i))];
const TX_TECHS = ["E0022", ...Array.from({ length: 9 }, (_, i) => id(37 + i))];
for (const t of CA_TECHS) {
  us({ id: t, department: "On-Prem", location_id: "SJ", work_state: "CA", level: t === "E0021" ? "T2" : pick(["T1", "T2", "T2", "T3"]), flsa: "Non-Exempt", pay_type: "Hourly", annual_salary: 0, hourly_rate: t === "E0021" ? 42 : Math.round(between(36, 48) * 4) / 4, hire_date: t === "E0021" ? "2024-05-06" : `202${pick(["2", "3", "4", "5"])}-0${1 + Math.floor(rand() * 9)}-1${Math.floor(rand() * 9)}`, manager_id: "E0005", cost_center_id: "CC2100", job_profile: "Data Center Technician", shift: ["E0027", "E0028"].includes(t) ? "Night" : "Day", k401_pct: pick([0, 0.03, 0.05]), medical_per_period: pick([0, 85, 145]) });
}
for (const t of TX_TECHS) {
  us({ id: t, department: "On-Prem", location_id: "AUS", work_state: "TX", level: t === "E0022" ? "T2" : pick(["T1", "T2", "T3"]), flsa: "Non-Exempt", pay_type: "Hourly", annual_salary: 0, hourly_rate: t === "E0022" ? 38 : Math.round(between(32, 40) * 4) / 4, hire_date: t === "E0022" ? "2024-07-15" : `202${pick(["2", "3", "4", "5"])}-0${1 + Math.floor(rand() * 9)}-0${1 + Math.floor(rand() * 8)}`, manager_id: "E0005", cost_center_id: "CC2100", job_profile: "Data Center Technician", shift: ["E0022", "E0039"].includes(t) ? "Night" : "Day", k401_pct: pick([0, 0.03, 0.05]), medical_per_period: pick([0, 85, 145]) });
}

// Edge-case workers
us({ id: "E0057", name: "Dana Whitfield", department: "Engineering", level: "IC4", annual_salary: 175_000, hire_date: "2023-03-06", manager_id: "E0007", cost_center_id: "CC3100" }); // comp change on the 10th
us({ id: "E0088", name: "Riley Thompson", department: "GPU Cloud", level: "IC4", annual_salary: 172_000, hire_date: "2022-11-14", manager_id: "E0002", cost_center_id: "CC1100", location_id: "SF", work_state: "CA" }); // CA → CO
us({ id: "E0148", department: "GPU Cloud", location_id: "SF", work_state: "CA", level: "IC3", annual_salary: 165_000, hire_date: "2024-09-10", manager_id: "E0002", cost_center_id: "CC1100", status: "Termination Pending (last day in period)", termination_date: "2026-10-09", k401_pct: 0.05, medical_per_period: 145 });
us({ id: "E0149", department: "G&A", location_id: "REMOTE-US", work_state: "NY", level: "IC4", annual_salary: 180_000, hire_date: "2024-04-01", manager_id: "E0010", cost_center_id: "CC4200", status: "On Leave (unpaid, started mid-period)", k401_pct: 0.06, medical_per_period: 210 });
us({ id: "E0203", department: "Engineering", location_id: "SF", work_state: "CA", level: "IC4", annual_salary: 190_000, hire_date: "2026-10-12", manager_id: "E0007", cost_center_id: "CC3100", status: "New Hire", k401_pct: 0, medical_per_period: 0 });
us({ id: "E0345", department: "G&A", location_id: "SF", work_state: "CA", level: "IC2", annual_salary: 128_000, hire_date: "2026-10-14", manager_id: "E0010", cost_center_id: "CC4100", status: "New Hire", k401_pct: 0, medical_per_period: 0 });
us({ id: "E0346", department: "Engineering", location_id: "REMOTE-US", work_state: "CO", level: "IC3", annual_salary: 152_000, hire_date: "2026-09-08", manager_id: "E0007", cost_center_id: "CC3200" }); // recent hire: FUTA/SUI still due

// Fill the rest of the US population to 280 employees.
const remoteStates = ["WA", "NY", "CO", "IL", "MA", "TX", "FL", "WA", "NY", "TX"];
const usPlan: [string, string, number][] = [["GPU Cloud", "CC1100", 46], ["GPU Cloud", "CC1200", 26], ["On-Prem", "CC2200", 38], ["Engineering", "CC3100", 57], ["Engineering", "CC3200", 36], ["G&A", "CC4100", 14], ["G&A", "CC4200", 10], ["G&A", "CC4300", 12]];
let next = 11;
const nextId = () => {
  while (used.has(id(next)) || (next >= 300 && next <= 349) || [148, 149, 203].includes(next)) next++;
  return id(next++);
};
const usCountTarget = 280;
outer: for (const [dept, cc, n] of usPlan) {
  for (let i = 0; i < n; i++) {
    if (workers.length >= usCountTarget) break outer;
    const remote = rand() < 0.25;
    const st = remote ? pick(remoteStates) : "CA";
    us({ id: nextId(), department: dept, cost_center_id: cc, level: pick(["IC1", "IC2", "IC3", "IC3", "IC4", "IC4", "IC5", "IC6", "M3", "M4"]), location_id: remote ? "REMOTE-US" : dept === "On-Prem" ? pick(["SJ", "SF", "AUS"]) : "SF", work_state: st, manager_id: { "GPU Cloud": "E0002", "On-Prem": "E0005", Engineering: "E0007", "G&A": "E0010" }[dept] });
  }
}
for (const w of workers) if (w.location_id === "AUS") w.work_state = "TX";

// International
function intl(o: Partial<W> & { id: string; country: "GBR" | "CAN" | "IND" }): W {
  const cfg = { GBR: ["LON", "ENG", "NC-UK", "GBP", "UK Monthly", [55_000, 120_000]], CAN: ["TOR", "ON", "NC-CA", "CAD", "Canada Monthly", [110_000, 240_000]], IND: ["BLR", "KA", "NC-IN", "INR", "India Monthly", [1_800_000, 6_000_000]] }[o.country] as [string, string, string, string, string, number[]];
  const w: W = {
    employee_id: o.id, name: o.name ?? name(), worker_type: "Employee", department: o.department ?? "Engineering", supervisory_org: soFor((o.cost_center_id as string) ?? "CC3300"), cost_center_id: o.cost_center_id ?? "CC3300",
    location_id: cfg[0], work_state: cfg[1], country: o.country, company_id: cfg[2], level: o.level ?? pick(["IC2", "IC3", "IC4", "IC5"]), job_profile: o.job_profile ?? `${JOB[(o.department as string) ?? "Engineering"]} ${o.level ?? "IC3"}`,
    flsa: "N/A", pay_type: "Salary", annual_salary: o.annual_salary ?? Math.round(between(cfg[5][0], cfg[5][1]) / 1000) * 1000, hourly_rate: 0, currency: cfg[3], pay_group: cfg[4],
    hire_date: o.hire_date ?? `202${pick(["2", "3", "4", "5"])}-0${1 + Math.floor(rand() * 9)}-1${Math.floor(rand() * 9)}`, termination_date: o.termination_date ?? "", manager_id: o.manager_id ?? "E0007", status: o.status ?? "Active",
    filing_status: "", k401_pct: 0, medical_per_period: 0, shift: "",
  };
  used.add(o.id);
  workers.push(w);
  return w;
}
intl({ id: "E0006", country: "GBR", department: "On-Prem", level: "IC4", annual_salary: 85_000, hire_date: "2024-02-18", manager_id: "E0005", cost_center_id: "CC2300" });
intl({ id: "E0008", country: "CAN", department: "Engineering", level: "IC5", annual_salary: 225_000, hire_date: "2023-04-03", manager_id: "E0007", cost_center_id: "CC3100" }); // US-owned cost centre → intercompany
intl({ id: "E0009", country: "IND", department: "Engineering", level: "IC4", annual_salary: 4_500_000, hire_date: "2023-11-22", manager_id: "E0007", cost_center_id: "CC3300" });
intl({ id: "E0315", country: "GBR", department: "GPU Cloud", level: "IC3", annual_salary: 68_000, hire_date: "2023-05-15", manager_id: "E0002", cost_center_id: "CC1300", termination_date: "2026-10-23", status: "Termination Pending" });
intl({ id: "E0318", country: "GBR", department: "On-Prem", level: "IC3", annual_salary: 72_000, hire_date: "2022-09-05", manager_id: "E0005", cost_center_id: "CC2300", status: "On Leave (statutory maternity)" });
intl({ id: "E0330", country: "IND", department: "Engineering", level: "IC4", annual_salary: 3_200_000, hire_date: "2023-02-01", manager_id: "E0007", cost_center_id: "CC3300" });
intl({ id: "E0340", country: "CAN", department: "Engineering", level: "IC3", annual_salary: 135_000, hire_date: "2026-10-15", manager_id: "E0007", cost_center_id: "CC3400", status: "New Hire" });
const intlFill: ["GBR" | "CAN" | "IND", string, string, number][] = [["GBR", "GPU Cloud", "CC1300", 11], ["GBR", "On-Prem", "CC2300", 9], ["CAN", "Engineering", "CC3400", 24], ["IND", "Engineering", "CC3300", 18]];
let ni = 300;
for (const [c, dept, cc, n] of intlFill) {
  for (let i = 0; i < n; i++) {
    while (used.has(id(ni))) ni++;
    intl({ id: id(ni++), country: c, department: dept, cost_center_id: cc, manager_id: { "GPU Cloud": "E0002", "On-Prem": "E0005", Engineering: "E0007" }[dept] });
  }
}

// Contractors: in the worker file, never in payroll.
for (let i = 1; i <= 5; i++) {
  const dept = pick(["GPU Cloud", "Engineering", "Engineering", "G&A"]);
  const cc = { "GPU Cloud": "CC1100", Engineering: "CC3200", "G&A": "CC4300" }[dept]!;
  workers.push({
    employee_id: `C000${i}`, name: name(), worker_type: "Contractor", department: dept, supervisory_org: soFor(cc), cost_center_id: cc, location_id: "SF", work_state: "CA", country: "USA", company_id: "NC-US",
    level: "", job_profile: "Contingent Worker", flsa: "N/A", pay_type: "Salary", annual_salary: i === 3 ? 156_000 : Math.round(between(120_000, 200_000) / 1000) * 1000, hourly_rate: 0, currency: "USD", pay_group: "",
    hire_date: "2026-01-05", termination_date: "", manager_id: "E0007", status: "Contractor", filing_status: "Single", k401_pct: 0, medical_per_period: 0, shift: "",
  });
}

// ---------------------------------------------------------------- events
const events = [
  { employee_id: "E0057", event: "Comp Change", effective_date: "2026-10-10", field: "annualSalary", old_value: "175000", new_value: "195000", entered_on: "2026-10-08", reason: "Promotion adjustment" },
  { employee_id: "E0088", event: "Location Change", effective_date: "2026-10-06", field: "workState", old_value: "CA", new_value: "CO", entered_on: "2026-10-02", reason: "Relocated to Denver (remote)" },
  { employee_id: "E0088", event: "Location Change", effective_date: "2026-10-06", field: "locationId", old_value: "SF", new_value: "REMOTE-US", entered_on: "2026-10-02", reason: "Relocated to Denver (remote)" },
  { employee_id: "E0149", event: "Leave of Absence", effective_date: "2026-10-08", field: "status", old_value: "Active", new_value: "On Leave", entered_on: "2026-10-13", reason: "Unpaid personal leave" },
  { employee_id: "E0318", event: "Leave of Absence", effective_date: "2026-08-03", field: "status", old_value: "Active", new_value: "On Leave - Paid", entered_on: "2026-07-20", reason: "Statutory maternity leave (enhanced to full pay for 26 weeks)" },
  { employee_id: "E0330", event: "Comp Change", effective_date: "2026-10-01", field: "annualSalary", old_value: "3200000", new_value: "3600000", entered_on: "2026-10-22", reason: "Annual merit (approved late)" },
];

// ---------------------------------------------------------------- timesheets
const timeRows: W[] = [];
let rowN = 1;
const tr = (emp: string, date: string, i: string, o: string, ms = "", me = "", shift = "Day", notes = "", extra: Partial<W> = {}) => {
  const r: W = { row_id: `T${String(rowN++).padStart(5, "0")}`, employee_id: emp, work_date: date, time_in: i, time_out: o, meal_start: ms, meal_end: me, shift, entry_type: "Original", corrects_row_id: "", entered_on: date, notes, ...extra };
  timeRows.push(r);
  return r;
};
const DATES = eachDay("2026-09-27", "2026-10-15");
const weekdays = DATES.filter((d) => dayOfWeek(d) >= 1 && dayOfWeek(d) <= 5);

function standardDay(emp: string, d: string) {
  const long = rand() < 0.18;
  if (long) tr(emp, d, "06:00", "16:00", "10:30", "11:00", "Day", "Over 8 hours");
  else tr(emp, d, "06:00", "14:30", "10:30", "11:00", "Day");
}
function nightDay(emp: string, d: string) {
  tr(emp, d, "22:00", "06:30", "02:00", "02:30", "Night", "Crosses midnight");
}

const absenceReq: W[] = [];
for (const emp of [...CA_TECHS, ...TX_TECHS]) {
  if (emp === "E0021") {
    for (const d of ["2026-09-28", "2026-09-29", "2026-09-30"]) tr(emp, d, "06:00", "14:30", "10:30", "11:00");
    tr(emp, "2026-10-01", "06:00", "16:30", "11:15", "11:45", "Day", "Day 1");
    tr(emp, "2026-10-02", "06:00", "19:15", "12:45", "13:15", "Day", "Day 2: Meal started after 5th hour");
    tr(emp, "2026-10-03", "06:00", "15:00", "", "", "Day", "Day 3: No meal recorded");
    for (const d of weekdays.filter((x) => x >= "2026-10-05")) tr(emp, d, "06:00", "14:30", "10:30", "11:00");
    continue;
  }
  if (emp === "E0022") {
    tr(emp, "2026-09-30", "08:00", "16:30", "12:00", "12:30");
    tr(emp, "2026-10-01", "22:00", "06:30", "02:00", "02:30", "Night", "Day 1: Crosses midnight");
    for (const d of ["2026-10-02", "2026-10-03", "2026-10-04"]) nightDay(emp, d);
    tr(emp, "2026-10-05", "14:00", "22:30", "18:00", "18:30", "Swing", "Rotation to day shift");
    tr(emp, "2026-10-06", "08:00", "17:00", "12:00", "12:30", "Day", "Day 6: 7th consecutive day worked");
    for (const d of ["2026-10-07", "2026-10-08", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"]) tr(emp, d, "08:00", "16:30", "12:00", "12:30");
    continue;
  }
  if (emp === "E0025") {
    for (const d of weekdays.filter((x) => x < "2026-10-04")) tr(emp, d, "06:00", "14:30", "10:30", "11:00");
    for (const d of eachDay("2026-10-04", "2026-10-09")) tr(emp, d, "06:00", "14:30", "10:30", "11:00", "Day", d === "2026-10-04" ? "Weekend coverage" : "");
    tr(emp, "2026-10-10", "06:00", "16:00", "10:30", "11:00", "Day", "7th consecutive day in workweek");
    for (const d of weekdays.filter((x) => x >= "2026-10-12")) tr(emp, d, "06:00", "14:30", "10:30", "11:00");
    continue;
  }
  const night = ["E0027", "E0028", "E0039"].includes(emp);
  for (const d of weekdays) {
    if (emp === "E0024" && d === "2026-10-09") continue; // vacation
    if (emp === "E0026" && d === "2026-10-14") continue; // sick
    if (emp === "E0038" && d === "2026-10-13") continue; // vacation
    if (night) {
      if (emp === "E0027" && d === "2026-10-07") tr(emp, d, "22:00", "08:30", "02:00", "02:30", "Night", "Held over 2 hrs");
      else nightDay(emp, d);
      continue;
    }
    if (emp === "E0029" && d === "2026-10-08") { tr(emp, d, "05:00", "19:30", "10:00", "10:30", "Day", "Outage response: 14 hrs"); continue; }
    if (emp === "E0030" && d === "2026-10-13") { tr(emp, d, "06:00", "14:30", "11:30", "12:00", "Day", "Late meal"); continue; }
    if (emp === "E0031" && d === "2026-10-06") { tr(emp, d, "06:00", "12:30", "", "", "Day", "No meal recorded"); continue; }
    if (emp === "E0032" && d === "2026-10-14") { tr(emp, d, "06:00", "14:30", "10:30", "10:50", "Day", "Short meal"); continue; }
    if (emp === "E0033" && d === "2026-09-30") {
      const orig = tr(emp, d, "06:00", "12:00", "11:00", "11:30", "Day", "Missed clock-out (paid as recorded in prior period)");
      tr(emp, d, "06:00", "16:30", "11:00", "11:30", "Day", "Supervisor correction: actual clock-out 16:30", { entry_type: "Correction", corrects_row_id: orig.row_id, entered_on: "2026-10-06" });
      continue;
    }
    standardDay(emp, d);
    if (emp === "E0035" && d === "2026-10-07") {
      const last = timeRows[timeRows.length - 1];
      tr(emp, d, String(last.time_in), String(last.time_out), String(last.meal_start), String(last.meal_end), "Day", "Duplicate punch (submitted twice)");
    }
  }
  if (emp === "E0040") for (const d of ["2026-10-10"]) tr(emp, d, "06:00", "14:30", "10:30", "11:00", "Day", "Saturday coverage: 6th day");
}
absenceReq.push(
  { employee_id: "E0024", plan: "US_HOURLY_VAC", date: "2026-10-09", quantity: 8, unit: "hours", status: "Approved" },
  { employee_id: "E0026", plan: "CA_SICK", date: "2026-10-14", quantity: 8, unit: "hours", status: "Approved" },
  { employee_id: "E0038", plan: "US_HOURLY_VAC", date: "2026-10-13", quantity: 8, unit: "hours", status: "Approved" },
  { employee_id: "E0041", plan: "US_HOURLY_VAC", date: "2026-10-23", quantity: 8, unit: "hours", status: "Submitted" },
  { employee_id: "E0004", plan: "US_FLEX_PTO", date: "2026-10-05", quantity: 8, unit: "hours", status: "Approved" },
  { employee_id: "E0004", plan: "US_FLEX_PTO", date: "2026-10-06", quantity: 8, unit: "hours", status: "Approved" },
  { employee_id: "E0001", plan: "US_FLEX_PTO", date: "2026-10-13", quantity: 8, unit: "hours", status: "Approved" },
  { employee_id: "E0006", plan: "UK_ANNUAL", date: "2026-10-19", quantity: 1, unit: "days", status: "Approved" },
  { employee_id: "E0006", plan: "UK_ANNUAL", date: "2026-10-20", quantity: 1, unit: "days", status: "Approved" },
  { employee_id: "E0008", plan: "CAN_ON_VAC", date: "2026-10-23", quantity: 1, unit: "days", status: "Approved" },
  { employee_id: "E0009", plan: "IND_EL", date: "2026-10-26", quantity: 1, unit: "days", status: "Approved" },
  { employee_id: "E0009", plan: "IND_EL", date: "2026-10-27", quantity: 1, unit: "days", status: "Approved" },
  { employee_id: "E0009", plan: "IND_EL", date: "2026-10-28", quantity: 1, unit: "days", status: "Approved" },
  { employee_id: "E0315", plan: "UK_ANNUAL", date: "2026-10-16", quantity: 1, unit: "days", status: "Approved" },
);

// ---------------------------------------------------------------- balances & YTD
const balances: W[] = [];
const ytd: W[] = [];
const r1 = (n: number) => Math.round(n * 2) / 2;
for (const w of workers) {
  const e = w.employee_id as string;
  if (w.worker_type !== "Employee") continue;
  if (w.country === "USA") {
    if (w.flsa === "Exempt") balances.push({ employee_id: e, plan: "US_FLEX_PTO", balance: "unlimited", unit: "hours", last_accrual_date: "", notes: "Non-balance plan" });
    else {
      balances.push({ employee_id: e, plan: "US_HOURLY_VAC", balance: e === "E0021" ? 46.5 : r1(between(8, 90)), unit: "hours", last_accrual_date: "2026-10-01", notes: "Accrues per hour worked" });
      if (w.work_state === "CA") balances.push({ employee_id: e, plan: "CA_SICK", balance: e === "E0021" ? 28 : r1(between(8, 40)), unit: "hours", last_accrual_date: "2026-10-01", notes: "" });
    }
    if (e === "E0148") balances.push({ employee_id: e, plan: "US_HOURLY_VAC", balance: 31, unit: "hours", last_accrual_date: "2026-10-01", notes: "Payout on termination" });
    // YTD through Sep 30 (18 semi-monthly periods), as converted from Rippling.
    const hire = w.hire_date as string;
    let periods = 18;
    if (hire > "2026-01-01") {
      periods = 0;
      for (let m = 1; m <= 9; m++) for (const d of [1, 16]) if (`2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` >= hire) periods++;
    }
    if (periods === 0) continue;
    const per = w.pay_type === "Hourly" ? (w.hourly_rate as number) * 88 : (w.annual_salary as number) / 24;
    const gross = Math.round(per * periods * 100) / 100;
    const med = (w.medical_per_period as number) * periods;
    const fica = gross - med;
    ytd.push({ employee_id: e, periods, ytd_gross: gross.toFixed(2), ytd_ss_wages: Math.min(fica, 184_500).toFixed(2), ytd_medicare_wages: fica.toFixed(2), ytd_futa_wages: Math.min(fica, 7000).toFixed(2), ytd_sui_wages: Math.min(fica, 7000).toFixed(2) });
  } else {
    const plan = { GBR: "UK_ANNUAL", CAN: "CAN_ON_VAC", IND: "IND_EL" }[w.country as string]!;
    const fixed: Record<string, number> = { E0006: 14.5, E0008: 9, E0009: 11 };
    const newHire = (w.hire_date as string) >= "2026-10-01";
    const b = fixed[e] ?? (newHire ? 0 : r1(between(2, w.country === "IND" ? 30 : 16)));
    balances.push({ employee_id: e, plan, balance: b, unit: "days", last_accrual_date: "2026-10-01", notes: { GBR: "Holiday year Jan–Dec", CAN: "Ontario, 3 weeks/year", IND: "Karnataka S&E Act" }[w.country as string]! });
  }
}

const garnishments = [{ employee_id: "E0031", type: "Child Support", amount_per_period: 450, max_pct_disposable: 0.6, case_id: "CS-2026-118842", payee: "California State Disbursement Unit" }];

// ---------------------------------------------------------------- write inputs
const write = (f: string, rows: W[] | Record<string, unknown>[]) => writeFileSync(join(OUT, f), toCsv(rows as Record<string, unknown>[]));
write("companies.csv", companies);
write("locations.csv", locations);
write("cost_centers.csv", costCenters);
write("workers.csv", workers);
write("worker_events.csv", events);
write("timesheets.csv", timeRows);
write("absence_balances.csv", balances);
write("absence_requests.csv", absenceReq);
write("ytd_balances.csv", ytd);
write("garnishments.csv", garnishments);
write("gl_account_mapping.csv", glMapping);

// ---------------------------------------------------------------- legacy register
// The legacy system's configuration (applies to everyone) and the seeded
// per-employee errors. Kept here, never read by the app.
const LEGACY_CONFIG: Variant = { ssBaseActual: true, noMealPremium: true };
const LEGACY_ERRORS: Record<string, Variant> = {
  E0203: { hireAtPeriodStart: true }, // data: legacy hire date = period start
  E0149: { ignoreLeave: true }, // timing: leave entered after legacy cutoff
  E0057: { compFromPeriodStart: true }, // configuration: comp changes applied from period start
  E0088: { ignoreLocationChange: true }, // data: work-state change not sent to legacy
  E0031: { noGarnishment: true }, // legacy error: order not loaded
  E0148: { noTermPayout: true }, // legacy error: vacation payout omitted
  E0035: { keepDuplicatePunches: true }, // data: duplicate punch paid
  E0033: { noRetro: true }, // timing: correction not processed yet
  C0003: { treatAsEmployee: true }, // data: contractor paid through payroll
};
const LEGACY_MISSING = new Set(["E0345"]); // timing: hire entered after legacy cutoff

const texts: Record<string, string> = {};
for (const f of ["companies.csv", "locations.csv", "cost_centers.csv", "workers.csv", "worker_events.csv", "timesheets.csv", "absence_balances.csv", "absence_requests.csv", "ytd_balances.csv", "garnishments.csv", "gl_account_mapping.csv"]) {
  texts[f] = readFileSync(join(OUT, f), "utf8");
}
const { ds, issues } = loadDataset(texts);
const errors = issues.filter((i) => i.severity === "Error" && !/File missing/.test(i.message));
if (errors.length) {
  console.error(errors);
  throw new Error("Generated data failed validation");
}

const legacyRows: Record<string, unknown>[] = [];
const toMajor = (c: number) => (c / 100).toFixed(2);
for (const w of ds.workers) {
  const variant = LEGACY_ERRORS[w.id];
  if (!isUsPayrollWorker(w) && !variant?.treatAsEmployee) continue;
  if (LEGACY_MISSING.has(w.id)) continue;
  if (w.hireDate > US_PERIOD.end || (w.terminationDate && w.terminationDate < US_PERIOD.start)) continue;
  const calc = calcUsWorker(ds, w, US_PERIOD, { ...LEGACY_CONFIG, ...variant });
  const cols = toLegacyColumns(calc.pay);
  legacyRows.push({
    employee_id: w.id, name: w.name,
    regular_pay: toMajor(cols.regularPay), overtime_pay: toMajor(cols.overtimePay), premium_pay: toMajor(cols.premiumPay), other_pay: toMajor(cols.otherPay), gross: toMajor(cols.gross),
    pre_tax_deductions: toMajor(cols.preTaxDeductions), fit: toMajor(cols.fit), ss_ee: toMajor(cols.ssEe), medicare_ee: toMajor(cols.medicareEe), state_tax: toMajor(cols.stateTax), state_other: toMajor(cols.stateOther),
    post_tax_deductions: toMajor(cols.postTaxDeductions), net: toMajor(cols.net), ss_er: toMajor(cols.ssEr), medicare_er: toMajor(cols.medicareEr), futa: toMajor(cols.futa), sui: toMajor(cols.sui),
    employer_taxes: toMajor(cols.employerTaxes), benefits: toMajor(cols.benefits), total_cost: toMajor(cols.totalCost),
  });
}
write("legacy_rippling_register.csv", legacyRows);

// ---------------------------------------------------------------- provider results
const NET_RATIO: Record<string, number> = { GBR: 0.712, CAN: 0.688, IND: 0.781 };
const provider: Record<string, unknown>[] = [];
const dsProviderView = { ...ds, events: ds.events.filter((e) => e.enteredOn <= INTL_PERIOD.changeCutoff) }; // provider never received late changes
for (const w of ds.workers.filter(isIntlWorker)) {
  const r = calcIntlWorker(dsProviderView, w, INTL_PERIOD);
  const rule = COUNTRY_RULES[w.country];
  provider.push({
    employee_id: w.id, country: w.country, currency: r.currency, month: INTL_PERIOD.month,
    gross: toMajor(r.gross), employer_cost: toMajor(Math.round(rule.employerStatutory(r.gross))), net: toMajor(Math.round(r.gross * NET_RATIO[w.country])),
    provider_ref: `${w.country}-${INTL_PERIOD.month}-${w.id}`,
  });
}
write("provider_results.csv", provider);

console.log(`workers ${workers.length} (US ${workers.filter((w) => w.country === "USA" && w.worker_type === "Employee").length}, intl ${workers.filter((w) => w.country !== "USA").length}, contractors ${workers.filter((w) => w.worker_type === "Contractor").length})`);
console.log(`time rows ${timeRows.length} (in period ${timeRows.filter((r) => (r.work_date as string) >= "2026-10-01").length}), legacy rows ${legacyRows.length}, provider rows ${provider.length}`);
void addDays;
