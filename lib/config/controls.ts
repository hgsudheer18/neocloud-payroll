// Payroll key control matrix (SOX ITGC + business process controls).
// Rendered in the app and in docs/05-controls-cutover.md.

export interface Control {
  id: string;
  area: "Input" | "Calculation" | "Approval" | "Funding" | "Output" | "ITGC";
  objective: string;
  activity: string;
  owner: string;
  frequency: string;
  type: "Preventive" | "Detective";
  automation: "Automated" | "IT-dependent manual" | "Manual";
  evidence: string;
  sod: string;
  inApp: string;
}

export const CONTROLS: Control[] = [
  {
    id: "PR-01", area: "Input", objective: "Only authorized, approved worker and compensation changes reach payroll.",
    activity: "Hire, Change Job, Request Compensation Change and Terminate business processes require manager plus HR Partner approval; comp changes above guideline also require Total Rewards.",
    owner: "HR Operations Manager", frequency: "Each transaction", type: "Preventive", automation: "Automated",
    evidence: "Business process history and approval chain (Process History report), BP definition audit.", sod: "Initiator cannot approve own BP; HR Partner security group has no Payroll Administrator access.", inApp: "Worker events carry entered-on dates; late entries are flagged as timing items.",
  },
  {
    id: "PR-02", area: "Input", objective: "Time is complete, approved and valid before payroll calculates.",
    activity: "Time entry validations (critical: overlapping blocks, missing out-punch, > 16 hrs; warning: meal not taken by 5th hour). Manager approval by time-approval cutoff; unapproved time report reviewed by Payroll.",
    owner: "Time Tracking Lead", frequency: "Each period", type: "Preventive", automation: "Automated",
    evidence: "Time Block Audit, Unapproved Time report signed off before Pay Calculation.", sod: "Workers cannot approve own time; managers cannot edit approved time without a correction BP.", inApp: "Duplicate punch, meal and seventh-day exceptions on the Time page.",
  },
  {
    id: "PR-03", area: "Input", objective: "Payroll inputs (deductions, garnishments, one-time payments, tax elections) are complete and accurate.",
    activity: "Payroll Input and One-Time Payment EIB loads reconciled to source counts and totals; garnishment orders entered by one analyst and verified by a second.",
    owner: "Payroll Manager", frequency: "Each period", type: "Detective", automation: "IT-dependent manual",
    evidence: "EIB load results, Payroll Input audit report with reviewer sign-off.", sod: "Payroll Specialist enters; Payroll Manager reviews.", inApp: "Data files page validates every CSV before calculation.",
  },
  {
    id: "PR-04", area: "Calculation", objective: "Pay results are complete and reasonable before approval.",
    activity: "Pre-payroll audit: trailing-average variance (> 150% or < 60%), negative/zero net, multi-state, wage-base crossing, terminations requiring final pay, unexplained headcount deltas. Every item is cleared or explained.",
    owner: "Payroll Manager", frequency: "Each period", type: "Detective", automation: "IT-dependent manual",
    evidence: "Audit Results report, period variance report with comments, sign-off in the Complete Pay Calculation step.", sod: "Payroll Specialist works items; Payroll Manager signs off.", inApp: "Pre-payroll audit findings on this page.",
  },
  {
    id: "PR-05", area: "Calculation", objective: "Headcount paid agrees to active workforce.",
    activity: "Reconcile active workers in the pay group to workers with results, explaining every hire, termination, leave and zero-pay.",
    owner: "Payroll Manager", frequency: "Each period", type: "Detective", automation: "IT-dependent manual",
    evidence: "Headcount reconciliation report retained with the period close pack.", sod: "Prepared by Payroll Specialist, reviewed by Payroll Manager.", inApp: "Reconciliation > Headcount.",
  },
  {
    id: "PR-06", area: "Approval", objective: "Payroll is approved by someone independent of its preparation.",
    activity: "Complete Pay Calculation and Settlement require Payroll Manager approval; Controller approves the payroll register summary and the cash requirement before funding.",
    owner: "Controller", frequency: "Each period", type: "Preventive", automation: "Automated",
    evidence: "Pay Run BP approval history; signed register summary.", sod: "Payroll Administrator (calculate) and Payroll Approver (complete) are separate security groups; no user holds both.", inApp: "Control totals panel on the overview is the register summary the Controller signs.",
  },
  {
    id: "PR-07", area: "Funding", objective: "Cash funded equals approved net pay and tax liabilities.",
    activity: "Treasury compares the settlement (bank file) total and tax provider funding to the approved register; bank file is transmitted only via the Workday settlement integration with dual approval in the bank portal.",
    owner: "Treasury Manager", frequency: "Each period", type: "Preventive", automation: "IT-dependent manual",
    evidence: "Settlement Run report, bank confirmation, tax funding confirmation tied to register.", sod: "Payroll cannot release payments in the bank portal; Treasury cannot change payroll.", inApp: "Net pay payable (2100) equals register net pay.",
  },
  {
    id: "PR-08", area: "Output", objective: "Payroll is completely and accurately recorded in the general ledger.",
    activity: "Payroll journal is validated against the account and segment mapping, balanced per subsidiary, and its control totals tie to the register before import; after posting, NetSuite saved search totals by account are compared to the Workday journal.",
    owner: "Senior Accountant (GL)", frequency: "Each period", type: "Detective", automation: "IT-dependent manual",
    evidence: "Journal validation output, NetSuite import log, tie-out workpaper.", sod: "Payroll prepares; Accounting posts and reviews.", inApp: "General ledger > validation and export.",
  },
  {
    id: "PR-09", area: "Output", objective: "International provider results agree to Workday and to cash.",
    activity: "Provider gross, employer cost and net reconciled to Workday expected results each month; differences categorized and approved before funding the provider.",
    owner: "International Payroll Lead", frequency: "Monthly", type: "Detective", automation: "IT-dependent manual",
    evidence: "Provider reconciliation workpaper with variance log.", sod: "Prepared by International Payroll, approved by Payroll Manager.", inApp: "International > provider reconciliation.",
  },
  {
    id: "PR-10", area: "ITGC", objective: "Changes to pay components, tax configuration, calculations and integrations are authorized and tested.",
    activity: "Configuration changes made in the sandbox, tested with a documented test case, approved by Payroll Manager and Controller, then migrated; tenant configuration audit reviewed monthly.",
    owner: "Head of People Technology", frequency: "Each change; monthly review", type: "Preventive", automation: "IT-dependent manual",
    evidence: "Change ticket, test evidence, Workday configuration audit trail (Business Process / Calculation / Pay Component audit).", sod: "Configurers cannot run payroll in production.", inApp: "Tax and plan rules are versioned config files; changes go through pull requests.",
  },
  {
    id: "PR-11", area: "ITGC", objective: "Access to payroll is appropriate.",
    activity: "Quarterly user access review of payroll, HR and integration security groups; terminated users removed within one business day.",
    owner: "Head of People Technology", frequency: "Quarterly", type: "Detective", automation: "IT-dependent manual",
    evidence: "Security group membership report signed by group owners.", sod: "Reviewer is not a member of the reviewed group.", inApp: "SoD matrix on this page.",
  },
];

export const SECURITY_GROUPS: { group: string; can: string; cannot: string }[] = [
  { group: "HR Partner", can: "Initiate and approve hires, job and comp changes, terminations", cannot: "Run or approve payroll, change pay components" },
  { group: "Time Administrator", can: "Correct and approve time on behalf of managers", cannot: "Calculate payroll, change rates" },
  { group: "Payroll Specialist", can: "Enter payroll inputs, garnishments, one-time payments; run pay calculation", cannot: "Complete pay calculation, change compensation, change bank accounts" },
  { group: "Payroll Approver (Manager)", can: "Review audits, complete pay calculation and settlement", cannot: "Enter inputs they approve, change compensation" },
  { group: "Payroll Configuration", can: "Configure pay components, calculations, tax setup in sandbox", cannot: "Run payroll in production" },
  { group: "Accounting", can: "Review and post the payroll journal in NetSuite", cannot: "Change payroll results" },
  { group: "Treasury", can: "Release settlement and provider funding", cannot: "Edit payroll or banking details in Workday" },
];
