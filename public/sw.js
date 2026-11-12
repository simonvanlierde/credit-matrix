/**
 * Offline support.
 *
 * Everything except the ORCID and DOI lookups works without a network, so the
 * app only needs its own files back. The citation converter's runtime under
 * /citesync/ (about 13 MB) is not precached: the first CITATION.cff or
 * .zenodo.json import fetches it through the same-origin rule below, and later
 * imports with the same build run offline. Of the figure fonts (/assets/*.ttf,
 * about 40 MB), Noto Sans, the default face, is precached with the font
 * subsetter (harfbuzz-subset.wasm) every export uses; the others load on
 * the first export that needs them.
 *
 * - install: precache every page but the docs, and every asset they
 *   reference, so a new version is complete offline before it takes over. A
 *   docs page, its chunk and its images are cached when someone visits it.
 * - navigations: network first (bounded), that path's cached page as the
 *   fallback, or the app's page for any other path
 * - other same-origin GETs: cache first, unhashed ones refreshed in the background
 * - cross-origin (the ORCID, Crossref, and DataCite lookups): never cached, so a lookup
 *   fails honestly when offline
 *
 * The cache is named per build (scripts/postbuild.mjs stamps BUILD_ID), so
 * activating a new version drops the previous build's chunks instead of
 * letting them pile up. It first fetches the docs pages, and search, that
 * the old caches held, so a visited docs page stays offline.
 *
 */

const CACHE = "credit-matrix-BUILD_ID";
// Stamped by postbuild so lazy pages and languages also work on their first offline visit.
const ASSETS = [];
// Search is warmed on the first docs visit, never during app installation.
const SEARCH_ASSETS = [];
const DOCS_ASSETS = {};
let searchCaching;

self.addEventListener("message", (event) => {
  if (event.data?.type !== "cache-docs-search") return;
  const source = event.source?.url;
  if (!source) return;
  const url = new URL(source);
  if (url.origin !== self.location.origin || !/^\/docs(?:\/|$)/.test(url.pathname) || !PAGES.includes(url.pathname))
    return;
  searchCaching ??= cachePaths(SEARCH_ASSETS).catch(() => {
    // Retry on a later docs visit after a failed connection or quota write.
    searchCaching = undefined;
  });
  // A direct first visit loads before the worker controls navigations or chunk requests.
  event.waitUntil(
    Promise.all([searchCaching, cachePaths([url.pathname, ...(DOCS_ASSETS[url.pathname] ?? [])])]).catch(() => {
      // Storage failures only cost the offline copy; retry on the next visit.
    }),
  );
});

async function cachePaths(paths) {
  const cache = await caches.open(CACHE);
  const missing = [];
  for (const path of paths) {
    if (!(await cache.match(path))) missing.push(path);
  }
  // no-cache: the HTTP cache may still hold a page from the previous build.
  // Warming search can fetch many files; bound it without using the shorter navigation deadline.
  const signal = AbortSignal.timeout(15_000);
  await cache.addAll(missing.map((path) => new Request(path, { cache: "no-cache", signal })));
}

// Every page, stamped by postbuild from src/routes.ts: a visit caches it for offline use.
const PAGES = [];
// The pages install fetches, also stamped by postbuild: every page but the docs (budget).
const PRECACHED_PAGES = [];

// Past this, a hanging connection falls back to the cached page instead of
// leaving a blank tab until the browser's own network timeout.
const NAVIGATION_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(dropOldCaches());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(request.mode === "navigate" ? handleNavigation(request) : handleAsset(request, event));
});

