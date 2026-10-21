// ERP layer: business processes applied over the data package, pay run
// chaining (YTD and balances roll forward), retro after a completed period,
// biweekly go-live, and data entry validations.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readTexts } from "../lib/data/fs.ts";
import { loadDataset } from "../lib/data/load.ts";
import { applyBps } from "../lib/erp/apply.ts";
import { computePeriod, pendingForWorker, previewPending } from "../lib/erp/periods.ts";
import { validateHire, validateTimeEntry, validateTimeOff } from "../lib/erp/validate.ts";
import { plansForWorker } from "../lib/engine/absence.ts";
import type { BusinessProcess, ErpState } from "../lib/erp/types.ts";

const { ds: base } = loadDataset(readTexts(join(import.meta.dirname, "..", "data")));
let n = 0;
const bp = (type: BusinessProcess["type"], subjectId: string, effectiveDate: string, payload: Record<string, unknown>, decidedAt: string, status: BusinessProcess["status"] = "Approved"): BusinessProcess => ({
  id: `BP-T${++n}`, type, subjectId, subjectName: subjectId, summary: "", effectiveDate, payload, status, initiatedBy: "hr", initiatedAt: decidedAt, decidedBy: "mgr", decidedAt,
});
const erp = (bps: BusinessProcess[], completed: Record<string, string> = {}): ErpState => ({
  version: 1, bps, jobProfiles: [], seq: n,
  payRuns: Object.fromEntries(Object.entries(completed).map(([id, at]) => [id, { periodId: id, status: "Completed", completedAt: at }])),
});
const SM1 = "2026-10-SM1", SM2 = "2026-10-SM2", BWT = "2026-BW-T1";
const hire = (id: string, date: string, at: string, extra: Record<string, unknown> = {}) =>
  bp("Hire", id, date, { name: "Test Hire", jobProfile: "Software Engineer IC3", flsa: "Exempt", payType: "Salary", level: "IC3", costCenterId: "CC3100", locationId: "SF", workState: "CA", annualSalary: 150000, managerId: "E0007", ...extra }, at);

test("No business processes: Oct 1–15 is unchanged", () => {
  const v = computePeriod(base, erp([]), SM1);
  assert.equal(v.result.totals.gross, 197_379_491);
  assert.equal(v.result.recon.counts.Unexplained, 0);
});

test("An approved hire becomes a worker in the right pay group; a pending one does not", () => {
  const ds = applyBps(base, [hire("E0400", "2026-10-19", "2026-10-19T10:00:00Z"), { ...hire("E0401", "2026-10-19", "2026-10-19T10:00:00Z"), status: "Awaiting Approval" }]);
  const w = ds.workers.find((x) => x.id === "E0400")!;
  assert.equal(w.payGroup, "US Semi-Monthly");
  assert.equal(w.currency, "USD");
  assert.equal(ds.workers.some((x) => x.id === "E0401"), false);
});

test("Hire mid-period in an open period is prorated; legacy reconciliation calls it timing", () => {
  const v = computePeriod(base, erp([hire("E0400", "2026-10-12", "2026-10-19T10:00:00Z")]), SM1);
  const c = v.result.us.find((x) => x.worker.id === "E0400")!;
  assert.equal(c.pay.lines.find((l) => l.code === "SAL")!.amount, 227_273); // 150,000 / 24 × 4/11
  const rec = v.result.recon.employees.find((e) => e.employeeId === "E0400")!;
  assert.equal(rec.status, "Only in Workday");
  assert.equal(rec.causes[0].hypothesis.category, "Timing");
  assert.equal(v.result.recon.counts.Unexplained, 0);
});

test("A completed period is reproducible: later changes do not alter it", () => {
  const comp = bp("Change Compensation", "E0057", "2026-10-12", { annualSalary: 205000, oldAnnualSalary: 195000 }, "2026-10-20T09:00:00Z");
  const v = computePeriod(base, erp([comp], { [SM1]: "2026-10-19T12:00:00Z" }), SM1);
  assert.equal(v.result.totals.gross, 197_379_491);
});

