// Hash routing: works on any static host without rewrite rules.
import { useEffect, useState } from "react";

export function useRoute(): { path: string[]; query: URLSearchParams } {
  const read = () => {
    const raw = window.location.hash.replace(/^#/, "") || "/";
    const [p, q = ""] = raw.split("?");
    return { path: p.split("/").filter(Boolean), query: new URLSearchParams(q) };
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => {
      setRoute(read());
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function go(path: string, query?: Record<string, string>) {
  const q = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v !== "")).toString() : "";
  window.location.hash = `${path}${q ? `?${q}` : ""}`;
}

/** Update query params on the current path without adding history noise. */
export function setQuery(path: string, query: Record<string, string>) {
  const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== "")).toString();
  history.replaceState(null, "", `#${path}${q ? `?${q}` : ""}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