/** The precached pages plus every script, style and font they link, fetched fresh. */
async function precache() {
  const cache = await caches.open(CACHE);
  const pages = await Promise.all(
    PRECACHED_PAGES.map(async (path) => {
      const page = await fetch(path, { cache: "no-cache" });
      if (!page.ok) throw new Error(`precache: ${path} answered ${page.status}`);
      return [path, page, await page.clone().text()];
    }),
  );
  // The inline payload repeats these URLs JSON-escaped (`…js\"`) and can split
  // one across two script chunks (`/fonts/newsreader-ital"])`). Take only
  // URLs that end in a file extension, or one cut-off URL fails addAll and
  // with it the install.
  const assets = new Set([
    ...ASSETS,
    ...pages.flatMap(
      ([, , html]) => html.match(/\/(?:assets|fonts)\/[^"'\s)\\]+\.(?:js|css|woff2)(?=["'\s)\\])/g) ?? [],
    ),
  ]);
  await cache.addAll([...assets]);
  await Promise.all(pages.map(([path, page]) => cache.put(path, page)));
}

/** The cached page that answers a path: its own, or the app's for any other path. */
function pageFor(url) {
  const path = new URL(url).pathname.replace(/(?:\/|\.html)$/, "") || "/";
  return PAGES.includes(path) ? path : "/";
}

async function cachedPage(request) {
  return (await caches.match(pageFor(request.url))) ?? (await caches.match("/"));
}

async function dropOldCaches() {
  const old = (await caches.keys()).filter((key) => key !== CACHE);
  await carryVisitedDocs(old.filter((key) => key.startsWith("credit-matrix-"))).catch(() => {
    // Reading an old cache failed: those docs lose their offline copy, the update still activates.
  });
  await Promise.all(old.map((key) => caches.delete(key)));
  await self.clients.claim();
}

/**
 * Install skips the docs, so the docs pages and search an older build cached on a visit are fetched
 * again for this build before its cache goes; otherwise a deploy costs them their offline copy.
 */
async function carryVisitedDocs(keys) {
  const visited = new Set();
  let search = false;
  for (const key of keys) {
    for (const request of await (await caches.open(key)).keys()) {
      const path = new URL(request.url).pathname;
      if (/^\/docs(?:\/|$)/.test(path) && PAGES.includes(path)) visited.add(path);
      search ||= path.startsWith("/pagefind/");
    }
  }
  // Pages and search apart, so a failed search fetch still keeps the pages. A failure here only
  // costs an offline copy; activation goes on.
  await Promise.allSettled([
    cachePaths([...visited].flatMap((path) => [path, ...(DOCS_ASSETS[path] ?? [])])),
    search && cachePaths(SEARCH_ASSETS),
  ]);
}

/** Network first: an online visitor always gets the freshest document. */
async function handleNavigation(request) {
  try {
    const response = await fetch(request, { signal: AbortSignal.timeout(NAVIGATION_TIMEOUT_MS) });
    // A server error is not a better answer than the working copy on hand.
    if (response.status >= 500) return (await cachedPage(request)) ?? response;
    // Share links live in the fragment, which never reaches the server, so the
    // app's page answers every path that is not one of the other pages. Only a
    // page itself may refresh its cached copy: the manifest or an image opened
    // directly must not replace the offline shell.
    const path = new URL(request.url).pathname;
    if (response.ok && PAGES.includes(path)) await cachePut(path, response.clone());
    return response;
  } catch {
    return (await cachedPage(request)) ?? Response.error();
  }
}

/** Cache first: hashed asset URLs are never stale; unhashed ones refresh in the background. */
async function handleAsset(request, event) {
  const cached = await caches.match(request);
  if (cached) {
    // /assets/ URLs are content-hashed, /fonts/ files are renamed rather than
    // changed, and a /citesync/ change gives a new build id (postbuild hashes
    // the runtime), so their cached copy is the final word; only other
    // assets (favicon, manifest) can change in place. waitUntil keeps the
    // worker alive until the refresh lands.
    if (!/^\/(?:assets|fonts|citesync|pagefind)\//.test(new URL(request.url).pathname))
      event.waitUntil(refresh(request));
    return cached;
  }
  return fetch(request).then(async (response) => {
    if (response.ok) await cachePut(request, response.clone());
    return response;
  });
}

async function refresh(request) {
  try {
    const response = await fetch(request);
    if (response.ok) await cachePut(request, response);
  } catch {
    // Offline, or the asset is gone: the cached copy already answered.
  }
}

async function cachePut(request, response) {
  // Best-effort: a failed write (storage quota, some private modes) must not
  // cost the caller a response the network already delivered.
  try {
    const cache = await caches.open(CACHE);
    await cache.put(request, response);
  } catch {
    // Only the offline copy is lost; the live response was already returned.
  }
}
