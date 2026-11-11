// biome-ignore-all lint/correctness/noNodejsModules: static site build script.
import { readFile, writeFile } from "node:fs/promises";
import { render } from "../.vite-ssr/entry-server.mjs";

const manifest = JSON.parse(await readFile("out/.vite/manifest.json", "utf8"));
const template = await readFile("out/index.html", "utf8");
const escapeAttribute = (text) =>
  String(text).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
// JSON inside an inline <script>: escape the characters that could end the tag or break the JS string.
const scriptJson = (value) =>
  JSON.stringify(value).replace(/[<>/\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
// The prerendered page paints without script, so the scripts start downloading once the first paint is out,
// not beside the HTML, CSS and fonts that frame needs. On a slow link they compete with that frame's bytes: before this, the scripts delayed the
// first-run card's paint by seconds. A document.open() iframe keeps the load event pending until the
// scripts are inserted, so a click made once the page has loaded is not lost to an unhydrated page.
const deferScripts = (html) => {
  const tags = [];
  const rest = html.replace(/<link rel="modulepreload"[^>]*>|<script type="module"[^>]*><\/script>/g, (tag) => {
    tags.push(tag);
    return "";
  });
  if (!tags.some((tag) => tag.startsWith("<script"))) throw new Error("prerender: no module script to defer");
  const urls = tags.map((tag) => [
    tag.startsWith("<script") ? "script" : "link",
    tag.match(/(?:href|src)="([^"]+)"/)[1],
  ]);
  const loader = `<script>{const hold=document.body.appendChild(document.createElement("iframe"));hold.hidden=true;hold.contentDocument.open();let done=0;const go=()=>{if(done++)return;for(const[k,u]of ${scriptJson(urls)}){const e=document.createElement(k);if(k==="script")e.type="module";else e.rel="modulepreload";e[k==="script"?"src":"href"]=u;document.head.append(e)}hold.remove()};new PerformanceObserver(()=>go()).observe({type:"paint",buffered:true});setTimeout(go,1500)}</script>`;
  return rest.replace("</body>", () => `${loader}</body>`);
};
const description =
  "Assign the 14 CRediT roles in a contribution matrix, export the author statement in nine languages, and download the contribution heatmap. Open source; your contribution data stays in your browser.";
for (const path of ["/", "/about", "/census", "/accessibility"]) {
  const { html, metadata } = await render(path);
  const source = path === "/" ? "src/app/page.tsx" : `src/app${path}/page.tsx`;
  const chunks = new Set();
  const preload = (key) => {
    const chunk = manifest[key];
    if (!chunk) throw new Error(`prerender: no manifest entry for ${key}`);
    if (chunks.has(chunk.file)) return;
    chunks.add(chunk.file);
    for (const imported of chunk.imports ?? []) preload(imported);
  };
  preload(source);
  if (chunks.size === 0) throw new Error(`prerender: no chunks for ${path} (${source})`);
  // Vite already preloads the entry's static imports in the template; list only the rest.
  const preloads = [...chunks]
    .filter((file) => !template.includes(`href="/${file}"`))
    .map((file) => `<link rel="modulepreload" href="/${file}">`)
    .join("");
  const title = metadata.title ?? "CRediT Matrix · CRediT author statement generator";
  const tags = `<meta name="description" content="${escapeAttribute(metadata.description ?? description)}"><link rel="canonical" href="https://credit.duinlab.nl${path}"><meta property="og:type" content="website"><meta property="og:site_name" content="CRediT Matrix"><meta property="og:title" content="${escapeAttribute(title)}"><meta property="og:description" content="${escapeAttribute(metadata.description ?? description)}"><meta property="og:url" content="https://credit.duinlab.nl${path}"><meta property="og:image" content="https://credit.duinlab.nl/opengraph-image.png"><meta property="og:image:alt" content="CRediT Matrix contribution statement generator"><meta name="twitter:card" content="summary_large_image">`;
  await writeFile(
    `out/${path === "/" ? "index" : path.slice(1)}.html`,
    deferScripts(
      template
        .replace(/<title>.*?<\/title>/, `<title>${escapeAttribute(title)}</title>`)
        .replace("<!--metadata-->", tags + preloads)
        .replace("<!--app-->", () => html),
    ),
  );
}
await writeFile(
  "out/404.html",
  deferScripts(
    template
      .replace(/<title>.*?<\/title>/, "<title>Page not found · CRediT Matrix</title>")
      .replace("<!--app-->", '<p>Page not found. <a href="/">Return to CRediT Matrix</a>.</p>'),
  ),
);
