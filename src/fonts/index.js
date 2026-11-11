// Literal URLs, so bundlers emit each face as its own hashed file.
const URLS = {
  sans: new URL("./NotoSans-Regular.ttf", import.meta.url),
  "sans-jp": new URL("./CreditFigureJP.ttf", import.meta.url),
  "sans-sc": new URL("./CreditFigureSC.ttf", import.meta.url),
  serif: new URL("./NotoSerif-Regular.ttf", import.meta.url),
  "serif-jp": new URL("./CreditFigureSerifJP.ttf", import.meta.url),
  "serif-sc": new URL("./CreditFigureSerifSC.ttf", import.meta.url),
  "sans-kr": new URL("./CreditFigureKR.ttf", import.meta.url),
  "sans-arabic": new URL("./NotoSansArabic-Regular.ttf", import.meta.url),
  "sans-armenian": new URL("./NotoSansArmenian-Regular.ttf", import.meta.url),
  "sans-bengali": new URL("./NotoSansBengali-Regular.ttf", import.meta.url),
  "sans-devanagari": new URL("./NotoSansDevanagari-Regular.ttf", import.meta.url),
  "sans-ethiopic": new URL("./NotoSansEthiopic-Regular.ttf", import.meta.url),
  "sans-georgian": new URL("./NotoSansGeorgian-Regular.ttf", import.meta.url),
  "sans-gujarati": new URL("./NotoSansGujarati-Regular.ttf", import.meta.url),
  "sans-gurmukhi": new URL("./NotoSansGurmukhi-Regular.ttf", import.meta.url),
  "sans-hebrew": new URL("./NotoSansHebrew-Regular.ttf", import.meta.url),
  "sans-kannada": new URL("./NotoSansKannada-Regular.ttf", import.meta.url),
  "sans-khmer": new URL("./NotoSansKhmer-Regular.ttf", import.meta.url),
  "sans-lao": new URL("./NotoSansLao-Regular.ttf", import.meta.url),
  "sans-malayalam": new URL("./NotoSansMalayalam-Regular.ttf", import.meta.url),
  "sans-myanmar": new URL("./NotoSansMyanmar-Regular.ttf", import.meta.url),
  "sans-oriya": new URL("./NotoSansOriya-Regular.ttf", import.meta.url),
  "sans-sinhala": new URL("./NotoSansSinhala-Regular.ttf", import.meta.url),
  "sans-tamil": new URL("./NotoSansTamil-Regular.ttf", import.meta.url),
  "sans-telugu": new URL("./NotoSansTelugu-Regular.ttf", import.meta.url),
  "sans-thai": new URL("./NotoSansThai-Regular.ttf", import.meta.url),
  emoji: new URL("./CreditFigureEmoji.ttf", import.meta.url),
  harfbuzz: new URL("./harfbuzz.wasm", import.meta.url),
};

/** Read one face's bytes: from disk in Node, over HTTP from a bundle's assets in a browser. */
export async function fonts(face) {
  const url = URLS[face];
  if (!url) throw new RangeError(`Unknown figure font face: ${face}.`);
  if (url.protocol === "file:") {
    // Kept dynamic: the same module runs in the browser, where Node's filesystem does not exist.
    const nodeFilesystem = "node:fs/promises";
    const { readFile } = await import(/* @vite-ignore */ nodeFilesystem);
    return new Uint8Array(await readFile(url));
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot load figure font: ${response.status} ${url.pathname}.`);
  return new Uint8Array(await response.arrayBuffer());
}
