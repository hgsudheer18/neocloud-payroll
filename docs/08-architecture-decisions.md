# Architecture decision record

Each decision lists the context, the options considered, the choice and why. The last section records what was delegated to the AI coding tool and what was overridden.

## ADR-01: Application shape: static React app that ingests CSVs

**Context.** The brief asks for a web app on Vercel that ingests the provided CSV files, calculates one pay period, reconciles it and shows the results, and can be run locally in under ten minutes. It does not ask for transaction entry, users or persistence.

| Option | For | Against |
|---|---|---|
| Next.js + Postgres, with hire/terminate forms | Feels like an HR system | A database, migrations and auth to set up and secure; none of it is needed to calculate one period from files; more to go wrong in a 10-minute local setup |
| Python (Streamlit / FastAPI) | Quick to prototype | Weak fit for Vercel; harder to make a polished, filterable UI |
| Spreadsheet | Familiar to Finance | Ruled out by the brief |
| **React single-page app, bundled with esbuild, static on Vercel** | One language end to end; no server needed; `npm install && npm run dev` | Calculation runs on each page load (fine at this scale, see ADR-02) |

**Decision.** React + TypeScript single-page app. esbuild bundles it (one small build script instead of a framework), hash routing so any static host works, plain CSS. One optional Vercel function exists only for the AI commentary, because it must hold an API key.

The first plan (before the full brief arrived) was Next.js + Postgres with hire-to-terminate screens. The first build delivered the brief's calculation and reconciliation over the provided files. The ERP layer (hire to terminate, time, absence, pay runs with approvals) was then added on top without changing the engine: see ADR-14 to ADR-17.

## ADR-02: Calculation logic is a pure TypeScript engine, separate from the UI

**Context.** The brief requires rules to be "readable and testable on their own".

**Decision.** `lib/` contains every rule and has no UI, network or file-system code (except `lib/data/fs.ts`, the Node file reader). `src/` only renders `PeriodResult`. The engine is a set of pure functions:

```
CSV text → loadDataset() → Dataset → runPeriod() → PeriodResult → React pages
```

**Where it runs.** In the browser. The same engine also runs in Node for the tests, the data generator and the results report, so the numbers in the documents are the numbers in the app. Running in the browser means a payroll analyst can upload real CSVs on the Data files page and nothing leaves their machine.

**Scale.** The full period (280 US workers, 69 international, reconciliation with re-performance) calculates in about 130 ms in the browser. At 5,000 workers the same functions would move to a server or background job unchanged, because they have no UI dependencies.

## ADR-03: Effective-dated data, materialized to a per-day timeline

**Context.** Workday never overwrites a worker's data: it stacks changes with effective dates. This period has a mid-period hire, termination, leave, comp change and state move.

| Option | Assessment |
|---|---|
| Snapshot per worker (overwrite) | Cannot prorate or split; history lost |
| Segments (start/end ranges) per attribute | Correct but every calculation has to intersect ranges |
| **Base record + change events, materialized into one row per day for the period** | Proration, state allocation, cost center split and leave are all a simple group-by over days |

**Decision.** `workers.csv` holds each worker as of period start (or hire). `worker_events.csv` holds changes (`field`, `old_value`, `new_value`, `effective_date`, `entered_on`). `buildTimeline()` produces 15 day rows with salary, rate, state, location, cost center, employed, on leave and working day. Salary is then `annual ÷ 24 × paid working days ÷ working days`, grouped by salary, then split by state and cost center. The `entered_on` date is kept because it explains timing variances (a change entered after a cutoff).

## ADR-04: Money in integer cents, rounded once per line

**Decision.** All amounts are integer minor units. A rate × hours or base × percentage is computed once and rounded half-up at the pay-line level. When a total must be split (employer taxes across cost centers, 401(k) across states), `allocate()` uses the largest-remainder method so the parts always add back to the total. Without this, "the numbers tie" fails on the first floating-point sum.

