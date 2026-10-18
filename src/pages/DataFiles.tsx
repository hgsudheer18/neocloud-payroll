import { useState } from "react";
import { useData } from "../state.tsx";
import { PageHead, Pill, Section, downloadText, sevTone } from "../ui.tsx";
import { FILES } from "../../lib/data/load.ts";
import { parseCsv } from "../../lib/util/csv.ts";

const PURPOSE: Record<string, string> = {
  "workers.csv": "One row per worker as of period start (or hire): org, location, job, FLSA, pay, pay group, elections.",
  "worker_events.csv": "Effective-dated changes inside the period: comp change, location change, leave of absence.",
  "timesheets.csv": "Punches for non-exempt workers, including the prior-week days needed for the straddling workweek and corrections.",
  "absence_balances.csv": "Legacy balances as of period start (pre-accrual).",
  "absence_requests.csv": "Approved and pending time off.",
  "ytd_balances.csv": "Converted year-to-date taxable wages (drives wage-base taxes).",
  "garnishments.csv": "Active court orders.",
  "legacy_rippling_register.csv": "Legacy register for the same period, used for parallel reconciliation.",
  "provider_results.csv": "October results returned by in-country providers.",
  "gl_account_mapping.csv": "Workday ledger account to NetSuite account mapping.",
  "cost_centers.csv": "Cost centers with supervisory org, owning company and NetSuite department and class.",
  "locations.csv": "Locations with company and NetSuite location.",
  "companies.csv": "Companies with currency and NetSuite subsidiary.",
};

export default function DataFiles() {
  const { data, replaceFiles, reset } = useData();
  const [over, setOver] = useState(false);
  const [msg, setMsg] = useState("");
  const read = async (list: FileList | null) => {
    if (!list?.length) return;
    const files: Record<string, string> = {};
    for (const f of Array.from(list)) if (f.name.endsWith(".csv")) files[f.name] = await f.text();
    const known = Object.keys(files).filter((n) => (Object.values(FILES) as string[]).includes(n));
    const unknown = Object.keys(files).filter((n) => !known.includes(n));
    replaceFiles(Object.fromEntries(known.map((k) => [k, files[k]])));
    setMsg(`Recalculated with ${known.length} uploaded file${known.length === 1 ? "" : "s"}${unknown.length ? `. Ignored (name not recognised): ${unknown.join(", ")}` : ""}.`);
  };

  return (
    <>
      <PageHead title="Data files">
        The app ingests the CSV package and recalculates everything from it. Upload replacement files to rerun the period in your browser; nothing is sent to a server.
      </PageHead>

      <div
        className={`dropzone ${over ? "over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); read(e.dataTransfer.files); }}
      >
        <p style={{ margin: "0 0 12px" }}>Drop one or more CSV files here, using the file names below. Files you do not upload keep their current version.</p>
        <label className="btn">
          Choose CSV files
          <input type="file" accept=".csv" multiple hidden onChange={(e) => read(e.target.files)} />
        </label>{" "}
        {data!.source === "uploaded" && <button className="btn ghost" onClick={() => { reset(); setMsg("Restored the bundled data package."); }}>Restore bundled package</button>}
      </div>
      {msg && <div className="callout info">{msg}</div>}

      <Section title="Validation" lede="Checked on load: required columns, date and time formats, numeric fields, duplicate IDs and references to cost centers, locations and workers.">
        {data!.issues.length === 0 ? <div className="callout ok">All files loaded with no validation issues.</div> : (
          <div className="table-wrap">
            <table className="reg">
              <tbody>{data!.issues.map((i, k) => <tr key={k}><td><Pill tone={sevTone(i.severity)}>{i.severity}</Pill></td><td>{i.file}{i.row ? ` row ${i.row}` : ""}</td><td>{i.message}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Files in use">
        <div className="table-wrap">
          <table className="reg">
            <thead><tr><th>File</th><th className="n">Rows</th><th>Contents</th><th /></tr></thead>
            <tbody>
              {Object.values(FILES).map((f) => {
                const text = data!.texts[f];
                return (
                  <tr key={f}>
                    <td>{f}</td>
                    <td className="n">{text ? parseCsv(text).length : <Pill tone="warn">missing</Pill>}</td>
                    <td className="small">{PURPOSE[f]}</td>
                    <td>{text && <button className="btn ghost" onClick={() => downloadText(f, text)}>Download</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
