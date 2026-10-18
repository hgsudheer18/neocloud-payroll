# Absence design: plans for every country

Six plans cover the population. All of them use one pattern: **opening balance + accrual − time off taken − payout = ending balance**, with accrual posted at the end of the period. Plan rules are configuration (`lib/config/absencePlans.ts`); the engine (`lib/engine/absence.ts`) has no country-specific code.

## 1. Plan configuration

| | US Flexible PTO | US Hourly Vacation | CA Paid Sick Leave | UK Annual Leave | Ontario Vacation | India Earned Leave |
|---|---|---|---|---|---|---|
| Workday object | Time off plan, no balance (tracking only) | Time off plan + accrual | Time off plan + accrual | Time off plan + accrual | Time off plan + accrual | Time off plan + accrual |
| Eligibility | US exempt | US non-exempt | CA non-exempt (CA exempt covered by Flexible PTO) | UK employees | Canada (Ontario) employees | India (Karnataka) employees |
| Unit | Hours | Hours | Hours | Days | Days | Days |
| Accrual method | None | Per hour worked: 1/26 hr per hour (80 hrs per 2,080) | Per hour worked: 1 hr per 30 | 25 days/yr, monthly (2.0833) | 15 days/yr, monthly (1.25) | 18 days/yr, monthly (1.5) |
| Frequency | n/a | Each semi-monthly period, from approved time | Each period | Monthly at month end | Monthly at month end | Monthly at month end |
| Hours that count | n/a | Regular + OT worked; not paid time off | Same | n/a | n/a | n/a |
| First period | n/a | From hire date | From hire date | Pro-rated by calendar days | Pro-rated by calendar days | Pro-rated by days employed |
| Waiting period | None | 90 days to use | 90 days to use | None | None | None (statutory eligibility after 240 days worked is met by policy) |
| Cap | n/a | 120 hrs balance (accrual stops) | 80 hrs balance; 40 hrs use per year | None (carryover limits instead) | None | 45 days carry-forward |
| Carryover | n/a | Full balance up to cap; no use-it-or-lose-it (illegal in CA) | Up to cap | Jan–Dec holiday year; up to 5 days to 31 Mar | Must be taken within 10 months of entitlement year (ESA) | Up to 45 days |
| Payout on termination | No | Yes, at final base rate | No (reinstated if rehired within 12 months) | Accrued untaken, pro-rated to leaving date | Yes, not less than 4% (6% after 5 yrs) vacation pay | Encashment at basic ÷ 26 per day |
| Statutory leave | n/a | No accrual (no hours) | No accrual | Continues to accrue | Continues to accrue | Continues (maternity counts as days worked) |

Bank holidays (UK 8 days) and India casual/sick leave are separate plans; they are outside this exercise.

## 2. What happens on hire, leave and termination

| Event | US hourly | US exempt | UK | Ontario | India |
|---|---|---|---|---|---|
| Hire mid-period | Accrues from hire on hours worked; balance usable after 90 days | Eligible for Flexible PTO from day one | First month pro-rated by calendar days | Pro-rated (E0340, hired Oct 15: 1.25 × 17/31 = 0.69) | Pro-rated |
| Unpaid leave | No hours worked, so no accrual; balance frozen | No balance | Unpaid non-statutory leave suspends accrual | Same | Same |
| Statutory leave | n/a (FMLA/CFRA unpaid: no hours) | n/a | Accrues (E0318 on maternity leave accrues 2.08 days in October) | Accrues | Accrues |
| Termination | Final accrual, then pay out full balance with final pay | No payout (unless a frozen legacy balance exists, see E0148) | Pro-rate to leaving date, pay out as a one-time payment to the provider | Pay out with final pay | Encash in full and settle |

## 3. Ending balances for the sample workers

From the app (Absence balances page) for this period: US Oct 1–15, international October.

| Worker | Plan | Opening | Accrual | Taken | Paid out | Ending |
|---|---|---|---|---|---|---|
| E0001 | US Flexible PTO | unlimited | none | 8.00 hrs (Oct 13) | | not tracked |
| E0021 | US Hourly Vacation | 46.50 | 3.99 (103.75 hrs worked ÷ 26) | 0 | | **50.49 hrs** |
| E0021 | CA Paid Sick Leave | 28.00 | 3.46 (103.75 ÷ 30) | 0 | | **31.46 hrs** |
| E0006 | UK Annual Leave | 14.50 | 2.08 | 2.00 (Oct 19–20) | | **14.58 days** |
| E0008 | Ontario Vacation | 9.00 | 1.25 | 1.00 (Oct 23) | | **9.25 days** |
| E0009 | India Earned Leave | 11.00 | 1.50 | 3.00 (Oct 26–28) | | **9.50 days** |
| E0148 | US Hourly Vacation | 31.00 | 2.15 | 0 | 33.15 | **0.00 hrs** |

### Terminated worker E0148

- Last day Fri Oct 9. Exempt and salaried, but holds a **legacy hourly vacation balance** (31.00 hours). The app flags the eligibility mismatch: the most likely history is a conversion from non-exempt or a policy change to Flexible PTO that froze the earlier balance. In California, accrued vacation is earned wages and cannot be forfeited by a policy change, so it is paid out.
- Final accrual: the work schedule supplies hours for salaried workers. 7 paid days × 8 = 56 hours × 1/26 = **2.15 hours**.
- Payout: 31.00 + 2.15 = 33.15 hours × ($165,000 ÷ 2,080 = $79.3269) = **$2,629.69**, paid as `PTO_PAYOUT`, which debits accrued PTO (2150) rather than wage expense.
- Payment timing: California requires final wages on the last day (involuntary) or within 72 hours (resignation without notice). The payout goes on an **On-Demand Payment** on Oct 9, not the Oct 20 check. The app shows it in the period run so it reconciles, and raises a critical audit flag.
- Legacy omitted the payout: classified as a legacy error.

## 4. How absence interacts with time and payroll

### Hourly workers (time tracking)

- **Time off reduces scheduled hours.** A vacation request on a scheduled day places an 8-hour time-off block on the timesheet; the worker does not clock in. E0024's Oct 9 vacation is paid as `VAC` 8.00 hours and there is no worked time that day.
- **Paid time off is not hours worked.** It is excluded from daily and weekly overtime and from per-hour accruals. E0038 took 8 hours of vacation on Tue Oct 13; those 8 hours are paid but do not count toward that week's 40.
- **Accrual uses approved hours worked.** Accruals run after time approval at period end, from the same calculated hours that pay the worker, so accrued hours and paid hours come from one number (103.75 for E0021).
- **Control:** hourly PTO hours taken (balance reduction) must equal VAC + SICK hours paid. This period: 24.00 = 24.00.

### Payroll and the unpaid leave (E0149)

- **Leave of Absence** business process (type: Personal, unpaid) effective Thu Oct 8. Leave type configuration sets "affects payroll: stop pay" and "suspend accruals".
- Salary is prorated on working days: $180,000 ÷ 24 × 5/11 = **$3,409.09** for Oct 1–7.
- Benefits continue during leave. The medical premium is still deducted this period because there are earnings; in later zero-pay periods it goes into arrears for collection on return (FMLA continuation) or direct billing.
- The leave was entered Oct 13, after the legacy input cutoff, so legacy paid the full period ($7,500.00): a timing variance of $4,090.91 gross. In production, an overpayment like this is recovered with written authorization where state law requires it (NY Labor Law §193).
- **Control:** leave business processes must complete before the pay calculation cutoff; late leave entries appear on the pre-payroll audit as "trailing-average drop" with the leave date as the reason.
