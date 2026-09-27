/**
 * Offline support.
 *
 * Everything except the ORCID lookup runs in the browser, so the app only
 * needs its own files back to keep working without a network. There is no
 * build step here on purpose: Next's asset URLs are content-hashed, so a
 * runtime cache is as good as a precache manifest and costs no tooling.
 *
 * - navigations: network first, cached document as the fallback
 * - other same-origin GETs: cache first, refreshed in the background
 * - /api/*: never cached, so an ORCID lookup fails honestly when offline
 *
 * NOTE: nothing is precached, so the first visit must happen online, and a
 * chunk that has never loaded (a locale, a lazy modal) is missing offline.
 * Precache the build manifest if that ceiling starts to bite.
 *
 * NOTE: the runtime cache is never pruned, so content-hashed chunks from past
 * deploys accumulate until the browser evicts the whole cache under storage
 * pressure. Add age-based eviction on activate if that starts to bite.
 */

const CACHE = "credit-matrix-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(dropOldCaches());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  event.respondWith(request.mode === "navigate" ? handleNavigation(request) : handleAsset(request));
});

async function dropOldCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
  await self.clients.claim();
}

/** Network first: an online visitor always gets the freshest document. */
async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    // Share links live in the fragment, which never reaches the server, so one
    // cached document answers every URL of this app. Only the app's own page
    // may become that document: /health or an image opened directly must not
    // replace the offline shell.
    if (response.ok && new URL(request.url).pathname === "/") await cachePut("/", response.clone());
    return response;
  } catch {
    return (await caches.match("/")) ?? Response.error();
  }
}

/** Cache first: hashed asset URLs are never stale; unhashed ones refresh in the background. */
async function handleAsset(request) {
  const cached = await caches.match(request);
  if (cached) {
    // /_next/static/ URLs are content-hashed, so their cached copy is the
    // final word; only unhashed assets (favicon, manifest) can change in place.
    if (!new URL(request.url).pathname.startsWith("/_next/static/")) void refresh(request);
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
