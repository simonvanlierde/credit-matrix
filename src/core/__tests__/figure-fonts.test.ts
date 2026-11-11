// biome-ignore-all lint/correctness/noNodejsModules: this test reads the font package and a cache folder on disk.
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadFigureFont, FIGURE_FONT_FILES, FIGURE_FONTS_VERSION } from "../figure-fonts";
import { createFigureRenderer } from "../figures";
import { createAuthor } from "../parse-authors";

const fontsDir = new URL("../../fonts/", import.meta.url);
const sans = () => readFile(new URL(FIGURE_FONT_FILES.sans.file, fontsDir));
const jane = [createAuthor("Jane Smith", { contributions: [{ role: "Software", score: 100 }] })];

describe("the pinned font list", () => {
  it("matches the files and version of the credit-matrix-fonts package", async () => {
    const manifest = JSON.parse(await readFile(new URL("package.json", fontsDir), "utf8"));
    expect(manifest.version).toBe(FIGURE_FONTS_VERSION);
    for (const { file, sha256 } of Object.values(FIGURE_FONT_FILES))
      expect(
        createHash("sha256")
          .update(await readFile(new URL(file, fontsDir)))
          .digest("hex"),
        file,
      ).toBe(sha256);
  });
});

describe("downloadFigureFont", () => {
  let cache: string;
  beforeEach(async () => {
    cache = await mkdtemp(join(tmpdir(), "credit-matrix-cache-"));
    vi.stubEnv("XDG_CACHE_HOME", cache);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await rm(cache, { recursive: true, force: true });
  });

  it("downloads a face once from the pinned release, then reads it from the cache offline", async () => {
    const bytes = await sans();
    const fetch = vi.fn(async () => new Response(bytes));
    vi.stubGlobal("fetch", fetch);
    expect(Buffer.from(await downloadFigureFont("sans")).equals(bytes)).toBe(true);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `https://cdn.jsdelivr.net/npm/credit-matrix-fonts@${FIGURE_FONTS_VERSION}/NotoSans-Regular.ttf`,
    );
    expect(await readdir(join(cache, "credit-matrix", "fonts"))).toEqual([`${FIGURE_FONT_FILES.sans.sha256}.ttf`]);

    fetch.mockRejectedValue(new TypeError("fetch failed"));
    expect(Buffer.from(await downloadFigureFont("sans")).equals(bytes)).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("refuses a download that does not match its hash and caches nothing", async () => {
    const tampered = await sans();
    tampered[100] = 255 - (tampered[100] ?? 0);
    vi.stubGlobal("fetch", async () => new Response(tampered));
    await expect(downloadFigureFont("sans")).rejects.toThrow(
      "The downloaded figure font NotoSans-Regular.ttf does not match its SHA-256 hash",
    );
    await expect(readdir(join(cache, "credit-matrix", "fonts"))).rejects.toThrow();
  });

  it("says why when the page has no Web Crypto to check a download", async () => {
    vi.stubGlobal("fetch", async () => new Response(await sans()));
    vi.stubGlobal("crypto", {});
    await expect(downloadFigureFont("sans")).rejects.toThrow("needs Web Crypto");
  });

  it("names both fixes when offline with nothing cached", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    await expect(downloadFigureFont("sans-jp")).rejects.toThrow(
      "Cannot load figure font CreditFigureJP.ttf (fetch failed). Install the fonts with `npm i credit-matrix-fonts`, or connect to the internet once to download them.",
    );
  });
});

describe("a renderer whose fonts cannot be loaded", () => {
  const offline = () =>
    createFigureRenderer({
      fonts: () => {
        throw new Error("Cannot load figure font NotoSans-Regular.ttf (offline).");
      },
    });

  it("draws SVG in system fonts and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const renderer = offline();
    const svg = await renderer.svg(jane);
    const warnings = warn.mock.calls.length;
    await renderer.svg(jane);
    expect(svg).toMatch(/<tspan font-family="[^"]*sans-serif">Software<\/tspan>/);
    expect(svg).not.toContain("@font-face");
    expect(warn).toHaveBeenCalledWith(
      "Cannot load figure font NotoSans-Regular.ttf (offline). Drawing its text in system fonts.",
    );
    // Once per face, not once per figure.
    expect(warn).toHaveBeenCalledTimes(warnings);
  });

  it("stops PDF with the provider's error", async () => {
    await expect(offline().pdf(jane)).rejects.toThrow("Cannot load figure font NotoSans-Regular.ttf (offline).");
  });
});
