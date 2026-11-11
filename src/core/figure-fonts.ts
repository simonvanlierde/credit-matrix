// biome-ignore-all lint/security/noSecrets: SHA-256 hashes of the public font files, not credentials.

/**
 * A figure font face: Latin, Japanese, Simplified Chinese and the other scripts in sans and serif (Korean
 * in sans only), and monochrome emoji. `harfbuzz` is the HarfBuzz shaping engine (WebAssembly) that lays
 * out the complex scripts, and `harfbuzz-subset` its subsetter, which cuts each face down to a figure's glyphs;
 * both are fetched the same way.
 */
export type FigureFace =
  | "sans"
  | "sans-jp"
  | "sans-sc"
  | "serif"
  | "serif-jp"
  | "serif-sc"
  | "sans-kr"
  | "sans-arabic"
  | "sans-armenian"
  | "sans-bengali"
  | "sans-devanagari"
  | "sans-ethiopic"
  | "sans-georgian"
  | "sans-gujarati"
  | "sans-gurmukhi"
  | "sans-hebrew"
  | "sans-kannada"
  | "sans-khmer"
  | "sans-lao"
  | "sans-malayalam"
  | "sans-myanmar"
  | "sans-oriya"
  | "sans-sinhala"
  | "sans-tamil"
  | "sans-telugu"
  | "sans-thai"
  | "serif-arabic"
  | "serif-armenian"
  | "serif-bengali"
  | "serif-devanagari"
  | "serif-ethiopic"
  | "serif-georgian"
  | "serif-gujarati"
  | "serif-gurmukhi"
  | "serif-hebrew"
  | "serif-kannada"
  | "serif-khmer"
  | "serif-lao"
  | "serif-malayalam"
  | "serif-myanmar"
  | "serif-oriya"
  | "serif-sinhala"
  | "serif-tamil"
  | "serif-telugu"
  | "serif-thai"
  | "emoji"
  | "harfbuzz"
  | "harfbuzz-subset";

/**
 * Returns the bytes of one face (TrueType, or WebAssembly for `harfbuzz` and `harfbuzz-subset`);
 * `createFigureRenderer` calls it the first time a figure needs that face.
 */
export type FigureFontProvider = (face: FigureFace) => Uint8Array | Promise<Uint8Array>;

/**
 * A `font` family a figure cannot use: not found, installed only as a web font (WOFF), or a variable font
 * whose default instance is not the upright regular one.
 */
