export function formatToUTC8(isoStr: string): string {
  const date = new Date(isoStr);
  return date.toLocaleString("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export function toDisplayString(timestampUTC8: string): string {
  const date = new Date(timestampUTC8);
  const now = new Date();
  const diffHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

  if (diffHours < 24) {
    const hours = Math.floor(diffHours);
    return `${hours}h ago`;
  } else if (diffHours < 48) {
    return "1d ago";
  } else {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const year = date.getFullYear();
    let hours = date.getHours();
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${month}-${day}-${year}, ${hours}:${minutes} ${ampm}`;
  }
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
 * Parses formatToUTC8's output, "MM/DD/YYYY, HH:MM AM/PM", back into a Date.
 * Uses UTC for construction so comparisons are timezone-independent and
 * consistent — we only need ordering, not an actual wall-clock instant.
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
