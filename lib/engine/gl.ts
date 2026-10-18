// Payroll accounting: Workday results → summarized journal → NetSuite import.
//
// Expense lines carry cost centre (→ NetSuite department + class) and location.
// Liability lines are company-level. Employer taxes and benefits are spread
// to cost centres in proportion to each worker's earnings by cost centre.
// Every line is validated against the account and segment mappings, and every
// subsidiary must balance, before the export is released.

import type { Company, CostCenter, Dataset, GlMapping, Location } from "../data/types.ts";
import type { PayResult } from "./payroll.ts";
import type { IntlWorkerResult } from "./intl.ts";
import { allocate, pct, roundCents, toDecimalString, type Cents } from "../util/money.ts";
import { COUNTRY_RULES } from "../config/intl.ts";

export interface JournalLine {
  journalId: string;
  companyId: string;
  currency: string;
  account: string;
  costCenterId: string;
  locationId: string;
  debit: Cents;
  credit: Cents;
  memo: string;
}

export interface JournalIssue {
  severity: "Error" | "Warning";
  journalId: string;
  line?: number;
  message: string;
}

export interface MappedLine extends JournalLine {
  netsuiteSubsidiary: string;
  netsuiteAccount: string;
  netsuiteAccountName: string;
  netsuiteDepartment: string;
  netsuiteClass: string;
  netsuiteLocation: string;
}

/** Credit-side account for employer costs (debit side is the component's expense account). */
export const EMPLOYER_LIABILITY: Record<string, string> = { SS_ER: "2111", MED_ER: "2111", FUTA: "2112", SUI: "2113", BEN_LOAD: "2130" };

const EXPENSE_TYPES = new Set(["Earning"]);
const CREDIT_TYPES = new Set(["Pre-Tax Deduction", "Post-Tax Deduction", "Employee Tax"]);

function add(map: Map<string, JournalLine>, l: JournalLine) {
  const k = [l.journalId, l.companyId, l.account, l.costCenterId, l.locationId, l.memo].join("|");
  const m = map.get(k);
  if (m) {
    m.debit += l.debit;
    m.credit += l.credit;
  } else map.set(k, { ...l });
}

export function usJournal(results: PayResult[], journalId: string, companyId = "NC-US"): JournalLine[] {
  const m = new Map<string, JournalLine>();
  const base = { journalId, companyId, currency: "USD" };
  for (const r of results) {
    const loc = r.worker.locationId;
    const ccs = Object.keys(r.earningsByCostCenter);
    const weights = ccs.map((c) => r.earningsByCostCenter[c]);
    for (const l of r.lines) {
      if (EXPENSE_TYPES.has(l.type)) {
        const isLiability = l.glAccount.startsWith("2");
        add(m, { ...base, account: l.glAccount, costCenterId: isLiability ? "" : (l.costCenterId ?? r.worker.costCenterId), locationId: isLiability ? "" : loc, debit: l.amount, credit: 0, memo: isLiability ? "Vacation payout relieves accrued PTO" : "" });
      } else if (CREDIT_TYPES.has(l.type)) {
        add(m, { ...base, account: l.glAccount, costCenterId: "", locationId: "", debit: 0, credit: l.amount, memo: l.state ? `${l.state}` : "" });
      } else {
        // Employer tax / benefit: debit expense by cost centre, credit liability.
        const parts = allocate(l.amount, weights.length ? weights : [1]);
        (ccs.length ? ccs : [r.worker.costCenterId]).forEach((cc, i) => add(m, { ...base, account: l.glAccount, costCenterId: cc, locationId: loc, debit: parts[i], credit: 0, memo: "" }));
        add(m, { ...base, account: EMPLOYER_LIABILITY[l.code], costCenterId: "", locationId: "", debit: 0, credit: l.amount, memo: "" });
      }
    }
    add(m, { ...base, account: "2100", costCenterId: "", locationId: "", debit: 0, credit: r.totals.net, memo: "Net pay, cleared on bank funding" });
  }
  return [...m.values()].filter((l) => l.debit !== 0 || l.credit !== 0).sort(sortLines);
}

export interface IntlJournals {
  local: JournalLine[];
  intercompany: JournalLine[]; // owning-entity side, in USD
}

