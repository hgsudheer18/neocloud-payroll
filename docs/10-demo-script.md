# Demo script (about 15 minutes)

A walkthrough for the CFO, Controller and Head of People Technology. Each step names the screen, what to click and the point to make.

## 1. Does the period tie? (2 min) — Period overview

- Open the overview. The first thing on screen is the control-total ledger, not a chart: "Before anyone looks at a number, the question is whether the period ties."
- Walk the eight ties: gross to net, journal balances, register to journal, time hours to paid hours, PTO taken to PTO paid, payout hours, headcount, and every legacy variance explained.
- Point out the sidebar: the calculation ran in the browser in about 130 ms from the CSV package.

## 2. Burdened cost (1 min) — Period overview, rollup

- Switch Group by between Department, Location and Cost center; filter Department = On-Prem.
- "US and international on one view, international translated at the reporting rates."

## 3. One payslip, every number explained (3 min) — Payroll register

- Search **E0148** (termination): salary 7/11 days; vacation payout 33.15 hours = 31.00 + 2.15 final accrual, at $165,000 ÷ 2,080. The red banner: CA final pay is due on the last day, so this goes on an on-demand payment, not the regular check.
- Open **E0088** (CA → CO move): two salary lines, one per state; CA SDI only on CA wages; CO tax on CO wages.
- Open **E0057** (comp change on the 10th): two segments.
- Mention E0203 (new hire 4/11), E0149 (unpaid leave 5/11), E0031 (garnishment within the CCPA limit).

## 4. Time (3 min) — Time calculation

- Open **E0021**: Oct 1 late meal (the brief didn't flag it: 11:15 is after the 5th hour), Oct 2 double time over 12 hours, Oct 3 missed meal and 8 hours of weekly OT because Sep 28–Oct 2 already reached 40 regular hours. Point at the greyed prior-period rows: "this is why the prior week's punches are in the file."
- Open **E0025**: seventh consecutive day in the workweek, 8 hrs at 1.5x and 1.5 at 2x.
- Open **E0022** (Texas): seven days in a row but no premium, and the night shift crossing midnight stays on one workday.
- Exceptions table: filter to duplicate punch (E0035) and retro correction (E0033).

## 5. Absence (1 min) — Absence balances

- Sample workers table: ending balances, the E0148 payout flowing to payroll, and international accruals.
- Plan configuration table: eligibility, accrual, caps, payout per country.

## 6. Reconciliation to Rippling (3 min) — Reconciliation

- Headcount tab: 354 on file → 280 paid; Workday 280 + 1 contractor only in legacy − 1 hire only in Workday = 280 legacy rows.
- Legacy tab: 262 match to the cent, 19 explained, 0 unexplained.
- Open **E0203**: the explanation is proven by re-performance: recalculating with the legacy hire date reproduces every legacy column to the cent.
- Open **E0003**: Social Security wage base. "Here legacy is right: the brief's $168,600 is the 2024 base; 2026 is $184,500. In a real parallel, I'd fix Workday's tax configuration."
- Controller commentary tab: deterministic draft; explain the guardrails if asked about AI.

## 7. GL and NetSuite (1.5 min) — General ledger

- Five journals, all balanced and fully mapped; the US journal is 82 summarized lines.
- Account mapping and segment mapping tabs; who owns changes.
- Download the NetSuite CSV.

## 8. International (1 min) — International

- E0006, E0008, E0009 employer cost in local currency and USD.
- E0330 provider variance: late comp change after the PECI cutoff → timing, paid as retro in November.
- E0008's intercompany recharge from Canada to the US cost center.

## 9. Controls (0.5 min) — Controls and audit

- Pre-payroll audit findings (the E0148 critical item), control matrix and security groups.

## Likely questions

| Question | Short answer |
|---|---|
| Why one pay group? | FLSA status changes components and time rules, not pay frequency. One run, one audit, one journal. CA Labor Code 204 allows the 5-day lag. |
| How do you know an explanation is right? | It is re-performed: the calculation under that cause reproduces the legacy number to the cent. |
| What happens with 5,000 employees? | The engine is pure functions with no UI dependency; run it server-side or in a background job. Same tests. |
| Why not Next.js and a database? | The brief is calculate-reconcile-visualize from files. No database means nothing to secure or migrate, and uploaded payroll files never leave the browser. |
| How did you use AI? | It wrote most of the code; I specified the rules and edge cases, checked every calculation against hand-worked examples, and the README lists where it was wrong. |
| Why is the overtime adjustment line there? | The regular rate includes the night differential, so OT at 1.5 × base underpays night workers. |
