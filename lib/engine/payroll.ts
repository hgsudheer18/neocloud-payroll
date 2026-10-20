// US semi-monthly gross-to-net for one worker.
//
//   Earnings (by effective-dated segment / time / absence)
//   − Pre-tax deductions (401k, Sec.125)          → taxable wages, one per tax
//   − Employee taxes (each on its own wage base)
//   − Post-tax deductions (garnishment, CCPA-limited)
//   = Net pay
//   Employer taxes + benefits load + gross = total burdened cost
//
// Pure function: no I/O. Every line carries a human-readable explanation.

import type { Garnishment, Worker, Ytd, AbsenceTaken } from "../data/types.ts";
import type { DayState } from "./timeline.ts";
import type { WorkerTimeResult } from "./time.ts";
import type { AbsenceLine } from "./absence.ts";
import { allocate, fmt, pct, roundCents, type Cents } from "../util/money.ts";
import { pretty } from "../util/dates.ts";
import { COMPONENT, US_BENEFITS_LOAD, type ComponentType } from "../config/payComponents.ts";
import { STANDARD_ANNUAL_HOURS, type PayPeriod } from "../config/period.ts";
import { PLAN } from "../config/absencePlans.ts";
import { annualizedWithholding, asOf, CALIFORNIA, FEDERAL, FICA, STATES, UNEMPLOYMENT } from "../config/usTax.ts";

export interface PayLine {
  code: string;
  name: string;
  type: ComponentType;
  hours?: number;
  rate?: number;
  amount: Cents;
  explain: string;
  state?: string;
  costCenterId?: string;
  glAccount: string;
}

export interface PayTotals {
  gross: Cents;
  preTax: Cents;
  eeTaxes: Cents;
  postTax: Cents;
  net: Cents;
  erTaxes: Cents;
  benefits: Cents;
  burdened: Cents;
}

export interface TaxableWages {
  fit: Cents;
  fica: Cents;
  ssTaxable: Cents;
  futa: Cents;
  sui: Cents;
  byState: Record<string, { pit: Cents; programs: Cents }>;
  disposable: Cents;
}

export interface PayResult {
  employeeId: string;
  worker: Worker;
  lines: PayLine[];
  totals: PayTotals;
  taxable: TaxableWages;
  /** Earnings by cost centre, used to spread employer cost in the GL. */
  earningsByCostCenter: Record<string, Cents>;
  flags: string[];
}

export interface PayrollOptions {
  /** Override of the Social Security wage base (used to re-perform the legacy system). */
  ssWageBase?: number;
}

export interface WorkerPayInput {
  worker: Worker;
  timeline: DayState[];
  time?: WorkerTimeResult;
  absenceLines: AbsenceLine[];
  absencesTaken: AbsenceTaken[];
  ytd?: Ytd;
  garnishment?: Garnishment;
  /** Difference from recalculating a completed period after later changes (Workday retro). */
  priorPeriodRetro?: PriorPeriodRetro;
}

/** One day of time off that changed in a completed period, itemized on the retro. */
export interface RetroTimeOff {
  date: string;
  plan: string;
  unit: string;
  before: number;
  after: number;
}

export interface PriorPeriodRetro {
  amount: Cents;
  explain: string;
  /** Time off days that changed; shown with date and hours, priced as the period was recalculated. */
  timeOff?: RetroTimeOff[];
  /** Overpayment recovery deferred from the prior pay run, recovered now. */
  carried?: { amount: Cents; from: string };
  /** Payroll chose to hold net pay at zero and defer any recovery that would make it negative. */
  deferAllowed?: boolean;
}

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const h2 = (n: number) => n.toFixed(2);

function line(code: string, amount: Cents, explain: string, extra: Partial<PayLine> = {}): PayLine {
  const c = COMPONENT[code];
  return { code, name: c.name, type: c.type, amount, explain, glAccount: c.glAccount, ...extra };
}

/** Hourly equivalent for salaried workers, 4 decimals (Workday "Hourly Equivalent"). */
export function hourlyEquivalent(annual: number): number {
  return Math.round((annual / STANDARD_ANNUAL_HOURS) * 10_000) / 10_000;
}

// ------------------------------------------------------------- earnings

