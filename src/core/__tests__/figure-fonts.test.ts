// biome-ignore-all lint/correctness/noNodejsModules: this test reads the font package and a cache folder on disk.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultFigureFonts, downloadFigureFont, FIGURE_FONT_FILES, FIGURE_FONTS_VERSION } from "../figure-fonts";
import { createFigureRenderer, type FigureFace } from "../figures";
import { createAuthor } from "../parse-authors";
import { cast } from "./cast";

const fontsDir = new URL("../../fonts/", import.meta.url);
const sans = () => readFile(new URL(FIGURE_FONT_FILES.sans.file, fontsDir));
const grace = [createAuthor(cast.grace, { contributions: [{ role: "Software", score: 100 }] })];
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

// Replaced per test with vi.doMock; the real package is read through vi.importActual.
vi.mock("credit-matrix-fonts", async (importOriginal) => importOriginal());

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

  it("is what the package's own provider returns for every face", async () => {
    const { fonts } = await vi.importActual<{ fonts: (face: string) => Promise<Uint8Array> }>("credit-matrix-fonts");
    for (const [face, { sha256 }] of Object.entries(FIGURE_FONT_FILES))
      expect(sha(await fonts(face)), face).toBe(sha256);
    await expect(fonts("nope")).rejects.toThrow(RangeError);
    await expect(fonts("toString")).rejects.toThrow(RangeError);
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
      // No Referer for jsDelivr, and a deadline so a stalled download cannot hang a build.
      expect.objectContaining({ referrerPolicy: "no-referrer", signal: expect.any(AbortSignal) }),
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
      "Cannot load figure font CreditFigureJP.ttf (fetch failed). Install the fonts next to credit-matrix with `npm i credit-matrix credit-matrix-fonts` (or run `npx -p credit-matrix -p credit-matrix-fonts credit-matrix`), or connect to the internet once to download them.",
    );
  });

  it("downloads a face the installed package cannot give", async () => {
    vi.doMock("credit-matrix-fonts", () => ({
      fonts: () => Promise.reject(new RangeError("Unknown figure font face")),
    }));
    const bytes = await sans();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bytes)),
    );
    expect(sha(await defaultFigureFonts("sans"))).toBe(FIGURE_FONT_FILES.sans.sha256);
    expect(fetch).toHaveBeenCalledOnce();
    vi.doUnmock("credit-matrix-fonts");
  });

  it("refuses an installed face that does not match its hash, and does not download one", async () => {
    vi.doMock("credit-matrix-fonts", () => ({ fonts: async () => new Uint8Array([1, 2, 3]) }));
    vi.stubGlobal("fetch", vi.fn());
    await expect(defaultFigureFonts("sans")).rejects.toThrow(
      "The installed credit-matrix-fonts has a NotoSans-Regular.ttf that does not match its SHA-256 hash",
    );
    expect(fetch).not.toHaveBeenCalled();
    vi.doUnmock("credit-matrix-fonts");
  });

  it("reports an installed package that fails to read a face instead of downloading it", async () => {
    const missing = Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
    vi.doMock("credit-matrix-fonts", () => ({ fonts: () => Promise.reject(missing) }));
    vi.stubGlobal("fetch", vi.fn());
    await expect(defaultFigureFonts("sans")).rejects.toBe(missing);
    expect(fetch).not.toHaveBeenCalled();
    vi.doUnmock("credit-matrix-fonts");
  });

  it("ignores a relative XDG_CACHE_HOME, as the XDG spec says", async () => {
    vi.stubEnv("XDG_CACHE_HOME", "relative-cache");
    vi.stubEnv("HOME", cache);
    vi.stubGlobal("fetch", async () => new Response(await sans()));
    await downloadFigureFont("sans");
    expect(await readdir(join(cache, ".cache", "credit-matrix", "fonts"))).toHaveLength(1);
  });

  it("replaces a cached face whose bytes fail the hash with a fresh download", async () => {
    const good = await sans();
    const folder = join(cache, "credit-matrix", "fonts");
    const cached = join(folder, `${FIGURE_FONT_FILES.sans.sha256}.ttf`);
    await mkdir(folder, { recursive: true });
    await writeFile(cached, Buffer.from("corrupt"));
    const fetch = vi.fn(async () => new Response(good));
    vi.stubGlobal("fetch", fetch);
    expect(Buffer.from(await downloadFigureFont("sans")).equals(good)).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(sha(await readFile(cached))).toBe(FIGURE_FONT_FILES.sans.sha256);
  });

  describe("cache folder by platform", () => {
    const platform = process.platform;
    const downloadOn = async (name: NodeJS.Platform, env: Record<string, string | undefined>) => {
      Object.defineProperty(process, "platform", { value: name });
      // os.homedir() reads HOME on POSIX and USERPROFILE on Windows.
      vi.stubEnv("HOME", cache);
      vi.stubEnv("USERPROFILE", cache);
      for (const [key, value] of Object.entries({ XDG_CACHE_HOME: undefined, LOCALAPPDATA: undefined, ...env }))
        vi.stubEnv(key, value);
      vi.stubGlobal("fetch", async () => new Response(await sans()));
      await downloadFigureFont("sans");
    };
    const cachedAt = async (...parts: string[]) =>
      readdir(join(cache, ...parts, "credit-matrix", "fonts")).then((files) => files.length);
    afterEach(() => Object.defineProperty(process, "platform", { value: platform }));

    it("uses an absolute XDG_CACHE_HOME on any platform", async () => {
      await downloadOn("darwin", { XDG_CACHE_HOME: join(cache, "xdg") });
      expect(await cachedAt("xdg")).toBe(1);
    });

    it("uses ~/Library/Caches on macOS", async () => {
      await downloadOn("darwin", {});
      expect(await cachedAt("Library", "Caches")).toBe(1);
    });

    it("uses LOCALAPPDATA on Windows", async () => {
      await downloadOn("win32", { LOCALAPPDATA: join(cache, "local") });
      expect(await cachedAt("local")).toBe(1);
    });

    it("falls back to ~/AppData/Local on Windows without LOCALAPPDATA", async () => {
      await downloadOn("win32", {});
      expect(await cachedAt("AppData", "Local")).toBe(1);
    });

    it("uses ~/.cache on Linux", async () => {
      await downloadOn("linux", {});
      expect(await cachedAt(".cache")).toBe(1);
    });
  });
});

