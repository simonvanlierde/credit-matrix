// biome-ignore lint/correctness/noNodejsModules: Playwright tests run in Node.
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { PERSIST_KEY } from "../src/store/persist-meta";
import { asReturningVisitor, copyFrom, onScreen, seedStorage } from "./helpers";

test.describe("Happy path UI flows", () => {
  test.beforeEach(async ({ page }) => {
    await asReturningVisitor(page);
  });

  test("the first-run welcome opens as a modal and dismisses to the workspace", async ({ page }) => {
    // Opt back out of the returning-visitor seed: this is the first-run path.
    await page.addInitScript((key) => window.localStorage.removeItem(key), PERSIST_KEY);
    await page.goto("/");

    const welcome = page.locator("dialog#getting-started");
    await expect(welcome).toBeVisible();
    // A modal, so focus is inside it and the workspace behind it is inert.
    await expect(welcome).toHaveJSProperty("open", true);
    await expect(page.locator("dialog#getting-started :focus")).toBeAttached();

    await page.getByRole("button", { name: "Load sample data" }).click();
    await expect(welcome).toBeHidden();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);

    // Re-opening from the header never re-offers a data-replacing action.
    await page.getByRole("button", { name: "How it works" }).click();
    await expect(welcome).toBeVisible();
    await expect(page.getByRole("button", { name: "Load sample data" })).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(welcome).toBeHidden();
  });

  test("Load sample data populates contributors and the heatmap", async ({ page }) => {
    await page.goto("/");

    // First-run empty state offers a sample dataset.
    await page.getByRole("button", { name: "Load sample data" }).click();

    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);
    await expect(page.getByLabel("Name or ORCID iD", { exact: true }).first()).toHaveValue("Ada Lovelace");

    // The sample's scores are graded, so it opens in Levels; switching to
    // Yes / no collapses them to plain Contributed toggles.
    const cell = page.getByRole("button", { name: "Conceptualization for Ada Lovelace: Lead" });
    await expect(cell).toBeVisible();
    await expect(cell.locator("svg")).toBeVisible();
    await expect(page.getByText("Ready to export", { exact: true })).toBeVisible();
    await page.getByRole("radio", { name: "Yes / no" }).click();
    const toggled = page.getByRole("button", { name: "Conceptualization for Ada Lovelace: Contributed" });
    await expect(toggled).toHaveAttribute("aria-pressed", "true");

    // A statement is generated from the sample contributions.
    await expect(page.getByText(/^CRediT:/)).toBeVisible();
  });

  test("Clicking a grid cell toggles the contribution into the statement", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    // The sample opens in Levels; this test is about the yes/no toggle.
    await page.getByRole("radio", { name: "Yes / no" }).click();

    // Ada has no Data curation in the sample; one click assigns it.
    const cell = page.getByRole("button", { name: /^Data curation for Ada Lovelace:/ });
    await expect(cell).toHaveAttribute("aria-pressed", "false");
    await cell.click();
    await expect(cell).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/^CRediT:/)).toContainText("Data curation");
  });

  test("undoes contributor removal and confirms destructive imports", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();

    await page.getByRole("button", { name: "Remove Ada Lovelace" }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(2);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);

    await page.getByRole("button", { name: "Import" }).click();
    await page.locator("#import-text").fill("Marie Curie");
    await page.getByRole("button", { name: "Import data" }).click();
    await expect(page.getByText("Replace the current workspace?", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Replace workspace" }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(1);
    await expect(page.getByLabel("Name or ORCID iD", { exact: true })).toHaveValue("Marie Curie");
  });

  test("Import names and see the heatmap", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Import" }).click();

    const textarea = page.locator("#import-text");
    await textarea.waitFor({ state: "visible" });
    await textarea.fill("Jane Smith\nBob White");

    await page.getByRole("button", { name: "Import data" }).click();

    // The contributor name is rendered in an editable input.
    await expect(page.getByLabel("Name or ORCID iD", { exact: true }).first()).toHaveValue("Jane Smith");
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(2);
    // The grid renders an (unassigned) cell for the imported contributor.
    await expect(page.getByRole("button", { name: /^Conceptualization for Jane Smith:/ })).toBeVisible();

    // Imported names have no roles yet → a validation notice appears.
    // .first(): several imported contributors are noticed at once; onScreen
    // already excludes the live-region duplicate.
    await expect(onScreen(page, /has no assigned CRediT roles/).first()).toBeVisible();
  });

  test("imports the contributor list from a DOI", async ({ page }) => {
    // Stub the proxy: what is under test is the modal wiring, not Crossref.
    await page.route("**/api/doi", (route) =>
      route.fulfill({
        json: {
          ok: true,
          title: "A study of studies",
          authors: [{ name: "Jane A. Smith", orcid: "0000-0002-1825-0097" }, { name: "Bob White" }],
        },
      }),
    );
    await page.goto("/");

    await page.getByRole("button", { name: "Import" }).click();
    await page.locator("#import-doi").fill("10.1038/s41586-020-2649-2");
    await page.getByRole("button", { name: "Look up" }).click();

    const names = page.getByLabel("Name or ORCID iD", { exact: true });
    await expect(names).toHaveCount(2);
    await expect(names.first()).toHaveValue("Jane A. Smith");
    // The iD rides along with the name: that is half the point of the lookup.
    // A stored iD renders as a link to the registry, not as an input.
    await expect(page.getByRole("link", { name: /0000-0002-1825-0097/ })).toHaveAttribute(
      "href",
      "https://orcid.org/0000-0002-1825-0097",
    );
  });

  test("explains a DOI that resolves to nothing, and keeps the dialog open", async ({ page }) => {
    await page.route("**/api/doi", (route) =>
      route.fulfill({ status: 404, json: { code: "NOT_FOUND", error: "No published record matches that DOI." } }),
    );
    await page.goto("/");

    await page.getByRole("button", { name: "Import" }).click();
    await page.locator("#import-doi").fill("10.1038/nope");
    await page.getByRole("button", { name: "Look up" }).click();

    // Scoped to the dialog: the same message is also announced in a live region.
    await expect(page.getByRole("dialog").getByText("No published record matches that DOI.")).toBeVisible();
    // The dialog stays up so the DOI can be corrected in place.
    await expect(page.locator("#import-doi")).toBeVisible();
  });

  test("imports surname-first notation as one correctly structured contributor", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Import" }).click();
    await page.locator("#import-text").fill("Curie, Marie");
    await page.getByRole("button", { name: "Import data" }).click();

    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(1);
    await expect(page.getByLabel("Name or ORCID iD", { exact: true })).toHaveValue("Curie, Marie");
  });

  for (const [format, payload, expectedName] of [
    ["CSV", "Name,ORCID,Type\nJane Smith,,author", "Jane Smith"],
    [
      "JSON",
      JSON.stringify({
        version: 1,
        authors: [
          {
            id: "json-author",
            name: "Bob White",
            firstName: "Bob",
            middleName: "",
            surname: "White",
            initials: "BW",
            contributorType: "author",
            contributions: [],
          },
        ],
      }),
      "Bob White",
    ],
    [
      "XML",
      // biome-ignore lint/security/noSecrets: inline XML fixture contains no credential.
      '<article><contrib-group><contrib contrib-type="contributor"><name><surname>Davis</surname><given-names>Carol</given-names></name></contrib></contrib-group></article>',
      "Carol Davis",
    ],
  ] as const) {
    test(`imports structured ${format} through the modal`, async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Import" }).click();
      await page.locator("#import-text").fill(payload);
      await expect(
        page.getByText(`Detected: ${format === "XML" ? "JATS4R XML" : format === "JSON" ? "JSON export" : "CSV"}`),
      ).toBeVisible();
      await page.getByRole("button", { name: "Import data" }).click();
      await expect(page.getByLabel("Name or ORCID iD", { exact: true })).toHaveValue(expectedName);
    });
  }

  test("keeps malformed structured imports visible and leaves state unchanged", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Import" }).click();
    await page.locator("#import-text").fill("<a><b>");
    await page.getByRole("button", { name: "Import data" }).click();

    // The parser's own English text is no longer surfaced: the dialog reports a
    // localized failure instead, so this asserts the message people actually see.
    await expect(
      page.locator("dialog").getByText("Could not import those contributors.", { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
    await expect(page.locator("#import-text")).toBeVisible();
  });

  test("keeps a malformed XML file's error visible after import", async ({ page }) => {
    // Unlike the paste path above, a file goes through the browser's real
    // DOMParser via the file input, so this is the one place the <parsererror>
    // branch in xml-import.ts actually runs (linkedom does not emit it).
    await page.goto("/");
    await page.getByRole("button", { name: "Import" }).click();
    await page.getByLabel("Upload CSV, JSON, or XML file").setInputFiles({
      name: "contributors.xml",
      mimeType: "application/xml",
      buffer: Buffer.from("<a><b>"),
    });
    await page.getByRole("button", { name: "Import data" }).click();

    await expect(
      page.locator("dialog").getByText("Could not import those contributors.", { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
  });

  test("Adding a comma-separated author list creates one row per name", async ({ page }) => {
    await page.goto("/");

    const input = page.getByLabel("New author names or ORCID iD");
    await input.fill("Jane Smith, Bob White, Carol Davis");
    await input.press("Enter");

    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);
    // A single "Lastname, Firstname" entry is not split.
    await input.fill("Curie, Marie");
    await input.press("Enter");
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(4);
    await expect(page.getByLabel("Name or ORCID iD", { exact: true }).last()).toHaveValue("Curie, Marie");
  });

  test("Share link round-trips the state through the URL", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);

    await page.getByRole("button", { name: "Share" }).click();
    await expect(page.getByText("Anyone with this link can read every contributor name")).toBeVisible();
    const shareUrl = await copyFrom(page, page.getByRole("button", { name: "Copy data link" }));
    expect(shareUrl).toContain("#s=");

    // Open the link in a fresh page (clears local storage) and confirm the state loads.
    const fresh = await context.newPage();
    await fresh.addInitScript(() => window.localStorage.clear());
    await fresh.goto(shareUrl);
    await expect(fresh.getByRole("button", { name: /^Remove / })).toHaveCount(3);
    await expect(fresh.getByLabel("Name or ORCID iD", { exact: true }).first()).toHaveValue("Ada Lovelace");
    // The share hash is cleared after loading.
    expect(new URL(fresh.url()).hash).toBe("");
  });

  test("collects one co-author's roles through a claimed link", async ({ page, context, browser }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);

    // Ask the second contributor (Rosalind E. Franklin) to fill in their own row.
    await page.getByRole("button", { name: "Actions for Rosalind E. Franklin" }).click();
    const askUrl = await copyFrom(page, page.getByRole("button", { name: "Ask Rosalind E. Franklin to fill this in" }));
    // Everything the link carries — whose row, which draft — rides inside the
    // payload now; the URL is nothing but the fragment.
    expect(askUrl).toContain("#s=");
    expect(new URL(askUrl).search).toBe("");

    // She opens it in her own browser: a separate context, so her storage is
    // hers alone and the originator can navigate without inheriting it.
    const coauthorContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
    const coauthor = await coauthorContext.newPage();
    await coauthor.goto(askUrl);
    await expect(onScreen(coauthor, "You are filling in Rosalind E. Franklin's contributions")).toBeVisible();

    // She assigns herself a role. The link carries only her row, so no one
    // else's is there to change.
    await coauthor.getByRole("button", { name: /^Validation for Rosalind E\. Franklin:/ }).click();
    await expect(coauthor.getByRole("button", { name: /^Validation for Ada Lovelace:/ })).toHaveCount(0);

    const returnedUrl = await copyFrom(coauthor, coauthor.getByRole("button", { name: "Copy the link to send back" }));
    await coauthorContext.close();

    // The originator just opens what she sent — no Import knowledge required.
    await page.goto(returnedUrl);
    await expect(onScreen(page, /Rosalind E\. Franklin's roles were filled in/)).toBeVisible();

    // Her row lands; her opinion about Ada's row does not.
    await expect(page.getByRole("button", { name: "Validation for Rosalind E. Franklin: Lead" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Validation for Ada Lovelace: None" })).toBeVisible();
  });

  // The link is also just text, so pasting it into Import has to work for
  // anyone who reaches for that instead of the address bar.
  test("accepts a co-author's reply pasted into the Import dialog", async ({ page, context, browser }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);

    await page.getByRole("button", { name: "Actions for Rosalind E. Franklin" }).click();
    const askUrl = await copyFrom(page, page.getByRole("button", { name: "Ask Rosalind E. Franklin to fill this in" }));

    const coauthorContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
    const coauthor = await coauthorContext.newPage();
    await coauthor.goto(askUrl);
    await coauthor.getByRole("button", { name: /^Validation for Rosalind E\. Franklin:/ }).click();
    const returnedUrl = await copyFrom(coauthor, coauthor.getByRole("button", { name: "Copy the link to send back" }));
    await coauthorContext.close();

    await page.getByRole("button", { name: "Import" }).click();
    await page.locator("#import-text").fill(returnedUrl);
    await page.getByRole("button", { name: "Import data" }).click();

    await expect(page.getByRole("button", { name: "Validation for Rosalind E. Franklin: Lead" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Validation for Ada Lovelace: None" })).toBeVisible();

    // Dismissing the outcome strip takes the row's Updated mark down with it.
    await expect(page.getByText("Updated", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByText("Updated", { exact: true })).toHaveCount(0);
  });

  test("a shared draft opens beside your work instead of replacing it", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    await page.getByRole("button", { name: "Share" }).click();
    const shareUrl = await copyFrom(page, page.getByRole("button", { name: "Copy data link" }));

    // Someone else's browser, already holding a paper of their own.
    const other = await context.newPage();
    await seedStorage(other, { welcomeSeen: true });
    await other.goto("/");
    await other.getByRole("button", { name: "Import", exact: true }).click();
    await other.locator("#import-text").fill("Erik Nilsson");
    await other.getByRole("button", { name: "Import data" }).click();
    // Title after the first edit lands: the store rehydrates in an effect, and
    // anything typed before that is overwritten by the restored draft.
    await expect(other.getByRole("button", { name: /^Remove / })).toHaveCount(1);
    // Enter commits: the field holds a local draft until blur or Enter.
    await other.getByLabel("Draft title").fill("My own paper");
    await other.getByLabel("Draft title").press("Enter");
    await expect(other.getByRole("button", { name: "Drafts: My own paper" })).toBeVisible();

    // The shared draft arrives. Their own paper must survive it.
    await other.getByRole("button", { name: "Import", exact: true }).click();
    await other.locator("#import-text").fill(shareUrl);
    await other.getByRole("button", { name: "Import data" }).click();

    await expect(other.getByRole("button", { name: /^Remove / })).toHaveCount(3);
    await other.getByRole("button", { name: /^Drafts:/ }).click();
    await other.getByRole("button", { name: "Switch to My own paper" }).click();
    await expect(other.getByRole("button", { name: /^Remove / })).toHaveCount(1);
    await expect(other.getByLabel("Name or ORCID iD", { exact: true })).toHaveValue("Erik Nilsson");
  });

  test("a reply lands on the paper it was asked about, not the one you are on", async ({ page, context, browser }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");

    // Paper one, the one that must come through untouched. The title is set
    // after the sample loads: the store rehydrates in an effect, and a value
    // typed before that is overwritten by the restored draft.
    await page.getByRole("button", { name: "Load sample data" }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);
    await page.getByLabel("Draft title").fill("Paper one");
    await page.getByLabel("Draft title").press("Enter");
    await expect(page.getByRole("button", { name: "Drafts: Paper one" })).toBeVisible();

    // Paper two, where the request is sent from.
    await page.getByRole("button", { name: /^Drafts:/ }).click();
    await page.getByRole("button", { name: "New draft" }).click();
    await page.getByLabel("Draft title").fill("Paper two");
    await page.getByLabel("Draft title").press("Enter");
    await expect(page.getByRole("button", { name: "Drafts: Paper two" })).toBeVisible();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.locator("#import-text").fill("Ada Lovelace\nRosalind E. Franklin");
    await page.getByRole("button", { name: "Import data" }).click();
    await page.getByRole("button", { name: "Actions for Rosalind E. Franklin" }).click();
    const askUrl = await copyFrom(page, page.getByRole("button", { name: "Ask Rosalind E. Franklin to fill this in" }));

    // The co-author answers — in their own browser, not a page sharing this
    // one's localStorage (which the old clearFirst seed silently wiped).
    const coauthorContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
    const coauthor = await coauthorContext.newPage();
    await seedStorage(coauthor, { welcomeSeen: true });
    await coauthor.goto(askUrl);
    await coauthor.getByRole("button", { name: /^Validation for Rosalind E\. Franklin:/ }).click();
    const returnedUrl = await copyFrom(coauthor, coauthor.getByRole("button", { name: "Copy the link to send back" }));
    await coauthorContext.close();

    // Meanwhile you have gone back to paper one. The reply must not land here.
    await page.getByRole("button", { name: /^Drafts:/ }).click();
    await page.getByRole("button", { name: "Switch to Paper one" }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);

    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.locator("#import-text").fill(returnedUrl);
    await page.getByRole("button", { name: "Import data" }).click();

    // It switched to paper two and merged there. Paper two is an ordinary
    // yes/no draft, so the merged full score reads as Contributed.
    await expect(page.getByRole("button", { name: "Validation for Rosalind E. Franklin: Contributed" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Drafts: Paper two/ })).toBeVisible();

    // Paper one still has its three sample contributors, unchanged.
    await page.getByRole("button", { name: /^Drafts:/ }).click();
    await page.getByRole("button", { name: "Switch to Paper one" }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Validation for Rosalind E. Franklin: None" })).toBeVisible();
  });

  test("persists the draft, and deleting it from the picker empties the workspace", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);
    await page.reload();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);

    // The Drafts menu owns deletion; deleting the only draft lands on a
    // fresh, empty one, and the emptiness survives a reload.
    await page.getByRole("button", { name: /^Drafts:/ }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
  });

  /**
   * The store has no `migrate`, so a draft persisted under an older version is
   * discarded rather than upgraded. That is a deliberate trade while the app
   * has no users; this pins it, because the failure mode is silent data loss
   * and the moment it stops being acceptable a test should say so.
   */
  test("keeps one draft per paper, and switching restores its own contributors", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);

    // The title lives in the workspace; the picker lists the drafts by it.
    await page.getByLabel("Draft title").fill("First paper");
    await page.getByLabel("Draft title").press("Enter");
    const picker = page.getByRole("button", { name: /^Drafts:/ });
    await picker.click();
    await page.getByRole("button", { name: "New draft" }).click();

    // The new draft is empty; the first one is untouched behind it.
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
    await page.getByRole("button", { name: "Import" }).click();
    await page.locator("#import-text").fill("Marie Curie");
    await page.getByRole("button", { name: "Import data" }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(1);

    // Back to the first draft: its three contributors and its title return.
    await picker.click();
    await page.getByRole("button", { name: "Switch to First paper" }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);

    // And it survives a reload, which is the whole point of the map.
    await page.reload();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);
  });

  /**
   * A draft from a newer build can turn up after a rolled-back deploy or in a
   * second tab on an older bundle. There is no way to walk a schema backwards,
   * so it is discarded rather than half-understood.
   */
  test("discards a draft saved under a newer schema version", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);

    await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) throw new Error("expected persisted state");
      const persisted = JSON.parse(raw) as { version: number };
      persisted.version = 99;
      window.localStorage.setItem(key, JSON.stringify(persisted));
    }, PERSIST_KEY);
    await page.reload();

    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Load sample data" })).toBeVisible();
  });

  /**
   * The version can be perfectly current and the draft still unusable —
   * localStorage edited by hand, or a half-written value from a crashed tab.
   * `normalizeAuthors` throws on a contributor it cannot rebuild, and it runs
   * on *every* list edit, so one bad row would make add/remove/rename all throw
   * uncaught. The good rows must survive and the workspace stay usable.
   */
  test("repairs a malformed draft instead of bricking the workspace", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);

    await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) throw new Error("expected persisted state");
      const persisted = JSON.parse(raw) as {
        state: { activeDraftId: string; drafts: Record<string, { authors: { name: string }[] }> };
      };
      const active = persisted.state.drafts[persisted.state.activeDraftId];
      if (!active) throw new Error("expected an active draft");
      const [first, second] = active.authors;
      if (!(first && second)) throw new Error("expected the sample's contributors");
      first.name = "A".repeat(600); // past the length cap
      second.name = "12345"; // no letters, so createAuthor rejects it
      window.localStorage.setItem(key, JSON.stringify(persisted));
    }, PERSIST_KEY);
    await page.reload();

    // The two unusable rows are dropped; the third survives.
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(1);

    // And the workspace still works — this is what used to throw.
    await page.getByLabel("New author names or ORCID iD").fill("Marie Curie");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(2);
  });

  test("handles invalid contributor names and ORCID checksums without losing input", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    const name = page.getByLabel("Name or ORCID iD", { exact: true }).first();
    await name.fill("123");
    await name.press("Tab");
    await expect(page.getByText(/It needs at least one letter/)).toBeVisible();

    const add = page.getByLabel("New author names or ORCID iD");
    await add.fill("0000-0002-1825-0098");
    await add.press("Enter");
    await expect(add).toHaveValue("0000-0002-1825-0098");
    await expect(onScreen(page, /invalid checksum/)).toBeVisible();
  });

  test("normalizes canonical ORCID URLs imported from JSON", async ({ page }) => {
    const payload = JSON.stringify({
      version: 1,
      authors: [
        {
          id: "orcid-author",
          name: "Jane Smith",
          firstName: "Jane",
          middleName: "",
          surname: "Smith",
          initials: "JS",
          orcid: "https://orcid.org/0000-0002-1825-0097",
          contributorType: "author",
          contributions: [],
        },
      ],
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Import" }).click();
    await page.locator("#import-text").fill(payload);
    await page.getByRole("button", { name: "Import data" }).click();

    await expect(page.getByRole("link", { name: /0000-0002-1825-0097/ })).toHaveAttribute(
      "href",
      "https://orcid.org/0000-0002-1825-0097",
    );
    await expect(page.getByRole("button", { name: "Look up name from ORCID" })).toBeAttached();
  });

  test("cycles contribution levels and moves non-authors to acknowledgements", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    await page.getByRole("radio", { name: "Levels" }).click();
    const cell = page.getByRole("button", { name: "Data curation for Ada Lovelace: None" });
    await cell.click();
    await expect(page.getByRole("button", { name: "Data curation for Ada Lovelace: Supporting" })).toBeVisible();
    await page.getByRole("button", { name: "Data curation for Ada Lovelace: Supporting" }).click();
    await expect(page.getByRole("button", { name: "Data curation for Ada Lovelace: Equal" })).toBeVisible();
    await page.getByRole("button", { name: "Data curation for Ada Lovelace: Equal" }).click();
    await expect(page.getByRole("button", { name: "Data curation for Ada Lovelace: Lead" })).toBeVisible();
    await page.getByRole("button", { name: "Data curation for Ada Lovelace: Lead" }).click();
    await expect(page.getByRole("button", { name: "Data curation for Ada Lovelace: None" })).toBeVisible();

    await page.getByRole("button", { name: "Author" }).first().click();
    const statement = page.getByLabel("Statement and export").locator("p").filter({ hasText: "CRediT:" });
    await expect(statement).toContainText("Acknowledgements: Ada Lovelace");
    // The wording toggles live behind the statement's options gear now.
    await page.getByRole("button", { name: "Statement options" }).click();
    await page.getByRole("switch", { name: /Separate acknowledgements/ }).click();
    await page.keyboard.press("Escape");
    await expect(statement).not.toContainText("Acknowledgements:");
  });

  test("explains a rejected ORCID iD instead of dropping it, and never sticks on the lookup", async ({ page }) => {
    // Stub the proxy so the row's own states are what is under test, not the registry.
    await page.route("**/api/orcid", (route) =>
      route.fulfill({ json: { firstName: "Jane", surname: "Smith", displayName: "Jane A. Smith" } }),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);

    const orcidField = page.getByLabel("ORCID iD", { exact: true });
    await page
      .getByRole("button", { name: /^Actions for / })
      .first()
      .click();
    await page.getByRole("button", { name: "Add ORCID iD" }).click();

    // Shape-valid but checksum-invalid: the store rejects it, so the row has to
    // say why rather than silently closing the input.
    await orcidField.fill("0000-0002-1825-0098");
    await orcidField.press("Enter");
    const rowError = page
      .locator("section[aria-label=Contributors] li, section[aria-label=Contributors] .space-y-1 > *")
      .first()
      .getByText(/invalid checksum/i);
    await expect(rowError).toBeVisible();
    await expect(orcidField).toBeVisible();

    // A valid iD resolves and must not leave the row stuck on "Looking up…".
    await orcidField.fill("0000-0002-1825-0097");
    await orcidField.press("Enter");
    await expect(page.getByText("Looking up…")).toBeHidden();
    await expect(page.getByRole("link", { name: /0000-0002-1825-0097/ })).toBeVisible();
  });

  test("matrix option panels close on an outside click and show their open state", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);

    for (const name of ["Bulk assign", "Heatmap options"]) {
      const trigger = page.getByRole("button", { name });
      await expect(trigger).toHaveAttribute("data-state", "closed");
      await trigger.click();
      await expect(trigger).toHaveAttribute("data-state", "open");

      // Clicking away dismisses it; a plain <details> never did.
      await page.getByRole("heading", { name: "Contributors" }).click();
      await expect(trigger).toHaveAttribute("data-state", "closed");
    }
  });

  test("gives an attached ORCID iD its own aligned line rather than a ragged wrap", async ({ page }) => {
    await page.route("**/api/orcid", (route) =>
      route.fulfill({ json: { firstName: "Jane", surname: "Smith", displayName: "Jane A. Smith" } }),
    );
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);

    const row = page.locator("section[aria-label=Contributors] .space-y-1 > *").first();
    const plainHeight = (await row.boundingBox())?.height ?? 0;

    await page
      .getByRole("button", { name: /^Actions for / })
      .first()
      .click();
    await page.getByRole("button", { name: "Add ORCID iD" }).click();
    const field = page.getByLabel("ORCID iD", { exact: true });
    await field.fill("0000-0002-1825-0097");
    await field.press("Enter");

    const chip = row.getByRole("link", { name: /0000-0002-1825-0097/ });
    await expect(chip).toBeVisible();
    const badge = row.getByRole("button", { name: /Author/ });

    // The iD shares a left edge with the type badge above it...
    expect(Math.round((await chip.boundingBox())?.x ?? 0)).toBe(Math.round((await badge.boundingBox())?.x ?? -1));

    // ...its remove action sits on the same line, not wrapped below it...
    const remove = row.getByRole("button", { name: "Remove ORCID iD" });
    const chipBox = await chip.boundingBox();
    const removeBox = await remove.boundingBox();
    expect(Math.abs((chipBox?.y ?? 0) - (removeBox?.y ?? 99))).toBeLessThan(chipBox?.height ?? 0);

    // ...and the row grows by one line, not three.
    const withOrcid = (await row.boundingBox())?.height ?? 0;
    expect(withOrcid - plainHeight).toBeLessThanOrEqual(28);
  });

  test("bulk assigns a chosen level, and keeps the legend row stable across modes", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);

    // The export buttons and the card width must not move when the legend grows.
    // Start from Yes / no (the sample opens in Levels) so the flip is real.
    await page.getByRole("radio", { name: "Yes / no" }).click();
    const exports = page.getByRole("group", { name: "Heatmap" });
    const card = page.locator("section[aria-label='Contribution grid'] > div");
    const before = { x: (await exports.boundingBox())?.x, w: (await card.boundingBox())?.width };
    await page.getByRole("radio", { name: "Levels" }).click();
    await expect(page.getByText("Select to cycle")).toBeVisible();
    // ±1px, not exact: sub-pixel layout shifts with font/rendering changes
    // (a Chromium bump, a runner-image update) and is not the regression
    // this guards against.
    expect(Math.abs(((await exports.boundingBox())?.x ?? 0) - (before.x ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs(((await card.boundingBox())?.width ?? 0) - (before.w ?? 0))).toBeLessThanOrEqual(1);

    // Bulk assign in Levels mode must apply the chosen level, not silently Lead.
    await page.getByRole("button", { name: "Bulk assign" }).click();
    await page.getByRole("combobox", { name: "Level to assign" }).click();
    await page.getByRole("option", { name: "Supporting" }).click();
    await page.getByRole("button", { name: "Assign every role" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /^Conceptualization for Ada Lovelace: Supporting$/ })).toBeVisible();
  });

  test("keeps matrix labels readable and the layout stable across display modes", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);

    // Switching assignment mode must not reflow the header and shove the matrix down.
    const table = page.locator("table");
    const beforeY = (await table.boundingBox())?.y;
    await page.getByRole("radio", { name: "Levels" }).click();
    await expect(page.getByText("Select to cycle")).toBeVisible();
    expect(Math.abs(((await table.boundingBox())?.y ?? 0) - (beforeY ?? 0))).toBeLessThanOrEqual(1);

    // Enough contributors that the 14 role columns are squeezed to their minimum
    // width, the condition that used to clip every angled label.
    const longName = "Maximiliana Featherstonehaugh-Wentworth";
    const adder = page.getByLabel("New author names or ORCID iD");
    await adder.fill(`${longName}, Dmitri Ivanov, Elena Fischer, Farid Haddad, Grace Okoro`);
    await adder.press("Enter");
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(8);

    await page.getByRole("button", { name: "Heatmap options" }).click();
    await page.getByRole("button", { name: "Transpose" }).click();
    await page.keyboard.press("Escape");

    // An angled role label overhangs its own column, so it must paint above the
    // neighbouring headers rather than being buried under their backgrounds.
    // Sample along its length: every point must still hit the label itself.
    const buried = await page.evaluate(() => {
      const label = document.querySelector("thead th span[title]");
      if (!label) return "no label";
      const box = label.getBoundingClientRect();
      for (const fraction of [0.2, 0.4, 0.6]) {
        const x = box.left + box.width * fraction;
        const y = box.bottom - box.height * fraction;
        if (!label.contains(document.elementFromPoint(x, y))) return `covered at ${fraction}`;
      }
      return "";
    });
    expect(buried).toBe("");

    // A long contributor name is truncated in the transposed row header rather
    // than growing the label column and pushing role columns out of view.
    const rowHeader = page.locator("tbody th").filter({ hasText: "Maximiliana" }).locator("span > span").last();
    expect(await rowHeader.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  });

  test("bulk assigns one contributor without obscuring direct grid editing", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    await page.getByRole("button", { name: "Bulk assign" }).click();

    await page.getByRole("button", { name: "Clear every role" }).click();
    await expect(page.getByRole("button", { name: "Conceptualization for Ada Lovelace: None" })).toBeVisible();
    await page.getByRole("button", { name: "Assign every role", exact: true }).click();
    await expect(page.getByRole("button", { name: "Conceptualization for Ada Lovelace: Equal" })).toBeVisible();
  });

  // The "One role" panel (setRoleScores) had no coverage at any level, so a
  // wrong role index or a silent no-op would have shipped green.
  test("bulk assigns and clears one role across every contributor", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);

    const everyoneOnSoftware = [
      page.getByRole("button", { name: "Software for Ada Lovelace: Equal" }),
      page.getByRole("button", { name: "Software for Rosalind E. Franklin: Equal" }),
      page.getByRole("button", { name: "Software for Alan M. Turing: Equal" }),
    ];

    await page.getByRole("button", { name: "Bulk assign" }).click();
    await page.getByRole("combobox", { name: "Role for bulk assignment" }).click();
    await page.getByRole("option", { name: "Software", exact: true }).click();
    await page.getByRole("button", { name: "Assign to everyone" }).click();
    for (const cell of everyoneOnSoftware) await expect(cell).toBeVisible();

    // A different role must be untouched; catches a wrong-index write.
    await expect(page.getByRole("button", { name: "Supervision for Rosalind E. Franklin: None" })).toBeVisible();

    await page.getByRole("button", { name: "Clear for everyone" }).click();
    await expect(page.getByRole("button", { name: "Software for Ada Lovelace: None" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Software for Alan M. Turing: None" })).toBeVisible();
  });

  // Regression: a failed lookup on a bare ORCID added through the main field
  // must leave no row named after the raw iD.
  test("removes the seeded row when a bare ORCID lookup fails", async ({ page }) => {
    await asReturningVisitor(page);
    await page.route("**/api/orcid", (route) =>
      route.fulfill({ status: 404, json: { code: "NOT_FOUND", error: "No ORCID record matches that iD." } }),
    );
    await page.goto("/");

    const field = page.getByLabel("New author names or ORCID iD");
    await field.fill("0000-0002-1825-0097");
    await field.press("Enter");

    // The stub controls this text, so it is deterministic.
    await expect(onScreen(page, "No ORCID record matches that iD.")).toBeVisible();
    // No contributor row at all, and specifically none named after the iD.
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
    await expect(page.locator("section[aria-label=Contributors]").getByRole("listitem")).toHaveCount(0);
  });

  test("uses a contributor-focused role list on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();

    await page.getByRole("combobox", { name: "Contributor to assign" }).click();
    await page.getByRole("option", { name: "Rosalind E. Franklin" }).click();
    await expect(page.getByRole("button", { name: "Conceptualization for Rosalind E. Franklin: None" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Conceptualization for Ada Lovelace/ })).toBeHidden();
  });

  test("downloads a browser-generated PNG heatmap", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "PNG" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("credit-heatmap.png");
    const path = await download.path();
    if (!path) throw new Error("expected downloaded PNG path");
    expect([...(await readFile(path)).subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  test("keeps header, grid cells, and long statements usable on a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Load sample data" })).toBeVisible();
    const importButton = page.getByRole("button", { name: "Import" });
    const importBox = await importButton.boundingBox();
    expect(importBox).not.toBeNull();
    expect((importBox?.x ?? 321) + (importBox?.width ?? 0)).toBeLessThanOrEqual(320);

    await importButton.click();
    const names = Array.from({ length: 12 }, (_, index) => `Contributor${index} Surname${index}`).join("\n");
    await page.locator("#import-text").fill(names);
    await page.getByRole("button", { name: "Import data" }).click();
    const cell = page.getByRole("button", { name: /Conceptualization for Contributor0/ });
    expect((await cell.boundingBox())?.width).toBeGreaterThanOrEqual(44);
    expect((await cell.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await cell.click();

    const firstName = page.getByLabel("Name or ORCID iD", { exact: true }).first();
    await firstName.fill("A".repeat(240));
    await firstName.press("Enter");
    expect(await page.evaluate(() => document.body.scrollWidth)).toBe(320);
    const statement = page.getByLabel("Statement and export");
    expect((await statement.boundingBox())?.width).toBeLessThanOrEqual(320);
  });

  test("rejects malformed ORCID API requests before upstream lookup", async ({ request }) => {
    const response = await request.post("/api/orcid", { data: { id: "0000-0002-1825-0098" } });
    expect(response.status()).toBe(400);
    // `code` is what a client localizes from; `error` is the English fallback
    // that rides along for logs and for clients predating a code.
    await expect(response.json()).resolves.toEqual({
      code: "INVALID_ID",
      error: "That is not a valid ORCID iD. Check the digits and try again.",
    });
  });

  test("rejects malformed DOI API requests before upstream lookup", async ({ request }) => {
    // Mirrors the ORCID spec above: the route's own request-level branches
    // never ran anywhere (e2e stubs the route in the browser; core tests
    // cover lookupDoiWork, not the handler).
    const badDoi = await request.post("/api/doi", { data: { doi: "not-a-doi" } });
    expect(badDoi.status()).toBe(400);
    await expect(badDoi.json()).resolves.toEqual({
      code: "INVALID_DOI",
      error: "That is not a valid DOI. It should look like 10.1234/abcde.",
    });

    // A Buffer goes out raw; a string here would be JSON-stringified into a
    // *valid* JSON string body and take the INVALID_DOI branch instead.
    const unreadable = await request.post("/api/doi", {
      headers: { "content-type": "application/json" },
      data: Buffer.from("{not json"),
    });
    expect(unreadable.status()).toBe(400);
    await expect(unreadable.json()).resolves.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("XML export downloads client-side (no API round-trip)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);

    // XML (JATS4R) is the default export format; downloading generates it in the
    // browser and saves it directly (no API round-trip).
    await expect(page.getByRole("combobox", { name: "Export format" })).toHaveText(/XML \(JATS4R\)/);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("credit-contributors.xml");
  });
});
