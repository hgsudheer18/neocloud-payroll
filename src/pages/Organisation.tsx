import { useMemo, type ReactNode } from "react";
import { useData } from "../state.tsx";
import { useErp } from "../erp.tsx";
import { setQuery } from "../router.tsx";
import { Money, PageHead, Pill, Section } from "../ui.tsx";
import { today } from "../erpui.tsx";
import { chainTo, directReports, headcountUnder, OPEN_POSITIONS, orgNodes, orgPath, ORGS, type OrgNode } from "../../lib/config/org.ts";
import { buildTimeline } from "../../lib/engine/timeline.ts";
import { INTL_PERIOD, PERIOD_LABEL, US_PERIOD, US_PERIODS } from "../../lib/config/period.ts";
import { pretty } from "../../lib/util/dates.ts";
import { toCents } from "../../lib/util/money.ts";
import type { Dataset } from "../../lib/data/types.ts";

const TABS: [string, string][] = [["org", "Organisation"], ["comp", "Compensation"], ["paygroup", "Pay group"], ["job", "Job profile"]];

function useNodes(ds: Dataset) {
  return useMemo(() => orgNodes(ds.workers), [ds]);
}

function Person({ n, me }: { n: OrgNode; me?: string }) {
  if (n.vacant) return <span><Pill tone="warn">Open position</Pill> {n.title}</span>;
  return (
    <span>
      <a href={`#/workers/${n.id}`}>{n.name}</a>{n.id === me && <strong> (you)</strong>} <span className="muted small">{n.title}, {n.id}</span>
      {ORGS[n.id] && <span className="small"> · leads {ORGS[n.id]}</span>}
    </span>
  );
}

/** Management chain from the CEO down to a worker, as a tree; optionally with their direct reports. */
export function OrgChain({ id, withReports = false }: { id: string; withReports?: boolean }) {
  const { data } = useData();
  const { me } = useErp();
  const nodes = useNodes(data!.dsNow);
  const chain = chainTo(nodes, id);
  const reports = withReports ? directReports(nodes, id) : [];
  const render = (i: number): ReactNode => {
    if (i >= chain.length) return null;
    const n = chain[i];
    const last = i === chain.length - 1;
    return (
      <li>
        <Person n={n} me={me.workerId} />
        {!last ? <ul>{render(i + 1)}</ul> : reports.length > 0 && <ul>{reports.map((r) => <li key={r.id}><Person n={r} me={me.workerId} /></li>)}</ul>}
      </li>
    );
  };
  return (
    <>
      <p className="small"><strong>Organisation:</strong> {orgPath(nodes, id).join(" › ") || "—"}</p>
      <ul className="tree">{render(0)}</ul>
    </>
  );
}

/** The company's organisations: each led by a worker or an open position, with headcount. */
function OrgUnits() {
  const { data } = useData();
  const nodes = useNodes(data!.dsNow);
  const heads = Object.keys(ORGS).filter((id) => nodes.has(id));
  const parentOrg = (id: string) => chainTo(nodes, id).slice(0, -1).reverse().find((n) => ORGS[n.id])?.id;
  const render = (id: string): ReactNode => {
    const n = nodes.get(id)!;
    const kids = heads.filter((h) => parentOrg(h) === id);
    return (
      <li key={id}>
        <strong>{ORGS[id]}</strong> <span className="small muted">{headcountUnder(nodes, id) + (n.vacant ? 0 : 1)} people · led by {n.vacant ? <>an open position ({n.title})</> : <a href={`#/workers/${id}`}>{n.name}, {n.title}</a>}</span>
        {kids.length > 0 && <ul>{kids.map(render)}</ul>}
      </li>
    );
  };
  return <ul className="tree">{heads.filter((h) => !parentOrg(h)).map(render)}</ul>;
}

