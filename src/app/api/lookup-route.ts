import { type NextRequest, NextResponse } from "next/server";

/**
 * Every failure carries a stable `code` plus an English `error`.
 *
 * The client localizes from the code; the message is the fallback for a client
 * that meets a code it does not know, and what shows up in logs and `curl`.
 * Codes are API surface: add new ones rather than renaming existing ones.
 */
export function errorResponse(status: number, code: string, error: string) {
  return NextResponse.json({ code, error }, { status });
}

/** A lookup body is one short identifier; anything near this is not ours. */
const MAX_BODY_BYTES = 4096;

/**
 * Read one string field from the JSON body.
 *
 * Returns the field's value ("" when the body carries no such string, so the
 * lookup's own validation rejects it), or null when the body is not JSON at all
 * or is over MAX_BODY_BYTES. The cap holds on the bytes actually read, not
 * just the declared Content-Length, which a chunked body does not carry.
 */
export async function readStringField(request: NextRequest, name: string): Promise<string | null> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return null;
  let body: unknown;
  try {
    const decoder = new TextDecoder();
    let text = "";
    let total = 0;
    const reader = request.body?.getReader();
    for (;;) {
      const chunk = await reader?.read();
      if (!chunk || chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader?.cancel();
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    body = JSON.parse(text + decoder.decode());
  } catch {
    return null;
  }
  if (body !== null && typeof body === "object" && name in body) {
    const value = (body as Record<string, unknown>)[name];
    if (typeof value === "string") return value;
  }
  return "";
}
