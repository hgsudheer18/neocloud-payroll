// ERP layer: business processes (BPs), personas and pay runs.
//
// Every change a user makes is a business process with an initiator, an
// approver and timestamps. Approved BPs are applied on top of the CSV data
// package to produce the dataset the payroll engine calculates. Nothing is
// overwritten: the data at any moment is "base package + approved BPs up to
// that moment", which is also how a completed pay period stays reproducible.

import type { ISODate } from "../util/dates.ts";

export type Role = "Employee" | "Manager" | "HR Partner" | "Payroll Specialist" | "Payroll Approver";

export interface Persona {
  id: string;
  name: string;
  role: Role;
  title: string;
  /** Worker record for self-service (Employee) or team (Manager). */
  workerId?: string;
}

export const PERSONAS: Persona[] = [
  { id: "emp", name: "Emma Kim", role: "Employee", title: "Data Center Technician, San Jose (E0021)", workerId: "E0021" },
  { id: "mgr", name: "Ethan Fischer", role: "Manager", title: "VP, On-Prem (E0005)", workerId: "E0005" },
  { id: "hr", name: "Jordan Reyes", role: "HR Partner", title: "HR Partner" },
  { id: "ps", name: "Sam Ortiz", role: "Payroll Specialist", title: "Payroll Specialist and Time Administrator" },
  { id: "pa", name: "Priya Nair", role: "Payroll Approver", title: "Payroll Manager (approver)" },
];

export type BPType =
  | "Hire"
  | "Change Compensation"
  | "Change Cost Center"
  | "Change Location"
  | "Leave of Absence"
  | "Return from Leave"
  | "Terminate"
  | "Enter Time"
  | "Request Time Off"
  | "Create Company"
  | "Create Location"
  | "Create Cost Center"
  | "Create Job Profile";

export type BPStatus = "Awaiting Approval" | "Approved" | "Denied";

export interface BusinessProcess {
  id: string; // BP-000001
  type: BPType;
  subjectId: string; // worker id or object id
  subjectName: string;
  summary: string;
  effectiveDate: ISODate;
  payload: Record<string, unknown>;
  status: BPStatus;
  initiatedBy: string; // persona id
  initiatedAt: string; // ISO timestamp
  decidedBy?: string;
  decidedAt?: string;
  comment?: string;
  warnings?: string[];
}

export interface JobProfile {
  id: string;
  name: string;
  family: string;
  level: string;
  flsa: "Exempt" | "Non-Exempt" | "N/A";
  payType: "Salary" | "Hourly";
}

export type PayRunStatus = "Not started" | "Calculated" | "Approved" | "Completed";

export interface PayRun {
  periodId: string;
  status: PayRunStatus;
  calculatedBy?: string;
  calculatedAt?: string;
  /** Number of approved BPs when calculated: if it changes, results are stale. */
  bpCountAtCalc?: number;
  approvedBy?: string;
  approvedAt?: string;
  acknowledged?: string;
  completedBy?: string;
  completedAt?: string;
  totals?: { gross: number; net: number; burdened: number; workers: number };
}

export interface ErpState {
  version: 1;
  bps: BusinessProcess[];
  payRuns: Record<string, PayRun>;
  jobProfiles: JobProfile[];
  seq: number;
}

/** Who may initiate and approve each process. Approver must always differ from the initiator. */
export const BP_RULES: Record<BPType, { initiators: Role[]; approvers: Role[] | "auto"; label: string }> = {
  Hire: { initiators: ["HR Partner", "Manager"], approvers: ["HR Partner", "Manager"], label: "Staffing" },
  "Change Compensation": { initiators: ["HR Partner", "Manager"], approvers: ["HR Partner", "Manager"], label: "Compensation" },
  "Change Cost Center": { initiators: ["HR Partner", "Manager"], approvers: ["HR Partner", "Manager"], label: "Staffing" },
  "Change Location": { initiators: ["HR Partner", "Manager"], approvers: ["HR Partner", "Manager"], label: "Staffing" },
  "Leave of Absence": { initiators: ["HR Partner", "Manager", "Employee"], approvers: ["HR Partner"], label: "Leave" },
  "Return from Leave": { initiators: ["HR Partner", "Manager"], approvers: ["HR Partner", "Manager"], label: "Leave" },
  Terminate: { initiators: ["HR Partner", "Manager"], approvers: ["HR Partner", "Manager"], label: "Staffing" },
  "Enter Time": { initiators: ["Employee", "Payroll Specialist", "Manager"], approvers: ["Manager"], label: "Time" },
  "Request Time Off": { initiators: ["Employee", "Manager", "HR Partner"], approvers: ["Manager"], label: "Absence" },
  "Create Company": { initiators: ["HR Partner"], approvers: "auto", label: "Setup" },
  "Create Location": { initiators: ["HR Partner"], approvers: "auto", label: "Setup" },
  "Create Cost Center": { initiators: ["HR Partner", "Payroll Specialist"], approvers: "auto", label: "Setup" },
  "Create Job Profile": { initiators: ["HR Partner"], approvers: "auto", label: "Setup" },
};

export const PAYRUN_RULES = {
  calculate: ["Payroll Specialist"] as Role[],
  approve: ["Payroll Approver"] as Role[],
  complete: ["Payroll Specialist", "Payroll Approver"] as Role[],
  reopen: ["Payroll Approver"] as Role[],
};

export const persona = (id: string) => PERSONAS.find((p) => p.id === id) ?? PERSONAS[0];
