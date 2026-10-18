import { useState } from "react";
import { useData } from "../state.tsx";
import { go } from "../router.tsx";
import { Hours, Money, PageHead, Pill, Section, Select, sevTone } from "../ui.tsx";
import { TIME_CATEGORY_FEEDS } from "../../lib/config/payComponents.ts";
import { minutesToHHMM, pretty } from "../../lib/util/dates.ts";
import type { UsWorkerCalc } from "../../lib/engine/build.ts";

const h = (m: number) => m / 60;
const amt = (c: UsWorkerCalc, codes: string[]) => c.pay.lines.filter((l) => codes.includes(l.code)).reduce((s, l) => s + l.amount, 0);

export default function Time({ id }: { id?: string }) {
  const { data } = useData();
  const r = data!.result;
  const techs = r.us.filter((c) => c.time);
  const sel = id ? techs.find((c) => c.worker.id === id) : undefined;
  const [code, setCode] = useState("");
  const exceptions = techs.flatMap((c) => c.time!.exceptions.filter((e) => e.date >= r.period.start || e.code === "RETRO_CORRECTION"));
  const codes = [...new Set(exceptions.map((e) => e.code))].sort();
  const tot = (k: keyof NonNullable<UsWorkerCalc["time"]>["catsInPeriod"]) => techs.reduce((s, c) => s + c.time!.catsInPeriod[k], 0);

  return (
    <>
      <PageHead title="Time calculation">
        {techs.length} non-exempt data center technicians ({techs.filter((c) => c.time!.rules === "CA").length} in California under CA rules, {techs.filter((c) => c.time!.rules === "FLSA").length} in Texas under FLSA only). Hours are split into categories, then each category feeds a pay component.
      </PageHead>

      {sel && <TimeDetail c={sel} />}

      <Section title="Hours by category, in period">
        <div className="table-wrap" style={{ maxHeight: "60vh" }}>
          <table className="reg">
            <thead>
              <tr>
                <th>Technician</th>
                <th>Rules</th>
                <th className="n">Rate</th>
                <th className="n">Regular</th>
                <th className="n">Daily OT</th>
                <th className="n">Weekly OT</th>
                <th className="n">Daily DT</th>
                <th className="n">7th day OT</th>
                <th className="n">7th day DT</th>
                <th className="n">Night</th>
                <th className="n">Meal prem.</th>
                <th className="n">OT + DT pay</th>
                <th className="n">Premium pay</th>
                <th className="n">Retro</th>
                <th className="n">Gross</th>
              </tr>
            </thead>
            <tbody>
              {techs.map((c) => {
                const k = c.time!.catsInPeriod;
                return (
                  <tr key={c.worker.id} className={`click ${id === c.worker.id ? "sel" : ""}`} onClick={() => go(`/time/${c.worker.id}`)}>
                    <td>
                      <a href={`#/time/${c.worker.id}`} onClick={(e) => e.preventDefault()}>{c.worker.id}</a> {c.worker.name}
                      <div className="faint small">{c.worker.locationId}, {c.worker.shift || "Day"} shift</div>
                    </td>
                    <td>{c.time!.rules === "CA" ? "California" : "FLSA"}</td>
                    <td className="n">${c.worker.hourlyRate.toFixed(2)}</td>
                    <td className="n"><Hours h={h(k.REG)} /></td>
                    <td className="n"><Hours h={h(k.OT_DAILY)} /></td>
                    <td className="n"><Hours h={h(k.OT_WEEKLY)} /></td>
                    <td className="n"><Hours h={h(k.DT_DAILY)} /></td>
                    <td className="n"><Hours h={h(k.SEVENTH_OT)} /></td>
                    <td className="n"><Hours h={h(k.SEVENTH_DT)} /></td>
                    <td className="n"><Hours h={h(k.NIGHT)} /></td>
                    <td className="n">{k.MEAL_PEN || <span className="zero">0</span>}</td>
                    <td className="n"><Money c={amt(c, ["OT", "DT", "OT_ADJ"])} /></td>
                    <td className="n"><Money c={amt(c, ["SHIFT", "MEAL"])} /></td>
                    <td className="n"><Money c={amt(c, ["RETRO"])} /></td>
                    <td className="n"><Money c={c.pay.totals.gross} /></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>{techs.length} technicians</td>
                <td className="n">{h(tot("REG")).toFixed(2)}</td>
                <td className="n">{h(tot("OT_DAILY")).toFixed(2)}</td>
                <td className="n">{h(tot("OT_WEEKLY")).toFixed(2)}</td>
                <td className="n">{h(tot("DT_DAILY")).toFixed(2)}</td>
                <td className="n">{h(tot("SEVENTH_OT")).toFixed(2)}</td>
                <td className="n">{h(tot("SEVENTH_DT")).toFixed(2)}</td>
                <td className="n">{h(tot("NIGHT")).toFixed(2)}</td>
                <td className="n">{tot("MEAL_PEN")}</td>
                <td className="n"><Money c={techs.reduce((s, c) => s + amt(c, ["OT", "DT", "OT_ADJ"]), 0)} /></td>
                <td className="n"><Money c={techs.reduce((s, c) => s + amt(c, ["SHIFT", "MEAL"]), 0)} /></td>
                <td className="n"><Money c={techs.reduce((s, c) => s + amt(c, ["RETRO"]), 0)} /></td>
                <td className="n"><Money c={techs.reduce((s, c) => s + c.pay.totals.gross, 0)} /></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>

      <div className="grid2">
        <Section title="How categories feed pay components" lede="Evaluated in this order: clean punches, build shifts, night minutes, meal compliance, daily categories (seventh day first), weekly OT, then the regular rate for each workweek.">
          <div className="table-wrap">
            <table className="reg">
              <thead><tr><th>Time category</th><th>Pay component</th><th>Calculation</th></tr></thead>
              <tbody>
                {TIME_CATEGORY_FEEDS.map((f) => (
                  <tr key={f.category}><td>{f.label}</td><td>{f.component}</td><td>{f.multiplier}</td></tr>
                ))}
                <tr><td>Regular rate true-up</td><td>OT_ADJ</td><td>(RR − base) × (0.5 × OT + 1.0 × DT hours), RR includes night differential</td></tr>
                <tr><td>Prior-period corrections</td><td>RETRO</td><td>Recalculated prior days − amount originally paid</td></tr>
              </tbody>
            </table>
          </div>
        </Section>
        <Section title="Time exceptions" right={<Select label="" value={code} onChange={setCode} options={codes.map((c) => [c, c.replace(/_/g, " ").toLowerCase()])} all="All exceptions" />}>
          <div className="table-wrap" style={{ maxHeight: 420 }}>
            <table className="reg">
              <thead><tr><th>Worker</th><th>Date</th><th>Exception</th><th>Treatment</th></tr></thead>
              <tbody>
                {exceptions.filter((e) => !code || e.code === code).map((e, i) => (
                  <tr key={i}>
                    <td><a href={`#/time/${e.employeeId}`}>{e.employeeId}</a></td>
                    <td>{pretty(e.date)}</td>
                    <td><Pill tone={sevTone(e.severity)}>{e.code.replace(/_/g, " ").toLowerCase()}</Pill><div className="explain">{e.message}</div></td>
                    <td className="wrap small">{e.treatment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </>
  );
}

function TimeDetail({ c }: { c: UsWorkerCalc }) {
  const t = c.time!;
  const { data } = useData();
  const rows = data!.ds.time.filter((x) => x.employeeId === c.worker.id);
  return (
    <div className="detail">
      <div className="detail-head">
        <h2>{c.worker.id} {c.worker.name}</h2>
        <span className="muted">{t.rules === "CA" ? "California daily and weekly rules" : "FLSA weekly rule only"}, base ${t.baseRate.toFixed(2)}/hr</span>
        <button className="close" onClick={() => go("/time")}>Close</button>
      </div>
      <div className="table-wrap">
        <table className="reg">
          <thead>
            <tr>
              <th>Workday</th><th>Punches</th><th>Meal</th><th className="n">Worked</th><th className="n">Night</th><th>Meal check</th>
              <th className="n">REG</th><th className="n">OT day</th><th className="n">OT week</th><th className="n">DT</th><th className="n">7th OT</th><th className="n">7th DT</th>
            </tr>
          </thead>
          <tbody>
            {t.days.map((d) => (
              <tr key={d.date} style={d.date < data!.result.period.start ? { opacity: 0.6 } : undefined}>
                <td>{pretty(d.date)}{d.date < data!.result.period.start && <div className="faint small">prior period</div>}</td>
                <td>{d.shifts.map((s) => `${minutesToHHMM(s.start)}–${minutesToHHMM(s.end)}${s.crossesMidnight ? " (+1)" : ""}`).join(", ")}</td>
                <td>{d.shifts.map((s) => (s.mealStart !== null ? `${minutesToHHMM(s.mealStart)}–${minutesToHHMM(s.mealEnd!)}` : "none")).join(", ")}</td>
                <td className="n">{h(d.workedMin).toFixed(2)}</td>
                <td className="n"><Hours h={h(d.nightMin)} /></td>
                <td>{d.mealStatus === "ok" || d.mealStatus === "n/a" ? <span className="faint">{d.mealStatus}</span> : <Pill tone="warn">{d.mealStatus.replace("_", " ")}</Pill>}</td>
                <td className="n"><Hours h={h(d.cats.REG)} /></td>
                <td className="n"><Hours h={h(d.cats.OT_DAILY)} /></td>
                <td className="n"><Hours h={h(d.cats.OT_WEEKLY)} /></td>
                <td className="n"><Hours h={h(d.cats.DT_DAILY)} /></td>
                <td className="n"><Hours h={h(d.cats.SEVENTH_OT)} /></td>
                <td className="n"><Hours h={h(d.cats.SEVENTH_DT)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid2" style={{ marginTop: 16 }}>
        <div>
          <h3>Workweeks (Sunday to Saturday)</h3>
          {t.weeks.map((w) => (
            <p key={w.weekStart} className="small" style={{ margin: "0 0 6px" }}>
              <strong>Week of {pretty(w.weekStart)}</strong>{w.closedInPeriod ? "" : " (open: closes after period end, trued up next period)"}: regular rate ${w.regularRate.toFixed(4)}; in period {w.current.hours.REG.toFixed(2)} REG, {w.current.hours.OT.toFixed(2)} OT, {w.current.hours.DT.toFixed(2)} DT hrs.
            </p>
          ))}
          <h3 style={{ marginTop: 16 }}>Pay lines from time</h3>
          {c.pay.lines.filter((l) => ["REG", "OT", "DT", "OT_ADJ", "SHIFT", "MEAL", "RETRO", "VAC", "SICK"].includes(l.code)).map((l) => (
            <p key={l.code} className="small" style={{ margin: "0 0 6px" }}>
              <strong>{l.name}</strong> <Money c={l.amount} />
              <br />
              <span className="faint">{l.explain}</span>
            </p>
          ))}
        </div>
        <div>
          <h3>Source rows</h3>
          <div className="table-wrap" style={{ maxHeight: 360 }}>
            <table className="reg">
              <thead><tr><th>Row</th><th>Date</th><th>In–Out</th><th>Type</th><th>Notes</th></tr></thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.rowId}>
                    <td>{x.rowId}</td>
                    <td>{pretty(x.workDate)}</td>
                    <td>{x.timeIn}–{x.timeOut}</td>
                    <td>{x.entryType === "Correction" ? <Pill tone="info">corrects {x.correctsRowId}</Pill> : "Original"}</td>
                    <td className="small">{x.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {t.exceptions.map((e, i) => (
            <div key={i} className={`callout ${e.severity === "Critical" ? "bad" : e.severity === "Info" ? "info" : ""}`}>
              <strong>{pretty(e.date)}: {e.code.replace(/_/g, " ").toLowerCase()}.</strong> {e.message} {e.treatment}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