## ADR-05: Rules are effective-dated configuration, not code

**Decision.** Tax tables (`lib/config/usTax.ts`), pay components, absence plans, country rules and the control matrix are data. Each tax table has an effective date and a source note (EXERCISE value from the brief vs ACTUAL published value). The engine looks rules up `asOf(checkDate)`, so a new tax year is a new row, and a change is reviewed like code (pull request = change ticket, see control PR-10).

The brief's Social Security wage base ($168,600) is the 2024 value; the actual 2026 base is $184,500. Both are recorded; the engine uses the brief's value as instructed, and the reconciliation shows the impact and states that legacy is right in real life.

Tax calculations are deliberately approximate (annualized federal percentage method with 2026 brackets, a progressive CA table, flat rates for other states). The brief tests structure, so the structure is exact: each tax has its own taxable wage base built from component taxability.

## ADR-06: Time calculation design

**Decisions.**
- Work in integer minutes; convert to hours only for display and rate multiplication.
- A shift belongs to the workday it starts on (a 22:00–06:30 shift is one workday).
- Order of evaluation: clean → shifts → night minutes → meal compliance → seventh day → daily OT/DT → weekly OT → regular rate. Each step consumes hours so nothing is paid twice.
- Weekly OT is allocated chronologically (the hours that cross 40 are the later ones), which also makes pay-as-worked across period boundaries stable.
- Overtime uses the regular rate including the night differential, implemented as a separate `OT_ADJ` line so the base-rate OT line stays easy to read.
- Prior-period days of a straddling workweek are included in the data so the weekly test is correct; the difference between what they should have earned and what was paid is `RETRO`.

**Alternative rejected.** Splitting midnight shifts by calendar day: creates two short days, breaks the consecutive-day logic and does not match how California defines a workday.

## ADR-07: Reconciliation by re-performance

**Context.** The brief asks for every legacy variance to be identified, classified and explained.

| Option | Assessment |
|---|---|
| Compare totals within a tolerance | Hides individual errors |
| Compare per employee and let a person write explanations | Doesn't scale, and explanations are unverified |
| **Compare every column per employee; explain by re-performing the calculation under plausible causes** | Each explanation is proven to the cent |

**Decision.** `lib/engine/reconcile.ts` compares 20 register columns per employee. For each variance it selects the hypotheses that the worker's own data makes plausible (an event in the period, a garnishment on file, a time exception, YTD near the wage base, worker type), recalculates under combinations of them, and accepts an explanation only if it reproduces the legacy row on every column to the cent. The impact of each cause is attributed by applying them one at a time. Anything else is "Unexplained" and fails the control total. Each hypothesis carries its classification (legacy error, configuration difference, timing, data), which system is correct, and the action for a real parallel.

The reconciliation never reads the list of errors seeded into the legacy file (ADR-09); it has to rediscover them. A test asserts this works.

## ADR-08: Journal design and export

**Decisions.** Summarized by subsidiary × account × cost center × location (82 US lines, not 280 × components). Employer taxes and benefits are spread to cost centers in proportion to each worker's earnings by cost center. Every line is validated against the account and segment mappings and every journal must balance before export is enabled. External IDs make imports idempotent. Accounting date is the period end date so expense lands in the month worked. International journals post provider actuals in local currency; USD is a reporting view.

## ADR-09: Extending the sample data, and how the legacy register was produced

**Context.** The data package contained only sample rows, with a note to the hiring team to extend them before sending.

**Decision.** `scripts/generate-data.ts` extends the samples deterministically (seeded random numbers, so the files are reproducible). Every sample row from the brief is kept exactly (E0001, E0004, E0006, E0008, E0009, E0021, E0022, E0148, E0149, E0203, the timesheet rows and the balances), and every edge case the brief lists is present.

