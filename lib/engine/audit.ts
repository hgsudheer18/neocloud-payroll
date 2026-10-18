// Pre-payroll audit: deterministic checks a payroll analyst runs before
// approving the calculation. Each finding says WHY it fired, using the
// worker's own numbers, so it can be reviewed without opening the payslip.

import type { Dataset } from "../data/types.ts";
import type { UsWorkerCalc } from "./build.ts";
import { fmt } from "../util/money.ts";
import { pretty } from "../util/dates.ts";
import { asOf, FICA } from "../config/usTax.ts";
import type { PayPeriod } from "../config/period.ts";

export interface AuditFinding {
  check: string;
  severity: "Critical" | "Warning" | "Info";
  employeeId: string;
  message: string;
}

export function prepayrollAudit(ds: Dataset, us: UsWorkerCalc[], period: PayPeriod): AuditFinding[] {
  const out: AuditFinding[] = [];
  const fica = asOf(FICA, period.checkDate);
  for (const c of us) {
    const w = c.worker;
    const t = c.pay.totals;
    const ytd = ds.ytd.find((y) => y.employeeId === w.id);
    if (w.workerType !== "Employee") out.push({ check: "Worker type", severity: "Critical", employeeId: w.id, message: "Contingent worker in a payroll pay group." });
    if (t.net <= 0 && t.gross > 0) out.push({ check: "Net pay", severity: "Critical", employeeId: w.id, message: `Net pay ${fmt(t.net)} on gross ${fmt(t.gross)}.` });
    if (t.gross - t.preTax - t.eeTaxes - t.postTax !== t.net) out.push({ check: "Gross-to-net integrity", severity: "Critical", employeeId: w.id, message: "Gross − deductions − taxes ≠ net." });

    if (ytd && ytd.periods > 0 && t.gross > 0) {
      const avg = (ytd.gross * 100) / ytd.periods;
      const ratio = t.gross / avg;
      const unusual = c.pay.lines.filter((l) => ["PTO_PAYOUT", "RETRO", "OT", "DT", "MEAL", "BONUS"].includes(l.code)).map((l) => `${l.code} ${fmt(l.amount)}`);
      if (ratio > 1.5) out.push({ check: "Trailing-average spike", severity: "Warning", employeeId: w.id, message: `Gross ${fmt(t.gross)} is ${(ratio * 100).toFixed(0)}% of the ${ytd.periods}-period average ${fmt(Math.round(avg))}.${unusual.length ? ` Drivers: ${unusual.join(", ")}.` : ""}` });
      if (ratio < 0.6) {
        const why = [
          w.terminationDate && w.terminationDate <= period.end ? `terminated ${pretty(w.terminationDate)}` : "",
          c.input.timeline.some((d) => d.onLeave) ? `unpaid leave from ${pretty(c.input.timeline.find((d) => d.onLeave)!.date)}` : "",
          w.payType === "Hourly" ? `${c.time?.hoursWorkedInPeriod.toFixed(2)} hrs worked` : "",
        ].filter(Boolean);
        out.push({ check: "Trailing-average drop", severity: "Warning", employeeId: w.id, message: `Gross ${fmt(t.gross)} is ${(ratio * 100).toFixed(0)}% of the trailing average ${fmt(Math.round(avg))}${why.length ? ` (${why.join("; ")})` : " — no event explains it"}.` });
      }
    }
    if (!ytd && w.hireDate < "2026-01-01") out.push({ check: "Balance conversion", severity: "Critical", employeeId: w.id, message: "Employee hired before 2026 has no converted YTD balances; wage-base taxes will be wrong." });
    if (ytd && ytd.ssWages < fica.ssWageBase && ytd.ssWages + c.pay.taxable.fica / 100 > fica.ssWageBase) out.push({ check: "Wage base crossed", severity: "Info", employeeId: w.id, message: `Crosses the Social Security wage base this period: only ${fmt(c.pay.taxable.ssTaxable)} taxable.` });
    if (Object.keys(c.pay.taxable.byState).length > 1) out.push({ check: "Multi-state wages", severity: "Info", employeeId: w.id, message: `Wages sourced to ${Object.keys(c.pay.taxable.byState).join(" and ")}: confirm withholding registration in each state.` });
    for (const f of c.pay.flags) out.push({ check: "Payroll flag", severity: f.startsWith("Final pay") ? "Critical" : "Warning", employeeId: w.id, message: f });
    for (const a of c.absence) for (const f of a.flags) out.push({ check: `Absence: ${a.plan.name}`, severity: f.startsWith("Eligibility") || f.startsWith("Negative") ? "Warning" : "Info", employeeId: w.id, message: f });
    if (c.time) {
      for (const e of c.time.exceptions.filter((x) => x.severity !== "Info")) out.push({ check: `Time: ${e.code.replace(/_/g, " ").toLowerCase()}`, severity: e.code === "DUPLICATE_PUNCH" ? "Warning" : e.severity, employeeId: w.id, message: `${pretty(e.date)}: ${e.message} ${e.treatment}` });
      for (const wk of c.time.weeks) {
        const hrs = wk.current.hours.REG + wk.current.hours.OT + wk.current.hours.DT;
        if (hrs > 60) out.push({ check: "Excessive hours", severity: "Warning", employeeId: w.id, message: `${hrs.toFixed(2)} hrs in the workweek of ${pretty(wk.weekStart)} (in period). Confirm with the manager.` });
      }
    }
  }
  const order = { Critical: 0, Warning: 1, Info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity] || a.employeeId.localeCompare(b.employeeId));
}
