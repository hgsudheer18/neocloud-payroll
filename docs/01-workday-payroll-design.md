# Workday Payroll configuration design (US)

NeoCloud pays roughly 280 US employees semi-monthly on Workday Payroll. Most are exempt and salaried; about 25 are non-exempt hourly data center technicians in California and Texas. This document covers pay groups and calendars, the pay component catalog, retro pay, payroll accounting, and multi-state taxation. Every rule described here is implemented in the app's engine (`lib/engine`, `lib/config`), so the design can be checked against real numbers.

## 1. Pay groups and period schedules

### Recommendation: two US pay groups

| Setting | US Semi-Monthly (salaried) | US Biweekly (hourly) |
|---|---|---|
| Who | US exempt, salaried employees | US non-exempt, hourly employees (data center technicians) |
| Period | 1st–15th and 16th–last day; 24 per year | Two Sunday–Saturday workweeks; 26 per year |
| Check date | Period end + 5 calendar days (prior business day if a weekend or holiday) | Friday after period end (6 days) |
| Time period schedule | n/a (exception-based time off only) | Same biweekly periods, aligned to the FLSA workweek |
| Proration | Working days (Mon–Fri) per comp segment | Hours from approved time |
| Per-period deductions | Annual ÷ 24 | Annual ÷ 26 (benefit deduction schedule set per pay group) |

### Why hourly workers are biweekly