test("Change to a completed period is paid as retro in the next period", () => {
  const comp = bp("Change Compensation", "E0057", "2026-10-12", { annualSalary: 205000, oldAnnualSalary: 195000 }, "2026-10-20T09:00:00Z");
  const v = computePeriod(base, erp([comp], { [SM1]: "2026-10-19T12:00:00Z" }), SM2);
  const e = v.result.us.find((x) => x.worker.id === "E0057")!;
  const retro = e.pay.lines.find((l) => l.code === "RETRO")!;
  assert.equal(retro.amount, 15_151); // (205k − 195k) / 24 × 4/11, rounded per segment
  assert.equal(e.pay.lines.find((l) => l.code === "SAL")!.amount, Math.round((205000 / 24) * 100)); // new rate all of Oct 16–31
});

test("Year-to-date rolls forward: the Social Security wage base keeps working", () => {
  const v = computePeriod(base, erp([], { [SM1]: "2026-10-19T12:00:00Z" }), SM2);
  // E0012 crossed the $168,600 base in Oct 1–15, so no Social Security in Oct 16–31.
  assert.equal(v.result.us.find((x) => x.worker.id === "E0012")!.pay.taxable.ssTaxable, 0);
  // E0148 terminated Oct 9: not in Oct 16–31.
  assert.equal(v.result.us.some((x) => x.worker.id === "E0148"), false);
});

test("Go-live: hourly workers move to US Biweekly (26 periods); salaried stay semi-monthly", () => {
  const sm2 = computePeriod(base, erp([], { [SM1]: "2026-10-19T12:00:00Z" }), SM2);
  const bw = computePeriod(base, erp([], { [SM1]: "2026-10-19T12:00:00Z" }), BWT);
  assert.equal(sm2.result.us.some((c) => c.worker.payType === "Hourly"), false);
  assert.equal(bw.result.us.every((c) => c.worker.payType === "Hourly"), true);
  assert.equal(bw.result.period.periodsPerYear, 26);
  const e21 = bw.ds.workers.find((w) => w.id === "E0021")!;
  const orig = base.workers.find((w) => w.id === "E0021")!;
  assert.equal(e21.medicalPerPeriod, Math.round(((orig.medicalPerPeriod * 24) / 26) * 100) / 100);
  // Balances roll forward: E0021 vacation opening in the transition period = Oct 1–15 ending.
  assert.equal(bw.result.us.find((c) => c.worker.id === "E0021")!.absence.find((a) => a.plan.code === "US_HOURLY_VAC")!.opening, 50.49);
});

test("Late time for a completed period is paid once, as retro; time approved before completion is not paid again", () => {
  const row = (id: string, date: string) => ({ rowId: id, workDate: date, timeIn: "06:00", timeOut: "10:00", mealStart: "", mealEnd: "" });
  // Extra Saturday shift for E0023 on Oct 10, approved after Oct 1–15 was completed.
  const late = bp("Enter Time", "E0023", "2026-10-10", { rows: [row("W1", "2026-10-10")] }, "2026-10-20T09:00:00Z");
  const v = computePeriod(base, erp([late], { [SM1]: "2026-10-19T12:00:00Z" }), BWT);
  const retro = v.result.us.find((c) => c.worker.id === "E0023")!.pay.lines.filter((l) => l.code === "RETRO");
  assert.equal(retro.length, 1);
  assert.ok(retro[0].amount > 0);
  // The same shift approved BEFORE completion was paid in Oct 1–15: no retro afterwards.
  const early = { ...late, decidedAt: "2026-10-18T09:00:00Z" };
  const v2 = computePeriod(base, erp([early], { [SM1]: "2026-10-19T12:00:00Z" }), BWT);
  assert.equal(v2.result.us.find((c) => c.worker.id === "E0023")!.pay.lines.some((l) => l.code === "RETRO"), false);
});

test("Termination entered after completion recovers the overpayment as negative retro", () => {
  const term = bp("Terminate", "E0057", "2026-10-09", { reason: "Voluntary: resignation" }, "2026-10-20T09:00:00Z");
  const v = computePeriod(base, erp([term], { [SM1]: "2026-10-19T12:00:00Z" }), SM2);
  const e = v.result.us.find((c) => c.worker.id === "E0057")!;
  assert.ok(e.pay.lines.find((l) => l.code === "RETRO")!.amount < 0);
  assert.ok(e.pay.flags.some((f) => /Negative net/.test(f)));
});

