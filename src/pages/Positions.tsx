import { useData } from "../state.tsx";
import { useErp } from "../erp.tsx";
import { PageHead, Pill, Section } from "../ui.tsx";
import { BpStatus } from "../erpui.tsx";
import { REQUISITIONS, requisitionStatus } from "../../lib/config/requisitions.ts";
import { OPEN_POSITIONS } from "../../lib/config/org.ts";
import { BP_RULES } from "../../lib/erp/types.ts";
import { pretty } from "../../lib/util/dates.ts";

/** Open positions to hire into: four hourly (biweekly) and four salaried (semi-monthly). */
export default function Positions() {
  const { data } = useData();
  const { erp, me } = useErp();
  const ds = data!.dsNow;
  const canHire = (BP_RULES.Hire.initiators as string[]).includes(me.role);
  const place = (id: string) => ds.locations.find((l) => l.id === id);
  const person = (id: string) => ds.workers.find((w) => w.id === id)?.name ?? id;
  const group = (payType: "Hourly" | "Salary") => REQUISITIONS.filter((r) => r.payType === payType);
  const table = (rows: typeof REQUISITIONS) => (
    <div className="table-wrap">
      <table className="reg">
        <thead><tr><th>Position</th><th>Location</th><th>Manager</th><th className="n">Pay</th><th>Start from</th><th>Status</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => {
            const s = requisitionStatus(r, erp.bps);
            const loc = place(r.locationId);
            return (
              <tr key={r.id}>
                <td><strong>{r.id}</strong> {r.title}<div className="faint small">{r.jobProfile}{r.shift ? `, ${r.shift.toLowerCase()} shift` : ""}</div></td>
                <td>{loc?.name} ({loc?.state})</td>
                <td>{person(r.managerId)}</td>
                <td className="n">{r.payType === "Hourly" ? `$${r.pay.toFixed(2)}/hr` : `$${r.pay.toLocaleString("en-US")}`}</td>
                <td>{pretty(r.startFrom)}</td>
                <td>
                  {s.status === "Open" ? <Pill tone="info">Open</Pill> : s.status === "Filled" ? <><Pill tone="ok">Filled</Pill> <a href={`#/workers/${s.workerId}`}>{s.workerId} {s.name}</a></> : <>{s.bp && <BpStatus bp={s.bp} />} <span className="small">{s.name}</span></>}
                </td>
                <td>{s.status === "Open" && canHire && <a className="btn ghost" href={`#/workers/new?position=${r.id}`}>Hire into this position</a>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
  return (
    <>
      <PageHead title="Open positions">Positions to fill from Oct 19, 2026. Hiring into one pre-fills the hire. Someone hired part-way through a pay period is paid from their hire date: salaried staff by working days in the period, hourly staff for the time they work.</PageHead>
      <Section title="Hourly: paid biweekly" lede="Non-exempt data center technicians. Overtime, meal breaks and night differential follow the work location's rules.">{table(group("Hourly"))}</Section>
      <Section title="Salaried: paid semi-monthly" lede="Exempt roles, paid twice a month (1st–15th and 16th–month end).">{table(group("Salary"))}</Section>
      <Section title="Leadership positions in the organisation" lede="Shown in the organisation chart; not open for hire in this demo.">
        <ul className="small">{OPEN_POSITIONS.map((p) => <li key={p.id}>{p.title} (reports to {person(p.managerId)})</li>)}</ul>
      </Section>
      {!canHire && <p className="small muted">Managers and HR Partners can hire into these positions.</p>}
    </>
  );
}