export class FigureFontFileError extends Error {
  override readonly name = "FigureFontFileError";
}

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
  "sans-kr": {
    file: "CreditFigureKR.ttf",
    sha256: "134e926bd335ede61927ad3e5209fd9f0b4381c78decd26bc39462af7a8ed640",
  },
  "sans-arabic": {
    file: "NotoSansArabic-Regular.ttf",
    sha256: "bdff3e5659d67e67def05b33f749683b9376ae819d65d3dd62ac4640b3aaef48",
  },
  "sans-armenian": {
    file: "NotoSansArmenian-Regular.ttf",
    sha256: "720df88c332417a235b4d6209d14ec2e2bf4bfe2a954b7453d869ea593bfce1e",
  },
  "sans-bengali": {
    file: "NotoSansBengali-Regular.ttf",
    sha256: "b55c62ee531e3214da6c0701daecea89a52ba42db7d8206b92e6b51f397a3193",
  },
  "sans-devanagari": {
    file: "NotoSansDevanagari-Regular.ttf",
    sha256: "4e3c66638958c3e2ab5d37f47a8deb89fffeb7be9985c665a519bbc7ba762313",
  },
  "sans-ethiopic": {
    file: "NotoSansEthiopic-Regular.ttf",
    sha256: "f6f7fc379db9438959a2b0527e7a2cf36ea9c84626d56ec444fff37fc24c3c10",
  },
  "sans-georgian": {
    file: "NotoSansGeorgian-Regular.ttf",
    sha256: "d3e33254b09e7bb2c5cf0f17e554b80462056c5a107097f258d495168c3a9346",
  },
  "sans-gujarati": {
    file: "NotoSansGujarati-Regular.ttf",
    sha256: "9b5a7aaeeb649a2e75a49d8b006a1f87db1b61c0df3b001609f4e0725d88dbf6",
  },
  "sans-gurmukhi": {
    file: "NotoSansGurmukhi-Regular.ttf",
    sha256: "658d0207da305a1411c539a8b0bbeda64d4146e54fb4827facddb890b6b90d74",
  },
  "sans-hebrew": {
    file: "NotoSansHebrew-Regular.ttf",
    sha256: "cdefaf8efd47045f6820928eba84db5bed7557539328952b5f828315485e02ee",
  },
  "sans-kannada": {
    file: "NotoSansKannada-Regular.ttf",
    sha256: "9ad74dc64838c6855b96f671fc08e425a58921b9d0c71712ea79c328a27e6e38",
  },
  "sans-khmer": {
    file: "NotoSansKhmer-Regular.ttf",
    sha256: "e66675f2082788f0511a714bef5a1748928294b38c8e286a96ea73a864b5e605",
  },
  "sans-lao": {
    file: "NotoSansLao-Regular.ttf",
    sha256: "0a86e5e1ccfe34ca78c43fac6829dc751b42bcc469272a9a55325aae587bfbe7",
  },
  "sans-malayalam": {
    file: "NotoSansMalayalam-Regular.ttf",
    sha256: "c08de7fa8d032a5d6a4d120fb82c78cec60b362a4e73fa26360d89759ff2a7f9",
  },
  "sans-myanmar": {
    file: "NotoSansMyanmar-Regular.ttf",
    sha256: "fafce4db400bc0b214907ccdbfb0ad2f18a57bfefd08c8a571830b84088cf2fc",
  },
  "sans-oriya": {
    file: "NotoSansOriya-Regular.ttf",
    sha256: "a16645d056017927406546aa78e4ce15e782fd8783467267b75450453d007415",
  },
  "sans-sinhala": {
    file: "NotoSansSinhala-Regular.ttf",
    sha256: "9e32612d47004552f3125e78648a9e2e7899a216ccd3cefbb93a9b5f4c809feb",
  },
  "sans-tamil": {
    file: "NotoSansTamil-Regular.ttf",
    sha256: "3c0a186feb3c63c7f6d63e1511dcdc144e745ae09b98e217c83f3e317974f6f9",
  },
  "sans-telugu": {
    file: "NotoSansTelugu-Regular.ttf",
    sha256: "b274780b69d1d23fe84b55e809a152cb2ac5306d33864b1f87622f6971871aae",
  },
  "sans-thai": {
    file: "NotoSansThai-Regular.ttf",
    sha256: "61cf814eec46b294d6ea4401ac295d0cecd5207bd2331dcc5a15e7301d30ee44",
  },
  "serif-arabic": {
    file: "NotoNaskhArabic-Regular.ttf",
    sha256: "6f0a92031367b2f5a2078fe9d24f3433122b61a0bad57c423aad8f3c39aa2e6e",
  },
  "serif-armenian": {
    file: "NotoSerifArmenian-Regular.ttf",
    sha256: "6dc71b17c55d398c7cc88edeec527292ba1e0573b033ac2136c636ab36c27d76",
  },
  "serif-bengali": {
    file: "NotoSerifBengali-Regular.ttf",
    sha256: "c1743dce480147e4563e479ddc31d5ff6544372437428622a54c7c867c50f55b",
  },
  "serif-devanagari": {
    file: "NotoSerifDevanagari-Regular.ttf",
    sha256: "e272d11d271c61a8d5d0f65764fd368ae53b9f9dabcce244a8941aa8f32ccc70",
  },
  "serif-ethiopic": {
    file: "NotoSerifEthiopic-Regular.ttf",
    sha256: "4d14f10b7436e762d41ddd9486acdc708744bf377a575d855b81b847b9590779",
  },
  "serif-georgian": {
    file: "NotoSerifGeorgian-Regular.ttf",
    sha256: "e222862f34ad05bdf950de1049abf6149d250b9e27c1cc482dd645412afb64ff",
  },
  "serif-gujarati": {
    file: "NotoSerifGujarati-Regular.ttf",
    sha256: "b8961ff6faf8e5561e3d0109953c4a9798e9bb8e8d48f66c3d1ef038fe45c940",
  },
  "serif-gurmukhi": {
    file: "NotoSerifGurmukhi-Regular.ttf",
    sha256: "5ef2d04a6d6fd22959989d14148dcf0ffbb970cc35e6316ba63cd5c146f32667",
  },
  "serif-hebrew": {
    file: "NotoSerifHebrew-Regular.ttf",
    sha256: "dfd5a6aefe97a99f68fe43388342913d50bb9fbf6d3afc4d2c7725661bc4a2b1",
  },
  "serif-kannada": {
    file: "NotoSerifKannada-Regular.ttf",
    sha256: "95a78c95359dc59b9ec56bdc5bdf8a9642394d2ef87ded945fb3885893b3eac6",
  },
  "serif-khmer": {
    file: "NotoSerifKhmer-Regular.ttf",
    sha256: "ef0612212c7417da732dd43c744abf66f4f62c45d4f8962e42c8553230e0da2a",
  },
  "serif-lao": {
    file: "NotoSerifLao-Regular.ttf",
    sha256: "a8d38866520f3c96d0e0e43f079f16c72ae4963bbabdf21cae26092c7cb65ec7",
  },
  "serif-malayalam": {
    file: "NotoSerifMalayalam-Regular.ttf",
    sha256: "45c34ac8c169a37a4fbb5b8fbf507def328bbf36180b08095726d460d577ec1d",
  },
  "serif-myanmar": {
    file: "NotoSerifMyanmar-Regular.ttf",
    sha256: "fe1a5f1c9cafab515e89e20f884aee3681ccd9f3f2e7bf357c6758d9268535a5",
  },
  "serif-oriya": {
    file: "NotoSerifOriya-Regular.ttf",
    sha256: "c674ab8038d1e51e783fdd7192fd39ae8a2aa48701589955bdabd627c0c3eb13",
  },
  "serif-sinhala": {
    file: "NotoSerifSinhala-Regular.ttf",
    sha256: "0d5a63d34ed378e345ec96021d72385c8e288ecd0ea36511a329aed448ede375",
  },
  "serif-tamil": {
    file: "NotoSerifTamil-Regular.ttf",
    sha256: "8a8cb015a3afec2998e01aabcb42fb365994132d95dbc2150208b4fefd8dc2e4",
  },
  "serif-telugu": {
    file: "NotoSerifTelugu-Regular.ttf",
    sha256: "2b376e0351fb140f2edad9c54e8977f4f1effc4fe72443e152b3f6ad392c6f5f",
  },
  "serif-thai": {
    file: "NotoSerifThai-Regular.ttf",
    sha256: "747b5bb1fdd329850ddd3218d872a3d2a96ab0dd544f51e5300c6d1b12071b62",
  },
  emoji: {
    file: "CreditFigureEmoji.ttf",
    sha256: "e35e380f5ea3d23efb4c9093ced5d5600d1af059feab7fc130ad10824d99416d",
  },
  harfbuzz: {
    file: "harfbuzz.wasm",
    sha256: "6eeed8e1bc9ad7773038e48ff8f9e07e0ad228572c594b45e5357e9c2f7a0b2e",
  },
  "harfbuzz-subset": {
    file: "harfbuzz-subset.wasm",
    sha256: "62415fe6bad92ef16f3e5d2dbed6c66a4adec7f5a59c6d27084811c92cce1ba5",
  },
};

