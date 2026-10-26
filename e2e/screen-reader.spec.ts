// biome-ignore lint/correctness/noNodejsModules: Playwright tests run in Node.
import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { asReturningVisitor, copyFrom, elementBundleBuilt, openElementHost } from "./helpers";

/**
 * What a screen reader is given: the accessibility tree of each surface, read as
 * Playwright's aria snapshots, and the messages that reach a live region. This is
 * not a screen reader; it checks the names, roles, states and structure one would
 * read out. Templates match partially, so they list what must be there, in order.
 */

type Announcement = { text: string; inserted: boolean };

/**
 * Log every text a live region gets. `inserted` marks a region that arrived with
 * its text already in it: screen readers watch regions that exist, and many miss
 * a status that is added together with its message.
 */
function recordAnnouncements(page: Page) {
  return page.addInitScript(() => {
    const log: Announcement[] = [];
    const known = new WeakMap<Element, string>();
    const sweep = () => {
      for (const region of document.querySelectorAll("[aria-live], [role=status], [role=alert], [role=log]")) {
        const text = (region.textContent ?? "").replace(/\s+/g, " ").trim();
        const before = known.get(region);
        known.set(region, text);
        if (text && text !== before) log.push({ text, inserted: before === undefined });
      }
    };
    (window as unknown as { announcements: Announcement[] }).announcements = log;
    new MutationObserver(sweep).observe(document, { subtree: true, childList: true, characterData: true });
  });
}

/**
 * A clipboard kept in the page. Firefox and WebKit have no clipboard permissions
 * to grant, so copyFrom() could not read the real one there.
 */
function memoryClipboard(page: Page) {
  return page.addInitScript(() => {
    let text = "";
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: (value: string) => {
          text = value;
          return Promise.resolve();
        },
        readText: () => Promise.resolve(text),
      },
    });
  });
}

const announcements = (page: Page) =>
  page.evaluate(() => (window as unknown as { announcements: Announcement[] }).announcements);

async function loadSample(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Load sample data" }).click();
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);
}

