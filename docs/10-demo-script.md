# Demo script (about 20 minutes)

A hands-on walkthrough for the CFO, Controller and Head of People Technology. Start from a clean state: **Data and demo → Reset demo data**. The role switcher ("Signed in as") and the pay period selector are at the top of the sidebar.

## Part 1. The parallel run ties (4 min)

**Signed in as:** anyone. **Pay period:** Oct 1–15 semi-monthly (parallel run, all US).

1. **Period overview.** The first thing on screen is the control-total ledger: "Before anyone looks at a number, the question is whether the period ties." Walk through the eight ties.
2. **Payroll register → E0148.** Termination: 7 of 11 days of salary, plus the vacation payout of 33.15 hours (31.00 opening + 2.15 final accrual) at $165,000 ÷ 2,080 = $2,629.69. The red banner says California final pay is due on the last day, so it goes on an on-demand payment.
3. **Time calculation → E0021.** Oct 1 late meal (the brief didn't flag it), Oct 2 double time, Oct 3 missed meal plus 8 hours of weekly overtime because Sep 28–Oct 2 already reached 40.
4. **Reconciliation → E0203.** Every variance is proven by recalculating with the cause. Then **E0003**: "Here legacy is right. The brief's $168,600 is the 2024 Social Security wage base; 2026 is $184,500. In a real parallel I'd fix Workday."

## Part 2. Run the first payroll (3 min)

5. **Signed in as Diego Okafor, Payroll Specialist → Pay runs → Calculate pay.** The figures show 280 workers, all ties, and 1 critical audit item.
6. Try to approve: Sam can't. "Segregation of duties: the person who calculates can't approve."
7. **Signed in as Aisha Nguyen, Payroll Approver → Pay runs.** Enter the resolution for the critical item (*"E0148 final pay issued as on-demand payment on Oct 9"*), then **Approve pay run** and **Complete pay run**. The period is now locked.

## Part 3. Hire to terminate (5 min)

8. **Signed in as Chloe Novak, HR Partner → Organization setup.** Show supervisory orgs and cost centers, locations, companies, job profiles, and **Pay groups and calendars**: salaried semi-monthly, hourly biweekly. Optionally create a job profile or location.
9. **Workers → Hire a worker.** Name *Alex Morgan*, hire date today, job profile *Data Center Technician* (the form shows Non-Exempt, Hourly), org *Data Center Ops (E0005)*, location *San Jose*, rate **$15**: the form blocks it ("Below the 2026 California minimum wage"). Change to **$40** and submit. It goes to the inbox.
10. **Signed in as Ethan Fischer, Manager → Inbox → Approve.** Alex is now a worker, in the US Biweekly pay group.
11. **Signed in as Jordan (HR) → Workers → E0057 → Change pay:** effective **Oct 12** (inside the completed period), new salary **205,000**. Submit; **Ethan approves** it.
12. Optional: **Workers → E0088 → Terminate** or **Start leave** to show the other business processes.

## Part 4. Time and absence (4 min)

13. **Signed in as Emma Kim, Employee → Enter time.** Add a time block for a day in Oct 16–31 with the meal at **11:30**: the app warns that a CA meal premium will be paid. Try to enter the same block again: it's blocked as a duplicate.
14. **Time off:** request a day of US Hourly Vacation. The available balance is shown and checked.
15. **Signed in as Sam (Payroll Specialist) → Enter time → Dates: Oct 16–31 → Auto-fill scheduled shifts for all technicians.**
16. **Signed in as Ethan (Manager) → Inbox → Approve all.**

## Part 5. Run the next cycle (3 min)

17. **Pay period: Oct 16–31 semi-monthly (salaried). Signed in as Sam → Pay runs → Calculate.** The blue banner shows **E0057 retro $151.51**: the raise backdated into the completed period, paid now. Open **Payroll register → E0057** to show the RETRO line and its explanation.
18. Point out that year-to-date carried forward: E0012 crossed the Social Security wage base in Oct 1–15, so no Social Security now.
19. **Pay period: Oct 16–31 biweekly transition (hourly). Pay runs → Calculate.** 26 technicians, including Alex. Explain the 2-day stub that completes the Oct 11–17 workweek, then clean two-week periods.
20. **Signed in as Priya → Approve → Complete.** Then **General ledger**: the biweekly journal balances and is ready for NetSuite.

## Part 6. Close (1 min)

21. **Controls and audit:** control matrix and security groups; **Inbox → Business process log:** every change, who started it, who approved it, when.
22. **Data and demo → Download my demo data:** "This is how I'd hand you my scenario."

## Likely questions

| Question | Short answer |
|---|---|
| Why biweekly for hourly? | Overtime is per 7-day workweek; a biweekly period is exactly two workweeks, so overtime is never split across periods. Salaried stay semi-monthly. |
| What happens when you change a period that's already paid? | The paid period stays exactly as completed. The next run recalculates it and pays the difference as retro, like Workday. |
| How do you know a reconciliation explanation is right? | It's re-performed: recalculating with that cause reproduces the legacy number to the cent. |
| Where is the data stored? | In the browser for this demo, so every visitor has a private sandbox. In production Workday is the database; the business-process log maps directly to a table behind an API. |
| What about 5,000 employees? | The engine is pure functions with no UI dependency; it moves to a server or background job unchanged, with the same tests. |
| Can someone approve their own change? | No. Initiator and approver must differ for every business process and for the pay run. |
| How did you use AI? | It wrote most of the code; I specified the rules and edge cases, checked calculations against hand-worked examples, and the README lists where it was wrong. |
