import { useState } from "react";
import { useData } from "../state.tsx";
import { useErp } from "../erp.tsx";
import { setQuery } from "../router.tsx";
import { PageHead, Pill, Section } from "../ui.tsx";
import { CanInitiate, Field, FormGrid, Toast } from "../erpui.tsx";
import { jobProfiles } from "../../lib/erp/apply.ts";
import { PERIOD_LABEL, US_PERIODS, INTL_PERIOD } from "../../lib/config/period.ts";
import { asOf, STATES } from "../../lib/config/usTax.ts";
import { pretty } from "../../lib/util/dates.ts";
import type { BPType } from "../../lib/erp/types.ts";

const COUNTRIES: [string, string, string][] = [["USA", "United States", "USD"], ["CAN", "Canada", "CAD"], ["GBR", "United Kingdom", "GBP"], ["IND", "India", "INR"]];
const CLASSES = ["Cost of Revenue", "Research & Development", "Sales & Marketing", "General & Administrative"];
const SUPPORTED_STATES = Object.keys(asOf(STATES, "2026-10-01"));

export default function Setup({ query }: { query: URLSearchParams }) {
  const tab = query.get("tab") ?? "orgs";
  const tabs: [string, string][] = [["orgs", "Supervisory orgs and cost centers"], ["locations", "Locations"], ["companies", "Companies"], ["jobs", "Job profiles"], ["paygroups", "Pay groups and calendars"]];
  return (
    <>
      <PageHead title="Organization setup">
        The structure everything else hangs off: companies (legal entities), locations, supervisory orgs with their default cost centers, job profiles and pay groups. New objects are configuration: HR Partners create them without an approval step, and each one is logged.
      </PageHead>
      <div className="tabs" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setQuery("/setup", { tab: k })}>{l}</button>)}
      </div>
      {tab === "orgs" && <Orgs />}
      {tab === "locations" && <Locations />}
      {tab === "companies" && <Companies />}
      {tab === "jobs" && <Jobs />}
      {tab === "paygroups" && <PayGroups />}
    </>
  );
}

function useCreate(type: BPType) {
  const { submit } = useErp();
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "bad" }>({ text: "", tone: "ok" });
  const create = (id: string, name: string, payload: Record<string, unknown>, errors: string[]) => {
    if (errors.length) return setMsg({ text: errors.join(" "), tone: "bad" });
    const bp = submit({ type, subjectId: id, subjectName: name, summary: `${type}: ${id} ${name}`, effectiveDate: new Date().toISOString().slice(0, 10), payload });
    setMsg({ text: `${bp.id}: created ${id} ${name}.`, tone: "ok" });
  };
  return { msg, create };
}

