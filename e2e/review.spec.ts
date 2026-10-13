import { type Browser, expect, type Page, test } from "@playwright/test";
import { asReturningVisitor, copyFrom, onScreen, scan } from "./helpers";

/**
 * Settling co-author answers: a reply lands beside the row, the grid marks
 * where it differs, and the Review tab turns each difference into a decision.
 */

function newContext(browser: Browser) {
  return browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
}

/**
 * The lead guesses Bob did the software; Bob says he did the investigation
 * instead. Returns the lead's page with Bob's reply opened.
 */
async function leadWithReply(browser: Browser): Promise<Page> {
  const lead = await (await newContext(browser)).newPage();
  await asReturningVisitor(lead);
  await lead.goto("/");
  const adder = lead.getByLabel("New author names or ORCID iD");
  await adder.fill("Jane Smith, Bob White");
  await adder.press("Enter");
  await lead.getByRole("button", { name: /^Software for Bob White:/ }).click();
  await expect(lead.getByRole("button", { name: "Software for Bob White: Contributed" })).toBeVisible();
  await lead.getByRole("button", { name: "Actions for Bob White" }).click();
  const askLink = await copyFrom(lead, lead.getByRole("button", { name: "Ask Bob White what they did" }));
  await lead.keyboard.press("Escape");

  const bob = await (await newContext(browser)).newPage();
  await asReturningVisitor(bob);
  await bob.goto(askLink);
  const investigation = bob
    .getByRole("radiogroup", { name: "Investigation", exact: true })
    .getByRole("radio", { name: "Contributed", exact: true });
  await investigation.click();
  await expect(investigation).toBeChecked();
  const reply = await copyFrom(bob, bob.getByRole("button", { name: "Send back" }));
  await bob.context().close();

  await lead.goto(reply);
  await expect(onScreen(lead, "Bob White's answer arrived: 2 differences.")).toBeVisible();
  return lead;
}

const review = (page: Page) => page.getByRole("tabpanel", { name: /^Review/ });

/** Copies the ask link for one contributor from the lead's row menu. */
async function askLink(lead: Page, name: string): Promise<string> {
  await lead.getByRole("button", { name: `Actions for ${name}` }).click();
  const link = await copyFrom(lead, lead.getByRole("button", { name: `Ask ${name} what they did` }));
  await lead.keyboard.press("Escape");
  return link;
}

/** Answers an ask in a browser of the co-author's own, ticking the given roles, and returns the reply link. */
async function answer(browser: Browser, link: string, roles: string[]): Promise<string> {
  const page = await (await newContext(browser)).newPage();
  await asReturningVisitor(page);
  await page.goto(link);
  for (const role of roles) {
    const contributed = page
      .getByRole("radiogroup", { name: role, exact: true })
      .getByRole("radio", { name: "Contributed", exact: true });
    await contributed.click();
    await expect(contributed).toBeChecked();
  }
  const reply = await copyFrom(page, page.getByRole("button", { name: "Send back" }));
  await page.context().close();
  return reply;
}

