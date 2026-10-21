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
- **Presenter's scenario (auto-load):** a downloaded demo data file saved in the project folder as `neocloud-demo-*.json` (or `scenario/demo-scenario.json`) is published with the site. Every **first-time** visitor starts from it automatically; their own clicks then stay private to their browser. **Data and demo → Restore presenter's scenario** brings anyone back to it. Visitors who already used the site keep their own data until they restore. The published file is `scenario/demo-scenario.json` (it takes precedence over a file in the project folder). To update it: download again, replace `scenario/demo-scenario.json` with the new file, commit and push.
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

### Demo test users

Three workers to show both pay groups and both state rule sets. Pay results: **Pay runs → click the pay group row → Pay results → click the worker** (or Payroll register, same period).

| | Emma Kim | Maya Costa | Liam Singh |
|---|---|---|---|
| Worker ID | E0021 | E0037 | E0002 |
| Job | Data Center Technician, San Jose CA | Data Center Technician, Austin TX | VP, GPU Cloud, San Francisco CA |
| Pay | $42.00/hr, non-exempt | $36.75/hr, non-exempt | $300,000/yr, exempt |
| Pay group from 10/16 | US Biweekly (Oct 16–31 transition, check 11/06) | US Biweekly (Oct 16–31 transition, check 11/06) | US Semi-Monthly (Oct 16–31, check 11/05) |
| Manager (approves) | Ethan Fischer | Ethan Fischer | Morgan Hale |
| Sign in as | Emma Kim (Employee) | Maya Costa (Employee) | Not a persona: Chloe enters for him |
| Enter time | Enter time (or Ethan → Team Timesheets) | Enter time (or Ethan → Team Timesheets) | No time entry (salaried) |
| Enter absence | Absence → US Hourly Vacation (opening balance 46.5 hrs) or CA sick (28 hrs) | Absence → US Hourly Vacation (opening balance 14.5 hrs) | Chloe → Workers → E0002 → Request time off → US Flexible PTO (no balance) |
| Overtime rules | California: over 8/day 1.5x, over 12/day 2x, 7th day, weekly over 40; meal premium | Texas (federal): weekly over 40 only; no daily OT, double time or meal premium | Exempt: no overtime |
| Deductions | Medical $133.85 a biweekly period ($145 × 24/26); no 401(k) | Medical $133.85; 401(k) 3% | Medical $210.00; 401(k) 3% |

**Expected results to quote**