function Orgs() {
  const { data } = useData();
  const ds = data!.dsNow;
  const { msg, create } = useCreate("Create Cost Center");
  const [f, setF] = useState({ id: "", name: "", department: "", supervisoryOrg: "", companyId: "NC-US", netsuiteDepartmentId: "", netsuiteClass: CLASSES[2] });
  const headcount = (cc: string) => ds.workers.filter((w) => w.costCenterId === cc && w.workerType === "Employee" && !w.terminationDate).length;
  const submitIt = () => {
    const errors: string[] = [];
    if (!/^CC\d{4}$/.test(f.id)) errors.push("Cost center ID must look like CC5100.");
    if (ds.costCenters.some((c) => c.id === f.id)) errors.push(`${f.id} already exists.`);
    if (!f.name || !f.department || !f.supervisoryOrg) errors.push("Enter name, department and supervisory org.");
    create(f.id, f.name, { ...f }, errors);
  };
  return (
    <>
      <div className="table-wrap">
        <table className="reg">
          <thead><tr><th>Supervisory org</th><th>Default cost center</th><th>Department</th><th>Company</th><th>NetSuite department</th><th>Class</th><th className="n">Headcount</th></tr></thead>
          <tbody>
            {ds.costCenters.map((c) => (
              <tr key={c.id}>
                <td>{c.supervisoryOrg}</td>
                <td>{c.id} {c.name}</td>
                <td>{c.department}</td>
                <td>{c.companyId}</td>
                <td>{c.netsuiteDepartmentId || <Pill tone="bad">unmapped</Pill>}</td>
                <td className="small">{c.netsuiteClass}</td>
                <td className="n">{headcount(c.id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Section title="Create a supervisory org and cost center" lede="Hires into this org default to its cost center. Leave the NetSuite department blank to see the GL validation block the journal export until Finance maps it.">
        <CanInitiate type="Create Cost Center">
          <div className="sheet">
            <FormGrid>
              <Field label="Cost center ID"><input type="text" placeholder="CC3500" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value.toUpperCase() })} /></Field>
              <Field label="Cost center name"><input type="text" placeholder="Engineering - AI Research" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <Field label="Department"><select value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}><option value="">Choose…</option>{["GPU Cloud", "On-Prem", "Engineering", "G&A"].map((d) => <option key={d}>{d}</option>)}</select></Field>
              <Field label="Supervisory org (manager)"><input type="text" placeholder="AI Research (E0007)" value={f.supervisoryOrg} onChange={(e) => setF({ ...f, supervisoryOrg: e.target.value })} /></Field>
              <Field label="Owning company"><select value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>{ds.companies.map((c) => <option key={c.id} value={c.id}>{c.id} {c.name}</option>)}</select></Field>
              <Field label="NetSuite department ID" hint="Finance owns this mapping"><input type="text" value={f.netsuiteDepartmentId} onChange={(e) => setF({ ...f, netsuiteDepartmentId: e.target.value })} /></Field>
              <Field label="Functional class (P&L line)"><select value={f.netsuiteClass} onChange={(e) => setF({ ...f, netsuiteClass: e.target.value })}>{CLASSES.map((c) => <option key={c}>{c}</option>)}</select></Field>
            </FormGrid>
            <Toast text={msg.text} tone={msg.tone} />
            <button className="btn" style={{ marginTop: 12 }} onClick={submitIt}>Create cost center</button>
          </div>
        </CanInitiate>
      </Section>
    </>
  );
}

function Locations() {
  const { data } = useData();
  const ds = data!.dsNow;
  const { msg, create } = useCreate("Create Location");
  const [f, setF] = useState({ id: "", name: "", companyId: "NC-US", state: "", netsuiteLocationId: "" });
  const submitIt = () => {
    const co = ds.companies.find((c) => c.id === f.companyId);
    const errors: string[] = [];
    if (!/^[A-Z0-9-]{2,12}$/.test(f.id)) errors.push("Location ID: 2–12 capital letters, numbers or dashes (e.g. SEA).");
    if (ds.locations.some((l) => l.id === f.id)) errors.push(`${f.id} already exists.`);
    if (!f.name) errors.push("Enter a name.");
    if (co?.country === "USA" && f.state && !SUPPORTED_STATES.includes(f.state)) errors.push(`No payroll tax setup for ${f.state}. Supported: ${SUPPORTED_STATES.join(", ")}.`);
    create(f.id, f.name, { id: f.id, name: f.name, country: co?.country, state: f.state, companyId: f.companyId, netsuiteLocationId: f.netsuiteLocationId }, errors);
  };
  return (
    <>
      <div className="table-wrap">
        <table className="reg">
          <thead><tr><th>Location</th><th>Country</th><th>State or province</th><th>Company</th><th>NetSuite location</th><th className="n">Workers</th></tr></thead>
          <tbody>{ds.locations.map((l) => <tr key={l.id}><td>{l.id} {l.name}</td><td>{l.country}</td><td>{l.state || "Any (remote)"}</td><td>{l.companyId}</td><td>{l.netsuiteLocationId || <Pill tone="bad">unmapped</Pill>}</td><td className="n">{ds.workers.filter((w) => w.locationId === l.id && !w.terminationDate).length}</td></tr>)}</tbody>
        </table>
      </div>
      <Section title="Create a location">
        <CanInitiate type="Create Location">
          <div className="sheet">
            <FormGrid>
              <Field label="Location ID"><input type="text" placeholder="SEA" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value.toUpperCase() })} /></Field>
              <Field label="Name"><input type="text" placeholder="Seattle Office" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <Field label="Company"><select value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>{ds.companies.map((c) => <option key={c.id} value={c.id}>{c.id} {c.name}</option>)}</select></Field>
              {ds.companies.find((c) => c.id === f.companyId)?.country === "USA" && (
                <Field label="State" hint="Blank = remote, state chosen per worker"><select value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}><option value="">Remote (any)</option>{SUPPORTED_STATES.map((s) => <option key={s}>{s}</option>)}</select></Field>
              )}
              <Field label="NetSuite location ID"><input type="text" value={f.netsuiteLocationId} onChange={(e) => setF({ ...f, netsuiteLocationId: e.target.value })} /></Field>
            </FormGrid>
            <Toast text={msg.text} tone={msg.tone} />
            <button className="btn" style={{ marginTop: 12 }} onClick={submitIt}>Create location</button>
          </div>
        </CanInitiate>
      </Section>
    </>
  );
}

