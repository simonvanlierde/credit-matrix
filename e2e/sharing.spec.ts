import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { asReturningVisitor, onScreen } from "./helpers";

/**
 * Draft sharing end to end: a request goes out, comes back, and lands — or is
 * refused out loud. Each participant gets their own browser context, because
 * localStorage is per-context and the whole point of these flows is that two
 * different browsers hold two different sets of drafts.
 */

/** A participant's browser: own storage, own clipboard, welcome already seen. */
async function openBrowser(context: BrowserContext, { firstRun = false } = {}): Promise<Page> {
  const page = await context.newPage();
  if (!firstRun) await asReturningVisitor(page);
  return page;
}

/** Build a draft with two contributors and copy the ask-link for the second. */
async function makeAskLink(page: Page): Promise<string> {
  await page.goto("/");
  const adder = page.getByLabel("New author names or ORCID iD");
  await adder.fill("Jane Smith, Bob White");
  await adder.press("Enter");
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(2);

  await page.getByRole("button", { name: "Actions for Bob White" }).click();
  await page.getByRole("button", { name: "Ask Bob White to fill this in" }).click();
  return page.evaluate(() => navigator.clipboard.readText());
}

/** The claim banner's own copy, not the announcement that echoes it. */
function claimBanner(page: Page) {
  return onScreen(page, "You are filling in Bob White's contributions");
}

/** Answer a request: tick Investigation on the claimed row and copy the reply. */
async function answerAskLink(page: Page, askLink: string): Promise<string> {
  await page.goto(askLink);
  await expect(claimBanner(page)).toBeVisible();
  await page.getByRole("button", { name: /^Investigation for Bob White:/ }).click();
  await expect(page.getByRole("button", { name: "Investigation for Bob White: Contributed" })).toBeVisible();
  await page.getByRole("button", { name: "Copy the link to send back" }).click();
  return page.evaluate(() => navigator.clipboard.readText());
}

function newContext(browser: Browser) {
  return browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
}

