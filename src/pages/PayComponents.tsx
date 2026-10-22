import { useData } from "../state.tsx";
import { Money, PageHead, Pill, Section } from "../ui.tsx";
import { PAY_COMPONENTS, type ComponentType, type PayComponent, type Taxability } from "../../lib/config/payComponents.ts";
import { PERIOD_LABEL } from "../../lib/config/period.ts";

const GROUPS: { type: ComponentType; title: string; lede: string }[] = [
  { type: "Earning", title: "Earnings", lede: "Taxability is pay component group membership (Federal Taxable Wages, FICA Wages, FUTA/SUI Wages, State Wages, 401(k) Eligible Earnings), so a new earning inherits the right taxes by joining the right groups." },
  { type: "Pre-Tax Deduction", title: "Pre-tax deductions", lede: "Each reduces only the taxable wages it is exempt from: medical (Section 125) reduces every tax; 401(k) reduces federal and state income tax, not FICA or FUTA." },
  { type: "Post-Tax Deduction", title: "Post-tax deductions", lede: "Taken after taxes. Garnishment is limited by the CCPA percentage of disposable earnings." },
  { type: "Employee Tax", title: "Employee taxes", lede: "Each tax has its own taxable wage base, built from the groups above." },
  { type: "Employer Tax", title: "Employer taxes", lede: "Expense to 6200, allocated to cost centers in proportion to each worker's wages." },
  { type: "Employer Benefit", title: "Employer benefits", lede: "Expense to 6300, allocated like employer taxes." },
];

const mark = (on?: boolean) => (on ? <span title="Yes">✓</span> : <span className="faint">–</span>);
const taxCells = (t?: Taxability) => (
  <>
    <td style={{ textAlign: "center" }}>{mark(t?.fit)}</td>
    <td style={{ textAlign: "center" }}>{mark(t?.fica)}</td>
    <td style={{ textAlign: "center" }}>{mark(t?.futaSui)}</td>
    <td style={{ textAlign: "center" }}>{mark(t?.state)}</td>
  </>
);

/** The pay component catalog: every component's feed, calculation basis, taxability, accounts and this period's amount. */
export default function PayComponents() {
  const { data } = useData();
  const r = data!.result;
  const ns = (acct: string) => data!.ds.glMapping.find((g) => g.workdayAccount === acct);
  const totals = new Map<string, { amount: number; hours: number; workers: Set<string> }>();
  for (const c of r.us)
    for (const l of c.pay.lines) {
      const t = totals.get(l.code) ?? { amount: 0, hours: 0, workers: new Set<string>() };
      t.amount += l.amount;
      t.hours += l.hours ?? 0;
      if (l.amount) t.workers.add(c.worker.id);
      totals.set(l.code, t);
    }
  const row = (p: PayComponent, deduction: boolean) => {
    const t = totals.get(p.code);
    const n = ns(p.glAccount);
    return (
      <tr key={p.code}>
        <td><strong>{p.code}</strong><div className="small">{p.name}</div>{!p.inScopeThisPeriod && <Pill>configured, not used this period</Pill>}</td>
        <td className="small">{p.feed}</td>
        <td className="small wrap" style={{ maxWidth: 420 }}>{p.basis}</td>
        {deduction ? taxCells(p.reduces) : taxCells(p.taxability)}
        <td style={{ textAlign: "center" }}>{p.type === "Earning" ? mark(p.k401Eligible) : ""}</td>
        <td className="small">{p.glAccount}{n ? <div className="faint">NetSuite {n.netsuiteAccount}</div> : null}</td>
        <td className="n">{t && t.amount ? <><Money c={t.amount} />{t.hours ? <div className="faint small">{t.hours.toFixed(2)} hrs</div> : null}<div className="faint small">{t.workers.size} worker(s)</div></> : <span className="faint small">none</span>}</td>
      </tr>
    );
  };
  return (
    <>
      <PageHead title="Pay components">The pay component catalog: {PAY_COMPONENTS.length} components, each with where its input comes from, how it is calculated, which taxes apply, and the ledger account it posts to. Amounts are for {PERIOD_LABEL[r.period.id]}; choose another period at the top.</PageHead>
      {GROUPS.map((g) => {
        const list = PAY_COMPONENTS.filter((p) => p.type === g.type);
        if (!list.length) return null;
        const deduction = g.type === "Pre-Tax Deduction";
        const taxHeads = g.type === "Earning" || deduction;
        return (
          <Section key={g.type} title={`${g.title} (${list.length})`} lede={g.lede}>
            <div className="table-wrap">
              <table className="reg">
                <thead>
                  <tr>
                    <th>Component</th><th>Fed by</th><th>Calculation basis</th>
                    {taxHeads ? <><th style={{ textAlign: "center" }}>{deduction ? "Reduces FIT" : "FIT"}</th><th style={{ textAlign: "center" }}>FICA</th><th style={{ textAlign: "center" }}>FUTA/SUI</th><th style={{ textAlign: "center" }}>State</th></> : <><th /><th /><th /><th /></>}
                    <th style={{ textAlign: "center" }}>{g.type === "Earning" ? "401(k)" : ""}</th>
                    <th>GL account</th>
                    <th className="n">This period</th>
                  </tr>
                </thead>
                <tbody>{list.map((p) => row(p, deduction))}</tbody>
              </table>
            </div>
          </Section>
        );
      })}
      <p className="small muted">Source: lib/config/payComponents.ts, the same configuration the payroll engine calculates with. Full catalog with Workday construct notes: design document section 2.</p>
    </>
  );
}