The legacy Rippling register is produced by running the engine with Rippling's assumed configuration (2026 SS wage base, no CA meal premiums) plus a documented list of seeded errors (hire date, missed leave, comp change from period start, missed state move, missing garnishment, missing payout, duplicate punch, unprocessed correction, contractor paid). Using the engine to create the legacy file risks circularity, so two safeguards apply: the reconciliation does not read that list, and the classification is driven only by the worker's data. If the hiring team provides their full CSVs, they replace these files (same names and columns) and the reconciliation runs on them.

## ADR-10: What is deliberately out of scope

- **Server-side persistence and real logins.** Transactions are saved in the browser and roles are switched with a persona selector (ADR-15). In production, Workday is the system of record and identity comes from SSO.
- **Full tax engine.** Out of scope per the brief; structure is complete, rates are approximations, documented in config.
- **Colorado FAMLI, NY SDI, local taxes, supplemental withholding method choices.** Noted in the design where relevant.

## ADR-11: Testing strategy

- `node:test` with Node's built-in TypeScript type stripping: no test framework to install.
- **Golden values computed by hand** before asserting them: overtime (CA daily, TX weekly, no pyramiding, seventh day, consecutive days across workweeks, regular rate), meal premiums, duplicate punch, retro, proration (hire, leave, comp change, state split), termination accrual and payout, garnishment limit, wage base, GL validation, absence accruals, re-performance.
- **End-to-end ties**: a test fails if any control total stops tying or any variance becomes unexplained.
- 46 tests, about two seconds: calculation rules, plus the ERP layer (business processes, completed-period reproducibility, retro, roll-forward, biweekly go-live, entry validations).

## ADR-12: AI in payroll operations (bonus feature)

**Decision.** One feature in depth: Controller variance commentary. A deterministic template always produces the commentary from engine results. Optionally, Claude rewrites it as prose, with four guardrails: only aggregated, de-identified figures leave the browser (and the server rejects anything that looks like an employee ID); instructions are fixed on the server; every currency amount in the reply must exactly match a number in the payload or the draft is blocked; output is labelled a draft for human review and never changes a calculation. See `docs/09-ai-in-payroll.md`.

**Rejected.** Letting an LLM calculate or reconcile: payroll needs determinism and audit evidence. Natural-language querying over employee-level data: a larger privacy surface than the value justifies for this exercise.

## ADR-13: Interface design

A payroll console for a CFO, Controller and payroll analysts: dense tables with tabular numerals, sentence-case labels, and one memorable element, the register tables banded like green-bar ledger paper. The overview opens with the control totals (does the period tie?) rather than with headline numbers, because that is the question the Controller asks first. Every number links to its explanation (payslip lines, daily time, reconciliation causes).

## ADR-14: ERP layer as business processes over the data package

**Context.** The panel and an observer will use the app hands-on: hire, change, terminate, enter time, request time off, and run payroll, like Workday.

| Option | Assessment |
|---|---|
| Edit the CSV rows in place | No history, no approvals, and a completed period would change under you |
| CRUD screens over tables | Easy, but nothing records who changed what, when, or effective when |
| **Business processes, applied on top of the base package** | Mirrors Workday: every change is a BP with initiator, approver, effective date and entry time |

**Decision.** Every change is a business process (`lib/erp/types.ts`): Hire, Change Compensation, Change Cost Center, Change Location, Leave of Absence, Return from Leave, Terminate, Enter Time, Request Time Off, and configuration (company, location, cost center, job profile). The dataset the engine calculates is always **base package + business processes approved up to a moment** (`lib/erp/apply.ts`). The engine did not change: a hire becomes a worker row, a raise becomes an effective-dated event, a timesheet becomes a time block.

**Consequences.**
- **Bitemporal by construction.** Every change has an effective date (when it applies) and a decision time (when it was known). A completed pay period is reproduced exactly by applying only the BPs approved before it was completed, so a locked period never changes.
- **Retro is automatic.** For the next period the engine recalculates the completed period with everything known now and pays the difference as RETRO. A raise backdated into a paid period, a late termination (negative retro, flagged as an overpayment) and late time all work the same way.
- **Approvals and segregation of duties are rules, not screens.** `BP_RULES` lists who may start and who may approve each process; the approver can never be the initiator. Pay runs require a different approver from the calculator, and critical audit findings need a recorded resolution.