test("Time entry validation blocks duplicates and overlaps, warns on CA meal problems", () => {
  const w = base.workers.find((x) => x.id === "E0021")!;
  const dup = validateTimeEntry(base, [], w, { workDate: "2026-10-05", timeIn: "06:00", timeOut: "14:30", mealStart: "10:30", mealEnd: "11:00" });
  assert.match(dup.errors.join(), /Duplicate/);
  const overlap = validateTimeEntry(base, [], w, { workDate: "2026-10-05", timeIn: "13:00", timeOut: "18:00" });
  assert.match(overlap.errors.join(), /Overlaps/);
  const late = validateTimeEntry(base, [], w, { workDate: "2026-10-20", timeIn: "06:00", timeOut: "15:00", mealStart: "11:30", mealEnd: "12:00" });
  assert.equal(late.errors.length, 0);
  assert.match(late.warnings.join(), /after the end of the 5th hour/);
  const salaried = validateTimeEntry(base, [], base.workers.find((x) => x.id === "E0001")!, { workDate: "2026-10-20", timeIn: "09:00", timeOut: "17:00" });
  assert.match(salaried.errors.join(), /salaried/);
});

test("Hire validation enforces 2026 California minimum wage and exempt salary threshold", () => {
  const f = { name: "Test Person", hireDate: "2026-10-20", jobProfile: "x", flsa: "Non-Exempt", payType: "Hourly", level: "T1", costCenterId: "CC2100", locationId: "SJ", workState: "CA", annualSalary: 0, hourlyRate: 15, managerId: "E0005" };
  assert.match(validateHire(base, f, ["CA", "TX"]).errors.join(), /minimum wage/);
  const ex = { ...f, flsa: "Exempt", payType: "Salary", hourlyRate: 0, annualSalary: 60000 };
  assert.match(validateHire(base, ex, ["CA", "TX"]).errors.join(), /70,304/);
  assert.equal(validateHire(base, { ...ex, annualSalary: 90000 }, ["CA", "TX"]).errors.length, 0);
});

test("Correcting approved time off replaces the day once approved; zero cancels it; a pending change does nothing", () => {
  const fix = (q: number, status: BusinessProcess["status"] = "Approved") => bp("Correct Time Off", "E0024", "2026-10-09", { plan: "US_HOURLY_VAC", unit: "hours", date: "2026-10-09", quantity: q, oldQuantity: 8 }, "2026-10-20T10:00:00Z", status);
  const day = (ds: ReturnType<typeof applyBps>) => ds.absences.filter((a) => a.employeeId === "E0024" && a.date === "2026-10-09" && a.plan === "US_HOURLY_VAC" && a.status === "Approved");
  assert.deepEqual(day(applyBps(base, [fix(4)])).map((a) => a.quantity), [4]);
  assert.equal(day(applyBps(base, [fix(0)])).length, 0);
  assert.deepEqual(day(applyBps(base, [fix(4, "Awaiting Approval")])).map((a) => a.quantity), [8]);
});

test("A time off correction in a completed period leaves it as paid and is paid as retro next period", () => {
  const fix = bp("Correct Time Off", "E0024", "2026-10-09", { plan: "US_HOURLY_VAC", unit: "hours", date: "2026-10-09", quantity: 4, oldQuantity: 8 }, "2026-10-21T10:00:00Z");
  const state = erp([fix], { [SM1]: "2026-10-20T09:00:00Z" });
  const before = computePeriod(base, erp([], { [SM1]: "2026-10-20T09:00:00Z" }), SM1).result.totals.gross;
  assert.equal(computePeriod(base, state, SM1).result.totals.gross, before);
  const r = computePeriod(base, state, BWT).retro.get("E0024");
  assert.ok(r && r.amount < 0, "four fewer vacation hours are recovered as negative retro");
});

