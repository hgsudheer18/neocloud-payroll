# General ledger integration: Workday to NetSuite

NeoCloud's books are in NetSuite OneWorld with four subsidiaries: NeoCloud Inc. (USD), NeoCloud Canada Ltd. (CAD), NeoCloud UK Ltd. (GBP) and NeoCloud India Pvt. Ltd. (INR). US payroll results come from Workday Payroll; international results come from the providers through Workday. This document covers the mapping, the journal, the integration mechanism, multi-entity posting and the close controls. The app's General ledger page produces and validates the journal and exports it in NetSuite import format.

## 1. Account and segment mapping

### Accounts

Workday pay components post to Workday ledger accounts through account posting rules. The ledger accounts map one-to-one to NetSuite accounts in a mapping table (`data/gl_account_mapping.csv`).

| Workday ledger account | Fed by | NetSuite account | Owner |
|---|---|---|---|
| 6100 Salaries & Wages | SAL, REG, RETRO, VAC, SICK; international gross | 60100 Payroll : Salaries and Wages | Controller |
| 6110 Overtime & Double Time | OT, DT, OT_ADJ | 60110 Payroll : Overtime | Controller |
| 6120 Shift Differential & Premium Pay | SHIFT, MEAL | 60120 Payroll : Premium Pay | Controller |
| 6130 Bonus | BONUS | 60130 Payroll : Bonus | Controller |
| 6200 Employer Payroll Taxes | SS_ER, MED_ER, FUTA, SUI; international employer statutory | 60200 Payroll : Employer Taxes | Controller |
| 6300 Employee Benefits | BEN_LOAD | 60300 Payroll : Benefits | Controller |
| 2100 Net Pay Payable | Net pay | 21000 Accrued Payroll : Net Pay Clearing | Payroll Manager |
| 2110 Federal Income Tax Withheld | FIT | 21100 | Payroll Manager |
| 2111 FICA Payable | SS and Medicare, employee and employer | 21110 | Payroll Manager |
| 2112 / 2113 FUTA / SUI Payable | FUTA, SUI | 21120 / 21130 | Payroll Manager |
| 2114 State Income Tax Withheld | SIT (state in memo) | 21140 | Payroll Manager |
| 2115 State Programs Withheld | CA SDI, NY PFL, WA Cares | 21150 | Payroll Manager |
| 2116 / 2117 International statutory | Employer and employee statutory (provider remits) | 21160 / 21170 | Payroll Manager |
| 2120 / 2121 401(k) / Medical Payable | K401, MED | 21200 / 21210 | Benefits Manager |
| 2122 Garnishments Payable | GARN | 21220 | Payroll Manager |
| 2130 Accrued Benefits | Employer benefits | 21300 | Benefits Manager |
| 2150 Accrued PTO | PTO_PAYOUT (relieves the accrual) | 21500 | Controller |
| 1300 / 2300 / 6400 / 6900 | Intercompany recharges | 13000 / 23000 / 60400 / 60900 | Controller |

### Segments

| Workday worktag | NetSuite segment | Rule |
|---|---|---|
| Company | Subsidiary | NC-US → 1, NC-CA → 2, NC-UK → 3, NC-IN → 4 |
| Cost Center | Department | CC1100 → 110 … CC4300 → 430 (one-to-one) |
| Cost Center attribute: function | Class | Cost of Revenue, Research & Development, Sales & Marketing, General & Administrative; drives the functional P&L in the S-1 |
| Location | Location | SF → 101, SJ → 102, AUS → 103, Remote-US → 199, Toronto → 201, London → 301, Bangalore → 401 |

Expense lines carry department, class and location. Liability lines are posted at subsidiary level only (no department), because liabilities are cleared by cash, not managed by department.

### Who owns changes

- **Account mapping:** the Controller owns expense accounts; the Payroll Manager owns liability accounts. A new pay component cannot be activated in Workday until its posting rule and NetSuite account are approved (part of control PR-10, change management).
- **Segment mapping:** new cost centers are created in NetSuite first by Accounting, then in Workday by HR Systems with the NetSuite department ID; the integration rejects any cost center without a mapping, so an unmapped cost center fails loudly instead of posting to a suspense account.
- The mapping table is version-controlled (in Workato lookup tables or a NetSuite custom record with audit trail), and every change has a ticket, approver and effective date.

## 2. Journal design

### Summarized, not detailed

The journal is summarized by subsidiary, account, department and location: 82 lines for 280 US workers this period. Worker-level detail stays in Workday (and in the payroll register, retained as evidence). Reasons: the ledger needs what the financial statements need; worker-level pay in NetSuite would widen access to sensitive compensation data to everyone with GL access; and summarized journals are faster to post and review. Drill-back is by the journal's external ID to the Workday pay run.