/** Provider results → local-currency journal per subsidiary, plus intercompany recharges. */
export function intlJournals(results: IntlWorkerResult[], providerNet: Map<string, Cents>, providerGross: Map<string, Cents>, costCenters: CostCenter[], companies: Company[], month: string): IntlJournals {
  const m = new Map<string, JournalLine>();
  const ic = new Map<string, JournalLine>();
  for (const r of results) {
    const company = companies.find((c) => c.id === r.worker.companyId)!;
    const jid = `PR-${month}-${company.id}`;
    const base = { journalId: jid, companyId: company.id, currency: company.currency };
    // GL posts provider actuals (gross per provider), employer cost re-performed on that gross.
    const gross = providerGross.get(r.worker.id) ?? r.gross;
    const net = providerNet.get(r.worker.id) ?? 0;
    const rule = COUNTRY_RULES[r.worker.country];
    const er = roundCents(rule.employerStatutory(gross));
    const ben = pct(gross, rule.benefitsLoad);
    const cc = r.costCenterId;
    const loc = r.worker.locationId;
    add(m, { ...base, account: "6100", costCenterId: cc, locationId: loc, debit: gross, credit: 0, memo: "" });
    add(m, { ...base, account: "6200", costCenterId: cc, locationId: loc, debit: er, credit: 0, memo: "" });
    add(m, { ...base, account: "6300", costCenterId: cc, locationId: loc, debit: ben, credit: 0, memo: "" });
    add(m, { ...base, account: "2100", costCenterId: "", locationId: "", debit: 0, credit: net, memo: "Net pay (provider funds)" });
    add(m, { ...base, account: "2117", costCenterId: "", locationId: "", debit: 0, credit: gross - net, memo: "Employee statutory withholdings (provider remits)" });
    add(m, { ...base, account: "2116", costCenterId: "", locationId: "", debit: 0, credit: er, memo: "Employer statutory contributions" });
    add(m, { ...base, account: "2130", costCenterId: "", locationId: "", debit: 0, credit: ben, memo: "" });

    const owner = costCenters.find((c) => c.id === cc);
    if (owner && owner.companyId !== company.id) {
      // Cost centre budgeted in another entity: recharge at cost.
      const total = gross + er + ben;
      add(m, { ...base, account: "1300", costCenterId: "", locationId: "", debit: total, credit: 0, memo: `Intercompany receivable from ${owner.companyId}` });
      add(m, { ...base, account: "6900", costCenterId: cc, locationId: loc, debit: 0, credit: total, memo: `Recharge to ${owner.companyId} (${r.worker.id})` });
      const usd = roundCents(total * r.fx);
      const ob = { journalId: `IC-${month}-${owner.companyId}`, companyId: owner.companyId, currency: "USD" };
      add(ic, { ...ob, account: "6400", costCenterId: cc, locationId: loc, debit: usd, credit: 0, memo: `Intercompany service cost from ${company.id} (${r.worker.id})` });
      add(ic, { ...ob, account: "2300", costCenterId: "", locationId: "", debit: 0, credit: usd, memo: `Intercompany payable to ${company.id}` });
    }
  }
  return { local: [...m.values()].sort(sortLines), intercompany: [...ic.values()].sort(sortLines) };
}

function sortLines(a: JournalLine, b: JournalLine) {
  return (a.journalId + a.account + a.costCenterId + a.locationId).localeCompare(b.journalId + b.account + b.costCenterId + b.locationId);
}

