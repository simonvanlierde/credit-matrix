import { expect, type Page, test } from "@playwright/test";
import { asReturningVisitor } from "./helpers";

const ORCID = "0000-0002-1825-0097";
const PERSON_URL = `https://pub.orcid.org/v3.0/${ORCID}/person`;
const PERSON = { name: { "given-names": { value: "Jane A." }, "family-name": { value: "Smith" } } };

const addField = (page: Page) => page.getByLabel("New author names or ORCID iD");
const nameField = (page: Page) => page.getByLabel("Name or ORCID iD", { exact: true });
const statusText = (page: Page) => page.locator(".sr-only[role=status], .sr-only[role=alert]").allTextContents();

async function add(page: Page, text: string) {
  await addField(page).fill(text);
  await addField(page).press("Enter");
}

test.describe("the contributor list", () => {
  test.beforeEach(async ({ page }) => {
    await asReturningVisitor(page);
  });

  test("Escape in a name field discards the edit", async ({ page }) => {
    await page.goto("/");
    await add(page, "Alice Smith");
    await nameField(page).fill("Zed Typo");
    await nameField(page).press("Escape");
    await expect(nameField(page)).toHaveValue("Alice Smith");
    // Leaving the field afterwards must not commit the abandoned text either.
    await addField(page).click();
    await expect(nameField(page)).toHaveValue("Alice Smith");
    await expect(page.getByRole("button", { name: "Remove Alice Smith" })).toBeVisible();
  });

  test("keeps the name typed with an ORCID iD", async ({ page }) => {
    // Any lookup fails, so a name that survives was not fetched.
    await page.route("https://pub.orcid.org/**", (route) => route.abort("failed"));
    await page.goto("/");
    await add(page, `Jane Q. Smith ${ORCID}`);
    await expect(nameField(page)).toHaveValue("Jane Q. Smith");
    await expect(page.getByRole("link", { name: new RegExp(ORCID) })).toBeVisible();
    await expect(addField(page)).toHaveValue("");
  });

  test("an ORCID lookup does not overwrite a name being typed while it ran", async ({ page }) => {
    const { promise: held, resolve: release } = Promise.withResolvers<void>();
    await page.route(PERSON_URL, async (route) => {
      await held;
      await route.fulfill({ status: 200, json: PERSON, headers: { "access-control-allow-origin": "*" } });
    });
    await page.goto("/");
    await add(page, ORCID);
    await expect(nameField(page)).toHaveValue(ORCID);
    await nameField(page).click();
    await nameField(page).press("End");
    await nameField(page).pressSequentially(" typed");

    release();
    // The registry's name reaches the store (the remove button's label) but not the field.
    await expect(page.getByRole("button", { name: "Remove Jane A. Smith" })).toBeVisible();
    await expect(nameField(page)).toBeFocused();
    await expect(nameField(page)).toHaveValue(`${ORCID} typed`);

    await nameField(page).press("Enter");
    await expect(page.getByRole("button", { name: `Remove ${ORCID} typed` })).toBeVisible();
  });

  test("undoing the removal of your own row keeps it marked as you", async ({ page }) => {
    await page.goto("/");
    await add(page, "Alice Smith");
    await page.getByRole("button", { name: "Actions for Alice Smith" }).click();
    await page.getByRole("button", { name: "This is me" }).click();
    await page.keyboard.press("Escape");
    const row = page.getByRole("listitem").filter({ has: nameField(page) });
    await expect(row.getByText("You", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Remove Alice Smith" }).click();
    await page.getByRole("status").filter({ hasText: "Removed Alice Smith" }).getByRole("button").click();
    await expect(row.getByText("You", { exact: true })).toBeVisible();
  });

  test("undoing a removal the grid's Undo already reverted reports no limit", async ({ page }) => {
    await page.goto("/");
    await add(page, "Alice Smith");
    await add(page, "Bob Jones");
    await page.getByRole("button", { name: "Bulk assign" }).click();
    await page.getByRole("button", { name: "Assign every role", exact: true }).click();

    await page.getByRole("button", { name: "Remove Bob Jones" }).click();
    await page.getByRole("status").filter({ hasText: "Bulk change applied." }).getByRole("button").click();
    await expect(page.getByRole("button", { name: "Remove Bob Jones" })).toBeVisible();

    const removedBar = page.getByRole("status").filter({ hasText: "Removed Bob Jones" });
    await removedBar.getByRole("button").click();
    await expect(removedBar).toBeHidden();
    // An announcement reaches the live region on the frame after the click.
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    expect((await statusText(page)).join(" ")).not.toContain("at most 200 contributors");
    await expect(page.getByRole("button", { name: "Remove Bob Jones" })).toHaveCount(1);
  });
});
