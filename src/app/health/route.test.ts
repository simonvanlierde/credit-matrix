// biome-ignore lint/correctness/noNodejsModules: vitest runs in Node.
import process from "node:process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getCloudflareContext } = vi.hoisted(() => ({ getCloudflareContext: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext }));

import { GET } from "./route";

describe("GET /health", () => {
  const originalSha = process.env.WORKERS_CI_COMMIT_SHA;

  beforeEach(() => {
    getCloudflareContext.mockReset();
  });

  afterEach(() => {
    if (originalSha === undefined) delete process.env.WORKERS_CI_COMMIT_SHA;
    else process.env.WORKERS_CI_COMMIT_SHA = originalSha;
  });

  it("reports ok off Workers (next dev / next start), with no context to check", async () => {
    getCloudflareContext.mockImplementation(() => {
      throw new Error("no workers context");
    });
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
  });

  it("reports ok when the rate limiter binding is present", async () => {
    getCloudflareContext.mockReturnValue({ env: { API_RATE_LIMITER: {} } });
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
  });

  it("reports 503 when the rate limiter binding is missing on Workers", async () => {
    getCloudflareContext.mockReturnValue({ env: {} });
    const response = GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "unavailable" });
  });

  it('falls back to "dev" when no commit SHA was baked in at build time', async () => {
    delete process.env.WORKERS_CI_COMMIT_SHA;
    getCloudflareContext.mockImplementation(() => {
      throw new Error("no workers context");
    });
    expect(await GET().json()).toMatchObject({ commit: "dev" });
  });

  it("reports the commit SHA baked in at build time", async () => {
    process.env.WORKERS_CI_COMMIT_SHA = "abc1234";
    getCloudflareContext.mockImplementation(() => {
      throw new Error("no workers context");
    });
    expect(await GET().json()).toMatchObject({ commit: "abc1234" });
  });
});
