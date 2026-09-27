import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCloudflareContext } = vi.hoisted(() => ({ getCloudflareContext: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext }));

import { checkRateLimit, checkSameOrigin, rateLimitKey } from "./rate-limit";

function request(headers: Record<string, string> = {}): NextRequest {
  return new Request("http://localhost/api/doi", { method: "POST", headers }) as unknown as NextRequest;
}

function limiterEnv(limit: (options: { key: string }) => Promise<{ success: boolean }>) {
  return { env: { API_RATE_LIMITER: { limit } } };
}

describe("checkRateLimit", () => {
  beforeEach(() => {
    getCloudflareContext.mockReset();
  });

  it("stays out of the way off Workers (next dev / next start)", async () => {
    getCloudflareContext.mockImplementation(() => {
      throw new Error("no workers context");
    });
    expect(await checkRateLimit(request())).toBeNull();
  });

  it("fails closed with a 503 when the binding is missing on Workers", async () => {
    // A renamed binding must be a visible fault, not an unthrottled proxy.
    getCloudflareContext.mockReturnValue({ env: {} });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await checkRateLimit(request());
    expect(response?.status).toBe(503);
    expect(await response?.json()).toMatchObject({ code: "UNAVAILABLE" });
    expect(errorLog).toHaveBeenCalledOnce();
    errorLog.mockRestore();
  });

  it("returns the 429 shape the client maps to RATE_LIMITED", async () => {
    getCloudflareContext.mockReturnValue(limiterEnv(async () => ({ success: false })));
    const response = await checkRateLimit(request());
    expect(response?.status).toBe(429);
    expect(await response?.json()).toMatchObject({ code: "RATE_LIMITED" });
  });

  it("keys on the edge-set client IP, first hop only, with a shared fallback bucket", async () => {
    const limit = vi.fn(async () => ({ success: true }));
    getCloudflareContext.mockReturnValue(limiterEnv(limit));

    expect(await checkRateLimit(request({ "cf-connecting-ip": "203.0.113.9" }))).toBeNull();
    expect(limit).toHaveBeenLastCalledWith({ key: "203.0.113.9" });

    await checkRateLimit(request({ "x-forwarded-for": "198.51.100.7, 203.0.113.9" }));
    expect(limit).toHaveBeenLastCalledWith({ key: "198.51.100.7" });

    // No address at all is one shared bucket, not a free pass per request.
    await checkRateLimit(request());
    expect(limit).toHaveBeenLastCalledWith({ key: "unknown" });
  });

  it("fails open when the limiter itself faults transiently", async () => {
    getCloudflareContext.mockReturnValue(limiterEnv(() => Promise.reject(new Error("limiter unavailable"))));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await checkRateLimit(request())).toBeNull();
    expect(errorLog).toHaveBeenCalledOnce();
    errorLog.mockRestore();
  });
});

describe("checkRateLimit under a failing limiter", () => {
  it("fails closed once the limiter has failed five times in a row, and recovers on success", async () => {
    const limit = vi.fn(async () => ({ success: true }));
    getCloudflareContext.mockReturnValue(limiterEnv(limit));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Start from a clean streak: the module keeps it across requests.
    await checkRateLimit(request());

    limit.mockRejectedValue(new Error("limiter unavailable"));
    for (let i = 0; i < 4; i += 1) expect(await checkRateLimit(request())).toBeNull();
    const closed = await checkRateLimit(request());
    expect(closed?.status).toBe(503);
    expect(await closed?.json()).toMatchObject({ code: "UNAVAILABLE" });
    expect(errorLog).toHaveBeenLastCalledWith(expect.stringContaining("failing closed"));

    // One success ends the streak; the next isolated fault fails open again.
    limit.mockResolvedValueOnce({ success: true });
    expect(await checkRateLimit(request())).toBeNull();
    expect(await checkRateLimit(request())).toBeNull();
    errorLog.mockRestore();
  });
});

describe("rateLimitKey", () => {
  it("leaves IPv4 alone", () => {
    expect(rateLimitKey("203.0.113.9")).toBe("203.0.113.9");
  });

  it("buckets IPv6 by its /64, however the address is written", () => {
    const key = rateLimitKey("2001:db8:85a3:12::1");
    expect(key).toBe(rateLimitKey("2001:0db8:85a3:0012:ffff:0:0:2"));
    expect(key).toBe(rateLimitKey("2001:DB8:85A3:12:abcd::"));
    expect(key).not.toBe(rateLimitKey("2001:db8:85a3:13::1"));
    expect(rateLimitKey("::1")).toBe(rateLimitKey("0:0:0:0:0:0:0:1"));
  });

  it("keys an IPv4-mapped IPv6 address by its IPv4 part", () => {
    expect(rateLimitKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
  });

  it("does not throw on garbage from an off-edge header", () => {
    expect(() => rateLimitKey("1:2:3:4:5:6:7:8:9::10")).not.toThrow();
  });
});

describe("checkSameOrigin", () => {
  it("accepts same-origin and non-browser requests", () => {
    expect(checkSameOrigin(request())).toBeNull();
    expect(checkSameOrigin(request({ origin: "http://localhost", host: "localhost" }))).toBeNull();
  });

  it("rejects a cross-site browser request before it spends a rate bucket", async () => {
    const response = checkSameOrigin(request({ origin: "https://evil.example", host: "localhost" }));
    expect(response?.status).toBe(403);
    expect(await response?.json()).toMatchObject({ code: "FORBIDDEN" });
    // Sandboxed frames send the literal string "null"; nothing we serve.
    expect(checkSameOrigin(request({ origin: "null", host: "localhost" }))?.status).toBe(403);
  });
});