function Companies() {
  const { data } = useData();
  const ds = data!.dsNow;
  const { msg, create } = useCreate("Create Company");
  const [f, setF] = useState({ id: "", name: "", country: "USA", netsuiteSubsidiaryId: "" });
  const submitIt = () => {
    const errors: string[] = [];
    if (!/^[A-Z0-9-]{3,10}$/.test(f.id)) errors.push("Company ID: 3–10 capital letters, numbers or dashes (e.g. NC-US2).");
    if (ds.companies.some((c) => c.id === f.id)) errors.push(`${f.id} already exists.`);
    if (!f.name) errors.push("Enter the legal name.");
    const cur = COUNTRIES.find((c) => c[0] === f.country)![2];
    create(f.id, f.name, { id: f.id, name: f.name, country: f.country, currency: cur, netsuiteSubsidiaryId: f.netsuiteSubsidiaryId, netsuiteSubsidiaryName: f.name }, errors);
  };
  return (
    <>
      <div className="table-wrap">
        <table className="reg">
          <thead><tr><th>Company</th><th>Country</th><th>Currency</th><th>NetSuite subsidiary</th><th className="n">Employees</th></tr></thead>
          <tbody>{ds.companies.map((c) => <tr key={c.id}><td>{c.id} {c.name}</td><td>{c.country}</td><td>{c.currency}</td><td>{c.netsuiteSubsidiaryId ? `${c.netsuiteSubsidiaryId} ${c.netsuiteSubsidiaryName}` : <Pill tone="bad">unmapped</Pill>}</td><td className="n">{ds.workers.filter((w) => w.companyId === c.id && w.workerType === "Employee" && !w.terminationDate).length}</td></tr>)}</tbody>
        </table>
      </div>
      <Section title="Create a company" lede="A legal entity. Payroll is supported in the four countries NeoCloud operates in today; a new country (for example Mexico) needs a country pack: pay group, absence plans and statutory rules, added as configuration.">
        <CanInitiate type="Create Company">
          <div className="sheet">
            <FormGrid>
              <Field label="Company ID"><input type="text" placeholder="NC-US2" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value.toUpperCase() })} /></Field>
              <Field label="Legal name"><input type="text" placeholder="NeoCloud Data Centers LLC" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <Field label="Country"><select value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>{COUNTRIES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Field>
              <Field label="NetSuite subsidiary ID"><input type="text" value={f.netsuiteSubsidiaryId} onChange={(e) => setF({ ...f, netsuiteSubsidiaryId: e.target.value })} /></Field>
            </FormGrid>
            <Toast text={msg.text} tone={msg.tone} />
            <button className="btn" style={{ marginTop: 12 }} onClick={submitIt}>Create company</button>
          </div>
        </CanInitiate>
      </Section>
    </>
  );
}