function salaryLines(input: WorkerPayInput, period: PayPeriod): PayLine[] {
  const days = input.timeline;
  const workingDays = days.filter((d) => d.workingDay).length;
  const paid = days.filter((d) => d.workingDay && d.paid);
  const out: PayLine[] = [];
  // Group by salary first (the amount), then split across state × cost centre.
  const bySalary = new Map<number, DayState[]>();
  for (const d of paid) {
    if (!bySalary.has(d.annualSalary)) bySalary.set(d.annualSalary, []);
    bySalary.get(d.annualSalary)!.push(d);
  }
  for (const [annual, segDays] of bySalary) {
    const periodSalary = annual / period.periodsPerYear;
    const amount = roundCents((periodSalary * 100 * segDays.length) / workingDays);
    const subgroups = new Map<string, DayState[]>();
    for (const d of segDays) {
      const k = `${d.workState}|${d.costCenterId}`;
      if (!subgroups.has(k)) subgroups.set(k, []);
      subgroups.get(k)!.push(d);
    }
    const keys = [...subgroups.keys()];
    const parts = allocate(amount, keys.map((k) => subgroups.get(k)!.length));
    keys.forEach((k, i) => {
      const [state, cc] = k.split("|");
      const sd = subgroups.get(k)!;
      const range = `${pretty(sd[0].date)}–${pretty(sd[sd.length - 1].date)}`;
      const full = segDays.length === workingDays && keys.length === 1;
      const explain = full
        ? `${money(annual)} ÷ ${period.periodsPerYear} = ${fmt(parts[i])} (full period)`
        : `${money(annual)} ÷ ${period.periodsPerYear} × ${sd.length}/${workingDays} working days (${range}, ${state})${keys.length > 1 ? `; segment total ${fmt(amount)} allocated by days` : ""}`;
      out.push(line("SAL", parts[i], explain, { state, costCenterId: cc, hours: undefined }));
    });
  }
  return out;
}

function timeLines(input: WorkerPayInput): PayLine[] {
  const t = input.time;
  if (!t) return [];
  const base = t.baseRate;
  const state = input.timeline[input.timeline.length - 1].workState;
  const cc = input.timeline[input.timeline.length - 1].costCenterId;
  const sumA = (k: keyof (typeof t.weeks)[0]["current"]["amounts"]) => t.weeks.reduce((s, w) => s + w.current.amounts[k], 0);
  const sumH = (k: keyof (typeof t.weeks)[0]["current"]["hours"]) => t.weeks.reduce((s, w) => s + w.current.hours[k], 0);
  const out: PayLine[] = [];
  const push = (code: string, exact: number, explain: string, hours?: number, rate?: number) => {
    const amt = roundCents(exact * 100);
    if (amt !== 0) out.push(line(code, amt, explain, { hours, rate, state, costCenterId: cc }));
  };
  push("REG", sumA("REG"), `${h2(sumH("REG"))} hrs × ${money(base)}`, sumH("REG"), base);
  push("OT", sumA("OT"), `${h2(sumH("OT"))} hrs × ${money(base)} × 1.5`, sumH("OT"), base * 1.5);
  push("DT", sumA("DT"), `${h2(sumH("DT"))} hrs × ${money(base)} × 2.0`, sumH("DT"), base * 2);
  push("SHIFT", sumA("SHIFT"), `${h2(sumH("NIGHT"))} night hrs × $3.00`, sumH("NIGHT"), 3);
  const adjWeeks = t.weeks.filter((w) => Math.abs(w.current.amounts.OT_ADJ) > 0.00001);
  push(
    "OT_ADJ",
    sumA("OT_ADJ"),
    adjWeeks
      .map((w) => `wk ${pretty(w.weekStart)}: (RR ${money(w.regularRate)} − ${money(base)}) × (0.5×${h2(w.current.hours.OT)} + 1.0×${h2(w.current.hours.DT)})`)
      .join("; "),
  );
  const mealWeeks = t.weeks.filter((w) => w.current.hours.MEAL > 0);
  push("MEAL", sumA("MEAL"), mealWeeks.map((w) => `${w.current.hours.MEAL} × RR ${money(w.regularRate)} (wk ${pretty(w.weekStart)})`).join("; "), sumH("MEAL"));

  // Retro: prior-period days recalculated (corrections + full-week regular rate) minus what was paid.
  let retro = 0;
  const parts: string[] = [];
  for (const w of t.weeks) {
    if (!w.priorOwed && !w.priorPaid) continue;
    const owed = w.priorOwed?.amounts ?? { REG: 0, OT: 0, DT: 0, OT_ADJ: 0, SHIFT: 0, MEAL: 0 };
    const paid = w.priorPaid?.amounts ?? { REG: 0, OT: 0, DT: 0, OT_ADJ: 0, SHIFT: 0, MEAL: 0 };
    const delta = (Object.keys(owed) as (keyof typeof owed)[]).reduce((s, k) => s + owed[k] - paid[k], 0);
    if (Math.abs(delta) < 0.005) continue;
    retro += delta;
    const oh = w.priorOwed?.hours;
    const ph = w.priorPaid?.hours;
    parts.push(
      `wk ${pretty(w.weekStart)} prior-period days: owed ${money(Object.values(owed).reduce((a, b) => a + b, 0))} (REG ${h2(oh?.REG ?? 0)}, OT ${h2(oh?.OT ?? 0)}, DT ${h2(oh?.DT ?? 0)} hrs) − paid ${money(Object.values(paid).reduce((a, b) => a + b, 0))} (REG ${h2(ph?.REG ?? 0)}, OT ${h2(ph?.OT ?? 0)}, DT ${h2(ph?.DT ?? 0)} hrs)`,
    );
  }
  push("RETRO", retro, parts.join("; "));
  return out;
}