test("Retro time off is itemized on the next pay run with the date and hours", () => {
  const done = { [SM1]: "2026-10-20T09:00:00Z" };
  // Hourly: 8 → 4 hrs vacation on Oct 9 is recovered at the base rate on the next (biweekly) run.
  const hourly = bp("Correct Time Off", "E0024", "2026-10-09", { plan: "US_HOURLY_VAC", unit: "hours", date: "2026-10-09", quantity: 4, oldQuantity: 8 }, "2026-10-21T10:00:00Z");
  const h = computePeriod(base, erp([hourly], done), BWT).result.us.find((c) => c.worker.id === "E0024")!;
  const hl = h.pay.lines.find((l) => l.code === "RETRO" && l.explain.startsWith("Retro time off"))!;
  assert.equal(hl.hours, -4);
  assert.match(hl.explain, /Fri Oct 9: 8\.00 → 4\.00 hours/);
  assert.equal(hl.amount, -4 * 3825); // 4 hrs × $38.25
  // Salaried: 8 → 4 hrs Flexible PTO on Oct 13 is shown on the next run, with no pay change.
  const salaried = bp("Correct Time Off", "E0001", "2026-10-13", { plan: "US_FLEX_PTO", unit: "hours", date: "2026-10-13", quantity: 4, oldQuantity: 8 }, "2026-10-21T10:00:00Z");
  const s = computePeriod(base, erp([salaried], done), SM2).result.us.find((c) => c.worker.id === "E0001")!;
  const sl = s.pay.lines.find((l) => l.code === "RETRO" && l.explain.startsWith("Retro time off"))!;
  assert.equal(sl.hours, -4);
  assert.equal(sl.amount, 0);
  assert.match(sl.explain, /Tue Oct 13: 8\.00 → 4\.00 hours/);
});

test("A recovery larger than the pay run is a critical error until net pay is held at zero; the rest is recovered next pay run", () => {
  const cancel = bp("Correct Time Off", "E0024", "2026-10-09", { plan: "US_HOURLY_VAC", unit: "hours", date: "2026-10-09", quantity: 0, oldQuantity: 8 }, "2026-10-21T10:00:00Z");
  const done = { [SM1]: "2026-10-20T09:00:00Z" };
  // Without the fix: negative net pay is a critical finding.
  const bad = computePeriod(base, erp([cancel], done), BWT).result;
  const e = bad.us.find((c) => c.worker.id === "E0024")!;
  assert.ok(e.pay.totals.net < 0);
  assert.ok(bad.audit.some((a) => a.check === "Negative net pay" && a.employeeId === "E0024" && a.severity === "Critical"));
  // With the fix: gross and net held at zero, and the controls tie.
  const fixed = erp([cancel], done);
  fixed.payRuns[BWT] = { periodId: BWT, status: "Not started", deferRecovery: true };
  const ok = computePeriod(base, fixed, BWT).result;
  const f = ok.us.find((c) => c.worker.id === "E0024")!;
  assert.equal(f.pay.totals.gross, 0);
  assert.equal(f.pay.totals.net, 0);
  assert.equal(ok.audit.some((a) => a.check === "Negative net pay"), false);
  assert.ok(ok.ties.every((t) => t.ok));
  const deferred = f.pay.lines.find((l) => l.explain.startsWith("Overpayment recovery deferred"))!.amount;
  assert.ok(deferred > 0);
  // The next pay run recovers what was deferred.
  const next = computePeriod(base, fixed, "2026-BW-02").result.us.find((c) => c.worker.id === "E0024")!;
  assert.equal(next.pay.lines.find((l) => l.explain.startsWith("Overpayment recovery carried"))!.amount, -deferred);
});