describe("a renderer with one face unavailable", () => {
  const failing = (broken: FigureFace) => {
    const asked: FigureFace[] = [];
    const renderer = createFigureRenderer({
      fonts: async (face) => {
        asked.push(face);
        if (face === broken) throw new Error(`Cannot load ${face}.`);
        return new Uint8Array(await readFile(new URL(FIGURE_FONT_FILES[face].file, fontsDir)));
      },
    });
    return { renderer, asked };
  };

  it("draws Latin in system fonts rather than in a CJK face", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { renderer, asked } = failing("sans");
    const svg = await renderer.svg(grace);
    expect(svg).toMatch(/<tspan font-family="[^"]*sans-serif">Software<\/tspan>/);
    expect(svg).not.toContain("@font-face");
    expect(asked).toEqual(["sans"]);
  });

  it("draws Japanese Han in system fonts rather than in Chinese forms", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { renderer, asked } = failing("sans-jp");
    const svg = await renderer.svg([createAuthor("山田太郎", { contributions: [{ role: "Software", score: 100 }] })], {
      locale: "ja",
    });
    expect(svg).toMatch(/<tspan font-family="[^"]*sans-serif">山田太郎<\/tspan>/);
    expect(asked).not.toContain("sans-sc");
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
    const svg = await renderer.svg(grace);
    const warnings = warn.mock.calls.length;
    await renderer.svg(grace);
    expect(svg).toMatch(/<tspan font-family="[^"]*sans-serif">Software<\/tspan>/);
    expect(svg).not.toContain("@font-face");
    expect(warn).toHaveBeenCalledWith(
      "Cannot load figure font NotoSans-Regular.ttf (offline). Drawing its text in system fonts.",
    );
    // Once per face, not once per figure.
    expect(warn).toHaveBeenCalledTimes(warnings);
  });

  it("stops PDF with the provider's error", async () => {
    await expect(offline().pdf(grace)).rejects.toThrow("Cannot load figure font NotoSans-Regular.ttf (offline).");
  });
});
