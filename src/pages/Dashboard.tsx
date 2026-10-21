import { useData } from "../state.tsx";
import { rollup } from "../../lib/engine/run.ts";
import { Bars, Money, PageHead, Pill, Section, Select } from "../ui.tsx";
import { setQuery } from "../router.tsx";
import { fmt } from "../../lib/util/money.ts";
import { pretty } from "../../lib/util/dates.ts";
import { PERIOD_LABEL } from "../../lib/config/period.ts";

export const tieValue = (name: string, v: number) => (/hours|hrs/i.test(name) ? `${(v / 100).toFixed(2)} hrs` : /Headcount|variance/i.test(name) ? String(v) : fmt(v));

export default function Dashboard({ query }: { query: URLSearchParams }) {
  const { data } = useData();
  const r = data!.result;
  const dept = query.get("dept") ?? "";
  const loc = query.get("loc") ?? "";
  const by = (query.get("by") as "department" | "location" | "costCenter") ?? "department";
  const set = (k: string, v: string) => setQuery("/overview", { dept, loc, by, [k]: v });

  const allOk = r.ties.every((t) => t.ok);
  const variances = r.recon.employees.filter((e) => e.status !== "Matched").length;
  const rows = rollup(r, by, { department: dept, location: loc });
  const depts = [...new Set(data!.ds.workers.filter((w) => w.workerType === "Employee").map((w) => w.department))].sort();
  const locs = data!.ds.locations.map((l) => [l.id, l.name] as [string, string]);
  const totalRoll = rows.reduce((s, x) => s + x.burdened, 0);

  return (
    <>
      <PageHead title={`${PERIOD_LABEL[r.period.id] ?? r.period.id}`}>
        {r.us.length} employees paid in the {r.period.payGroup} run ({pretty(r.period.start)} to {pretty(r.period.end)}, check date {pretty(r.period.checkDate)}), {fmt(r.totals.burdened)} cost to company. {r.intl.length} international employees in the October provider run,{" "}
        {fmt(r.totals.intlUsd)} in USD. {allOk ? "Every control total ties" : "Some control totals do not tie"}{r.reconciled ? <> and {r.recon.counts.Unexplained === 0 ? `all ${variances} legacy variances are explained` : `${r.recon.counts.Unexplained} legacy variances are unexplained`}</> : null}.
      </PageHead>

      <div className="tieout" aria-label="Control totals">
        <div className="tieout-head">
          <span className="verdict">{allOk ? "The period ties" : "The period does not tie yet"}</span>
          <span className="muted small">Each pair is calculated independently and must agree to the cent (or to the hundredth of an hour).</span>
        </div>
        {r.ties.map((t) => (
          <div className="tie" key={t.name}>
            <span className={`mark ${t.ok ? "" : "bad"}`} aria-label={t.ok ? "ties" : "does not tie"}>{t.ok ? "✓" : "!"}</span>
            <span>{t.name}</span>
            <span className="side-val">
              {tieValue(t.name, t.left.value)}
              <small>{t.left.label}</small>
            </span>
            <span className="side-val">
              {tieValue(t.name, t.right.value)}
              <small>{t.right.label}</small>
            </span>
          </div>
        ))}
      </div>

      <Section title={`${r.period.payGroup} totals`}>
        <div className="figures">
          {[
            ["Gross pay", r.totals.gross],
            ["Pre-tax deductions", r.totals.preTax],
            ["Employee taxes", r.totals.eeTaxes],
            ["Post-tax deductions", r.totals.postTax],
            ["Net pay", r.totals.net],
            ["Employer taxes", r.totals.erTaxes],
            ["Benefits load", r.totals.benefits],
            ["Cost to Company", r.totals.burdened],
          ].map(([l, v]) => (
            <div className="figure" key={l as string}>
              <div className="v">{fmt(v as number)}</div>
              <div className="l">{l}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Cost to Company rollup" lede="US semi-monthly period plus October international employer cost translated to USD at the reporting rates (GBP 1.27, CAD 0.73, INR 0.012).">
        <div className="filters">
          <Select label="Group by" value={by} onChange={(v) => set("by", v)} options={[["department", "Department"], ["location", "Location"], ["costCenter", "Cost center"]]} all={null} />
          <Select label="Department" value={dept} onChange={(v) => set("dept", v)} options={depts} />
          <Select label="Location" value={loc} onChange={(v) => set("loc", v)} options={locs} />
        </div>
        <div className="grid2">
          <div className="sheet">
            <Bars rows={rows.map((x) => ({ label: by === "location" ? (data!.ds.locations.find((l) => l.id === x.key)?.name ?? x.key) : by === "costCenter" ? `${x.key} ${data!.ds.costCenters.find((c) => c.id === x.key)?.name.split(" - ")[1] ?? ""}` : x.key, parts: [x.gross, x.erTaxes, x.benefits], total: x.burdened }))} />
            <div className="legend">
              <span><i style={{ background: "var(--ledger)" }} />Gross</span>
              <span><i style={{ background: "#777777" }} />Employer taxes</span>
              <span><i style={{ background: "#bbbbbb" }} />Benefits</span>
            </div>
          </div>
          <div className="table-wrap">
            <table className="reg">
              <thead>
                <tr>
                  <th>{by === "department" ? "Department" : by === "location" ? "Location" : "Cost center"}</th>
                  <th className="n">Workers</th>
                  <th className="n">Gross</th>
                  <th className="n">Employer taxes</th>
                  <th className="n">Benefits</th>
                  <th className="n">Cost to Company</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.key}>
                    <td>{by === "location" ? (data!.ds.locations.find((l) => l.id === x.key)?.name ?? x.key) : x.key}</td>
                    <td className="n">{x.headcount}</td>
                    <td className="n"><Money c={x.gross} /></td>
                    <td className="n"><Money c={x.erTaxes} /></td>
                    <td className="n"><Money c={x.benefits} /></td>
                    <td className="n"><Money c={x.burdened} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="n">{rows.reduce((s, x) => s + x.headcount, 0)}</td>
                  <td className="n"><Money c={rows.reduce((s, x) => s + x.gross, 0)} /></td>
                  <td className="n"><Money c={rows.reduce((s, x) => s + x.erTaxes, 0)} /></td>
                  <td className="n"><Money c={rows.reduce((s, x) => s + x.benefits, 0)} /></td>
                  <td className="n"><Money c={totalRoll} /></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </Section>

      {r.reconciled && <Section title="Legacy register variances by root cause" right={<a href="#/reconciliation">Open the reconciliation</a>}>
        <div className="table-wrap">
          <table className="reg">
            <thead>
              <tr>
                <th>Root cause</th>
                <th>Classification</th>
                <th>Correct system</th>
                <th className="n">Employees</th>
                <th className="n">Gross impact</th>
                <th className="n">Net impact</th>
                <th className="n">Employer tax impact</th>
              </tr>
            </thead>
            <tbody>
              {r.recon.byCause.map((c) => (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  <td><Pill tone={c.category === "Legacy error" ? "bad" : c.category === "Timing" ? "info" : "warn"}>{c.category}</Pill></td>
                  <td>{c.correct}</td>
                  <td className="n">{c.employees.length}</td>
                  <td className="n"><Money c={c.grossImpact} signed /></td>
                  <td className="n"><Money c={c.netImpact} signed /></td>
                  <td className="n"><Money c={c.erTaxImpact} signed /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">Impact is legacy minus Workday: a positive number means the legacy register paid more.</p>
      </Section>}
    </>
  );
}
