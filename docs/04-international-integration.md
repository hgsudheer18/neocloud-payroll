# International payroll integration

UK (23 employees), Canada (26) and India (20) are paid monthly by in-country providers. Workday is the system of record for people, compensation, absence and one-time payments; the provider calculates gross-to-net, pays employees, files and remits statutory deductions, and returns results that post to NetSuite.

## 1. Integration approach by country

| Country | Recommendation | Why |
|---|---|---|
| United Kingdom | **Workday Global Payroll Connect** with a certified partner | Bi-directional, Workday-maintained connector: changes out via the Payroll Effective Change Interface (PECI) and results back as payroll results in Workday, with no custom build. UK is a mature partner market (RTI, pensions auto-enrolment, P11D handled by the partner). Note: Workday also has native UK payroll; at roughly 25 people a partner is cheaper to run, but revisit at 100+. |
| Canada | **Global Payroll Connect** with a certified partner | Same reasoning; the partner handles CPP/QPP, EI, provincial tax and ROEs. Native Workday Canada payroll is the long-term option if headcount grows, because it removes a monthly reconciliation. |
| India | **Custom PECI** to the incumbent local provider, plus an inbound results EIB | India payroll depends on items Workday does not hold natively (old vs new tax regime declarations, investment proofs, Professional Tax by state, LWF, PF and ESI), and strong local providers are often not Global Payroll Connect partners. PECI still gives effective-dated change data; results come back through an EIB of external payroll results so costs can be reconciled and posted. Re-evaluate a GPC partner at the next provider renewal. |

**Why PECI rather than PICOF.** Both are Workday's Cloud Connect for Third-Party Payroll options. PICOF sends a full snapshot of each worker; PECI sends only effective-dated changes with their effective dates, in sequence, and handles corrections and rescinds explicitly. For a provider that has to compute retro (E0330's late merit increase), effective-dated changes are what it needs. PECI also supports multiple pay groups and countries from one integration system.

## 2. Data mapping: United Kingdom

### Outbound: Workday to provider (PECI, monthly plus on-demand)

| Area | Workday field | Provider field | Notes |
|---|---|---|---|
| Worker | Employee ID | Employee reference | Primary key both ways |
| Worker | Legal name, preferred name | Forename, surname, known-as | |
| Worker | National ID (NI number) | NI number | Required for RTI; a validation blocks hire completion without it or a placeholder flag |
| Worker | Date of birth, gender, address | Personal details | Address drives the Scottish/Welsh tax code prefix |
| Worker | Hire date, termination date, termination reason | Start date, leave date, leaver reason | Leaver triggers P45 |
| Worker | Pay group `UK Monthly`, company NC-UK | Payroll ID, employer PAYE reference | |
| Worker | Bank account (sort code, account) | Payment details | Payment election changes are dual-approved |
| Worker | Tax code, starter declaration (A/B/C), student loan plan | Tax details | Collected in onboarding |
| Compensation | Base pay (annual salary), currency GBP, effective date | Annual salary, effective date | Provider prorates by calendar days |
| Compensation | Allowances (car, location) | Recurring payments | |
| Compensation | Pension plan and % (employee, employer), salary sacrifice flag | Pension scheme fields | |
| Absence | Leave of absence type, start and end dates | Absence records | Statutory maternity drives SMP calculation (E0318) |
| Absence | Time off taken (annual leave days) | Holiday taken | Information only; balances stay in Workday |
| Absence | Sickness days | SSP qualifying days | |
| One-time payment | Bonus, holiday pay in lieu, commission (type, amount, payment date) | One-off payments | E0315 leaver (Oct 23): 15.05 days holiday pay in lieu, £3,936.15 |
| Cost allocation | Cost center, company, location | Cost codes | Needed for the GL file from the provider |

### Inbound: provider to Workday and NetSuite

| Result | Content | Destination |
|---|---|---|
| Gross-to-net per employee | Gross by element, PAYE tax, employee NI, student loan, pension, net | Workday external payroll results (for reconciliation, total rewards and reporting) |
| Employer costs per employee | Employer NI, employer pension, apprenticeship levy | Workday external payroll results; GL |
| Payment file confirmation | Net pay total and payment date | Treasury for funding |
| GL summary | Debits and credits by element and cost center, in GBP | NetSuite subsidiary NeoCloud UK Ltd. (via the same journal validation as US) |
| Statutory filings | RTI FPS/EPS submission references | Retained as evidence |

## 3. Monthly calendar (October 2026)