test("full round trip: ask → locked fill → reply link click → visible merge with undo", async ({ browser }) => {
  const originator = await newContext(browser);
  const coauthor = await newContext(browser);
  const pageA = await openBrowser(originator);
  const askLink = await makeAskLink(pageA);

  // Copying the ask link marked Bob's row as asked; the chip waits for him.
  await expect(pageA.getByText("Asked", { exact: true })).toBeVisible();

  const pageB = await openBrowser(coauthor);
  await pageB.goto(askLink);

  // Locked claim mode: banner up, no add row, and only Bob's own row travelled.
  await expect(claimBanner(pageB)).toBeVisible();
  await expect(pageB.getByLabel("New author names or ORCID iD")).toHaveCount(0);
  await expect(pageB.getByRole("button", { name: /^Investigation for Jane Smith:/ })).toHaveCount(0);
  // Nothing that would rewrite the roster is offered either.
  await expect(pageB.getByRole("button", { name: /^Remove / })).toHaveCount(0);

  await pageB.getByRole("button", { name: /^Investigation for Bob White:/ }).click();
  await expect(pageB.getByRole("button", { name: "Investigation for Bob White: Contributed" })).toBeVisible();
  // On their own row the co-author is the authority — the name they type ships.
  const ownName = pageB.getByLabel("Name or ORCID iD", { exact: true });
  await ownName.fill("Bob B. White");
  await ownName.press("Enter");
  await pageB.getByRole("button", { name: "Copy the link to send back" }).click();
  const replyLink = await pageB.evaluate(() => navigator.clipboard.readText());

  // The originator CLICKS the reply — no Import knowledge required.
  await pageA.goto(replyLink);
  await expect(onScreen(pageA, /Bob B\. White's roles were filled in/)).toBeVisible();
  await expect(pageA.getByRole("button", { name: "Investigation for Bob B. White: Contributed" })).toBeVisible();
  // The row itself says what changed: the corrected name and an Updated mark,
  // and the matrix haloes that contributor's cells where the roles landed.
  await expect(pageA.getByLabel("Name or ORCID iD", { exact: true }).nth(1)).toHaveValue("Bob B. White");
  await expect(pageA.getByText("Updated", { exact: true })).toBeVisible();
  await expect(pageA.getByRole("button", { name: "Investigation for Bob B. White: Contributed" })).toHaveClass(
    /outline-primary/,
  );
  // The reply answers the ask, so the chip comes down.
  await expect(pageA.getByText("Asked", { exact: true })).toHaveCount(0);

  // Undo restores the pre-merge roster — name included — and reopens the ask.
  await pageA.getByRole("button", { name: "Undo" }).click();
  await expect(pageA.getByRole("button", { name: "Investigation for Bob White: None" })).toBeVisible();
  await expect(pageA.getByRole("button", { name: /^Remove / })).toHaveCount(2);
  await expect(pageA.getByText("Updated", { exact: true })).toHaveCount(0);
  await expect(pageA.getByRole("button", { name: "Investigation for Bob White: None" })).not.toHaveClass(
    /outline-primary/,
  );
  await expect(pageA.getByText("Asked", { exact: true })).toBeVisible();

  await originator.close();
  await coauthor.close();
});

test("refresh mid-claim keeps the banner; re-opening the link revisits, never forks", async ({ browser }) => {
  const originator = await newContext(browser);
  const coauthor = await newContext(browser);
  const askLink = await makeAskLink(await openBrowser(originator));

  const pageB = await openBrowser(coauthor);
  await pageB.goto(askLink);
  const banner = claimBanner(pageB);
  await expect(banner).toBeVisible();

  // The claim lives on the draft, not on the URL: the hash is gone by now.
  expect(new URL(pageB.url()).hash).toBe("");
  await pageB.reload();
  await expect(banner).toBeVisible();

  // Opening the same request again resumes it instead of making a second draft.
  await pageB.goto(askLink);
  await expect(onScreen(pageB, "Picked up where you left off on this request.")).toBeVisible();
  await expect(banner).toBeVisible();
  await pageB.getByRole("button", { name: /^Drafts:/ }).click();
  // One row, not two: the second arrival resumed the draft the first one made.
  await expect(pageB.getByRole("button", { name: "Switch to Untitled draft" })).toHaveCount(1);

  await originator.close();
  await coauthor.close();
});

test("a reply for a deleted draft is refused visibly", async ({ browser }) => {
  const originator = await newContext(browser);
  const coauthor = await newContext(browser);
  const pageA = await openBrowser(originator);
  const askLink = await makeAskLink(pageA);
  const replyLink = await answerAskLink(await openBrowser(coauthor), askLink);

  // The originator drops the paper the request was about, and starts another.
  await pageA.getByRole("button", { name: /^Drafts:/ }).click();
  // The trash icon, then the confirmation that replaces the row.
  await pageA.getByRole("button", { name: "Delete", exact: true }).click();
  await pageA.getByRole("button", { name: "Delete", exact: true }).click();
  await pageA.keyboard.press("Escape");
  await expect(pageA.getByRole("button", { name: /^Remove / })).toHaveCount(0);
  const adder = pageA.getByLabel("New author names or ORCID iD");
  await adder.fill("Erik Nilsson");
  await adder.press("Enter");
  await expect(pageA.getByRole("button", { name: /^Remove / })).toHaveCount(1);

  await pageA.goto(replyLink);
  await expect(
    onScreen(pageA, "That reply belongs to a draft that is not in this browser, so nothing was changed."),
  ).toBeVisible();
  // The workspace it landed on is exactly as it was.
  await expect(pageA.getByRole("button", { name: /^Remove / })).toHaveCount(1);
  await expect(pageA.getByLabel("Name or ORCID iD", { exact: true })).toHaveValue("Erik Nilsson");

  await originator.close();
  await coauthor.close();
});

test("keep as an ordinary draft unlocks for good", async ({ browser }) => {
  const originator = await newContext(browser);
  const coauthor = await newContext(browser);
  const askLink = await makeAskLink(await openBrowser(originator));

  const pageB = await openBrowser(coauthor);
  await pageB.goto(askLink);
  const banner = claimBanner(pageB);
  await expect(banner).toBeVisible();

  await pageB.getByRole("button", { name: "Keep as an ordinary draft" }).click();
  await expect(banner).toHaveCount(0);
  await expect(pageB.getByLabel("New author names or ORCID iD")).toBeVisible();

  await pageB.reload();
  await expect(banner).toHaveCount(0);
  await expect(pageB.getByLabel("New author names or ORCID iD")).toBeVisible();

  await originator.close();
  await coauthor.close();
});

test("pasting a share link into an open tab reacts without reload", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await asReturningVisitor(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Load sample data" }).click();
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);
  await page.getByRole("button", { name: "Share" }).click();
  await page.getByRole("button", { name: "Copy data link" }).click();
  const url = await page.evaluate(() => navigator.clipboard.readText());

  // Simulate URL-bar paste: hash assignment fires hashchange, no reload.
  await page.evaluate((href) => {
    window.location.href = href;
  }, url);
  await expect(onScreen(page, /request link you built|Opened the shared draft/)).toBeVisible();
});

test("a claim arrival suppresses the first-run welcome", async ({ browser }) => {
  const originator = await newContext(browser);
  const coauthor = await newContext(browser);
  const askLink = await makeAskLink(await openBrowser(originator));

  // A brand-new visitor: nothing seeded, so the welcome would normally open.
  const pageB = await openBrowser(coauthor, { firstRun: true });
  await pageB.goto(askLink);

  await expect(claimBanner(pageB)).toBeVisible();
  await expect(pageB.locator("dialog#getting-started")).toBeHidden();

  await originator.close();
  await coauthor.close();
});

test("a mangled link fails visibly and keeps the draft", async ({ page }) => {
  await asReturningVisitor(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Load sample data" }).click();
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);

  await page.goto("/#s=definitely-not-a-payload");
  await expect(onScreen(page, /That shared link could not be opened/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);
});
