// Open positions (job requisitions) to hire into from Oct 19, 2026. Hiring into one
// pre-fills the Hire business process; the position is filled once the hire is
// approved. Hourly positions are paid biweekly, salaried positions semi-monthly.

import type { BusinessProcess } from "../erp/types.ts";

export interface Requisition {
  id: string;
  title: string;
  jobProfile: string;
  payType: "Hourly" | "Salary";
  costCenterId: string;
  locationId: string;
  managerId: string;
  /** Hourly rate or annual salary, USD. */
  pay: number;
  shift: "Day" | "Night" | "";
  /** Earliest start date. */
  startFrom: string;
  medicalPerPeriod: number;
  k401Pct: number;
}

export const REQUISITIONS: Requisition[] = [
  { id: "REQ-H1", title: "Data Center Technician, day shift", jobProfile: "Data Center Technician", payType: "Hourly", costCenterId: "CC2100", locationId: "SJ", managerId: "E0005", pay: 40, shift: "Day", startFrom: "2026-10-19", medicalPerPeriod: 145, k401Pct: 0.04 },
  { id: "REQ-H2", title: "Data Center Technician, night shift", jobProfile: "Data Center Technician", payType: "Hourly", costCenterId: "CC2100", locationId: "SJ", managerId: "E0005", pay: 41.5, shift: "Night", startFrom: "2026-10-21", medicalPerPeriod: 145, k401Pct: 0.03 },
  { id: "REQ-H3", title: "Data Center Technician, day shift (Austin)", jobProfile: "Data Center Technician", payType: "Hourly", costCenterId: "CC2100", locationId: "AUS", managerId: "E0005", pay: 36, shift: "Day", startFrom: "2026-10-26", medicalPerPeriod: 120, k401Pct: 0.05 },
  { id: "REQ-H4", title: "Data Center Technician, night shift (Austin)", jobProfile: "Data Center Technician", payType: "Hourly", costCenterId: "CC2100", locationId: "AUS", managerId: "E0005", pay: 37.5, shift: "Night", startFrom: "2026-11-04", medicalPerPeriod: 120, k401Pct: 0 },
  { id: "REQ-S1", title: "Software Engineer IC3, Platform", jobProfile: "Software Engineer IC3", payType: "Salary", costCenterId: "CC3100", locationId: "SF", managerId: "E0007", pay: 165000, shift: "", startFrom: "2026-10-19", medicalPerPeriod: 145, k401Pct: 0.06 },
  { id: "REQ-S2", title: "Cloud Solutions IC3, GPU Cloud", jobProfile: "Cloud Solutions IC3", payType: "Salary", costCenterId: "CC1100", locationId: "SF", managerId: "E0002", pay: 150000, shift: "", startFrom: "2026-10-21", medicalPerPeriod: 145, k401Pct: 0.05 },
  { id: "REQ-S3", title: "Software Engineer IC4, Infrastructure", jobProfile: "Software Engineer IC4", payType: "Salary", costCenterId: "CC3200", locationId: "SF", managerId: "E0007", pay: 190000, shift: "", startFrom: "2026-10-26", medicalPerPeriod: 145, k401Pct: 0.08 },
  { id: "REQ-S4", title: "Business Operations IC2, Finance", jobProfile: "Business Operations IC2", payType: "Salary", costCenterId: "CC4100", locationId: "SF", managerId: "E0010", pay: 120000, shift: "", startFrom: "2026-10-28", medicalPerPeriod: 145, k401Pct: 0.05 },
];

/** Open, hire pending, or filled (with the worker), from the Hire processes that reference it. */
export function requisitionStatus(req: Requisition, bps: BusinessProcess[]): { status: "Open" | "Hire pending" | "Filled"; workerId?: string; name?: string; bp?: BusinessProcess } {
  const b = [...bps].reverse().find((x) => x.type === "Hire" && x.payload.positionId === req.id && x.status !== "Denied");
  if (!b) return { status: "Open" };
  return { status: b.status === "Approved" ? "Filled" : "Hire pending", workerId: b.subjectId, name: b.subjectName, bp: b };
}
