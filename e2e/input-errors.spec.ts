import { expect, type Page, test } from "@playwright/test";
import { asReturningVisitor, copyFrom, onScreen } from "./helpers";

const INVALID_ID = /not a valid ORCID iD/;
const NO_LETTER = /doesn't look like a name/;

/** The error a field points to with aria-describedby, as text. */
async function describedBy(page: Page, field: ReturnType<Page["getByLabel"]>) {
  await expect(field).toHaveAttribute("aria-invalid", "true");
  const id = await field.getAttribute("aria-describedby");
  expect(id).toBeTruthy();
  return page.locator(`[id="${id}"]`);
}

async function openOrcidField(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Load sample data" }).click();
  await page
    .getByRole("button", { name: /^Actions for / })
    .first()
    .click();
  await page.getByRole("button", { name: "Add ORCID iD" }).click();
  return page.getByLabel("ORCID iD", { exact: true });
}

test.describe("input errors reach assistive tech", () => {
  test.beforeEach(async ({ page }) => {
    await asReturningVisitor(page);
  });

  test("a partial ORCID iD on Enter is refused with a linked message", async ({ page }) => {
    const field = await openOrcidField(page);
    await field.fill("0000-0001-2345");
    await field.press("Enter");
    await expect(await describedBy(page, field)).toHaveText(INVALID_ID);
    await field.fill("0000-0001-2345-");
    await expect(field).not.toHaveAttribute("aria-invalid", "true");
  });

  test("leaving the ORCID input with text that is not an iD keeps it open with the message", async ({ page }) => {
    const field = await openOrcidField(page);
    await field.fill("garbage");
    await page.getByRole("heading", { name: "Contributors" }).click();
    await expect(field).toBeVisible();
    await expect(await describedBy(page, field)).toHaveText(INVALID_ID);
  });

  test("Escape leaves a refused ORCID input without an error", async ({ page }) => {
    const field = await openOrcidField(page);
    await field.fill("garbage");
    await field.press("Enter");
    const error = await describedBy(page, field);
    await expect(error).toHaveText(INVALID_ID);
    await field.press("Escape");
    await expect(field).toBeHidden();
    await expect(error).toHaveCount(0);
  });

  test("an empty ORCID input still closes quietly", async ({ page }) => {
    const field = await openOrcidField(page);
    await page.getByRole("heading", { name: "Contributors" }).click();
    await expect(field).toBeHidden();
  });

  test("the ORCID checksum error stays until the iD is edited", async ({ page }) => {
    const field = await openOrcidField(page);
    await field.fill("0000-0002-1825-0098");
    await field.press("Enter");
    const error = await describedBy(page, field);
    await expect(error).toHaveText(/invalid checksum/);
    await page.waitForTimeout(4600);
    await expect(error).toBeVisible();
    await field.fill("0000-0002-1825-009");
    await expect(error).toBeHidden();
  });

  test("a name the add field refuses is linked to the field", async ({ page }) => {
    await page.goto("/");
    const add = page.getByLabel("New author names or ORCID iD");
    await add.fill("12345");
    await add.press("Enter");
    await expect(await describedBy(page, add)).toHaveText(NO_LETTER);
    await add.fill("Jane");
    await expect(add).not.toHaveAttribute("aria-invalid", "true");
  });

  test("co-author details: a name that is refused says why", async ({ browser }) => {
    const lead = await (await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] })).newPage();
    await asReturningVisitor(lead);
    await lead.goto("/");
    const add = lead.getByLabel("New author names or ORCID iD");
    await add.fill("Jane Smith, Bob White");
    await add.press("Enter");
    await lead.getByRole("button", { name: "Actions for Bob White" }).click();
    const ask = await copyFrom(lead, lead.getByRole("button", { name: "Ask Bob White what they did" }));

    const page = await (await browser.newContext()).newPage();
    await asReturningVisitor(page);
    await page.goto(ask);
    await page.getByText("Your details").click();
    const name = page.getByLabel("Name", { exact: true });
    await name.fill("12345");
    await name.press("Tab");
    await expect(await describedBy(page, name)).toHaveText(NO_LETTER);
    await name.fill("");
    await name.press("Tab");
    await expect(await describedBy(page, name)).toHaveText(NO_LETTER);
    await name.fill("Bob B. White");
    await name.press("Tab");
    await expect(name).not.toHaveAttribute("aria-invalid", "true");
    await expect(onScreen(page, NO_LETTER)).toBeHidden();
  });

  test("the import dialog reports the loaded file and the detected format in a live region", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Import" }).click();
    await page.locator("input[type=file]").setInputFiles({
      name: "authors.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("name,orcid\nJane Smith,\nBob White,\n"),
    });
    const status = page.getByRole("status").filter({ hasText: "Loaded from authors.csv" });
    await expect(status).toBeVisible();
    await expect(status).toContainText("Detected: CSV");
  });
});
