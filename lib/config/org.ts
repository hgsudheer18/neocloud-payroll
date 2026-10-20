// Organisation structure: who reports to whom, the organisations they form,
// and open (vacant) positions. Applied over the data package's manager IDs.
//
//   NeoCloud (CEO, E0000)
//   ├─ Finance (CFO, E0010): G&A
//   │   └─ People Technology (Head of People Technology: open position)
//   ├─ CIO Organisation (Chief Information Officer: open position)
//   │   ├─ Engineering, USA (VP Engineering, E0007)
//   │   └─ GPU Cloud, USA (VP GPU Cloud, E0002)
//   ├─ International (Head of International: open position)
//   │   Engineering in Canada and India, GPU Cloud in the UK
//   └─ On-Prem (VP On-Prem, E0005)

import type { Worker } from "../data/types.ts";

export interface OpenPosition {
  id: string;
  title: string;
  managerId: string;
}

export const OPEN_POSITIONS: OpenPosition[] = [
  { id: "P-CIO", title: "Chief Information Officer", managerId: "E0000" },
  { id: "P-INTL", title: "Head of International", managerId: "E0000" },
  { id: "P-PTECH", title: "Head of People Technology", managerId: "E0010" },
];

/** Organisations, keyed by the worker or open position that leads them. */
export const ORGS: Record<string, string> = {
  E0000: "NeoCloud",
  E0010: "Finance",
  "P-PTECH": "People Technology",
  "P-CIO": "CIO Organisation",
  E0007: "Engineering, USA",
  E0002: "GPU Cloud, USA",
  "P-INTL": "International",
  E0005: "On-Prem",
};

const CIO_FUNCTIONS = ["Engineering", "GPU Cloud"];

/** New manager for a worker under this structure, or undefined to keep the data package's. */
function newManager(w: Worker, byId: Map<string, Worker>): string | undefined {
  if (w.id === "E0007" || w.id === "E0002") return "P-CIO";
  if (w.id === "E0001") return "E0002"; // GPU Cloud M5, previously reporting to the CEO
  const mgr = byId.get(w.managerId);
  if (CIO_FUNCTIONS.includes(w.department) && w.country !== "USA" && mgr && mgr.country === "USA") return "P-INTL";
  return undefined;
}

/** Workers with managers set by the organisation structure. Pay is unaffected. */
export function applyOrgStructure(workers: Worker[]): Worker[] {
  const byId = new Map(workers.map((w) => [w.id, w]));
  return workers.map((w) => {
    const m = newManager(w, byId);
    return m ? { ...w, managerId: m } : w;
  });
}

export interface OrgNode {
  id: string;
  name: string;
  title: string;
  vacant: boolean;
  managerId: string;
}

/** Everyone and every open position as nodes of one reporting tree. */
export function orgNodes(workers: Worker[]): Map<string, OrgNode> {
  const nodes = new Map<string, OrgNode>();
  for (const w of workers) {
    if (w.workerType !== "Employee" || w.terminationDate) continue;
    nodes.set(w.id, { id: w.id, name: w.name, title: w.jobProfile, vacant: false, managerId: w.managerId });
  }
  for (const p of OPEN_POSITIONS) nodes.set(p.id, { id: p.id, name: "Open position", title: p.title, vacant: true, managerId: p.managerId });
  return nodes;
}

/** Management chain from the CEO down to this worker or position. */
export function chainTo(nodes: Map<string, OrgNode>, id: string): OrgNode[] {
  const out: OrgNode[] = [];
  const seen = new Set<string>();
  for (let n = nodes.get(id); n && !seen.has(n.id); n = nodes.get(n.managerId)) {
    seen.add(n.id);
    out.unshift(n);
  }
  return out;
}

/** Organisations from the top down to this worker, e.g. NeoCloud › CIO Organisation › Engineering, USA. */
export function orgPath(nodes: Map<string, OrgNode>, id: string): string[] {
  return chainTo(nodes, id).filter((n) => ORGS[n.id]).map((n) => ORGS[n.id]);
}

export function directReports(nodes: Map<string, OrgNode>, id: string): OrgNode[] {
  return [...nodes.values()].filter((n) => n.managerId === id).sort((a, b) => Number(b.vacant) - Number(a.vacant) || a.name.localeCompare(b.name));
}

/** Everyone under a worker or position, at any depth. */
export function headcountUnder(nodes: Map<string, OrgNode>, id: string): number {
  let n = 0;
  for (const r of directReports(nodes, id)) n += (r.vacant ? 0 : 1) + headcountUnder(nodes, r.id);
  return n;
}
