/**
 * Renders an instant in the given IANA time zone as "MM/DD/YYYY, HH:MM AM/PM".
 * Internal helper — don't call from business logic that needs comparison keys.
 */
function formatInTimeZone(isoStr: string, timeZone: string): string {
  const date = new Date(isoStr);
  return date.toLocaleString("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/** Display format for the final results JSON (Manila / UTC+8). */
export function formatToUTC8(isoStr: string): string {
  return formatInTimeZone(isoStr, "Asia/Manila");
}

/** UTC display — matches how the org table renders timestamps. */
export function formatInUTC(isoStr: string): string {
  return formatInTimeZone(isoStr, "UTC");
}

/**
 * Produces the string the org table's timestamp cell renders for the given
 * UTC instant. The table shows a relative string for recent sessions and an
 * absolute UTC timestamp otherwise. Used to build DOM selectors.
 */
export function toDisplayString(isoUtc: string): string {
  const date = new Date(isoUtc);
  const now = new Date();
  const diffHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

  if (diffHours < 24) return `${Math.floor(diffHours)}h ago`;
  if (diffHours < 48) return "1d ago";
  return formatInUTC(isoUtc);
}

export function parseJsonDateUtc(dateUtc: string): string {
  const MONTHS: Record<string, number> = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };
  const m = dateUtc
    .trim()
    .match(
      /^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s*UTC$/i,
    );
  if (!m) {
    const fallback = new Date(dateUtc);
    if (Number.isNaN(fallback.getTime())) {
      throw new Error(`Unparseable date in JSON input: "${dateUtc}"`);
    }
    return fallback.toISOString();
  }
  const [, mon, day, yr, hr, min, ap] = m;
  let h = parseInt(hr, 10) % 12;
  if (ap.toUpperCase() === "PM") h += 12;
  return new Date(Date.UTC(+yr, MONTHS[mon], +day, h, +min)).toISOString();
}

/**
 * Parses the org table's "MM/DD/YYYY, HH:MM AM/PM" cell (rendered in UTC)
 * into a Date representing the same instant.
 */
export function parseDisplayDateToUTC(display: string): Date | null {
  const m = display
    .trim()
    .match(/^(\d{2})\/(\d{2})\/(\d{4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;

  const [, mm, dd, yyyy, hh, min, ap] = m;
  let h = parseInt(hh, 10) % 12;
  if (ap.toUpperCase() === "PM") h += 12;
  return new Date(Date.UTC(+yyyy, +mm - 1, +dd, h, +min));
}