| Business day | Date | Step | Owner |
|---|---|---|---|
| | Throughout month | Changes entered in Workday; PECI runs nightly in "preview" so the provider sees changes early | HR Ops |
| Cutoff | Tue Oct 20 | Change cutoff: final PECI file includes everything entered by end of day | HR Ops / Payroll |
| +1 | Wed Oct 21 | Provider loads the file and returns an import exception report the same day | Provider |
| +2 to +3 | Oct 22–23 | Provider calculates; first draft results and variance report | Provider |
| +4 | Mon Oct 26 | NeoCloud review: reconcile provider results to Workday expected (app International page), approve or return | International Payroll Lead, Payroll Manager |
| +5 | Tue Oct 27 | Funding: Treasury funds the provider's client account (net pay + statutory) per approved cash requirement | Treasury |
| Pay date | Wed Oct 28 | Employees paid; RTI submitted by provider on or before the pay date | Provider |
| +1 after pay | Thu Oct 29 | Results file loaded into Workday; GL journal validated and posted to the NetSuite subsidiary | Payroll / Accounting |
| Month end | Sat Oct 31 | Intercompany recharges for cross-entity cost centers posted | Accounting |

Changes entered after the cutoff roll to the next month's file; the provider pays any retro then.

## 4. October employer cost for the sample workers

Using the brief's approximations: UK employer NI 13.8% above £758/month; Canada CPP + EI 7.5% blended; India PF 12% of basic (basic = 50% of gross); benefits 5%; reporting FX GBP 1.27, CAD 0.73, INR 0.012.

| | E0006 (UK) | E0008 (Canada) | E0009 (India) |
|---|---|---|---|
| Annual salary | £85,000 | C$225,000 | ₹45,00,000 |
| Monthly gross | £7,083.33 | C$18,750.00 | ₹3,75,000.00 |
| Employer statutory | NI 13.8% × (7,083.33 − 758) = **£872.90** | 7.5% × 18,750 = **C$1,406.25** | 12% × 187,500 = **₹22,500.00** |
| Benefits 5% | £354.17 | C$937.50 | ₹18,750.00 |
| Total employer cost (local) | **£8,310.40** | **C$21,093.75** | **₹4,16,250.00** |
| USD | **$10,554.21** | **$15,398.44** | **$4,995.00** |

### How it posts

Each subsidiary books in its functional currency; NetSuite consolidates to USD. Example for E0006 in NeoCloud UK Ltd. (GBP), using provider actuals:

| Account | Department | Debit | Credit |
|---|---|---|---|
| 6100 Salaries and Wages | CC2300 UK Field Ops | £7,083.33 | |
| 6200 Employer Taxes | CC2300 | £872.90 | |
| 6300 Benefits | CC2300 | £354.17 | |
| 2100 Net Pay (provider funds) | | | provider net |
| 2117 Employee Statutory Withholdings | | | gross − net |
| 2116 Employer Statutory Contributions | | | £872.90 |
| 2130 Accrued Benefits | | | £354.17 |

In USD at the 1.27 reporting rate this is a $10,554.21 expense in consolidation. NetSuite applies its own consolidated exchange rates at close (average rate for P&L); the app uses the brief's single rate so the numbers can be checked by hand.

E0008 (Canada) sits in cost center CC3100 (Engineering Platform), owned by the US entity. NeoCloud Canada books the cost and recharges it: Dr 1300 Intercompany Receivable / Cr 6900 Intercompany Recharge for C$21,093.75 in NC-CA, and Dr 6400 Intercompany Service Cost (CC3100) / Cr 2300 Intercompany Payable for $15,398.44 in NC-US. The recharge is at cost here; transfer pricing (typically cost plus a markup for a service entity) is a Tax decision and only changes the recharge amount.

## 5. Reconciling provider results each cycle

The app's International page runs this every month:

1. **Population:** every worker in Workday's monthly pay groups has a provider result and vice versa. Missing or unexpected workers block approval.
2. **Gross:** provider gross versus Workday expected gross (salary by calendar-day segment, plus one-time payments and leave payouts sent in the file). Tolerance: zero for salary; differences need a reason.
3. **Employer cost:** re-perform the statutory rate on the provider's gross; tolerance 1.00 in local currency for provider rounding.
4. **Net and cash:** total net and statutory remittances agree to the provider's funding request before Treasury pays.
5. **GL:** the provider GL summary agrees to the results file by element, and the journal passes the same mapping and balance validation as the US journal.
6. **Classification:** each difference is timing (late change, paid next month), data (wrong in Workday), provider error, or unexplained. Unexplained differences stop funding.

This month: 68 of 69 workers match exactly. **E0330** (India) is a timing difference: an annual merit increase effective Oct 1 was entered Oct 22, after the Oct 20 cutoff, so the provider paid ₹2,66,666.67 instead of ₹3,00,000.00. The change goes in November's file and the provider pays one month of retro. The GL posts provider actuals; the open item is logged and cleared in November.
