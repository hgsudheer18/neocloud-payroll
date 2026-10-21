# Presenter reference

Key steps, expected numbers and talking points for testing and presenting the NeoCloud People and Payroll app. Companion materials:

- Configuration design document: https://claude.ai/artifact/B48Y4isu2iBWxvqwQckfwY
- Presentation deck (8 slides): https://claude.ai/artifact/V9wSxQqFChLdCMnNgHJDtd
- Period results with every figure: [07-period-results.md](07-period-results.md)
- Parallel run method, controls and cutover: [06-controls-parallel-cutover.md](06-controls-parallel-cutover.md)
- Scripted 20-minute demo: [10-demo-script.md](10-demo-script.md) (its second half still uses old persona names: Sam = Diego, Priya = Aisha, "Jordan (HR)" = Chloe)

## 1. How demo data works

- Everything entered in the app (approvals, pay run status, hires, timesheets, payroll inputs) is saved **only in the browser where it was entered**. Other browsers, devices, reviewers and incognito windows each start empty.
- An incognito window forgets everything when it is closed. Present from a normal browser window.
- The CSV data package and the Oct 1–15 results always load; only your entries are per browser.
- **Data and demo** (payroll roles):
  - *Download my demo data* saves your entries to a file.
  - *Load demo data* replaces this browser's entries with a file. Download first if you want to keep what is there.
  - *Reset demo data* clears your entries and starts clean.
- To show your scenario in another browser: Download in yours, then Load in the other.
- Open item: the site could load your scenario automatically for every visitor (a snapshot you refresh by sending a new file). A shared live database is possible but riskier: any panelist's click would change everyone's data.

## 2. Personas

| Persona | Role | Does |
|---|---|---|
| Emma Kim (E0021) | Employee, hourly technician, San Jose CA, $42/hr | Enters time, requests time off |
| Maya Costa (E0037) | Employee, hourly technician, Austin TX, $36.75/hr | Same as Emma under Texas rules: federal weekly overtime over 40 only, no daily overtime, double time or meal premium |
| Ethan Fischer (E0005) | Manager, Data Center Ops | Approves time, hires, terminations |
| Chloe Novak (E0261) | HR Partner | Hires, terminations, comp changes |
| Diego Okafor (E0254) | Payroll Specialist | Calculates pay runs, payroll inputs, time administration |
| Aisha Nguyen (E0257) | Payroll Approver | Approves and completes pay runs, payroll inputs |
| Demo Administrator | All access | Unlocked from the sidebar with the passphrase |

The person who calculates a pay run can never approve it. Payroll inputs entered by one payroll role are approved by the other, who also gets a SOX audit alert.

## 3. Closing Oct 1–15 (the parallel run)

The only critical audit item is **E0148 Felix Fischer**: terminated Oct 9 in California, so final pay is due on his last day and cannot wait for the regular check date. Nothing in the data needs fixing; the approver records how it was handled.

1. **Diego → Pay runs → Calculate pay.** Expect 280 workers, $1,973,794.91 gross, all ties, 1 critical item.
2. **Aisha → Pay runs.** In the resolution box enter, for example, *"E0148 final pay issued as on-demand payment on 10/09/2026"* (at least 10 characters).
3. **Approve pay run → Complete pay run.** The period is now locked.

## 4. How pay results update

- Results recalculate automatically the moment time, time off, a payroll input or a job change is **approved**. Requests awaiting approval do not count.
- If something is approved after a pay run was calculated, Pay runs shows "Inputs changed… Recalculate" and blocks approval until it is recalculated.
- A completed period stays exactly as paid. Later changes to it are paid as **retro** in the next pay run.
- **Preview before approval:** Payroll register → click a worker → *Preview pay with these approved*. Shows totals and changed pay lines as if the worker's pending requests were approved. Nothing is saved, and the pay run is not touched. Works in open periods only.

## 5. Full-cycle test with expected results

Start: Reset demo data, then close Oct 1–15 as in section 3.

