// The pay period being processed. In Workday this is the "US Semi-Monthly"
// pay group's period schedule; here it is configuration so the engine never
// hard-codes a date.

import type { ISODate } from "../util/dates.ts";

export interface PayPeriod {
  id: string;
  payGroup: string;
  start: ISODate;
  end: ISODate;
  checkDate: ISODate;
  periodsPerYear: number;
  /** Day the FLSA/CA workweek starts. 0 = Sunday (fixed, recurring 168-hour period). */
  workweekStartDow: number;
  /** Date after which changes did not reach the legacy system for this run. */
  legacyInputCutoff: ISODate;
}

export const US_PERIOD: PayPeriod = {
  id: "2026-10-SM1",
  payGroup: "US Semi-Monthly",
  start: "2026-10-01",
  end: "2026-10-15",
  checkDate: "2026-10-20",
  periodsPerYear: 24,
  workweekStartDow: 0,
  legacyInputCutoff: "2026-10-12",
};

export interface MonthlyPeriod {
  id: string;
  month: string;
  start: ISODate;
  end: ISODate;
  /** Last day changes are included in the outbound file to the provider. */
  changeCutoff: ISODate;
  payDate: ISODate;
}

export const INTL_PERIOD: MonthlyPeriod = {
  id: "2026-10-M",
  month: "2026-10",
  start: "2026-10-01",
  end: "2026-10-31",
  changeCutoff: "2026-10-20",
  payDate: "2026-10-28",
};

/** Working-day proration: Mon–Fri. No company holidays fall in Oct 1–15, 2026. */
export const COMPANY_HOLIDAYS: ISODate[] = [];

/** Standard hours used to derive an hourly equivalent for salaried workers (payouts, accruals). */
export const STANDARD_ANNUAL_HOURS = 2080;
export const STANDARD_DAILY_HOURS = 8;