const CDN = `https://cdn.jsdelivr.net/npm/credit-matrix-fonts@${FIGURE_FONTS_VERSION}/`;

// Kept dynamic: the same module runs in the browser, where Node's modules do not exist.
export function nodeModule<T>(name: string): Promise<T> {
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
  const { isAbsolute, join } = await nodeModule<typeof import("node:path")>("node:path");
  // The XDG spec says to ignore a relative XDG_CACHE_HOME.
  const xdg = process.env.XDG_CACHE_HOME;
  const base =
    (xdg && isAbsolute(xdg) ? xdg : undefined) ||
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
    // The largest face is 15 MB; two minutes fits a slow link but stops a stalled one.
    const response = await fetch(`${CDN}${file}`, {
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    throw new Error(
      `Cannot load figure font ${file} (${error instanceof Error ? error.message : String(error)}). Install the fonts next to credit-matrix with \`npm i credit-matrix credit-matrix-fonts\` (or run \`npx -p credit-matrix -p credit-matrix-fonts credit-matrix\`), or connect to the internet once to download them.`,
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
      .catch(() => fs.rm(partial, { force: true }).catch(() => undefined));
  }
  return bytes;
}

/**
 * The installed `credit-matrix-fonts` package when it resolves and has the face, otherwise the checked,
 * cached download. An older 1.x package can lack a face a newer core asks for (a RangeError); any other
 * failure of an installed package, or bytes that do not match the pinned hash, is an error, not a download.
 */
export async function defaultFigureFonts(face: FigureFace): Promise<Uint8Array> {
  const installed = await nodeModule<{ fonts: FigureFontProvider }>("credit-matrix-fonts").catch(() => undefined);
  if (!installed) return downloadFigureFont(face);
  let bytes: Uint8Array;
  try {
    bytes = await installed.fonts(face);
  } catch (error) {
    if (error instanceof RangeError) return downloadFigureFont(face);
    throw error;
  }
  const { file, sha256: expected } = FIGURE_FONT_FILES[face];
  if ((await sha256(bytes)) !== expected)
    throw new Error(
      `The installed credit-matrix-fonts has a ${file} that does not match its SHA-256 hash, so it was not used. Reinstall credit-matrix-fonts ${FIGURE_FONTS_VERSION} or later 1.x.`,
    );
  return bytes;
}
