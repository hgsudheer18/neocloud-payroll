# Time Tracking design: non-exempt population

About 25 non-exempt data center technicians in On-Prem record time: 15 in San Jose (California rules) and 10 in Austin (federal FLSA rules only). They work day, swing and night shifts and occasionally seventh days during outages. This document covers the Workday configuration, the calculation order, and how hours feed pay. The engine in `lib/engine/time.ts` implements the same rules, and the app's Time calculation page shows every day for every technician.

## 1. Configuration

### Eligibility and templates

| Item | Configuration |
|---|---|
| Eligibility | Time tracking eligibility rule: `Worker is non-exempt AND pay rate type = Hourly AND company = NeoCloud Inc.` |
| Time entry template | `DC Technician – Clock In/Out`: web, mobile and badge-reader clock events with meal out/in; manual entry only through the Time Administrator |
| Time Clock Events | In, Meal Out, Meal In, Out; badge reader integration posts events every 15 minutes |
| Work schedule calendars | `DC Day 06:00–14:30`, `DC Swing 14:00–22:30`, `DC Night 22:00–06:30`, each with a 30-minute meal; rotating calendars for 4-on/3-off coverage |
| Workday definition | Workday = the shift's start date. California requires a fixed, recurring 24-hour workday; the night-shift group's workday is defined as 18:00–18:00 so a 22:00–06:30 shift sits entirely in one workday |
| Workweek | Sunday 00:00 to Saturday 24:00 (fixed, recurring 168 hours) |
| Time period schedule | Biweekly from go-live (two Sunday–Saturday workweeks, matching the US Biweekly pay group); the Oct 1–15 parallel run is semi-monthly. Time-approval cutoff: period end + 1 business day |

### Time entry codes

| Code | Use | Counts as hours worked |
|---|---|---|
| Regular Work | Clocked time | Yes |
| Meal | Unpaid meal | No |
| On-Call Callback | Callback during on-call | Yes |
| Training | Paid training | Yes |
| Vacation, Sick (from Absence) | Time off | No (paid, but excluded from OT and accrual) |

### Validations on the time entry template

| Validation | Severity | Prevents |
|---|---|---|
| Overlapping or identical time blocks on the same day | Critical (cannot submit) | Duplicate punch (E0035 Oct 7) |
| Missing Out punch older than 16 hours | Critical | Open shifts carried into the next day |
| Single shift over 16 hours | Critical, Time Administrator override | Keying errors (e.g. 06:00 to 06:00) |
| Shift over 5 hours without a meal, or meal starting after the 5th hour | Warning + worker attestation (meal waived / not provided) | Unrecorded meal violations; the attestation drives the premium |
| Meal shorter than 30 minutes | Warning + attestation | Short meals |
| Over 12 hours without a second meal | Warning | Second meal premiums |
| Edit to a locked prior period | Not allowed; use the correction business process | Untracked retro changes (E0033) |
| Seventh consecutive day scheduled | Warning to manager at scheduling | Avoidable 7th-day premiums |

### Approval routing

`Enter Time` business process: worker submits → manager approves → (if the time block is in a locked period, or a Time Administrator entered it for the worker) Time Administrator review. Delegation to a backup manager is mandatory for data center shift leads. Unapproved time at cutoff appears on the Unapproved Time report; payroll pays only approved time.

## 2. Time calculations and their order of evaluation

Workday evaluates time calculations in priority order. The order matters: each step consumes hours that later steps can no longer claim, which is how pyramiding is avoided.

| Order | Calculation | Applies to | Rule |
|---|---|---|---|
| 1 | Clean time blocks | All | Drop exact duplicates; apply approved corrections; reject overlaps |
| 2 | Shift attribution | All | Whole shift belongs to the workday it starts on |
| 3 | Night differential tag | All | Worked minutes between 22:00 and 06:00 get the `NIGHT` tag (in addition to their hour category) |
| 4 | Meal compliance | CA | Missed, late (start after the end of the 5th hour), short (< 30 min); > 12 hours without a second meal. One premium per workday |
| 5 | Seventh consecutive day in workweek | CA | If the worker worked all seven days Sun–Sat: Saturday hours ≤ 8 → `SEVENTH_OT` (1.5x), > 8 → `SEVENTH_DT` (2x) |
| 6 | Daily overtime | CA | ≤ 8 → `REG`, 8–12 → `OT_DAILY`, > 12 → `DT_DAILY` |
| 7 | Weekly overtime | CA and FLSA | Regular hours beyond 40 in the workweek become `OT_WEEKLY`, chronologically. In CA only regular hours count toward 40, so daily OT is never paid twice |
| 8 | Regular rate | All | (Base × hours + night differential) ÷ hours, per workweek; feeds the OT adjustment and meal premium |

