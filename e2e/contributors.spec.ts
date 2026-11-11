import { expect, type Page, test } from "@playwright/test";
import { asReturningVisitor, seedStorage } from "./helpers";

const ORCID = "0000-0002-1825-0097";
const PERSON_URL = `https://pub.orcid.org/v3.0/${ORCID}/person`;
const PERSON = { name: { "given-names": { value: "Grace B." }, "family-name": { value: "Hopper" } } };

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
    await expect(page.getByRole("button", { name: "Remove Grace B. Hopper" })).toBeVisible();
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
    await page.getByRole("group", { name: "Removed Alice Smith" }).getByRole("button").click();
    await expect(row.getByText("You", { exact: true })).toBeVisible();
  });

  test("undoing a removal the grid's Undo already reverted reports no limit", async ({ page }) => {
    await page.goto("/");
    await add(page, "Alice Smith");
    await add(page, "Bob Jones");
    await page.getByRole("button", { name: "Bulk assign" }).click();
    await page.getByRole("button", { name: "Assign every role", exact: true }).click();

    await page.getByRole("button", { name: "Remove Bob Jones" }).click();
    await page.getByRole("group", { name: "Bulk change applied." }).getByRole("button").click();
    await expect(page.getByRole("button", { name: "Remove Bob Jones" })).toBeVisible();

    const removedBar = page.getByRole("group", { name: "Removed Bob Jones" });
    await removedBar.getByRole("button").click();
    await expect(removedBar).toBeHidden();
    // An announcement reaches the live region on the frame after the click.
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    expect((await statusText(page)).join(" ")).not.toContain("at most 420 contributors");
    await expect(page.getByRole("button", { name: "Remove Bob Jones" })).toHaveCount(1);
  });
});

test.describe("the first step", () => {
  test("Start fresh lands in the add field, right under the empty-state line", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Start fresh" }).click();
    await expect(addField(page)).toBeFocused();
    const hint = await page.getByText("No contributors yet.").boundingBox();
    const field = await addField(page).boundingBox();
    if (!hint || !field) throw new Error("expected the hint and the field on screen");
    // "below" in the hint means the next thing down, not the bottom of the rail.
    expect(field.y - (hint.y + hint.height)).toBeLessThan(120);
  });

  test("the add field stays at the foot of a filled list", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await asReturningVisitor(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    const last = await page
      .getByRole("button", { name: /^Remove / })
      .last()
      .boundingBox();
    const field = await addField(page).boundingBox();
    expect((field?.y ?? 0) - (last?.y ?? 0)).toBeGreaterThan(300);
  });

  test("an empty Add button mutes its text and outline instead of fading", async ({ page }) => {
    await asReturningVisitor(page);
    await page.goto("/");
    const button = page.getByRole("button", { name: "Add", exact: true });
    await expect(button).toBeDisabled();
    expect(await button.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  });

  for (const locale of ["en", "fr", "de", "es", "it", "pt-PT", "nl", "zh-Hans", "ja"]) {
    test(`the add field's placeholder fits the rail in ${locale}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await seedStorage(page, { authors: [], welcomeSeen: true, uiLocale: locale });
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      const input = page.locator("#add-contributor");
      await expect(input).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const overflow = await input.evaluate((el: HTMLInputElement) => {
        const style = getComputedStyle(el);
        const context = document.createElement("canvas").getContext("2d");
        if (!context) throw new Error("no canvas");
        context.font = style.font;
        const room = el.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
        return context.measureText(el.placeholder).width - room;
      });
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

test("on a phone, the list folds into a row of initials that still open each person's menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await asReturningVisitor(page);
  await page.goto("/");
  await add(page, "Ada Lovelace, Alan Turing");
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(2);

  await page.getByRole("button", { name: "Collapse contributor list" }).click();
  await expect(addField(page)).toBeHidden();
  const chip = page.getByRole("button", { name: "Alan Turing", exact: true });
  await chip.click();
  await expect(page.getByRole("dialog", { name: "Actions for Alan Turing" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Expand contributor list" }).click();
  await expect(addField(page)).toBeVisible();
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("keeps the add button inside the name field", async ({ page }) => {
    await asReturningVisitor(page);
    await page.goto("/");
    const field = await addField(page).boundingBox();
    const button = await page.getByRole("button", { name: "Add", exact: true }).boundingBox();
    if (!(field && button)) throw new Error("Expected the field and its button");
    expect(button.x).toBeGreaterThanOrEqual(field.x);
    expect(button.x + button.width).toBeLessThanOrEqual(field.x + field.width);
    expect(button.y).toBeGreaterThanOrEqual(field.y);
    expect(button.y + button.height).toBeLessThanOrEqual(field.y + field.height);
  });
});
