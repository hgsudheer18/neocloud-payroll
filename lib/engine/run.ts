// One function runs the whole period: Dataset in → everything the UI shows out.
// The UI never calculates; it only renders PeriodResult.

import type { Dataset, Worker } from "../data/types.ts";
import { INTL_PERIOD, US_PERIOD, type MonthlyPeriod, type PayPeriod } from "../config/period.ts";
import { calcUsWorker, isUsPayrollWorker, type UsWorkerCalc } from "./build.ts";
import { calcIntlWorker, isIntlWorker, outboundChanges, reconcileProvider, type ChangeRecord, type IntlWorkerResult, type ProviderVariance } from "./intl.ts";
import { reconcileEmployee, summarize, type ReconSummary } from "./reconcile.ts";
import { headcountRecon, type HeadcountStep } from "./headcount.ts";
import { intlJournals, totalsByJournal, usJournal, validateAndMap, type JournalIssue, type JournalLine, type MappedLine } from "./gl.ts";
import { prepayrollAudit, type AuditFinding } from "./audit.ts";
import { roundCents, type Cents } from "../util/money.ts";

export interface Rollup {
  key: string;
  headcount: number;
  gross: Cents;
  erTaxes: Cents;
  benefits: Cents;
  burdened: Cents;
}

export interface Tie {
  name: string;
  left: { label: string; value: Cents };
  right: { label: string; value: Cents };
  ok: boolean;
}

export interface PeriodResult {
  period: PayPeriod;
  intlPeriod: MonthlyPeriod;
  /** True when this period was reconciled to the legacy register (parallel run). */
  reconciled: boolean;
  us: UsWorkerCalc[];
  excluded: { worker: Worker; reason: string }[];
  intl: IntlWorkerResult[];
  outbound: ChangeRecord[];
  providerVariances: ProviderVariance[];
  recon: ReconSummary;
  headcount: { steps: HeadcountStep[]; movement: HeadcountStep[] };
  journal: { lines: JournalLine[]; mapped: MappedLine[]; issues: JournalIssue[]; totals: ReturnType<typeof totalsByJournal> };
  audit: AuditFinding[];
  ties: Tie[];
  totals: { gross: Cents; net: Cents; erTaxes: Cents; benefits: Cents; burdened: Cents; eeTaxes: Cents; preTax: Cents; postTax: Cents; intlUsd: Cents };
}

export interface RunOptions {
  /** Reconcile to the legacy register (parallel-run periods only). Default: when legacy rows exist and the period is the parallel period. */
  reconcileLegacy?: boolean;
  /** Retro from recalculating a completed prior period, by worker. */
  retro?: Map<string, { amount: Cents; explain: string }>;
}

