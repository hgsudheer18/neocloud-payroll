# Memo: Oct 1–15, 2026 parallel run reconciliation

**To:** Controller, NeoCloud Inc.
**From:** Sudheer, Workday Payroll Implementation Lead
**Date:** 10/20/2026
**Subject:** Workday vs Rippling parallel run, US semi-monthly Oct 1–15 (check date 10/20/2026)

## 1. Recommendation

**This period passes parallel.** Every one of the 280 Workday payees and every legacy register row is reconciled: 267 employees match Rippling to the cent, 14 differences are explained and proven by recalculation, and none is unexplained. In every one of the 14, Workday is correct. All eight control totals tie and the US journal balances at $2,300,424.38 with every line mapped to NetSuite.

Two of the differences are Rippling errors with legal exposure (a child support order not withheld, and a California vacation payout missing from final pay); they need action now regardless of go-live. One configuration point was checked rather than copied: the implementation brief quoted a Social Security wage base of $168,600, which is the 2024 figure. Workday is configured with the 2026 base of $184,500, the same as Rippling, so high earners reconcile to the cent.

## 2. Headcount

| | Count | Detail |
|---|---|---|
| Workers on file | 354 | Every row in the worker file |
| − Contingent workers | 5 | C0001–C0005: paid through AP, not payroll |
| − Other pay groups | 69 | UK, Canada and India, paid by in-country providers |
| = US employees eligible | 280 | US Semi-Monthly pay group, employed at least one day |
| − Zero-pay eligible | 0 | |
| **= Paid in Workday** | **280** | |
| + Paid only in Rippling | 1 | C0003, a contractor paid as an employee |
| − Paid only in Workday | 1 | E0345, hired after the Rippling input cutoff |
| **= Rows in the Rippling register** | **280** | Ties |

Movement: 278 active on Oct 1, plus 2 hires (E0203, E0345), less 1 termination (E0148), gives 279 active on Oct 15, including E0149 on unpaid leave.

## 3. Totals

| | Rippling | Workday | Rippling − Workday |
|---|---|---|---|
| Gross pay | $1,986,453.42 | $1,973,794.91 | $12,658.51 |
| Net pay | | $1,312,036.43 | $8,190.19 |
| Total burdened cost (gross + employer taxes + benefits) | | $2,300,424.38 | |

## 4. Variances, root cause and disposition

Amounts are Rippling minus Workday.

| Root cause | Class | Correct | Employees | Gross | Net | Disposition |
|---|---|---|---|---|---|---|
| Contractor paid through payroll | Data | Workday | C0003 | $6,500.00 | $4,388.71 | Remove from payroll; pay through AP on invoices (1099). Legal and HR to review classification and whether W-2c / 941-X corrections are needed |
| CA meal premiums not calculated in Rippling | Configuration | Workday | E0021, E0029, E0030, E0031, E0032, E0035 | −$344.06 | −$215.00 | Workday applies Labor Code 226.7 at the regular rate. Quantify Rippling's exposure for prior periods and raise with Legal |
| Garnishment not deducted in Rippling | Legacy error | Workday | E0031 | $0.00 | $450.00 | Active child support order not withheld. Confirm the order date, deduct and remit, notify the agency: the employer is liable for missed amounts |
| Prior-period timesheet correction not yet in Rippling | Timing | Workday | E0033 | −$243.38 | −$172.44 | Expected. Confirm Rippling does not also pay it next cycle (double-payment risk at cutover) |
| Duplicate punch paid twice | Data | Workday | E0035 | $686.25 | $395.88 | Rippling paid a duplicated block. Recover per policy; Workday blocks duplicate and overlapping blocks at entry |
| Mid-period raise applied to the whole period | Configuration | Workday | E0057 | $530.30 | $277.95 | Workday prorates by working days from the 10/10 effective date. Total Rewards to confirm the proration policy |
| Work-state change not sent to Rippling | Data | Workday | E0088 | $0.00 | −$172.86 | CA → CO on 10/6. Register a Colorado withholding account; refund CA over-withholding within the quarter |
| Vacation payout missing at termination | Legacy error | Workday | E0148 | −$2,629.69 | −$1,539.92 | California final pay must include 33.15 hours of accrued vacation. Pay with the on-demand final check, which was due on the last day (10/9); waiting-time penalty exposure |
| Unpaid leave entered after Rippling's cutoff | Timing | Workday | E0149 | $4,090.91 | $2,698.58 | Rippling paid the full period. Recover the overpayment following state rules (NY), and enforce leave entry before the payroll cutoff |
| Hire date differs from Rippling | Data | Workday | E0203 | $5,037.88 | $2,957.12 | Workday has the correct hire date (10/12). Correct the Rippling record and recover the overpayment |
| Not in Rippling register | Timing | Workday | E0345 | −$969.70 | −$877.83 | Hired after Rippling's input cutoff. Workday pays correctly; Rippling would have missed the first check |

Every explanation was proven by re-performance: recalculating the employee in Workday with the identified cause applied reproduces the Rippling row to the cent. No variance was explained by tolerance.

## 5. Actions requested

| # | Action | Owner | When |
|---|---|---|---|
| 1 | Issue E0148's vacation payout (California final pay) | Payroll Manager | Immediately |
| 2 | Withhold and remit E0031's child support order; notify the agency | Payroll Manager | Next cycle |
| 3 | Recover overpayments: E0035 (duplicate punch), E0149 (unpaid leave), E0203 (hire date) | Payroll Manager with HR | Per recovery policy |
| 4 | Move C0003 to AP; Legal and HR classification review | HR, Legal, AP | Before next cycle |
| 5 | Quantify prior-period CA meal premium exposure in Rippling | Legal, Payroll | This quarter |
| 6 | Confirm working-day proration policy for mid-period changes | Total Rewards | Before P2 |

I recommend signing off this parallel and proceeding to P2 (Oct 16–31), which adds month-end benefit deductions and the full GL cycle.
