import { getCloudflareContext } from "@opennextjs/cloudflare";
import { type NextRequest, NextResponse } from "next/server";

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * One limiter for the whole API surface. Both upstream proxies (ORCID, DOI)
 * are cheap lookups on behalf of the same person filling in one draft, so a
 * shared bucket is the honest unit: it caps what a single client can push
 * through us, rather than granting a fresh allowance per endpoint.
 */
const BINDING = "API_RATE_LIMITER";

/**
 * How many limiter faults in a row still fail open. One fault is a blip; a
 * streak means the limiter is down, and an unthrottled public proxy is not an
 * acceptable fallback for long. Counted per isolate, reset by any success.
 */
const FAIL_CLOSED_AFTER = 5;
let consecutiveFailures = 0;

const UNAVAILABLE = { code: "UNAVAILABLE", error: "Lookups are temporarily unavailable." };

/**
 * The bucket a client address spends from. IPv4 is keyed as is. An IPv6
 * client typically holds a whole /64 and can rotate through it freely, so it
 * is keyed by that prefix, expanded so every spelling of it is one bucket.
 */
export function rateLimitKey(address: string): string {
  if (!address.includes(":")) return address;
  // An IPv4-mapped address (::ffff:203.0.113.9) is that IPv4 client.
  const mapped = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (mapped?.[1]) return mapped[1];
  const [head = "", tail] = (address.toLowerCase().split("%")[0] ?? "").split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const zeros = Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0");
  const groups = tail === undefined ? left : [...left, ...zeros, ...right];
  const prefix = groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, ""));
  return `${prefix.join(":")}::/64`;
}

/**
 * Reject a request another site made a visitor's browser send.
 *
 * The proxies hold no state and no credentials, but a drive-by page could
 * otherwise burn a visitor's rate-limit bucket and use their IP to scrape
 * Crossref/ORCID through this domain. Browsers always attach `Origin` to a
 * cross-origin POST; a missing header is a same-origin fetch or a non-browser
 * client, both of which spend only their own bucket.
 */
export function checkSameOrigin(request: NextRequest): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const host = request.headers.get("host");
  try {
    if (host && new URL(origin).host === host) return null;
  } catch {
    // An unparseable Origin ("null", garbage) is nothing we serve.
  }
  return NextResponse.json({ code: "FORBIDDEN", error: "Cross-site requests are not accepted." }, { status: 403 });
}

/** A 429 response when this client is over the limit, otherwise null. */
export async function checkRateLimit(request: NextRequest): Promise<NextResponse | null> {
  let env: Record<string, unknown>;
  try {
    env = getCloudflareContext().env as Record<string, unknown>;
  } catch {
    // No Workers context at all: `next dev` or a local `next start`. Expected
    // off Workers, stay quiet. The deployed Worker always has a context, so
    // this branch cannot swallow a production fault.
    return null;
  }

  const limiter = (env[BINDING] as RateLimiter | undefined) ?? null;
  if (!limiter) {
    // We *are* on Workers but the binding is missing (renamed in
    // wrangler.jsonc, or a deploy that predates it). That is a persistent
    // misconfiguration, and an unthrottled public proxy is not an acceptable
    // fallback: refuse lookups so the fault is seen and fixed.
    // biome-ignore lint/suspicious/noConsole: deliberate operational warning
    console.error(`${BINDING} binding missing; refusing lookups rather than proxying unthrottled.`);
    return NextResponse.json(UNAVAILABLE, { status: 503 });
  }

  // Behind the Cloudflare edge, `cf-connecting-ip` is set by the edge and
  // cannot be spoofed by the client. The `x-forwarded-for` fallback is only
  // reachable off-CF, where it would be client-controlled: take the first hop
  // and treat a missing value as one shared bucket rather than a free pass.
  const clientKey = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown";
  let success: boolean;
  try {
    ({ success } = await limiter.limit({ key: rateLimitKey(clientKey.split(",")[0]?.trim() || "unknown") }));
  } catch {
    consecutiveFailures += 1;
    if (consecutiveFailures >= FAIL_CLOSED_AFTER) {
      // biome-ignore lint/suspicious/noConsole: deliberate operational warning
      console.error(`${BINDING} limit() failed ${consecutiveFailures} times in a row; failing closed.`);
      return NextResponse.json(UNAVAILABLE, { status: 503 });
    }
    // A transient limiter fault is not the client's fault: unlike the missing
    // binding above, this heals on its own, so fail open for this request
    // rather than turning a working lookup into a 500.
    // biome-ignore lint/suspicious/noConsole: deliberate operational warning
    console.error(`${BINDING} limit() failed; letting this request through.`);
    return null;
  }
  consecutiveFailures = 0;
  if (success) return null;
  return NextResponse.json(
    { code: "RATE_LIMITED", error: "Too many lookups. Try again in a minute." },
    { status: 429 },
  );
}
