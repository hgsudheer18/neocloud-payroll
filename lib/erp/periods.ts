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
import { PERIOD_LABEL, PRIOR_PERIOD, US_PERIOD, US_PERIODS, type PayPeriod } from "../config/period.ts";
import { runPeriod, type PeriodResult } from "../engine/run.ts";
import type { PriorPeriodRetro, RetroTimeOff } from "../engine/payroll.ts";
import { applyBps } from "./apply.ts";
import type { BusinessProcess, ErpState } from "./types.ts";
import { fmt, type Cents } from "../util/money.ts";
import { pretty } from "../util/dates.ts";

const NON_TIME_EARNINGS = ["SAL", "PTO_TAKEN", "VAC", "SICK", "PTO_PAYOUT", "BONUS"];
const FAR_FUTURE = "9999-12-31T00:00:00.000Z";

export interface PeriodView {
  period: PayPeriod;
  ds: Dataset;
  result: PeriodResult;
  retro: Map<string, PriorPeriodRetro>;
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
    return { ds, result: runPeriod(ds, period, undefined, { reconcileLegacy: display ? undefined : false, deferRecovery: erp.payRuns[id]?.deferRecovery }) };
  }
  // The prior period as it was completed (or provisionally, as of now).
  const priorAt = completedAt(erp, prior);
  const priorAsPaid = resultAsOf(base, bps, erp, prior, priorAt, cache);
  const priorRes = priorAsPaid.result;
  // Data for this period: BPs up to asOf; time approved before the prior completed counts as already paid.
  let ds = applyBps(base, bps, { asOf, knownBy: { at: priorAt ?? FAR_FUTURE, asDate: periodById(prior).end } });
  for (const a of chain(id)) {
    const r = a === prior ? priorRes : resultAsOf(base, bps, erp, a, completedAt(erp, a), cache).result;
    ds = rollForward(assignGoLivePayGroups(ds, periodById(id)), r);
  }
  ds = assignGoLivePayGroups(ds, period);
  const retro = priorAt ? retroFor(base, bps, erp, prior, priorAsPaid, cache) : new Map();
  // Recovery the prior pay run deferred is taken from this one.
  const carried = new Map<string, Cents>();
  for (const c of priorRes.us) {
    const d = c.pay.lines.filter((l) => l.code === "RETRO" && l.explain.startsWith("Overpayment recovery deferred")).reduce((s, l) => s + l.amount, 0);
    if (d > 0) carried.set(c.worker.id, d);
  }
  return { ds, result: runPeriod(ds, period, undefined, { retro, reconcileLegacy: false, carried: { amounts: carried, from: PERIOD_LABEL[prior] }, deferRecovery: erp.payRuns[id]?.deferRecovery }) };
}

function retroFor(base: Dataset, bps: BusinessProcess[], erp: ErpState, priorId: string, asPaid: { ds: Dataset; result: PeriodResult }, cache: Cache) {
  const asCompleted = asPaid.result;
  const nowView = resultAsOf(base, bps, erp, priorId, undefined, cache);
  const now = nowView.result;
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
  const retro = new Map<string, PriorPeriodRetro>();
  const p = periodById(priorId);
  const timeOff = timeOffChanges(asPaid.ds, nowView.ds, p);
  for (const id of new Set([...was.keys(), ...is.keys(), ...timeOff.keys()])) {
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
    const items = timeOff.get(id);
    if (total || items) retro.set(id, { amount: total, explain: `${pretty(p.start)}–${pretty(p.end)} recalculated after changes entered since it was completed: ${parts.join("; ") || "no pay change"}`, timeOff: items });
  }
  return retro;
}

/** Approved time off in a period, as paid versus as known now: the days whose hours changed, by worker. */
function timeOffChanges(paid: Dataset, now: Dataset, p: PayPeriod): Map<string, RetroTimeOff[]> {
  const sum = (ds: Dataset) => {
    const m = new Map<string, { employeeId: string; plan: string; date: string; unit: string; qty: number }>();
    for (const a of ds.absences) {
      if (a.status !== "Approved" || a.date < p.start || a.date > p.end) continue;
      const k = `${a.employeeId}|${a.plan}|${a.date}`;
      const e = m.get(k) ?? { employeeId: a.employeeId, plan: a.plan, date: a.date, unit: a.unit, qty: 0 };
      e.qty += a.quantity;
      m.set(k, e);
    }
    return m;
  };
  const before = sum(paid);
  const after = sum(now);
  const out = new Map<string, RetroTimeOff[]>();
  for (const k of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(k);
    const a = after.get(k);
    if ((b?.qty ?? 0) === (a?.qty ?? 0)) continue;
    const e = (a ?? b)!;
    if (!out.has(e.employeeId)) out.set(e.employeeId, []);
    out.get(e.employeeId)!.push({ date: e.date, plan: e.plan, unit: e.unit, before: b?.qty ?? 0, after: a?.qty ?? 0 });
  }
  for (const items of out.values()) items.sort((x, y) => (x.date < y.date ? -1 : 1));
  return out;
}

export function computePeriod(base: Dataset, erp: ErpState, periodId: string): PeriodView {
  const period = periodById(periodId);
  const priorId = PRIOR_PERIOD[period.id];
  // A completed period is shown exactly as completed; an open one as of now.
  const { ds, result } = resultAsOf(base, erp.bps, erp, period.id, completedAt(erp, period.id), new Map(), true);
  const retro = new Map<string, PriorPeriodRetro>();
  for (const c of result.us) {
    const ls = c.pay.lines.filter((x) => x.code === "RETRO" && (x.explain.includes("recalculated after changes") || x.explain.startsWith("Retro time off")));
    if (ls.length) retro.set(c.worker.id, { amount: ls.reduce((s, l) => s + l.amount, 0), explain: ls.map((l) => l.explain).join("; ") });
  }
  return { period, ds, result, retro, priorId, priorCompleted: priorId ? !!completedAt(erp, priorId) : true };
}

export function approvedCount(bps: BusinessProcess[]): number {
  return bps.filter((b) => b.status === "Approved").length;
}
