// Role-based visibility, modelled on Workday security groups.
//
//   Directory      Employee: themselves. Manager: their reporting line.
//                  HR Partner and payroll: everyone.
//   Profiles       Anyone may open a profile, but outside your directory you
//                  see only name, job and org details.
//   Worker details Compensation, time and time off: the worker, their
//                  managers (direct and indirect) and payroll only.
//   Time entry     Hourly workers only (their own time).
//   Pay results    Payslips, gross to net, pay amounts and payouts: payroll only,
//                  except that every role sees its own payslip (My payslip).
//
// The persona switcher has no password, so this shapes each role's view for
// the demo; in production, Workday's own security does this job.

import { useMemo } from "react";
import { useData } from "./state.tsx";
import { useErp } from "./erp.tsx";
import type { Dataset } from "../lib/data/types.ts";
import type { BPType, BusinessProcess, Persona, Role } from "../lib/erp/types.ts";

const PAYROLL: Role[] = ["Payroll Specialist", "Payroll Approver"];

/** Page (first path segment) → roles that may open it. "" is the period overview. */
const PAGES: Record<string, Role[]> = {
  inbox: ["Employee", "Manager", "HR Partner", ...PAYROLL],
  workers: ["Employee", "Manager", "HR Partner", ...PAYROLL],
  "time-off": ["Employee", "Manager", "HR Partner", ...PAYROLL],
  payslip: ["Employee", "Manager", "HR Partner", ...PAYROLL],
  "team-time-off": ["Manager"],
  "upcoming-time-off": ["Manager"],
  setup: ["HR Partner", ...PAYROLL],
  time: ["Manager", ...PAYROLL],
  absence: ["Manager", ...PAYROLL],
};

export const canOpenPage = (role: Role, page: string) => (PAGES[page] ?? PAYROLL).includes(role);

/** Business processes that carry a worker's compensation, time or time off. */
const DETAIL_BPS: BPType[] = ["Change Compensation", "Enter Time", "Request Time Off"];

/** Worker ids in a manager's reporting line, direct and indirect, including the manager. */
export function reportingLine(ds: Dataset, managerId: string): Set<string> {
  const ids = new Set([managerId]);
  let added = true;
  while (added) {
    added = false;
    for (const w of ds.workers) {
      if (w.managerId && ids.has(w.managerId) && !ids.has(w.id)) {
        ids.add(w.id);
        added = true;
      }
    }
  }
  return ids;
}

export interface Access {
  /** True when the directory holds every worker (HR Partner and payroll). */
  all: boolean;
  /** True for payroll roles: payslips, gross to net, pay amounts and payouts. */
  payResults: boolean;
  canOpen: (page: string) => boolean;
  /** In your directory: listed, and opens as a full profile. */
  seesWorker: (id: string) => boolean;
  /** Compensation, time and time off for this worker. */
  seesDetails: (id: string) => boolean;
  seesBp: (bp: BusinessProcess) => boolean;
}

export function accessFor(me: Persona, ds: Dataset): Access {
  const payroll = PAYROLL.includes(me.role);
  const all = payroll || me.role === "HR Partner";
  const line = me.role === "Manager" && me.workerId ? reportingLine(ds, me.workerId) : new Set(me.workerId ? [me.workerId] : []);
  const seesWorker = (id: string) => all || line.has(id);
  const seesDetails = (id: string) => payroll || line.has(id);
  // Time entry is for hourly workers only, whatever their role.
  const hourly = ds.workers.find((w) => w.id === me.workerId)?.payType === "Hourly";
  return {
    all,
    payResults: payroll,
    canOpen: (page) => (page === "time-entry" ? hourly : canOpenPage(me.role, page)),
    seesWorker,
    seesDetails,
    seesBp: (bp) => {
      if (bp.initiatedBy === me.id) return true;
      const subject = bp.type === "Hire" ? String(bp.payload.managerId ?? "") : bp.subjectId;
      if (DETAIL_BPS.includes(bp.type) || bp.type === "Hire") return payroll || (all ? bp.type === "Hire" : false) || line.has(subject);
      return all || line.has(subject);
    },
  };
}

export function useAccess(): Access {
  const { data } = useData();
  const { me } = useErp();
  const ds = data?.dsNow;
  return useMemo(() => accessFor(me, ds ?? ({ workers: [] } as unknown as Dataset)), [me, ds]);
}

export function NoAccess({ what = "this page" }: { what?: string }) {
  const { me } = useErp();
  return (
    <div className="callout bad">
      You don't have access to {what} as {me.name} ({me.role}). Switch role at the top of the sidebar, or go to your <a href="#/inbox">inbox</a>.
    </div>
  );
}
