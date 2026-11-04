// Date helpers. The vault stores plain YYYY-MM-DD dates, so everything works in whole local days.

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && ISO.test(s.trim());
}

/** Accepts strings, Date objects (YAML can parse dates) or nothing. */
export function normalizeDate(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return toIsoDate(v.getTime(), true);
  if (typeof v === "string" && ISO.test(v.trim())) return v.trim();
  return null;
}

/** Local calendar date of a timestamp. `utc` is for YAML-parsed dates, which are UTC midnight. */
export function toIsoDate(ms: number, utc = false): string {
  const d = new Date(ms);
  const y = utc ? d.getUTCFullYear() : d.getFullYear();
  const m = (utc ? d.getUTCMonth() : d.getMonth()) + 1;
  const day = utc ? d.getUTCDate() : d.getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dayNumber(iso: string): number {
  const [, y, m, d] = ISO.exec(iso) as RegExpExecArray;
  return Math.round(Date.UTC(+y, +m - 1, +d) / 86_400_000);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

export function addDays(iso: string, n: number): string {
  return toIsoDate((dayNumber(iso) + n) * 86_400_000, true);
}

export function laterDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return daysBetween(a, b) > 0 ? b : a;
}

/** "today", "yesterday", "3 days ago", "in 2 days". */
export function relativeDay(iso: string | null, today: string): string {
  if (!iso) return "never";
  const n = daysBetween(iso, today);
  if (n === 0) return "today";
  if (n === 1) return "yesterday";
  if (n > 1) return `${n} days ago`;
  if (n === -1) return "tomorrow";
  return `in ${-n} days`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Tue Nov 3, 2026" */
export function longDate(iso: string): string {
  const [, y, m, d] = ISO.exec(iso) as RegExpExecArray;
  const wd = new Date(Date.UTC(+y, +m - 1, +d)).getUTCDay();
  return `${WEEKDAYS[wd]} ${MONTHS[+m - 1]} ${+d}, ${y}`;
}
