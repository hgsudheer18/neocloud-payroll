import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readTexts } from "../lib/data/fs.ts";
import { loadDataset } from "../lib/data/load.ts";
import { runPeriod } from "../lib/engine/run.ts";
import { buildPayload, groundingCheck, templateCommentary, SYSTEM_PROMPT } from "../lib/ai/commentary.ts";
// @ts-expect-error plain JS Vercel function
import { SYSTEM } from "../api/commentary.js";

const { ds } = loadDataset(readTexts(join(import.meta.dirname, "..", "data")));
const payload = buildPayload(runPeriod(ds));

test("Payload sent to the model contains no employee identifiers", () => {
  assert.doesNotMatch(JSON.stringify(payload), /\b[EC]\d{4}\b/);
});

test("Deterministic commentary passes its own grounding check", () => {
  assert.equal(groundingCheck(templateCommentary(payload), payload).ok, true);
});

test("Grounding check blocks invented amounts and identifiers", () => {
  assert.equal(groundingCheck("Legacy overpaid $9,999.99 overall.", payload).ok, false);
  assert.equal(groundingCheck(`Gross was ${payload.totals.gross}; see E0148.`, payload).ok, false);
  assert.equal(groundingCheck(`Gross was ${payload.totals.gross}.`, payload).ok, true);
});

test("Server instructions match the documented prompt", () => {
  assert.equal(SYSTEM, SYSTEM_PROMPT);
});
