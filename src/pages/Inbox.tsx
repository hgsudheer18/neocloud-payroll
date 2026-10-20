import { useEffect, useRef, useState } from "react";
import { useErp } from "../erp.tsx";
import { setQuery } from "../router.tsx";
import { PageHead, Pill, Section } from "../ui.tsx";
import { BpStatus, Toast, who } from "../erpui.tsx";
import { BP_RULES, type BusinessProcess } from "../../lib/erp/types.ts";
import { useAccess } from "../access.tsx";

export default function Inbox({ query }: { query: URLSearchParams }) {
  const { erp, me, decide } = useErp();
  const access = useAccess();
  const bps = erp.bps.filter(access.seesBp);
  const tab = query.get("tab") ?? "mine";
  // Opened from a status link: highlight that item and bring it into view.
  const focus = query.get("bp") ?? "";
  const focusRow = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    focusRow.current?.scrollIntoView({ block: "center" });
  }, [focus]);
  const [comment, setComment] = useState("");
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "bad" }>({ text: "", tone: "ok" });
  const awaiting = bps.filter((b) => b.status === "Awaiting Approval");
  const canApprove = (b: BusinessProcess) => {
    const r = BP_RULES[b.type].approvers;
    return r !== "auto" && r.includes(me.role) && (b.initiatedBy !== me.id || me.role === "Administrator");
  };
  const mine = awaiting.filter(canApprove);
  const list = tab === "mine" ? mine : tab === "all" ? awaiting : [...bps].reverse();

  const act = (b: BusinessProcess, approve: boolean) => {
    const err = decide(b.id, approve, comment || undefined);
    setMsg(err ? { text: err, tone: "bad" } : { text: `${b.id} ${approve ? "approved" : "denied"}.`, tone: "ok" });
  };
  const approveAll = () => {
    let n = 0;
    for (const b of mine) if (!decide(b.id, true, comment || "Bulk approval")) n++;
    setMsg({ text: `Approved ${n} business process${n === 1 ? "" : "es"}.`, tone: "ok" });
  };

  return (
    <>
      <PageHead title="Inbox">
        Business processes waiting for a decision. You can approve only what your role is allowed to approve, and never something you started yourself (segregation of duties).
      </PageHead>
      <div className="tabs" role="tablist">
        {[["mine", `For me to approve (${mine.length})`], ["all", `All awaiting approval (${awaiting.length})`], ["log", `Business process log (${bps.length})`]].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setQuery("/inbox", { tab: k })}>{l}</button>
        ))}
      </div>
      <Toast text={msg.text} tone={msg.tone} />
      {(() => {
        const b = awaiting.find((x) => x.id === focus);
        if (!b || !canApprove(b)) return null;
        return (
          <div className="sheet" style={{ marginBottom: 16 }}>
            <h3>{b.id}: {b.type} for {b.subjectName}</h3>
            <p className="small">{b.summary}</p>
            {b.warnings?.map((x) => <div key={x} className="pos-var small">{x}</div>)}
            <p className="small muted">Started by {who(b.initiatedBy)}</p>
            <div className="row"><button className="btn" onClick={() => act(b, true)}>Approve</button><button className="btn ghost" onClick={() => act(b, false)}>Deny</button></div>
          </div>
        );
      })()}
      {tab !== "log" && (
        <div className="filters">
          <label>Comment (optional)<input type="text" value={comment} onChange={(e) => setComment(e.target.value)} style={{ minWidth: 320 }} /></label>
          {tab === "mine" && mine.length > 1 && <button className="btn" onClick={approveAll}>Approve all {mine.length}</button>}
        </div>
      )}
      <Section>
        {list.length === 0 ? (
          <div className="callout ok">{tab === "mine" ? `Nothing waiting for ${me.name} (${me.role}).` : "Nothing here yet."}</div>
        ) : (
          <div className="table-wrap" style={{ maxHeight: "68vh" }}>
            <table className="reg">
              <thead><tr><th>ID</th><th>Process</th><th>Subject</th><th>Summary</th><th>Effective</th><th>Initiated by</th><th>Status</th><th /></tr></thead>
              <tbody>
                {list.map((b) => (
                  <tr key={b.id} ref={b.id === focus ? focusRow : undefined} className={b.id === focus ? "sel" : undefined}>
                    <td>{b.id}</td>
                    <td>{b.type}</td>
                    <td>{/^E\d{4}$/.test(b.subjectId) ? <a href={`#/workers/${b.subjectId}`}>{b.subjectId}</a> : b.subjectId} {b.subjectName}</td>
                    <td className="small wrap">{b.summary}{b.warnings?.map((x) => <div key={x} className="pos-var">{x}</div>)}{b.comment && <div className="faint">Comment: {b.comment}</div>}</td>
                    <td>{b.effectiveDate}</td>
                    <td className="small">{who(b.initiatedBy)}<div className="faint">{new Date(b.initiatedAt).toLocaleString()}</div></td>
                    <td><BpStatus bp={b} />{b.decidedBy && <div className="faint small">{who(b.decidedBy)}</div>}</td>
                    <td>
                      {b.status === "Awaiting Approval" && (canApprove(b) ? (
                        <div className="row">
                          <button className="btn" onClick={() => act(b, true)}>Approve</button>
                          <button className="btn ghost" onClick={() => act(b, false)}>Deny</button>
                        </div>
                      ) : (
                        <span className="small faint">{b.initiatedBy === me.id ? "You started this" : `Needs ${(BP_RULES[b.type].approvers as string[]).join(" or ")}`}</span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      {tab === "log" && <p className="small muted">This log is the audit trail: who started each change, who approved it, and when. Configuration objects (companies, locations, cost centers, job profiles) are logged without an approval step. <Pill tone="info">Saved in this browser</Pill></p>}
    </>
  );
}
