import { useData } from "./state.tsx";
import { useRoute } from "./router.tsx";
import { pretty } from "../lib/util/dates.ts";
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

const NAV: { group: string; items: [string, string][] }[] = [
  { group: "Run the period", items: [["", "Period overview"], ["register", "Payroll register"], ["time", "Time calculation"], ["absence", "Absence balances"]] },
  { group: "Tie it out", items: [["reconciliation", "Reconciliation"], ["gl", "General ledger"], ["international", "International"]] },
  { group: "Govern", items: [["controls", "Controls and audit"], ["data", "Data files"], ["docs", "Design documents"]] },
];

export default function App() {
  const { data, error } = useData();
  const { path, query } = useRoute();
  const page = path[0] ?? "";

  const body = () => {
    if (error) return <div className="callout bad">{error}</div>;
    if (!data) return <div className="loading">Loading the data package and calculating the period…</div>;
    switch (page) {
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

  const p = data?.result.period;
  const unexplained = data?.result.recon.counts.Unexplained ?? 0;
  const tiesOk = data ? data.result.ties.every((t) => t.ok) : true;

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          NeoCloud Payroll
          <small>Workday parallel-run console</small>
        </div>
        {p && (
          <div className="stamp">
            <strong>{p.payGroup}</strong>
            {pretty(p.start)} to {pretty(p.end)}, 2026
            <br />
            Check date {pretty(p.checkDate)}
            <br />
            International: October 2026 (monthly)
          </div>
        )}
        <nav className="nav" aria-label="Main">
          {NAV.map((g) => (
            <div key={g.group} style={{ display: "contents" }}>
              <div className="nav-group">{g.group}</div>
              {g.items.map(([href, label]) => (
                <a key={href} href={`#/${href}`} aria-current={page === href ? "page" : undefined}>
                  {label}
                  {href === "reconciliation" && data && <span className="count">{unexplained ? `${unexplained} open` : "tied"}</span>}
                  {href === "" && data && <span className="count">{tiesOk ? "ties" : "check"}</span>}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          {data && (
            <>
              {data.source === "uploaded" ? "Using uploaded files" : "Using the bundled data package"}
              <br />
              Calculated in {data.ms} ms in your browser
            </>
          )}
        </div>
      </aside>
      <main className="main">{body()}</main>
    </div>
  );
}
