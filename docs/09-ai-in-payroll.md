# AI in payroll operations: Controller variance commentary

## The feature

Every parallel run and every live period ends with the same task: explain to the Controller why this period differs from the comparison (the legacy register in parallel; the prior period after go-live). The reconciliation engine already knows the answer in structured form: root causes, classification, which system is right, and the dollar impact of each. What takes an analyst an hour is turning that into a clear paragraph.

The app does this in two layers (Reconciliation → Controller commentary):

1. **Deterministic draft (always on).** A template turns the engine's results into commentary: totals, whether the period ties, the five largest drivers, legacy errors to fix before cutover, configuration differences to sign off, and international timing items. No AI involved; same input, same text.
2. **Claude draft (optional).** With `ANTHROPIC_API_KEY` set on Vercel, "Draft with Claude" sends the same aggregated facts to Claude for better prose. The model writes; it does not calculate.

## Why this use and not another

| Candidate | Verdict |
|---|---|
| **Variance commentary** | High value (recurring, time-consuming), low risk (aggregated input, human review, no effect on pay) |
| Pre-payroll audit checks | Built, but deterministic: audit rules must be repeatable and explainable to an auditor. AI could later suggest new rules from history |
| Anomaly detection vs trailing periods | Built deterministically (trailing-average checks); statistical models are worthwhile once there are 24+ periods of Workday history |
| Natural-language querying of results | Useful, but needs employee-level data in the prompt or tool access to it, a much larger privacy surface |

## Guardrails for HR and payroll data

| Risk | Guardrail | Where |
|---|---|---|
| Personal data sent to a model | Payload is built from cause-level totals and counts only; no names, IDs, rates or tax detail. Server rejects any payload matching an employee ID or SSN pattern | `lib/ai/commentary.ts` `buildPayload`; `api/commentary.js` |
| API key exposure | Key only in a Vercel server environment variable; the browser calls `/api/commentary` | `api/commentary.js` |
| Prompt tampering | System instructions are fixed on the server, not sent by the browser | `api/commentary.js` `SYSTEM` |
| Hallucinated numbers | Every dollar amount in the reply must exactly match a figure in the payload, and no employee IDs may appear; otherwise the draft is blocked and the deterministic draft stays | `groundingCheck()`, tested |
| Over-reliance | Output labelled "Draft: review before sending"; it never writes to the register or changes a calculation | UI |
| Vendor data handling | Production: enterprise agreement with zero data retention and no training on inputs; requests logged in the payroll audit trail; access limited to the Payroll Approver and Controller security groups | Operating procedure |
| Non-determinism | Temperature 0; deterministic template is the system of record for the commentary | Both |

## Example (deterministic draft for this period)

> Payroll for 2026-10-01 to 2026-10-15 (check date 2026-10-20): Workday calculated 280 workers, gross $1,973,794.91 and net $1,312,036.43. The legacy register has 280 rows, gross $1,986,453.42, so legacy is $12,658.51 higher on gross and $8,190.19 on net.
> All control totals tie: gross to net, register to journal, time to pay and headcount.
> 11 root causes explain every variance; 0 remain unexplained.

## What would come next

- Commentary against the prior live period (not only legacy) once Workday has history.
- An "ask the register" feature restricted to aggregate queries (by department, component, state) using tool calls that return aggregates only, so employee-level data never enters the prompt.
- Suggested pre-payroll audit rules: the model proposes candidate rules from past variances; a payroll analyst approves them into the deterministic rule set.
