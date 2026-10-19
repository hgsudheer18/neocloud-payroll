// Local dev server: rebuilds on change and serves ./dist on http://localhost:5173
import * as esbuild from "esbuild";
import { mkdirSync, rmSync, watch } from "node:fs";
import { join } from "node:path";
process.env.NODE_ENV = "development";
const { buildOptions, copyStatic } = await import("./build.mjs");
const dist = join(process.cwd(), "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
copyStatic();
const ctx = await esbuild.context({ ...buildOptions, minify: false });
await ctx.watch();
for (const d of ["data", "docs", "src"]) watch(join(process.cwd(), d), { recursive: true }, () => copyStatic());
const port = Number(process.env.PORT || 5173);
await ctx.serve({ servedir: dist, port });
console.log(`NeoCloud Payroll running at http://127.0.0.1:${port}`);
