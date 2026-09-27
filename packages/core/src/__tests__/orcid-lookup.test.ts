import { describe, expect, it, vi } from "vitest";
import { lookupOrcidPerson } from "../orcid-lookup";

describe("lookupOrcidPerson", () => {
  it("rejects invalid IDs without calling upstream", async () => {
    const fetcher = vi.fn<typeof fetch>();

    // The `code` is the contract clients localize from; `error` is the English
    // fallback that rides along for logs and for a client that predates a code.
    expect(await lookupOrcidPerson("0000-0002-1825-0098", fetcher)).toEqual({
      ok: false,
      status: 400,
      code: "INVALID_ID",
      error: "That is not a valid ORCID iD. Check the digits and try again.",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps network, upstream, missing-name, and valid responses", async () => {
    const unavailable = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    expect(await lookupOrcidPerson("0000-0002-1825-0097", unavailable)).toMatchObject({ status: 502 });

    const notFound = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
    expect(await lookupOrcidPerson("0000-0002-1825-0097", notFound)).toMatchObject({ status: 404 });

    const malformed = vi.fn<typeof fetch>().mockResolvedValue(new Response("not json", { status: 200 }));
    expect(await lookupOrcidPerson("0000-0002-1825-0097", malformed)).toMatchObject({ status: 502 });

    const nameless = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ name: null }), { status: 200 }));
    expect(await lookupOrcidPerson("0000-0002-1825-0097", nameless)).toMatchObject({ status: 404 });

    const valid = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ name: { "given-names": { value: "Jane" }, "family-name": { value: "Smith" } } }),
          { status: 200 },
        ),
      );
    expect(await lookupOrcidPerson("0000-0002-1825-0097", valid)).toEqual({
      ok: true,
      firstName: "Jane",
      surname: "Smith",
      displayName: "Jane Smith",
    });
  });

  it("keeps the name parts a partial or malformed record does have", async () => {
    const respond = (name: unknown) =>
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ name }), { status: 200 }));

    expect(
      await lookupOrcidPerson(
        "0000-0002-1825-0097",
        respond({ "given-names": { value: 5 }, "family-name": { value: "Curie" } }),
      ),
    ).toEqual({ ok: true, firstName: "", surname: "Curie", displayName: "Curie" });
    expect(await lookupOrcidPerson("0000-0002-1825-0097", respond({ "given-names": { value: "Marie" } }))).toEqual({
      ok: true,
      firstName: "Marie",
      surname: "",
      displayName: "Marie",
    });
  });

  // Codes are API surface: a client localizes from them, so renaming one
  // breaks every older client. Adding is safe; renaming is not.
  it("returns a stable code and an English fallback for every failure", async () => {
    const cases: [() => ReturnType<typeof fetch> | Promise<never>, string, number][] = [
      [() => Promise.reject(new Error("offline")), "UNAVAILABLE", 502],
      [() => Promise.resolve(new Response(null, { status: 404 })), "NOT_FOUND", 404],
      [() => Promise.resolve(new Response(null, { status: 500 })), "UNAVAILABLE", 502],
      [() => Promise.resolve(new Response("not json", { status: 200 })), "UNAVAILABLE", 502],
    ];

    for (const [respond, code, status] of cases) {
      const result = await lookupOrcidPerson("0000-0002-1825-0097", vi.fn().mockImplementation(respond));
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected a failure");
      expect(result.code, `wrong code for status ${status}`).toBe(code);
      expect(result.status).toBe(status);
      // The English fallback must never be blank; an unknown-code client shows it.
      expect(result.error.trim().length).toBeGreaterThan(0);
    }

    const invalid = await lookupOrcidPerson("0000-0002-1825-0098", vi.fn());
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.code).toBe("INVALID_ID");
  });
});
