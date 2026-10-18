import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readTexts } from "../lib/data/fs.ts";
import { loadDataset } from "../lib/data/load.ts";
import { runPeriod } from "../lib/engine/run.ts";

const { ds } = loadDataset(readTexts(join(import.meta.dirname, "..", "data")));
const r = runPeriod(ds);
const usAbs = (id: string, plan: string) => r.us.find((c) => c.worker.id === id)!.absence.find((a) => a.plan.code === plan)!;
const intlAbs = (id: string) => r.intl.find((c) => c.worker.id === id)!.absence[0];

test("Hourly vacation accrues on hours worked; CA sick at 1 per 30", () => {
  const t = r.us.find((c) => c.worker.id === "E0021")!;
  const hrs = t.time!.hoursWorkedInPeriod;
  assert.equal(usAbs("E0021", "US_HOURLY_VAC").accrual, Math.round((hrs / 26) * 100) / 100);
  assert.equal(usAbs("E0021", "CA_SICK").accrual, Math.round((hrs / 30) * 100) / 100);
});

test("Paid time off reduces the balance and is not hours worked", () => {
  const v = usAbs("E0024", "US_HOURLY_VAC");
  assert.equal(v.taken, 8);
  const c = r.us.find((x) => x.worker.id === "E0024")!;
  assert.equal(c.time!.days.some((d) => d.date === "2026-10-09"), false);
});

test("International monthly accruals: UK 25/12, Ontario 15/12, India 18/12", () => {
  assert.equal(intlAbs("E0006").accrual, 2.08);
  assert.equal(intlAbs("E0006").ending, 14.58); // 14.5 + 2.08 − 2 days taken
  assert.equal(intlAbs("E0008").accrual, 1.25);
  assert.equal(intlAbs("E0009").accrual, 1.5);
});

test("International hire prorates by calendar days; leaver is paid out", () => {
  assert.equal(intlAbs("E0340").accrual, Math.round(1.25 * (17 / 31) * 100) / 100);
  const leaver = r.intl.find((c) => c.worker.id === "E0315")!;
  assert.ok(leaver.lines.some((l) => l.code === "LEAVE_PAYOUT"));
  assert.equal(leaver.absence[0].ending, 0);
});

test("Statutory leave keeps accruing (UK maternity)", () => {
  assert.equal(intlAbs("E0318").accrual, 2.08);
});

test("Reconciliation re-performs each variance (no seeded list used)", () => {
  const e = r.recon.employees.find((x) => x.employeeId === "E0203")!;
  assert.equal(e.status, "Explained");
  assert.equal(e.causes[0].hypothesis.id, "hireAtPeriodStart");
  assert.equal(e.causes[0].impact.gross, 503_788); // 7 working days overpaid
  const c = r.recon.employees.find((x) => x.employeeId === "C0003")!;
  assert.equal(c.causes[0].hypothesis.category, "Data");
});

test("Provider reconciliation flags the late India comp change as timing", () => {
  const v = r.providerVariances.find((x) => x.employeeId === "E0330")!;
  assert.equal(v.category, "Timing");
});
