import { useMemo } from "react";
import { useData } from "../state.tsx";
import { useErp } from "../erp.tsx";
import { Money, PageHead, Pill, Section, downloadText } from "../ui.tsx";
import { computePeriod } from "../../lib/erp/periods.ts";
import { PERIOD_LABEL, US_PERIOD } from "../../lib/config/period.ts";
import { toCsv } from "../../lib/util/csv.ts";
import { fmt } from "../../lib/util/money.ts";
import { tieValue } from "./Dashboard.tsx";

interface Finding {
  area: string;
  employeeId: string;
  name: string;
  issue: string;
  category: string;
  severity: "Critical" | "Error" | "Warning";
  gross: number | null;
  net: number | null;
  right: string;
  action: string;
}

const tone = (s: Finding["severity"]) => (s === "Warning" ? "warn" : "bad");

/**
 * Every data problem found in the Oct 1–15 parallel run, in one list: the balances
 * (control totals), the reconciliation to the legacy register, the pre-payroll audit,
 * time exceptions, absence and pay flags, data-file validation, and the October
 * international provider results. Payroll only.
 */
export default function DataErrors() {
  const { data } = useData();
  const { erp } = useErp();
  const view = useMemo(() => computePeriod(data!.base, erp, US_PERIOD.id), [data, erp]);
  const r = view.result;
  const nameOf = (id: string) => data!.base.workers.find((w) => w.id === id)?.name ?? "";
  const findings: Finding[] = [];

  for (const e of r.recon.employees) {
    if (e.status === "Matched") continue;
    if (e.status === "Only in legacy" || e.status === "Only in Workday") {
      findings.push({ area: "Reconciliation to Rippling", employeeId: e.employeeId, name: e.name, issue: e.status === "Only in legacy" ? "Paid by Rippling but not by Workday" : "Paid by Workday but not in the Rippling register", category: "Data", severity: "Error", gross: e.delta.gross, net: e.delta.net, right: "Confirm with owner", action: e.causes[0]?.action ?? "Confirm the worker's status with HR." });
      continue;
    }
    for (const c of e.causes) {
      findings.push({ area: "Reconciliation to Rippling", employeeId: e.employeeId, name: e.name, issue: `${c.hypothesis.label}: ${c.explanation}`, category: c.hypothesis.category, severity: e.status === "Unexplained" ? "Critical" : "Error", gross: c.impact.gross ?? null, net: c.impact.net ?? null, right: c.hypothesis.correct, action: c.action });
    }
    if (e.status === "Unexplained") findings.push({ area: "Reconciliation to Rippling", employeeId: e.employeeId, name: e.name, issue: "Variance not explained by any known cause", category: "Unexplained", severity: "Critical", gross: e.residual.gross, net: e.residual.net, right: "Investigate", action: "Hold and investigate before sign-off." });
  }
  for (const a of r.audit) {
    if (a.severity === "Info") continue;
    findings.push({ area: "Pre-payroll audit", employeeId: a.employeeId, name: nameOf(a.employeeId), issue: `${a.check}: ${a.message}`, category: "Audit", severity: a.severity === "Critical" ? "Critical" : "Warning", gross: null, net: null, right: "Workday", action: "Resolve or record a resolution before approving the pay run." });
  }
  for (const c of r.us) {
    for (const x of c.time?.exceptions ?? []) {
      if (x.severity === "Info") continue;
      findings.push({ area: "Time", employeeId: c.worker.id, name: c.worker.name, issue: `${x.code.replace(/_/g, " ").toLowerCase()} (${x.date}): ${x.message}`, category: "Data", severity: x.severity === "Critical" ? "Critical" : "Warning", gross: null, net: null, right: "Workday", action: x.treatment });
    }
    for (const a of c.absence) for (const f of a.flags) findings.push({ area: "Absence balances", employeeId: c.worker.id, name: c.worker.name, issue: `${a.plan.name}: ${f}`, category: "Data", severity: "Warning", gross: null, net: null, right: "Confirm with owner", action: "Confirm the balance with HR before go-live." });
    for (const f of c.pay.flags) findings.push({ area: "Pay", employeeId: c.worker.id, name: c.worker.name, issue: f, category: "Pay", severity: /final pay|negative/i.test(f) ? "Critical" : "Warning", gross: null, net: null, right: "Workday", action: "Review before approval." });
  }
  for (const i of data!.issues) findings.push({ area: "Data files", employeeId: "", name: "", issue: `${i.file}${i.row ? ` row ${i.row}` : ""}: ${i.message}`, category: "Data", severity: i.severity === "Error" ? "Error" : "Warning", gross: null, net: null, right: "Fix the file", action: "Correct the source file and reload." });
  for (const v of r.providerVariances) {
    if (v.category === "Matched") continue;
    findings.push({ area: "International (October)", employeeId: v.employeeId, name: nameOf(v.employeeId), issue: `${v.field}: ${v.explanation}`, category: v.category, severity: v.category === "Unexplained" ? "Critical" : "Warning", gross: null, net: null, right: v.category === "Timing" ? "Both (timing)" : "Confirm with owner", action: v.action });
  }

  const areas = [...new Set(findings.map((f) => f.area))];
  const download = () =>
    downloadText(
      "data-errors-2026-10-01-to-15.csv",
      toCsv(findings.map((f) => ({ area: f.area, employee_id: f.employeeId, name: f.name, severity: f.severity, category: f.category, issue: f.issue, gross_impact: f.gross === null ? "" : (f.gross / 100).toFixed(2), net_impact: f.net === null ? "" : (f.net / 100).toFixed(2), who_is_right: f.right, action: f.action }))),
    );

  return (
    <>
      <PageHead title="Data errors: Oct 1–15">
        Every difference and data problem found when {PERIOD_LABEL[US_PERIOD.id]} was calculated and reconciled to the legacy Rippling register. The data package has seeded errors; each is listed with its impact, which system is right and what to do. Visible to payroll only.
      </PageHead>

      <div className="cards">
        <div className="card"><h3>Balances</h3><div className="big">{r.ties.filter((t) => t.ok).length} / {r.ties.length}</div><p className="small">control totals tie</p></div>
        <div className="card"><h3>Reconciliation</h3><div className="big">{r.recon.counts.Matched}</div><p className="small">match to the cent; {r.recon.counts.Explained + r.recon.counts["Only in legacy"] + r.recon.counts["Only in Workday"]} differences, {r.recon.counts.Unexplained} unexplained</p></div>
        <div className="card"><h3>Findings</h3><div className="big">{findings.length}</div><p className="small">{findings.filter((f) => f.severity === "Critical").length} critical, {findings.filter((f) => f.severity === "Error").length} errors, {findings.filter((f) => f.severity === "Warning").length} warnings</p></div>
        <div className="card"><h3>Gross difference</h3><div className="big"><Money c={r.recon.totals.workday.gross - r.recon.totals.legacy.gross} /></div><p className="small">Workday {fmt(r.recon.totals.workday.gross)} vs Rippling {fmt(r.recon.totals.legacy.gross)}</p></div>
      </div>
      <div className="row no-print" style={{ marginBottom: 16 }}><button className="btn ghost" onClick={download}>Download all findings (CSV)</button><a href="#/reconciliation">Reconciliation detail</a><a href="#/controls">Audit findings</a></div>

      <Section title="Balances (control totals)" lede="Each total is calculated two independent ways and must agree.">
        <div className="table-wrap">
          <table className="reg">
            <thead><tr><th>Control total</th><th className="n">Left</th><th className="n">Right</th><th>Result</th></tr></thead>
            <tbody>{r.ties.map((t) => <tr key={t.name}><td>{t.name}</td><td className="n small">{t.left.label}: {tieValue(t.name, t.left.value)}</td><td className="n small">{t.right.label}: {tieValue(t.name, t.right.value)}</td><td>{t.ok ? <Pill tone="ok">Ties</Pill> : <Pill tone="bad">Difference</Pill>}</td></tr>)}</tbody>
          </table>
        </div>
      </Section>

      {areas.map((area) => {
        const list = findings.filter((f) => f.area === area);
        return (
          <Section key={area} title={`${area} (${list.length})`}>
            <div className="table-wrap" style={{ maxHeight: "60vh" }}>
              <table className="reg">
                <thead><tr><th>Worker</th><th>Severity</th><th>Issue</th><th className="n">Gross</th><th className="n">Net</th><th>Who is right</th><th>Action</th></tr></thead>
                <tbody>
                  {list.map((f, i) => (
                    <tr key={i}>
                      <td>{f.employeeId ? <a href={`#/reconciliation/${f.employeeId}`}>{f.employeeId}</a> : "—"} {f.name}</td>
                      <td><Pill tone={tone(f.severity)}>{f.severity}</Pill><div className="faint small">{f.category}</div></td>
                      <td className="small wrap">{f.issue}</td>
                      <td className="n">{f.gross === null || f.gross === 0 ? "" : <Money c={f.gross} />}</td>
                      <td className="n">{f.net === null || f.net === 0 ? "" : <Money c={f.net} />}</td>
                      <td className="small">{f.right}</td>
                      <td className="small wrap">{f.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        );
      })}
    </>
  );
}
