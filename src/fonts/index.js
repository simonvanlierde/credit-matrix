// Literal URLs, so bundlers emit each face as its own hashed file.
const URLS = {
  sans: new URL("./NotoSans-Regular.ttf", import.meta.url),
  "sans-jp": new URL("./CreditFigureJP.ttf", import.meta.url),
  "sans-sc": new URL("./CreditFigureSC.ttf", import.meta.url),
  serif: new URL("./NotoSerif-Regular.ttf", import.meta.url),
  "serif-jp": new URL("./CreditFigureSerifJP.ttf", import.meta.url),
  "serif-sc": new URL("./CreditFigureSerifSC.ttf", import.meta.url),
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
