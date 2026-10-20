import { setQuery } from "../router.tsx";
import { PageHead } from "../ui.tsx";
import { useAccess } from "../access.tsx";
import TimeOff from "./TimeOff.tsx";
import TeamTimeOff, { UpcomingTimeOff } from "./TeamTimeOff.tsx";
import AbsenceBalances from "./Absence.tsx";

/** Everything about absence in one place: your time off, your team's, and balances. */
const TABS: { key: string; label: string; page: string }[] = [
  { key: "mine", label: "My Time Off", page: "time-off" },
  { key: "team", label: "Team Time Off", page: "team-time-off" },
  { key: "upcoming", label: "Upcoming Time Off", page: "upcoming-time-off" },
  { key: "balances", label: "Absence Balances", page: "absence" },
];

export default function AbsenceHub({ query, tab: forced }: { query: URLSearchParams; tab?: string }) {
  const access = useAccess();
  const tabs = TABS.filter((t) => access.canOpen(t.page));
  const asked = forced ?? query.get("tab") ?? "mine";
  const tab = tabs.some((t) => t.key === asked) ? asked : "mine";
  return (
    <>
      <PageHead title="Absence" />
      {tabs.length > 1 && (
        <div className="tabs" role="tablist">
          {tabs.map((t) => <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setQuery("/time-off", { tab: t.key })}>{t.label}</button>)}
        </div>
      )}
      {tab === "mine" && <TimeOff query={query} embedded />}
      {tab === "team" && <TeamTimeOff query={query} embedded />}
      {tab === "upcoming" && <UpcomingTimeOff embedded />}
      {tab === "balances" && <AbsenceBalances query={query} embedded />}
    </>
  );
}