test.describe("screen-reader view (accessibility tree)", () => {
  test.beforeEach(async ({ page }) => {
    await asReturningVisitor(page);
  });

  test("workspace: landmarks, roster, grid and statement", async ({ page }) => {
    await loadSample(page);
    await expect(page.locator("body")).toMatchAriaSnapshot(`
      - link "Skip to content"
      - link "Skip to grid"
      - link "Skip to statement"
      - banner:
        - heading "CRediT Matrix" [level=1]
        - navigation:
          - button "How it works"
          - link "CRediT census"
          - button "About this app"
        - button "Language settings"
        - button /Drafts:/
        - button "Share a link containing all contributor data"
        - button "Import"
      - main:
        - region "Contributors":
          - heading "Contributors · 3" [level=2]
          - list:
            - listitem:
              - button "Reorder Ada Lovelace"
              - textbox "Name or ORCID iD": Ada Lovelace
              - button "Actions for Ada Lovelace"
              - button "Remove Ada Lovelace"
          - textbox "New author names or ORCID iD"
        - region "Contribution grid":
          - heading "Contributions" [level=2]
          - radiogroup "Role assignment mode":
            - radio "Levels" [checked]
          - button "Bulk assign"
          - button "Heatmap options"
          - button "Heatmap"
          - table "Contributions"
        - region "Statement, team, review and published practice":
          - tablist:
            - tab "Statement" [selected]
            - tab "Team"
            - tab "Review"
            - tab "Published practice"
          - tabpanel "Statement":
            - radiogroup "Statement grouping"
            - status: Ready to export
            - region "Generated statement":
              - paragraph: /^CRediT. Ada Lovelace. Conceptualization/
            - button "Copy statement"
            - button "Export data"
    `);
    // A roster row says the name once: the initials badge beside it is decoration.
    await expect(page.getByRole("region", { name: "Contributors" }).getByRole("listitem").first()).toMatchAriaSnapshot(`
      - listitem:
        - /children: equal
        - button "Reorder Ada Lovelace"
        - textbox "Name or ORCID iD": Ada Lovelace
        - button "Author"
        - button "Actions for Ada Lovelace"
        - button "Remove Ada Lovelace"
    `);
  });

  test("grid: headers name each cell, and a filled cell reads its level", async ({ page }) => {
    await loadSample(page);
    const grid = page.getByRole("table", { name: "Contributions" });
    await expect(grid).toMatchAriaSnapshot(`
      - table "Contributions":
        - rowgroup:
          - row:
            - columnheader "Role"
            - columnheader "Ada Lovelace Not asked yet":
              - img "Not asked yet"
            - columnheader "Rosalind E. Franklin Not asked yet"
            - columnheader "Alan M. Turing Not asked yet"
        - rowgroup:
          - row:
            - rowheader "Conceptualization":
              - button "Conceptualization"
            - 'cell "Conceptualization for Ada Lovelace: Lead"':
              - 'button "Conceptualization for Ada Lovelace: Lead"'
            - 'cell "Conceptualization for Rosalind E. Franklin: None"'
    `);
    await page.getByRole("button", { name: "Validation for Ada Lovelace: None" }).click();
    await expect(grid.getByRole("button", { name: "Validation for Ada Lovelace: Supporting" })).toBeFocused();
  });

  test("popovers are named dialogs that report their opener as expanded", async ({ page }) => {
    await loadSample(page);
    const cases: [string, string][] = [
      [
        "Share a link containing all contributor data",
        `
        - dialog "Share":
          - paragraph: This link carries your data
          - button "Copy data link"
        `,
      ],
      [
        "Export data",
        `
        - dialog "Export data":
          - list "Export format":
            - listitem:
              - text: XML (JATS4R)
              - button "Copy XML (JATS4R)"
              - button "Download XML (JATS4R)"
        `,
      ],
      [
        "Heatmap",
        `
        - dialog "Heatmap":
          - button "Copy PNG"
          - button "Download SVG"
          - button "Download PNG"
        `,
      ],
      [
        "Heatmap options",
        `
        - dialog "Heatmap options":
          - button "Heatmap color"
          - button "Transpose"
          - switch "Use initials instead of names"
        `,
      ],
      [
        "Language settings",
        `
        - dialog "Language settings":
          - combobox "Interface language": English
          - combobox "Output language": English
        `,
      ],
      [
        "Bulk assign",
        `
        - dialog "Bulk assign":
          - combobox "Level to assign"
          - group "One contributor":
            - combobox "Contributor for bulk assignment"
            - button "Assign every role"
          - group "One role":
            - combobox "Role for bulk assignment"
            - button "Assign to everyone"
        `,
      ],
      [
        "About this app",
        `
        - dialog "About this app":
          - link "About, citing and privacy"
          - link "Accessibility statement"
          - link "Source code on GitHub (opens in new tab)"
        `,
      ],
      [
        "Actions for Rosalind E. Franklin",
        `
        - dialog "Actions for Rosalind E. Franklin":
          - button "Move up"
          - button "Move down"
          - button "Ask Rosalind E. Franklin what they did"
          - button "Ask Rosalind E. Franklin to check your guess"
        `,
      ],
    ];
    for (const [opener, template] of cases) {
      const button = page.getByRole("button", { name: opener, exact: true });
      await button.click();
      await expect(button, opener).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("dialog"), opener).toMatchAriaSnapshot(template);
      await page.keyboard.press("Escape");
      await expect(button, opener).toBeFocused();
    }
  });

  test("import dialog: every field has its label", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Import" }).click();
    await expect(page.getByRole("dialog")).toMatchAriaSnapshot(`
      - dialog "Import contributors":
        - heading "Import contributors" [level=2]
        - button "Close"
        - textbox "Import from a DOI"
        - button "Look up" [disabled]
        - button "Browse files"
        - status
        - textbox "Paste raw data"
        - button "Cancel"
        - button "Import data" [disabled]
    `);
  });

  test("team tab: each person is read once, with their state", async ({ page }) => {
    await loadSample(page);
    await page.getByRole("tab", { name: "Team" }).click();
    await expect(page.getByRole("tabpanel", { name: "Team" })).toMatchAriaSnapshot(`
      - tabpanel "Team":
        - button "Ask everyone not yet asked (3)"
        - list:
          - listitem:
            - text: Ada Lovelace Not asked yet
            - button "Copy message for Ada Lovelace"
    `);
  });

  test("co-author page: a heading per role and a named group of levels", async ({ page, browser }) => {
    await memoryClipboard(page);
    await loadSample(page);
    await page.getByRole("button", { name: "Actions for Rosalind E. Franklin" }).click();
    const askUrl = await copyFrom(
      page,
      page.getByRole("button", { name: "Ask Rosalind E. Franklin to check your guess" }),
    );
    const coauthorContext = await browser.newContext();
    const coauthor = await coauthorContext.newPage();
    await coauthor.goto(askUrl);
    await expect(coauthor.getByRole("main")).toMatchAriaSnapshot(`
      - main:
        - button "Language settings"
        - heading "What did you do on this paper?" [level=1]
        - list "Your roles":
          - listitem:
            - heading "Conceptualization" [level=2]
            - radiogroup "Conceptualization":
              - radio "None" [checked]
              - radio "Supporting"
              - radio "Equal"
              - radio "Lead"
          - listitem:
            - heading "Data curation" [level=2]
            - radiogroup "Data curation":
              - radio "Lead" [checked]
        - switch "I share first authorship"
        - switch "I am a corresponding author"
        - button "Send back"
    `);
    await coauthorContext.close();
  });

  test("census: charts have text alternatives and the method section is a region", async ({ page }) => {
    await page.goto("/census");
    const article = page.getByRole("article");
    await expect(article).toMatchAriaSnapshot(`
      - article:
        - link "Back to CRediT Matrix"
        - heading "CRediT census" [level=2]
        - complementary "Preliminary figures"
        - heading "Adoption over time" [level=3]
        - paragraph: /^\\d+% in \\d{4} and \\d+% in \\d{4}/
        - img "Adoption over time"
        - heading "Roles per author" [level=4]
        - img "Roles per author"
        - group: Show as a table
        - heading "How roles are marked up" [level=3]
        - figure /^JATS4R role tags/:
          - paragraph: /in \\d{4}/
          - img "JATS4R role tags"
        - heading "By field" [level=3]
        - list
        - heading "By publisher" [level=3]
        - list
        - heading "Roles by place in the byline" [level=3]
        - region "Roles by place in the byline":
          - table:
            - rowgroup:
              - row:
                - columnheader "Role"
                - columnheader "All authors"
        - region "How the census reads statements":
          - heading "How the census reads statements" [level=3]
          - paragraph:
            - link "The census code (opens in new tab)"
            - link "The model card (opens in new tab)"
        - heading "About these data" [level=3]
        - paragraph:
          - link "Download the counts (JSON)"
    `);
    // The chart drawings stay out of the reading order; the summary and the table carry the numbers.
    await article.getByText("Show as a table").first().click();
    await expect(article.getByRole("table").first()).toBeVisible();
    await expect(article.getByRole("table").first().getByRole("columnheader").first()).not.toBeEmpty();
  });

  test("about and accessibility pages: one main, headings in order", async ({ page }) => {
    await page.goto("/about");
    await expect(page.locator("body")).toMatchAriaSnapshot(`
      - link "Skip to content"
      - banner:
        - heading "CRediT Matrix" [level=1]
        - navigation
      - main:
        - link "Back to CRediT Matrix"
        - article:
          - heading "About CRediT Matrix" [level=2]
          - term: Version
          - heading "Cite CRediT Matrix" [level=3]
          - heading "Acknowledgements" [level=3]
          - heading "Privacy" [level=3]
          - heading "Accessibility" [level=3]
          - paragraph:
            - link "accessibility statement"
    `);
    await page.goto("/accessibility");
    await expect(page.getByRole("article")).toMatchAriaSnapshot(`
      - article:
        - heading "Accessibility statement" [level=2]
        - heading "Using CRediT Matrix" [level=3]
        - heading "How accessible CRediT Matrix is" [level=3]
        - heading "Known problems" [level=3]
        - heading "Content we don't control" [level=4]
        - heading "Tell us about a problem" [level=3]
        - heading "How we check" [level=3]
        - heading "Heatmap text alternatives" [level=4]
        - heading "The web element" [level=4]
        - heading "Tested with" [level=3]
        - heading "About this statement" [level=3]
    `);
  });

  test("web element: a table in the page language stands in for the drawing", async ({ page }) => {
    test.skip(!elementBundleBuilt(), "Build the package first: pnpm --filter credit-matrix build");
    await openElementHost(page);
    await expect(page.locator("credit-matrix")).toMatchAriaSnapshot(`
      - figure:
        - table "Beitragsheatmap":
          - rowgroup:
            - row:
              - columnheader "José Ángel Muñoz Pérez"
          - rowgroup:
            - row "Konzeptualisierung Führend Keine Keine Keine Keine":
              - rowheader "Konzeptualisierung"
              - cell "Führend"
        - paragraph: /^CRediT. José Ángel Muñoz Pérez. Konzeptualisierung/
    `);
  });
});