### Structure of one US period

| Line type | Debit | Credit |
|---|---|---|
| Earnings by account × cost center × location | 6100 / 6110 / 6120 | |
| PTO payout | 2150 Accrued PTO | |
| Employer taxes and benefits by cost center (in proportion to earnings) | 6200 / 6300 | |
| Employee taxes, deductions | | 2110–2122 |
| Employer tax and benefit liabilities | | 2111–2113, 2130 |
| Net pay | | 2100 Net Pay Clearing |

Debits ($2,300,424.38 this period) equal register burdened cost, and credits equal the same figure. That tie is one of the app's control totals.

### How liabilities are booked and cleared

| Liability | Booked by payroll journal | Cleared by |
|---|---|---|
| Net pay (2100) | Credit at payroll | Bank statement: ACH debit on check date, matched in NetSuite bank reconciliation |
| Federal and state taxes, FICA (2110–2115) | Credit at payroll | Tax provider / EFTPS debits on deposit dates (semi-weekly depositor) |
| FUTA / SUI (2112–2113) | Credit at payroll | Quarterly deposits |
| 401(k) (2120) | Credit at payroll | Remittance to the recordkeeper within 7 business days |
| Medical (2121) | Credit at payroll | Monthly carrier invoice (employee share netted) |
| Garnishments (2122) | Credit at payroll | Payment to the State Disbursement Unit within the order's deadline |
| Accrued benefits (2130) | Credit at payroll | Benefit invoices (employer share) |

Each liability account should be at or near zero after its clearing event. A monthly liability roll-forward (opening + payroll credits − payments = closing) is part of the close.

### Accrued payroll at month end

Semi-monthly periods end on the 15th and the last day of the month, so a US period never straddles a month: the Oct 16–31 period is all October expense even though it is paid Nov 5. The journal's accounting date is the **period end date**, not the check date, so the expense lands in the month the work was done and the liabilities sit on the balance sheet until paid.

If a journal cannot be posted before the month is closed (for example the Oct 16–31 payroll calculates on Nov 2 and close is Nov 3, or a future biweekly pay group straddles month end):