function absenceLines(input: WorkerPayInput, period: PayPeriod): PayLine[] {
  const out: PayLine[] = [];
  const w = input.worker;
  const last = input.timeline[input.timeline.length - 1];
  // Hourly paid time off (hours paid, not worked).
  if (w.payType === "Hourly") {
    for (const code of ["VAC", "SICK"] as const) {
      const plan = code === "VAC" ? "US_HOURLY_VAC" : "CA_SICK";
      const taken = input.absencesTaken.filter((a) => a.plan === plan && a.status === "Approved" && a.date >= period.start && a.date <= period.end);
      if (!taken.length) continue;
      let exact = 0;
      const parts: string[] = [];
      for (const a of taken) {
        const wk = input.time?.weeks.find((x) => a.date >= x.weekStart && a.date <= addDaysLocal(x.weekStart, 6));
        const rate = code === "SICK" && wk ? wk.regularRate : w.hourlyRate;
        exact += a.quantity * rate;
        parts.push(`${pretty(a.date)} ${h2(a.quantity)} hrs × ${money(rate)}${code === "SICK" ? " (regular rate of pay)" : ""}`);
      }
      const hours = taken.reduce((s, a) => s + a.quantity, 0);
      out.push(line(code, roundCents(exact * 100), parts.join("; "), { hours, state: last.workState, costCenterId: last.costCenterId }));
    }
  }
  // Termination payout.
  for (const al of input.absenceLines) {
    if (al.payoutQty <= 0) continue;
    const rate = w.payType === "Hourly" ? last.hourlyRate : hourlyEquivalent(lastSalary(input.timeline));
    const amt = roundCents(al.payoutQty * rate * 100);
    out.push(
      line("PTO_PAYOUT", amt, `${h2(al.payoutQty)} hrs (${h2(al.opening)} opening + ${h2(al.accrual)} final accrual − ${h2(al.taken)} taken) × ${w.payType === "Hourly" ? money(rate) : `${money(lastSalary(input.timeline))} ÷ 2080 = $${rate.toFixed(4)}`}`, {
        hours: al.payoutQty,
        rate,
        state: last.workState,
        costCenterId: last.costCenterId,
      }),
    );
  }
  return out;
}

/**
 * Salaried time off: approved hours × hourly equivalent, shown as Time Off Taken
 * and taken out of regular salary, so gross is unchanged (Workday reclass).
 * Reduces the SAL lines in place.
 */
