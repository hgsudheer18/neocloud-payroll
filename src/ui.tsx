import { useState } from "react";
import type { ReactNode } from "react";
import { fmt } from "../lib/util/money.ts";

export function Money({ c, cur = "USD", signed = false }: { c: number; cur?: string; signed?: boolean }) {
  const cls = c < 0 ? "neg" : c === 0 ? "zero" : "";
  return <span className={cls}>{signed && c > 0 ? "+" : ""}{fmt(c, cur)}</span>;
}

/** An amount hidden until clicked (an employee's own net pay), like a banking app. */
export function MaskedMoney({ c, cur = "USD" }: { c: number; cur?: string }) {
  const [shown, setShown] = useState(false);
  return (
    <button type="button" className="masked" onClick={() => setShown(!shown)} title={shown ? "Hide" : "Show net pay"} aria-label={shown ? "Hide net pay" : "Show net pay"} style={{ background: "none", border: 0, padding: 0, font: "inherit", color: "inherit", cursor: "pointer" }}>
      {shown ? <Money c={c} cur={cur} /> : <span>$ ••••••</span>} <span className="faint small" style={{ fontWeight: 400 }}>{shown ? "hide" : "show"}</span>
    </button>
  );
}

export function Hours({ h }: { h: number }) {
  return <span className={h === 0 ? "zero" : ""}>{h.toFixed(2)}</span>;
}

export function Pill({ tone = "", children }: { tone?: "ok" | "warn" | "bad" | "info" | ""; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  // No title: the page sits inside a section that has its own heading (e.g. a tab of Absence).
  if (!title) return children ? <p className="muted" style={{ marginTop: 0 }}>{children}</p> : null;
  return (
    <header className="page-head">
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </header>
  );
}

export function Section({ title, lede, children, right }: { title?: string; lede?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="section">
      {(title || right) && (
        <div className="row" style={{ marginBottom: lede ? 0 : 8 }}>
          {title && <h2>{title}</h2>}
          <span className="spacer" />
          {right}
        </div>
      )}
      {lede && <p className="lede">{lede}</p>}
      {children}
    </section>
  );
}

export function Select({ label, value, onChange, options, all = "All" }: { label: string; value: string; onChange: (v: string) => void; options: (string | [string, string])[]; all?: string | null }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {all !== null && <option value="">{all}</option>}
        {options.map((o) => {
          const [v, l] = Array.isArray(o) ? o : [o, o];
          return (
            <option key={v} value={v}>
              {l}
            </option>
          );
        })}
      </select>
    </label>
  );
}

export function Bars({ rows, max }: { rows: { label: string; parts: number[]; total: number; note?: string }[]; max?: number }) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.total));
  const cls = ["", "er", "ben"];
  return (
    <div className="bars">
      {rows.map((r) => {
        let left = 0;
        return (
          <div className="bar-row" key={r.label}>
            <span>{r.label}</span>
            <div className="bar-track" role="img" aria-label={`${r.label}: ${fmt(r.total)}`}>
              {r.parts.map((p, i) => {
                const w = (p / m) * 100;
                const el = <div key={i} className={`bar-fill ${cls[i]}`} style={{ left: `${left}%`, width: `${w}%` }} />;
                left += w;
                return el;
              })}
            </div>
            <span className="n" style={{ textAlign: "right" }}>
              {fmt(r.total)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function downloadText(name: string, text: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const sevTone = (s: string): "bad" | "warn" | "info" => (s === "Critical" || s === "Error" ? "bad" : s === "Warning" ? "warn" : "info");
