# NeoCloud People and Payroll

A Workday-style HCM and payroll web app for NeoCloud. It does two jobs:

1. **Run the business, like an ERP.** Set up companies, locations, supervisory orgs, cost centers and job profiles; hire, change pay, cost center or location, place on leave and terminate workers; enter time and request time off; and run pay periods through *Calculate → Approve → Complete*. Every change is an effective-dated business process with an initiator and a different approver, and it lands in an inbox and an audit log.
2. **Prove the numbers, like a parallel run.** Ingest the CSV data package and calculate, reconcile and visualize the Oct 1–15, 2026 semi-monthly payroll, with time and absence, the October international provider payroll, the NetSuite journal and the controls evidence.

Pay groups: salaried employees are paid **semi-monthly**; hourly employees move to **biweekly** at go-live so overtime workweeks are never split. The app includes the Oct 1–15 parallel run, the Oct 16–31 salaried period, the Oct 16–31 biweekly transition period and Nov 1–14. Each period starts from the previous one as completed, and changes to a completed period are paid as retro.

Parallel-run results (Oct 1–15):

- 280 US workers paid, $1,973,794.91 gross, $2,299,341.55 burdened cost
- 25 non-exempt technicians under California and FLSA time rules
- Absence balances for six accruing plans across four countries, plus sick, bereavement and jury duty time off types without a balance
- Employee-level reconciliation to the legacy Rippling register: 262 match to the cent, 19 variances explained by re-performance, 0 unexplained
- Five balanced, fully mapped journals with a validated NetSuite export
- Every control total ties

## Run it locally (under 10 minutes)

Requirements: Node.js 22.6 or later (`node -v`).

```bash
npm install
npm run dev          # then open http://127.0.0.1:5173
```

Other commands:

```bash
npm test             # 46 tests: overtime, proration, termination payout, absence, GL, reconciliation, AI guardrails, business processes, retro, roll-forward, biweekly
npm run build        # static site in ./dist
npm run report       # regenerates docs/07-period-results.md from the engine
npm run generate     # regenerates the data package in ./data (deterministic)
npm run typecheck    # TypeScript
```

No environment variables are needed. `.env.example` lists the optional ones (only for the AI commentary).