function salariedTimeOff(input: WorkerPayInput, period: PayPeriod, sal: PayLine[]): PayLine[] {
  if (input.worker.payType !== "Salary" || !sal.length) return [];
  const paidDays = new Map(input.timeline.filter((d) => d.workingDay && d.paid).map((d) => [d.date, d]));
  const taken = input.absencesTaken.filter((a) => a.status === "Approved" && a.unit === "hours" && a.date >= period.start && a.date <= period.end && paidDays.has(a.date));
  const out: PayLine[] = [];
  for (const plan of [...new Set(taken.map((a) => a.plan))]) {
    const days = taken.filter((a) => a.plan === plan).sort((a, b) => (a.date < b.date ? -1 : 1));
    let exact = 0;
    const parts: string[] = [];
    for (const a of days) {
      const rate = hourlyEquivalent(paidDays.get(a.date)!.annualSalary);
      exact += a.quantity * rate;
      parts.push(`${pretty(a.date)} ${h2(a.quantity)} hrs × ${money(rate)}`);
    }
    const hours = days.reduce((s, a) => s + a.quantity, 0);
    const last = sal[sal.length - 1];
    const amount = Math.min(roundCents(exact * 100), last.amount);
    if (amount <= 0) continue;
    last.amount -= amount;
    last.explain += `; less ${fmt(amount)} paid as ${PLAN[plan]?.name ?? plan} (${h2(hours)} hrs)`;
    out.push(line("PTO_TAKEN", amount, `${PLAN[plan]?.name ?? plan}: ${parts.join("; ")} (hourly equivalent = salary ÷ ${STANDARD_ANNUAL_HOURS})`, { hours, state: last.state, costCenterId: last.costCenterId }));
  }
  return out;
}

/** Retro from a recalculated completed period: one line per changed time off day, then the rest. */
function retroLines(input: WorkerPayInput): PayLine[] {
  const r = input.priorPeriodRetro;
  if (!r) return [];
  const w = input.worker;
  const last = input.timeline[input.timeline.length - 1];
  const at = { state: last.workState, costCenterId: last.costCenterId };
  const out: PayLine[] = [];
  if (r.carried && r.carried.amount > 0) out.push(line("RETRO", -r.carried.amount, `Overpayment recovery carried from the ${r.carried.from} pay run`, at));
  let itemized = 0;
  for (const t of r.timeOff ?? []) {
    const delta = t.after - t.before;
    const hourly = w.payType === "Hourly";
    const amount = hourly ? roundCents(delta * last.hourlyRate * 100) : 0;
    itemized += amount;
    const change = `${h2(t.before)} → ${h2(t.after)} ${t.unit} (${delta > 0 ? "+" : ""}${h2(delta)} ${t.unit}`;
    out.push(line("RETRO", amount, `Retro time off: ${PLAN[t.plan]?.name ?? t.plan}, ${pretty(t.date)}: ${change}${hourly ? ` × ${money(last.hourlyRate)})` : "), reclassified within regular salary: no pay change"}`, { hours: delta, ...at }));
  }
  if (r.amount - itemized !== 0) out.push(line("RETRO", r.amount - itemized, r.explain, at));
  return out;
}

function lastSalary(tl: DayState[]): number {
  const employed = tl.filter((d) => d.employed);
  return (employed[employed.length - 1] ?? tl[tl.length - 1]).annualSalary;
}

