// biome-ignore-all lint/security/noSecrets: SHA-256 hashes of the public font files, not credentials.

/** A figure font face: the Latin face and the Japanese and Simplified Chinese faces, in sans and serif. */
export type FigureFace = "sans" | "sans-jp" | "sans-sc" | "serif" | "serif-jp" | "serif-sc";

/** Returns the bytes of one TrueType face; `createFigureRenderer` calls it the first time a figure needs that face. */
export type FigureFontProvider = (face: FigureFace) => Uint8Array | Promise<Uint8Array>;

/** The `credit-matrix-fonts` release whose files the download fetches and whose hashes are listed here. */
export const FIGURE_FONTS_VERSION = "1.0.0";

export const FIGURE_FONT_FILES: Record<FigureFace, { file: string; sha256: string }> = {
  sans: {
    file: "NotoSans-Regular.ttf",
    sha256: "8409b656cf2cf57ea0d218bc22bb8f9bbb855e425dd1651081c3488c39dfded6",
  },
  "sans-jp": {
    file: "CreditFigureJP.ttf",
    sha256: "cf10690af695ffb42ac3817dcabf87fc9fe706961c51654d23d61630f9a90af6",
  },
  "sans-sc": {
    file: "CreditFigureSC.ttf",
    sha256: "083e615a0d762b3494ef294a1fb3da65dd7b870f24c7a83eb7b62e22e41f3b3f",
  },
  serif: {
    file: "NotoSerif-Regular.ttf",
    sha256: "c8f669ceb2c9c60ccf55198b305e08a997ffca79a38cc7eeb551e643cbe66505",
  },
  "serif-jp": {
    file: "CreditFigureSerifJP.ttf",
    sha256: "127d13be2fcb997f01ec56ce361e5808a63ee74fbcd94be8262bebbb90aa95d3",
  },
  "serif-sc": {
    file: "CreditFigureSerifSC.ttf",
    sha256: "9e4eadf4a90c36eaf7f69ef1c0d29fd6b8277eed55f5a035b95232e5243cdd34",
  },
};

const CDN = `https://cdn.jsdelivr.net/npm/credit-matrix-fonts@${FIGURE_FONTS_VERSION}/`;

// Kept dynamic: the same module runs in the browser, where Node's modules do not exist.
function nodeModule<T>(name: string): Promise<T> {
  return import(/* @vite-ignore */ name) as Promise<T>;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  // Web Crypto exists only on HTTPS and localhost pages; without it no download can be checked.
  if (!globalThis.crypto?.subtle)
    throw new Error("Checking a downloaded figure font needs Web Crypto, which this page only has over HTTPS.");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The per-machine font cache folder in Node; undefined in a browser, where the HTTP cache applies. */
async function cacheFolder(): Promise<string | undefined> {
  // Through globalThis: this module also runs in browsers, which have no `process`.
  const process = (globalThis as { process?: NodeJS.Process }).process;
  if (!process?.versions?.node) return undefined;
  const { homedir } = await nodeModule<typeof import("node:os")>("node:os");
  const { join } = await nodeModule<typeof import("node:path")>("node:path");
  const base =
    process.env.XDG_CACHE_HOME ||
    (process.platform === "win32"
      ? (process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"))
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Caches")
        : join(homedir(), ".cache"));
  return join(base, "credit-matrix", "fonts");
}

/**
 * Fetch one face from the pinned `credit-matrix-fonts` release on jsDelivr, refuse it unless its SHA-256
 * matches, and keep it in the per-machine cache (in Node) so later runs work offline.
 */
export async function downloadFigureFont(face: FigureFace): Promise<Uint8Array> {
  const { file, sha256: expected } = FIGURE_FONT_FILES[face];
  const folder = await cacheFolder();
  const fs = folder ? await nodeModule<typeof import("node:fs/promises")>("node:fs/promises") : undefined;
  const cached = folder ? `${folder}/${expected}.ttf` : undefined;
  if (fs && cached) {
    const bytes = await fs.readFile(cached).then(
      (buffer) => new Uint8Array(buffer),
      () => undefined,
    );
    if (bytes && (await sha256(bytes)) === expected) return bytes;
  }
  let bytes: Uint8Array;
  try {
    const response = await fetch(`${CDN}${file}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    throw new Error(
      `Cannot load figure font ${file} (${error instanceof Error ? error.message : String(error)}). Install the fonts with \`npm i credit-matrix-fonts\`, or connect to the internet once to download them.`,
      { cause: error },
    );
  }
  if ((await sha256(bytes)) !== expected)
    throw new Error(`The downloaded figure font ${file} does not match its SHA-256 hash, so it was not used.`);
  if (fs && folder && cached) {
    // Write then rename, so a parallel run never reads half a file. A read-only cache only costs a later download.
    const partial = `${cached}.${crypto.randomUUID()}.part`;
    await fs
      .mkdir(folder, { recursive: true })
      .then(() => fs.writeFile(partial, bytes))
      .then(() => fs.rename(partial, cached))
      .catch(() => fs.rm(partial, { force: true }));
  }
  return bytes;
}

/** The installed `credit-matrix-fonts` package when it resolves, otherwise the checked, cached download. */
export async function defaultFigureFonts(face: FigureFace): Promise<Uint8Array> {
  const installed = await nodeModule<{ fonts: FigureFontProvider }>("credit-matrix-fonts").catch(() => undefined);
  return installed ? installed.fonts(face) : downloadFigureFont(face);
}