export function runPeriod(ds: Dataset, period: PayPeriod = US_PERIOD, intlPeriod: MonthlyPeriod = INTL_PERIOD, opts: RunOptions = {}): PeriodResult {
  const reconcileLegacy = opts.reconcileLegacy ?? (period.id === US_PERIOD.id && ds.legacy.length > 0);
  const excluded: PeriodResult["excluded"] = [];
  const us: UsWorkerCalc[] = [];
  for (const w of ds.workers) {
    if (w.workerType === "Contractor") {
      excluded.push({ worker: w, reason: "Contingent worker: paid through AP, not payroll" });
      continue;
    }
    if (w.workerType !== "Employee" || w.payGroup !== period.payGroup) continue;
    const retro = opts.retro?.get(w.id);
    if (w.terminationDate && w.terminationDate < period.start && !retro) {
      excluded.push({ worker: w, reason: "Terminated before period" });
      continue;
    }
    if (w.hireDate > period.end) {
      excluded.push({ worker: w, reason: "Hire date after period end" });
      continue;
    }
    us.push(calcUsWorker(ds, w, period, {}, retro));
  }

  const intlWorkers = ds.workers.filter(isIntlWorker);
  const intl = intlWorkers.map((w) => calcIntlWorker(ds, w, intlPeriod));
  const outbound = outboundChanges(ds, intlWorkers, intlPeriod);
  const providerVariances = reconcileProvider(ds, intl, ds.provider.filter((p) => p.month === intlPeriod.month), intlPeriod);

  // Legacy reconciliation: union of Workday-paid and legacy-paid workers.
  const legacyById = new Map(ds.legacy.map((l) => [l.employeeId, l]));
  const usById = new Map(us.map((c) => [c.worker.id, c]));
  const ids = reconcileLegacy ? [...new Set([...us.map((c) => c.worker.id), ...ds.legacy.map((l) => l.employeeId)])].sort() : [];
  const recs = ids.map((id) => {
    const worker = ds.workers.find((w) => w.id === id) ?? ({ id, name: legacyById.get(id)?.name ?? id } as Worker);
    return reconcileEmployee(ds, worker, period, usById.get(id) ?? null, legacyById.get(id));
  });
  const recon = summarize(recs);

  const hc = headcountRecon(ds, period, us);

  const companies = [...new Set(us.map((c) => c.worker.companyId))].sort();
  const usLines = companies.flatMap((co) => usJournal(us.filter((c) => c.worker.companyId === co).map((c) => c.pay), `PR-${period.id}-${co}`, co));
  const pg = new Map(ds.provider.map((p) => [p.employeeId, roundCents(p.gross * 100)]));
  const pn = new Map(ds.provider.map((p) => [p.employeeId, roundCents(p.net * 100)]));
  const ij = intlJournals(intl, pn, pg, ds.costCenters, ds.companies, intlPeriod.month);
  const lines = [...usLines, ...ij.local, ...ij.intercompany];
  const { mapped, issues } = validateAndMap(lines, ds);

  const sum = (f: (c: UsWorkerCalc) => Cents) => us.reduce((s, c) => s + f(c), 0);
  const totals = {
    gross: sum((c) => c.pay.totals.gross),
    net: sum((c) => c.pay.totals.net),
    erTaxes: sum((c) => c.pay.totals.erTaxes),
    benefits: sum((c) => c.pay.totals.benefits),
    burdened: sum((c) => c.pay.totals.burdened),
    eeTaxes: sum((c) => c.pay.totals.eeTaxes),
    preTax: sum((c) => c.pay.totals.preTax),
    postTax: sum((c) => c.pay.totals.postTax),
    intlUsd: intl.reduce((s, r) => s + r.totalCostUsd, 0),
  };

  // Control totals: each pair must tie to the cent.
  const usJ = usLines;
  const jDebit = usJ.reduce((s, l) => s + l.debit, 0);
  const jCredit = usJ.reduce((s, l) => s + l.credit, 0);
  const expenseDebits = usJ.filter((l) => l.account.startsWith("6") || l.account === "2150").reduce((s, l) => s + l.debit, 0);
  const timeHours = us.filter((c) => c.time).reduce((s, c) => s + c.time!.hoursWorkedInPeriod, 0);
  const paidHours = us.flatMap((c) => c.pay.lines.filter((l) => ["REG", "OT", "DT"].includes(l.code))).reduce((s, l) => s + (l.hours ?? 0), 0);
  const ptoTaken = us.flatMap((c) => c.absence.filter((a) => ["US_HOURLY_VAC", "CA_SICK"].includes(a.plan.code) && c.worker.payType === "Hourly")).reduce((s, a) => s + a.taken, 0);
  const ptoPaid = us.flatMap((c) => c.pay.lines.filter((l) => l.code === "VAC" || l.code === "SICK")).reduce((s, l) => s + (l.hours ?? 0), 0);
  const payoutHrs = us.flatMap((c) => c.absence).reduce((s, a) => s + a.payoutQty, 0);
  const payoutPaidHrs = us.flatMap((c) => c.pay.lines.filter((l) => l.code === "PTO_PAYOUT")).reduce((s, l) => s + (l.hours ?? 0), 0);
  const h = (x: number) => Math.round(x * 100);
  const ties: Tie[] = [
    { name: "Gross − pre-tax − EE taxes − post-tax = net", left: { label: "Gross less deductions", value: totals.gross - totals.preTax - totals.eeTaxes - totals.postTax }, right: { label: "Net pay", value: totals.net }, ok: totals.gross - totals.preTax - totals.eeTaxes - totals.postTax === totals.net },
    { name: "US journal balances", left: { label: "Debits", value: jDebit }, right: { label: "Credits", value: jCredit }, ok: jDebit === jCredit },
    { name: "Register burdened cost = journal expense debits", left: { label: "Register gross + ER tax + benefits", value: totals.burdened }, right: { label: "Journal expense + PTO liability relief", value: expenseDebits }, ok: totals.burdened === expenseDebits },
    { name: "Approved time hours = hours paid (REG+OT+DT)", left: { label: "Hours worked (time)", value: h(timeHours) }, right: { label: "Hours on pay lines", value: h(paidHours) }, ok: h(timeHours) === h(paidHours) },
    { name: "Hourly PTO taken = PTO hours paid", left: { label: "Balance reduction (hrs)", value: h(ptoTaken) }, right: { label: "VAC + SICK hours paid", value: h(ptoPaid) }, ok: h(ptoTaken) === h(ptoPaid) },
    { name: "Termination payout hours = payout hours paid", left: { label: "Balance paid out (hrs)", value: h(payoutHrs) }, right: { label: "PTO_PAYOUT hours", value: h(payoutPaidHrs) }, ok: h(payoutHrs) === h(payoutPaidHrs) },
    { name: "Headcount: eligible = paid + zero-pay", left: { label: "Eligible", value: hc.steps.find((s) => s.label.startsWith("US employees eligible"))!.count }, right: { label: "Paid + zero-pay", value: hc.steps.find((s) => s.label === "US employees paid")!.count + hc.steps.find((s) => s.label.startsWith("Zero-pay"))!.count }, ok: true },
    { name: "Every legacy variance explained", left: { label: "Variances", value: recon.counts.Explained + recon.counts.Unexplained + recon.counts["Only in legacy"] + recon.counts["Only in Workday"] }, right: { label: "Explained", value: recon.employees.filter((e) => e.status !== "Matched" && e.status !== "Unexplained" && e.causes.length > 0).length }, ok: recon.counts.Unexplained === 0 && recon.employees.every((e) => e.status === "Matched" || e.causes.length > 0) },
  ];
  ties[6].ok = ties[6].left.value === ties[6].right.value;
  if (!reconcileLegacy) ties.pop();

  return {
    period,
    intlPeriod,
    reconciled: reconcileLegacy,
    us,
    excluded,
    intl,
    outbound,
    providerVariances,
    recon,
    headcount: { steps: hc.steps, movement: hc.legacySteps },
    journal: { lines, mapped, issues, totals: totalsByJournal(lines) },
    audit: prepayrollAudit(ds, us, period),
    ties,
    totals,
  };
}

