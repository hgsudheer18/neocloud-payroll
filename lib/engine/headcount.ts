// Headcount reconciliation: workers on file → eligible → paid, with every
// delta named and the worker IDs behind it.

import type { Dataset, Worker } from "../data/types.ts";
import type { PayPeriod } from "../config/period.ts";
import type { UsWorkerCalc } from "./build.ts";
import { pretty } from "../util/dates.ts";

export interface HeadcountStep {
  label: string;
  count: number;
  sign: "=" | "+" | "−";
  workerIds: string[];
  explanation: string;
}

export function headcountRecon(ds: Dataset, period: PayPeriod, us: UsWorkerCalc[]): { steps: HeadcountStep[]; legacySteps: HeadcountStep[] } {
  const all = ds.workers;
  const contractors = all.filter((w) => w.workerType === "Contractor");
  const employees = all.filter((w) => w.workerType === "Employee");
  const intl = employees.filter((w) => w.payGroup !== period.payGroup);
  const usEmp = employees.filter((w) => w.payGroup === period.payGroup);
  const termedBefore = usEmp.filter((w) => w.terminationDate && w.terminationDate < period.start);
  const notStarted = usEmp.filter((w) => w.hireDate > period.end);
  const retroOnly = termedBefore.filter((w) => us.some((c) => c.worker.id === w.id));
  const eligible = [...usEmp.filter((w) => !termedBefore.includes(w) && !notStarted.includes(w)), ...retroOnly];
  const paid = us.filter((c) => c.pay.totals.gross > 0);
  const zeroPay = us.filter((c) => c.pay.totals.gross === 0 && eligible.some((e) => e.id === c.worker.id));
  const ids = (ws: Worker[]) => ws.map((w) => w.id);

  const activeStart = eligible.filter((w) => w.hireDate <= period.start && !retroOnly.includes(w));
  const hires = eligible.filter((w) => w.hireDate > period.start);
  const terms = eligible.filter((w) => w.terminationDate && w.terminationDate >= period.start && w.terminationDate <= period.end);
  const leave = us.filter((c) => c.input.timeline.some((d) => d.onLeave)).map((c) => c.worker);

  const steps: HeadcountStep[] = [
    { label: "Workers on file", count: all.length, sign: "=", workerIds: [], explanation: "All rows in the worker file." },
    { label: "Contingent workers (contractors)", count: contractors.length, sign: "−", workerIds: ids(contractors), explanation: "Not employees; paid through AP, never in a payroll pay group." },
    { label: "Other pay groups", count: intl.length, sign: "−", workerIds: ids(intl), explanation: `Not in ${period.payGroup}: international monthly pay groups (paid by in-country providers)${intl.some((w) => w.country === "USA") ? " and the other US pay group" : ""}.` },
    { label: "Terminated before period", count: termedBefore.length, sign: "−", workerIds: ids(termedBefore), explanation: "No earnings in this period." },
    { label: "Hire date after period end", count: notStarted.length, sign: "−", workerIds: ids(notStarted), explanation: "Future-dated hires; first paid next period." },
    ...(retroOnly.length ? [{ label: "Terminated, paid prior-period retro only", count: retroOnly.length, sign: "+" as const, workerIds: ids(retroOnly), explanation: "Changes to a completed period after they left; the difference is settled now." }] : []),
    { label: "US employees eligible this period", count: eligible.length, sign: "=", workerIds: [], explanation: `In the ${period.payGroup} pay group with at least one day employed.` },
    { label: "Zero-pay eligible workers", count: zeroPay.length, sign: "−", workerIds: zeroPay.map((c) => c.worker.id), explanation: "Eligible but no earnings (e.g. full-period unpaid leave). Must be explained individually." },
    { label: "US employees paid", count: paid.length, sign: "=", workerIds: [], explanation: "Workers with gross pay > 0 in the Workday result." },
  ];
  const detail: HeadcountStep[] = [
    { label: "Active at period start", count: activeStart.length, sign: "=", workerIds: [], explanation: `Employed on ${pretty(period.start)}.` },
    { label: "New hires in period", count: hires.length, sign: "+", workerIds: ids(hires), explanation: "Paid a prorated salary from the hire date." },
    { label: "Terminations in period", count: terms.length, sign: "−", workerIds: ids(terms), explanation: "Paid through the last day plus final payouts; not active at period end." },
    { label: "Active at period end", count: activeStart.length + hires.length - terms.length, sign: "=", workerIds: [], explanation: `Employed on ${pretty(period.end)} (includes ${leave.length} on unpaid leave: ${ids(leave).join(", ")}).` },
  ];
  return { steps, legacySteps: detail };
}
