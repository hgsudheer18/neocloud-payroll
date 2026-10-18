# Controls, parallel run, cutover and hypercare

NeoCloud plans to IPO in about 12 months and needs SOX ITGC design readiness by December 31, 2026. Payroll is usually the largest operating expense and a key area for auditors, so the go-live plan is built around evidence: every control below produces an artifact in Workday (or in the integration logs) that an auditor can sample.

## 1. Payroll control matrix

| ID | Area | Control | Owner | Frequency | Workday evidence | Segregation of duties |
|---|---|---|---|---|---|---|
| PR-01 | Input | Hire, job, comp and termination changes go through business processes with manager and HR Partner approval (Total Rewards above guideline) | HR Operations Manager | Each transaction | Business process history and approval chain; BP definition audit | Initiator cannot approve own BP; HR Partner has no payroll access |
| PR-02 | Input | Time validations (critical: overlaps, missing out-punch, > 16 hrs) and manager approval by cutoff; unapproved time reviewed | Time Tracking Lead | Each period | Time block audit; Unapproved Time report signed before pay calc | Workers cannot approve own time; approved time only changed by correction BP |
| PR-03 | Input | Payroll inputs, one-time payments and garnishments reconciled to source; garnishments entered and verified by different people | Payroll Manager | Each period | EIB load results; Payroll Input audit report with reviewer sign-off | Specialist enters, Manager reviews |
| PR-04 | Calculation | Pre-payroll audit: trailing-average variance, negative or zero net, multi-state, wage-base crossings, final pay, headcount deltas; every item cleared or explained | Payroll Manager | Each period | Audit results and variance report with comments; sign-off in Complete Pay Calculation | Specialist works items, Manager signs |
| PR-05 | Calculation | Headcount reconciliation: active workers to paid workers, every delta explained | Payroll Manager | Each period | Headcount reconciliation in the close pack | Prepared and reviewed by different people |
| PR-06 | Approval | Pay calculation and settlement approved by Payroll Manager; Controller approves register summary and cash requirement | Controller | Each period | Pay run BP approval history; signed register summary | Payroll Administrator (calculate) and Payroll Approver (complete) are separate security groups; no user holds both |
| PR-07 | Funding | Settlement and tax funding agree to the approved register; bank release with dual approval in the bank portal | Treasury Manager | Each period | Settlement run report; bank and tax funding confirmations | Payroll cannot release payments; Treasury cannot change payroll |
| PR-08 | Output | Journal validated (mapped, balanced), tied to the register before posting, and tied to NetSuite after posting | Senior Accountant | Each period | Journal validation output; NetSuite import log; tie-out workpaper | Payroll prepares, Accounting posts and reviews |
| PR-09 | Output | International provider results reconciled to Workday before funding the provider | International Payroll Lead | Monthly | Provider reconciliation workpaper and variance log | International Payroll prepares, Payroll Manager approves |
| PR-10 | ITGC: change | Pay component, tax, calculation, accrual and integration changes made in sandbox, tested, approved, migrated; tenant configuration audit reviewed monthly | Head of People Technology | Each change; monthly | Change ticket, test evidence, Workday configuration audit trail | Configurers cannot run payroll in production |
| PR-11 | ITGC: access | Quarterly access review of payroll, HR and integration security groups; leavers removed within one business day | Head of People Technology | Quarterly | Security group membership report signed by group owners | Reviewer is not a member of the reviewed group |

### Segregation of duties through security groups

| Security group | Can | Cannot |
|---|---|---|
| HR Partner | Initiate and approve hires, job and comp changes, terminations | Run or approve payroll, change pay components |
| Time Administrator | Correct and approve time on behalf of managers | Calculate payroll, change rates |
| Payroll Specialist | Enter inputs, garnishments, one-time payments; run pay calculation | Complete the pay calculation, change compensation or bank accounts |
| Payroll Approver | Review audits, complete pay calculation and settlement | Enter the inputs they approve, change compensation |
| Payroll Configuration | Configure in sandbox | Run payroll in production |
| Accounting | Post and review payroll journals in NetSuite | Change payroll results |
| Treasury | Release settlement and provider funding | Edit payroll or banking details in Workday |

