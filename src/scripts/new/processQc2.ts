import "dotenv/config";
import { chromium, type Browser, type Page } from "playwright";
import fs from "fs";
import path from "path";

import { csvToJson } from "../../utilities/csvToJson";
import {
  loginToMinuteApp,
  extractSessionId,
  getSessionData,
  getAllSessionRows,
  resolveSessionColumnIndexes,
} from "../../utilities/minuteApp";
import {
  formatToUTC8,
  parseDisplayDateToUTC,
  parseJsonDateUtc,
} from "../../utilities/timeUtil";
import {
  QC_INPUT_DIR,
  QC_OUTPUT_DIR,
  SESSIONS_JSON,
  LINKS_CSV,
  QC_INPUT_JSON_DIR,
} from "../../config/paths";
import { Session, SessionRow } from "../../types";

type InputType = "json" | "csv";

function parseArgs(): { inputDir: string | null; type: InputType | null } {
  const args = process.argv.slice(2);

  const pathArgIndex = args.findIndex((a) => a === "--path" || a === "-p");
  const typeArgIndex = args.findIndex((a) => a === "--type" || a === "-t");

  const inputDir =
    pathArgIndex !== -1 && args[pathArgIndex + 1]
      ? path.resolve(args[pathArgIndex + 1])
      : null;

  let type: InputType | null = null;
  if (typeArgIndex !== -1) {
    const raw = (args[typeArgIndex + 1] || "").toLowerCase();
    if (raw === "json" || raw === "csv") type = raw;
    else
      throw new Error(
        `--type must be "json" or "csv" (got "${args[typeArgIndex + 1] ?? ""}")`,
      );
  }
  return { inputDir, type };
}

const ORG_URL = "https://useminute.app/organization/HYEKNs-Crev9R8SvFKI6SQ";

const mapping = {
  Email: "email",
  "Session ID": "sessionId",
  Task: "task",
  Minutes: "minutes",
  "Recorded Timestamp": "recordedTimestamp",
  "Uploaded Timestamp": "uploadedTimestamp",
  System_Rating: "systemRating",
};

interface JsonInputEntry {
  sessionId: string;
  sessionUrl: string;
  email: string;
  taskType: string;
  duration: string;
  dateUtc: string;
  rateUrl?: string;
}

function normalizeMinutes(duration: string | number): string {
  if (typeof duration === "number") return String(duration);
  const numeric = parseFloat(String(duration).replace(/[^\d.]/g, ""));
  if (Number.isNaN(numeric))
    throw new Error(`Invalid minutes value: ${duration}`);
  return String(numeric);
}

function loadJsonInput(jsonFile: string): any[] {
  console.log(
    `Using JSON input (skipping CSV conversion): ${path.basename(jsonFile)}`,
  );
  const raw: JsonInputEntry[] = JSON.parse(fs.readFileSync(jsonFile, "utf8"));

  return raw.map((entry) => ({
    email: entry.email,
    task: entry.taskType,
    minutes: normalizeMinutes(entry.duration),
    recordedTimestamp: parseJsonDateUtc(entry.dateUtc), // UTC ISO
    sessionId: entry.sessionId,
    link: entry.sessionUrl,
    systemRating: "",
  }));
}

async function loadCsvInput(csvFile: string): Promise<any[]> {
  console.log(`Using CSV input: ${path.basename(csvFile)}`);

  const requiredHeaders = Object.keys(mapping).filter(
    (k) => k !== "System_Rating",
  );

  await new Promise<void>((resolve) => {
    csvToJson(csvFile, SESSIONS_JSON, mapping, requiredHeaders, () =>
      resolve(),
    );
  });

  // NOTE: csvToJson must emit recordedTimestamp as a UTC ISO string for the
  // downstream UTC-only code to be correct. If it currently emits a Manila
  // wall-clock string, convert it here (subtract 8h) before returning.
  return JSON.parse(fs.readFileSync(SESSIONS_JSON, "utf8"));
}