test("Organisation structure: CIO and International under the CEO, People Technology under the CFO", async () => {
  const { orgNodes, orgPath, chainTo, directReports } = await import("../lib/config/org.ts");
  const nodes = orgNodes(base.workers);
  assert.deepEqual(directReports(nodes, "E0000").map((n) => n.id).sort(), ["E0005", "E0010", "P-CIO", "P-INTL"]);
  assert.deepEqual(directReports(nodes, "P-CIO").map((n) => n.id).sort(), ["E0002", "E0007"]);
  assert.ok(directReports(nodes, "E0010").some((n) => n.id === "P-PTECH"));
  assert.deepEqual(orgPath(nodes, "E0012"), ["NeoCloud", "CIO Organisation", "Engineering, USA"]);
  assert.deepEqual(orgPath(nodes, "E0008"), ["NeoCloud", "International"]); // Canada
  assert.deepEqual(chainTo(nodes, "E0021").map((n) => n.id), ["E0000", "E0005", "E0021"]); // On-Prem unchanged
  // Every US Engineering and GPU Cloud employee is in the CIO organisation; nobody outside the US is.
  for (const w of base.workers.filter((x) => ["Engineering", "GPU Cloud"].includes(x.department) && x.workerType === "Employee" && !x.terminationDate)) {
    assert.equal(orgPath(nodes, w.id).includes("CIO Organisation"), w.country === "USA", w.id);
  }
});

test("Every worker sees each time off type they are eligible for", () => {
  const codes = (id: string) => plansForWorker(base.workers.find((w) => w.id === id)!, base.balances).filter((p) => p.code !== "US_FLEX_PTO" || p.isEligible(base.workers.find((w) => w.id === id)!)).map((p) => p.code).sort();
  assert.deepEqual(codes("E0021"), ["CA_SICK", "US_BEREAVEMENT", "US_HOURLY_VAC", "US_JURY_DUTY"]); // CA hourly
  assert.deepEqual(codes("E0001"), ["US_BEREAVEMENT", "US_FLEX_PTO", "US_JURY_DUTY", "US_SICK_EXEMPT"]); // US exempt
  assert.deepEqual(codes("E0006"), ["UK_ANNUAL", "UK_SICK"]);
  assert.deepEqual(codes("E0009"), ["IND_EL", "IND_SL"]);
});

test("Hourly bereavement is paid at the base rate; the yearly limit is enforced", () => {
  const ds = applyBps(base, [bp("Request Time Off", "E0021", "2026-10-12", { plan: "US_BEREAVEMENT", unit: "hours", days: [{ date: "2026-10-12", quantity: 8 }] }, "2026-10-12T10:00:00Z")]);
  const c = computePeriod(base, erp([bp("Request Time Off", "E0021", "2026-10-12", { plan: "US_BEREAVEMENT", unit: "hours", days: [{ date: "2026-10-12", quantity: 8 }] }, "2026-10-12T10:00:00Z")]), SM1).result.us.find((x) => x.worker.id === "E0021")!;
  const l = c.pay.lines.find((x) => x.code === "LEAVE_PAID")!;
  assert.equal(l.amount, 8 * 4200);
  assert.equal(l.hours, 8);
  const w = ds.workers.find((x) => x.id === "E0021")!;
  const days = [1, 2, 3, 4, 5].map((d) => ({ date: `2026-11-0${d + 1}`, quantity: 8 }));
  assert.ok(validateTimeOff(ds, [], w, "US_BEREAVEMENT", days, null).errors.some((e) => e.includes("40 hours a year")));
});

test("An approved W-4 change sets the filing status payroll uses; a pending one does not", () => {
  const w4 = (status: BusinessProcess["status"]) => bp("Change Tax Withholding", "E0001", "2026-10-20", { filingStatus: "MFJ" }, "2026-10-20T10:00:00Z", status);
  const before = base.workers.find((w) => w.id === "E0001")!.filingStatus;
  assert.equal(applyBps(base, [w4("Awaiting Approval")]).workers.find((w) => w.id === "E0001")!.filingStatus, before);
  assert.equal(applyBps(base, [w4("Approved")]).workers.find((w) => w.id === "E0001")!.filingStatus, "MFJ");
  const fit = (bps: BusinessProcess[]) => computePeriod(base, erp(bps), SM2).result.us.find((c) => c.worker.id === "E0001")!.pay.lines.find((l) => l.code === "FIT")!.amount;
  if (before === "Single") assert.ok(fit([w4("Approved")]) < fit([]), "married filing jointly withholds less");
});

