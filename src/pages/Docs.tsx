import { useEffect, useState } from "react";
import { marked } from "marked";
import { PageHead } from "../ui.tsx";

interface DocMeta { slug: string; file: string; title: string; summary: string }

export default function Docs({ slug }: { slug?: string }) {
  const [list, setList] = useState<DocMeta[] | null>(null);
  const [html, setHtml] = useState<string>("");
  useEffect(() => {
    fetch("docs/manifest.json").then((r) => r.json()).then(setList).catch(() => setList([]));
  }, []);
  useEffect(() => {
    if (!slug || !list) return;
    const d = list.find((x) => x.slug === slug);
    if (!d) return;
    fetch(`docs/${d.file}`).then((r) => r.text()).then((t) => setHtml(marked.parse(t, { async: false }) as string));
    window.scrollTo(0, 0);
  }, [slug, list]);

  if (!list) return <div className="loading">Loading documents…</div>;
  if (slug) {
    return (
      <>
        <p><a href="#/docs">All design documents</a></p>
        <article className="doc" dangerouslySetInnerHTML={{ __html: html }} />
      </>
    );
  }
  return (
    <>
      <PageHead title="Design documents">The Workday configuration design, integrations, controls and cutover plan, and the architecture decision record. The same files are in the repository's docs folder.</PageHead>
      <div className="doc-list">
        {list.map((d) => (
          <a key={d.slug} className="doc-card" href={`#/docs/${d.slug}`}>
            <strong>{d.title}</strong>
            <span className="small muted">{d.summary}</span>
          </a>
        ))}
      </div>
    </>
  );
}
