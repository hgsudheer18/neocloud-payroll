import { useMemo, useState } from "react";
import { useErp } from "../erp.tsx";
import { PageHead, Pill, Section, downloadText } from "../ui.tsx";
import { today } from "../erpui.tsx";
import { payCalendar, type CalendarPeriod } from "../../lib/config/payCalendar.ts";
import { addDays, dayOfWeek, eachDay } from "../../lib/util/dates.ts";
import { toCsv } from "../../lib/util/csv.ts";

/** MM/DD/YYYY, used for every date on this page. */
const mdy = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

/** Every semi-monthly and biweekly pay period for 2026 and 2027, with check dates and cutoffs. */
export default function PayCalendars() {
  const { erp, setPeriod } = useErp();
  const all = useMemo(() => payCalendar([2026, 2027]), []);
  const [year, setYear] = useState("2026");
  const [group, setGroup] = useState("");
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [picked, setPicked] = useState("");
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
            <thead><tr><th>#</th><th>Start date</th><th>End date</th><th>Check date</th><th>Time and inputs cutoff</th><th>Approve pay run by</th><th>Status</th><th>Note</th></tr></thead>
            <tbody>
              {list.map((p) => {
                const current = p.start <= now && now <= p.end;
                const s = status(p.appPeriodId);
                return (
                  <tr key={p.id} className={current ? "sel" : undefined}>
                    <td>{p.number}</td>
                    <td>{mdy(p.start)}{current && <> <Pill tone="info">current</Pill></>}</td>
                    <td>{mdy(p.end)}</td>
                    <td><strong>{mdy(p.checkDate)}</strong></td>
                    <td>{mdy(p.inputCutoff)}</td>
                    <td>{mdy(p.approveBy)}</td>
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
        <div className="tabs" role="tablist" style={{ marginBottom: 0, borderBottom: 0 }}>
          <button role="tab" aria-selected={view === "calendar"} onClick={() => setView("calendar")}>Calendar</button>
          <button role="tab" aria-selected={view === "list"} onClick={() => setView("list")}>List</button>
        </div>
        <label>Year<select value={year} onChange={(e) => setYear(e.target.value)}><option>2026</option><option>2027</option></select></label>
        <label>Pay group<select value={group} onChange={(e) => setGroup(e.target.value)}><option value="">Both</option><option>US Semi-Monthly</option><option>US Biweekly</option></select></label>
        <span className="spacer" />
        <button className="btn ghost" onClick={csv}>Download CSV</button>
      </div>
      {view === "calendar" && <CalendarGrid year={Number(year)} periods={all.filter((p) => !group || p.payGroup === group)} now={now} picked={picked} onPick={setPicked} status={status} />}
      {view === "list" && groupTable("US Semi-Monthly", "Semi-monthly: salaried", "1st–15th and 16th–month end, paid 5 days after the period ends. Hourly workers were paid semi-monthly until Oct 15, 2026.")}
      {view === "list" && groupTable("US Biweekly", "Biweekly: hourly", "Two Sunday–Saturday workweeks, paid the Friday after. Starts at go-live with the Oct 16–31, 2026 transition period.")}
      <p className="small muted">Periods marked with a status are the ones calculated in this app; open one to go to Pay runs. Holidays are not yet in the calendar.</p>
    </>
  );
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const short = (g: CalendarPeriod["payGroup"]) => (g === "US Biweekly" ? "BW" : "SM");

/** Twelve month grids: pay dates as chips, cutoffs and approve-by days marked, and bands showing each day's pay periods. */
function CalendarGrid({ year, periods, now, picked, onPick, status }: { year: number; periods: CalendarPeriod[]; now: string; picked: string; onPick: (d: string) => void; status: (id?: string) => string }) {
  const sm = periods.filter((p) => p.payGroup === "US Semi-Monthly");
  const bw = periods.filter((p) => p.payGroup === "US Biweekly");
  const covering = (list: CalendarPeriod[], d: string) => list.find((p) => p.start <= d && d <= p.end);
  const on = (d: string) => ({
    pay: periods.filter((p) => p.checkDate === d),
    cutoff: periods.filter((p) => p.inputCutoff === d),
    approve: periods.filter((p) => p.approveBy === d),
  });
  const day = picked ? on(picked) : null;
  return (
    <>
      <div className="cal-legend small">
        <span><span className="cal-chip sm">SM</span> semi-monthly pay date</span>
        <span><span className="cal-chip bw">BW</span> biweekly pay date</span>
        <span><span className="cal-mark cutoff" /> time and inputs cutoff</span>
        <span><span className="cal-mark approve" /> approve pay run by</span>
        <span><span className="cal-band sm a" /><span className="cal-band sm b" /> semi-monthly periods</span>
        <span><span className="cal-band bw a" /><span className="cal-band bw b" /> biweekly periods</span>
        <span><span className="cal-today-key" /> today</span>
      </div>
      {picked && day && (
        <div className="sheet cal-detail">
          <div className="row" style={{ justifyContent: "space-between" }}><strong>{mdy(picked)}</strong><button className="close" onClick={() => onPick("")}>Close</button></div>
          <ul className="small">
            {[covering(sm, picked), covering(bw, picked)].filter(Boolean).map((p) => <li key={p!.id}>In {short(p!.payGroup)} period {p!.number}: start date {mdy(p!.start)}, end date {mdy(p!.end)}, check date {mdy(p!.checkDate)} ({status(p!.appPeriodId).toLowerCase()})</li>)}
            {day.pay.map((p) => <li key={`pay${p.id}`}><strong>Pay date</strong> for {short(p.payGroup)} period {p.number}: start date {mdy(p.start)}, end date {mdy(p.end)}</li>)}
            {day.cutoff.map((p) => <li key={`cut${p.id}`}><strong>Cutoff</strong>: time approved and payroll inputs entered for {short(p.payGroup)} period {p.number}, check date {mdy(p.checkDate)}</li>)}
            {day.approve.map((p) => <li key={`app${p.id}`}><strong>Approve by</strong>: {short(p.payGroup)} period {p.number} pay run, check date {mdy(p.checkDate)}</li>)}
          </ul>
        </div>
      )}
      <div className="cal-months">
        {MONTHS.map((name, i) => {
          const first = `${year}-${String(i + 1).padStart(2, "0")}-01`;
          const last = addDays(i === 11 ? `${year + 1}-01-01` : `${year}-${String(i + 2).padStart(2, "0")}-01`, -1);
          const days = eachDay(first, last);
          const pays = periods.filter((p) => p.checkDate >= first && p.checkDate <= last).sort((a, b) => (a.checkDate < b.checkDate ? -1 : 1));
          return (
            <div key={name} className="cal-month">
              <h3>{name} {year}</h3>
              <div className="cal-grid">
                {["S", "M", "T", "W", "T", "F", "S"].map((d, k) => <div key={k} className="cal-dow">{d}</div>)}
                {Array.from({ length: dayOfWeek(first) }, (_, k) => <div key={`e${k}`} />)}
                {days.map((d) => {
                  const e = on(d);
                  const s = covering(sm, d);
                  const b = covering(bw, d);
                  const weekend = dayOfWeek(d) === 0 || dayOfWeek(d) === 6;
                  return (
                    <button key={d} className={`cal-day${weekend ? " weekend" : ""}${d === now ? " today" : ""}${d === picked ? " picked" : ""}`} onClick={() => onPick(d === picked ? "" : d)} title={mdy(d)}>
                      <span className="cal-num">{Number(d.slice(8))}</span>
                      <span className="cal-chips">
                        {e.pay.map((p) => <span key={p.id} className={`cal-chip ${short(p.payGroup).toLowerCase()}`}>{short(p.payGroup)}</span>)}
                      </span>
                      {(e.cutoff.length > 0 || e.approve.length > 0) && <span className="cal-marks">{e.cutoff.length > 0 && <span className="cal-mark cutoff" />}{e.approve.length > 0 && <span className="cal-mark approve" />}</span>}
                      {s && <span className={`cal-band sm ${s.number % 2 ? "a" : "b"}`} />}
                      {b && <span className={`cal-band bw ${b.number % 2 ? "a" : "b"} lower`} />}
                    </button>
                  );
                })}
              </div>
              <ul className="cal-paylist small">
                {pays.length === 0 ? <li className="muted">No pay dates</li> : pays.map((p) => <li key={p.id}><span className={`cal-chip ${short(p.payGroup).toLowerCase()}`}>{short(p.payGroup)}</span> <span><strong>{mdy(p.checkDate)}</strong> · period {p.number}<br /><span className="muted">Start {mdy(p.start)} · End {mdy(p.end)}</span></span>{p.appPeriodId ? <span className="muted"> · {status(p.appPeriodId).toLowerCase()}</span> : null}</li>)}
              </ul>
            </div>
          );
        })}
      </div>
    </>
  );
}
