// Multi-period payroll on top of business processes.
//
// Oct 1–15 is the parallel-run period (semi-monthly, everyone). At go-live,
// salaried workers continue semi-monthly and hourly workers move to a biweekly
// pay group. Each later period starts from its prior period AS COMPLETED:
//   - year-to-date taxable wages roll forward (wage bases keep working),
//   - absence balances roll forward (prior ending = new opening),
//   - anything changed for the prior period after it was completed is
//     recalculated and the difference is paid now as retro (Workday behaviour).
// "As completed" is reproducible because the data at any moment is
// base package + business processes approved up to that moment.

import type { AbsenceBalance, Dataset, Ytd } from "../data/types.ts";
import { PRIOR_PERIOD, US_PERIOD, US_PERIODS, type PayPeriod } from "../config/period.ts";
import { runPeriod, type PeriodResult } from "../engine/run.ts";
import { applyBps } from "./apply.ts";
import type { BusinessProcess, ErpState } from "./types.ts";
import { fmt, type Cents } from "../util/money.ts";
import { pretty } from "../util/dates.ts";

const NON_TIME_EARNINGS = ["SAL", "VAC", "SICK", "PTO_PAYOUT", "BONUS"];
const FAR_FUTURE = "9999-12-31T00:00:00.000Z";

export interface PeriodView {
  period: PayPeriod;
  ds: Dataset;
  result: PeriodResult;
  retro: Map<string, { amount: Cents; explain: string }>;
  priorId?: string;
  priorCompleted: boolean;
}

export const periodById = (id: string) => US_PERIODS.find((p) => p.id === id) ?? US_PERIOD;

/** After go-live hourly US workers are paid biweekly; per-period deductions convert from 24 to 26 periods. */
export function assignGoLivePayGroups(ds: Dataset, period: PayPeriod): Dataset {
  if (period.id === US_PERIOD.id) return ds;
  return {
    ...ds,
    workers: ds.workers.map((w) =>
      w.workerType === "Employee" && w.country === "USA" && w.payType === "Hourly" && w.payGroup === "US Semi-Monthly"
        ? { ...w, payGroup: "US Biweekly", medicalPerPeriod: Math.round(((w.medicalPerPeriod * 24) / 26) * 100) / 100 }
        : w,
    ),
  };
}

export function rollForward(ds: Dataset, prior: PeriodResult): Dataset {
  const ytd = new Map<string, Ytd>(ds.ytd.map((y) => [y.employeeId, { ...y }]));
  for (const c of prior.us) {
    const y = ytd.get(c.worker.id) ?? { employeeId: c.worker.id, periods: 0, gross: 0, ssWages: 0, medicareWages: 0, futaWages: 0, suiWages: 0 };
    const t = c.pay.taxable;
    y.periods += 1;
    y.gross += c.pay.totals.gross / 100;
    y.ssWages += t.ssTaxable / 100;
    y.medicareWages += t.fica / 100;
    y.futaWages += t.futa / 100;
    y.suiWages += t.sui / 100;
    ytd.set(c.worker.id, y);
  }
  const paid = new Set(prior.us.map((c) => c.worker.id));
  const balances: AbsenceBalance[] = ds.balances.filter((b) => !paid.has(b.employeeId));
  for (const c of prior.us)
    for (const a of c.absence) balances.push({ employeeId: c.worker.id, plan: a.plan.code, balance: a.tracked ? a.ending : null, unit: a.unit, lastAccrualDate: prior.period.end, notes: `Rolled forward from ${prior.period.id}` });
  return { ...ds, ytd: [...ytd.values()], balances };
}

const completedAt = (erp: ErpState, id: string) => (erp.payRuns[id]?.status === "Completed" ? erp.payRuns[id].completedAt! : undefined);

/** Ancestors of a period, oldest first. */
function chain(id: string): string[] {
  const out: string[] = [];
  for (let p = PRIOR_PERIOD[id]; p; p = PRIOR_PERIOD[p]) out.unshift(p);
  return out;
}

/** Results of a period as of a moment (its own completion, or now). */
type Cache = Map<string, { ds: Dataset; result: PeriodResult }>;