1. Post an **accrual** on the last day of the month: Dr wage, tax and benefit expense by department / Cr 2190 Accrued Payroll, estimated as the prior period's burdened cost × (working days to accrue ÷ working days in that period), plus known one-offs such as terminations.
2. Set it as an **auto-reversing** journal on the first day of the next month.
3. Post the actual payroll journal when it is ready; the reversal plus the actual leaves exactly the actual in each month (the estimate's error lands in the month the actual posts and is reviewed in flux analysis).

International monthly payrolls are calendar months and are posted with a month-end date from provider results before close; if the provider is late, the same accrual and reversal pattern applies using Workday's expected cost from the app's International page.

## 3. Integration mechanism

### Options

| Option | How it works | Assessment |
|---|---|---|
| Workday Accounting Journal integration | Workday-delivered connector that sends payroll accounting results as journals | The natural choice when the ledger is Workday Financials or a supported connector target. To NetSuite it still needs a transport and transformation layer. |
| **Workato (recommended)** | Recipe triggered when the pay run's accounting completes: pulls the summarized journal from a Workday report (RaaS), maps accounts and segments from a governed lookup table, validates, and creates the journal in NetSuite through SuiteTalk REST, then writes the status back | Validation before posting, idempotent re-runs, built-in retries, alerting, versioned recipes with role-based access: what a SOX auditor wants to see for an IT-dependent interface. |
| File-based EIB / CSV import | Workday EIB report to SFTP, then a NetSuite CSV import | Cheapest, but manual steps, no pre-post validation, and failures are silent. Keep as the documented fallback (the app's CSV export is in exactly this format). |

### Why Workato

- **Validation before posting:** the same checks the app runs (balanced per subsidiary, every account and segment mapped, currency equals subsidiary currency) happen before anything reaches NetSuite. A failed check stops the post and alerts.
- **Idempotency:** each journal carries an external ID (`PR-2026-10-SM1-NC-US`). NetSuite rejects a duplicate external ID, so a re-run can never double-post.
- **Error handling:** connection failures retry with backoff; validation failures post nothing and open a ticket for Payroll and Accounting with the failing lines.
- **Partial posting detection:** each subsidiary's journal is one NetSuite transaction, so a single journal either posts or fails. Across subsidiaries, the recipe writes a status row per journal (pending, posted with NetSuite internal ID, failed) and a daily check compares Workday pay runs completed against journals posted; any pay run without a posted journal by T+1 alerts the Senior Accountant.
- **Re-run and reversal:** a wrong journal is never edited. It is reversed in NetSuite (reversal dated in the same period) and the corrected journal is posted with a new external ID suffix (`-R1`). The recipe exposes "reverse and repost" as a controlled action that requires Accounting approval.
- **Access:** only the integration user can create payroll journals in NetSuite; people cannot key payroll journals manually.

### For now: a manual post run by payroll

Until the Workato recipe is live, posting is a manual step owned by payroll, and the app enforces the same gates:

1. **Only after the pay run is completed.** On General ledger, **Post journals to NetSuite** is enabled only when the pay run is Completed (calculated, approved by a different person, then completed). Before that, only a preview file can be downloaded.
2. **Pre-post validation.** Every journal must balance per subsidiary and every account, department, class, location and subsidiary must map; otherwise the button stays disabled and the failing lines are listed.
3. **Post.** A Payroll Specialist or Payroll Approver posts. The app produces the NetSuite CSV import (one journal per subsidiary, external IDs such as `PR-2026-10-SM1-NC-US`, accounting date = period end) and records who posted and when. In NetSuite: Transactions › Journal Entries › Import (CSV Import Assistant, saved mapping).
4. **No double posting.** A posted pay run shows as posted and cannot be posted again; NetSuite would also reject the duplicate external IDs.
5. **Corrections.** A posted pay run cannot be reopened until the journals are reversed in NetSuite and the reversal is recorded (Payroll Approver). Later changes to the period are paid as retro in the next pay run and post with that run.
6. **Reminder.** Payroll's notifications list completed pay runs that are not yet posted.

## 4. Multi-entity and multi-currency

- **Local currency:** UK, Canada and India provider results post to their own subsidiaries in GBP, CAD and INR, from provider actuals (not Workday's expected figures). Lines whose currency differs from the subsidiary base currency are rejected by validation.
- **Consolidation:** NetSuite consolidates to USD with its consolidated exchange rate tables (average rate for income statement accounts, period-end rate for balance sheet accounts). The app shows a USD view using the brief's fixed reporting rates so totals can be checked by hand; that view is for reporting, not posting.
- **Intercompany recharges:** when a worker's cost center belongs to a different entity than their employer (E0008 is employed by NeoCloud Canada but works in US Engineering cost center CC3100):
  - Employing entity (NC-CA, CAD): Dr 1300 Intercompany Receivable – NC-US / Cr 6900 Intercompany Recharge (contra expense, same department) for the full employer cost, C$21,093.75.
  - Owning entity (NC-US, USD): Dr 6400 Intercompany Service Cost (CC3100) / Cr 2300 Intercompany Payable – NC-CA, $15,398.44.
  - In NetSuite these are paired advanced intercompany journal entries so they eliminate on consolidation; the receivable and payable are settled monthly. Markup (cost plus) is set by Tax under the intercompany agreement.

## 5. Reconciliation, controls and a clean close

### Three-way tie-out every cycle

| Step | Report | Compared to | Owner |
|---|---|---|---|
| 1 | Workday payroll register (Payroll Results by Pay Component) | Workday payroll accounting journal by account | Payroll Manager |
| 2 | Workday payroll accounting journal | NetSuite journal posted (saved search on external ID, totals by account, department, subsidiary) | Senior Accountant |
| 3 | Net pay in 2100 | Bank ACH debit | Treasury / Senior Accountant |
| 4 | Tax liabilities 2110–2115 | Tax provider deposit reports | Payroll Manager |
| 5 | International provider results | Provider GL summary and NetSuite subsidiary journal | International Payroll Lead |
| 6 | Payroll liability accounts | Liability roll-forward at month end | Senior Accountant, reviewed by Controller |

### What a clean payroll close looks like

- Every pay run in the month has exactly one posted journal per subsidiary, with no failed or pending integrations.
- Register, Workday journal and NetSuite journal agree to the cent by account.
- Net pay clearing (2100) is zero after the last check date of the month, or equal to checks not yet cleared.
- Tax, benefit and garnishment liabilities agree to the next scheduled remittance; nothing is older than its due date.
- Accruals are posted for anything not yet booked and set to auto-reverse.
- Payroll expense by department moves in line with headcount; flux over 10% has a written explanation (new hires, terminations, payouts, retro).
- Intercompany receivables equal intercompany payables across entities after translation.
- The Controller signs the payroll close checklist; evidence (register, journal, tie-outs, roll-forward) is filed for the auditors.
