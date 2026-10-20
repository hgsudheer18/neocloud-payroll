import { useData } from "../state.tsx";
import { setQuery } from "../router.tsx";
import { Money, PageHead, Pill, Section, Select } from "../ui.tsx";
import { ABSENCE_PLANS } from "../../lib/config/absencePlans.ts";
import type { AbsenceLine } from "../../lib/engine/absence.ts";
import { useAccess } from "../access.tsx";

const SAMPLES = ["E0001", "E0021", "E0006", "E0008", "E0009", "E0148"];

export default function Absence({ query }: { query: URLSearchParams }) {
  const { data } = useData();
  const access = useAccess();
  const pay = access.payResults;
  const r = data!.result;
  const plan = query.get("plan") ?? "";
  const lines: { line: AbsenceLine; period: string; payout?: number; currency: string }[] = [
    ...r.us.flatMap((c) =>
      c.absence.map((a) => ({ line: a, period: "Oct 1–15", currency: "USD", payout: a.payoutQty ? c.pay.lines.filter((l) => l.code === "PTO_PAYOUT").reduce((s, l) => s + l.amount, 0) : undefined })),
    ),
    ...r.intl.flatMap((c) => c.absence.map((a) => ({ line: a, period: "October", currency: c.currency, payout: a.payoutQty ? c.lines.filter((l) => l.code === "LEAVE_PAYOUT").reduce((s, l) => s + l.amount, 0) : undefined }))),
  ];
  const shown = lines.filter((l) => access.seesDetails(l.line.employeeId) && (!plan || l.line.plan.code === plan) && (l.line.tracked || l.line.taken > 0));
  const samples = SAMPLES.filter((id) => access.seesDetails(id)).flatMap((id) => lines.filter((l) => l.line.employeeId === id));

  return (
    <>
      <PageHead title="Absence balances">
        Opening balance, plus the accrual posted at the end of the period, minus approved time off, minus any termination payout, equals the ending balance. US plans run on the semi-monthly period; UK, Ontario and India plans on the October month.
      </PageHead>

      {samples.length > 0 && (
      <Section title="Sample workers from the brief" lede="Ending balances after this period, including the final accrual and payout for the terminated worker E0148.">
        <div className="table-wrap">
          <table className="reg">
            <thead>
              <tr><th>Worker</th><th>Plan</th><th className="n">Opening</th><th className="n">Accrual</th><th className="n">Taken</th><th className="n">Paid out</th><th className="n">Ending</th>{pay && <th className="n">Payout to payroll</th>}<th>How the accrual was calculated</th></tr>
            </thead>
            <tbody>
              {samples.map(({ line: a, payout, currency }) => (
                <tr key={a.employeeId + a.plan.code}>
                  <td>{a.employeeId}</td>
                  <td>{a.plan.name}</td>
                  <td className="n">{a.tracked ? a.opening.toFixed(2) : "unlimited"}</td>
                  <td className="n">{a.accrual.toFixed(2)}</td>
                  <td className="n">{a.taken.toFixed(2)}</td>
                  <td className="n">{a.payoutQty.toFixed(2)}</td>
                  <td className="n"><strong>{a.tracked ? `${a.ending.toFixed(2)} ${a.unit}` : "n/a"}</strong></td>
                  {pay && <td className="n">{payout !== undefined ? <Money c={payout} cur={currency} /> : <span className="zero">none</span>}</td>}
                  <td className="wrap small">{a.accrualExplain}{a.flags.map((f) => <div key={f} className="pos-var">{f}</div>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      )}

      <Section title="Plan configuration">
        <div className="table-wrap">
          <table className="reg">
            <thead>
              <tr><th>Plan</th><th>Eligibility</th><th>Accrual</th><th>Waiting period</th><th>Carryover and caps</th><th>Payout on termination</th><th>Hire, leave and termination</th></tr>
            </thead>
            <tbody>
              {ABSENCE_PLANS.map((p) => (
                <tr key={p.code}>
                  <td><strong>{p.name}</strong><div className="faint small">{p.code}, {p.unit}</div></td>
                  <td className="small">{p.eligibility}</td>
                  <td className="small">{p.accrualFrequency}</td>
                  <td className="small">{p.waitingPeriodDays ? `${p.waitingPeriodDays} days to use` : "None"}</td>
                  <td className="small">{p.carryover}{p.balanceCap ? ` Cap ${p.balanceCap} ${p.unit}.` : ""}</td>
                  <td className="small">{p.payoutOnTermination ? <Pill tone="ok">Paid</Pill> : <Pill>Not paid</Pill>} {p.payoutBasis}</td>
                  <td className="small wrap">On hire: {p.onHire} On leave: {p.onLeave} On termination: {p.onTermination}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="All balances" right={<Select label="" value={plan} onChange={(v) => setQuery("/absence", { plan: v })} options={ABSENCE_PLANS.map((p) => [p.code, p.name])} all="All plans" />}>
        <div className="table-wrap" style={{ maxHeight: "60vh" }}>
          <table className="reg">
            <thead>
              <tr><th>Worker</th><th>Plan</th><th>Period</th><th className="n">Opening</th><th className="n">Accrual</th><th className="n">Taken</th><th className="n">Paid out</th><th className="n">Ending</th><th>Flags</th></tr>
            </thead>
            <tbody>
              {shown.map(({ line: a, period }) => (
                <tr key={a.employeeId + a.plan.code}>
                  <td>{pay ? <a href={a.unit === "hours" ? `#/register/${a.employeeId}` : "#/international"}>{a.employeeId}</a> : <a href={`#/workers/${a.employeeId}`}>{a.employeeId}</a>}</td>
                  <td>{a.plan.name}</td>
                  <td>{period}</td>
                  <td className="n">{a.tracked ? a.opening.toFixed(2) : "—"}</td>
                  <td className="n">{a.accrual.toFixed(2)}</td>
                  <td className="n">{a.taken.toFixed(2)}</td>
                  <td className="n">{a.payoutQty.toFixed(2)}</td>
                  <td className="n">{a.tracked ? a.ending.toFixed(2) : "—"} <span className="faint small">{a.unit}</span></td>
                  <td className="small">{a.flags.map((f) => <div key={f}>{f}</div>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">Exempt US workers on Flexible PTO appear only when they took time off in the period; their salary is unaffected.</p>
      </Section>
    </>
  );
}
