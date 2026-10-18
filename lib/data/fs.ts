// Server-only: read the CSV package from /data and run the period once per
// server instance (results are deterministic, so caching is safe).

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadDataset, type LoadIssue } from "./load.ts";
import { runPeriod, type PeriodResult } from "../engine/run.ts";
import type { Dataset } from "./types.ts";

export const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), "data");

let cache: { ds: Dataset; issues: LoadIssue[]; result: PeriodResult; files: string[] } | null = null;

export function readTexts(dir = DATA_DIR): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(dir)) if (f.endsWith(".csv")) out[f] = readFileSync(join(dir, f), "utf8");
  return out;
}

export function getRun() {
  if (cache) return cache;
  const texts = readTexts();
  const { ds, issues } = loadDataset(texts);
  cache = { ds, issues, result: runPeriod(ds), files: Object.keys(texts).sort() };
  return cache;
}
