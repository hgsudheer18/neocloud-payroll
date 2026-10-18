import { useData } from "../state.tsx";
import { Money, PageHead, Pill, Section } from "../ui.tsx";
import { COUNTRY_RULES } from "../../lib/config/intl.ts";
import { roundCents } from "../../lib/util/money.ts";
import { pretty } from "../../lib/util/dates.ts";

const SAMPLES = ["E0006", "E0008", "E0009"];

export default function International() {
  const { data } = useData();
  const r = data!.result;
  const p = r.intlPeriod;
  const countries = Object.values(COUNTRY_RULES);

  return (
    <>
      <PageHead title="International payroll">
        UK, Canada and India are paid monthly by in-country providers. Workday sends worker, compensation, absence and one-time payment changes; the provider returns gross-to-net and employer cost; we re-perform the expected cost and post to each NetSuite subsidiary in local currency.
      </PageHead>

      <Section title="October employer cost by country">
        <div className="table-wrap">
          <table className="reg">
            <thead><tr><th>Country</th><th>Integration</th><th className="n">Workers</th><th className="n">Gross</th><th className="n">Employer statutory</th><th className="n">Benefits 5%</th><th className="n">Total, local</th><th className="n">FX</th><th className="n">Total, USD</th></tr></thead>
            <tbody>
              {countries.map((c) => {
                const rs = r.intl.filter((x) => x.worker.country === c.country);
                const s = (f: (x: (typeof rs)[0]) => number) => rs.reduce((a, x) => a + f(x), 0);
                return (
                  <tr key={c.country}>
                    <td><strong>{c.label}</strong><div className="faint small">{c.employerStatutoryLabel}</div></td>
                    <td className="small">{c.integration}</td>
                    <td className="n">{rs.length}</td>
                    <td className="n"><Money c={s((x) => x.gross)} cur={c.currency} /></td>
                    <td className="n"><Money c={s((x) => x.erStatutory)} cur={c.currency} /></td>
                    <td className="n"><Money c={s((x) => x.benefits)} cur={c.currency} /></td>
                    <td className="n"><Money c={s((x) => x.totalCost)} cur={c.currency} /></td>
                    <td className="n">{c.fxToUsd}</td>
                    <td className="n"><Money c={s((x) => x.totalCostUsd)} /></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr><td colSpan={8}>Total international employer cost, USD (translated per worker)</td><td className="n"><Money c={r.totals.intlUsd} /></td></tr>
            </tfoot>
          </table>
        </div>
      </Section>

      <Section title="Sample workers from the brief">
        <div className="grid3">
          {SAMPLES.map((id) => {
            const x = r.intl.find((w) => w.worker.id === id)!;
            return (
              <div className="sheet" key={id}>
                <h3>{id}, {COUNTRY_RULES[x.worker.country].label}</h3>
                <dl className="kv small">
                  {x.lines.map((l) => (
                    <span key={l.code} style={{ display: "contents" }}><dt>{l.name}</dt><dd><Money c={l.amount} cur={x.currency} /><div className="faint">{l.explain}</div></dd></span>
                  ))}
                  <dt>Employer statutory</dt><dd><Money c={x.erStatutory} cur={x.currency} /><div className="faint">{COUNTRY_RULES[x.worker.country].employerStatutoryLabel}</div></dd>
                  <dt>Benefits load</dt><dd><Money c={x.benefits} cur={x.currency} /><div className="faint">5% × gross</div></dd>
                  <dt><strong>Total cost</strong></dt><dd><strong><Money c={x.totalCost} cur={x.currency} /></strong></dd>
                  <dt><strong>In USD</strong></dt><dd><strong><Money c={x.totalCostUsd} /></strong><div className="faint">× {x.fx} reporting rate</div></dd>
                  <dt>GL entity</dt><dd>{x.worker.companyId} in {x.currency}{data!.ds.costCenters.find((c) => c.id === x.costCenterId)?.companyId !== x.worker.companyId ? `; cost center ${x.costCenterId} is owned by ${data!.ds.costCenters.find((c) => c.id === x.costCenterId)?.companyId}, so the cost is recharged intercompany` : ""}</dd>
                </dl>
              </div>
            );
          })}
        </div>
      </Section>

      <div className="grid2">
        <Section title="Outbound changes to providers" lede={`Changes entered by the ${pretty(p.changeCutoff)} cutoff go in the October file; later changes roll to November.`}>
          <div className="table-wrap" style={{ maxHeight: 420 }}>
            <table className="reg">
              <thead><tr><th>Worker</th><th>Change</th><th>Effective</th><th>Detail</th><th>In this file</th></tr></thead>
              <tbody>
                {r.outbound.map((c, i) => (
                  <tr key={i}>
                    <td>{c.employeeId} <span className="faint small">{c.country}</span></td>
                    <td>{c.changeType}</td>
                    <td>{pretty(c.effectiveDate)}</td>
                    <td className="small">{c.detail}</td>
                    <td>{c.inCutoff ? <Pill tone="ok">Yes</Pill> : <Pill tone="warn">Late: entered {pretty(c.enteredOn)}</Pill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        <Section title="Provider results reconciled to Workday" lede="Each provider row is matched on employee and month: gross against Workday's expected gross, employer cost against the re-performed statutory rate.">
          {r.providerVariances.length === 0 ? (
            <div className="callout ok">All {r.intl.length} provider rows match.</div>
          ) : (
            <>
              <div className="callout ok">{r.intl.length - new Set(r.providerVariances.map((v) => v.employeeId)).size} of {r.intl.length} workers match exactly.</div>
              {r.providerVariances.map((v, i) => (
                <div className="sheet" key={i} style={{ marginBottom: 12 }}>
                  <div className="row">
                    <strong>{v.employeeId}</strong>
                    <span className="muted">{v.field}</span>
                    <Pill tone={v.category === "Timing" ? "info" : "bad"}>{v.category}</Pill>
                  </div>
                  <dl className="kv small" style={{ marginTop: 8 }}>
                    <dt>Workday expected</dt><dd><Money c={v.expected} cur={v.currency} /></dd>
                    <dt>Provider</dt><dd><Money c={v.provider} cur={v.currency} /></dd>
                    <dt>Difference</dt><dd><Money c={v.delta} cur={v.currency} signed /> (<Money c={roundCents(v.delta * COUNTRY_RULES[v.country].fxToUsd)} signed /> USD)</dd>
                  </dl>
                  <p className="small" style={{ margin: "8px 0 4px" }}>{v.explanation}</p>
                  <p className="small muted" style={{ margin: 0 }}>{v.action}</p>
                </div>
              ))}
            </>
          )}
        </Section>
      </div>

      <Section title="How it posts: local currency journals and the USD view" lede="Journals post to each NetSuite subsidiary in its base currency from provider actuals. NetSuite translates to USD at consolidation; the USD column here uses the brief's reporting rates.">
        <div className="table-wrap">
          <table className="reg">
            <thead><tr><th>Journal</th><th>Account</th><th>Department</th><th className="n">Debit, local</th><th className="n">Credit, local</th><th className="n">Debit, USD</th><th className="n">Credit, USD</th><th>Memo</th></tr></thead>
            <tbody>
              {r.journal.mapped.filter((l) => l.companyId !== "NC-US" || l.journalId.startsWith("IC-")).map((l, i) => {
                const fx = l.currency === "USD" ? 1 : Object.values(COUNTRY_RULES).find((c) => c.currency === l.currency)!.fxToUsd;
                return (
                  <tr key={i}>
                    <td className="small">{l.journalId}</td>
                    <td>{l.account} <span className="faint small">{l.netsuiteAccountName}</span></td>
                    <td>{l.costCenterId}</td>
                    <td className="n">{l.debit ? <Money c={l.debit} cur={l.currency} /> : ""}</td>
                    <td className="n">{l.credit ? <Money c={l.credit} cur={l.currency} /> : ""}</td>
                    <td className="n">{l.debit ? <Money c={roundCents(l.debit * fx)} /> : ""}</td>
                    <td className="n">{l.credit ? <Money c={roundCents(l.credit * fx)} /> : ""}</td>
                    <td className="small">{l.memo}</td>
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