async function loadInputData(
  targetPath: string,
  type: InputType | null,
): Promise<any[]> {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Input directory does not exist: ${targetPath}`);
  }

  const files = fs.readdirSync(targetPath);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  const csvFiles = files.filter((f) => f.endsWith(".csv"));

  if (type === "json") {
    if (!jsonFiles.length)
      throw new Error(
        `--type json given, but no .json file found in ${targetPath}`,
      );
    return loadJsonInput(path.join(targetPath, jsonFiles[0]));
  }

  if (type === "csv") {
    if (!csvFiles.length)
      throw new Error(
        `--type csv given, but no .csv file found in ${targetPath}`,
      );
    return await loadCsvInput(path.join(targetPath, csvFiles[0]));
  }

  if (jsonFiles.length > 0)
    return loadJsonInput(path.join(targetPath, jsonFiles[0]));
  if (csvFiles.length > 0)
    return await loadCsvInput(path.join(targetPath, csvFiles[0]));

  throw new Error(`No CSV or JSON file found in data directory: ${targetPath}`);
}

/**
 * Scrolls the "Show more" button until the oldest visible row is older than
 * `cutoff`. The cutoff is a UTC instant; the table renders its cells in UTC,
 * so `parseDisplayDateToUTC(cell)` yields a directly-comparable Date.
 *
 * `recordedColumnIndex` is the 0-based index of the "Recorded timestamp (UTC)"
 * column, resolved from the live <thead> via `resolveSessionColumnIndexes`.
 */
async function clickShowMoreUntilStable(
  page: Page,
  recordedColumnIndex: number,
  cutoff: Date | null = null,
  selector = 'button:has-text("Show more")',
): Promise<void> {
  // CSS nth-child is 1-based; our column index is 0-based.
  const recordedCellSelector = `td:nth-child(${recordedColumnIndex + 1})`;

  console.log(
    `Scrolling until ${cutoff?.toISOString() ?? "(no cutoff)"} is reached ` +
      `(recorded column: ${recordedColumnIndex})`,
  );

  let previousRowCount = 0;
  const showMoreButton = page.locator(selector);

  while (true) {
    const currentRowCount = await page.locator("table tbody tr").count();
    if (currentRowCount === previousRowCount) break;

    await showMoreButton.scrollIntoViewIfNeeded();
    if (await showMoreButton.isVisible()) {
      await showMoreButton.click();
      await page.waitForTimeout(800);
    } else {
      break;
    }

    if (cutoff) {
      const lastRow = page.locator("table tbody tr:last-child");
      const recordedText =
        (await lastRow.locator(recordedCellSelector).textContent())?.trim() ||
        "";
      const lastDate = parseDisplayDateToUTC(recordedText);

      if (!lastDate) {
        console.warn(
          `⚠️ Unparseable recorded cell "${recordedText}" — stopping scroll to avoid infinite loop`,
        );
        break;
      }

      console.log(
        `Last recorded: ${recordedText} (${lastDate.toISOString()}), cutoff: ${cutoff.toISOString()}`,
      );

      // Give a 1-minute cushion so rows exactly at the cutoff still load.
      if (lastDate.getTime() < cutoff.getTime()) break;
    }

    previousRowCount = currentRowCount;
  }
  console.log("Extracting data...");
}

/**
 * Earliest recorded instant across all input entries. Both loaders produce
 * `recordedTimestamp` as a UTC ISO string.
 */
function earliestRecordedInstant(inputData: any[]): Date | null {
  if (inputData.length === 0) return null;
  return inputData.reduce<Date>((min, entry) => {
    const d = new Date(entry.recordedTimestamp);
    if (Number.isNaN(d.getTime())) return min;
    return d.getTime() < min.getTime() ? d : min;
  }, new Date(inputData[0].recordedTimestamp));
}

(async () => {
  const cliArgs = parseArgs();
  console.log(cliArgs);

  const qcInputDir = cliArgs.type === "csv" ? QC_INPUT_DIR : QC_INPUT_JSON_DIR;
  const targetInputDir = cliArgs.inputDir || qcInputDir;

  const inputData: any[] = await loadInputData(targetInputDir, cliArgs.type);
  const results: Session[] = [];
  const links: (string | null)[] = [];

  const cutoff = earliestRecordedInstant(inputData);
  if (!cutoff) throw new Error("No input entries to process");

  const browser: Browser = await chromium.launch({ headless: true });
  const page: Page | null = await browser.newPage();

  const email = process.env.MINUTE_EMAIL;
  const password = process.env.MINUTE_PASSWORD;
  if (!email || !password) {
    throw new Error("Missing MINUTE_EMAIL or MINUTE_PASSWORD in environment");
  }

  await loginToMinuteApp(page, email, password, true);

  await page.goto(ORG_URL);
  await page.waitForSelector("#org-overview-tab-sessions", {
    state: "visible",
  });
  await page.click("#org-overview-tab-sessions");
  await page.waitForSelector("table tbody tr", { state: "visible" });

  // Resolve column indexes once, up front, and share them with both helpers.
  const columnIndex = await resolveSessionColumnIndexes(page);

  await clickShowMoreUntilStable(page, columnIndex.recorded, cutoff);

  const allRows: SessionRow[] = await getAllSessionRows(page);

  // (Debug artefact — writes `allRows`, not the yet-empty `results`.)
  fs.writeFileSync(path.join("allRows.json"), JSON.stringify(allRows, null, 2));

  for (const entry of inputData) {
    // Use the entry's own link if present, otherwise look it up.
    const fullLink =
      entry.link && entry.link !== ""
        ? entry.link
        : await getSessionData(entry, page!, allRows, "link");

    const recordedDisplay = await getSessionData(
      entry,
      page!,
      allRows,
      "recorded",
    );
    const uploadedDisplay = await getSessionData(
      entry,
      page!,
      allRows,
      "uploaded",
    );

    if (!recordedDisplay || !uploadedDisplay || !fullLink) {
      console.warn(
        `⚠️ Skipping ${entry.email} (sessionId ${entry.sessionId}): ` +
          `recorded=${recordedDisplay ?? "null"}, uploaded=${uploadedDisplay ?? "null"}, link=${fullLink ?? "null"}`,
      );
      continue;
    }

    // The table renders in UTC — convert to an instant, then to the output
    // display format (Manila / UTC+8) for results.json.
    const recordedInstant = parseDisplayDateToUTC(recordedDisplay);
    const uploadedInstant = parseDisplayDateToUTC(uploadedDisplay);

    if (!recordedInstant || !uploadedInstant) {
      console.warn(
        `⚠️ Skipping ${entry.email} (sessionId ${entry.sessionId}): unparseable display strings`,
      );
      continue;
    }

    const personalGmail = entry.email.endsWith("@gmail.com");
    links.push(fullLink);

    results.push({
      email: entry.email,
      task: entry.task,
      minutes: entry.minutes,
      recordedTimestamp: formatToUTC8(recordedInstant.toISOString()),
      uploadedTimestamp: formatToUTC8(uploadedInstant.toISOString()),
      sessionId: entry.sessionId || extractSessionId(fullLink) || "",
      link: fullLink,
      ...(personalGmail && { personalGmail: true }),
      ratings: {
        lighting: "",
        sharpness: "",
        handVisibility: "",
        fovFraming: "",
        cameraAngle: "",
        idle: "",
        seated: "",
        environment: "",
        other: "",
        comment: "",
      },
      systemRating: entry.systemRating || "",
    });
  }

  const nonNullLinks = links.filter((l): l is string => l !== null);
  if (new Set(nonNullLinks).size !== nonNullLinks.length) {
    console.log("⚠️ Duplicate links detected!");
    const duplicates = nonNullLinks.filter((l, i, arr) => arr.indexOf(l) !== i);
    console.log("Duplicates:", [...new Set(duplicates)]);
  }

  fs.writeFileSync(LINKS_CSV, links.map((l) => l || "").join("\n"));
  fs.writeFileSync(
    path.join(QC_OUTPUT_DIR, "results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(
    `\nProcessed ${results.length} entries. Results saved to qc-output/`,
  );

  await browser.close();
})();
