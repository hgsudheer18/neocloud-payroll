// Loads the CSV package (the base data), applies the business processes
// entered in the app, and runs the selected pay period. Everything runs in the
// browser: uploaded payroll files never leave the user's machine.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { loadDataset, type LoadIssue } from "../lib/data/load.ts";
import type { PeriodResult } from "../lib/engine/run.ts";
import type { Dataset } from "../lib/data/types.ts";
import { assignGoLivePayGroups, computePeriod, type PeriodView } from "../lib/erp/periods.ts";
import { applyBps } from "../lib/erp/apply.ts";
import { US_PERIOD_2 } from "../lib/config/period.ts";
import { useErp } from "./erp.tsx";

export interface AppData {
  /** Base package + approved business processes (+ roll-forward for later periods). */
  ds: Dataset;
  /** The CSV package only. */
  base: Dataset;
  /** Base package + every approved business process, as of today (for HR screens). */
  dsNow: Dataset;
  issues: LoadIssue[];
  result: PeriodResult;
  view: PeriodView;
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

export function DataProvider({ children }: { children: ReactNode }) {
  const { erp, periodId } = useErp();
  const [texts, setTexts] = useState<Record<string, string> | null>(null);
  const [bundled, setBundled] = useState<Record<string, string> | null>(null);
  const [source, setSource] = useState<AppData["source"]>("bundled");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBundled()
      .then((t) => {
        setBundled(t);
        setTexts(t);
      })
      .catch((e) => setError(`Could not load the data package: ${e instanceof Error ? e.message : String(e)}`));
  }, []);

  const loaded = useMemo(() => (texts ? loadDataset(texts) : null), [texts]);

  const data = useMemo<AppData | null>(() => {
    if (!loaded || !texts) return null;
    try {
      const t0 = performance.now();
      const view = computePeriod(loaded.ds, erp, periodId);
      const dsNow = assignGoLivePayGroups(applyBps(loaded.ds, erp.bps), US_PERIOD_2);
      return { ds: view.ds, base: loaded.ds, dsNow, issues: loaded.issues, result: view.result, view, texts, source, ms: Math.round(performance.now() - t0) };
    } catch (e) {
      setTimeout(() => setError(`Calculation failed: ${e instanceof Error ? e.message : String(e)}`));
      return null;
    }
  }, [loaded, texts, erp, periodId, source]);

  const replaceFiles = useCallback(
    (files: Record<string, string>) => {
      setTexts((t) => ({ ...(t ?? bundled ?? {}), ...files }));
      setSource("uploaded");
      setError(null);
    },
    [bundled],
  );

  const reset = useCallback(() => {
    if (bundled) {
      setTexts(bundled);
      setSource("bundled");
    }
  }, [bundled]);

  return <DataContext.Provider value={{ data, error, replaceFiles, reset }}>{children}</DataContext.Provider>;
}

export const useData = () => useContext(DataContext);