test.describe("screen-reader view (live announcements)", () => {
  test.beforeEach(async ({ page }) => {
    await memoryClipboard(page);
    await recordAnnouncements(page);
    await asReturningVisitor(page);
  });

  test("a grid change is announced once, without the statement counts", async ({ page }) => {
    await loadSample(page);
    const from = (await announcements(page)).length;
    await page.getByRole("button", { name: "Validation for Ada Lovelace: None" }).click();
    await expect
      .poll(async () => (await announcements(page)).slice(from).map((a) => a.text))
      .toEqual(["Validation for Ada Lovelace: Supporting"]);
    await page.waitForTimeout(300);
    expect((await announcements(page)).slice(from).map((a) => a.text)).toEqual([
      "Validation for Ada Lovelace: Supporting",
    ]);
  });

  test("removing a contributor is announced once, in a region that was already there", async ({ page }) => {
    await loadSample(page);
    const from = (await announcements(page)).length;
    await page.getByRole("button", { name: "Remove Ada Lovelace" }).click();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await page.waitForTimeout(300);
    const said = (await announcements(page)).slice(from).filter((a) => a.text.includes("Removed Ada Lovelace"));
    expect(said).toEqual([{ text: "Removed Ada Lovelace", inserted: false }]);
  });

  test("a bulk change is announced once", async ({ page }) => {
    await loadSample(page);
    const from = (await announcements(page)).length;
    await page.getByRole("button", { name: "Bulk assign" }).click();
    await page.getByRole("button", { name: "Assign every role", exact: true }).click();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await page.waitForTimeout(300);
    const said = (await announcements(page)).slice(from).filter((a) => a.text.includes("Bulk change applied."));
    expect(said).toEqual([{ text: "Bulk change applied.", inserted: false }]);
  });

  test("copying the statement and picking an import file are announced", async ({ page }) => {
    await loadSample(page);
    await copyFrom(page, page.getByRole("button", { name: "Copy statement" }));
    await expect
      .poll(async () => (await announcements(page)).map((a) => a.text))
      .toContain("Statement copied to clipboard");

    await page.getByRole("button", { name: "Import" }).click();
    await page
      .locator("input[type=file]")
      .setInputFiles({ name: "team.csv", mimeType: "text/csv", buffer: Buffer.from("name\nJane Smith\n") });
    await expect
      .poll(async () => (await announcements(page)).filter((a) => !a.inserted).map((a) => a.text))
      .toContainEqual(expect.stringContaining("team.csv"));
  });
});