- **Overtime is measured per 7-day workweek** (FLSA, and California's weekly rule). A biweekly period is exactly two complete Sunday–Saturday workweeks, so a workweek is never split between two pay periods.
- With semi-monthly periods, a workweek often straddles the 15th or month end. Weekly overtime and the regular-rate adjustment for that week then have to be paid "as worked" and trued up the next period. That is extra retro, harder audits and more questions from employees. The engine handles it (see the Oct 11–17 workweek in the parallel run), but the design should avoid it.
- Daily overtime, double time, seventh-day premiums and the night differential all fall inside whole weeks, so each pay period's time results are self-contained.
- Compliance: California Labor Code 204 allows biweekly pay for non-exempt employees; Texas requires at least semi-monthly, which biweekly exceeds.

### Why salaried workers stay semi-monthly

- Salaried pay doesn't depend on workweeks: 24 equal periods give the same pay every period and line up with monthly benefit premiums and month-end close.
- Exempt employees in the legacy system are already paid semi-monthly; changing their pay frequency is an employee-relations change with no calculation benefit.

### Trade-offs, accepted

| Cost of two pay groups | Mitigation |
|---|---|
| Two calendars and two pay runs (but the hourly run has only ~25 people) | Same business process, controls and journal design; the hourly run is small and quick to audit |
| Two journals per cycle on different dates | Accounting date = period end; biweekly periods that straddle month end are accrued and reversed (see the GL document) |
| 26 vs 24 periods: per-period deductions converted, and twice a year a month has three paydays | Benefit deduction schedules per pay group; communicated to the 25 employees at go-live |

### Transition at go-live

- **Oct 1–15 (parallel run)** stays semi-monthly for everyone, because it must match the legacy Rippling register.
- **Go-live, hourly:** the first biweekly run is a transition period Oct 16–31: a 2-day stub (Fri Oct 16 and Sat Oct 17) that completes the Oct 11–17 workweek, plus the full workweeks Oct 18–31. From then on, normal 14-day periods (Nov 1–14, paid Fri Nov 20).
- **Go-live, salaried:** continue semi-monthly with Oct 16–31, paid Nov 5.
- Per-period deductions for hourly workers convert from ÷ 24 to ÷ 26 at the transition. The app does all of this; see the Pay runs page.

### Alternative considered: one semi-monthly pay group for everyone

One run and one calendar per half month, which is simpler to operate. Rejected because every period would contain at least one split workweek for the hourly population, so overtime would routinely be paid in two parts. At NeoCloud's scale (~25 hourly workers, growing with data center expansion), clean overtime and simpler audits outweigh one extra small pay run.

## 2. Pay component catalog

Feed types: **Compensation** (from the comp plan, prorated by effective date), **Time Tracking** (from calculated time blocks via time calculation tag mapping), **Absence** (time off and plan payouts), **One-Time Payment**, **Benefits** (from benefit elections), **Manual / court order** (payroll input), **Calculated** (by the payroll engine).

Taxability columns: FIT = federal income tax, FICA = Social Security and Medicare, FUTA/SUI, State = state income tax and state employee programs (CA SDI, NY PFL, WA Cares).

### Earnings

| Code | Pay component | Calculation basis | FIT | FICA | FUTA/SUI | State | 401(k) eligible | Feed | Ledger account |
|---|---|---|---|---|---|---|---|---|---|
| SAL | Regular Salary | Annual salary ÷ 24 × paid working days ÷ working days in period, per comp segment | Y | Y | Y | Y | Y | Compensation | 6100 |
| REG | Regular Hours | Regular hours × base rate | Y | Y | Y | Y | Y | Time Tracking | 6100 |
| OT | Overtime 1.5x | (Daily OT + weekly OT + 7th-day first 8) hours × base × 1.5 | Y | Y | Y | Y | Y | Time Tracking | 6110 |
| DT | Double Time 2.0x | (Daily > 12 + 7th-day > 8) hours × base × 2.0 | Y | Y | Y | Y | Y | Time Tracking | 6110 |
| OT_ADJ | OT Regular-Rate Adjustment | (Weekly regular rate − base) × (0.5 × OT + 1.0 × DT hours) | Y | Y | Y | Y | Y | Calculated | 6110 |
| SHIFT | Night Shift Differential | Hours between 22:00 and 06:00 × $3.00 | Y | Y | Y | Y | Y | Time Tracking | 6120 |
| MEAL | Meal Period Premium (CA) | 1 hour × weekly regular rate per workday with a missed, late or short meal (max one per day) | Y | Y | Y | Y | Y | Time Tracking | 6120 |
| RETRO | Retro Pay | Recalculated prior-period result − amount originally paid | Y | Y | Y | Y | Y | Calculated | Same as source component (6100 default) |
| VAC | Vacation Taken (hourly) | Approved hours × base rate; not hours worked | Y | Y | Y | Y | Y | Absence | 6100 |
| SICK | Sick Leave Taken (hourly) | Approved hours × regular rate of pay (CA) | Y | Y | Y | Y | Y | Absence | 6100 |
| PTO_PAYOUT | Vacation Payout on Termination | Ending balance after final accrual × final rate (salary ÷ 2,080) | Y | Y | Y | Y | N (plan document) | Absence | 2150 (relieves accrued PTO) |
| BONUS | Bonus | One-time amount; supplemental wages (optional 22% flat federal) | Y | Y | Y | Y | Y | One-Time Payment | 6130 |

### Deductions

| Code | Pay component | Basis | Reduces | Feed | Liability account |
|---|---|---|---|---|---|
| K401 | 401(k) Pre-Tax | Election % × 401(k)-eligible earnings | FIT, state (not FICA, FUTA) | Benefits | 2120 |
| MED | Medical Premium (Section 125) | Per-period employee premium | FIT, FICA, FUTA/SUI, state | Benefits | 2121 |
| ROTH | Roth 401(k) | Election % × eligible earnings | Nothing (post-tax) | Benefits | 2120 |
| GARN | Child Support Garnishment | min(order amount, CCPA % × disposable earnings) where disposable = gross − mandatory taxes | Post-tax | Manual / court order | 2122 |

### Employee and employer taxes

| Code | Component | Basis | Account |
|---|---|---|---|
| FIT | Federal Income Tax | Annualized percentage method on FIT wages (Pub 15-T, 2026 brackets) | 2110 |
| SS_EE / SS_ER | Social Security | 6.2% × FICA wages up to the remaining annual wage base | 2111 / 6200 + 2111 |
| MED_EE / MED_ER | Medicare | 1.45% × FICA wages; employee +0.9% above $200,000 YTD | 2111 / 6200 + 2111 |
| SIT | State Income Tax | Per work state on wages allocated to that state | 2114 |
| STATE_EE | SDI / PFL / LTC | CA SDI 1.3% (no cap), NY PFL 0.432%, WA Cares 0.58% on that state's wages | 2115 |
| FUTA | FUTA | 0.6% on first $7,000 | 6200 + 2112 |
| SUI | State Unemployment | 3.4% on first $7,000 (brief's simplification; real wage bases vary by state) | 6200 + 2113 |
| BEN_LOAD | Employer Benefits | 10% of gross (US), 5% (international) | 6300 + 2130 |

> **Wage base note.** The exercise specifies a Social Security wage base of $168,600 (the 2024 figure). The actual 2026 base is $184,500. The app uses the brief's number as configured, and the reconciliation shows it as a configuration difference where legacy is correct. In a real implementation the Workday tax configuration would be corrected before parallel testing.

### How the components are built in Workday

- **Earnings and deductions** are pay components with an earning or deduction code, a calculation (for example `Hours × Rate × Multiplier`), and pay component groups that drive taxability (`Federal Taxable Wages`, `FICA Wages`, `401(k) Eligible Earnings`, and so on). Taxability lives in the pay component group membership, not in the calculation, so a new earning inherits correct taxes by joining the right groups.
- **Time Tracking feeds** go through the time calculation tag to pay component mapping (`REG → Regular Hours`, `OT_DAILY / OT_WEEKLY / SEVENTH_OT → Overtime`, and so on). Payroll never reads raw punches.
- **Regular-rate adjustment** is a calculated earning using a related calculation that sums straight-time compensation (base pay + shift differential) for the workweek and divides by hours worked.
- **Garnishments** use Workday's garnishment order setup (order type, issuing state, CCPA limit, payee), entered by one specialist and verified by a second.

## 3. Retro pay design

Both retro scenarios in this period are handled the same way: **recalculate what should have been paid for the affected days, subtract what was paid, pay the difference as `RETRO` in the current open period.** Workday does this automatically when a change is effective in a completed period: the next pay calculation reruns the prior period with the new data and brings the delta forward as retro results.

### Mid-period comp change (E0057, effective Saturday Oct 10)

- Entered before the pay calculation, so no retro is needed. The salary is split into two effective-dated segments, each prorated on working days:
  - $175,000 ÷ 24 × 7/11 (Oct 1–9) = $4,640.15
  - $195,000 ÷ 24 × 4/11 (Oct 12–15) = $2,954.55
  - Total $7,594.70
- If the change had been entered after this period completed, Workday would recalculate Oct 1–15 in the Oct 16–31 run and pay $7,594.70 − $7,291.67 = $303.03 as RETRO, along with the retro impact on 401(k) and taxes.
- Legacy applied the new rate to the whole period ($8,125.00). That $530.30 difference is a configuration difference, not an error, but the policy owner must confirm working-day proration.

### Prior-period timesheet correction (E0033, Wednesday Sep 30)

- The original block (06:00–12:00, meal 11:00–11:30, 5.5 hours) was paid in the Sep 16–30 period. The supervisor corrected the clock-out to 16:30 on Oct 6 (10 hours).
- The engine recalculates the prior-period days of that workweek with the corrected block and pays the difference:
  - Owed: 24.00 REG + 3.50 OT hours = $1,294.31
  - Paid: 21.50 REG + 1.50 OT hours = $1,050.94
  - RETRO: $243.38, which is 2.5 REG + 2.0 OT hours at $44.25
- Because the Sep 27–Oct 3 workweek straddles the two periods, the weekly overtime test uses all seven days. Hours worked Sep 27–30 count toward the weekly 40 for Oct 1–3, which is why prior-period punches are part of the data package.
- Workday configuration: corrections to a closed time period go through a correction business process with manager approval. The time period lock prevents silent edits; the retro flows automatically.

## 4. Payroll accounting design

### Worktags

| Worktag | Source | Maps to NetSuite segment |
|---|---|---|
| Company | Worker's company (employing entity) | Subsidiary |
| Cost Center | Defaulted from the worker's supervisory org; can be overridden on the position | Department |
| Location | Worker's work location | Location |
| Function (custom) | Attribute of the cost center (Cost of Revenue, R&D, S&M, G&A) | Class |
| Pay Group | Pay group | Journal memo / external ID |

**Cost center derivation.** Each supervisory org has a default cost center (for example `Data Center Ops (E0005)` → CC2100). Hires and job changes into that org inherit the cost center, so Finance does not depend on HR remembering to set it. Exceptions (a UK engineer charged to a US cost center) are explicit position-level overrides and are reported monthly. Cost center changes inside a period split earnings by effective date, exactly like comp changes.

### Account posting

| Result type | Debit | Credit | Split by |
|---|---|---|---|
| Earnings (SAL, REG, VAC, SICK, RETRO) | 6100 Salaries & Wages | | Cost center, location |
| OT, DT, OT_ADJ | 6110 Overtime | | Cost center, location |
| SHIFT, MEAL | 6120 Premium Pay | | Cost center, location |
| PTO_PAYOUT | 2150 Accrued PTO | | Company |
| Employee taxes | | 2110–2115 by tax | Company (state on memo) |
| Pre-tax and post-tax deductions | | 2120–2122 | Company |
| Net pay | | 2100 Net Pay Clearing | Company |
| Employer taxes | 6200 Employer Payroll Taxes | 2111–2113 | Expense by cost center, in proportion to the worker's earnings by cost center |
| Benefits load | 6300 Benefits | 2130 Accrued Benefits | Same proportional split |

The journal is summarized by account, cost center and location (82 lines for 280 workers this period), not one line per worker: worker detail stays in Workday, the ledger gets what the P&L and balance sheet need, and the tie-out to the register is by account. The app's General ledger page shows the journal, its validation, and the NetSuite export.

## 5. State-to-state work location change (E0088, CA → CO on Oct 6)

### Representation

- **Change Work Location** (or Change Job) business process effective Oct 6: work location San Francisco → Remote (Denver). The work state follows the location.
- Workday's worker tax allocation is effective-dated, so wages are allocated to each state by the days worked there: 3 of 11 working days to CA, 8 of 11 to CO.
- Home address updated in the same transaction so the resident state also becomes CO (CA no longer taxes a non-resident on CO-sourced wages).
- Federal W-4 is unchanged. State elections: complete the CO withholding certificate (or default), end CA DE 4 withholding.

### Tax impact this period

| Item | Before (legacy) | After (Workday) |
|---|---|---|
| CA wages | $7,166.67 | $1,954.55 (3/11) |
| CO wages | $0 | $5,212.12 (8/11) |
| CA PIT | On all wages | On CA share only |
| CA SDI (1.3%) | On all wages | On CA wages only |
| CO income tax (4.4% approximation) | None | On CO wages |
| SUI | CA account | Moves to CO at the change; YTD SUI wages transfer is a state-specific question (no successor credit between states) |

### Prerequisites and controls

- A Colorado withholding account and Colorado unemployment account must exist before the first CO wages (the payroll tax authority setup in Workday). New-state registration is a standing item on the HR-to-payroll checklist for remote moves.
- Colorado FAMLI premiums apply to CO wages; the exercise does not model them, and production configuration must.
- Pre-payroll audit flags every multi-state worker so payroll confirms registration and reciprocity before approving the run.
- Legacy withheld CA tax on all wages: the reconciliation classifies this as a **data** variance (the move was not sent to Rippling). In production, the over-withheld CA tax is corrected within the quarter.