A segregation-of-duties policy in Workday blocks assigning conflicting groups to one user (for example Payroll Specialist + Payroll Approver, HR Partner + Payroll Specialist). Emergency access ("break glass") is time-boxed, logged, and reviewed by the Controller.

## 2. Parallel run strategy

### How many

**Three parallels**, using real prior periods run in Workday alongside Rippling:

| Parallel | Period | Why this one |
|---|---|---|
| P1 | A normal period (e.g. Oct 1–15) | Baseline: calculation logic, taxes, deductions |
| P2 | A period with month-end and benefit deductions (e.g. Oct 16–31) | Monthly deductions, accrual posting, full GL cycle |
| P3 | A period with high change volume (e.g. Nov 1–15: open enrollment changes, merit increases) | Retro, comp changes, new elections |

At least two consecutive parallels must meet exit criteria. If P3 fails, a P4 is added before go-live is confirmed.

### Entry criteria

- All configuration complete and unit tested; end-to-end test scripts passed (hire to pay, terminate to final pay, time to pay, absence to pay, journal to NetSuite).
- Balances converted and validated to Rippling (YTD by tax and deduction, accrual balances).
- Legacy register, time and input files for the period are frozen and loaded.
- Variance tolerances signed off by the Controller.

### Tolerance thresholds

| Measure | Tolerance |
|---|---|
| Net pay per employee | $0.00 unexplained; any difference must be explained before exit |
| Gross, employee taxes, deductions per employee | $0.00 unexplained |
| Employer taxes total | ± $1.00 per period total for rounding, explained |
| Headcount paid | Exact |
| GL by account | Exact |
| Explained differences | Allowed only if Workday is correct (legacy error, timing) or the difference is a signed-off configuration decision |

The bar is "every variance explained", not "within 1%". Payroll errors are individual: an aggregate tolerance can hide one person's missed garnishment.

### Triage and closure

1. The app (or the equivalent Workday reconciliation report) compares every register column per employee.
2. Each variance gets a root cause and classification: **legacy error**, **configuration difference**, **timing** or **data**, and which system is correct.
3. Root causes are proven by re-performance: recalculating under the identified cause must reproduce the legacy number to the cent. That is how the app explains all 19 variances in this period.
4. Workday defects are fixed in sandbox, retested, migrated under change control, and the parallel is rerun for affected employees.
5. A variance log records owner, root cause, decision, fix and retest evidence; the Payroll Manager and Controller sign it at the end of each parallel.

Results from this period's parallel:

| Classification | Root causes | Correct system |
|---|---|---|
| Legacy error | Garnishment not deducted (E0031); vacation payout missing at termination (E0148) | Workday |
| Configuration difference | Mid-period comp change applied to full period (E0057); CA meal premiums not calculated (6 workers); Social Security wage base (5 workers) | Workday, except the wage base: **legacy is right** ($184,500 is the 2026 base); fix Workday |
| Timing | Unpaid leave entered after legacy cutoff (E0149); timesheet correction not yet in legacy (E0033); new hire entered after legacy cutoff (E0345) | Workday |
| Data | Contractor paid through payroll (C0003); hire date (E0203); work-state change not sent (E0088); duplicate punch (E0035) | Workday |

### Exit criteria

- Two consecutive parallels with zero unexplained variances.
- All Workday defects closed and retested; no open severity 1–2 issues.
- GL journals posted to the NetSuite sandbox and tied out.
- Bank and tax provider test files accepted.
- Sign-off by Payroll Manager, Controller, Head of People Technology and CFO.

## 3. Cutover plan

### Timing relative to a quarter boundary

**Go live with the first payroll of a quarter, ideally January 1, 2027 (first check Jan 20 for Jan 1–15).**

