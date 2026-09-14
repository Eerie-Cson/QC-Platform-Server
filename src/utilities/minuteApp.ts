import { Page } from "playwright";
import { formatToUTC8, toDisplayString } from "./timeUtil";
import { Entry, SessionRow } from "../types";

export async function loginToMinuteApp(
  page: Page,
  email: string,
  password: string,
  keepSignedIn = true,
): Promise<void> {
  await page.goto("https://useminute.app/");
  await page.locator('a[href="/login"]:has-text("Log in")').click();
  await page.locator("#email").waitFor({ state: "visible" });
  await page.fill("#email", email);
  await page.fill("#password", password);

  if (!keepSignedIn) {
    await page.locator('label:has-text("Keep me signed in")').click();
  }

  await page.locator('button[type="submit"]:has-text("Log in")').click();
  await page.waitForURL("https://useminute.app/", { timeout: 5000 });
  await page.waitForSelector("body", { state: "attached" });
  console.log("Login successful!");
}

export function extractSessionId(url: string | null): string | null {
  if (!url) return null;
  const parts = url.split("/session/");
  return parts.length > 1 ? parts[1].split("/")[0] : null;
}

export async function findSessionLinkForEntry(
  page: Page,
  entry: Entry,
  recordedUTC8: string,
  uploadedUTC8: string,
): Promise<string | null> {
  await page.click("#org-overview-tab-users");
  await page.waitForSelector('input[placeholder="Filter users by email..."]', {
    state: "visible",
  });

  const filterInput = page.locator(
    'input[placeholder="Filter users by email..."]',
  );
  await filterInput.click();
  await filterInput.fill(entry.email);

  const dropdown = page.getByRole("option", { name: entry.email });
  await dropdown.waitFor({ state: "visible" });
  await dropdown.click();
  await page.getByRole("link", { name: "—" }).first().click();

  await page.waitForSelector("table tbody tr", { state: "visible" });

  const recordedDisplay = toDisplayString(recordedUTC8);
  const uploadedDisplay = toDisplayString(uploadedUTC8);

  // First attempt: direct unique locator
  const sessionLink = page.locator(
    `a[href*="/session/"]:has(span:has-text("${recordedDisplay}")):has(span:has-text("${uploadedDisplay}"))`,
  );

  try {
    await sessionLink.waitFor({ state: "visible", timeout: 5000 });
    const href = await sessionLink.getAttribute("href");
    return `https://useminute.app${href}`;
  } catch (err) {
    console.warn(
      `⌛︎ Matching failed for ${entry.email} - session recorded ${recordedDisplay} and uploaded ${uploadedDisplay}. Trying candidate verification...`,
    );
  }

  let foundLink: string | null = null;

  while (true) {
    const candidateLinks = await page
      .locator(
        `a[href*="/session/"]:has(span:has-text("${recordedDisplay}")):has(span:has-text("${uploadedDisplay}"))`,
      )
      .all();

    for (const link of candidateLinks) {
      const href = await link.getAttribute("href");
      const fullLink = `https://useminute.app${href}`;

      await page.goto(fullLink);
      try {
        const infoParagraph = page.locator(
          '.app-surface-tile p:has-text("Recorded:")',
        );
        await infoParagraph.waitFor({ state: "visible", timeout: 5000 });
        const text = await infoParagraph.textContent();

        const recordedMatch = text?.match(/Recorded:\s*([^·]+)/);
        const uploadedMatch = text?.match(/Uploaded:\s*([^·]+)/);

        if (recordedMatch && uploadedMatch) {
          const recordedRaw = recordedMatch[1].trim();
          const uploadedRaw = uploadedMatch[1].trim();

          const recordedFromPage = formatToUTC8(recordedRaw);
          const uploadedFromPage = formatToUTC8(uploadedRaw);

          if (
            recordedFromPage === recordedUTC8 &&
            uploadedFromPage === uploadedUTC8
          ) {
            console.log(
              `✅ ${entry.email} session recorded ${recordedDisplay} and uploaded ${uploadedDisplay} found`,
            );
            foundLink = fullLink;
            break;
          }
        }
      } catch (err) {
        console.warn(
          `Error checking candidate ${fullLink}: ${(err as Error).message}`,
        );
      }

      await page.goBack();
      await page.waitForSelector("table tbody tr", { state: "visible" });

      if (foundLink) break;
    }

    if (foundLink) break;

    const showMoreBtn = page.getByRole("button", {
      name: "Show more sessions",
    });
    if (await showMoreBtn.isVisible()) {
      await showMoreBtn.click();
      await page.waitForTimeout(500);
    } else {
      break;
    }
  }

  if (!foundLink) {
    console.warn(`❌ No verified session found for ${entry.email}`);
    return null;
  }

  return foundLink;
}

export async function getAllSessionRows(page: Page): Promise<SessionRow[]> {
  const rows = await page.$$("tr.cursor-pointer");
  const sessionData: SessionRow[] = [];

  for (const row of rows) {
    const cells = await row.$$("td");
    if (cells.length < 12) continue;

    const email = (await cells[0].textContent())?.trim() || "";
    const task = (await cells[4].textContent())?.trim() || "";
    const minutesText = (await cells[7].textContent())?.trim() || "0";
    const minutes = parseFloat(minutesText);
    const sessionId = (await cells[1].textContent())?.trim() || "";
    const recorded = (await cells[12].textContent())?.trim() || "";
    const uploaded = (await cells[13].textContent())?.trim() || "";

    const linkElement = await row.$('a[href*="/session/"]');
    const link = linkElement ? await linkElement.getAttribute("href") : null;

    sessionData.push({
      email,
      sessionId,
      task,
      minutes,
      recorded,
      uploaded,
      link,
    });
  }
  return sessionData;
}

export async function getSessionData(
  entry: any,
  page: Page,
  allRows: SessionRow[],
  sessionParams: "uploaded" | "recorded" | "link",
): Promise<string | null> {
  const match = allRows.find((row) => row.sessionId === entry.sessionId);

  if (sessionParams === "uploaded") return match ? match.uploaded : null;
  if (sessionParams === "recorded") return match ? match.recorded : null;
  console.log(match && match.link, "match && match.link");

  if (match && match.link) return `https://useminute.app${match.link}`;

  const recordedUTC8 = formatToUTC8(entry.recordedTimestamp);
  return await findSessionLinkForEntry(
    page,
    entry,
    recordedUTC8,
    match!.uploaded,
  );
}
