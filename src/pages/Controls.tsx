import { useState } from "react";
import { useData } from "../state.tsx";
import { PageHead, Pill, Section, sevTone } from "../ui.tsx";
import { CONTROLS, SECURITY_GROUPS } from "../../lib/config/controls.ts";

export default function Controls() {
  const { data } = useData();
  const findings = data!.result.audit;
  const [sev, setSev] = useState("");
  const counts = { Critical: 0, Warning: 0, Info: 0 } as Record<string, number>;
  for (const f of findings) counts[f.severity]++;
  const shown = findings.filter((f) => !sev || f.severity === sev);

  return (
    <>
      <PageHead title="Controls and audit">
        Pre-payroll audit results for this period, the key control matrix, and how segregation of duties is enforced through Workday security groups.
      </PageHead>

      <Section title="Pre-payroll audit" lede="Each finding says why it fired, using the worker's own numbers. Critical items must be resolved before the pay calculation is completed; warnings must be explained.">
        <div className="tabs" role="tablist">
          {[["", `All (${findings.length})`], ["Critical", `Critical (${counts.Critical})`], ["Warning", `Warning (${counts.Warning})`], ["Info", `Info (${counts.Info})`]].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={sev === k} onClick={() => setSev(k)}>{l}</button>
          ))}
        </div>
        <div className="table-wrap" style={{ maxHeight: "50vh" }}>
          <table className="reg">
            <thead><tr><th>Severity</th><th>Worker</th><th>Check</th><th>Finding</th></tr></thead>
            <tbody>
              {shown.map((f, i) => (
                <tr key={i}>
                  <td><Pill tone={sevTone(f.severity)}>{f.severity}</Pill></td>
                  <td><a href={`#/register/${f.employeeId}`}>{f.employeeId}</a></td>
                  <td>{f.check}</td>
                  <td className="wrap">{f.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Key control matrix">
        <div className="table-wrap">
          <table className="reg">
            <thead><tr><th>Control</th><th>Activity</th><th>Owner and frequency</th><th>Workday evidence</th><th>Segregation of duties</th></tr></thead>
            <tbody>
              {CONTROLS.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.id}</strong> <Pill>{c.area}</Pill><div className="small">{c.objective}</div><div className="faint small">{c.type}, {c.automation.toLowerCase()}</div></td>
                  <td className="small wrap">{c.activity}</td>
                  <td className="small">{c.owner}<div className="faint">{c.frequency}</div></td>
                  <td className="small">{c.evidence}</td>
                  <td className="small">{c.sod}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Security groups" lede="No user holds both a preparer and an approver group. Conflicting combinations are blocked by a segregation-of-duties policy and reviewed quarterly (PR-11).">
        <div className="table-wrap">
          <table className="reg">
            <thead><tr><th>Security group</th><th>Can</th><th>Cannot</th></tr></thead>
            <tbody>{SECURITY_GROUPS.map((g) => <tr key={g.group}><td><strong>{g.group}</strong></td><td className="small">{g.can}</td><td className="small">{g.cannot}</td></tr>)}</tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