export function validateAndMap(lines: JournalLine[], ds: Pick<Dataset, "glMapping" | "costCenters" | "locations" | "companies">): { mapped: MappedLine[]; issues: JournalIssue[] } {
  const issues: JournalIssue[] = [];
  const acct = new Map<string, GlMapping>(ds.glMapping.map((g) => [g.workdayAccount, g]));
  const ccs = new Map<string, CostCenter>(ds.costCenters.map((c) => [c.id, c]));
  const locs = new Map<string, Location>(ds.locations.map((l) => [l.id, l]));
  const cos = new Map<string, Company>(ds.companies.map((c) => [c.id, c]));
  const mapped = lines.map((l, i) => {
    const a = acct.get(l.account);
    const cc = l.costCenterId ? ccs.get(l.costCenterId) : undefined;
    const loc = l.locationId ? locs.get(l.locationId) : undefined;
    const co = cos.get(l.companyId);
    if (!a || !a.netsuiteAccount) issues.push({ severity: "Error", journalId: l.journalId, line: i + 1, message: `Workday account ${l.account} has no NetSuite account mapping.` });
    if (a?.type === "Expense" && !l.costCenterId) issues.push({ severity: "Error", journalId: l.journalId, line: i + 1, message: `Expense account ${l.account} requires a department (cost center).` });
    if (l.costCenterId && (!cc || !cc.netsuiteDepartmentId)) issues.push({ severity: "Error", journalId: l.journalId, line: i + 1, message: `Cost center ${l.costCenterId} is not mapped to a NetSuite department.` });
    if (l.locationId && (!loc || !loc.netsuiteLocationId)) issues.push({ severity: "Error", journalId: l.journalId, line: i + 1, message: `Location ${l.locationId} is not mapped to a NetSuite location.` });
    if (!co || !co.netsuiteSubsidiaryId) issues.push({ severity: "Error", journalId: l.journalId, line: i + 1, message: `Company ${l.companyId} is not mapped to a NetSuite subsidiary.` });
    if (co && co.currency !== l.currency) issues.push({ severity: "Error", journalId: l.journalId, line: i + 1, message: `Line currency ${l.currency} differs from subsidiary base currency ${co.currency}.` });
    if (l.debit < 0 || l.credit < 0) issues.push({ severity: "Warning", journalId: l.journalId, line: i + 1, message: "Negative amount; will be posted as the opposite side." });
    return {
      ...l,
      netsuiteSubsidiary: co?.netsuiteSubsidiaryId ?? "",
      netsuiteAccount: a?.netsuiteAccount ?? "",
      netsuiteAccountName: a?.netsuiteAccountName ?? "",
      netsuiteDepartment: cc?.netsuiteDepartmentId ?? "",
      netsuiteClass: cc?.netsuiteClass ?? "",
      netsuiteLocation: loc?.netsuiteLocationId ?? "",
    };
  });
  const byJournal = new Map<string, { d: Cents; c: Cents }>();
  for (const l of lines) {
    const t = byJournal.get(l.journalId) ?? { d: 0, c: 0 };
    t.d += l.debit;
    t.c += l.credit;
    byJournal.set(l.journalId, t);
  }
  for (const [j, t] of byJournal) if (t.d !== t.c) issues.push({ severity: "Error", journalId: j, message: `Out of balance: debits ${toDecimalString(t.d)} ≠ credits ${toDecimalString(t.c)}.` });
  return { mapped, issues };
}

/** date: accounting date for each journal (period end date: expense belongs to the period worked). */
export function netsuiteCsv(mapped: MappedLine[], date: string | ((journalId: string) => string)): string {
  const dateOf = typeof date === "function" ? date : () => date;
  const head = ["External ID", "Subsidiary", "Date", "Currency", "Account", "Account Name", "Debit", "Credit", "Department", "Class", "Location", "Memo"];
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = mapped.map((l) =>
    [l.journalId, l.netsuiteSubsidiary, dateOf(l.journalId), l.currency, l.netsuiteAccount, l.netsuiteAccountName, l.debit ? toDecimalString(l.debit) : "", l.credit ? toDecimalString(l.credit) : "", l.netsuiteDepartment, l.netsuiteClass, l.netsuiteLocation, l.memo].map((x) => esc(String(x))).join(","),
  );
  return [head.join(","), ...rows].join("\n") + "\n";
}

export function totalsByJournal(lines: JournalLine[]) {
  const m = new Map<string, { journalId: string; companyId: string; currency: string; debit: Cents; credit: Cents; lines: number }>();
  for (const l of lines) {
    const t = m.get(l.journalId) ?? { journalId: l.journalId, companyId: l.companyId, currency: l.currency, debit: 0, credit: 0, lines: 0 };
    t.debit += l.debit;
    t.credit += l.credit;
    t.lines++;
    m.set(l.journalId, t);
  }
  return [...m.values()];
}
