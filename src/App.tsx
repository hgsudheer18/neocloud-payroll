import { useData } from "./state.tsx";
import { useErp, PERSONAS } from "./erp.tsx";
import { useRoute } from "./router.tsx";
import { pretty } from "../lib/util/dates.ts";
import { BP_RULES, persona as personaById } from "../lib/erp/types.ts";
import { PERIOD_LABEL, US_PERIODS } from "../lib/config/period.ts";
import Dashboard from "./pages/Dashboard.tsx";
import Register from "./pages/Register.tsx";
import Time from "./pages/Time.tsx";
import Reconciliation from "./pages/Reconciliation.tsx";
import Ledger from "./pages/Ledger.tsx";
import International from "./pages/International.tsx";
import Controls from "./pages/Controls.tsx";
import DataFiles from "./pages/DataFiles.tsx";
import Docs from "./pages/Docs.tsx";
import Workers from "./pages/Workers.tsx";
import Setup from "./pages/Setup.tsx";
import TimeEntry from "./pages/TimeEntry.tsx";
import AbsenceHub from "./pages/AbsenceHub.tsx";
import Benefits from "./pages/Benefits.tsx";
import Home from "./pages/Home.tsx";
import MyInformation from "./pages/MyInformation.tsx";
import Documents from "./pages/Documents.tsx";
import DataErrors from "./pages/DataErrors.tsx";
import { Bell } from "./notifications.tsx";
import { DemoClock, ScheduledAlerts } from "./alerts.tsx";
import Inbox from "./pages/Inbox.tsx";
import PayRuns from "./pages/PayRuns.tsx";
import MyPayslip from "./pages/MyPayslip.tsx";
import Organisation from "./pages/Organisation.tsx";
import { accessFor, NoAccess, useAccess } from "./access.tsx";

// Pages whose figures depend on the selected pay period: they show the pay period picker.
const PERIOD_PAGES = ["payslip", "benefits", "payruns", "overview", "", "register", "time", "time-off", "absence", "reconciliation", "gl", "controls"];

const NAV: { group: string; items: [string, string][] }[] = [
  { group: "Workforce", items: [["", "Home"], ["inbox", "Inbox"], ["workers", "Workers"], ["organisation", "Organisation"], ["my-information", "My Information"], ["time-off", "Absence"], ["benefits", "Benefits"], ["documents", "Documents"], ["setup", "Organization setup"]] },
  { group: "Payroll", items: [["payslip", "Pay Slip"], ["time-entry", "Enter time"], ["team-time", "Team Timesheets"], ["payruns", "Pay runs"], ["overview", "Period overview"], ["register", "Payroll register"], ["time", "Time calculation"]] },
  { group: "Tie it out", items: [["data-errors", "Data errors (Oct 1–15)"], ["reconciliation", "Reconciliation"], ["gl", "General ledger"], ["international", "International"]] },
  { group: "Govern", items: [["controls", "Controls and audit"], ["data", "Data and demo"], ["docs", "Design documents"]] },
];

