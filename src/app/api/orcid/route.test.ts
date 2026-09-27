import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCloudflareContext, lookupOrcidPerson } = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  lookupOrcidPerson: vi.fn(),
}));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext }));
vi.mock("@credit-generator/core", () => ({ lookupOrcidPerson }));

import { POST } from "./route";

function request(body: unknown, headers: Record<string, string> = {}): NextRequest {
  const init: RequestInit = { method: "POST", headers };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("http://localhost/api/orcid", init) as unknown as NextRequest;
}

describe("POST /api/orcid", () => {
  beforeEach(() => {
    getCloudflareContext.mockReset();
    lookupOrcidPerson.mockReset();
    // Off Workers (no context), checkRateLimit stays out of the way.
    getCloudflareContext.mockImplementation(() => {
      throw new Error("no workers context");
    });
  });

  it("rejects a cross-site request before touching the lookup", async () => {
    const response = await POST(
      request({ id: "0000-0002-1825-0097" }, { origin: "https://evil.example", host: "localhost" }),
    );
    expect(response.status).toBe(403);
    expect(lookupOrcidPerson).not.toHaveBeenCalled();
  });

  it("rejects a rate-limited request before touching the lookup", async () => {
    getCloudflareContext.mockReturnValue({ env: { API_RATE_LIMITER: { limit: async () => ({ success: false }) } } });
    const response = await POST(request({ id: "0000-0002-1825-0097" }));
    expect(response.status).toBe(429);
    expect(lookupOrcidPerson).not.toHaveBeenCalled();
  });

  it("rejects a malformed JSON body before touching the lookup", async () => {
    const response = await POST(request("not json"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "BAD_REQUEST" });
    expect(lookupOrcidPerson).not.toHaveBeenCalled();
  });

  it("returns the lookup result on the happy path", async () => {
    lookupOrcidPerson.mockResolvedValue({ ok: true, firstName: "Jane", surname: "Smith", displayName: "Jane Smith" });
    const response = await POST(request({ id: "0000-0002-1825-0097" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, displayName: "Jane Smith" });
    expect(lookupOrcidPerson).toHaveBeenCalledWith("0000-0002-1825-0097");
  });
});