If npm prints `install-scripts … esbuild` (newer npm versions ask before running a package's setup script), run `npm install-scripts approve esbuild` and then `npm install` again.

## Try the workflow

The sidebar has two selectors: **Signed in as** (switch between Employee, Manager, HR Partner, Payroll Specialist and Payroll Approver) and **Pay period**. A full scripted walkthrough is in [docs/10-demo-script.md](docs/10-demo-script.md). In short:

1. **Payroll Specialist → Pay runs → Calculate** Oct 1–15; **Payroll Approver → Approve → Complete** (a different person must approve).
2. **HR Partner → Workers → Hire a worker**; **Manager → Inbox → Approve**.
3. **Employee → Enter time / Absence**; **Manager → Inbox → Approve**. Or **Payroll Specialist → Pay runs → Auto-fill scheduled shifts**.
4. Select **Oct 16–31** in the sidebar and run the next pay periods. Changes made to Oct 1–15 after it was completed show up as retro.

Everything you enter is saved in your browser only, so every visitor gets a private sandbox. **Data and demo** has *Download my demo data*, *Load demo data* and *Reset demo data*.

## Deploy to Vercel

1. Push this folder to a GitHub repository.
2. In Vercel: **Add New → Project**, import the repository. The settings come from `vercel.json` (build `npm run build`, output `dist`); no framework preset is needed.
3. Optional: add `ANTHROPIC_API_KEY` under **Settings → Environment Variables** to enable "Draft with Claude" on the Controller commentary tab. Everything else works without it.

Or from the command line: `npx vercel` then `npx vercel --prod`.

## Using your own CSV files

The app reads the files in `data/`. To use the hiring team's files, either replace the files in `data/` (same names and columns) and redeploy, or open **Data files** in the app and upload them. Uploaded files are processed in the browser and never sent to a server. The page validates every file (required columns, dates, numbers, duplicate IDs, unknown references) before calculating.

## What's in the app

| Page | Requirement | What it shows |
|---|---|---|
| Inbox | ERP | Business processes awaiting your approval; full business-process log |
| Home | ERP | Landing page for every role: what is waiting on you, next pay date and net pay, time off balances, this week's timesheet; managers: who is off this week and missing timesheets; HR: workforce and open positions; payroll: the pay run status, errors to fix and time not yet approved. A notification bell (top right) lists approvals waiting, decisions on your requests, pay slips available and timesheets due |
| Workers | ERP | Directory, hire, worker profile with effective-dated history; change pay, cost center or location, leave, return, terminate |
| Staffing | ERP | Eight positions to fill from Oct 19, 2026: four hourly technicians (biweekly; day and night shifts in San Jose and Austin) and four salaried roles (semi-monthly). Hire into this position pre-fills the hire; the position shows as filled once the hire is approved. A mid-period hire is paid from the hire date (salaried by working days, hourly by time worked) |
| Organisation | ERP | Your organisation hierarchy and the company's organisations (CEO; Finance with People Technology; CIO Organisation with Engineering and GPU Cloud in the USA; International; On-Prem), with tabs for compensation, pay group and job profile. Open positions (CIO, Head of International, Head of People Technology) are shown as such. Structure in `lib/config/org.ts` |
| My Information | ERP | Contact details, emergency contact, bank account for pay (only the last four digits kept) and W-4 filing status. Changes go for approval: personal details to HR, bank and tax to payroll; an approved W-4 is used by the next pay run |
| Documents | ERP | Pay slips by period, offer letter and W-4 on file, printable or saved as PDF; the 2026 W-2 is issued by Jan 31, 2027 |
| Enter time | 3, ERP | Weekly timesheet grid (Sunday to Saturday) for hourly workers, with daily and weekly totals on the same grid (total hours, regular, daily and weekly overtime, double time, 7th-day hours, night differential and meal premiums), calculated with the rules for the work location; a How it is paid tab explains each category. Enter moves down the day to the next cell, and times typed as 8, 1830 or 18.30 become 24-hour HH:MM. Saved as a draft while typing and submitted as one week. Day shift 08:00–18:00 (workday breaks at midnight), night shift 18:00–08:00 (workday breaks at noon); night differential $3.00/hr for 22:00–06:00. Meal breaks flagged (California: 30 minutes before the end of the 5th hour, premium if missed). Soft warnings for anything irregular |
| Team Timesheets | 3, ERP | The same timesheet view for managers (their team) and payroll (every hourly worker, shown as Timesheets). Managers: each team member's week with soft warnings; edit or delete time for current and past periods (approved on entry, recorded in the log; paid periods settle as retro) |
| Timesheet alerts | ERP | Pop-up reminders in Pacific time: hourly workers are reminded to enter time each workday and to submit the week from Friday 5:00 pm; managers are reminded to approve their team's time on Fridays at 5:00 pm and Mondays at 6:00 am. Each shows once per occurrence until dismissed ("Remind me later" brings it back on the next visit). A demo clock in the sidebar jumps to those times |
| Data errors (Oct 1–15) | 2, 6 | Payroll only: every difference found in the parallel run in one place (control totals, reconciliation to Rippling, pre-payroll audit, time, absence and pay flags, data-file validation, October provider results), each with its impact, which system is right and the action; downloadable as CSV |
| Pay calendars | ERP | Payroll only: every semi-monthly and biweekly pay period for 2026 and 2027 with check dates, the time and payroll input cutoff (3 business days before the check date) and the approve-by date (1 business day before); the current period is highlighted, periods calculated in the app show their pay run status; CSV |
| Reports | 2, ERP | Payroll only, under Pay runs. Custom report: any date range (quick picks for each week, each pay period, the month), any earnings, deductions and taxes, grouped by week, day, pay period, worker, department, pay group or component, filtered by hourly or salaried, pay group and department, with hours and labor cost; built from daily cost lines that add back to each pay run (deductions and taxes allocated by daily earnings). Standard reports: pay schedule (each period with dates, check date, status, gross, taxes, deductions, net, employer cost), earnings, deductions and taxes by pay component per period, and a by-worker register noting prorated hires, terminations and vacation payouts; filter by pay group; each table downloads as CSV |
| Payroll inputs | ERP | Payroll only, under Pay runs: one-time inputs for a pay period (a completed period is paid as retro in the next pay run) or ongoing inputs paid every pay period between a start and end date; earnings adjustments (amount, or hours × rate for hourly), bonus, commission, and 401(k) or medical deduction adjustments; reason required; entered by either payroll role and approved by the other (segregation of duties), with a SOX audit alert (pop-up and notification) to the other payroll person whenever an input is entered; ongoing inputs can be ended early |
| Administrator (demo) | ERP | An all-access security group for demos: every page, every worker, can start and approve every process and pay run step (its own approvals are recorded as an administrator override). Listed in Signed in as only in a browser unlocked with the passphrase (Administrator access, sidebar). This is a convenience gate, not security |
| Absence | 4, ERP | One section with tabs: My Time Off, Team Time Off and Upcoming Time Off (managers), Absence Balances (managers and payroll). Time off requests for past or future dates with balance and eligibility checks; changes and cancellations of approved time off go to the manager; the year's absence by plan |
| Benefits | ERP | Your benefit enrolments by type (healthcare: medical; retirement: 401(k)), with this pay period's deduction; payroll can view anyone's. Benefits a worker is not enrolled in are not shown |
| Organization setup | ERP | Companies, locations, supervisory orgs and cost centers, job profiles, pay groups and calendars |
| Pay runs | 2, 7, ERP | Calculate, approve (segregation of duties), complete, per period; stale-input and critical-finding checks |
| Period overview | 2 | Control-total tie-out, period totals, burdened cost rollup by department, location or cost center (filterable), variance summary |
| Payroll register | 2 | Gross to net for every worker; payslip drill-down with the calculation behind every line |
| Time calculation | 3 | Hours by category per technician, daily detail with meal checks and workweeks, exceptions, category-to-component mapping |
| Absence › Absence Balances | 4 | Tab of Absence for managers (their team) and payroll: sample-worker ending balances, payout to payroll, plan configuration, all balances |
| Reconciliation | 2 | Headcount reconciliation, employee-level legacy reconciliation with root cause, classification and action, Controller commentary |
| General ledger | 2, 6 | Journals by subsidiary, validation, NetSuite CSV and JSON export, account and segment mapping. Posting is manual for now: enabled only after the pay run is completed, recorded with who and when, and blocked from posting twice; a posted run cannot be reopened until the reversal is recorded. |
| International | 5 | Employer cost by country in local currency and USD, outbound change file, provider reconciliation, local and USD postings, intercompany |
| Controls and audit | 7 | Pre-payroll audit findings, control matrix, security groups |
| Data and demo | 8 | Demo data download, load and reset; CSV upload and validation |
| Design documents | 1, 3–9 | The documents below, rendered |

## Documents

| File | Requirement |
|---|---|
| [docs/01-workday-payroll-design.md](docs/01-workday-payroll-design.md) | 1. Pay groups, component catalog, retro, accounting, multi-state |
| [docs/02-time-tracking-design.md](docs/02-time-tracking-design.md) | 3. Time Tracking configuration and calculation order |
| [docs/03-absence-design.md](docs/03-absence-design.md) | 4. Accrual and time-off plans for every country |
| [docs/04-international-integration.md](docs/04-international-integration.md) | 5. Integration approach, UK data mapping, calendar, provider reconciliation |
| [docs/05-gl-integration.md](docs/05-gl-integration.md) | 6. NetSuite mapping, journal, mechanism, multi-entity, close |
| [docs/06-controls-parallel-cutover.md](docs/06-controls-parallel-cutover.md) | 7. Control matrix, parallel runs, cutover, hypercare |
| [docs/07-period-results.md](docs/07-period-results.md) | 2–5. Calculated results (generated from the engine) |
| [docs/08-architecture-decisions.md](docs/08-architecture-decisions.md) | 8. Architecture decision record |
| [docs/09-ai-in-payroll.md](docs/09-ai-in-payroll.md) | 9. AI feature and guardrails |
| [docs/10-demo-script.md](docs/10-demo-script.md) | Walkthrough for the panel |

## Project layout

```
lib/                      calculation logic: no UI code, runs in browser and Node
  config/                 rules as data: tax tables (effective-dated), pay components, absence plans, country rules, controls
  data/                   CSV loading and validation; Node file reader
  engine/
    timeline.ts           effective-dated records → one row per day
    time.ts               time calculation (CA and FLSA)
    absence.ts            accruals, balances, payouts
    payroll.ts            US gross-to-net
    build.ts              assembles a worker's inputs; variants for re-performance
    intl.ts               international expected cost, outbound changes, provider reconciliation
    reconcile.ts          legacy reconciliation by re-performance
    headcount.ts, gl.ts, audit.ts, run.ts
  ai/commentary.ts        de-identified payload, template commentary, grounding check
  erp/                    ERP layer: business process types and rules, apply BPs to the data,
                          multi-period pay runs (roll-forward, retro), entry validations
src/                      React UI (renders results only)
api/commentary.js         optional Vercel function for the AI commentary
data/                     the CSV package
docs/                     design documents
scripts/                  build, dev server, data generator, results report
tests/                    automated tests
```

## Assumptions

- **Data package.** The brief's package contained sample rows only ("Extend the samples to the full population before sending"). `scripts/generate-data.ts` extends them deterministically, keeping every sample row as given and adding every edge case the brief lists. The legacy register and provider results are generated with documented seeded differences that the reconciliation must rediscover (see ADR-09).
- **Pay periods.** Parallel run Oct 1–15, 2026 (11 working days), check date Tue Oct 20. Then Oct 16–31 semi-monthly (salaried, paid Nov 5), Oct 16–31 biweekly transition (hourly, paid Fri Nov 6) and Nov 1–14 biweekly (paid Fri Nov 20). International: October 2026, change cutoff Oct 20, pay date Oct 28.
- **Rates.** As given in the brief. The Social Security wage base of $168,600 is the 2024 value (2026 actual: $184,500); the app uses the brief's figure and the reconciliation shows the impact. Federal withholding uses the 2026 brackets in a simplified annualized method; state taxes are approximations.
- **Day mapping.** Timesheet "Day N" = October N, 2026.
- **Workweek.** Sunday to Saturday.

## How the AI tool was used

The app was built with Claude (Anthropic) acting as the coding agent, directed and reviewed by me.

**What it generated.** Nearly all of the code (engine, UI, build scripts, tests, data generator) and first drafts of the documents.

**How the calculation logic was reviewed and verified.**

1. Rules were specified before code: order of time calculation, proration method, taxable wage definitions, payout rules, journal structure.
2. Golden cases were worked by hand and turned into tests before trusting the engine: E0021's first three days ($651.00 for Oct 2; $4,830.00 for the period), E0148's payout (33.15 hrs × $79.3269 = $2,629.69), E0203's proration (4/11), E0057's split ($4,640.15 + $2,954.55), the UK, Canada and India employer costs.
3. Independent control totals in the engine (gross-to-net, register to journal, time hours to paid hours, PTO taken to paid, headcount) must tie to the cent on every run; a test fails if they do not.
4. The reconciliation only accepts an explanation that re-performs to the cent, so a wrong engine rule shows up as an unexplained variance.
5. Every screen was reviewed visually, and every number in the documents was checked against the engine; the period results document is generated from the engine so it cannot drift.

**Where it was wrong (and how it was caught).**

| Issue | Caught by | Fix |
|---|---|---|
| Proposed a Next.js + Postgres HR system before the full brief arrived; the brief asks for a CSV-ingesting calculation app | Reading the requirements | Re-architected (ADR-01) |
| Syntax error in an exception message in the time engine | First test run | Fixed |
| Data generator mixed `??` and a ternary without parentheses; it happened to give the right balances but the intent was unreadable, and a missing non-null assertion failed type checking | Code review and `tsc` | Rewritten explicitly |
| Reconciliation left one variance (duplicate punch, E0035) unexplained: the legacy meal-premium hypothesis only applied to workers who had a violation in Workday, but the duplicated 16-hour day created one only in legacy | The "every variance explained" control total failed | The hypothesis now applies to all CA hourly workers (it is a legacy configuration, not a worker event) |
| Salary generator was meant to keep workers out of the wage-base difference band but ignored pre-tax medical reducing FICA wages, so two extra workers landed in it | Unexpected employees in the variance list | Kept (it is realistic) and corrected the comment and documents |
| Two figures in draft documents (a UK leaver payout and a technician's rate) were computed by hand and wrong | Checking documents against engine output | Corrected; results document now generated by `npm run report` |
| One test was tautological (asserted a value against itself) and one compared floating-point sums exactly | Code review of tests | Rewritten against independent expected values |
| Explanation strings showed unformatted amounts ($165000.00) | Visual review | Formatted |
| Narrowed the scope to the brief (a CSV calculation app) and dropped my original requirement for a working ERP (hire, time, absence, run payroll) | When I tried to hire someone in the demo | Added the ERP layer as business processes on top of the unchanged engine (ADR-14) |
| First retro design treated time entered before the next period's start date as already paid; time approved after a period was completed but before the next one started would have been paid twice | Design review before coding the pay-run chain | "Already paid" is now decided by the completion timestamp of the prior period, with a test for both cases |
| Recommended a single semi-monthly pay group for everyone | My own preference and research on FLSA workweeks | Hourly moved to biweekly (ADR-16) |

## Limitations

- Tax amounts are approximations by design (see Assumptions); the structure (separate taxable wages per tax, wage bases, allocation by state) is what is modeled.
- Not modeled: Colorado FAMLI, NY SDI, local income taxes, supplemental withholding method choice, 401(k) annual limits and employer match, holidays.
- Data entered in the app is saved in the browser (no shared database) and roles are switched with a selector rather than real logins. See ADR-15 for the production path.
- Role-based visibility (`src/access.tsx`) shapes each role's view: employees see their own profile and only name and org details for others; a worker's compensation, time and time off are visible to the worker, their managers and payroll; payslips and pay results are visible to payroll only. Because there are no real logins and the data ships to the browser, this is a demonstration of the security design, not protection of the data.
- New countries (for example Mexico) need a country pack (pay group, absence plans, statutory rules) before people can be hired there.
