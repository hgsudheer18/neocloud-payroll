import { useMemo, useState } from "react";
import { useErp } from "../erp.tsx";
import { PageHead, Pill, Section, downloadText } from "../ui.tsx";
import { today } from "../erpui.tsx";
import { payCalendar } from "../../lib/config/payCalendar.ts";
import { pretty } from "../../lib/util/dates.ts";
import { toCsv } from "../../lib/util/csv.ts";

const longDate = (iso: string) => `${pretty(iso)}, ${iso.slice(0, 4)}`;

/** Every semi-monthly and biweekly pay period for 2026 and 2027, with check dates and cutoffs. */
export default function PayCalendars() {
  const { erp, setPeriod } = useErp();
  const all = useMemo(() => payCalendar([2026, 2027]), []);
  const [year, setYear] = useState("2026");
  const [group, setGroup] = useState("");
  const now = today();
  const rows = all.filter((p) => p.start.startsWith(year) && (!group || p.payGroup === group));
  const status = (id?: string) => (id ? erp.payRuns[id]?.status ?? "Not started" : "Scheduled");
  const csv = () =>
    downloadText(`pay-calendar-${year}.csv`, toCsv(rows.map((p) => ({ pay_group: p.payGroup, period: p.number, start: p.start, end: p.end, check_date: p.checkDate, time_and_inputs_cutoff: p.inputCutoff, approve_pay_run_by: p.approveBy, status: status(p.appPeriodId), note: p.note }))));
  const groupTable = (g: "US Semi-Monthly" | "US Biweekly", title: string, lede: string) => {
    const list = rows.filter((p) => p.payGroup === g);
    if (!list.length) return null;
    return (
      <Section title={`${title} (${list.length} periods)`} lede={lede}>
        <div className="table-wrap">
          <table className="reg">
            <thead><tr><th>#</th><th>Pay period</th><th>Check date</th><th>Time and inputs cutoff</th><th>Approve pay run by</th><th>Status</th><th>Note</th></tr></thead>
            <tbody>
              {list.map((p) => {
                const current = p.start <= now && now <= p.end;
                const s = status(p.appPeriodId);
                return (
                  <tr key={p.id} className={current ? "sel" : undefined}>
                    <td>{p.number}</td>
                    <td>{longDate(p.start)} – {pretty(p.end)}{current && <> <Pill tone="info">current</Pill></>}</td>
                    <td><strong>{pretty(p.checkDate)}</strong></td>
                    <td>{pretty(p.inputCutoff)}</td>
                    <td>{pretty(p.approveBy)}</td>
                    <td>{p.appPeriodId ? <a href="#/payruns" onClick={() => setPeriod(p.appPeriodId!)}><Pill tone={s === "Completed" ? "ok" : s === "Not started" ? "" : "warn"}>{s}</Pill></a> : <span className="muted small">Scheduled</span>}</td>
                    <td className="small">{p.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    );
  };
  return (
    <>
      <PageHead title="Pay calendars">Every pay period for both pay groups, with the check date and the cutoffs payroll works to. Time must be approved and payroll inputs entered by the cutoff (3 business days before the check date); the pay run is approved by 1 business day before. Check dates that fall on a weekend move to the business day before.</PageHead>
      <div className="filters">
        <label>Year<select value={year} onChange={(e) => setYear(e.target.value)}><option>2026</option><option>2027</option></select></label>
        <label>Pay group<select value={group} onChange={(e) => setGroup(e.target.value)}><option value="">Both</option><option>US Semi-Monthly</option><option>US Biweekly</option></select></label>
        <span className="spacer" />
        <button className="btn ghost" onClick={csv}>Download CSV</button>
      </div>
      {groupTable("US Semi-Monthly", "Semi-monthly: salaried", "1st–15th and 16th–month end, paid 5 days after the period ends. Hourly workers were paid semi-monthly until Oct 15, 2026.")}
      {groupTable("US Biweekly", "Biweekly: hourly", "Two Sunday–Saturday workweeks, paid the Friday after. Starts at go-live with the Oct 16–31, 2026 transition period.")}
      <p className="small muted">Periods marked with a status are the ones calculated in this app; open one to go to Pay runs. Holidays are not yet in the calendar.</p>
    </>
  );
}
