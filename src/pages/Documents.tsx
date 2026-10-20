import { useData } from "../state.tsx";
import { useErp } from "../erp.tsx";
import { setQuery } from "../router.tsx";
import { PageHead, Pill, Section } from "../ui.tsx";
import { OPEN_POSITIONS } from "../../lib/config/org.ts";
import { PERIOD_LABEL, US_PERIOD, US_PERIODS } from "../../lib/config/period.ts";
import { pretty } from "../../lib/util/dates.ts";

const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
const PrintButton = () => <button className="btn no-print" onClick={() => window.print()}>Download PDF</button>;

/** Your documents: pay slips, offer letter and tax forms, each printable or saved as PDF. */
export default function Documents({ query }: { query: URLSearchParams }) {
  const { data } = useData();
  const { erp, me, setPeriod } = useErp();
  const ds = data!.dsNow;
  const w = ds.workers.find((x) => x.id === me.workerId);
  if (!w) return <div className="callout info">{me.name} has no worker record.</div>;
  const doc = query.get("doc") ?? "";
  const company = ds.companies.find((c) => c.id === w.companyId)?.name ?? "NeoCloud Inc.";
  const manager = ds.workers.find((m) => m.id === w.managerId)?.name ?? OPEN_POSITIONS.find((p) => p.id === w.managerId)?.title ?? "your manager";
  const loc = ds.locations.find((l) => l.id === w.locationId)?.name ?? w.locationId;
  const firstComp = ds.events.filter((e) => e.employeeId === w.id && (e.field === "annualSalary" || e.field === "hourlyRate")).sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : 1))[0];
  const startPay = firstComp ? Number(firstComp.oldValue) : w.payType === "Hourly" ? w.hourlyRate : w.annualSalary;
  const back = <p className="no-print"><a href="#/documents">All documents</a></p>;

  if (doc === "offer") {
    return (
      <>
        {back}
        <div className="letter">
          <p className="muted">{company}</p>
          <h2>Offer of employment</h2>
          <p>Dear {w.name},</p>
          <p>We are pleased to offer you the position of <strong>{w.jobProfile}</strong> in {w.department}, reporting to {manager}, based at {loc}. Your start date is <strong>{longDate(w.hireDate)}</strong>.</p>
          <p>Your starting pay is <strong>{w.payType === "Hourly" ? `$${startPay.toFixed(2)} per hour` : `${startPay.toLocaleString("en-US")} ${w.currency} per year`}</strong>, paid {w.country === "USA" ? (w.payType === "Hourly" ? "every two weeks" : "twice a month") : "monthly"}. This position is classified as {w.flsa === "N/A" ? "not subject to FLSA" : w.flsa.toLowerCase()}.</p>
          <p>You will be eligible for the benefits and time off plans that apply to your role and location, as described in the employee handbook.</p>
          <p>Sincerely,<br />People team, {company}</p>
          <p className="small muted">Employee {w.id}. Generated from your worker record.</p>
        </div>
        <div className="row" style={{ marginTop: 12 }}><PrintButton /></div>
      </>
    );
  }
  if (doc === "w4") {
    const last = erp.bps.filter((b) => b.type === "Change Tax Withholding" && b.subjectId === w.id && b.status === "Approved").at(-1);
    return (
      <>
        {back}
        <div className="letter">
          <p className="muted">{company}</p>
          <h2>Form W-4 on file: Employee's Withholding Certificate</h2>
          <dl className="kv">
            <dt>Employee</dt><dd>{w.name} ({w.id})</dd>
            <dt>Filing status</dt><dd>{w.filingStatus === "MFJ" ? "Married filing jointly" : "Single or married filing separately"}</dd>
            <dt>Effective</dt><dd>{last ? `Changed ${new Date(last.decidedAt!).toLocaleDateString()} (${last.id})` : "From the record converted at go-live"}</dd>
          </dl>
          <p className="small muted">Summary of the withholding election used by payroll. Change it under My Information.</p>
        </div>
        <div className="row" style={{ marginTop: 12 }}><PrintButton /></div>
      </>
    );
  }

  const us = w.country === "USA";
  const hourly = w.payType === "Hourly";
  const periods = us ? US_PERIODS.filter((p) => p.id === US_PERIOD.id || (hourly ? p.payGroup === "US Biweekly" : p.payGroup === "US Semi-Monthly")) : [];
  const openPayslip = (id: string) => {
    setPeriod(id);
    window.location.hash = "/payslip";
  };
  return (
    <>
      <PageHead title="Documents">Your pay slips, offer letter and tax forms. Open one and use Download PDF to save or print it.</PageHead>
      <div className="grid2">
        <Section title="Pay slips">
          {!us ? <p className="small muted">Pay slips are issued by the in-country payroll provider.</p> : (
            <div className="table-wrap">
              <table className="reg">
                <thead><tr><th>Pay period</th><th>Paid</th><th>Pay run</th><th /></tr></thead>
                <tbody>
                  {periods.map((p) => {
                    const status = erp.payRuns[p.id]?.status ?? "Not started";
                    return (
                      <tr key={p.id}>
                        <td>{PERIOD_LABEL[p.id]}</td>
                        <td>{pretty(p.checkDate)}</td>
                        <td>{status === "Completed" ? <Pill tone="ok">Final</Pill> : <Pill>Preview</Pill>}</td>
                        <td><button className="close" style={{ marginLeft: 0 }} onClick={() => openPayslip(p.id)}>Open</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
        <Section title="Employment and tax">
          <div className="table-wrap">
            <table className="reg">
              <tbody>
                <tr><td>Offer letter</td><td className="small muted">{longDate(w.hireDate)}</td><td><button className="close" style={{ marginLeft: 0 }} onClick={() => setQuery("/documents", { doc: "offer" })}>Open</button></td></tr>
                {us && <tr><td>Form W-4 on file</td><td className="small muted">{w.filingStatus === "MFJ" ? "Married filing jointly" : "Single"}</td><td><button className="close" style={{ marginLeft: 0 }} onClick={() => setQuery("/documents", { doc: "w4" })}>Open</button></td></tr>}
                {us && <tr><td>2026 Form W-2</td><td className="small muted">Issued by Jan 31, 2027</td><td /></tr>}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </>
  );
}
