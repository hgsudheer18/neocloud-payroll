import { useData } from "../state.tsx";
import { useErp } from "../erp.tsx";
import { setQuery } from "../router.tsx";
import { Money, PageHead, Section, Select } from "../ui.tsx";
import { useAccess } from "../access.tsx";
import { PERIOD_LABEL } from "../../lib/config/period.ts";
import { toCents } from "../../lib/util/money.ts";

/**
 * Benefit enrolments from the data package, grouped by type. Only what the
 * worker is enrolled in is listed; nothing is shown for benefits they do not have.
 * Visible to the worker and to payroll (who process the deductions).
 */
export default function Benefits({ query }: { query: URLSearchParams }) {
  const { data } = useData();
  const { me, periodId } = useErp();
  const access = useAccess();
  const ds = data!.dsNow;
  const pick = access.payResults ? query.get("worker") ?? me.workerId : me.workerId;
  const w = ds.workers.find((x) => x.id === pick);
  if (!w) return <div className="callout info">{me.name} has no worker record.</div>;
  const calc = data!.result.us.find((c) => c.worker.id === w.id);
  const amount = (code: string) => calc?.pay.lines.filter((l) => l.code === code).reduce((s, l) => s + l.amount, 0);
  const medical = w.medicalPerPeriod > 0;
  const retirement = w.k401Pct > 0;
  // Premiums are per pay period: 24 a year semi-monthly, 26 biweekly (hourly US workers from go-live).
  const perYear = w.payGroup === "US Biweekly" ? 26 : 24;
  const people = access.payResults ? ds.workers.filter((x) => x.workerType === "Employee" && !x.terminationDate) : [];

  return (
    <>
      <PageHead title="Benefits">{w.id === me.workerId ? "Your benefit enrolments. Only you and payroll can see them." : `Benefit enrolments for ${w.name}. Only they and payroll can see them.`}</PageHead>
      {access.payResults && (
        <div className="filters">
          <Select label="Worker" value={w.id} onChange={(v) => setQuery("/benefits", { worker: v })} options={people.map((p) => [p.id, `${p.id} ${p.name}`])} all={null} />
        </div>
      )}
      {!medical && !retirement ? null : (
        <div className="grid2">
          {medical && (
            <Section title="Healthcare">
              <div className="sheet">
                <h3>Medical plan</h3>
                <dl className="kv">
                  <dt>Enrolled</dt><dd>Yes</dd>
                  <dt>Your premium</dt><dd><Money c={toCents(w.medicalPerPeriod)} /> per {perYear === 26 ? "biweekly" : "semi-monthly"} pay period (<Money c={toCents(w.medicalPerPeriod * perYear)} /> a year)</dd>
                  <dt>Tax treatment</dt><dd>Pre-tax (Section 125): reduces federal, state, Social Security and Medicare taxable wages</dd>
                  {calc && amount("MED") ? <><dt>Deducted in {PERIOD_LABEL[periodId]}</dt><dd><Money c={amount("MED")!} /></dd></> : null}
                </dl>
              </div>
            </Section>
          )}
          {retirement && (
            <Section title="Retirement">
              <div className="sheet">
                <h3>401(k) pre-tax</h3>
                <dl className="kv">
                  <dt>Enrolled</dt><dd>Yes</dd>
                  <dt>Your contribution</dt><dd>{(w.k401Pct * 100).toFixed(1)}% of eligible pay</dd>
                  <dt>Tax treatment</dt><dd>Pre-tax for federal and state income tax; Social Security and Medicare still apply</dd>
                  {calc && amount("K401") ? <><dt>Deducted in {PERIOD_LABEL[periodId]}</dt><dd><Money c={amount("K401")!} /></dd></> : null}
                </dl>
              </div>
            </Section>
          )}
        </div>
      )}
    </>
  );
}
