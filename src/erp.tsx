// ERP state: business processes, pay runs, the signed-in persona and the
// selected pay period. Saved in this browser (localStorage), so every visitor
// gets a private sandbox; "Reset demo data" returns to the original package.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { BP_RULES, PERSONAS, persona as personaById, type BPType, type BusinessProcess, type ErpState, type PayRun, type Persona } from "../lib/erp/types.ts";
import { US_PERIOD } from "../lib/config/period.ts";

const KEY = "neocloud-erp-v1";
const PREFS = "neocloud-erp-prefs-v1";

const empty = (): ErpState => ({ version: 1, bps: [], payRuns: {}, jobProfiles: [], seq: 0 });

function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: state lives for this tab only */
  }
}

export interface SubmitInput {
  type: BPType;
  subjectId: string;
  subjectName: string;
  summary: string;
  effectiveDate: string;
  payload: Record<string, unknown>;
  warnings?: string[];
  /** The initiator is also the approver (a manager editing their team's time): approved on entry, with this note. */
  approvedAs?: string;
}

interface Ctx {
  erp: ErpState;
  me: Persona;
  periodId: string;
  setPersona: (id: string) => void;
  setPeriod: (id: string) => void;
  submit: (i: SubmitInput) => BusinessProcess;
  decide: (id: string, approve: boolean, comment?: string) => string | null;
  updatePayRun: (periodId: string, patch: Partial<PayRun>) => void;
  setDrafts: (workerId: string, rows: Record<string, unknown>[]) => void;
  markSeen: (ids: string[]) => void;
  nextSeq: () => number;
  reset: () => void;
  importState: (s: ErpState) => string | null;
}

const ErpContext = createContext<Ctx>(null as unknown as Ctx);

export function ErpProvider({ children }: { children: ReactNode }) {
  const [erp, setErp] = useState<ErpState>(() => load(KEY, empty()));
  const [prefs, setPrefs] = useState<{ persona: string; period: string }>(() => load(PREFS, { persona: "hr", period: US_PERIOD.id }));
  useEffect(() => save(KEY, erp), [erp]);
  useEffect(() => save(PREFS, prefs), [prefs]);
  const me = personaById(prefs.persona);

  // Monotonic sequence for BP and row ids, safe across several submits in one event.
  const seqRef = useRef(erp.seq);
  const nextSeq = useCallback(() => {
    seqRef.current += 1;
    const n = seqRef.current;
    setErp((s) => ({ ...s, seq: Math.max(s.seq, n) }));
    return n;
  }, []);

  const submit = useCallback(
    (i: SubmitInput): BusinessProcess => {
      const now = new Date().toISOString();
      const auto = BP_RULES[i.type].approvers === "auto";
      const seq = nextSeq();
      const created: BusinessProcess = {
        id: `BP-${String(seq).padStart(5, "0")}`,
        ...i,
        status: auto || i.approvedAs ? "Approved" : "Awaiting Approval",
        initiatedBy: me.id,
        initiatedAt: now,
        decidedBy: auto ? "system" : i.approvedAs ? me.id : undefined,
        decidedAt: auto || i.approvedAs ? now : undefined,
        comment: auto ? "Configuration change: no approval step; captured in the change log" : i.approvedAs,
      };
      setErp((s) => ({ ...s, bps: [...s.bps, created] }));
      return created;
    },
    [me.id, nextSeq],
  );

  const decide = useCallback(
    (id: string, approve: boolean, comment?: string): string | null => {
      const bp = erp.bps.find((b) => b.id === id);
      if (!bp || bp.status !== "Awaiting Approval") return "This business process is no longer awaiting approval.";
      const rule = BP_RULES[bp.type];
      // Segregation of duties, except the demo Administrator, whose own approvals are recorded as an override.
      const override = bp.initiatedBy === me.id && me.role === "Administrator";
      if (bp.initiatedBy === me.id && !override) return "Segregation of duties: you initiated this, so someone else must approve it.";
      if (rule.approvers !== "auto" && !rule.approvers.includes(me.role)) return `Only ${rule.approvers.join(" or ")} can approve ${bp.type}.`;
      const now = new Date().toISOString();
      setErp((s) => ({ ...s, bps: s.bps.map((b) => (b.id === id ? { ...b, status: approve ? "Approved" : "Denied", decidedBy: me.id, decidedAt: now, comment: override ? `Administrator override (demo): approved by the person who started it${comment ? `. ${comment}` : ""}` : comment } : b)) }));
      return null;
    },
    [erp.bps, me],
  );

  const updatePayRun = useCallback((periodId: string, patch: Partial<PayRun>) => {
    setErp((s) => ({ ...s, payRuns: { ...s.payRuns, [periodId]: { ...(s.payRuns[periodId] ?? { periodId, status: "Not started" }), ...patch } } }));
  }, []);

  const setDrafts = useCallback((workerId: string, rows: Record<string, unknown>[]) => {
    setErp((s) => ({ ...s, drafts: { ...(s.drafts ?? {}), [workerId]: rows } }));
  }, []);

  const markSeen = useCallback(
    (ids: string[]) => setErp((s) => ({ ...s, seen: { ...(s.seen ?? {}), [prefs.persona]: [...new Set([...(s.seen?.[prefs.persona] ?? []), ...ids])] } })),
    [prefs.persona],
  );

  const reset = useCallback(() => {
    seqRef.current = 0;
    setErp(empty());
    setPrefs((p) => ({ ...p, period: US_PERIOD.id }));
  }, []);

  const importState = useCallback((s: ErpState): string | null => {
    if (!s || s.version !== 1 || !Array.isArray(s.bps) || typeof s.payRuns !== "object") return "This file is not NeoCloud demo data.";
    seqRef.current = Math.max(s.seq ?? 0, s.bps.length);
    setErp({ ...empty(), ...s });
    return null;
  }, []);

  return (
    <ErpContext.Provider
      value={{
        erp,
        me,
        periodId: prefs.period,
        setPersona: (id) => setPrefs((p) => ({ ...p, persona: id })),
        setPeriod: (id) => setPrefs((p) => ({ ...p, period: id })),
        submit,
        decide,
        updatePayRun,
        setDrafts,
        markSeen,
        nextSeq,
        reset,
        importState,
      }}
    >
      {children}
    </ErpContext.Provider>
  );
}

export const useErp = () => useContext(ErpContext);
export { PERSONAS };
