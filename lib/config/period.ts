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

/** Second semi-monthly period: the first period after the parallel run. No legacy register. */
export const US_PERIOD_2: PayPeriod = {
  id: "2026-10-SM2",
  payGroup: "US Semi-Monthly",
  start: "2026-10-16",
  end: "2026-10-31",
  checkDate: "2026-11-05",
  periodsPerYear: 24,
  workweekStartDow: 0,
  legacyInputCutoff: "2026-10-12",
};

/**
 * Hourly (non-exempt) workers move to a biweekly pay group at go-live: every
 * period is exactly two Sunday–Saturday workweeks, so overtime is never split
 * across periods. The first run is a transition period: a 2-day stub (Oct 16–17)
 * completing the Oct 11–17 workweek, plus the two full workweeks Oct 18–31.
 */
export const US_BW_TRANSITION: PayPeriod = {
  id: "2026-BW-T1",
  payGroup: "US Biweekly",
  start: "2026-10-16",
  end: "2026-10-31",
  checkDate: "2026-11-06",
  periodsPerYear: 26,
  workweekStartDow: 0,
  legacyInputCutoff: "2026-10-12",
};

export const US_BW_2: PayPeriod = {
  id: "2026-BW-02",
  payGroup: "US Biweekly",
  start: "2026-11-01",
  end: "2026-11-14",
  checkDate: "2026-11-20",
  periodsPerYear: 26,
  workweekStartDow: 0,
  legacyInputCutoff: "2026-10-12",
};

export const US_PERIODS: PayPeriod[] = [US_PERIOD, US_PERIOD_2, US_BW_TRANSITION, US_BW_2];

/** Which completed period each period builds on (YTD, balances, retro). */
export const PRIOR_PERIOD: Record<string, string | undefined> = {
  [US_PERIOD.id]: undefined,
  [US_PERIOD_2.id]: US_PERIOD.id,
  [US_BW_TRANSITION.id]: US_PERIOD.id,
  [US_BW_2.id]: US_BW_TRANSITION.id,
};

export const PERIOD_LABEL: Record<string, string> = {
  [US_PERIOD.id]: "Oct 1–15 semi-monthly (parallel run, all US)",
  [US_PERIOD_2.id]: "Oct 16–31 semi-monthly (salaried)",
  [US_BW_TRANSITION.id]: "Oct 16–31 biweekly transition (hourly)",
  [US_BW_2.id]: "Nov 1–14 biweekly (hourly)",
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
