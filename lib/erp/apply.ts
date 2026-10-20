// Apply approved business processes on top of the base data package.
// Pure: returns a new Dataset, never mutates the input.

import type { AbsenceTaken, CostCenter, Company, Dataset, Location, TimeRow, Worker, WorkerEvent } from "../data/types.ts";
import type { BusinessProcess, JobProfile } from "./types.ts";
import type { ISODate } from "../util/dates.ts";

const PAY_GROUP: Record<string, string> = { USA: "US Semi-Monthly", GBR: "UK Monthly", CAN: "Canada Monthly", IND: "India Monthly" };
const CURRENCY: Record<string, string> = { USA: "USD", GBR: "GBP", CAN: "CAD", IND: "INR" };

export interface ApplyOptions {
  /** Only BPs decided at or before this ISO timestamp (bitemporal "as of"). */
  asOf?: string;
  /** Time rows approved at or before `at` are treated as entered on `asDate` (known when that period was paid). */
  knownBy?: { at: string; asDate: ISODate };
}

export const isApplied = (bp: BusinessProcess, asOf?: string) => bp.status === "Approved" && (!asOf || (bp.decidedAt ?? "") <= asOf);

export function applyBps(base: Dataset, bps: BusinessProcess[], opts: ApplyOptions = {}): Dataset {
  const ds: Dataset = {
    ...base,
    companies: [...base.companies],
    locations: [...base.locations],
    costCenters: [...base.costCenters],
    workers: base.workers.map((w) => ({ ...w })),
    events: [...base.events],
    time: [...base.time],
    absences: [...base.absences],
  };
  const ordered = [...bps].sort((a, b) => ((a.decidedAt ?? a.initiatedAt) < (b.decidedAt ?? b.initiatedAt) ? -1 : 1));
  for (const bp of ordered) {
    const p = bp.payload as Record<string, unknown>;
    const entered = (bp.decidedAt ?? bp.initiatedAt).slice(0, 10);
    // Pending time off is visible to payroll as "submitted" (excluded and flagged).
    if (bp.type === "Request Time Off" && bp.status === "Awaiting Approval") {
      for (const d of p.days as { date: string; quantity: number }[]) ds.absences.push({ employeeId: bp.subjectId, plan: p.plan as string, date: d.date, quantity: d.quantity, unit: p.unit as "hours" | "days", status: "Submitted", source: "erp" });
      continue;
    }
    if (!isApplied(bp, opts.asOf)) continue;
    const ev = (field: WorkerEvent["field"], event: WorkerEvent["event"], oldValue: unknown, newValue: unknown, reason = "") =>
      ds.events.push({ employeeId: bp.subjectId, event, effectiveDate: bp.effectiveDate, field, oldValue: String(oldValue ?? ""), newValue: String(newValue ?? ""), enteredOn: entered, reason: reason || bp.id, source: "erp" });

    switch (bp.type) {
      case "Hire": {
        const loc = ds.locations.find((l) => l.id === p.locationId);
        const cc = ds.costCenters.find((c) => c.id === p.costCenterId);
        if (!loc || !cc) break;
        const country = loc.country;
        const w: Worker = {
          id: bp.subjectId,
          name: String(p.name),
          workerType: "Employee",
          department: cc.department,
          supervisoryOrg: cc.supervisoryOrg,
          costCenterId: cc.id,
          locationId: loc.id,
          workState: String(p.workState || loc.state),
          country,
          companyId: loc.companyId,
          level: String(p.level ?? ""),
          jobProfile: String(p.jobProfile ?? ""),
          flsa: (p.flsa as Worker["flsa"]) ?? "Exempt",
          payType: (p.payType as Worker["payType"]) ?? "Salary",
          annualSalary: Number(p.annualSalary ?? 0),
          hourlyRate: Number(p.hourlyRate ?? 0),
          currency: CURRENCY[country] ?? "USD",
          payGroup: PAY_GROUP[country] ?? "",
          hireDate: bp.effectiveDate,
          terminationDate: "",
          managerId: String(p.managerId ?? ""),
          status: "New Hire",
          filingStatus: (p.filingStatus as Worker["filingStatus"]) ?? "Single",
          k401Pct: Number(p.k401Pct ?? 0),
          medicalPerPeriod: Number(p.medicalPerPeriod ?? 0),
          shift: (p.shift as Worker["shift"]) ?? "",
          enteredOn: entered,
          source: "erp",
        };
        ds.workers.push(w);
        break;
      }
      case "Change Compensation": {
        if (p.annualSalary !== undefined) ev("annualSalary", "Comp Change", p.oldAnnualSalary, p.annualSalary, String(p.reason ?? ""));
        if (p.hourlyRate !== undefined) ev("hourlyRate", "Comp Change", p.oldHourlyRate, p.hourlyRate, String(p.reason ?? ""));
        break;
      }
      case "Change Cost Center":
        ev("costCenterId", "Cost Center Change", p.oldCostCenterId, p.costCenterId, String(p.reason ?? ""));
        break;
      case "Change Location":
        ev("locationId", "Location Change", p.oldLocationId, p.locationId, String(p.reason ?? ""));
        ev("workState", "Location Change", p.oldWorkState, p.workState, String(p.reason ?? ""));
        break;
      case "Leave of Absence":
        ev("status", "Leave of Absence", "Active", "On Leave", String(p.reason ?? "Unpaid leave"));
        break;
      case "Return from Leave":
        ev("status", "Return from Leave", "On Leave", "Active", "Return from leave");
        break;
      case "Terminate": {
        const w = ds.workers.find((x) => x.id === bp.subjectId);
        if (!w) break;
        ev("status", "Termination", w.terminationDate, "Terminated", String(p.reason ?? ""));
        w.terminationDate = bp.effectiveDate;
        w.status = "Terminated";
        break;
      }
      case "Enter Time": {
        const known = opts.knownBy && (bp.decidedAt ?? "") <= opts.knownBy.at;
        for (const r of p.rows as Partial<TimeRow>[]) {
          ds.time.push({
            rowId: String(r.rowId),
            employeeId: bp.subjectId,
            workDate: String(r.workDate),
            timeIn: String(r.timeIn),
            timeOut: String(r.timeOut),
            mealStart: String(r.mealStart ?? ""),
            mealEnd: String(r.mealEnd ?? ""),
            shift: String(r.shift ?? "Day"),
            entryType: r.correctsRowId ? "Correction" : "Original",
            correctsRowId: String(r.correctsRowId ?? ""),
            enteredOn: known ? opts.knownBy!.asDate : entered,
            notes: String(r.notes ?? `Entered via ${bp.id}`),
            source: "erp",
            ...(r.deleted ? { deleted: true } : {}),
          });
        }
        break;
      }
      case "Request Time Off":
        for (const d of p.days as { date: string; quantity: number }[]) {
          const a: AbsenceTaken = { employeeId: bp.subjectId, plan: String(p.plan), date: d.date, quantity: d.quantity, unit: p.unit as "hours" | "days", status: "Approved", source: "erp" };
          ds.absences.push(a);
        }
        break;
      case "Change Tax Withholding": {
        // Federal filing status from the W-4, used by the next pay run calculated.
        const w = ds.workers.find((x) => x.id === bp.subjectId);
        if (w && (p.filingStatus === "Single" || p.filingStatus === "MFJ")) w.filingStatus = p.filingStatus;
        break;
      }
      case "Correct Time Off": {
        // Replace the approved time off for that day and plan; zero cancels it.
        const date = String(p.date);
        const plan = String(p.plan);
        ds.absences = ds.absences.filter((a) => !(a.employeeId === bp.subjectId && a.plan === plan && a.date === date && a.status === "Approved"));
        if (Number(p.quantity) > 0) ds.absences.push({ employeeId: bp.subjectId, plan, date, quantity: Number(p.quantity), unit: p.unit as "hours" | "days", status: "Approved", source: "erp" });
        break;
      }
      case "Create Company":
        ds.companies.push(p as unknown as Company);
        break;
      case "Create Location":
        ds.locations.push(p as unknown as Location);
        break;
      case "Create Cost Center":
        ds.costCenters.push(p as unknown as CostCenter);
        break;
      case "Create Job Profile":
        break;
    }
  }
  return ds;
}

/** Job profiles: those used in the data package plus any created in the app. */
export function jobProfiles(base: Dataset, bps: BusinessProcess[]): JobProfile[] {
  const seen = new Map<string, JobProfile>();
  for (const w of base.workers) {
    if (w.workerType !== "Employee" || seen.has(w.jobProfile)) continue;
    const family = w.jobProfile.replace(/\s+(IC\d|M\d|T\d)$/, "");
    seen.set(w.jobProfile, { id: `JP-${seen.size + 1}`, name: w.jobProfile, family, level: w.level, flsa: w.flsa, payType: w.payType });
  }
  for (const bp of bps) if (bp.type === "Create Job Profile" && bp.status === "Approved") seen.set(String(bp.payload.name), bp.payload as unknown as JobProfile);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function nextWorkerId(ds: Dataset, bps: BusinessProcess[]): string {
  const nums = [...ds.workers.map((w) => w.id), ...bps.filter((b) => b.type === "Hire").map((b) => b.subjectId)]
    .filter((id) => /^E\d{4}$/.test(id))
    .map((id) => Number(id.slice(1)));
  return `E${String(Math.max(399, ...nums) + 1).padStart(4, "0")}`;
}