Texas workers skip steps 4–6: FLSA has no daily overtime, no seventh-day rule and no meal premium. E0022 worked seven consecutive days ending Tue Oct 6 and receives no premium, which the app flags as an informational exception. Even in California that run would not trigger the 7th-day rule because it spans two workweeks.

## 3. How categories feed pay components

| Time calculation tag | Pay component | Rate |
|---|---|---|
| REG | Regular Hours | 1.0 × base |
| OT_DAILY, OT_WEEKLY, SEVENTH_OT | Overtime 1.5x | 1.5 × base |
| DT_DAILY, SEVENTH_DT | Double Time 2.0x | 2.0 × base |
| NIGHT | Night Shift Differential | + $3.00/hr |
| Regular-rate true-up | OT Regular-Rate Adjustment | (RR − base) × (0.5 × OT + 1.0 × DT) |
| Meal premium count | Meal Period Premium | 1 hour × RR |

The OT adjustment exists because FLSA (29 CFR 778) and California require overtime at 1.5x the **regular rate**, which includes shift differentials. Paying 1.5 × base underpays night workers who work overtime. Example, E0027 (CA, $43.50/hr, nights): in the Oct 4 workweek the regular rate is $46.18 because most hours carry the $3.00 differential. The 2 hours of daily OT on Oct 7 are paid at 1.5 × $43.50 on the OT line, and the OT_ADJ line adds (46.18 − 43.50) × 0.5 × 2 = $2.68. Three technicians get an adjustment this period, $3.13 in total: small, but legally required.

### Worked example, E0021 (CA, $42.00/hr), first three days from the brief

| Day | Punches | Worked | Meal | REG | OT | DT | Notes |
|---|---|---|---|---|---|---|---|
| Thu Oct 1 | 06:00–16:30, meal 11:15 | 10.00 | Late (11:15 > 11:00) | 8.00 | 2.00 daily | | The brief did not note this one, but the meal started 15 minutes after the 5th hour ended |
| Fri Oct 2 | 06:00–19:15, meal 12:45 | 12.75 | Late | 8.00 | 4.00 daily | 0.75 | Over 12 hours |
| Sat Oct 3 | 06:00–15:00, no meal | 9.00 | Missed | 0.00 | 1.00 daily + 8.00 weekly | | Sep 28–Oct 2 already had 40 regular hours, so Saturday's first 8 become weekly OT |

Pay: 88.00 REG × $42 + 15.00 OT × $63 + 0.75 DT × $84 + 3 meal premiums × $42 = **$4,830.00** gross.

## 4. The three data problems in the timesheet

### Shift crossing midnight (E0022, Oct 1 22:00 → Oct 2 06:30)

- **Treatment:** one 8-hour shift on the Oct 1 workday (the start date), with 7.5 night-differential hours (22:00–02:00 and 02:30–06:00). It is not split into two days, which would create two short days and corrupt the consecutive-day count.
- **Workday:** the time calculation uses "shift start date" attribution, and the night group's workday is 18:00–18:00.
- **Prevention:** the clock template allows an Out event up to 16 hours after In without a date change; anything longer is a critical error.

### Retroactive correction (E0033, Sep 30)

- **Treatment:** the corrected block replaces the original; the prior period is recalculated and the difference is paid as RETRO ($243.38). See the retro design in the Payroll document.
- **Workday:** prior periods are locked after payroll completes; the correction is entered through a correction business process that requires manager approval and records reason and original values. Payroll's retro processing picks up the change automatically.
- **Prevention:** missing Out punches trigger a next-morning notification to the worker and manager, so the correction happens inside the open period rather than after it closes.

### Duplicate punch (E0035, Oct 7)

- **Treatment:** the second identical block is excluded and logged as a critical exception. Hours counted once: 8.00, not 16.00 (legacy paid both, $686.25 too much).
- **Workday:** the overlapping time block validation makes this impossible to submit; badge-reader imports are de-duplicated on worker + timestamp before they create time blocks.

## 5. Interaction with Absence

- Approved vacation and sick time create time-off blocks on the timesheet that replace scheduled hours; they are paid (VAC / SICK) but are not hours worked, so they never count toward overtime or accrual.
- California sick pay is paid at the regular rate of pay for the workweek (which includes the night differential for night workers).
- Hourly accruals read hours worked from Time Tracking at period end, after approval (see the Absence design).