| Step | Who and where | Expected |
|---|---|---|
| Hire salaried | Chloe → Staffing → REQ-S2 ($150,000), hire date 10/21 → approve | Paid $4,545.45 in Oct 16–31 semi-monthly ($150,000 ÷ 24 × 8 of 11 working days) |
| Hire night technician | Chloe → Staffing → REQ-H2 ($41.50/hr), hire date 10/21 → approve | Biweekly pay group |
| Terminate | Chloe → Workers → E0024 Sofia Davis → Terminate, last day 10/23 → Ethan approves | Paid through 10/23 plus vacation payout at $38.25/hr |
| Overtime | Emma → Enter time → week of 10/18 → Fill in my schedule; Monday clock-out 20:30, Wednesday 21:30 → Submit; Ethan approves | 40 REG $1,680.00 + 8 OT $504.00 + 1 DT $84.00 + 1 meal premium $42.00 (no second meal on the 13-hour day) = **$2,310.00** gross for that week |
| Shift differential | Ethan → Team Timesheets → night technician, week of 10/18 → Fill in the schedule → Save | 24 hrs from the hire date, 22.5 at $3 night differential: $67.50; **$1,063.50** total. If they also work overtime, night differential raises the regular rate and an OT_ADJ line appears |
| Other workers' time | Diego → Pay runs → Time administration → Auto-fill scheduled shifts; Ethan → Approve all | Every technician has approved time |
| Pay salaried | Pay period Oct 16–31 semi-monthly; Diego calculates; Aisha approves and completes | New hire prorated; year-to-date carried forward |
| Pay hourly | Pay period Oct 16–31 biweekly transition; same steps | Includes the night technician and Sofia's final pay |
| Ledger | General ledger → check the journals balance → Post journals to NetSuite | Posted manually by payroll after completion |
| Reports | Diego → Reports → By worker, per period | Amounts above, downloadable as CSV |
| Save | Data and demo → Download my demo data | File to load before the demo |

Tip: before a manager approves, use the payroll register preview (section 4) to check the expected pay.

## 6. Presenting the reconciliation (Oct 1–15)

Where: pay period Oct 1–15 → **Reconciliation → Legacy register**.

1. **Headline:** 262 matched to the cent, 17 explained, 1 only in legacy, 1 only in Workday, **0 unexplained**. Legacy paid $12,658.51 more gross and $7,107.36 more net.
2. **Variances by root cause:** 12 causes, each with classification (legacy error, configuration, timing, data), the correct system and the impact. Click a worker to jump to the proof.
3. **Show explanations and actions:** the full story for each variance in one scrolling table. **Download CSV** for the variance log.
4. **Register totals:** Workday vs legacy for every column.
5. **Headcount tab:** 354 workers on file → 280 paid; 2 hires, 1 termination, 1 on unpaid leave.

Talking points that sway a decision:

- **The bar is "every variance explained", not "within 1%".** Payroll errors are individual: an aggregate tolerance can hide one person's missed garnishment (E0031).
- **Explanations are proven, not asserted.** Recalculating with the identified cause reproduces the legacy number to the cent.
- **Workday is right in 17 of 19 variances**, including two legacy errors with legal exposure: the missed child support garnishment (E0031) and the missing California vacation payout at termination (E0148).
- **Legacy is right on the Social Security wage base.** The brief's $168,600 is the 2024 figure; 2026 is $184,500. Saying so shows the reconciliation is honest, not built to favour Workday. Fix the configuration before production.
- Good workers to click: **E0148** (vacation payout), **E0057** (mid-period raise prorated by working days, $530.30), **E0088** (CA → CO move), **E0035** (duplicate punch), **E0003** (wage base).
- Method (doc 06): three parallels, $0.00 unexplained per employee, two consecutive clean parallels to exit, sign-off by Payroll Manager, Controller, Head of People Technology and CFO.

## 7. Design decisions in one line each

- **Two pay groups.** Salaried semi-monthly (24/yr); hourly biweekly (26/yr) from 10/16/2026, because overtime is weekly and only biweekly periods hold whole workweeks.
- **Time rules by work location.** CA daily 8/12 and 7th day, meal premiums; AK/NV over 8; CO over 12; else FLSA weekly. Night differential $3, 22:00–06:00.
- **Retro.** Recalculate the completed period, subtract what was paid, pay the difference now. Completed periods are never reopened.
- **Accounting.** Cost center from the supervisory org; employer taxes and benefits split in proportion to wages; summarized journal; manual post to NetSuite.
- **Controls.** No self-approval; cross-alerted payroll inputs; locked periods; 11 mapped controls (PR-01 to PR-11).

## 8. Before the live demo

- Use a normal browser window; load your saved demo data file (or reset and run the script).
- The **Demo clock** in the sidebar triggers the Friday 5 pm and Monday 6 am PT timesheet reminders on demand.
- Unlock **Administrator access** from the sidebar if you want all-access shortcuts.
- Approver shortcut: after submitting, click **Sign in as … to approve**.
- Hard refresh (Cmd+Shift+R) after a new deploy.
