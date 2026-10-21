// Build: bundle the React app with esbuild and copy the data package and the
// design documents next to it. Output is a static site in ./dist (plus the
// optional /api function, which Vercel deploys separately).
import * as esbuild from "esbuild";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const dist = join(root, "dist");

export const buildOptions = {
  entryPoints: [join(root, "src/main.tsx")],
  bundle: true,
  format: "esm",
  target: "es2020",
  jsx: "automatic",
  outfile: join(dist, "app.js"),
  sourcemap: true,
  minify: process.env.NODE_ENV !== "development",
  define: { "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV === "development" ? "development" : "production") },
  nodePaths: process.env.ESBUILD_NODE_PATHS ? process.env.ESBUILD_NODE_PATHS.split(":") : [],
  logLevel: "info",
};

export function copyStatic() {
  mkdirSync(join(dist, "data"), { recursive: true });
  mkdirSync(join(dist, "docs"), { recursive: true });
  cpSync(join(root, "index.html"), join(dist, "index.html"));
  cpSync(join(root, "src/styles.css"), join(dist, "styles.css"));
  const csvs = readdirSync(join(root, "data")).filter((f) => f.endsWith(".csv")).sort();
  for (const f of csvs) cpSync(join(root, "data", f), join(dist, "data", f));
  writeFileSync(join(dist, "data/manifest.json"), JSON.stringify(csvs));
  const docs = readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md")).sort();
  const meta = docs.map((file) => {
    const text = readFileSync(join(root, "docs", file), "utf8");
    cpSync(join(root, "docs", file), join(dist, "docs", file));
    const title = (text.match(/^#\s+(.+)$/m) ?? [, file])[1];
    const summary = (text.split("\n").find((l) => l.trim() && !l.startsWith("#") && !l.startsWith(">") && !l.startsWith("|")) ?? "").slice(0, 220);
    return { slug: file.replace(/^\d+-/, "").replace(/\.md$/, ""), file, title, summary };
  });
  writeFileSync(join(dist, "docs/manifest.json"), JSON.stringify(meta));
  // Presenter's scenario: loaded for every first-time visitor (see src/erp.tsx).
  // scenario/demo-scenario.json, or else the newest neocloud-demo-*.json in the project folder.
  const named = join(root, "scenario/demo-scenario.json");
  const dropped = readdirSync(root).filter((f) => /^neocloud-demo-.*\.json$/.test(f)).sort().pop();
  const scenario = existsSync(named) ? named : dropped ? join(root, dropped) : null;
  if (scenario) {
    cpSync(scenario, join(dist, "scenario.json"));
    console.log(`Presenter scenario: ${scenario.slice(root.length + 1)}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  await esbuild.build(buildOptions);
  copyStatic();
  console.log("Built ./dist");
}
