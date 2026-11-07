// biome-ignore-all lint/correctness/noNodejsModules: static site build script.
import { readFile, writeFile } from "node:fs/promises";
import { render } from "../.vite-ssr/entry-server.mjs";

const manifest = JSON.parse(await readFile("out/.vite/manifest.json", "utf8"));
const template = await readFile("out/index.html", "utf8");
const escapeAttribute = (text) =>
  String(text).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
const description =
  "Assign the 14 CRediT roles in a contribution matrix, export the author statement in nine languages, and download the contribution heatmap. Open source; your contribution data stays in your browser.";
for (const path of ["/", "/about", "/census", "/accessibility"]) {
  const { html, metadata } = await render(path);
  const source = path === "/" ? "src/app/page.tsx" : `src/app${path}/page.tsx`;
  const chunks = new Set();
  const preload = (key) => {
    const chunk = manifest[key];
    if (!chunk || chunks.has(chunk.file)) return;
    chunks.add(chunk.file);
    for (const imported of chunk.imports ?? []) preload(imported);
  };
  preload(source);
  const preloads = [...chunks].map((file) => `<link rel="modulepreload" href="/${file}">`).join("");
  const title = metadata.title ?? "CRediT Matrix · CRediT author statement generator";
  const tags = `<meta name="description" content="${escapeAttribute(metadata.description ?? description)}"><link rel="canonical" href="https://credit.duinlab.nl${path}"><meta property="og:type" content="website"><meta property="og:site_name" content="CRediT Matrix"><meta property="og:title" content="${escapeAttribute(title)}"><meta property="og:description" content="${escapeAttribute(metadata.description ?? description)}"><meta property="og:url" content="https://credit.duinlab.nl${path}"><meta property="og:image" content="https://credit.duinlab.nl/opengraph-image.png"><meta property="og:image:alt" content="CRediT Matrix contribution statement generator"><meta name="twitter:card" content="summary_large_image">`;
  await writeFile(
    `out/${path === "/" ? "index" : path.slice(1)}.html`,
    template
      .replace(/<title>.*?<\/title>/, `<title>${escapeAttribute(title)}</title>`)
      .replace("<!--metadata-->", tags + preloads)
      .replace("<!--app-->", () => html),
  );
}
await writeFile(
  "out/404.html",
  template.replace("<!--app-->", '<p>Page not found. <a href="/">Return to CRediT Matrix</a>.</p>'),
);
