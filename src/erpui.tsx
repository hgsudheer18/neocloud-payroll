import type { ReactNode } from "react";
import { BP_RULES, persona, type BPType, type BusinessProcess, type Role } from "../lib/erp/types.ts";
import type { Check } from "../lib/erp/validate.ts";
import { Pill } from "./ui.tsx";
import { useErp } from "./erp.tsx";

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

export function BpStatus({ bp }: { bp: BusinessProcess }) {
  const tone = bp.status === "Approved" ? "ok" : bp.status === "Denied" ? "bad" : "warn";
  return <Pill tone={tone}>{bp.status}</Pill>;
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