export default function Organisation({ query }: { query: URLSearchParams }) {
  const { data } = useData();
  const { me, erp } = useErp();
  const ds = data!.dsNow;
  const w = ds.workers.find((x) => x.id === me.workerId);
  const tab = TABS.some(([k]) => k === query.get("tab")) ? query.get("tab")! : "org";
  if (!w) return <div className="callout info">{me.name} has no worker record.</div>;
  const ref = today();
  const tl = buildTimeline(w, ds.events, ref, ref)[0];
  const loc = ds.locations.find((l) => l.id === tl.locationId);
  const cc = ds.costCenters.find((c) => c.id === tl.costCenterId);
  const company = ds.companies.find((c) => c.id === w.companyId)?.name;
  const comp = ds.events.filter((e) => e.employeeId === w.id && (e.field === "annualSalary" || e.field === "hourlyRate")).sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : 1));
  const hourlyUS = w.payType === "Hourly" && w.country === "USA";
  const periods = w.country !== "USA" ? [] : US_PERIODS.filter((p) => p.id === US_PERIOD.id || (hourlyUS ? p.payGroup === "US Biweekly" : p.payGroup === w.payGroup));

  return (
    <>
      <PageHead title="Organisation">{w.name}, {w.jobProfile} ({w.id})</PageHead>
      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setQuery("/organisation", { tab: k })}>{l}</button>)}
      </div>

      {tab === "org" && (
        <div className="grid2">
          <Section title="Your organisation hierarchy" lede="From the CEO down to you, with the people who report to you.">
            <OrgChain id={w.id} withReports />
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>Team (supervisory org)</dt><dd>{cc?.supervisoryOrg ?? w.supervisoryOrg}</dd>
              <dt>Department</dt><dd>{w.department}</dd>
              <dt>Cost center</dt><dd>{tl.costCenterId} {cc?.name}</dd>
              <dt>Company</dt><dd>{company}</dd>
            </dl>
          </Section>
          <Section title="NeoCloud organisations" lede="Every organisation, who leads it and how many people it has. Open positions are not yet filled.">
            <OrgUnits />
          </Section>
        </div>
      )}

      {tab === "comp" && (
        <Section title="Compensation" lede="Your own pay. Only you, your managers and payroll can see it.">
          <dl className="kv">
            <dt>Pay type</dt><dd>{w.payType}</dd>
            <dt>FLSA status</dt><dd>{w.flsa}</dd>
            <dt>{w.payType === "Hourly" ? "Hourly rate" : "Annual salary"}</dt><dd>{w.payType === "Hourly" ? `$${tl.hourlyRate.toFixed(2)} per hour` : <Money c={toCents(tl.annualSalary)} cur={w.currency} />}</dd>
            <dt>Currency</dt><dd>{w.currency}</dd>
            {w.country === "USA" && <><dt>401(k) contribution</dt><dd>{(w.k401Pct * 100).toFixed(1)}% pre-tax</dd><dt>Medical premium</dt><dd>${w.medicalPerPeriod.toFixed(2)} per pay period (Section 125)</dd></>}
          </dl>
          <h3 style={{ marginTop: 16 }}>Compensation history</h3>
          <div className="table-wrap">
            <table className="reg">
              <thead><tr><th>Effective</th><th>Change</th><th className="n">From</th><th className="n">To</th></tr></thead>
              <tbody>
                <tr><td>{w.hireDate}</td><td>Hire</td><td className="n">—</td><td className="n">{comp[0]?.oldValue ? (w.payType === "Hourly" ? `$${Number(comp[0].oldValue).toFixed(2)}/hr` : Number(comp[0].oldValue).toLocaleString("en-US")) : w.payType === "Hourly" ? `$${w.hourlyRate.toFixed(2)}/hr` : w.annualSalary.toLocaleString("en-US")}</td></tr>
                {comp.map((e, i) => <tr key={i}><td>{e.effectiveDate}</td><td>{e.event}</td><td className="n">{e.oldValue}</td><td className="n">{e.newValue}</td></tr>)}
              </tbody>
            </table>
          </div>
          <p className="small"><a href="#/payslip">See your payslip</a></p>
        </Section>
      )}

      {tab === "paygroup" && (
        <Section title="Pay group" lede="Which payroll you are paid in and when.">
          <dl className="kv">
            <dt>Pay group</dt><dd>{hourlyUS ? "US Biweekly (from Oct 16, 2026; US Semi-Monthly before go-live)" : w.payGroup || "None (contingent worker)"}</dd>
            <dt>Frequency</dt><dd>{w.country !== "USA" ? "Monthly, through the in-country payroll provider" : hourlyUS ? "Every two weeks: Sunday–Saturday workweeks, paid the Friday after" : "Twice a month: 1st–15th and 16th–month end"}</dd>
          </dl>
          {periods.length > 0 ? (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="reg">
                <thead><tr><th>Pay period</th><th>Dates</th><th>Check date</th><th>Pay run</th></tr></thead>
                <tbody>{periods.map((p) => <tr key={p.id} className={p.start <= ref && ref <= p.end ? "sel" : ""}><td>{PERIOD_LABEL[p.id]}</td><td>{pretty(p.start)} – {pretty(p.end)}</td><td>{pretty(p.checkDate)}</td><td>{erp.payRuns[p.id]?.status ?? "Not started"}</td></tr>)}</tbody>
              </table>
            </div>
          ) : (
            <p className="small">October: {pretty(INTL_PERIOD.start)} – {pretty(INTL_PERIOD.end)}, paid {pretty(INTL_PERIOD.payDate)}. Changes after {pretty(INTL_PERIOD.changeCutoff)} reach the provider next month.</p>
          )}
        </Section>
      )}

      {tab === "job" && (
        <Section title="Job profile">
          <dl className="kv">
            <dt>Job profile</dt><dd>{w.jobProfile}</dd>
            <dt>Level</dt><dd>{w.level}</dd>
            <dt>Department</dt><dd>{w.department}</dd>
            <dt>Worker type</dt><dd>{w.workerType}</dd>
            <dt>FLSA / pay type</dt><dd>{w.flsa}, {w.payType}</dd>
            {w.shift && <><dt>Shift</dt><dd>{w.shift}</dd></>}
            <dt>Location</dt><dd>{loc?.name} ({tl.workState})</dd>
            <dt>Manager</dt><dd>{ds.workers.find((m) => m.id === w.managerId)?.name ?? (OPEN_POSITIONS.find((p) => p.id === w.managerId) ? `${OPEN_POSITIONS.find((p) => p.id === w.managerId)!.title} (open position)` : "—")}</dd>
            <dt>Hire date</dt><dd>{pretty(w.hireDate)}</dd>
          </dl>
        </Section>
      )}
    </>
  );
}