export default function App() {
  const { data, error } = useData();
  const { erp, me, setPersona, periodId, setPeriod } = useErp();
  const { path, query } = useRoute();
  const access = useAccess();
  // Switching user starts fresh: same page if the new role may open it (without a previous
  // selection such as another worker), otherwise their inbox.
  const switchUser = (id: string) => {
    setPersona(id);
    const next = data ? accessFor(personaById(id), data.dsNow) : null;
    window.location.hash = next && next.canOpen(page) ? `/${page}` : "/";
  };
  const page = path[0] ?? "";

  const body = () => {
    if (error) return <div className="callout bad">{error}</div>;
    if (!data) return <div className="loading">Loading the data package and calculating the period…</div>;
    if (!access.canOpen(page)) return <NoAccess />;
    switch (page) {
      case "inbox": return <Inbox query={query} />;
      case "workers": return <Workers id={path[1]} query={query} />;
      case "time-entry": return <TimeEntry query={query} />;
      case "team-time": return <TimeEntry query={query} manager />;
      case "time-off": return <AbsenceHub query={query} />;
      case "benefits": return <Benefits query={query} />;
      case "payslip": return <MyPayslip />;
      case "organisation": return <Organisation query={query} />;
      // Earlier links to the separate absence pages open the matching Absence tab.
      case "team-time-off": return <AbsenceHub query={query} tab="team" />;
      case "upcoming-time-off": return <AbsenceHub query={query} tab="upcoming" />;
      case "setup": return <Setup query={query} />;
      case "payruns": return <PayRuns />;
      case "register": return <Register id={path[1]} query={query} />;
      case "time": return <Time id={path[1]} />;
      case "absence": return <AbsenceHub query={query} tab="balances" />;
      case "reconciliation": return <Reconciliation id={path[1]} query={query} />;
      case "gl": return <Ledger query={query} />;
      case "international": return <International />;
      case "controls": return <Controls />;
      case "data": return <DataFiles />;
      case "docs": return <Docs slug={path[1]} />;
      case "overview": return <Dashboard query={query} />;
      case "my-information": return <MyInformation />;
      case "documents": return <Documents query={query} />;
      case "data-errors": return <DataErrors />;
      default: return <Home />;
    }
  };

  const unexplained = data?.result.recon.counts.Unexplained ?? 0;
  const tiesOk = data ? data.result.ties.every((t) => t.ok) : true;
  const toApprove = erp.bps.filter((b) => b.status === "Awaiting Approval" && access.seesBp(b) && b.initiatedBy !== me.id && BP_RULES[b.type].approvers !== "auto" && (BP_RULES[b.type].approvers as string[]).includes(me.role)).length;
  const run = erp.payRuns[periodId]?.status ?? "Not started";

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">NeoCloud Inc.</div>
        <label className="side-select">
          <span>Signed in as</span>
          <select value={me.id} onChange={(e) => switchUser(e.target.value)}>
            {PERSONAS.map((p) => <option key={p.id} value={p.id}>{p.name}, {p.role}</option>)}
          </select>
        </label>
        <nav className="nav" aria-label="Main">
          {NAV.map((g) => ({ ...g, items: g.items.filter(([href]) => access.canOpen(href)) })).filter((g) => g.items.length > 0).map((g) => (
            <div key={g.group} style={{ display: "contents" }}>
              <div className="nav-group">{g.group}</div>
              {g.items.map(([href, label]) => (
                <a key={href} href={`#/${href}`} aria-current={page === href || (href === "time-off" && ["team-time-off", "upcoming-time-off", "absence"].includes(page)) ? "page" : undefined}>
                  {href === "team-time" && me.role !== "Manager" ? "Timesheets" : label}
                  {href === "inbox" && toApprove > 0 && <span className="badge">{toApprove}</span>}
                  {href === "reconciliation" && data && data.result.reconciled && <span className="count">{unexplained ? `${unexplained} open` : "tied"}</span>}
                  {href === "overview" && data && <span className="count">{tiesOk ? "ties" : "check"}</span>}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          {data && <>Calculated in {data.ms} ms in your browser. Data you enter is saved in this browser only.</>}
          <DemoClock />
        </div>
      </aside>
      <main className="main" key={me.id}>
        <ScheduledAlerts />
        <div className="topbar">
          {data && PERIOD_PAGES.includes(page) && access.canOpen(page) && (
            <div className="period-bar">
            <label>
              <span>Pay period</span>
              <select value={periodId} onChange={(e) => setPeriod(e.target.value)}>
                {US_PERIODS.map((p) => <option key={p.id} value={p.id}>{PERIOD_LABEL[p.id]}</option>)}
              </select>
            </label>
            <span className="small muted">Check date {pretty(data.result.period.checkDate)} · Pay run: {run}</span>
            </div>
          )}
          {data && <Bell />}
        </div>
        {body()}
      </main>
    </div>
  );
}
