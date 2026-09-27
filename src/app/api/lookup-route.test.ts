import type { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { readStringField } from "./lookup-route";

function post(body: BodyInit, headers: Record<string, string> = {}): NextRequest {
  return new Request("http://localhost/api/doi", { method: "POST", body, headers }) as unknown as NextRequest;
}

/** A body with no Content-Length, the way a chunked upload arrives. */
function streamed(text: string): NextRequest {
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 1024) controller.enqueue(bytes.slice(i, i + 1024));
      controller.close();
    },
  });
  return new Request("http://localhost/api/doi", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit) as unknown as NextRequest;
}

describe("readStringField", () => {
  it("reads a string field, and treats a missing one as empty", async () => {
    expect(await readStringField(post(JSON.stringify({ doi: "10.1038/x" })), "doi")).toBe("10.1038/x");
    expect(await readStringField(post(JSON.stringify({ other: 1 })), "doi")).toBe("");
    expect(await readStringField(post("not json"), "doi")).toBeNull();
  });

  it("refuses a body over the cap by its declared length, before reading it", async () => {
    const small = JSON.stringify({ doi: "10.1038/x" });
    expect(await readStringField(post(small, { "content-length": "1000000" }), "doi")).toBeNull();
  });

  it("refuses an oversized body that declares no length", async () => {
    expect(await readStringField(streamed(JSON.stringify({ doi: "x".repeat(5000) })), "doi")).toBeNull();
    expect(await readStringField(streamed(JSON.stringify({ doi: "10.1038/x" })), "doi")).toBe("10.1038/x");
  });
});
