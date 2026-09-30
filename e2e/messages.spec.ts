// biome-ignore lint/correctness/noNodejsModules: Playwright tests run in Node.
import { existsSync, readdirSync, readFileSync } from "node:fs";
// biome-ignore lint/correctness/noNodejsModules: Playwright tests run in Node.
import path from "node:path";
// biome-ignore lint/correctness/noNodejsModules: Playwright tests run in Node.
import process from "node:process";
import { expect, type Page, test } from "@playwright/test";
import { AVAILABLE_LOCALES } from "../src/core";
import { seedStorage } from "./helpers";

/**
 * Interface messages live in the app (`src/messages`), not in core: they are
 * chrome, not domain logic, and core stays dependency-free.
 *
 * These guard the failure modes the catalogs actually have — a locale the
 * picker offers but cannot load, a key left behind by a rename, a translated
 * proper noun, malformed ICU, and a dropped placeholder.
 */
const MESSAGES_DIR = path.join(process.cwd(), "src", "messages");

const read = (locale: string): Record<string, string> =>
  JSON.parse(readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), "utf8"));

const EN = read("en");
const LOCALES = readdirSync(MESSAGES_DIR)
  .filter((f: string) => f.endsWith(".json"))
  .map((f: string) => f.replace(".json", ""));
const TRANSLATED = LOCALES.filter((l: string) => l !== "en");

/** Placeholder names an ICU message declares: {name}, {count, plural, ...}. */
const placeholders = (s: string) => new Set([...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]));

test.describe("interface messages", () => {
  // The loaders import `<dir>/${code}.json` by name, so a missing or misnamed
  // file only shows up at runtime, as an English fallback.
  test("ships every catalog for every locale the language picker offers", () => {
    const dirs = ["src/messages", "src/core/credit-i18n/ui", "src/core/credit-i18n/translations"];
    for (const { code } of AVAILABLE_LOCALES.filter((locale) => locale.code !== "en")) {
      for (const dir of dirs) {
        expect(existsSync(path.join(process.cwd(), dir, `${code}.json`)), `${dir}/${code}.json is missing`).toBe(true);
      }
    }
  });

  /**
   * Key sets must match English exactly, in both directions.
   *
   * Extra keys are a rename that rotted. Missing keys are subtler: they fall
   * back to English, so the app still works and nobody notices one corner of
   * the interface quietly staying English. Enforcing both means adding a
   * string to en.json is a visible, deliberate translation task.
   */
  test("matches English key for key, in both directions", () => {
    for (const locale of TRANSLATED) {
      const keys = Object.keys(read(locale));
      const unknown = keys.filter((key) => !(key in EN));
      const missing = Object.keys(EN).filter((key) => !keys.includes(key));
      expect(unknown, `${locale}.json has keys absent from en.json`).toEqual([]);
      expect(missing, `${locale}.json is missing keys that en.json defines`).toEqual([]);
    }
  });

  test("never ships an empty string, which would render as a blank control", () => {
    for (const locale of LOCALES) {
      const blank = Object.entries(read(locale))
        .filter(([, value]) => value.trim() === "")
        .map(([key]) => key);
      expect(blank, `${locale}.json has blank values`).toEqual([]);
    }
  });

  test("keeps product and format names untranslated", () => {
    // A submission system will not accept a translated "ORCID" or "CRediT".
    for (const locale of TRANSLATED) {
      for (const [key, value] of Object.entries(read(locale))) {
        for (const term of ["ORCID", "CRediT"]) {
          if (EN[key]?.includes(term)) {
            expect(value, `${locale}.${key} dropped "${term}"`).toContain(term);
          }
        }
      }
    }
  });

  test("balances ICU braces, so a malformed plural cannot reach the runtime", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(read(locale))) {
        const open = (value.match(/\{/g) ?? []).length;
        const close = (value.match(/\}/g) ?? []).length;
        expect(open, `${locale}.${key} has unbalanced ICU braces: ${value}`).toBe(close);
      }
    }
  });

  test("keeps every placeholder English declares", () => {
    // Dropping {name} from a translation silently loses the contributor's name.
    for (const locale of TRANSLATED) {
      for (const [key, value] of Object.entries(read(locale))) {
        for (const name of placeholders(EN[key] ?? "")) {
          expect(placeholders(value), `${locale}.${key} dropped {${name}}`).toContain(name);
        }
      }
    }
  });
});

/**
 * The catalog checks above are static. This renders the app in a non-English
 * locale, which nothing else does: every other spec runs in English, so a
 * broken ICU message, a locale chunk that fails to load, or a provider wired to
 * the wrong locale would pass the whole suite and only surface for a real user.
 */
test.describe("rendering a non-English locale", () => {
  const seed = (page: Page, uiLocale: string, outputLocale: string) =>
    seedStorage(page, { authors: [], welcomeSeen: true, uiLocale, outputLocale });

  test("translates the interface and declares the document language", async ({ page }) => {
    await seed(page, "nl", "nl");
    await page.goto("/");

    // A translated string that only exists in the Dutch catalog.
    await expect(page.getByRole("button", { name: "Voorbeeldgegevens laden" })).toBeVisible();
    // Screen readers pick pronunciation from this; "en" here would be a lie.
    await expect(page.locator("html")).toHaveAttribute("lang", "nl");
  });

  test("keeps the statement in the output language when the two differ", async ({ page }) => {
    await seed(page, "nl", "en");
    await page.goto("/");
    await page.getByRole("button", { name: "Voorbeeldgegevens laden" }).click();

    // Interface Dutch, document declared Dutch...
    await expect(page.locator("html")).toHaveAttribute("lang", "nl");
    // ...but the statement is English and says so, so a screen reader switches.
    const statement = page.locator("section[lang]");
    await expect(statement).toHaveAttribute("lang", "en");
    await expect(statement).toContainText("Conceptualization");
  });

  test("no raw message key leaks into the rendered page", async ({ page }) => {
    // NOTE: this does not exercise the English-fallback path — every key is
    // translated (the parity test above enforces it), so the fallback never
    // runs here. It only catches a raw key rendered as text. The prefix list
    // is best-effort; extend it when a new key family appears.
    await seed(page, "nl", "nl");
    await page.goto("/");
    // innerText, not textContent: the latter includes Next's inlined script
    // payload, whose minified identifiers look exactly like message keys.
    const visible = await page.locator("body").innerText();
    // A raw key leaking into the page is the failure this guards against.
    expect(visible).not.toMatch(/\b(a11y|ann|err|dnd|step|bulk)[A-Z]\w+/);
  });
});
