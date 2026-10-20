// Time rules by work location, and shift definitions. Rules are data: the time
// engine reads these fields and has no state-specific branches of its own.

import type { ISODate } from "../util/dates.ts";

export interface StateTimeRule {
  code: string;
  label: string;
  /** Daily overtime (1.5x) after this many minutes in a workday, or null for none. */
  dailyOtAfter: number | null;
  /** Daily double time (2x) after this many minutes in a workday, or null for none. */
  dailyDtAfter: number | null;
  /** Seventh consecutive day worked in the workweek: first 8 hours 1.5x, beyond 8 hours 2x. */
  seventhDay: boolean;
  /** Meal period rules with a premium (1 hour at the regular rate) when missed, late or short. */
  mealPremium: boolean;
  source: string;
}

/** Weekly overtime after 40 hours (FLSA) applies everywhere; these add state rules on top. */
export const STATE_TIME_RULES: Record<string, StateTimeRule> = {
  CA: { code: "CA", label: "California", dailyOtAfter: 480, dailyDtAfter: 720, seventhDay: true, mealPremium: true, source: "Labor Code 510 (daily OT, 7th day) and 512 / 226.7 (meal periods)" },
  AK: { code: "AK", label: "Alaska", dailyOtAfter: 480, dailyDtAfter: null, seventhDay: false, mealPremium: false, source: "AS 23.10.060: over 8 hours a day" },
  NV: { code: "NV", label: "Nevada", dailyOtAfter: 480, dailyDtAfter: null, seventhDay: false, mealPremium: false, source: "NRS 608.018: over 8 hours in 24 (pay under 1.5x minimum wage)" },
  CO: { code: "CO", label: "Colorado", dailyOtAfter: 720, dailyDtAfter: null, seventhDay: false, mealPremium: false, source: "COMPS Order: over 12 hours a workday" },
  FLSA: { code: "FLSA", label: "Federal (FLSA)", dailyOtAfter: null, dailyDtAfter: null, seventhDay: false, mealPremium: false, source: "FLSA: over 40 hours in the workweek only" },
};

export const ruleForState = (state: string): StateTimeRule => STATE_TIME_RULES[state] ?? STATE_TIME_RULES.FLSA;

export interface ShiftDef {
  name: "Day" | "Night";
  /** Window the shift normally falls in (HH:MM). */
  window: [string, string];
  /** Workday boundary: time before this belongs to the previous workday. 00:00 = midnight. */
  dayBreaker: string;
  /** Scheduled hours used to fill in a timesheet. */
  schedule: { timeIn: string; mealStart: string; mealEnd: string; timeOut: string };
}

export const SHIFTS: Record<"Day" | "Night", ShiftDef> = {
  Day: { name: "Day", window: ["08:00", "18:00"], dayBreaker: "00:00", schedule: { timeIn: "08:00", mealStart: "12:00", mealEnd: "12:30", timeOut: "16:30" } },
  Night: { name: "Night", window: ["18:00", "08:00"], dayBreaker: "12:00", schedule: { timeIn: "22:00", mealStart: "02:00", mealEnd: "02:30", timeOut: "06:30" } },
};

/** Night shift differential: $3.00 an hour for minutes worked between 22:00 and 06:00. */
export const NIGHT_WINDOW: [string, string] = ["22:00", "06:00"];

/**
 * A shift that crosses from the last day of a pay period into the next one is paid
 * in the next period. Applies from go-live; the Oct 1–15 parallel run reproduces the
 * legacy system, which paid a shift in the period it started.
 */
export const CROSSING_SHIFTS_PAID_NEXT_FROM: ISODate = "2026-10-16";