- Starting at a calendar year means no YTD balances need converting for taxes: Workday starts at zero and Rippling files the 2026 W-2s and Q4 941. This removes the riskiest conversion entirely.
- If January is too close to the SOX design deadline, the fallback is the first payroll of Q2 (April 1, 2027): quarter-to-date and year-to-date balances are converted, Rippling files Q1 and Workday files Q2 onward, and W-2s combine both through the YTD conversion.
- Never go live mid-quarter: it splits a quarterly 941 and state filings across two systems.

### Balance conversion (for a non-January go-live)

| Balance | Source | Validation |
|---|---|---|
| YTD and QTD gross, taxable wages by tax (federal, FICA, Medicare, FUTA, each SUI, each state, SDI) | Rippling YTD report by employee | Totals by tax agree to filed 941 / state returns for completed quarters; per-employee spot checks |
| YTD taxes withheld and employer taxes | Rippling | Agree to deposits |
| YTD deductions (401k pre-tax and Roth, catch-up, HSA, Section 125) | Rippling and recordkeeper | 401(k) agrees to recordkeeper (needed for annual limits) |
| Garnishment balances (arrears, amount paid to date) | Rippling and orders | Agree to agency statements |
| Absence balances (vacation, sick, used-this-year for the 40-hour CA sick usage cap) | Rippling / legacy absence | Per-employee report signed by HR; totals tie |
| Prior-period time (last workweek straddling cutover) | Legacy time | Needed for weekly OT in the first Workday period |

Converted balances are loaded by EIB, then the Workday YTD report is compared to the Rippling source to the cent by employee and tax; differences block go-live.

### Freeze windows

| Window | What freezes |
|---|---|
| T−10 business days | Configuration freeze in production (fixes only through emergency change) |
| T−5 | Benefit elections and bank account changes entered in both systems or held |
| T−3 | Final Rippling payroll processed; legacy time and absence closed |
| T−2 to T0 | Balance conversion load and validation; no HR transactions in Rippling |
| T0 | Workday is the system of record; Rippling set to read-only (retained for W-2c and audit) |

### First live payroll checklist

- [ ] Converted balances validated and signed off
- [ ] All active workers in the correct pay group; contractors in none
- [ ] Tax registrations in every work state; SUI rates loaded for 2027
- [ ] Bank (ACH) and tax provider live connections tested with a pre-note
- [ ] Time approved by cutoff; Unapproved Time report empty
- [ ] Pre-payroll audit run; every critical item cleared, warnings explained
- [ ] Register reviewed against the last Rippling register (expected differences listed)
- [ ] Controller approval of register summary and cash requirement
- [ ] Settlement file released with dual approval; confirmation received
- [ ] Journal validated, posted to NetSuite, tied out
- [ ] Pay statements published; employee communication sent; help desk staffed on payday
- [ ] Go / no-go recorded with names and timestamps

**Rollback:** if the go / no-go fails, Rippling runs the payroll (it stays configured and licensed for the first two live periods).

## 4. Hypercare

Hypercare covers the first four live payroll cycles (two months).

### What to measure each cycle

| Metric | Target |
|---|---|
| Off-cycle payments for errors | 0 (track any, with root cause) |
| Employee pay tickets | < 1% of headcount, trending down |
| Unexplained variances vs expected (prior period, adjusted for known changes) | 0 |
| Time approved by cutoff | ≥ 98% |
| Journal posted and tied out | By T+1 of check date |
| Tax deposits | 100% on time, no notices |
| Pre-payroll audit critical items open at approval | 0 |
| Integration failures (bank, tax, NetSuite, benefits, providers) | 0 unresolved by next business day |
| Control evidence complete for PR-01 to PR-11 | 100% per cycle |

### Exit criteria

- Four consecutive cycles meeting the targets above, including one month-end and one benefit-deduction cycle.
- No open severity 1–2 defects; known issues have owners and dates.
- Run-book, calendar and control evidence handed to Payroll Operations; support moves from the project team to the People Technology queue.
- First quarterly tax filing from Workday reconciled (if within hypercare) or a dry-run reconciliation completed.
- Sign-off by Payroll Manager and Controller.
