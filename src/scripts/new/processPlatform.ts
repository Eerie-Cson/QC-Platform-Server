import "dotenv/config";
import { chromium, Page } from "playwright";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScrapedRow = {
  sessionId: string;
  sessionUrl: string;
  email: string;
  taskType: string;
  duration: string;
  dateUtc: string;
  rateUrl: string;
  new?: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Scrape a card (identified by its <h2> text) into ScrapedRow[].
 * Works for both "My Queue" and "Available Sessions".
 *
 * - sessionId is read from <code>, not textContent, to avoid picking up the
 *   "New account" badge that sits next to it.
 * - rateUrl only exists in My Queue rows (Available Sessions rows have a
 *   Claim button instead), so it will be "" for Available rows.
 */
async function scrapeCard(page: Page, heading: string): Promise<ScrapedRow[]> {
  return page.evaluate((headingText) => {
    const cards = Array.from(document.querySelectorAll(".card"));
    const card = cards.find((c) =>
      c.querySelector("h2")?.textContent?.includes(headingText),
    );
    if (!card) return [];

    const table = card.querySelector("table");
    if (!table) return [];

    const rows = Array.from(table.querySelectorAll("tr"));

    return rows
      .map((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length < 6) return null;

        const sessionAnchor = cells[0].querySelector("a");
        const code = cells[0].querySelector("code");
        const rateAnchor = cells[5].querySelector("a");

        // New-account badge lives in the first cell:
        //   <span class="badge flag" style="margin-left:6px">New account</span>
        const badge = cells[0].querySelector("span.badge");
        const isNew = badge?.textContent?.trim() === "New account";

        return {
          sessionId: code?.textContent?.trim() ?? "",
          sessionUrl: sessionAnchor?.getAttribute("href") ?? "",
          email: cells[1].textContent?.trim() ?? "",
          taskType: cells[2].textContent?.trim() ?? "",
          duration: cells[3].textContent?.trim() ?? "",
          dateUtc: cells[4].textContent?.trim() ?? "",
          rateUrl: rateAnchor?.getAttribute("href") ?? "",
          // Only include the flag when it's actually a new account.
          ...(isNew ? { new: true } : {}),
        };
      })
      .filter((d): d is ScrapedRow => d !== null && d.sessionId !== "");
  }, heading);
}

/**
 * Click "Claim →" on the Available Sessions row for `sessionId` and wait
 * until the button detaches (i.e. Next.js server action re-rendered the
 * table and the row is gone).
 *
 * After the detach, we sleep for a small jittered interval before returning.
 * The detach wait is already the true synchronization point, but the extra
 * pause keeps the request pattern closer to human pacing and reduces the
 * chance of tripping a per-user rate limiter on the server action.
 */
async function claimSession(page: Page, sessionId: string): Promise<boolean> {
  const availableCard = page.locator(".card").filter({
    has: page.locator("h2", { hasText: "Available Sessions" }),
  });

  const row = availableCard.locator("tr").filter({ hasText: sessionId });
  if ((await row.count()) === 0) {
    console.warn(`    ⚠ ${sessionId} not found in Available Sessions.`);
    return false;
  }

  const btn = row.getByRole("button", { name: /Claim/i });
  await btn.click();

  // Server action → row should disappear once React re-renders.
  await btn.waitFor({ state: "detached", timeout: 20_000 });

  // Let the DOM settle before the next claim, with a bit of human-ish jitter.
  // Range: 800–2300 ms.
  const jitter = 800 + Math.random() * 1_500;
  await page.waitForTimeout(jitter);
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

  // ---- Target queue size (required for auto-claim) ----
  const targetRaw = process.env.QC_TARGET_QUEUE_SIZE?.trim();
  const targetQueueSize = targetRaw ? Number.parseInt(targetRaw, 10) : NaN;
  const autoClaim = process.env.QC_AUTO_CLAIM === "true";

  if (autoClaim) {
    if (!Number.isFinite(targetQueueSize) || targetQueueSize <= 0) {
      throw new Error(
        'QC_AUTO_CLAIM=true requires QC_TARGET_QUEUE_SIZE to be a positive integer (e.g. "90").',
      );
    }
    console.log(
      `🤖 Auto-claim enabled — target queue size: ${targetQueueSize}`,
    );
  } else {
    console.log(
      "ℹ️ Read-only mode (set QC_AUTO_CLAIM=true to enable claiming).",
    );
  }

  const context = await browser.newContext({
    httpCredentials: { username: email, password: password },
  });

  const page = await context.newPage();
  await page.goto(link);
  await page.waitForSelector("table tr");

  // -------------------------------------------------------------------------
  // 1. Scrape My Queue
  // -------------------------------------------------------------------------
  let myQueue = await scrapeCard(page, "My Queue");
  console.log(`📋 My Queue: ${myQueue.length} rows`);

  // -------------------------------------------------------------------------
  // 2. Top up from Available Sessions if below target
  // -------------------------------------------------------------------------
  if (autoClaim && myQueue.length < targetQueueSize) {
    const needed = targetQueueSize - myQueue.length;
    console.log(
      `📥 My Queue has ${myQueue.length}/${targetQueueSize}. ` +
        `Claiming ${needed} from Available Sessions...`,
    );

    const available = await scrapeCard(page, "Available Sessions");
    console.log(`   Available: ${available.length} rows visible.`);

    // Don't re-claim anything already in our queue.
    const alreadyInQueue = new Set(myQueue.map((r) => r.sessionId));
    const candidates = available
      .filter((r) => !alreadyInQueue.has(r.sessionId))
      .slice(0, needed);

    if (candidates.length === 0) {
      console.log("   ⚠ No matching sessions available to claim.");
    } else if (candidates.length < needed) {
      console.log(
        `   ⚠ Only ${candidates.length} candidates visible ` +
          `(needed ${needed}). Consider applying a filter on the page ` +
          `if the backlog is capped at 200.`,
      );
    }

    let claimed = 0;
    for (const candidate of candidates) {
      console.log(
        `   → Claiming ${candidate.sessionId} (${candidate.taskType})`,
      );
      try {
        const ok = await claimSession(page, candidate.sessionId);
        if (ok) {
          claimed++;
          console.log(`     ✓ Claimed.`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`     ✗ Failed to claim ${candidate.sessionId}: ${msg}`);
      }
    }

    console.log(`📥 Claimed ${claimed}/${candidates.length}.`);

    // -----------------------------------------------------------------------
    // 3. Re-scrape My Queue so the JSON reflects the post-claim state
    // -----------------------------------------------------------------------
    myQueue = await scrapeCard(page, "My Queue");
    console.log(`📋 My Queue (after claim): ${myQueue.length} rows`);
  } else if (autoClaim) {
    console.log(
      `✅ My Queue already has ${myQueue.length} ≥ target ${targetQueueSize} — ` +
        `no claiming needed.`,
    );
  }

  // -------------------------------------------------------------------------
  // 4. Write output
  // -------------------------------------------------------------------------
  const outputDir = path.join(process.cwd(), "platform-data");
  const outputPath = path.join(outputDir, "QC - input.json");

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(myQueue, null, 2), "utf8");

  if (myQueue.length === 0) {
    console.log("⚠️ My Queue is empty. File cleared.");
  } else {
    console.log(`✅ Saved ${myQueue.length} items to: ${outputPath}`);
  }

  await browser.close();
})();
