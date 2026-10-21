import { useEffect, useRef, useState } from "react";
import { useData } from "../state.tsx";
import { go, setQuery } from "../router.tsx";
import { Money, PageHead, Pill, Section, downloadText } from "../ui.tsx";
import { toCsv } from "../../lib/util/csv.ts";
import { toDecimalString } from "../../lib/util/money.ts";
import { COLUMNS, type EmployeeRecon } from "../../lib/engine/reconcile.ts";
import { buildPayload, groundingCheck, templateCommentary, SYSTEM_PROMPT } from "../../lib/ai/commentary.ts";

const COL_LABEL: Record<string, string> = {
  regularPay: "Regular pay", overtimePay: "Overtime pay", premiumPay: "Premium pay", otherPay: "Other pay", gross: "Gross", preTaxDeductions: "Pre-tax deductions",
  fit: "Federal income tax", ssEe: "Social Security EE", medicareEe: "Medicare EE", stateTax: "State income tax", stateOther: "SDI / PFL / LTC", postTaxDeductions: "Post-tax deductions",
  net: "Net pay", ssEr: "Social Security ER", medicareEr: "Medicare ER", futa: "FUTA", sui: "SUI", employerTaxes: "Employer taxes", benefits: "Benefits", totalCost: "Total cost",
};
const tone = (s: EmployeeRecon["status"]) => (s === "Matched" ? "ok" : s === "Unexplained" ? "bad" : s === "Explained" ? "warn" : "info");