test("two co-authors answer the same draft, and each answer is settled on its own", async ({ browser }) => {
  const lead = await (await newContext(browser)).newPage();
  await asReturningVisitor(lead);
  await lead.goto("/");
  const adder = lead.getByLabel("New author names or ORCID iD");
  await adder.fill("Jane Smith, Bob White, Ann Lee");
  await adder.press("Enter");
  await lead.getByRole("button", { name: "Actions for Jane Smith" }).click();
  await lead.getByRole("button", { name: "This is me" }).click();
  await lead.keyboard.press("Escape");
  await lead.getByRole("button", { name: /^Software for Bob White:/ }).click();
  await expect(lead.getByRole("button", { name: "Software for Bob White: Contributed" })).toBeVisible();

  // Both asks go out before either answer comes back.
  const bobAsk = await askLink(lead, "Bob White");
  const annAsk = await askLink(lead, "Ann Lee");
  const bobReply = await answer(browser, bobAsk, ["Investigation"]);
  const annReply = await answer(browser, annAsk, ["Conceptualization"]);

  // Opened in the other order than they were asked.
  await lead.goto(annReply);
  await expect(onScreen(lead, "Ann Lee's answer arrived: 1 difference.")).toBeVisible();
  await lead.goto(bobReply);
  await expect(onScreen(lead, "Bob White's answer arrived: 2 differences.")).toBeVisible();

  await expect(lead.getByText("2 of 2 answered")).toBeVisible();
  await expect(lead.getByRole("button", { name: "Ann Lee: 1 open difference" })).toBeVisible();
  await expect(lead.getByRole("button", { name: "Bob White: 2 open differences" })).toBeVisible();
  // Bob's later reply did not replace Ann's: each answer stays beside its own row.
  await expect(lead.getByRole("button", { name: "Conceptualization for Ann Lee: None" })).toHaveAccessibleDescription(
    "Ann says Contributed",
  );
  await expect(lead.getByRole("button", { name: "Investigation for Bob White: None" })).toHaveAccessibleDescription(
    "Bob says Contributed",
  );

  // Settling Ann's answer leaves Bob's open.
  await lead.getByRole("button", { name: "Ann Lee: 1 open difference" }).click();
  await expect(lead.getByRole("heading", { name: "Ann Lee" })).toBeFocused();
  await review(lead).getByRole("button", { name: "Use Ann's: Conceptualization" }).click();
  await expect(lead.getByRole("button", { name: "Conceptualization for Ann Lee: Contributed" })).toBeVisible();
  await expect(lead.getByRole("button", { name: "Ann Lee: 1 open difference" })).toHaveCount(0);
  await expect(lead.getByRole("button", { name: "Bob White: 2 open differences" })).toBeVisible();

  await review(lead).getByRole("button", { name: "Use all of Bob's" }).click();
  await expect(lead.getByRole("button", { name: "Investigation for Bob White: Contributed" })).toBeVisible();
  await expect(lead.getByRole("button", { name: /^Software for Bob White: None/ })).toBeVisible();
  await expect(onScreen(lead, "Everything is settled.")).toBeVisible();

  await lead.context().close();
});

