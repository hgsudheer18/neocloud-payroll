// Vercel serverless function: drafts Controller commentary with Claude.
// The API key stays server-side. The function refuses any payload that looks
// like it contains individual data (employee IDs, names, SSNs), and the client
// runs a grounding check on the reply before showing it.

const ID_PATTERN = /\b[EC]\d{4}\b|\b\d{3}-\d{2}-\d{4}\b|"name"\s*:/;

// Server-owned instructions: the browser cannot change them. Kept identical to
// SYSTEM_PROMPT in lib/ai/commentary.ts (a test enforces this).
export const SYSTEM = `You write payroll variance commentary for a Controller reviewing a parallel run.
Use ONLY the numbers in the JSON you are given, copied exactly as formatted. Never calculate new numbers, never estimate, never round.
Do not mention individuals. Plain English, at most 180 words, no headings, short paragraphs.
Cover: whether the period ties, the total legacy-minus-Workday difference, the biggest root causes and which system is correct, what must be fixed before cutover, and international timing items.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(501).json({ error: "AI commentary is not configured: set ANTHROPIC_API_KEY to enable it. The deterministic draft is shown instead." });

  const { payload } = req.body ?? {};
  const raw = JSON.stringify(payload ?? {});
  if (!payload || raw.length > 20000) return res.status(400).json({ error: "Missing or oversized payload." });
  if (ID_PATTERN.test(raw)) return res.status(400).json({ error: "Payload rejected: it appears to contain individual identifiers. Only aggregated, de-identified figures may be sent." });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
        max_tokens: 600,
        temperature: 0,
        system: SYSTEM,
        messages: [{ role: "user", content: `Payroll parallel-run results (JSON):\n${raw}` }],
      }),
    });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ error: j?.error?.message ?? "Model request failed." });
    const text = (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    return res.status(200).json({ text, model: j.model });
  } catch (e) {
    return res.status(502).json({ error: `Model request failed: ${e instanceof Error ? e.message : String(e)}` });
  }
}