function Jobs() {
  const { data } = useData();
  const { erp } = useErp();
  const jps = jobProfiles(data!.base, erp.bps);
  const { msg, create } = useCreate("Create Job Profile");
  const [f, setF] = useState({ name: "", family: "", level: "", flsa: "Exempt", payType: "Salary" });
  const submitIt = () => {
    const errors: string[] = [];
    if (!f.name || !f.family) errors.push("Enter the job profile name and job family.");
    if (jps.some((j) => j.name === f.name)) errors.push("A job profile with that name already exists.");
    if (f.flsa === "Exempt" && f.payType === "Hourly") errors.push("Exempt job profiles are salaried.");
    create(`JP-${f.name}`, f.name, { id: `JP-${Date.now()}`, ...f }, errors);
  };
  return (
    <>
      <div className="table-wrap" style={{ maxHeight: 420 }}>
        <table className="reg">
          <thead><tr><th>Job profile</th><th>Job family</th><th>Level</th><th>FLSA</th><th>Pay type</th></tr></thead>
          <tbody>{jps.map((j) => <tr key={j.name}><td>{j.name}</td><td>{j.family}</td><td>{j.level}</td><td>{j.flsa}</td><td>{j.payType}</td></tr>)}</tbody>
        </table>
      </div>
      <Section title="Create a job profile" lede="FLSA status lives on the job profile, so every hire into it gets the right overtime eligibility, time tracking and pay group.">
        <CanInitiate type="Create Job Profile">
          <div className="sheet">
            <FormGrid>
              <Field label="Name"><input type="text" placeholder="Senior Data Center Technician" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <Field label="Job family"><input type="text" placeholder="Data Center Operations" value={f.family} onChange={(e) => setF({ ...f, family: e.target.value })} /></Field>
              <Field label="Level"><input type="text" placeholder="T3" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} /></Field>
              <Field label="FLSA status"><select value={f.flsa} onChange={(e) => setF({ ...f, flsa: e.target.value, payType: e.target.value === "Exempt" ? "Salary" : f.payType })}><option>Exempt</option><option>Non-Exempt</option><option value="N/A">N/A (international)</option></select></Field>
              <Field label="Pay type"><select value={f.payType} onChange={(e) => setF({ ...f, payType: e.target.value })}><option>Salary</option><option>Hourly</option></select></Field>
            </FormGrid>
            <Toast text={msg.text} tone={msg.tone} />
            <button className="btn" style={{ marginTop: 12 }} onClick={submitIt}>Create job profile</button>
          </div>
        </CanInitiate>
      </Section>
    </>
  );
}

function PayGroups() {
  const { data } = useData();
  const ds = data!.dsNow;
  const count = (pg: string) => ds.workers.filter((w) => w.payGroup === pg && !w.terminationDate).length;
  return (
    <>
      <div className="table-wrap">
        <table className="reg">
          <thead><tr><th>Pay group</th><th>Who</th><th>Frequency</th><th>Calendar</th><th className="n">Workers</th></tr></thead>
          <tbody>
            <tr><td>US Semi-Monthly</td><td>US salaried (exempt) employees; everyone in the Oct 1–15 parallel run</td><td>24 per year</td><td className="small">1st–15th and 16th–month end; paid period end + 5 days</td><td className="n">{count("US Semi-Monthly")}</td></tr>
            <tr><td>US Biweekly</td><td>US hourly (non-exempt) employees from go-live</td><td>26 per year</td><td className="small">Two Sunday–Saturday workweeks; paid the following Friday. Overtime weeks never split.</td><td className="n">{count("US Biweekly")}</td></tr>
            <tr><td>UK Monthly</td><td>UK employees, paid by provider</td><td>12</td><td className="small">Calendar month; change cutoff the 20th; paid the 28th</td><td className="n">{count("UK Monthly")}</td></tr>
            <tr><td>Canada Monthly</td><td>Canada employees, paid by provider</td><td>12</td><td className="small">Same calendar</td><td className="n">{count("Canada Monthly")}</td></tr>
            <tr><td>India Monthly</td><td>India employees, paid by provider</td><td>12</td><td className="small">Same calendar</td><td className="n">{count("India Monthly")}</td></tr>
          </tbody>
        </table>
      </div>
      <Section title="Pay periods in this app">
        <div className="table-wrap">
          <table className="reg">
            <thead><tr><th>Period</th><th>Pay group</th><th>Dates</th><th>Check date</th></tr></thead>
            <tbody>
              {US_PERIODS.map((p) => <tr key={p.id}><td>{PERIOD_LABEL[p.id]}</td><td>{p.payGroup}</td><td>{pretty(p.start)} to {pretty(p.end)}</td><td>{pretty(p.checkDate)}</td></tr>)}
              <tr><td>October international</td><td>UK, Canada, India Monthly</td><td>{pretty(INTL_PERIOD.start)} to {pretty(INTL_PERIOD.end)}</td><td>{pretty(INTL_PERIOD.payDate)}</td></tr>
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