function resultAsOf(base: Dataset, bps: BusinessProcess[], erp: ErpState, id: string, asOf: string | undefined, cache: Cache, display = false): { ds: Dataset; result: PeriodResult } {
  const key = `${id}|${asOf ?? "now"}|${display}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out = resultAsOfUncached(base, bps, erp, id, asOf, cache, display);
  cache.set(key, out);
  return out;
}

function resultAsOfUncached(base: Dataset, bps: BusinessProcess[], erp: ErpState, id: string, asOf: string | undefined, cache: Cache, display: boolean): { ds: Dataset; result: PeriodResult } {
  const period = periodById(id);
  const prior = PRIOR_PERIOD[id];
  if (!prior) {
    const ds = applyBps(base, bps, { asOf });
    return { ds, result: runPeriod(ds, period, undefined, { reconcileLegacy: display ? undefined : false }) };
  }
  // The prior period as it was completed (or provisionally, as of now).
  const priorAt = completedAt(erp, prior);
  const priorRes = resultAsOf(base, bps, erp, prior, priorAt, cache).result;
  // Data for this period: BPs up to asOf; time approved before the prior completed counts as already paid.
  let ds = applyBps(base, bps, { asOf, knownBy: { at: priorAt ?? FAR_FUTURE, asDate: periodById(prior).end } });
  for (const a of chain(id)) {
    const r = a === prior ? priorRes : resultAsOf(base, bps, erp, a, completedAt(erp, a), cache).result;
    ds = rollForward(assignGoLivePayGroups(ds, periodById(id)), r);
  }
  ds = assignGoLivePayGroups(ds, period);
  const retro = priorAt ? retroFor(base, bps, erp, prior, priorRes, cache) : new Map();
  return { ds, result: runPeriod(ds, period, undefined, { retro, reconcileLegacy: false }) };
}

function retroFor(base: Dataset, bps: BusinessProcess[], erp: ErpState, priorId: string, asCompleted: PeriodResult, cache: Cache) {
  const now = resultAsOf(base, bps, erp, priorId, undefined, cache).result;
  const earn = (r: PeriodResult) => {
    const m = new Map<string, Map<string, Cents>>();
    for (const c of r.us) {
      const byCode = new Map<string, Cents>();
      for (const l of c.pay.lines) if (NON_TIME_EARNINGS.includes(l.code)) byCode.set(l.code, (byCode.get(l.code) ?? 0) + l.amount);
      m.set(c.worker.id, byCode);
    }
    return m;
  };
  const was = earn(asCompleted);
  const is = earn(now);
  const retro = new Map<string, { amount: Cents; explain: string }>();
  const p = periodById(priorId);
  for (const id of new Set([...was.keys(), ...is.keys()])) {
    let total = 0;
    const parts: string[] = [];
    for (const code of new Set([...(was.get(id)?.keys() ?? []), ...(is.get(id)?.keys() ?? [])])) {
      const before = was.get(id)?.get(code) ?? 0;
      const after = is.get(id)?.get(code) ?? 0;
      if (after !== before) {
        total += after - before;
        parts.push(`${code} ${fmt(before)} → ${fmt(after)}`);
      }
    }
    if (total) retro.set(id, { amount: total, explain: `${pretty(p.start)}–${pretty(p.end)} recalculated after changes entered since it was completed: ${parts.join("; ")}` });
  }
  return retro;
}

export function computePeriod(base: Dataset, erp: ErpState, periodId: string): PeriodView {
  const period = periodById(periodId);
  const priorId = PRIOR_PERIOD[period.id];
  // A completed period is shown exactly as completed; an open one as of now.
  const { ds, result } = resultAsOf(base, erp.bps, erp, period.id, completedAt(erp, period.id), new Map(), true);
  const retro = new Map<string, { amount: Cents; explain: string }>();
  for (const c of result.us) {
    const l = c.pay.lines.find((x) => x.code === "RETRO" && x.explain.includes("recalculated after changes"));
    if (l) retro.set(c.worker.id, { amount: l.amount, explain: l.explain });
  }
  return { period, ds, result, retro, priorId, priorCompleted: priorId ? !!completedAt(erp, priorId) : true };
}

export function approvedCount(bps: BusinessProcess[]): number {
  return bps.filter((b) => b.status === "Approved").length;
}
