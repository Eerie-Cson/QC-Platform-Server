// import "dotenv/config";
// import { chromium } from "playwright";
// import fs from "fs";
// import path from "path";

// import { csvToJson } from "../utilities/csvToJson";
// import {
//   loginToMinuteApp,
//   extractSessionId,
//   getSessionLink,
//   getAllSessionRows,
// } from "../utilities/minuteApp";
// import { formatToUTC8 } from "../utilities/timeUtil";
// import {
//   QC_INPUT_DIR,
//   QC_OUTPUT_DIR,
//   SESSIONS_JSON,
//   LINKS_CSV,
// } from "../config/paths";
// import { Session, SessionRow } from "../types";

// const ORG_URL = "https://useminute.app/organization/HYEKNs-Crev9R8SvFKI6SQ";

// const mapping = {
//   Email: "email",
//   "Session ID": "sessionId",
//   Task: "task",
//   Minutes: "minutes",
//   "Recorded Timestamp": "recordedTimestamp",
//   "Uploaded Timestamp": "uploadedTimestamp",
//   System_Rating: "systemRating",
// };

// async function clickShowMoreUntilStable(
//   page: any,
//   cutoffRecordedUTC8: string | null = null,
//   selector = 'button:has-text("Show more")',
// ): Promise<void> {
//   console.log(`Scrolling until ${cutoffRecordedUTC8} is reached`);
//   let recordedDate = "";
//   let previousRowCount = 0;
//   const showMoreButton = page.locator(selector);

//   while (true) {
//     const currentRowCount = await page.locator("table tbody tr").count();
//     if (currentRowCount === previousRowCount) break;

//     await showMoreButton.scrollIntoViewIfNeeded();
//     if (await showMoreButton.isVisible()) {
//       await showMoreButton.click();
//       await page.waitForTimeout(800);
//     } else {
//       break;
//     }

//     if (cutoffRecordedUTC8) {
//       const lastRow = page.locator("table tbody tr:last-child");
//       const recordedCell = lastRow.locator("td:nth-child(13)");
//       const recordedText = (await recordedCell.textContent())?.trim() || "";
//       recordedDate = recordedText;

//       if (recordedText && recordedText < cutoffRecordedUTC8) {
//         break;
//       }
//     }

//     previousRowCount = currentRowCount;
//   }
//   console.log("Extracting data...");
// }

// (async () => {
//   const csvFiles = fs
//     .readdirSync(QC_INPUT_DIR)
//     .filter((file) => file.endsWith(".csv"));

//   if (csvFiles.length === 0) {
//     throw new Error("No CSV file found in data directory.");
//   }

//   const csvFile = path.join(QC_INPUT_DIR, csvFiles[0]);
//   const requiredHeaders = Object.keys(mapping).filter(
//     (key) => key !== "System_Rating",
//   );

//   await new Promise<void>((resolve, reject) => {
//     csvToJson(csvFile, SESSIONS_JSON, mapping, requiredHeaders, () =>
//       resolve(),
//     );
//   });

//   const inputData: any[] = JSON.parse(fs.readFileSync(SESSIONS_JSON, "utf8"));
//   const results: Session[] = [];
//   const links: (string | null)[] = [];

//   const allRecordedUTC8 = inputData.map((entry) =>
//     formatToUTC8(entry.recordedTimestamp),
//   );

//   const earliestRecordedUTC8 = allRecordedUTC8.reduce(
//     (min, curr) => (curr < min ? curr : min),
//     allRecordedUTC8[0],
//   );

//   const browser = await chromium.launch({ headless: true });
//   const page = await browser.newPage();

//   const email = process.env.MINUTE_EMAIL;
//   const password = process.env.MINUTE_PASSWORD;

//   if (!email || !password) {
//     throw new Error("Missing MINUTE_EMAIL or MINUTE_PASSWORD in environment");
//   }
//   await loginToMinuteApp(page, email, password, true);

//   await page.goto(ORG_URL);
//   await page.waitForSelector("#org-overview-tab-sessions", {
//     state: "visible",
//   });
//   await page.click("#org-overview-tab-sessions");
//   await page.waitForSelector("table tbody tr", { state: "visible" });
//   await clickShowMoreUntilStable(page, earliestRecordedUTC8);

//   const allRows: SessionRow[] = await getAllSessionRows(page);

//   for (const entry of inputData) {
//     const fullLink = await getSessionLink(entry, page, allRows);
//     const personalGmail: boolean = entry.email.endsWith("@gmail.com");

//     links.push(fullLink);

//     results.push({
//       email: entry.email,
//       task: entry.task,
//       minutes: entry.minutes,
//       recordedTimestamp: formatToUTC8(entry.uploadedTimestamp),
//       uploadedTimestamp: formatToUTC8(entry.recordedTimestamp),
//       sessionId: entry.sessionId || extractSessionId(fullLink) || "",
//       link: fullLink,
//       ...(personalGmail && { personalGmail: true }),
//       ratings: {
//         lighting: "",
//         sharpness: "",
//         handVisibility: "",
//         fovFraming: "",
//         cameraAngle: "",
//         idle: "",
//         seated: "",
//         environment: "",
//         other: "",
//         comment: "",
//       },
//       systemRating: entry.systemRating || "",
//     });
//   }

//   const nonNullLinks = links.filter((link): link is string => link !== null);
//   if (new Set(nonNullLinks).size !== nonNullLinks.length) {
//     console.log("⚠️ Duplicate links detected!");
//     const duplicates = nonNullLinks.filter(
//       (link, index, arr) => arr.indexOf(link) !== index,
//     );
//     console.log("Duplicates:", [...new Set(duplicates)]);
//   }

//   fs.writeFileSync(LINKS_CSV, links.map((link) => link || "").join("\n"));
//   fs.writeFileSync(
//     path.join(QC_OUTPUT_DIR, "results.json"),
//     JSON.stringify(results, null, 2),
//   );
//   console.log(
//     `\nProcessed ${results.length} entries. Results saved to qc-output/`,
//   );

//   await browser.close();
// })();