## ADR-15: Where the data is stored: the browser, for now

**Context.** An observer must be able to use the app tomorrow from a link, with no setup, and without affecting anyone else's demo.

| Option | For | Against |
|---|---|---|
| **Browser storage (localStorage)** | Zero setup; each visitor gets a private sandbox; no payroll data on a server; nothing to break during the demo | Not shared between people or devices |
| Hosted database (e.g. Postgres on Neon or Supabase) | Shared, persistent, multi-user | Accounts, credentials, migrations and a running service: more setup and more failure points before a demo; holds personal data |

**Decision.** Browser storage, with **Download my demo data / Load demo data** so a prepared scenario can be handed to someone else, and **Reset demo data** to return to the original package. Reads and writes are wrapped so the app still works if storage is blocked.

**Production path.** The business-process log is an append-only list, so it maps directly onto a database table (one row per BP) behind an API, with SSO for identity. In the real implementation Workday is that database.

## ADR-16: Pay groups: hourly biweekly, salaried semi-monthly

**Decision.** At go-live hourly (non-exempt) workers move to a US Biweekly pay group: each period is exactly two Sunday–Saturday workweeks, so weekly overtime, double time, seventh-day and regular-rate adjustments never split across periods. Salaried workers stay semi-monthly. The Oct 1–15 parallel run stays semi-monthly for everyone to match the legacy register. The transition period Oct 16–31 contains a 2-day stub completing the Oct 11–17 workweek. Details and trade-offs are in the Workday Payroll design document.

**Implementation.** Pay periods are configuration with a "builds on" link (`PRIOR_PERIOD`). Each period starts from its prior period as completed: YTD taxable wages and absence balances roll forward, and per-period deductions convert from 24 to 26 periods for the biweekly group.

## ADR-17: Validations at entry, not only at payroll

**Decision.** The same rules that the payroll audit reports are enforced when data is entered (`lib/erp/validate.ts`):
- **Time:** duplicate or overlapping blocks and shifts over 16 hours are blocked; CA meal problems and long shifts are warned and recorded on the BP.
- **Hire:** 2026 California minimum wage ($16.90) and exempt salary threshold ($70,304), supported work states, required fields.
- **Time off:** eligibility, balance including pending requests, waiting period, double booking.

Preventing a bad entry is cheaper than explaining it in a reconciliation.

## What the AI tool decided, and what was overridden

| Area | AI tool generated | Human decision or override |
|---|---|---|
| Overall approach | Proposed Next.js + Postgres with HR transaction screens | Overridden after reading the full brief: stateless CSV-ingesting app (ADR-01) |
| Engine code | Generated nearly all of `lib/` | Rules, order of evaluation and edge-case treatments specified and reviewed line by line against hand calculations |
| Pay group design | Proposed one semi-monthly pay group for everyone | Overridden: hourly workers on a biweekly pay group so overtime weeks are never split (ADR-16) |
| Scope | Built the brief's calculate-and-reconcile app first | Extended to a working ERP with business processes and pay runs, because the panel will use it hands-on (ADR-14) |
| Wage base | Flagged that the brief's $168,600 is the 2024 figure | Decision: keep the brief's value, record the actual, surface it as a configuration difference |
| Reconciliation method | Proposed re-performance of hypotheses | Accepted; added the rule that the reconciler never reads the seeded-error list |
| Data generation | Generated the population and edge cases | Required all sample rows kept verbatim; required generated data to pass the same validation as uploaded data |
| Documents | Drafted all documents | Every figure checked against engine output; the period results document is generated from the engine to prevent drift |

Where the AI tool was wrong, and how it was caught, is in the README.
