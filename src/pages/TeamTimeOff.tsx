import { useData } from "../state.tsx";
import { useErp } from "../erp.tsx";
import { setQuery } from "../router.tsx";
import { PageHead, Pill, Section, Select } from "../ui.tsx";
import { today } from "../erpui.tsx";
import { reportingLine } from "../access.tsx";
import { ABSENCE_PLANS } from "../../lib/config/absencePlans.ts";
import { PERIOD_LABEL, US_PERIODS } from "../../lib/config/period.ts";
import { pretty } from "../../lib/util/dates.ts";
import type { AbsenceTaken } from "../../lib/data/types.ts";

const planName = (code: string) => ABSENCE_PLANS.find((p) => p.code === code)?.name ?? code;
const monthName = (iso: string) => new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** The pay period containing today; before the first or after the last, the nearest one. */
function currentPeriod() {
  const t = today();
  return US_PERIODS.find((p) => p.start <= t && t <= p.end) ?? (t < US_PERIODS[0].start ? US_PERIODS[0] : US_PERIODS[US_PERIODS.length - 1]);
}

/** A manager's reporting line (with or without themselves) and their time off between two dates. */
function useTeamAbsence(includeSelf: boolean, from: string, to: string) {
  const { data } = useData();
  const { me } = useErp();
  const ds = data!.dsNow;
  const line = me.workerId ? reportingLine(ds, me.workerId) : new Set<string>();
  if (!includeSelf && me.workerId) line.delete(me.workerId);
  const name = (id: string) => (id === me.workerId ? "You" : ds.workers.find((w) => w.id === id)?.name ?? id);
  const rows = ds.absences
    .filter((a) => line.has(a.employeeId) && a.date >= from && a.date <= to)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.employeeId.localeCompare(b.employeeId)));
  return { rows, teamSize: line.size, name };
}

function AbsenceTable({ rows, name }: { rows: AbsenceTaken[]; name: (id: string) => string }) {
  return (
    <div className="table-wrap" style={{ maxHeight: "60vh" }}>
      <table className="reg">
        <thead><tr><th>Date</th><th>Worker</th><th>Plan</th><th className="n">Amount</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((a, i) => (
            <tr key={i}>
              <td>{pretty(a.date)}</td>
              <td>{a.employeeId} {name(a.employeeId)}</td>
              <td>{planName(a.plan)}</td>
              <td className="n">{a.quantity} {a.unit}</td>
              <td>{a.status === "Approved" ? <Pill tone="ok">Approved</Pill> : <Pill tone="warn">Awaiting approval</Pill>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Team Time Off: the manager's team's time off in the selected pay period or its month. */
export default function TeamTimeOff({ query }: { query: URLSearchParams }) {
  const period = currentPeriod();
  const range = query.get("range") === "month" ? "month" : "period";
  const month = period.start.slice(0, 7);
  const [from, to] = range === "month" ? [`${month}-01`, `${month}-31`] : [period.start, period.end];
  const { rows, teamSize, name } = useTeamAbsence(false, from, to);
  const people = new Set(rows.map((r) => r.employeeId)).size;
  const label = range === "month" ? monthName(period.start) : `Current pay period: ${PERIOD_LABEL[period.id]}`;
  return (
    <>
      <PageHead title="Team Time Off">
        Time off for the {teamSize} people in your reporting line, approved and awaiting your approval, in the current pay period or month.
      </PageHead>
      <div className="filters">
        <Select label="Show" value={range} onChange={(v) => setQuery("/team-time-off", { range: v })} options={[["period", "This pay period"], ["month", "This month"]]} all={null} />
      </div>
      <Section title={label} lede={`${range === "month" ? "The whole month" : `${pretty(from)} to ${pretty(to)}`}. ${people} of ${teamSize} people have time off.`}>
        {rows.length === 0 ? <p className="muted">No time off in your team for these dates.</p> : <AbsenceTable rows={rows} name={name} />}
      </Section>
    </>
  );
}

/** Upcoming Time Off: the manager's own and their team's time off from today to the end of the selected pay period. */
export function UpcomingTimeOff() {
  const period = currentPeriod();
  const now = today();
  const from = now > period.start ? now : period.start;
  const { rows, name } = useTeamAbsence(true, from, period.end);
  return (
    <>
      <PageHead title="Upcoming Time Off">
        Your own and your team's time off from today to the end of the current pay period, approved and awaiting approval.
      </PageHead>
      <Section title={`Current pay period: ${PERIOD_LABEL[period.id]}`} lede={from > period.end ? `This pay period ended on ${pretty(period.end)}.` : `${pretty(from)} to ${pretty(period.end)}.`}>
        {from > period.end ? <p className="muted">The last pay period set up in the demo has ended, so nothing is upcoming.</p> : rows.length === 0 ? <p className="muted">No upcoming time off for you or your team in this pay period.</p> : <AbsenceTable rows={rows} name={name} />}
      </Section>
    </>
  );
}