test("A submitted timesheet week becomes approved time rows for each day", () => {
  const rows = ["2026-10-19", "2026-10-20"].map((d, i) => ({ rowId: `WT${i}`, workDate: d, timeIn: "06:00", timeOut: "14:30", mealStart: "10:30", mealEnd: "11:00", shift: "Day", notes: "" }));
  const ds = applyBps(base, [bp("Enter Time", "E0021", "2026-10-19", { rows }, "2026-10-21T10:00:00Z")]);
  assert.deepEqual(ds.time.filter((t) => t.employeeId === "E0021" && t.source === "erp").map((t) => t.workDate), ["2026-10-19", "2026-10-20"]);
});

test("Mid-period hire and termination are prorated; hourly vacation is paid out on termination", () => {
  // Salaried hire Wed Oct 21 into Oct 16–31 (11 working days): paid 8 of 11.
  const sHire = hire("E0410", "2026-10-21", "2026-10-21T09:00:00Z", { annualSalary: 165000 });
  const sm2 = computePeriod(base, erp([sHire], { [SM1]: "2026-10-20T09:00:00Z" }), SM2).result.us.find((c) => c.worker.id === "E0410")!;
  const sal = sm2.pay.lines.filter((l) => l.code === "SAL").reduce((s, l) => s + l.amount, 0);
  assert.equal(sal, Math.round((165000 / 24) * (8 / 11) * 100));
  // Hourly hire Wed Oct 21: biweekly, paid only for time worked.
  const hHire = hire("E0411", "2026-10-21", "2026-10-21T09:00:00Z", { jobProfile: "Data Center Technician", flsa: "Non-Exempt", payType: "Hourly", level: "T2", costCenterId: "CC2100", locationId: "SJ", hourlyRate: 40, annualSalary: 0, managerId: "E0005", shift: "Day" });
  const time = bp("Enter Time", "E0411", "2026-10-21", { rows: [{ rowId: "WH1", workDate: "2026-10-21", timeIn: "08:00", timeOut: "16:30", mealStart: "12:00", mealEnd: "12:30", shift: "Day", notes: "" }] }, "2026-10-22T09:00:00Z");
  const bw = computePeriod(base, erp([hHire, time], { [SM1]: "2026-10-20T09:00:00Z" }), BWT).result.us.find((c) => c.worker.id === "E0411")!;
  assert.equal(bw.worker.payGroup, "US Biweekly");
  assert.equal(bw.pay.lines.find((l) => l.code === "REG")!.amount, 8 * 4000);
  // Salaried termination Fri Oct 23 in Oct 16–31: paid 6 of 11 working days (Oct 16, 19–23).
  const sTerm = bp("Terminate", "E0012", "2026-10-23", { reason: "Resignation" }, "2026-10-21T09:00:00Z");
  const t = computePeriod(base, erp([sTerm], { [SM1]: "2026-10-20T09:00:00Z" }), SM2).result.us.find((c) => c.worker.id === "E0012")!;
  const annual = base.workers.find((w) => w.id === "E0012")!.annualSalary;
  assert.equal(t.pay.lines.filter((l) => l.code === "SAL").reduce((s, l) => s + l.amount, 0), Math.round((annual / 24) * (6 / 11) * 100));
  // Hourly termination Fri Oct 23: vacation balance paid out.
  const hTerm = bp("Terminate", "E0024", "2026-10-23", { reason: "Resignation" }, "2026-10-21T09:00:00Z");
  const p = computePeriod(base, erp([hTerm], { [SM1]: "2026-10-20T09:00:00Z" }), BWT).result.us.find((c) => c.worker.id === "E0024")!;
  const payout = p.pay.lines.find((l) => l.code === "PTO_PAYOUT");
  assert.ok(payout && payout.amount > 0, "vacation paid out");
  const vac = p.absence.find((a) => a.plan.code === "US_HOURLY_VAC")!;
  assert.equal(vac.ending, 0);
  assert.equal(payout!.amount, Math.round(vac.payoutQty * 38.25 * 100));
});

