import { useData } from "../state.tsx";
import { setQuery } from "../router.tsx";
import { Money, PageHead, Pill, Section, Select, downloadText } from "../ui.tsx";
import { netsuiteCsv } from "../../lib/engine/gl.ts";
import { toDecimalString } from "../../lib/util/money.ts";

export default function Ledger({ query }: { query: URLSearchParams }) {
  const { data } = useData();
  const r = data!.result;
  const ds = data!.ds;
  const tab = query.get("tab") ?? "journal";
  const jid = query.get("j") ?? r.journal.totals[0]?.journalId ?? "";
  const set = (k: string, v: string) => setQuery("/gl", { tab, j: jid, [k]: v });
  const lines = r.journal.mapped.filter((l) => !jid || l.journalId === jid);
  const errors = r.journal.issues.filter((i) => i.severity === "Error");
  const acctName = (a: string) => ds.glMapping.find((g) => g.workdayAccount === a)?.workdayAccountName ?? "Unmapped";
  // Accounting date = end of the period worked, so expense lands in the right month.
  const dateFor = (journalId: string) => (journalId.includes(r.period.id) ? r.period.end : r.intlPeriod.end);

  const exportCsv = () => downloadText(`netsuite-journal-${r.period.id}.csv`, netsuiteCsv(r.journal.mapped, dateFor));
  const exportJson = () =>
    downloadText(
      `netsuite-journal-${r.period.id}.json`,
      JSON.stringify(
        r.journal.totals.map((t) => ({
          externalId: t.journalId,
          subsidiary: ds.companies.find((c) => c.id === t.companyId)?.netsuiteSubsidiaryId,
          currency: t.currency,
          tranDate: dateFor(t.journalId),
          memo: `Workday payroll ${t.journalId}`,
          lines: r.journal.mapped.filter((l) => l.journalId === t.journalId).map((l) => ({ account: l.netsuiteAccount, debit: l.debit ? toDecimalString(l.debit) : undefined, credit: l.credit ? toDecimalString(l.credit) : undefined, department: l.netsuiteDepartment || undefined, class: l.netsuiteClass || undefined, location: l.netsuiteLocation || undefined, memo: l.memo || undefined })),
        })),
        null,
        2,
      ),
      "application/json",
    );

  return (
    <>
      <PageHead title="General ledger">
        Payroll results summarized by account, cost center and location, mapped to NetSuite accounts and segments. Each journal must balance and every line must map before the export is released.
      </PageHead>
      <div className="tabs" role="tablist">
        {[["journal", "Journals"], ["accounts", "Account mapping"], ["segments", "Segment mapping"]].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => set("tab", k)}>{l}</button>
        ))}
      </div>

      {tab === "journal" && (
        <>
          <div className="table-wrap">
            <table className="reg">
              <thead><tr><th>Journal</th><th>Subsidiary</th><th>Currency</th><th className="n">Lines</th><th className="n">Debits</th><th className="n">Credits</th><th>Status</th></tr></thead>
              <tbody>
                {r.journal.totals.map((t) => {
                  const iss = r.journal.issues.filter((i) => i.journalId === t.journalId && i.severity === "Error");
                  return (
                    <tr key={t.journalId} className={`click ${jid === t.journalId ? "sel" : ""}`} onClick={() => set("j", t.journalId)}>
                      <td>{t.journalId}</td>
                      <td>{ds.companies.find((c) => c.id === t.companyId)?.netsuiteSubsidiaryName}</td>
                      <td>{t.currency}</td>
                      <td className="n">{t.lines}</td>
                      <td className="n"><Money c={t.debit} cur={t.currency} /></td>
                      <td className="n"><Money c={t.credit} cur={t.currency} /></td>
                      <td>{iss.length ? <Pill tone="bad">{iss.length} errors</Pill> : t.debit === t.credit ? <Pill tone="ok">Balanced, all lines mapped</Pill> : <Pill tone="bad">Out of balance</Pill>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Section title="Export to NetSuite" lede={errors.length ? `${errors.length} validation errors must be fixed in the mapping before export.` : "All journals balance and every account, department, class, location and subsidiary is mapped."}>
            {r.journal.issues.length > 0 && (
              <div className="table-wrap" style={{ marginBottom: 12 }}>
                <table className="reg">
                  <tbody>
                    {r.journal.issues.map((i, k) => (
                      <tr key={k}><td><Pill tone={i.severity === "Error" ? "bad" : "warn"}>{i.severity}</Pill></td><td>{i.journalId}{i.line ? ` line ${i.line}` : ""}</td><td>{i.message}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="row">
              <button className="btn" disabled={errors.length > 0} onClick={exportCsv}>Download NetSuite CSV import</button>
              <button className="btn ghost" disabled={errors.length > 0} onClick={exportJson}>Download JSON (REST record format)</button>
              <span className="small muted">External IDs make re-imports idempotent: NetSuite rejects a second journal with the same ID.</span>
            </div>
          </Section>

          <Section title={`Lines: ${jid}`} right={<Select label="" value={jid} onChange={(v) => set("j", v)} options={r.journal.totals.map((t) => t.journalId)} all={null} />}>
            <div className="table-wrap" style={{ maxHeight: "60vh" }}>
              <table className="reg">
                <thead>
                  <tr><th>Workday account</th><th>NetSuite account</th><th>Department</th><th>Class</th><th>Location</th><th className="n">Debit</th><th className="n">Credit</th><th>Memo</th></tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td>{l.account} {acctName(l.account)}</td>
                      <td>{l.netsuiteAccount}</td>
                      <td>{l.costCenterId ? `${l.netsuiteDepartment} (${l.costCenterId})` : <span className="faint">company level</span>}</td>
                      <td className="small">{l.netsuiteClass}</td>
                      <td>{l.netsuiteLocation ? `${l.netsuiteLocation} (${l.locationId})` : ""}</td>
                      <td className="n">{l.debit ? <Money c={l.debit} cur={l.currency} /> : ""}</td>
                      <td className="n">{l.credit ? <Money c={l.credit} cur={l.currency} /> : ""}</td>
                      <td className="small">{l.memo}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5}>{lines.length} lines</td>
                    <td className="n"><Money c={lines.reduce((s, l) => s + l.debit, 0)} cur={lines[0]?.currency} /></td>
                    <td className="n"><Money c={lines.reduce((s, l) => s + l.credit, 0)} cur={lines[0]?.currency} /></td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </Section>
        </>
      )}

      {tab === "accounts" && (
        <Section lede="Owned by the Controller (expense) and the Payroll Manager (liabilities). Changes go through a ticket, are approved by the Controller and tested in the sandbox before the next payroll; the mapping file is under version control so every change has an author and a date.">
          <div className="table-wrap">
            <table className="reg">
              <thead><tr><th>Workday ledger account</th><th>Type</th><th>NetSuite account</th><th>Owner</th><th>Fed by</th></tr></thead>
              <tbody>
                {ds.glMapping.map((g) => (
                  <tr key={g.workdayAccount}>
                    <td>{g.workdayAccount} {g.workdayAccountName}</td>
                    <td>{g.type}</td>
                    <td>{g.netsuiteAccount} {g.netsuiteAccountName}</td>
                    <td>{g.owner}</td>
                    <td className="small">{FED_BY[g.workdayAccount] ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {tab === "segments" && (
        <div className="grid2">
          <Section title="Cost center → department and class" lede="The cost center defaults from the worker's supervisory org. Class carries the functional P&L line used in the S-1 (cost of revenue, R&D, S&M, G&A).">
            <div className="table-wrap">
              <table className="reg">
                <thead><tr><th>Cost center</th><th>Supervisory org</th><th>Owning company</th><th>Department</th><th>Class</th></tr></thead>
                <tbody>
                  {ds.costCenters.map((c) => (
                    <tr key={c.id}><td>{c.id} {c.name}</td><td className="small">{c.supervisoryOrg}</td><td>{c.companyId}</td><td>{c.netsuiteDepartmentId}</td><td className="small">{c.netsuiteClass}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          <Section title="Company → subsidiary, location → location">
            <div className="table-wrap" style={{ marginBottom: 16 }}>
              <table className="reg">
                <thead><tr><th>Workday company</th><th>Currency</th><th>NetSuite subsidiary</th></tr></thead>
                <tbody>{ds.companies.map((c) => <tr key={c.id}><td>{c.id} {c.name}</td><td>{c.currency}</td><td>{c.netsuiteSubsidiaryId} {c.netsuiteSubsidiaryName}</td></tr>)}</tbody>
              </table>
            </div>
            <div className="table-wrap">
              <table className="reg">
                <thead><tr><th>Workday location</th><th>Company</th><th>NetSuite location</th></tr></thead>
                <tbody>{ds.locations.map((l) => <tr key={l.id}><td>{l.id} {l.name}</td><td>{l.companyId}</td><td>{l.netsuiteLocationId}</td></tr>)}</tbody>
              </table>
            </div>
          </Section>
        </div>
      )}
    </>
  );
}

const FED_BY: Record<string, string> = {
  "6100": "SAL, REG, RETRO, VAC, SICK; international gross",
  "6110": "OT, DT, OT_ADJ",
  "6120": "SHIFT, MEAL",
  "6130": "BONUS",
  "6200": "SS_ER, MED_ER, FUTA, SUI; international employer statutory",
  "6300": "BEN_LOAD",
  "6400": "Intercompany recharge received (owning entity)",
  "6900": "Intercompany recharge out (employing entity)",
  "1300": "Intercompany receivable (employing entity)",
  "2100": "Net pay; cleared by the bank funding entry",
  "2110": "FIT",
  "2111": "SS_EE, MED_EE, SS_ER, MED_ER",
  "2112": "FUTA",
  "2113": "SUI",
  "2114": "SIT (memo carries state)",
  "2115": "CA SDI, NY PFL, WA Cares",
  "2116": "International employer statutory",
  "2117": "International employee withholdings",
  "2120": "K401",
  "2121": "MED",
  "2122": "GARN",
  "2130": "BEN_LOAD (employer benefits accrued)",
  "2150": "PTO_PAYOUT relieves accrued vacation",
  "2300": "Intercompany payable (owning entity)",
};
