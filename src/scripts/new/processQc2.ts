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

  const pathArgIndex = args.findIndex(
    (arg) => arg === "--path" || arg === "-p",
  );
  const typeArgIndex = args.findIndex(
    (arg) => arg === "--type" || arg === "-t",
  );

  const inputDir =
    pathArgIndex !== -1 && args[pathArgIndex + 1]
      ? path.resolve(args[pathArgIndex + 1])
      : null;

  let type: InputType | null = null;
  if (typeArgIndex !== -1) {
    const raw = (args[typeArgIndex + 1] || "").toLowerCase();
    if (raw === "json" || raw === "csv") {
      type = raw;
    } else {
      throw new Error(
        `--type must be "json" or "csv" (got "${args[typeArgIndex + 1] ?? ""}")`,
      );
    }
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

/**
 * Shape of entries when a pre-built JSON file is supplied.
 * When present, this skips the CSV -> JSON conversion step entirely.
 */
interface JsonInputEntry {
  sessionId: string;
  sessionUrl: string;
  email: string;
  taskType: string;
  duration: string;
  dateUtc: string;
  rateUrl?: string;
}

/** "14.98m" | "14.98" | 14.98 -> "14.98" */
function normalizeMinutes(duration: string | number): string {
  if (typeof duration === "number") return String(duration);
  const numeric = parseFloat(String(duration).replace(/[^\d.]/g, ""));
  if (Number.isNaN(numeric)) {
    throw new Error(`Invalid minutes value: ${duration}`);
  }
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
    recordedTimestamp: parseJsonDateUtc(entry.dateUtc),
    sessionId: entry.sessionId,
    link: entry.sessionUrl,
    systemRating: "",
  }));
}

async function loadCsvInput(csvFile: string): Promise<any[]> {
  console.log(`Using CSV input: ${path.basename(csvFile)}`);

  const requiredHeaders = Object.keys(mapping).filter(
    (key) => key !== "System_Rating",
  );

  await new Promise<void>((resolve) => {
    csvToJson(csvFile, SESSIONS_JSON, mapping, requiredHeaders, () =>
      resolve(),
    );
  });

  return JSON.parse(fs.readFileSync(SESSIONS_JSON, "utf8"));
}

/**
 * Loads input data from `targetPath`.
 * If `type` is provided ("json" | "csv"), only that kind of file is used.
 * Otherwise, auto-detects (JSON wins if both are present).
 */
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
    if (!jsonFiles.length) {
      throw new Error(
        `--type json given, but no .json file found in ${targetPath}`,
      );
    }
    return loadJsonInput(path.join(targetPath, jsonFiles[0]));
  }

  if (type === "csv") {
    if (!csvFiles.length) {
      throw new Error(
        `--type csv given, but no .csv file found in ${targetPath}`,
      );
    }
    return await loadCsvInput(path.join(targetPath, csvFiles[0]));
  }

  // Auto-detect (original behaviour)
  if (jsonFiles.length > 0) {
    return loadJsonInput(path.join(targetPath, jsonFiles[0]));
  }
  if (csvFiles.length > 0) {
    return await loadCsvInput(path.join(targetPath, csvFiles[0]));
  }

  throw new Error(`No CSV or JSON file found in data directory: ${targetPath}`);
}

async function clickShowMoreUntilStable(
  page: Page,
  cutoffRecordedUTC8: string | null = null,
  selector = 'button:has-text("Show more")',
): Promise<void> {
  console.log(`Scrolling until ${cutoffRecordedUTC8} is reached`);
  let recordedDate = "";
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

    if (cutoffRecordedUTC8) {
      const lastRow = page.locator("table tbody tr:last-child");
      const recordedCell = lastRow.locator("td:nth-child(13)");
      const recordedText = (await recordedCell.textContent())?.trim() || "";
      recordedDate = recordedText;

      const lastDate = parseDisplayDateToUTC(recordedText);
      const cutoffDate = parseDisplayDateToUTC(cutoffRecordedUTC8);

      if (!lastDate) {
        console.warn(
          `⚠️ Unparseable recorded cell "${recordedText}" — stopping scroll to avoid infinite loop`,
        );
        break;
      }

      if (cutoffDate && lastDate.getTime() < cutoffDate.getTime()) {
        break;
      }
    }

    previousRowCount = currentRowCount;
  }
  console.log("Extracting data...");
}

(async () => {
  const cliArgs = parseArgs();
  console.log(cliArgs);
  const qcInputDir = cliArgs.type === "csv" ? QC_INPUT_DIR : QC_INPUT_JSON_DIR;
  const targetInputDir = cliArgs.inputDir || qcInputDir;

  const inputData: any[] = await loadInputData(targetInputDir, cliArgs.type);
  const results: Session[] = [];
  const links: (string | null)[] = [];

  const allRecordedUTC8 = inputData.map((entry) =>
    formatToUTC8(entry.recordedTimestamp),
  );

  const earliestRecordedUTC8 = allRecordedUTC8.reduce(
    (min, curr) => (curr < min ? curr : min),
    allRecordedUTC8[0],
  );

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
  await clickShowMoreUntilStable(page, earliestRecordedUTC8);

  const allRows: SessionRow[] = await getAllSessionRows(page);

  for (const entry of inputData) {
    const fullLink =
      entry.link || entry.link !== ""
        ? entry.link
        : await getSessionData(entry, page!, allRows, "link");

    const recordedTimestamp = await getSessionData(
      entry,
      page!,
      allRows,
      "recorded",
    );
    const uploadedTimestamp = await getSessionData(
      entry,
      page!,
      allRows,
      "uploaded",
    );

    if (!recordedTimestamp || !uploadedTimestamp) {
      console.warn(
        `⚠️ Skipping ${entry.email} (sessionId ${entry.sessionId}): ` +
          `recorded=${recordedTimestamp ?? "null"}, uploaded=${uploadedTimestamp ?? "null"}`,
      );
      await page.pause();
      continue;
    }

    const personalGmail: boolean = entry.email.endsWith("@gmail.com");

    links.push(fullLink);

    results.push({
      email: entry.email,
      task: entry.task,
      minutes: entry.minutes,
      recordedTimestamp,
      uploadedTimestamp,
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

  const nonNullLinks = links.filter((link): link is string => link !== null);
  if (new Set(nonNullLinks).size !== nonNullLinks.length) {
    console.log("⚠️ Duplicate links detected!");
    const duplicates = nonNullLinks.filter(
      (link, index, arr) => arr.indexOf(link) !== index,
    );
    console.log("Duplicates:", [...new Set(duplicates)]);
  }

  fs.writeFileSync(LINKS_CSV, links.map((link) => link || "").join("\n"));
  fs.writeFileSync(
    path.join(QC_OUTPUT_DIR, "results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(
    `\nProcessed ${results.length} entries. Results saved to qc-output/`,
  );

  if (browser) {
    await browser.close();
  }
})();
