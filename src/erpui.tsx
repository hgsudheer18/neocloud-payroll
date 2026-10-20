import type { ReactNode } from "react";
import { BP_RULES, persona, type BPType, type BusinessProcess, type Role } from "../lib/erp/types.ts";
import type { Check } from "../lib/erp/validate.ts";
import { Pill } from "./ui.tsx";
import { useErp } from "./erp.tsx";
import { useData } from "./state.tsx";
import { approverFor } from "./access.tsx";

export function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function FormGrid({ children }: { children: ReactNode }) {
  return <div className="form-grid">{children}</div>;
}

export function Checks({ check }: { check: Check | null }) {
  if (!check || (!check.errors.length && !check.warnings.length)) return null;
  return (
    <div className="checks">
      {check.errors.map((e) => <div key={e} className="callout bad">{e}</div>)}
      {check.warnings.map((w) => <div key={w} className="callout">{w}</div>)}
    </div>
  );
}

/** Sign in as the approver of a waiting process and open it in their inbox (demo: no separate login). */
export function useGoToApprover() {
  const { data } = useData();
  const { me, setPersona } = useErp();
  return (bp: BusinessProcess) => {
    const p = data ? approverFor(bp, data.dsNow) : undefined;
    if (!p || p.id === me.id) return undefined;
    return { approver: p, go: () => { setPersona(p.id); window.location.hash = `/inbox?bp=${bp.id}`; } };
  };
}

export function BpStatus({ bp }: { bp: BusinessProcess }) {
  const tone = bp.status === "Approved" ? "ok" : bp.status === "Denied" ? "bad" : "warn";
  const jump = useGoToApprover()(bp);
  if (!jump) return <Pill tone={tone}>{bp.status}</Pill>;
  return (
    <button className="pill-link" title={`Sign in as ${jump.approver.name} (${jump.approver.role}) and open this in their inbox`} onClick={jump.go}>
      <Pill tone={tone}>{bp.status}</Pill> <span className="small">with {jump.approver.name} →</span>
    </button>
  );
}

/** After submitting: a button that signs in as the approver and opens the item. */
export function ApproverJump({ bp }: { bp?: BusinessProcess }) {
  const toApprover = useGoToApprover();
  const jump = bp ? toApprover(bp) : undefined;
  if (!jump) return null;
  return <button className="btn ghost" style={{ marginTop: 8 }} onClick={jump.go}>Sign in as {jump.approver.name} ({jump.approver.role}) to approve →</button>;
}

export const who = (id?: string) => (id === "system" ? "System (configuration)" : id ? `${persona(id).name}, ${persona(id).role}` : "");

/** Shows the form only when the current persona may initiate the process; otherwise says who can. */
export function CanInitiate({ type, children }: { type: BPType; children: ReactNode }) {
  const { me } = useErp();
  const allowed = BP_RULES[type].initiators;
  if (allowed.includes(me.role)) return <>{children}</>;
  return <RoleNote roles={allowed} action={`start ${type}`} />;
}

export function RoleNote({ roles, action }: { roles: Role[]; action: string }) {
  return (
    <div className="callout info">
      Signed in as a different role. Only {roles.join(" or ")} can {action}. Switch role at the top of the sidebar.
    </div>
  );
}

export const today = () => new Date().toISOString().slice(0, 10);

export function Toast({ text, tone = "ok" }: { text: string; tone?: "ok" | "bad" | "info" }) {
  if (!text) return null;
  return <div className={`callout ${tone}`} role="status">{text}</div>;
}