function addDaysLocal(d: string, n: number): string {
  const t = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

// ------------------------------------------------------------- gross to net

export function calcUSWorker(input: WorkerPayInput, period: PayPeriod, opts: PayrollOptions = {}): PayResult {
  const w = input.worker;
  const flags: string[] = [];
  const sal = w.payType === "Salary" ? salaryLines(input, period) : [];
  const timeOff = salariedTimeOff(input, period, sal);
  const earnings = [...sal, ...timeOff, ...timeLines(input), ...absenceLines(input, period), ...retroLines(input)];
  // Overpayment recovery larger than this pay run: when payroll allows it, hold gross (and so net) at
  // zero and carry the rest of the recovery to the next pay run.
  const owed = earnings.reduce((s, l) => s + l.amount, 0);
  const recovery = -earnings.filter((l) => l.code === "RETRO" && l.amount < 0).reduce((s, l) => s + l.amount, 0);
  if (owed < 0 && recovery > 0 && input.priorPeriodRetro?.deferAllowed) {
    const deferred = Math.min(-owed, recovery);
    const last = input.timeline[input.timeline.length - 1];
    earnings.push(line("RETRO", deferred, `Overpayment recovery deferred to the next pay run: ${fmt(deferred)} (net pay held at zero)`, { state: last.workState, costCenterId: last.costCenterId }));
  }
  const gross = earnings.reduce((s, l) => s + l.amount, 0);
  const k401Base = earnings.filter((l) => COMPONENT[l.code].k401Eligible).reduce((s, l) => s + l.amount, 0);

  const lines: PayLine[] = [...earnings];
  const k401 = pct(k401Base, w.k401Pct);
  if (k401) lines.push(line("K401", k401, `${(w.k401Pct * 100).toFixed(1)}% × 401(k)-eligible earnings ${fmt(k401Base)}${k401Base !== gross ? " (PTO payout excluded per plan document)" : ""}`));
  const med = gross > 0 ? roundCents(w.medicalPerPeriod * 100) : 0;
  if (med) lines.push(line("MED", med, `Medical election ${fmt(med)} per period (Sec. 125)`));

  // ---- taxable wages, each defined by the components' taxability
  const fitWages = gross - k401 - med;
  const ficaWages = gross - med;
  const fica = asOf(FICA, period.checkDate);
  const ssBase = (opts.ssWageBase ?? fica.ssWageBase) * 100;
  const ytdSs = (input.ytd?.ssWages ?? 0) * 100;
  const ytdMed = (input.ytd?.medicareWages ?? 0) * 100;
  const ssTaxable = Math.max(0, Math.min(ficaWages, ssBase - ytdSs));
  const un = asOf(UNEMPLOYMENT, period.checkDate);
  const futaTaxable = Math.max(0, Math.min(ficaWages, un.futaWageBase * 100 - (input.ytd?.futaWages ?? 0) * 100));
  const suiTaxable = Math.max(0, Math.min(ficaWages, un.suiWageBase * 100 - (input.ytd?.suiWages ?? 0) * 100));

  // ---- state allocation: wages sourced to the state where the work was performed
  const states = [...new Set(earnings.map((l) => l.state ?? w.workState))];
  const earnByState = states.map((s) => earnings.filter((l) => (l.state ?? w.workState) === s).reduce((a, l) => a + l.amount, 0));
  const k401ByState = allocate(k401, earnByState);
  const medByState = allocate(med, earnByState);
  const byState: TaxableWages["byState"] = {};
  states.forEach((s, i) => (byState[s] = { pit: earnByState[i] - k401ByState[i] - medByState[i], programs: earnByState[i] - medByState[i] }));

  // ---- employee taxes
  const fed = asOf(FEDERAL, period.checkDate);
  const fit = roundCents(annualizedWithholding(fitWages, period.periodsPerYear, fed, w.filingStatus));
  lines.push(line("FIT", fit, `Annualized: (${fmt(fitWages)} × 24 − ${money(fed.standardDeduction[w.filingStatus])} std. deduction) through 2026 ${w.filingStatus} brackets ÷ 24`));

  const ssEe = pct(ssTaxable, fica.ssRate);
  const ssNote =
    ssTaxable < ficaWages
      ? `; wage base ${money(ssBase / 100)} − YTD ${fmt(ytdSs)} leaves ${fmt(Math.max(0, ssBase - ytdSs))}`
      : "";
  lines.push(line("SS_EE", ssEe, `6.2% × ${fmt(ssTaxable)}${ssNote}`));
  const addlBase = Math.max(0, ytdMed + ficaWages - fica.addlMedicareThreshold * 100) - Math.max(0, ytdMed - fica.addlMedicareThreshold * 100);
  const medEe = pct(ficaWages, fica.medicareRate) + pct(addlBase, fica.addlMedicareRate);
  lines.push(line("MED_EE", medEe, `1.45% × ${fmt(ficaWages)}${addlBase ? ` + 0.9% × ${fmt(addlBase)} over $200,000 YTD` : ""}`));

  const stTable = asOf(STATES, period.checkDate);
  const totalStatePit = Object.values(byState).reduce((a, b) => a + b.pit, 0);
  for (const s of states) {
    const rule = stTable[s];
    const wages = byState[s];
    if (!rule) {
      flags.push(`No tax rule configured for work state ${s}.`);
      continue;
    }
    let sit = 0;
    let explain: string;
    if (s === "CA") {
      const ca = asOf(CALIFORNIA, period.checkDate);
      const onTotal = annualizedWithholding(totalStatePit, period.periodsPerYear, ca, w.filingStatus);
      sit = roundCents(totalStatePit ? (onTotal * wages.pit) / totalStatePit : 0);
      explain = `CA annualized on ${fmt(totalStatePit)}${states.length > 1 ? ` × CA share ${fmt(wages.pit)}/${fmt(totalStatePit)}` : ""}`;
    } else {
      sit = pct(wages.pit, rule.pitRate);
      explain = rule.pitRate ? `${s} ${(rule.pitRate * 100).toFixed(2)}% × ${fmt(wages.pit)} (approximation)` : `${s}: no state income tax`;
    }
    if (sit || rule.pitRate === 0) lines.push(line("SIT", sit, explain, { state: s }));
    for (const p of rule.eePrograms) {
      const amt = pct(wages.programs, p.rate);
      lines.push({ ...line("STATE_EE", amt, `${p.name} ${(p.rate * 100).toFixed(3)}% × ${fmt(wages.programs)}`, { state: s }), name: p.name });
    }
  }

  const eeTaxes = lines.filter((l) => l.type === "Employee Tax").reduce((a, l) => a + l.amount, 0);

  // ---- post-tax: garnishment limited by disposable earnings (CCPA)
  const disposable = gross - eeTaxes;
  if (input.garnishment && gross > 0) {
    const g = input.garnishment;
    const limit = pct(disposable, g.maxPctDisposable);
    const order = roundCents(g.amountPerPeriod * 100);
    const amt = Math.min(order, limit);
    lines.push(line("GARN", amt, `min(order ${fmt(order)}, ${(g.maxPctDisposable * 100).toFixed(0)}% × disposable ${fmt(disposable)} = ${fmt(limit)}); case ${g.caseId}`));
    if (amt < order) flags.push(`Garnishment limited by CCPA: ${fmt(order - amt)} arrears carried forward.`);
  }

  // ---- employer
  const ssEr = pct(ssTaxable, fica.ssRate);
  lines.push(line("SS_ER", ssEr, `6.2% × ${fmt(ssTaxable)}`));
  lines.push(line("MED_ER", pct(ficaWages, fica.medicareRate), `1.45% × ${fmt(ficaWages)}`));
  lines.push(line("FUTA", pct(futaTaxable, un.futaRate), `0.6% × ${fmt(futaTaxable)} (remaining of $7,000 base)`));
  lines.push(line("SUI", pct(suiTaxable, un.suiRate), `3.4% × ${fmt(suiTaxable)} (remaining of $7,000 base)`));
  lines.push(line("BEN_LOAD", pct(gross, US_BENEFITS_LOAD), `10% × gross ${fmt(gross)}`));

  const sumType = (t: ComponentType) => lines.filter((l) => l.type === t).reduce((a, l) => a + l.amount, 0);
  const preTax = sumType("Pre-Tax Deduction");
  const postTax = sumType("Post-Tax Deduction");
  const erTaxes = sumType("Employer Tax");
  const benefits = sumType("Employer Benefit");
  const net = gross - preTax - eeTaxes - postTax;
  if (net < 0) flags.push("Negative net pay: deductions exceed earnings.");
  if (w.terminationDate && w.terminationDate >= period.start && w.terminationDate <= period.end && w.workState === "CA") {
    flags.push(`Final pay due ${pretty(w.terminationDate)} (CA Labor Code 201/202): issue as an On-Demand Payment on the termination date, not the ${pretty(period.checkDate)} regular check.`);
  }

  const earningsByCostCenter: Record<string, Cents> = {};
  for (const l of earnings) earningsByCostCenter[l.costCenterId ?? w.costCenterId] = (earningsByCostCenter[l.costCenterId ?? w.costCenterId] ?? 0) + l.amount;

  return {
    employeeId: w.id,
    worker: w,
    lines,
    totals: { gross, preTax, eeTaxes, postTax, net, erTaxes, benefits, burdened: gross + erTaxes + benefits },
    taxable: { fit: fitWages, fica: ficaWages, ssTaxable, futa: futaTaxable, sui: suiTaxable, byState, disposable },
    earningsByCostCenter,
    flags,
  };
}

/** Collapse a PayResult into the legacy register's columns (for reconciliation). */
export function toLegacyColumns(r: PayResult): Record<string, Cents> {
  const cols: Record<string, Cents> = {
    regularPay: 0, overtimePay: 0, premiumPay: 0, otherPay: 0, gross: 0, preTaxDeductions: 0, fit: 0, ssEe: 0, medicareEe: 0,
    stateTax: 0, stateOther: 0, postTaxDeductions: 0, net: 0, ssEr: 0, medicareEr: 0, futa: 0, sui: 0, employerTaxes: 0, benefits: 0, totalCost: 0,
  };
  for (const l of r.lines) cols[COMPONENT[l.code].legacyColumn] += l.amount;
  cols.gross = r.totals.gross;
  cols.net = r.totals.net;
  cols.employerTaxes = r.totals.erTaxes;
  cols.totalCost = r.totals.burdened;
  return cols;
}
