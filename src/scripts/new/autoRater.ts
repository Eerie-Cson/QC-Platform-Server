import "dotenv/config";
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

// ---------- Types ----------

interface Ratings {
  lighting?: string;
  sharpness?: string;
  handVisibility?: string;
  fovFraming?: string;
  cameraAngle?: string;
  idle?: string;
  seated?: string;
  environment?: string;
  other?: string;
  comment?: string;
  slowLoading?: boolean;
  crosscheckComment?: string;
}

interface Entity {
  email: string;
  task: string;
  minutes: string;
  recordedTimestamp: string;
  uploadedTimestamp: string;
  sessionId: string;
  link: string;
  ratings: Ratings;
  systemRating: string;
  faceVisible: boolean;
  // Added by this script
  submitted?: boolean;
  submittedAt?: string;
}

// Maps JSON human-readable rating labels -> <option> values in the form
const ratingValueMap: Record<string, string> = {
  "No issue": "NO_ISSUE",
  Minor: "MINOR",
  Major: "MAJOR",
  "Standing/Moving": "STANDING_MOVING",
  "Standing/ Moving": "STANDING_MOVING",
  "Allow Seated": "ALLOWED_SEATED",
  Seated: "SEATED",
  "Correct Task": "CORRECT_TASK",
  "Wrong Task": "WRONG_TASK",
  Unavailable: "UNAVAILABLE",
  Processing: "PROCESSING",
};

// Maps JSON key -> form field `name` attribute
const fieldMapping: Record<
  keyof Omit<Ratings, "comment" | "slowLoading" | "crosscheckComment">,
  string
> = {
  lighting: "lighting",
  sharpness: "sharpness",
  handVisibility: "handVisibility",
  fovFraming: "fovFraming",
  cameraAngle: "cameraAngle",
  idle: "idleTime",
  other: "otherIssue",
  seated: "seated",
  environment: "environment",
};

const isEmpty = (v: unknown): boolean =>
  v === null || v === undefined || String(v).trim() === "";

// ---------- Helpers ----------

/**
 * Persist the in-memory data array back to disk.
 * Called after each successful submission so progress survives a crash.
 */
function writeResultsFile(jsonPath: string, data: Entity[]): void {
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), "utf8");
}

// ---------- Main ----------

(async (): Promise<void> => {
  const browser = await chromium.launch({ headless: false });

  const email = process.env.QC_EMAIL;
  const password = process.env.QC_PASSWORD;
  const link = process.env.QC_URL;

  if (!email || !password || !link) {
    throw new Error(
      "Missing environment variables (QC_EMAIL, QC_PASSWORD, or QC_URL)",
    );
  }

  const context = await browser.newContext({
    httpCredentials: { username: email, password: password },
  });

  const page = await context.newPage();
  await page.goto(link);

  await page.waitForSelector("table tr");

  const jsonPath = path.join(
    process.cwd(),
    "data",
    "output",
    "qc",
    "results.json",
  );
  const rawData = fs.readFileSync(jsonPath, "utf8");
  const data: Entity[] = JSON.parse(rawData) as Entity[];

  let submitted = 0;
  let skipped = 0;
  let failed = 0;
  let alreadyDone = 0;

  for (const [index, entity] of data.entries()) {
    const targetSessionId: string = entity.sessionId;
    const ratings: Ratings = entity.ratings ?? {};

    console.log(`\n[${index + 1}/${data.length}] Session: ${targetSessionId}`);

    // ---- Skip if already submitted on a previous run ----
    if (entity.submitted === true) {
      console.log("  ⏭ Skipping: already marked as submitted.");
      alreadyDone++;
      continue;
    }

    // ---- Skip if all rating fields are empty ----
    const ratingKeys = Object.keys(fieldMapping) as Array<
      keyof typeof fieldMapping
    >;
    const hasAnyRating = ratingKeys.some((k) => !isEmpty(ratings[k]));

    if (!hasAnyRating) {
      console.log("  ⏭ Skipping: all rating fields are empty.");
      skipped++;
      continue;
    }

    try {
      // ---- Re-resolve the My Queue table (fresh after any navigation) ----
      const myQueueTable = page.locator("table").filter({
        has: page.locator("thead th", { hasText: "Duration" }),
      });
      await myQueueTable.waitFor({ timeout: 15_000 });

      const row = myQueueTable
        .locator("tr")
        .filter({ hasText: targetSessionId });

      if ((await row.count()) === 0) {
        console.log("  ⚠ Not found in My Queue — skipping.");
        skipped++;
        continue;
      }

      // ---- Click the Rate / Resume draft link ----
      await row.getByRole("link", { name: /Resume draft|rate/i }).click();
      console.log("  ✓ Clicked rate link.");

      // ---- Wait for the rating form ----
      await page.waitForSelector("form select[name='lighting']", {
        timeout: 15_000,
      });

      // ---- Set each dropdown ----
      for (const [jsonKey, formName] of Object.entries(fieldMapping)) {
        const rawValue = ratings[jsonKey as keyof Ratings];
        if (isEmpty(rawValue)) continue;

        const selectValue = ratingValueMap[String(rawValue).trim()];
        if (!selectValue) {
          console.warn(
            `    ⚠ No mapping for "${rawValue}" on field "${jsonKey}" — skipping.`,
          );
          continue;
        }

        try {
          await page.selectOption(
            `form select[name="${formName}"]`,
            selectValue,
          );
          console.log(`    ✓ ${formName} → ${selectValue}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`    ⚠ Failed ${formName}: ${message}`);
        }
      }

      // ---- Fill notes textarea (optional) ----
      if (!isEmpty(ratings.comment)) {
        try {
          await page.fill(
            "form textarea[name='notes']",
            String(ratings.comment),
          );
          console.log(`    ✓ notes set.`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`    ⚠ Failed notes: ${message}`);
        }
      }

      // ---- Submit ----
      const submitButton = page
        .locator("form")
        .getByRole("button", { name: /Submit rating/i });

      // await page.pause();
      // break;

      await submitButton.click();
      console.log("  → Clicked Submit rating.");

      // Wait for the form to be unmounted (indicates the SPA moved away)
      await page
        .locator("form select[name='lighting']")
        .waitFor({ state: "detached", timeout: 20_000 });

      // Then wait for the queue table to be visible again
      await page
        .locator("table thead th", { hasText: "Duration" })
        .first()
        .waitFor({ timeout: 20_000 });

      // Small settle time for the DOM to fully swap
      await page.waitForTimeout(400);

      // ---- Mark this entity as submitted and persist to disk ----
      entity.submitted = true;
      entity.submittedAt = new Date().toISOString();
      writeResultsFile(jsonPath, data);

      console.log(`  ✅ Submitted rating for ${targetSessionId}.`);
      console.log(`     Marked as submitted in ${path.basename(jsonPath)}.`);
      submitted++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ Failed on ${targetSessionId}: ${message}`);
      failed++;

      // Pause so you can inspect what went wrong for this session
      await page.pause();

      // Best-effort: if we're stuck on a form page, go back to the queue
      try {
        if (page.url() !== link) {
          await page.goto(link);
          await page.waitForSelector("table tr");
        }
      } catch {
        // ignore recovery errors
      }
    }
  }

  console.log(
    `\n────── Summary ──────\n` +
      `  Submitted:     ${submitted}\n` +
      `  Already done:  ${alreadyDone}\n` +
      `  Skipped:       ${skipped}\n` +
      `  Failed:        ${failed}\n` +
      `  Total:         ${data.length}`,
  );

  await page.pause();
  await browser.close();
})();