/** The text of a PNG's uncompressed iTXt chunk with this keyword, or null. */
function pngText(png: Buffer, keyword: string): string | null {
  for (let at = 8; at + 8 <= png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + length);
    if (type === "iTXt" && data.toString("latin1", 0, keyword.length + 1) === `${keyword}\0`) {
      // keyword NUL, compression flag, method, language tag NUL, translated keyword NUL, text.
      let rest = keyword.length + 3;
      rest = data.indexOf(0, rest) + 1;
      rest = data.indexOf(0, rest) + 1;
      return data.toString("utf8", rest);
    }
    at += 12 + length;
  }
  return null;
}

test.describe("downloaded heatmap", () => {
  test.beforeEach(async ({ page }) => {
    await asReturningVisitor(page);
  });

  test("the PNG and the SVG carry the contribution statement as their description", async ({ page }) => {
    await loadSample(page);
    const save = async (name: string) => {
      await page.getByRole("button", { name: "Heatmap", exact: true }).click();
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name }).click();
      const file = await (await download).path();
      await page.keyboard.press("Escape");
      return readFile(file);
    };
    const statement = /^CRediT: Ada Lovelace: Conceptualization.*Alan M\. Turing: Funding acquisition/s;

    const svg = (await save("Download SVG")).toString("utf8");
    const desc = await page.evaluate((markup) => {
      const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
      return doc.querySelector("svg > desc")?.textContent ?? null;
    }, svg);
    expect(desc).toMatch(statement);

    const png = await save("Download PNG");
    expect(pngText(png, "Description")).toBe(desc);
  });
});
