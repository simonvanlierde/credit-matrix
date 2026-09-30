/**
 * The one upstream JSON fetch both lookups share: same headers,
 * same deadline, same failure ladder. Each caller maps the kinds onto its own
 * error codes and messages and parses the body with its own schema.
 */
export type UpstreamResult = { kind: "ok"; body: unknown } | { kind: "not-found" } | { kind: "unavailable" };

/** Upstream deadline. Crossref and ORCID both normally answer well inside this. */
const UPSTREAM_TIMEOUT_MS = 5000;

export async function fetchUpstreamJson(url: string, fetcher: typeof fetch): Promise<UpstreamResult> {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { Accept: "application/json" },
      // Without a deadline a hung upstream leaves the lookup spinning.
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return { kind: "unavailable" };
  }

  if (response.status === 404) return { kind: "not-found" };
  if (!response.ok) return { kind: "unavailable" };

  try {
    return { kind: "ok", body: await response.json() };
  } catch {
    return { kind: "unavailable" };
  }
}
