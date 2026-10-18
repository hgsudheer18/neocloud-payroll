// Loads the CSV package, runs the period once, and shares the result.
// The calculation runs in the browser: uploaded payroll files never leave
// the user's machine.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { loadDataset, type LoadIssue } from "../lib/data/load.ts";
import { runPeriod, type PeriodResult } from "../lib/engine/run.ts";
import type { Dataset } from "../lib/data/types.ts";

export interface AppData {
  ds: Dataset;
  issues: LoadIssue[];
  result: PeriodResult;
  texts: Record<string, string>;
  source: "bundled" | "uploaded";
  ms: number;
}

interface Ctx {
  data: AppData | null;
  error: string | null;
  replaceFiles: (files: Record<string, string>) => void;
  reset: () => void;
}

const DataContext = createContext<Ctx>({ data: null, error: null, replaceFiles: () => {}, reset: () => {} });

async function fetchBundled(): Promise<Record<string, string>> {
  const manifest: string[] = await (await fetch("data/manifest.json")).json();
  const entries = await Promise.all(manifest.map(async (f) => [f, await (await fetch(`data/${f}`)).text()] as const));
  return Object.fromEntries(entries);
}

function compute(texts: Record<string, string>, source: AppData["source"]): AppData {
  const t0 = performance.now();
  const { ds, issues } = loadDataset(texts);
  const result = runPeriod(ds);
  return { ds, issues, result, texts, source, ms: Math.round(performance.now() - t0) };
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData | null>(null);
  const [bundled, setBundled] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBundled()
      .then((texts) => {
        setBundled(texts);
        setData(compute(texts, "bundled"));
      })
      .catch((e) => setError(`Could not load the data package: ${e instanceof Error ? e.message : String(e)}`));
  }, []);

  const replaceFiles = useCallback(
    (files: Record<string, string>) => {
      try {
        const merged = { ...(data?.texts ?? bundled ?? {}), ...files };
        setData(compute(merged, "uploaded"));
        setError(null);
      } catch (e) {
        setError(`Calculation failed on the uploaded files: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [data, bundled],
  );

  const reset = useCallback(() => {
    if (bundled) setData(compute(bundled, "bundled"));
  }, [bundled]);

  return <DataContext.Provider value={{ data, error, replaceFiles, reset }}>{children}</DataContext.Provider>;
}

export const useData = () => useContext(DataContext);