- **Emma, 12-hour day** (08:00–20:30, 30-min meal): 8 regular + 4 daily overtime. **13-hour day**: 8 regular + 4 overtime + 1 double time + 1 meal premium (no second meal). Rates: $42 regular, $63 overtime, $84 double time, $42 meal premium.
- **Emma, 8 hrs vacation**: $336.00 (8 × $42), balance down by 8.
- **Maya, 48-hour week** (12, 8, 12, 8, 8): 40 regular + 8 weekly overtime = $1,470.00 + $441.00 = **$1,911.00**. Same days for Emma give 8 daily overtime instead, no weekly overtime.
- **Liam, full period**: Regular Salary 86.67 standard hours, $12,500.00 ($300,000 ÷ 24).
- **Liam, 8 hrs Flexible PTO**: Regular Salary 78.67 hrs $11,346.15 + Time Off Taken 8.00 hrs $1,153.85 (8 × $144.23 = salary ÷ 2,080). Gross unchanged at $12,500.00; Hours box totals 86.67.
- **Liam, Social Security**: $0.00 this period: his year-to-date wages are past the configured wage base ($168,600, the brief's figure; real 2026 base $184,500).

## 3. Closing Oct 1–15 (the parallel run)

The only critical audit item is **E0148 Felix Fischer**: terminated Oct 9 in California, so final pay is due on his last day and cannot wait for the regular check date. Nothing in the data needs fixing; the approver records how it was handled.

1. **Diego → Pay runs → Calculate pay.** Expect 280 workers, $1,973,794.91 gross, all ties, 1 critical item.
2. **Aisha → Pay runs.** In the resolution box enter, for example, *"E0148 final pay issued as on-demand payment on 10/09/2026"* (at least 10 characters).
3. **Approve pay run → Complete pay run.** The period is now locked.

## 4. How pay results update

- **Where to see them:** Pay runs → click the pay group row for the period → **Pay results** lists every worker in that run with hours, gross, net and flags; click a worker to open their pay slip on the same page. Hourly workers are in the biweekly periods from 10/16; salaried workers in the semi-monthly ones. (Payroll register shows the same results with more columns.)

- Results recalculate automatically the moment time, time off, a payroll input or a job change is **approved**. Requests awaiting approval do not count.
- If something is approved after a pay run was calculated, Pay runs shows "Inputs changed… Recalculate" and blocks approval until it is recalculated.
- A completed period stays exactly as paid. Later changes to it are paid as **retro** in the next pay run.
- **Preview before approval:** Payroll register → click a worker → *Preview pay with these approved*. Shows totals and changed pay lines as if the worker's pending requests were approved. Nothing is saved, and the pay run is not touched. Works in open periods only.

## 5. Full-cycle test with expected results

Start: Reset demo data, then close Oct 1–15 as in section 3. For a shorter run of the same flows, see section 6.

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

## 6. Quick test: hire, time entry, absence, terminate (about 20 minutes)

Normal browser window, **Data and demo → Reset demo data** first, times in 24-hour format.

**Step 0. Close Oct 1–15** (later periods need it completed first)
- Diego Okafor → Pay runs → Calculate pay.
- Aisha Nguyen → enter the E0148 resolution → Approve → Complete.

**Step 1. Hire**
- Chloe Novak → Staffing → REQ-H2 (night technician, $41.50/hr) → Hire into this position, hire date 10/21 → submit → Sign in as … to approve.
- Chloe → Staffing → REQ-S2 (salaried, $150,000), hire date 10/21 → submit and approve.
- Check: both appear under Workers.

**Step 2. Time entry**
- Ethan Fischer → Team Timesheets → the new night technician, week of 10/18 → Fill in the schedule → Save. Only 10/21–10/23 fill: 24 hours, 22.5 at night differential.
- Emma Kim → Enter time → week of 10/18 → Monday 10/19 08:00–20:30, meal 12:00–12:30 → Submit week; Ethan → Inbox → Approve. Expect 12 hours that day: 8 regular, 4 daily overtime.
- Optional: Maya Costa with the same entry. Expect 12 regular hours and no daily overtime (Texas).

**Step 3. Absence**
- Emma → Absence → request US Hourly Vacation, 8 hours on 10/22; Ethan approves. Expect 8 hours of vacation pay at $42 = $336, and her vacation balance down by 8.
- Optional: a day of US Flexible PTO for a salaried worker. Gross is unchanged; part of the salary moves to the Time Off Taken line.

- Any other worker: Chloe → Workers → open the worker → **Request time off** (the Absence page opens with that worker selected). Approval goes to the worker's manager (Ethan for technicians, Morgan Hale for most others).

**Step 4. Terminate**
- Chloe → Workers → E0024 Sofia Davis → Terminate, last day 10/23; Ethan approves.

**Step 5. Pay and check**
- Diego → Time administration → Auto-fill scheduled shifts (10/16–10/31); Ethan → Approve all.
- Pay period Oct 16–31 semi-monthly: Diego calculates; Aisha approves and completes. The salaried hire gets $4,545.45 (8 of 11 working days).
- Pay period Oct 16–31 biweekly transition: same steps. The night technician gets $1,063.50; Emma shows overtime and vacation; Sofia is paid through 10/23 plus her vacation payout.
- Payroll register → click each worker to check the lines.
- General ledger → confirm the journals balance → Post journals to NetSuite.

**Step 6. Save:** Data and demo → Download my demo data.

Tip: before Ethan approves anything, Payroll register → the worker → Preview pay with these approved shows the effect on pay.

## 7. Timesheet rules to remember

- **Total hours** run from clock in to clock out. A meal is deducted only when it is a real break inside the shift and no longer than 2 hours. Every state.
- **Meal warnings** (amber, never block submission): meal over 1 hour (deducted, check it); meal over 2 hours or outside the shift (not deducted); meal typed in 12-hour style such as 1:00 (read as 1 pm when that fits the shift). They show on the timesheet, on the manager's approval and in Data errors.
- **Blocking error:** clock out more than 16 hours after clock in (usually 12-hour time typed, e.g. 8:30 for 20:30).
- **California overtime:** over 8 hours a day 1.5x; over 12 hours 2x; 7th consecutive workday first 8 hours 1.5x, beyond 8 2x; weekly overtime on regular hours beyond 40. Double time starts after 12 hours, not 10.
- **California meal premium:** one hour at the regular rate per workday, at most one a day, for no meal on a shift over 5 hours, a meal starting after the 5th hour, a meal under 30 minutes, or over 12 hours with one meal (the second meal cannot be waived over 12 hours). The timesheet takes one meal a day, so a day over 12 hours always carries the premium.
- **Texas and other FLSA states:** weekly overtime over 40 only; no daily overtime, double time or meal premium (warning only).
- **Where the meal premium comes from:** the data package flags Emma's late and missed meals; the premium itself is California Labor Code 226.7, configured in the app. Legacy did not pay it, which is one of the explained reconciliation variances (Workday is right).

## 8. Presenting the reconciliation (Oct 1–15)

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

## 9. Design decisions in one line each

- **Two pay groups.** Salaried semi-monthly (24/yr); hourly biweekly (26/yr) from 10/16/2026, because overtime is weekly and only biweekly periods hold whole workweeks.
- **Time rules by work location.** CA daily 8/12 and 7th day, meal premiums; AK/NV over 8; CO over 12; else FLSA weekly. Night differential $3, 22:00–06:00.
- **Retro.** Recalculate the completed period, subtract what was paid, pay the difference now. Completed periods are never reopened.
- **Accounting.** Cost center from the supervisory org; employer taxes and benefits split in proportion to wages; summarized journal; manual post to NetSuite.
- **Controls.** No self-approval; cross-alerted payroll inputs; locked periods; 11 mapped controls (PR-01 to PR-11).

### Final pay for a mid-period termination (known simplification)

- **What the app does:** a California termination (E0148 in Oct 1–15, Sofia Davis E0024 on 10/23 in testing) raises a critical audit item: final pay is due on the last day (Labor Code 201/202), not the regular check date. The approver must record how it was paid (e.g. "E0024 final pay issued as on-demand payment on 10/23/2026") before the pay run can be approved. Her pay is calculated and completed with the regular run.
- **Expected for Sofia (last day 10/23):** 48.00 hrs × $38.25 = $1,836.00 + vacation payout 69.93 hrs × $38.25 = $2,674.82; gross $4,510.82; net $3,102.91; Cost to Company $5,300.98.
- **Talk track:** "Sofia is terminated in California, so her final pay is due on her last day. The engine flags it as critical and blocks approval until payroll records the on-demand payment. In production that is a Workday On-Demand Payment: a separate one-person run check-dated 10/23, so the regular run is not held up or completed early. Here I have modeled the control and the flag; the separate run is the next build."
- **What the next build adds:** a "Pay final check now" run for one worker, approved by a second person; her result locked at that point (later changes flow as retro); the regular run shows her as paid on demand (out of its bank file, kept in totals, year-to-date and reconciliation); a separate journal for the on-demand check.

### W-2s (year-end, not built)

- **Why they are not in the demo:** it is October; 2026 W-2s are produced after the last pay run of the year and are due to employees and the SSA by Jan 31, 2027. The data package also carries no year-to-date federal or state withholding or 401(k) from Rippling (only YTD gross and Social Security, Medicare, FUTA and SUI wages), so a full-year W-2 could not be accurate. In production, those YTD tax balances are converted at go-live (see the cutover plan in doc 06).
- **Talk track:** "W-2s are a year-end process. Every pay result already carries the W-2 amounts: federal taxable wages (box 1), Social Security and Medicare wages (boxes 3 and 5), the 401(k) deferral (box 12 code D), and state wages and tax by work state (boxes 16 and 17), so E0088 would get a CA and a CO line. At year-end the process is:"
  1. **Year-end audit**: missing SSNs or addresses, negative YTD balances, Social Security over the wage base, multi-state workers, terminated workers' final pay complete.
  2. **Generate** W-2s from the year's completed pay results plus converted pre-go-live balances.
  3. **Review and approve**: Payroll Specialist reviews, Payroll Approver approves (same segregation of duties as a pay run).
  4. **Publish** to each employee's Documents (electronic consent on file; paper otherwise) and **file** W-2s with the W-3 to the SSA electronically (EFW2), plus state filings, by Jan 31.
  5. **Corrections** after publishing go out as a W-2c.
- **Where it would live:** Payroll → Year-end, and the employee's Documents.

### Cost to Company

The total cost of employing someone: gross pay + employer taxes (Social Security, Medicare, FUTA, SUI) + employer benefits. Not a legal term (finance also calls it burdened or fully loaded cost). Oct 1–15: $1,973,794.91 gross, **$2,299,341.55 Cost to Company**. It is what the journal debits to expense (6100–6300) and what Finance budgets headcount on; a $190,000 salary is roughly $230,000 a year. Employer benefits are a 10% load in this app (the brief gave no premiums); production uses actual premiums and 401(k) match.

### Why the first biweekly period is 16 days (Oct 16–31)

A deliberate one-time transition period, not an error. Talking points:

- **Biweekly periods must be whole Sunday–Saturday workweeks**, because overtime is counted per workweek. The last semi-monthly period ended Thursday 10/15, mid-week, so the first clean biweekly boundary is Sunday 10/18.
- **The 2-day stub (Fri 10/16 – Sat 10/17) is folded into the first period**: 2 days that finish the Oct 11–17 workweek plus two full workweeks Oct 18–31. Check date Fri 11/06. From Nov 1 every period is a normal 14 days.
- **Nothing is overpaid**: hourly pay is hours worked, so 2 extra days are just more approved hours. Overtime for the Oct 11–17 week uses all 7 days, including Oct 11–15 already paid in Oct 1–15.
- **Per-period deductions are taken once** (medical at the biweekly amount, × 24/26), not twice in three weeks.
- **Alternative considered: a separate 2-day stub run for 10/16–10/17, then a regular Oct 18–31 period.** Rejected because it adds a pay run, check date, bank file, tax deposit and journal for 2 days of pay; federal withholding annualizes 2 days of wages × 26 and under-withholds; and it needs special rules so medical, 401(k) catch-up and garnishments are not taken an extra time. One longer first period is the standard way to change pay frequency.
- **If asked "could Workday do the stub?"** Yes: an off-cycle or short period with deductions suppressed. It is a policy choice; the 16-day period is simpler, cheaper and easier to explain to the 25 employees.

## 10. Before the live demo

- Use a normal browser window; load your saved demo data file (or reset and run the script).
- The **Demo clock** in the sidebar triggers the Friday 5 pm and Monday 6 am PT timesheet reminders on demand.
- Unlock **Administrator access** from the sidebar if you want all-access shortcuts.
- Approver shortcut: after submitting, click **Sign in as … to approve**.
- Hard refresh (Cmd+Shift+R) after a new deploy.

## 11. Demo sequence for the team (about 30 minutes)

Present from the browser that holds your data (or Load demo data first). Share your screen so everyone sees the same numbers. Hard refresh (Cmd+Shift+R) before starting. Use **Sign in as … to approve** after each submission to jump to the approver.

| # | Minutes | Signed in as | Show | Say / expected |
|---|---|---|---|---|
| 1 | 2 | Anyone | Home, then the deck's brief slide if useful | 280 US workers, 4 countries, IPO-track controls; Workday-style HCM, time and payroll posting to NetSuite |
| 2 | 5 | Diego | Period overview (Oct 1–15): 8 control ties; **Reconciliation → Legacy register**: variances by root cause, Show explanations, E0148, E0057, E0003 | 262 matched, 17 explained, 0 unexplained; legacy pays $12,658.51 more gross; "every variance explained, proven by recalculation"; legacy is right on the wage base |
| 3 | 3 | Diego, then Aisha | **Pay runs → Oct 1–15**: Calculate; Aisha records the E0148 resolution, Approve, Complete | Segregation of duties: Diego cannot approve; CA final pay critical item needs a recorded resolution; $1,973,794.91 gross, $2,299,341.55 Cost to Company |
| 4 | 3 | Chloe | **Workers → Hire a worker → Position REQ-H1** (hourly, San Jose, $40) from 10/19; **REQ-S2** (salaried) from 10/22 at $190,000, married filing jointly, medical $200 | Position pre-fills job, pay, cost center, manager; approvals go to Ethan / Morgan |
| 5 | 2 | Chloe | **Workers → E0024 Sofia Davis → Terminate**, last day 10/23 | CA final pay due on the last day; on-demand payment talk track (section 9) |
| 6 | 4 | Emma, then Maya, then Ethan | **Enter time**, week of 10/18: Emma Mon 08:00–20:30, Wed 08:00–21:30; Maya same days; Ethan approves | Emma (CA): daily OT, double time over 12, meal premium; Maya (TX): weekly OT over 40 only; meal entries never reduce hours, they warn |
| 7 | 2 | Chloe, then Morgan | **Workers → E0002 Liam Singh → Request time off**, 8 hrs US Flexible PTO | Salaried time off: gross unchanged, hours move from salary to time off |
| 8 | 2 | Diego, then Ethan | **Pay runs → Time administration → Auto-fill** Oct 16–31; Ethan Approve all; show **Preview pay with these approved** on a pending worker first if useful | Payroll pays approved time only; preview shows the effect before approval |
| 9 | 4 | Diego, then Aisha | **Pay runs → Oct 16–31 semi-monthly**, Calculate / Approve / Complete; then **biweekly transition** with the E0024 resolution | **Pay results**: Liam 78.67 + 8.00 hrs = 86.67, $12,500; salaried hire 55.15 hrs, $5,037.88, net $3,655.43; hourly hire 80 hrs, $3,200; Sofia $4,510.82 incl. $2,674.82 payout; 16-day transition talk track |
| 10 | 2 | Diego | **General ledger**: journals balance → Post journals to NetSuite | Manual post by payroll after completion; summarized journal by account, cost center, location |
| 11 | 2 | Diego, then Aisha | **Payroll inputs**: a bonus for a worker; Aisha sees the SOX audit alert and approves | Either payroll role enters, the other approves and is alerted |
| 12 | 1 | Emma | **Pay Slip**: net pay masked until clicked; Hours box | Employee self-service |
| 13 | 2 | Anyone | Wrap up: design decisions (section 9), open items (on-demand final pay, W-2s at year-end, wage base, holidays) | What is next |

Expected amounts in rows 6–9 assume the dates and inputs above; different dates change them (the payroll register preview shows the effect before approving).

**If something goes wrong live:** Data and demo → Load demo data with your saved file, or switch to the Oct 1–15 story (rows 2–3), which never changes.