test("Payroll inputs: one-time for a pay period, retro for a completed one, ongoing between dates, deduction adjustments", () => {
  const input = (id: string, payload: Record<string, unknown>, at = "2026-10-21T10:00:00Z") => ({ ...bp("Payroll Input", "E0001", "2026-10-21", { input: payload }, at), id });
  const done = { [SM1]: "2026-10-20T09:00:00Z" };
  const lineOf = (v: ReturnType<typeof computePeriod>, id: string, code: string) => v.result.us.find((c) => c.worker.id === id)!.pay.lines.filter((l) => l.code === code);
  // One-time bonus in Oct 16–31.
  const bonus = input("BP-PI1", { code: "BONUS", amount: 2500, kind: "one-time", periodId: SM2, reason: "Spot bonus" });
  assert.equal(lineOf(computePeriod(base, erp([bonus], done), SM2), "E0001", "BONUS")[0].amount, 250000);
  // Missed earnings for the completed Oct 1–15: paid as retro in Oct 16–31; Oct 1–15 stays as paid.
  const missed = input("BP-PI2", { code: "ADJ_EARN", amount: 400, kind: "one-time", periodId: SM1, reason: "Missed on-call pay" });
  const state = erp([missed], done);
  assert.equal(lineOf(computePeriod(base, state, SM1), "E0001", "ADJ_EARN").length, 0);
  assert.equal(lineOf(computePeriod(base, state, SM2), "E0001", "RETRO").reduce((s, l) => s + l.amount, 0), 40000);
  // Ongoing $100 per period from Oct 16 to Oct 31: in Oct 16–31 only.
  const ongoing = input("BP-PI3", { code: "ADJ_EARN", amount: 100, kind: "ongoing", start: "2026-10-16", end: "2026-10-31", reason: "Phone stipend" });
  assert.equal(lineOf(computePeriod(base, erp([ongoing], done), SM2), "E0001", "ADJ_EARN")[0].amount, 10000);
  assert.equal(lineOf(computePeriod(base, erp([ongoing], done), SM1), "E0001", "ADJ_EARN").length, 0);
  // 401(k) catch-up of $150 adds to the deduction and lowers federal taxable wages.
  const k = input("BP-PI4", { code: "K401", amount: 150, kind: "one-time", periodId: SM2, reason: "Missed 401(k) deferral" });
  const before = computePeriod(base, erp([], done), SM2).result.us.find((c) => c.worker.id === "E0001")!.pay;
  const after = computePeriod(base, erp([k], done), SM2).result.us.find((c) => c.worker.id === "E0001")!.pay;
  assert.equal(after.totals.preTax - before.totals.preTax, 15000);
  assert.equal(before.taxable.fit - after.taxable.fit, 15000);
});

test("Pending time can be previewed on a worker's pay without being approved", () => {
  const rows = [{ rowId: "WP1", workDate: "2026-10-19", timeIn: "08:00", timeOut: "20:30", mealStart: "12:00", mealEnd: "12:30", shift: "Day", notes: "" }];
  const pending = bp("Enter Time", "E0021", "2026-10-19", { rows }, "2026-10-21T10:00:00Z", "Awaiting Approval");
  const state = erp([pending], { [SM1]: "2026-10-20T09:00:00Z" });
  const emma = (v: ReturnType<typeof computePeriod>) => v.result.us.find((c) => c.worker.id === "E0021")!;
  const now = emma(computePeriod(base, state, BWT));
  const { pending: found, view } = previewPending(base, state, BWT, "E0021");
  assert.deepEqual(found.map((b) => b.id), [pending.id]);
  assert.equal(pendingForWorker(state.bps, "E0020").length, 0);
  const after = emma(view);
  const hours = (c: typeof now, code: string) => c.pay.lines.filter((l) => l.code === code).reduce((s, l) => s + (l.hours ?? 0), 0);
  assert.equal(hours(after, "OT") - hours(now, "OT"), 4, "12 hours worked: 4 daily overtime hours in California");
  assert.ok(after.pay.totals.gross > now.pay.totals.gross);
  assert.equal(state.bps[0].status, "Awaiting Approval", "the preview approves nothing");
  // Same as actually approving it.
  const approved = emma(computePeriod(base, erp([{ ...pending, status: "Approved" }], { [SM1]: "2026-10-20T09:00:00Z" }), BWT));
  assert.equal(after.pay.totals.net, approved.pay.totals.net);
});
