import "dotenv/config";
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a date string into a Date object.
 * Handles ISO strings, "MM/DD/YYYY, HH:MM AM", "Sep 1, 2026, 09:05 PM UTC",
 * and bare dates like "Sep 09, 2026" or "2026-09-09".
 *
 * Bare dates are interpreted as UTC midnight so timezone differences don't
 * shift the filter window.
 */
function parseDate(input: string): Date | null {
  if (!input) return null;
  const trimmed = input.trim();

  // If it's a bare date (no time component), treat it as UTC midnight.
  const isBareDate =
    /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ||
    /^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}$/.test(trimmed) ||
    /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed);

  if (isBareDate) {
    const tmp = new Date(trimmed);
    if (!isNaN(tmp.getTime())) {
      return new Date(
        Date.UTC(tmp.getFullYear(), tmp.getMonth(), tmp.getDate()),
      );
    }
  }

  // Full timestamps (e.g. "Sep 8, 2026, 4:04 PM UTC") — native parse
  const native = new Date(trimmed);
  if (!isNaN(native.getTime())) return native;

  // Fallback: strip commas
  const fallback = new Date(trimmed.replace(/,/g, ""));
  if (!isNaN(fallback.getTime())) return fallback;

  return null;
}

/**
 * Returns true if `dateStr` falls within [from, to].
 * Null bounds mean "no restriction" on that side.
 */
function isWithinRange(
  dateStr: string,
  from: Date | null,
  to: Date | null,
): boolean {
  const d = parseDate(dateStr);
  if (!d) return false; // unparseable → exclude
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  const browser = await chromium.launch({ headless: false });

  const email = process.env.QC_EMAIL;
  const password = process.env.QC_PASSWORD;
  const link = process.env.QC_URL;

  if (!email || !password || !link) {
    throw new Error(
      "Missing environment variables (QC_EMAIL, QC_PASSWORD, or QC_URL)",
    );
  }

  // ---- Date range from env (optional) ----
  const fromEnv = process.env.QC_DATE_FROM?.trim();
  const toEnv = process.env.QC_DATE_TO?.trim();
  const dateFrom = fromEnv ? parseDate(fromEnv) : null;
  const dateToRaw = toEnv ? parseDate(toEnv) : null;

  // Make TO inclusive of the whole day
  const dateTo = dateToRaw
    ? new Date(dateToRaw.getTime() + 24 * 60 * 60 * 1000 - 1)
    : null;

  if (fromEnv && !dateFrom) {
    console.warn(`⚠️ Could not parse QC_DATE_FROM="${fromEnv}" – ignoring.`);
  }
  if (toEnv && !dateToRaw) {
    console.warn(`⚠️ Could not parse QC_DATE_TO="${toEnv}" – ignoring.`);
  }
  if (dateFrom || dateTo) {
    console.log(
      `📅 Filtering by date range: ${dateFrom?.toISOString() ?? "any"} → ${dateTo?.toISOString() ?? "any"}`,
    );
  }

  // 1. Handle browser HTTP basic authentication context
  const context = await browser.newContext({
    httpCredentials: { username: email, password: password },
  });

  const page = await context.newPage();
  await page.goto(link);

  // 2. Wait for the table data rows to load
  await page.waitForSelector("table tr");

  // 3. Scrape the row data
  const scrapedRows = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll("table"));

    const targetTable = tables.find((table) => {
      const headers = Array.from(table.querySelectorAll("thead th"));
      return headers.some((th) => th.textContent?.trim() === "Duration");
    });

    if (!targetTable) return [];

    const rows = Array.from(targetTable.querySelectorAll("tr"));

    return rows
      .map((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length < 6) return null;

        const sessionAnchor = cells[0].querySelector("a");
        const rateAnchor = cells[5].querySelector("a");

        return {
          sessionId: cells[0].textContent?.trim() || "",
          sessionUrl: sessionAnchor ? sessionAnchor.getAttribute("href") : "",
          email: cells[1].textContent?.trim() || "",
          taskType: cells[2].textContent?.trim() || "",
          duration: cells[3].textContent?.trim() || "",
          dateUtc: cells[4].textContent?.trim() || "",
          rateUrl: rateAnchor ? rateAnchor.getAttribute("href") : "",
        };
      })
      .filter((data) => data !== null);
  });

  // 4. Apply date range filter
  const filteredRows = scrapedRows.filter((row) =>
    isWithinRange(row!.dateUtc, dateFrom, dateTo),
  );

  console.log(
    `🔎 Scraped ${scrapedRows.length} rows → ${filteredRows.length} after date filter`,
  );

  // 5. Write output — always overwrite so the file reflects the current filter
  const outputDir = path.join(process.cwd(), "platform-data");
  const outputPath = path.join(outputDir, "QC - input.json");

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(filteredRows, null, 2), "utf8");

  if (filteredRows.length === 0) {
    console.log("⚠️ No rows matched the current date filter. File cleared.");
  } else {
    console.log(`✅ Saved ${filteredRows.length} items to: ${outputPath}`);
  }

  await browser.close();
})();