test("an answer is reviewed, settled either way, undone, and the statement notice goes", async ({ browser }) => {
  const page = await leadWithReply(browser);

  // Jane is the lead: she is not her own co-author.
  await expect(page.getByText("1 of 2 answered")).toBeVisible();
  await page.getByRole("button", { name: "Actions for Jane Smith" }).click();
  await page.getByRole("button", { name: "This is me" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("1 of 1 answered")).toBeVisible();
  await expect(page.getByText("2 answers differ")).toBeVisible();

  // The cell keeps your level and says what Bob said, by a mark and in words.
  const investigation = page.getByRole("button", { name: "Investigation for Bob White: None" });
  await expect(investigation).toHaveAccessibleDescription("Bob says Contributed");

  // The statement says it uses your version, and copying it stays open.
  const notice = onScreen(page, "2 contributions still differ. This statement uses your version.");
  await expect(notice).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy statement" })).toBeEnabled();

  // The column badge opens Review on Bob's answers.
  await page.getByRole("button", { name: "Bob White: 2 open differences" }).click();
  await expect(page.getByRole("tab", { name: /^Review/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Bob White" })).toBeFocused();
  await expect(review(page).getByText("Added a role")).toBeVisible();
  await expect(review(page).getByText("Left this out")).toBeVisible();

  // Use his answer: the cell takes his level, and focus moves to the next line.
  await review(page).getByRole("button", { name: "Use Bob's: Investigation" }).click();
  await expect(page.getByRole("button", { name: "Investigation for Bob White: Contributed" })).toBeVisible();
  await expect(review(page).getByText("Used Bob's answer")).toBeVisible();
  await expect(review(page).getByRole("button", { name: "Use Bob's: Software" })).toBeFocused();

  // Undo puts the cell back and the line reopens.
  await review(page).getByRole("button", { name: "Undo: Investigation" }).click();
  await expect(page.getByRole("button", { name: "Investigation for Bob White: None" })).toBeVisible();
  await expect(review(page).getByRole("button", { name: "Use Bob's: Investigation" })).toBeFocused();

  await review(page).getByRole("button", { name: "Use Bob's: Investigation" }).click();
  await review(page).getByRole("button", { name: "Keep yours: Software" }).click();
  await expect(review(page).getByText("Kept yours")).toBeVisible();
  await expect(page.getByRole("button", { name: "Software for Bob White: Contributed" })).toBeVisible();
  await expect(onScreen(page, "Everything is settled.")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Review", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bob White: 2 open differences" })).toHaveCount(0);

  await page.getByRole("tab", { name: "Statement" }).click();
  await expect(notice).toHaveCount(0);

  await page.getByRole("tab", { name: "Team" }).click();
  await expect(page.getByRole("tabpanel", { name: "Team" }).getByText(/^Settled on /)).toBeVisible();
  // You are not on your own team list.
  await expect(page.getByRole("button", { name: "Copy message for Jane Smith" })).toHaveCount(0);

  // Any decided line undoes on its own, not only the last one.
  await page.getByRole("tab", { name: "Review" }).click();
  await review(page).getByRole("button", { name: "Undo: Investigation" }).click();
  await expect(page.getByRole("button", { name: "Investigation for Bob White: None" })).toBeVisible();
  await expect(review(page).getByRole("button", { name: "Use Bob's: Investigation" })).toBeFocused();
  await expect(review(page).getByText("Kept yours")).toBeVisible();

  await page.context().close();
});

test("a difference settles from the keyboard alone", async ({ browser }) => {
  const page = await leadWithReply(browser);
  const badge = page.getByRole("button", { name: "Bob White: 2 open differences" });
  await badge.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Bob White" })).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(review(page).getByRole("button", { name: "Use all of Bob's" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(review(page).getByRole("button", { name: "Use Bob's: Investigation" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(review(page).getByRole("button", { name: "Use Bob's: Software" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(review(page).getByRole("button", { name: "Keep yours: Software" })).toBeFocused();
  await page.keyboard.press("Enter");
  // Nothing left to decide: focus lands on the line that says so.
  await expect(page.getByText("Everything is settled.")).toBeFocused();

  await page.context().close();
});

test("the Review tab with open differences has no accessibility violations", async ({ browser }) => {
  const page = await leadWithReply(browser);
  // The arrival message covers the grid's status strip, so it carries its own way to Review.
  const arrival = onScreen(page, "Bob White's answer arrived: 2 differences.");
  await arrival.locator("..").getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bob White" })).toBeFocused();
  await expect(arrival).toHaveCount(0);
  await expect(review(page).getByRole("button", { name: "Use Bob's: Investigation" })).toBeVisible();
  // Hovering a line rings its grid cell; the scan covers that state too.
  await review(page).getByText("Investigation", { exact: true }).hover();
  const results = await scan(page);
  expect(results.violations).toEqual([]);
  await page.context().close();
});

test("asking about a difference names who and what in both states, and the label comes back", async ({ browser }) => {
  const page = await leadWithReply(browser);
  await page.getByRole("tab", { name: /^Review/ }).click();
  const ask = review(page).getByRole("button", { name: "Ask Bob about this: Investigation", exact: true });
  await ask.click();
  await expect(
    review(page).getByRole("button", { name: "Copied. Ask Bob about this: Investigation", exact: true }),
  ).toBeVisible();
  // Resets after 2s, like every other copy button.
  await expect(ask).toBeVisible({ timeout: 5000 });
  await page.context().close();
});

test("only a tab panel with nothing focusable in it is a tab stop", async ({ browser }) => {
  const page = await leadWithReply(browser);
  for (const id of ["statement", "team", "review"]) {
    await expect(page.locator(`#inspector-panel-${id}`)).not.toHaveAttribute("tabindex");
  }
  const fresh = await (await newContext(browser)).newPage();
  await asReturningVisitor(fresh);
  await fresh.goto("/");
  await expect(fresh.locator("#inspector-panel-statement")).not.toHaveAttribute("tabindex");
  await expect(fresh.locator("#inspector-panel-team")).toHaveAttribute("tabindex", "0");
  await expect(fresh.locator("#inspector-panel-review")).toHaveAttribute("tabindex", "0");
  await fresh.context().close();
  await page.context().close();
});

test("the export offers the ask history on the JSON row only, ticked", async ({ browser }) => {
  const page = await leadWithReply(browser);
  await page.getByRole("tab", { name: "Statement" }).click();
  await page.getByRole("button", { name: "Export data" }).click();
  const answers = page.getByRole("checkbox", { name: "Include co-author answers and ask history (1)" });
  await expect(answers).toBeChecked();
  const rows = page.getByRole("list", { name: "Export format" }).getByRole("listitem");
  await expect(rows.filter({ has: answers })).toContainText("JSON");
  await expect(page.getByRole("checkbox")).toHaveCount(1);
  await page.context().close();
});
