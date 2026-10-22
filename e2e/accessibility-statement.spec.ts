import { expect, test } from "@playwright/test";
import { asReturningVisitor, scan } from "./helpers";

/**
 * Guards docs/accessibility.md as the site renders it at /accessibility. The
 * statement's value is that it claims no more than the repo can show, so these
 * fail when it overclaims, loses its contact, or goes a year without review.
 */

// The W3C conformance terms the statement may use. "Fully conformant" needs a full audit.
const ALLOWED_STATUS = /\b(not assessed|partially conformant|non-conformant)\b/i;
const SECTIONS = [
  "Using CRediT Matrix",
  "How accessible CRediT Matrix is",
  "Known problems",
  "Tell us about a problem",
  "How we check",
  "Tested with",
  "About this statement",
];
// A yearly review plus a month's grace.
const MAX_REVIEW_AGE_DAYS = 400;
const DAY_MS = 86_400_000;

test.describe("Accessibility statement", () => {
  test.beforeEach(async ({ page }) => {
    await asReturningVisitor(page);
  });

  test("renders its sections, claims no more than was checked, and passes axe", async ({ page }) => {
    await page.goto("/accessibility");
    await expect(page).toHaveTitle(/Accessibility statement/);
    const statement = page.locator("article");
    await expect(statement.getByRole("heading", { name: "Accessibility statement", exact: true })).toBeVisible();
    await expect(statement.getByRole("heading", { level: 3 })).toHaveText(SECTIONS);

    await expect(statement.getByText(ALLOWED_STATUS).first()).toBeVisible();
    await expect(statement).not.toContainText(/fully conformant/i);

    // Email first: a GitHub account must never be the only way to report a barrier.
    await expect(statement.getByRole("link", { name: /@/ }).first()).toHaveAttribute("href", /^mailto:.+@.+/);
    await expect(statement).toContainText("within 10 working days");

    expect((await scan(page)).violations).toEqual([]);
  });

  test("was reviewed in the last 400 days", async ({ page }) => {
    await page.goto("/accessibility");
    const line = await page
      .locator("article")
      .getByText(/^Last reviewed:/)
      .textContent();
    const reviewed = new Date((line ?? "").replace(/^Last reviewed:\s*/, ""));
    expect(Number.isNaN(reviewed.getTime()), `unreadable date in "${line}"`).toBe(false);
    expect((Date.now() - reviewed.getTime()) / DAY_MS).toBeLessThan(MAX_REVIEW_AGE_DAYS);
  });

  test("the About panel links to it", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "About this app" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Accessibility statement" }).click();
    await expect(page).toHaveURL(/\/accessibility\/?$/);
    await expect(page.getByRole("heading", { name: "Accessibility statement", exact: true })).toBeVisible();
  });
});
