// International employer-cost approximations (from the brief) and reporting FX.
// In production these are NOT calculated by NeoCloud: the in-country provider
// returns them. We re-perform them to reconcile what the provider sends back.

import type { CountryCode } from "../data/types.ts";

export interface CountryCostRule {
  country: CountryCode;
  currency: string;
  label: string;
  provider: string;
  integration: string;
  /** Employer statutory cost for one month, in minor units. */
  employerStatutory: (monthlyGrossMinor: number) => number;
  employerStatutoryLabel: string;
  benefitsLoad: number;
  fxToUsd: number;
}

export const COUNTRY_RULES: Record<string, CountryCostRule> = {
  GBR: {
    country: "GBR",
    currency: "GBP",
    label: "United Kingdom",
    provider: "In-country provider (Global Payroll Connect partner)",
    integration: "Workday Global Payroll Connect (Cloud Connect for Third-Party Payroll)",
    employerStatutory: (g) => Math.max(0, g - 75_800) * 0.138,
    employerStatutoryLabel: "Employer NI 13.8% × (gross − £758 secondary threshold)",
    benefitsLoad: 0.05,
    fxToUsd: 1.27,
  },
  CAN: {
    country: "CAN",
    currency: "CAD",
    label: "Canada",
    provider: "In-country provider (Global Payroll Connect partner)",
    integration: "Workday Global Payroll Connect",
    employerStatutory: (g) => g * 0.075,
    employerStatutoryLabel: "CPP + EI employer 7.5% blended × gross",
    benefitsLoad: 0.05,
    fxToUsd: 0.73,
  },
  IND: {
    country: "IND",
    currency: "INR",
    label: "India",
    provider: "In-country provider (custom PECI)",
    integration: "Payroll Effective Change Interface (PECI) + inbound results EIB",
    employerStatutory: (g) => g * 0.5 * 0.12,
    employerStatutoryLabel: "Employer PF 12% × basic (basic = 50% of gross)",
    benefitsLoad: 0.05,
    fxToUsd: 0.012,
  },
};

/** Tolerance for provider employer-cost re-performance (rounding at provider). */
export const PROVIDER_TOLERANCE_MINOR = 100;