export function rollup(result: PeriodResult, by: "department" | "location" | "costCenter" | "country", filter: { department?: string; location?: string } = {}): Rollup[] {
  const m = new Map<string, Rollup>();
  const put = (key: string, gross: Cents, er: Cents, ben: Cents) => {
    const r = m.get(key) ?? { key, headcount: 0, gross: 0, erTaxes: 0, benefits: 0, burdened: 0 };
    r.headcount++;
    r.gross += gross;
    r.erTaxes += er;
    r.benefits += ben;
    r.burdened += gross + er + ben;
    m.set(key, r);
  };
  const keep = (w: Worker) => (!filter.department || w.department === filter.department) && (!filter.location || w.locationId === filter.location);
  for (const c of result.us) {
    if (!keep(c.worker)) continue;
    const k = by === "department" ? c.worker.department : by === "location" ? c.worker.locationId : by === "costCenter" ? c.worker.costCenterId : "USA";
    put(k, c.pay.totals.gross, c.pay.totals.erTaxes, c.pay.totals.benefits);
  }
  for (const r of result.intl) {
    if (!keep(r.worker)) continue;
    const k = by === "department" ? r.worker.department : by === "location" ? r.worker.locationId : by === "costCenter" ? r.costCenterId : r.worker.country;
    // Translate so the parts add up exactly to the translated total.
    const g = roundCents(r.gross * r.fx);
    const er = roundCents(r.erStatutory * r.fx);
    put(k, g, er, r.totalCostUsd - g - er);
  }
  return [...m.values()].sort((a, b) => b.burdened - a.burdened);
}
