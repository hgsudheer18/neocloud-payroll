import { useData } from "./state.tsx";
import { useErp, PERSONAS } from "./erp.tsx";
import { useRoute } from "./router.tsx";
import { pretty } from "../lib/util/dates.ts";
import { BP_RULES } from "../lib/erp/types.ts";
import { PERIOD_LABEL, US_PERIODS } from "../lib/config/period.ts";
import Dashboard from "./pages/Dashboard.tsx";
import Register from "./pages/Register.tsx";
import Time from "./pages/Time.tsx";
import Absence from "./pages/Absence.tsx";
import Reconciliation from "./pages/Reconciliation.tsx";
import Ledger from "./pages/Ledger.tsx";
import International from "./pages/International.tsx";
import Controls from "./pages/Controls.tsx";
import DataFiles from "./pages/DataFiles.tsx";
import Docs from "./pages/Docs.tsx";
import Workers from "./pages/Workers.tsx";
import Setup from "./pages/Setup.tsx";
import TimeEntry from "./pages/TimeEntry.tsx";
import TimeOff from "./pages/TimeOff.tsx";
import Inbox from "./pages/Inbox.tsx";
import PayRuns from "./pages/PayRuns.tsx";

const NAV: { group: string; items: [string, string][] }[] = [
  { group: "Workforce", items: [["inbox", "Inbox"], ["workers", "Workers"], ["time-entry", "Enter time"], ["time-off", "Time off"], ["setup", "Organization setup"]] },
  { group: "Payroll", items: [["payruns", "Pay runs"], ["", "Period overview"], ["register", "Payroll register"], ["time", "Time calculation"], ["absence", "Absence balances"]] },
  { group: "Tie it out", items: [["reconciliation", "Reconciliation"], ["gl", "General ledger"], ["international", "International"]] },
  { group: "Govern", items: [["controls", "Controls and audit"], ["data", "Data and demo"], ["docs", "Design documents"]] },
];

export default function App() {
  const { data, error } = useData();
  const { erp, me, setPersona, periodId, setPeriod } = useErp();
  const { path, query } = useRoute();
  const page = path[0] ?? "";

  const body = () => {
    if (error) return <div className="callout bad">{error}</div>;
    if (!data) return <div className="loading">Loading the data package and calculating the period…</div>;
    switch (page) {
      case "inbox": return <Inbox query={query} />;
      case "workers": return <Workers id={path[1]} query={query} />;
      case "time-entry": return <TimeEntry query={query} />;
      case "time-off": return <TimeOff query={query} />;
      case "setup": return <Setup query={query} />;
      case "payruns": return <PayRuns />;
      case "register": return <Register id={path[1]} query={query} />;
      case "time": return <Time id={path[1]} />;
      case "absence": return <Absence query={query} />;
      case "reconciliation": return <Reconciliation id={path[1]} query={query} />;
      case "gl": return <Ledger query={query} />;
      case "international": return <International />;
      case "controls": return <Controls />;
      case "data": return <DataFiles />;
      case "docs": return <Docs slug={path[1]} />;
      default: return <Dashboard query={query} />;
    }
  };

  const unexplained = data?.result.recon.counts.Unexplained ?? 0;
  const tiesOk = data ? data.result.ties.every((t) => t.ok) : true;
  const toApprove = erp.bps.filter((b) => b.status === "Awaiting Approval" && b.initiatedBy !== me.id && BP_RULES[b.type].approvers !== "auto" && (BP_RULES[b.type].approvers as string[]).includes(me.role)).length;
  const run = erp.payRuns[periodId]?.status ?? "Not started";

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          NeoCloud People and Payroll
          <small>Workday-style HCM and payroll</small>
        </div>
        <label className="side-select">
          <span>Signed in as</span>
          <select value={me.id} onChange={(e) => setPersona(e.target.value)}>
            {PERSONAS.map((p) => <option key={p.id} value={p.id}>{p.name}, {p.role}</option>)}
          </select>
        </label>
        <label className="side-select">
          <span>Pay period</span>
          <select value={periodId} onChange={(e) => setPeriod(e.target.value)}>
            {US_PERIODS.map((p) => <option key={p.id} value={p.id}>{PERIOD_LABEL[p.id]}</option>)}
          </select>
          {data && <span className="side-note">Check date {pretty(data.result.period.checkDate)}. Pay run: {run}.</span>}
        </label>
        <nav className="nav" aria-label="Main">
          {NAV.map((g) => (
            <div key={g.group} style={{ display: "contents" }}>
              <div className="nav-group">{g.group}</div>
              {g.items.map(([href, label]) => (
                <a key={href} href={`#/${href}`} aria-current={page === href ? "page" : undefined}>
                  {label}
                  {href === "inbox" && toApprove > 0 && <span className="badge">{toApprove}</span>}
                  {href === "reconciliation" && data && data.result.reconciled && <span className="count">{unexplained ? `${unexplained} open` : "tied"}</span>}
                  {href === "" && data && <span className="count">{tiesOk ? "ties" : "check"}</span>}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          {data && <>Calculated in {data.ms} ms in your browser. Data you enter is saved in this browser only.</>}
        </div>
      </aside>
      <main className="main">{body()}</main>
    </div>
  );
}
