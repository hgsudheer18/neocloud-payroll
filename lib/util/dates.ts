// Dates are ISO strings (YYYY-MM-DD) everywhere. All arithmetic is done in UTC
// so there are no daylight-saving surprises; payroll dates are calendar dates,
// not instants.

export type ISODate = string;

const DAY = 86_400_000;

export function parse(d: ISODate): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}

export function format(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(d: ISODate, n: number): ISODate {
  return format(parse(d) + n * DAY);
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(d: ISODate): number {
  return new Date(parse(d)).getUTCDay();
}

export function isWeekday(d: ISODate): boolean {
  const w = dayOfWeek(d);
  return w >= 1 && w <= 5;
}

export function eachDay(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let t = parse(start); t <= parse(end); t += DAY) out.push(format(t));
  return out;
}

export function daysInclusive(start: ISODate, end: ISODate): number {
  return Math.round((parse(end) - parse(start)) / DAY) + 1;
}

/** Start (Sunday) of the Sun–Sat workweek containing d. */
export function workweekStart(d: ISODate): ISODate {
  return addDays(d, -dayOfWeek(d));
}

export function between(d: ISODate, start: ISODate, end: ISODate): boolean {
  return d >= start && d <= end;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}
export function minDate(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function pretty(d: ISODate): string {
  const t = new Date(parse(d));
  return `${DOW[t.getUTCDay()]} ${MON[t.getUTCMonth()]} ${t.getUTCDate()}`;
}

/** "HH:MM" → minutes after midnight */
export function hhmm(t: string): number {
  const [h, m] = t.trim().split(":").map(Number);
  return h * 60 + m;
}

export function minutesToHHMM(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Minutes → hours with 2 decimals, as a number (for display and hour × rate). */
export function hrs(min: number): number {
  return Math.round((min / 60) * 100) / 100;
}