export default function Reconciliation({ id, query }: { id?: string; query: URLSearchParams }) {
  const { data } = useData();
  const r = data!.result;
  const tab = query.get("tab") ?? (r.reconciled ? "legacy" : "headcount");
  const showMatched = query.get("all") === "1";
  const [full, setFull] = useState(false);
  const setTab = (t: string) => setQuery(`/reconciliation${id ? `/${id}` : ""}`, { tab: t, all: showMatched ? "1" : "" });
  const sel = id ? r.recon.employees.find((e) => e.employeeId === id) : undefined;
  const list = r.recon.employees.filter((e) => showMatched || e.status !== "Matched");

  return (
    <>
      <PageHead title="Reconciliation">
        Headcount from file to paid, and every employee compared with the legacy Rippling register. A variance counts as explained only when recalculating under the identified cause reproduces the legacy row to the cent.
      </PageHead>
      <div className="tabs" role="tablist">
        {[["legacy", "Legacy register"], ["headcount", "Headcount"], ["commentary", "Controller commentary"]].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === "headcount" && <Headcount />}
      {tab === "commentary" && <Commentary />}
      {tab === "legacy" && !r.reconciled && <div className="callout info">This period is after go-live, so there is no legacy register to compare with: Workday is the only payroll system. Select the Oct 1–15 parallel-run period in the sidebar to see the reconciliation to Rippling. Headcount reconciliation still applies.</div>}
      {tab === "legacy" && r.reconciled && (
        <>
          <div className="figures">
            {(["Matched", "Explained", "Only in legacy", "Only in Workday", "Unexplained"] as const).map((k) => (
              <div className="figure" key={k}>
                <div className="v">{r.recon.counts[k]}</div>
                <div className="l">{k}</div>
              </div>
            ))}
            <div className="figure">
              <div className="v"><Money c={r.recon.totals.legacy.gross - r.recon.totals.workday.gross} signed /></div>
              <div className="l">Gross, legacy minus Workday</div>
            </div>
            <div className="figure">
              <div className="v"><Money c={r.recon.totals.legacy.net - r.recon.totals.workday.net} signed /></div>
              <div className="l">Net, legacy minus Workday</div>
            </div>
          </div>

          {sel && <EmployeeDetail e={sel} />}

          <Section title="Variances by root cause" lede="Amounts are legacy minus Workday. Click a worker to see the column-by-column comparison and the proof.">
            <div className="table-wrap">
              <table className="reg">
                <thead><tr><th>Root cause</th><th>Classification</th><th>Correct system</th><th>Workers</th><th className="n">Gross</th><th className="n">Net</th><th className="n">Employer tax</th></tr></thead>
                <tbody>
                  {r.recon.byCause.map((c) => (
                    <tr key={c.id}>
                      <td>{c.label}</td>
                      <td><Pill tone={c.category === "Legacy error" ? "bad" : c.category === "Timing" ? "info" : "warn"}>{c.category}</Pill></td>
                      <td>{c.correct === "Legacy" ? <strong>Legacy</strong> : c.correct}</td>
                      <td className="small">{c.employees.map((id, i) => <span key={id}>{i ? ", " : ""}<a href={`#/reconciliation/${id}?tab=legacy`}>{id}</a></span>)}</td>
                      <td className="n"><Money c={c.grossImpact} signed /></td>
                      <td className="n"><Money c={c.netImpact} signed /></td>
                      <td className="n"><Money c={c.erTaxImpact} signed /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section
            title={showMatched ? "All employees" : "Employees with a variance"}
            right={<div className="row">
              <label className="small"><input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} /> Show explanations and actions</label>
              <label className="small"><input type="checkbox" checked={showMatched} onChange={(e) => setQuery(`/reconciliation${id ? `/${id}` : ""}`, { tab, all: e.target.checked ? "1" : "" })} /> Show matched employees too</label>
              <button className="btn ghost" onClick={() => downloadText("reconciliation-2026-10-SM1.csv", toCsv(r.recon.employees.flatMap((e) => (e.causes.length ? e.causes : [null]).map((c) => ({ employee_id: e.employeeId, name: e.name, status: e.status, workday_gross: e.workday ? toDecimalString(e.workday.gross) : "", legacy_gross: e.legacy ? toDecimalString(e.legacy.gross) : "", delta_gross: toDecimalString(e.delta.gross), delta_net: toDecimalString(e.delta.net), delta_employer_taxes: toDecimalString(e.delta.employerTaxes), root_cause: c?.hypothesis.label ?? "", classification: c?.hypothesis.category ?? "", correct_system: c?.hypothesis.correct ?? "", explanation: c?.explanation ?? "", action: c?.action ?? "" })))))}>Download CSV</button>
            </div>}
          >
            <div className="table-wrap" style={{ maxHeight: "60vh" }}>
              <table className="reg">
                <thead>
                  <tr><th>Employee</th><th>Status</th><th className="n">Workday gross</th><th className="n">Legacy gross</th><th className="n">Δ gross</th><th className="n">Δ net</th><th className="n">Δ employer tax</th><th>Root cause and classification</th></tr>
                </thead>
                <tbody>
                  {list.map((e) => (
                    <tr key={e.employeeId} className={`click ${id === e.employeeId ? "sel" : ""}`} onClick={() => go(`/reconciliation/${e.employeeId}`, { tab: "legacy", all: showMatched ? "1" : "" })}>
                      <td><a href={`#/reconciliation/${e.employeeId}`} onClick={(x) => x.preventDefault()}>{e.employeeId}</a> {e.name}</td>
                      <td><Pill tone={tone(e.status)}>{e.status}</Pill></td>
                      <td className="n">{e.workday ? <Money c={e.workday.gross} /> : "—"}</td>
                      <td className="n">{e.legacy ? <Money c={e.legacy.gross} /> : "—"}</td>
                      <td className="n"><Money c={e.delta.gross} signed /></td>
                      <td className="n"><Money c={e.delta.net} signed /></td>
                      <td className="n"><Money c={e.delta.employerTaxes} signed /></td>
                      <td className="small wrap">{e.causes.map((c) => <div key={c.hypothesis.id} style={full ? { marginBottom: 8 } : undefined}>{c.hypothesis.label} <span className="faint">({c.hypothesis.category.toLowerCase()}; correct: {c.hypothesis.correct})</span>{full && <><div>{c.explanation}</div><div className="faint"><strong>Action:</strong> {c.action}</div></>}</div>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Register totals: Workday versus legacy" lede="Every register column summed over all workers, including the two paid in only one system.">
            <div className="table-wrap">
              <table className="reg">
                <thead><tr><th>Register column</th><th className="n">Workday</th><th className="n">Legacy</th><th className="n">Legacy − Workday</th></tr></thead>
                <tbody>
                  {COLUMNS.filter((c) => r.recon.totals.workday[c] || r.recon.totals.legacy[c]).map((c) => {
                    const d = r.recon.totals.legacy[c] - r.recon.totals.workday[c];
                    const strong = c === "gross" || c === "net" || c === "totalCost";
                    return (
                      <tr key={c}>
                        <td>{strong ? <strong>{COL_LABEL[c]}</strong> : COL_LABEL[c]}</td>
                        <td className="n"><Money c={r.recon.totals.workday[c]} /></td>
                        <td className="n"><Money c={r.recon.totals.legacy[c]} /></td>
                        <td className="n">{d ? <strong><Money c={d} signed /></strong> : <span className="zero">0.00</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </>
  );
}

function EmployeeDetail({ e }: { e: EmployeeRecon }) {
  const cols = COLUMNS.filter((c) => (e.workday?.[c] ?? 0) !== 0 || (e.legacy?.[c] ?? 0) !== 0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [e.employeeId]);
  return (
    <div className="detail" style={{ marginTop: 24 }} ref={ref}>
      <div className="detail-head">
        <h2>{e.employeeId} {e.name}</h2>
        <Pill tone={tone(e.status)}>{e.status}</Pill>
        <a href={`#/register/${e.employeeId}`} className="small">Open payslip</a>
        <button className="close" onClick={() => go("/reconciliation")}>Close</button>
      </div>
      <div className="grid2">
        <div className="table-wrap">
          <table className="reg">
            <thead><tr><th>Register column</th><th className="n">Workday</th><th className="n">Legacy</th><th className="n">Legacy − Workday</th></tr></thead>
            <tbody>
              {cols.map((c) => (
                <tr key={c}>
                  <td>{COL_LABEL[c]}</td>
                  <td className="n">{e.workday ? <Money c={e.workday[c]} /> : "—"}</td>
                  <td className="n">{e.legacy ? <Money c={e.legacy[c]} /> : "—"}</td>
                  <td className="n">{e.delta[c] ? <strong><Money c={e.delta[c]} signed /></strong> : <span className="zero">0.00</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          {e.causes.length === 0 && e.status === "Matched" && <div className="callout ok">Every column matches to the cent.</div>}
          {e.status === "Unexplained" && <div className="callout bad">No combination of plausible causes reproduces the legacy row. Investigate before sign-off.</div>}
          {e.causes.map((c, i) => (
            <div key={c.hypothesis.id} style={{ marginBottom: 18 }}>
              <h3>
                {e.causes.length > 1 ? `Cause ${i + 1}: ` : ""}{c.hypothesis.label}{" "}
                <Pill tone={c.hypothesis.category === "Legacy error" ? "bad" : c.hypothesis.category === "Timing" ? "info" : "warn"}>{c.hypothesis.category}</Pill>
              </h3>
              <p style={{ margin: "0 0 6px" }}>{c.explanation}</p>
              <p className="small muted" style={{ margin: "0 0 6px" }}>
                Impact: {Object.entries(c.impact).filter(([k]) => ["gross", "net", "employerTaxes", "fit", "stateTax", "stateOther", "postTaxDeductions", "ssEe"].includes(k)).map(([k, v]) => `${COL_LABEL[k]} ${v! > 0 ? "+" : ""}${(v! / 100).toFixed(2)}`).join(", ")}
              </p>
              <div className="callout info"><strong>Correct system: {c.hypothesis.correct}.</strong> {c.action}</div>
            </div>
          ))}
          {e.causes.length > 0 && e.status !== "Only in Workday" && <p className="small faint">Re-performed: recalculating with {e.causes.length === 1 ? "this cause" : "these causes"} reproduces every legacy column to the cent.</p>}
        </div>
      </div>
    </div>
  );
}

function Headcount() {
  const { data } = useData();
  const r = data!.result;
  const legacyOnly = r.recon.employees.filter((e) => e.status === "Only in legacy");
  const wdOnly = r.recon.employees.filter((e) => e.status === "Only in Workday");
  const legacyCount = r.recon.employees.filter((e) => e.legacy).length;
  const paid = r.headcount.steps.find((s) => s.label === "US employees paid")!.count;
  return (
    <>
      <div className="grid2">
        <Section title="Workers on file to workers paid">
          <div className="table-wrap">
            <table className="reg">
              <tbody>
                {r.headcount.steps.map((s) => (
                  <tr key={s.label}>
                    <td style={{ width: 24 }}>{s.sign}</td>
                    <td>{s.sign === "=" ? <strong>{s.label}</strong> : s.label}<div className="explain">{s.explanation}{s.workerIds.length > 0 && s.workerIds.length <= 8 ? ` (${s.workerIds.join(", ")})` : ""}</div></td>
                    <td className="n">{s.sign === "=" ? <strong>{s.count}</strong> : s.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        <Section title="Movement during the period">
          <div className="table-wrap">
            <table className="reg">
              <tbody>
                {r.headcount.movement.map((s) => (
                  <tr key={s.label}>
                    <td style={{ width: 24 }}>{s.sign}</td>
                    <td>{s.label}<div className="explain">{s.explanation}{s.workerIds.length ? ` (${s.workerIds.join(", ")})` : ""}</div></td>
                    <td className="n">{s.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
      {r.reconciled && (
      <Section title="Workday paid versus legacy paid">
        <div className="table-wrap">
          <table className="reg">
            <tbody>
              <tr><td>=</td><td><strong>Paid in Workday</strong></td><td className="n"><strong>{paid}</strong></td></tr>
              <tr><td>+</td><td>Paid only in legacy<div className="explain">{legacyOnly.map((e) => `${e.employeeId}: ${e.causes[0]?.explanation ?? "unexplained"}`).join(" ")}</div></td><td className="n">{legacyOnly.length}</td></tr>
              <tr><td>−</td><td>Paid only in Workday<div className="explain">{wdOnly.map((e) => `${e.employeeId}: ${e.causes[0]?.explanation ?? ""}`).join(" ")}</div></td><td className="n">{wdOnly.length}</td></tr>
              <tr><td>=</td><td><strong>Rows in the legacy register</strong></td><td className="n"><strong>{legacyCount}</strong></td></tr>
            </tbody>
          </table>
        </div>
        {paid + legacyOnly.length - wdOnly.length === legacyCount ? <div className="callout ok">Headcount ties: {paid} + {legacyOnly.length} − {wdOnly.length} = {legacyCount}.</div> : <div className="callout bad">Headcount does not tie.</div>}
      </Section>
      )}
    </>
  );
}

function Commentary() {
  const { data } = useData();
  const payload = buildPayload(data!.result);
  const draft = templateCommentary(payload);
  const [ai, setAi] = useState<{ text?: string; error?: string; check?: ReturnType<typeof groundingCheck>; busy?: boolean }>({});
  const ask = async () => {
    setAi({ busy: true });
    try {
      const res = await fetch("/api/commentary", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload }) });
      const j = await res.json().catch(() => ({ error: `The commentary service returned ${res.status}.` }));
      if (!res.ok) return setAi({ error: j.error ?? `Request failed (${res.status}).` });
      setAi({ text: j.text, check: groundingCheck(j.text, payload) });
    } catch {
      setAi({ error: "The commentary service is not reachable. It runs as a Vercel function; locally, use the deterministic draft." });
    }
  };
  return (
    <div className="grid2">
      <Section title="Draft commentary for the Controller" lede="Generated from the reconciliation results with a fixed template. Every number comes from the engine.">
        <div className="sheet commentary">{draft}</div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={ask} disabled={ai.busy}>{ai.busy ? "Drafting…" : "Draft with Claude"}</button>
          <span className="small muted">Optional. Needs ANTHROPIC_API_KEY on the server.</span>
        </div>
        {ai.error && <div className="callout">{ai.error}</div>}
        {ai.text && ai.check && (
          ai.check.ok ? (
            <div className="sheet commentary" style={{ marginTop: 12 }}>
              <Pill tone="ok">Grounding check passed</Pill> <Pill tone="info">Draft: review before sending</Pill>
              {"\n\n"}
              {ai.text}
            </div>
          ) : (
            <div className="callout bad">The model's draft was blocked: it contains figures or identifiers that are not in the source data ({ai.check.ungrounded.join(", ")}). Use the deterministic draft.</div>
          )
        )}
      </Section>
      <Section title="Guardrails for payroll data" lede="What leaves the browser, and what the model is allowed to do.">
        <ol className="small" style={{ paddingLeft: 18 }}>
          <li><strong>Minimise.</strong> Only the aggregated payload below is sent: cause-level totals and counts. No names, employee IDs, pay rates or tax details. The server rejects any payload containing an employee ID pattern.</li>
          <li><strong>Ground.</strong> The model writes prose only. Every dollar amount in its reply must exactly match a figure in the payload, or the draft is blocked.</li>
          <li><strong>Keep the key server-side.</strong> The API key lives in a Vercel environment variable; the browser never sees it. The instructions to the model are fixed on the server.</li>
          <li><strong>Human in the loop.</strong> Output is a draft for the Controller. It never changes a calculation or the register.</li>
          <li><strong>Vendor terms.</strong> In production, use an enterprise agreement with zero data retention and no training on inputs, and log every request in the payroll audit trail.</li>
        </ol>
        <h3>Payload sent to the model</h3>
        <pre className="sheet small" style={{ overflowX: "auto", maxHeight: 280 }}>{JSON.stringify(payload, null, 2)}</pre>
        <h3>Instructions to the model</h3>
        <pre className="sheet small" style={{ whiteSpace: "pre-wrap" }}>{SYSTEM_PROMPT}</pre>
      </Section>
    </div>
  );
}
