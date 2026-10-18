// Money is always an integer number of minor units (cents, pence, paise).
// Floating point is only used transiently inside a single multiplication,
// and the result is rounded half-up exactly once, at the pay-line level.

export type Cents = number;

/** Round a (possibly fractional) amount of minor units half-up, away from zero. */
export function roundCents(minor: number): Cents {
  const sign = minor < 0 ? -1 : 1;
  // 1e-7 guards against binary artefacts such as 0.5 being stored as 0.49999999
  return sign * Math.floor(Math.abs(minor) + 0.5 + 1e-7);
}

/** Convert a decimal major-unit amount (e.g. 285000.00) to cents. */
export function toCents(major: number): Cents {
  return roundCents(major * 100);
}

/** hours × rate → cents, rounded once. */
export function hoursTimesRate(hours: number, ratePerHour: number): Cents {
  return roundCents(hours * ratePerHour * 100);
}

/** amount × percentage (e.g. 0.062) → cents, rounded once. */
export function pct(baseCents: Cents, rate: number): Cents {
  return roundCents(baseCents * rate);
}

export function sum(values: Cents[]): Cents {
  let t = 0;
  for (const v of values) t += v;
  return t;
}

const symbols: Record<string, string> = { USD: "$", GBP: "£", CAD: "C$", INR: "₹" };

export function fmt(cents: Cents, currency = "USD"): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const major = Math.floor(abs / 100);
  const minor = String(abs % 100).padStart(2, "0");
  const grouped =
    currency === "INR" ? groupIndian(major) : major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${symbols[currency] ?? currency + " "}${grouped}.${minor}`;
}

function groupIndian(n: number): string {
  const s = n.toString();
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

/** Plain number string for CSV export, e.g. 123456 → "1234.56" */
export function toDecimalString(cents: Cents): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Allocate a total across weights so the parts always sum exactly to the total
 * (largest-remainder method). Used to spread employer taxes and pre-tax
 * deductions across cost centres / states without losing a cent.
 */
export function allocate(total: Cents, weights: number[]): Cents[] {
  const w = weights.reduce((a, b) => a + b, 0);
  if (w === 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map((x) => (total * x) / w);
  const floored = raw.map((x) => (total >= 0 ? Math.floor(x) : Math.ceil(x)));
  let remainder = total - floored.reduce((a, b) => a + b, 0);
  const order = raw
    .map((x, i) => ({ i, frac: Math.abs(x - floored[i]) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const step = remainder >= 0 ? 1 : -1;
  for (let k = 0; remainder !== 0; k = (k + 1) % order.length) {
    floored[order[k].i] += step;
    remainder -= step;
  }
  return floored;
}
