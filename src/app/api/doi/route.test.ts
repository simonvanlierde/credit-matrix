import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCloudflareContext, lookupDoiWork } = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  lookupDoiWork: vi.fn(),
}));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext }));
vi.mock("@credit-generator/core", () => ({ lookupDoiWork }));

import { POST } from "./route";

function request(body: unknown, headers: Record<string, string> = {}): NextRequest {
  const init: RequestInit = { method: "POST", headers };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("http://localhost/api/doi", init) as unknown as NextRequest;
}

describe("POST /api/doi", () => {
  beforeEach(() => {
    getCloudflareContext.mockReset();
    lookupDoiWork.mockReset();
    // Off Workers (no context), checkRateLimit stays out of the way.
    getCloudflareContext.mockImplementation(() => {
      throw new Error("no workers context");
    });
  });

  it("rejects a cross-site request before touching the lookup", async () => {
    const response = await POST(
      request({ doi: "10.1234/abcde" }, { origin: "https://evil.example", host: "localhost" }),
    );
    expect(response.status).toBe(403);
    expect(lookupDoiWork).not.toHaveBeenCalled();
  });

  it("rejects a rate-limited request before touching the lookup", async () => {
    getCloudflareContext.mockReturnValue({ env: { API_RATE_LIMITER: { limit: async () => ({ success: false }) } } });
    const response = await POST(request({ doi: "10.1234/abcde" }));
    expect(response.status).toBe(429);
    expect(lookupDoiWork).not.toHaveBeenCalled();
  });

  it("rejects a malformed JSON body before touching the lookup", async () => {
    const response = await POST(request("not json"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "BAD_REQUEST" });
    expect(lookupDoiWork).not.toHaveBeenCalled();
  });

  it("returns the lookup result on the happy path", async () => {
    lookupDoiWork.mockResolvedValue({ ok: true, title: "A Paper", authors: [{ name: "Jane Smith" }] });
    const response = await POST(request({ doi: "10.1234/abcde" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, title: "A Paper" });
    expect(lookupDoiWork).toHaveBeenCalledWith("10.1234/abcde", expect.any(Function), "credit@duinlab.nl");
  });
});
