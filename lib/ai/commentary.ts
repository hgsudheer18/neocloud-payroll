// Controller variance commentary.
//
// Guardrails (the order matters):
//   1. Minimise: the model receives an aggregated, de-identified payload built
//      here: no names, no employee IDs, no individual pay. Cause-level totals only.
//   2. Ground: the model writes prose only; every number comes from the engine.
//      After generation, every currency amount and count in the text is checked
//      against the payload; anything not found blocks the draft.
//   3. Review: output is labelled a draft for the Controller to edit; it is
//      never written back into payroll data or used to change a calculation.
// The deterministic template below produces the same commentary with no LLM,
// and is the fallback whenever the API is not configured or the check fails.

import type { PeriodResult } from "../engine/run.ts";
import { fmt } from "../util/money.ts";

export interface CommentaryPayload {
  period: string;
  checkDate: string;
  workersPaid: number;
  legacyRows: number;
  totals: { gross: string; net: string; employerTaxes: string; burdened: string; legacyGross: string; legacyNet: string; grossDifference: string; netDifference: string };
  controlTotalsTie: boolean;
  causes: { cause: string; classification: string; correctSystem: string; employees: number; grossImpact: string; netImpact: string; employerTaxImpact: string }[];
  unexplained: number;
  international: { timingDifferences: number; unexplained: number };
}

export function buildPayload(r: PeriodResult): CommentaryPayload {
  const t = r.recon.totals;
  return {
    period: `${r.period.start} to ${r.period.end}`,
    checkDate: r.period.checkDate,
    workersPaid: r.us.length,
    legacyRows: r.recon.employees.filter((e) => e.legacy).length,
    totals: {
      gross: fmt(r.totals.gross),
      net: fmt(r.totals.net),
      employerTaxes: fmt(r.totals.erTaxes),
      burdened: fmt(r.totals.burdened),
      legacyGross: fmt(t.legacy.gross),
      legacyNet: fmt(t.legacy.net),
      grossDifference: fmt(t.legacy.gross - t.workday.gross),
      netDifference: fmt(t.legacy.net - t.workday.net),
    },
    controlTotalsTie: r.ties.every((x) => x.ok),
    causes: r.recon.byCause.map((c) => ({
      cause: c.label,
      classification: c.category,
      correctSystem: c.correct,
      employees: c.employees.length,
      grossImpact: fmt(c.grossImpact),
      netImpact: fmt(c.netImpact),
      employerTaxImpact: fmt(c.erTaxImpact),
    })),
    unexplained: r.recon.counts.Unexplained,
    international: {
      timingDifferences: r.providerVariances.filter((v) => v.category === "Timing").length,
      unexplained: r.providerVariances.filter((v) => v.category === "Unexplained").length,
    },
  };
}

export function templateCommentary(p: CommentaryPayload): string {
  const byImpact = [...p.causes].sort((a, b) => Math.abs(parse(b.grossImpact)) - Math.abs(parse(a.grossImpact)));
  const legacyErrors = p.causes.filter((c) => c.classification === "Legacy error");
  const config = p.causes.filter((c) => c.classification === "Configuration difference");
  const lines = [
    `Payroll for ${p.period} (check date ${p.checkDate}): Workday calculated ${p.workersPaid} workers, gross ${p.totals.gross} and net ${p.totals.net}. The legacy register has ${p.legacyRows} rows, gross ${p.totals.legacyGross}, so legacy is ${p.totals.grossDifference} higher on gross and ${p.totals.netDifference} on net.`,
    p.controlTotalsTie ? "All control totals tie: gross to net, register to journal, time to pay and headcount." : "Not all control totals tie; resolve before approval.",
    `${p.causes.length} root causes explain every variance; ${p.unexplained} remain unexplained.`,
    "",
    "Largest drivers by gross impact (legacy minus Workday):",
    ...byImpact.slice(0, 5).map((c) => `- ${c.cause} (${c.classification.toLowerCase()}, ${c.employees} employee${c.employees === 1 ? "" : "s"}): gross ${c.grossImpact}, net ${c.netImpact}. Correct system: ${c.correctSystem}.`),
    "",
    legacyErrors.length ? `Legacy errors to correct before cutover: ${legacyErrors.map((c) => c.cause).join("; ")}.` : "No legacy errors.",
    config.length ? `Configuration differences to sign off: ${config.map((c) => `${c.cause} (correct: ${c.correctSystem})`).join("; ")}.` : "",
    `International: ${p.international.timingDifferences} timing difference(s) and ${p.international.unexplained} unexplained provider variance(s).`,
  ];
  return lines.filter((l) => l !== null).join("\n");
}

const parse = (s: string) => Number(s.replace(/[^0-9.-]/g, ""));

/** Every $ amount in the text must appear in the payload (formatted identically). */
export function groundingCheck(text: string, p: CommentaryPayload): { ok: boolean; ungrounded: string[] } {
  const known = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string") for (const m of v.match(/-?\$[\d,]+\.\d{2}/g) ?? []) known.add(m);
    else if (typeof v === "number") known.add(String(v));
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(p);
  const found = text.match(/-?\$[\d,]+(?:\.\d{2})?/g) ?? [];
  const ungrounded = found.filter((m) => !known.has(m) && !known.has(m.endsWith(".00") ? m : `${m}.00`));
  const ids = text.match(/\b[EC]\d{4}\b/g) ?? [];
  return { ok: ungrounded.length === 0 && ids.length === 0, ungrounded: [...ungrounded, ...ids] };
}

export const SYSTEM_PROMPT = `You write payroll variance commentary for a Controller reviewing a parallel run.
Use ONLY the numbers in the JSON you are given, copied exactly as formatted. Never calculate new numbers, never estimate, never round.
Do not mention individuals. Plain English, at most 180 words, no headings, short paragraphs.
Cover: whether the period ties, the total legacy-minus-Workday difference, the biggest root causes and which system is correct, what must be fixed before cutover, and international timing items.`;
