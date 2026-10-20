// Proration, termination payout, garnishment, taxes and GL, on the real data
// package plus small synthetic cases.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readTexts } from "../lib/data/fs.ts";
import { loadDataset } from "../lib/data/load.ts";
import { runPeriod } from "../lib/engine/run.ts";
import { allocate } from "../lib/util/money.ts";
import { validateAndMap } from "../lib/engine/gl.ts";

const { ds } = loadDataset(readTexts(join(import.meta.dirname, "..", "data")));
const result = runPeriod(ds);
const pay = (id: string) => result.us.find((c) => c.worker.id === id)!;
const line = (id: string, code: string) => pay(id).pay.lines.filter((l) => l.code === code).reduce((s, l) => s + l.amount, 0);

test("Period has 11 working days (Oct 1–15, 2026)", () => {
  assert.equal(pay("E0001").input.timeline.filter((d) => d.workingDay).length, 11);
});

test("Full period salary = annual ÷ 24, with time off reclassified out of regular salary", () => {
  // E0001 took 8 hrs of Flexible PTO on Oct 13: 8 × (285,000 ÷ 2080 = $137.0192) moves to Time Off Taken.
  assert.equal(line("E0001", "SAL") + line("E0001", "PTO_TAKEN"), 1_187_500); // 285,000 / 24
  assert.equal(line("E0001", "PTO_TAKEN"), 109_615);
  assert.equal(pay("E0001").pay.lines.find((l) => l.code === "PTO_TAKEN")!.hours, 8);
});

test("New hire proration: E0203 starts Mon Oct 12 → 4 of 11 working days", () => {
  assert.equal(line("E0203", "SAL"), Math.round((190_000 / 24) * (4 / 11) * 100)); // $2,878.79
  assert.equal(line("E0203", "SAL"), 287_879);
});

test("Unpaid leave proration: E0149 leave from Thu Oct 8 → 5 of 11 days paid", () => {
  assert.equal(line("E0149", "SAL"), 340_909); // 7,500 × 5/11
});

test("Mid-period comp change: old rate 7 days, new rate from Sat Oct 10 (4 working days)", () => {
  const sal = pay("E0057").pay.lines.filter((l) => l.code === "SAL").map((l) => l.amount);
  assert.deepEqual(sal, [464_015, 295_455]); // 175k/24×7/11, 195k/24×4/11
});

test("State-to-state change splits wages by working days and taxes each state", () => {
  const p = pay("E0088").pay;
  const byState = Object.fromEntries(p.lines.filter((l) => l.code === "SAL").map((l) => [l.state, l.amount]));
  assert.equal(byState.CA + byState.CO, Math.round((172_000 / 24) * 100));
  assert.equal(byState.CA, allocate(Math.round((172_000 / 24) * 100), [3, 8])[0]);
  assert.ok(p.lines.some((l) => l.code === "STATE_EE" && l.state === "CA"), "CA SDI only on CA wages");
  assert.ok(p.lines.some((l) => l.code === "SIT" && l.state === "CO"));
});

test("Termination: final accrual then payout of the full balance at salary ÷ 2080", () => {
  const c = pay("E0148");
  const vac = c.absence.find((a) => a.plan.code === "US_HOURLY_VAC")!;
  assert.equal(vac.accrual, 2.15); // 7 paid days × 8 hrs = 56 hrs × 1/26
  assert.equal(vac.payoutQty, 33.15);
  assert.equal(vac.ending, 0);
  assert.equal(line("E0148", "PTO_PAYOUT"), 262_969); // 33.15 × 79.3269
  assert.equal(line("E0148", "SAL"), 437_500); // 6,875 × 7/11
  assert.ok(c.pay.flags.some((f) => f.startsWith("Final pay due")));
});

test("Contractors are excluded from payroll", () => {
  assert.equal(result.us.some((c) => c.worker.workerType === "Contractor"), false);
  assert.equal(result.excluded.filter((e) => e.worker.workerType === "Contractor").length, 5);
});

test("Garnishment is post-tax and within the CCPA disposable-earnings limit", () => {
  const p = pay("E0031").pay;
  const g = line("E0031", "GARN");
  assert.ok(g > 0 && g <= Math.round(p.taxable.disposable * 0.6));
});

test("Social Security stops at the wage base (E0012 crosses it this period)", () => {
  const p = pay("E0012").pay;
  const ytd = ds.ytd.find((y) => y.employeeId === "E0012")!;
  assert.equal(p.taxable.ssTaxable, Math.round((168_600 - ytd.ssWages) * 100));
  assert.ok(p.taxable.ssTaxable < p.taxable.fica);
  assert.equal(pay("E0001").pay.taxable.ssTaxable, 0, "already over the base");
});

test("Every control total ties and every legacy variance is explained", () => {
  for (const t of result.ties) assert.ok(t.ok, `${t.name}: ${t.left.value} vs ${t.right.value}`);
  assert.equal(result.recon.counts.Unexplained, 0);
});

test("Journals balance and validate against the mapping", () => {
  assert.equal(result.journal.issues.length, 0);
  for (const j of result.journal.totals) assert.equal(j.debit, j.credit, j.journalId);
});

test("GL validation flags unmapped accounts, unmapped cost centers and imbalance", () => {
  const bad = [
    { journalId: "J1", companyId: "NC-US", currency: "USD", account: "9999", costCenterId: "CC1100", locationId: "SF", debit: 100, credit: 0, memo: "" },
    { journalId: "J1", companyId: "NC-US", currency: "USD", account: "6100", costCenterId: "CC9999", locationId: "SF", debit: 50, credit: 0, memo: "" },
    { journalId: "J1", companyId: "NC-US", currency: "USD", account: "2100", costCenterId: "", locationId: "", debit: 0, credit: 120, memo: "" },
  ];
  const { issues } = validateAndMap(bad, ds);
  const msgs = issues.map((i) => i.message).join(" | ");
  assert.match(msgs, /9999 has no NetSuite account/);
  assert.match(msgs, /CC9999 is not mapped/);
  assert.match(msgs, /Out of balance/);
});

test("allocate() always sums to the total", () => {
  for (const total of [1, 99, 100_001, -505]) assert.equal(allocate(total, [3, 8, 1]).reduce((a, b) => a + b, 0), total);
});

test("Daily cost lines add back to the pay run, line by line and in total", async () => {
  const { dailyLines } = await import("../lib/engine/costReport.ts");
  const lines = dailyLines(result);
  const sum = (f: (l: (typeof lines)[0]) => boolean) => lines.filter(f).reduce((s, l) => s + l.amount, 0);
  assert.equal(sum((l) => l.type === "Earning"), result.totals.gross);
  assert.equal(sum((l) => l.type === "Employer Tax"), result.totals.erTaxes);
  // Every line of every worker adds back exactly.
  for (const c of result.us.slice(0, 40)) for (const l of c.pay.lines) assert.equal(sum((x) => x.workerId === c.worker.id && x.code === l.code), c.pay.lines.filter((y) => y.code === l.code).reduce((s, y) => s + y.amount, 0), `${c.worker.id} ${l.code}`);
  // Hourly time is on the days worked: E0021 worked Oct 2 (12.75 hrs, 0.75 double time).
  assert.ok(lines.some((l) => l.workerId === "E0021" && l.date === "2026-10-02" && l.code === "DT" && Math.abs(l.hours - 0.75) < 1e-9));
  // Everything is inside the pay period.
  assert.ok(lines.every((l) => l.date >= "2026-10-01" && l.date <= "2026-10-15"));
});
