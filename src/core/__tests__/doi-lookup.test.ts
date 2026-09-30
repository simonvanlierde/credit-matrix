import { describe, expect, it, vi } from "vitest";
import { lookupDoiWork, normalizeDoi } from "../doi-lookup";

/** A minimal Crossref `works` body: only the fields the lookup reads. */
function crossrefResponse(message: unknown): Response {
  return new Response(JSON.stringify({ status: "ok", message }), { status: 200 });
}

describe("normalizeDoi", () => {
  it("strips the resolver prefix and preserves the suffix's case", () => {
    expect(normalizeDoi("https://doi.org/10.1038/S41586-020-2649-2")).toBe("10.1038/S41586-020-2649-2");
    expect(normalizeDoi("  doi:10.1038/x  ")).toBe("10.1038/x");
    expect(normalizeDoi("10.1038/x")).toBe("10.1038/x");
    // Resolver URLs get pasted in every shape a browser bar or a citation offers.
    expect(normalizeDoi("doi.org/10.1038/x")).toBe("10.1038/x");
    expect(normalizeDoi("https://www.doi.org/10.1038/x")).toBe("10.1038/x");
    expect(normalizeDoi("http://dx.doi.org/10.1038/x")).toBe("10.1038/x");
    expect(normalizeDoi("DOI: 10.1038/x")).toBe("10.1038/x");
  });
});

describe("lookupDoiWork", () => {
  it("rejects a malformed DOI without calling upstream", async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(await lookupDoiWork("not-a-doi", fetcher)).toEqual({
      ok: false,
      status: 400,
      code: "INVALID_DOI",
      error: "That is not a valid DOI. It should look like 10.1234/abcde.",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects an implausibly long DOI without calling upstream", async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(await lookupDoiWork(`10.1038/${"x".repeat(301)}`, fetcher)).toMatchObject({ code: "INVALID_DOI" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps network failure, 404, and a malformed body", async () => {
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    expect(await lookupDoiWork("10.1038/x", offline)).toMatchObject({ status: 502, code: "UNAVAILABLE" });

    const missing = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
    expect(await lookupDoiWork("10.1038/x", missing)).toMatchObject({ status: 404, code: "NOT_FOUND" });

    const garbage = vi.fn<typeof fetch>().mockResolvedValue(new Response("not json", { status: 200 }));
    expect(await lookupDoiWork("10.1038/x", garbage)).toMatchObject({ status: 502, code: "UNAVAILABLE" });
  });

  it("reads names, ORCIDs, and the title", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      crossrefResponse({
        title: ["A study of studies"],
        author: [
          { given: "Jane A.", family: "Smith", ORCID: "http://orcid.org/0000-0002-1825-0097" },
          { given: "Bob", family: "White" },
        ],
      }),
    );

    expect(await lookupDoiWork("10.1038/x", fetcher)).toEqual({
      ok: true,
      title: "A study of studies",
      authors: [{ name: "Jane A. Smith", orcid: "0000-0002-1825-0097" }, { name: "Bob White" }],
    });
  });

  it("keeps the name when the ORCID fails its checksum", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        crossrefResponse({ title: ["T"], author: [{ given: "Jane", family: "Smith", ORCID: "0000-0002-1825-0098" }] }),
      );

    expect(await lookupDoiWork("10.1038/x", fetcher)).toEqual({
      ok: true,
      title: "T",
      authors: [{ name: "Jane Smith" }],
    });
  });

  it("accepts a bare `name` entry and drops entries with no usable name", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      crossrefResponse({
        title: ["T"],
        author: [{ name: "The CRediT Working Group" }, { given: "  " }, { family: "" }],
      }),
    );

    expect(await lookupDoiWork("10.1038/x", fetcher)).toEqual({
      ok: true,
      title: "T",
      authors: [{ name: "The CRediT Working Group" }],
    });
  });

  it("reports a record that resolves but lists nobody", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(crossrefResponse({ title: ["T"], author: [] }));
    expect(await lookupDoiWork("10.1038/x", fetcher)).toMatchObject({ status: 422, code: "NO_AUTHORS" });

    const noKey = vi.fn<typeof fetch>().mockResolvedValue(crossrefResponse({ title: ["T"] }));
    expect(await lookupDoiWork("10.1038/x", noKey)).toMatchObject({ status: 422, code: "NO_AUTHORS" });
  });

  it("refuses a record with more contributors than a draft can hold", async () => {
    const author = Array.from({ length: 201 }, (_, i) => ({ given: "A", family: `Author${i}` }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(crossrefResponse({ title: ["T"], author }));
    expect(await lookupDoiWork("10.1038/x", fetcher)).toMatchObject({ status: 422, code: "TOO_MANY_AUTHORS" });
  });

  it("tolerates a missing title", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(crossrefResponse({ author: [{ given: "Jane", family: "Smith" }] }));
    expect(await lookupDoiWork("10.1038/x", fetcher)).toMatchObject({ ok: true, title: "" });
  });
});

describe("polite pool contact", () => {
  it("appends the mailto only when the caller provides one", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request) =>
      crossrefResponse({ title: ["T"], author: [{ name: "Jane Smith" }] }),
    );
    await lookupDoiWork("10.1038/x", fetcher as unknown as typeof fetch);
    expect(String(fetcher.mock.calls[0]?.[0])).not.toContain("mailto");

    await lookupDoiWork("10.1038/x", fetcher as unknown as typeof fetch, "polite@example.org");
    expect(String(fetcher.mock.calls[1]?.[0])).toContain("?mailto=polite%40example.org");
  });
});

describe("DataCite fallback", () => {
  const dataCite = (attributes: unknown) => new Response(JSON.stringify({ data: { attributes } }), { status: 200 });

  /** Crossref 404s, DataCite answers with `second`. */
  const fallbackFetcher = (second: Response) =>
    vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(second);

  it("asks DataCite after a Crossref 404 and maps creators, ORCID and title", async () => {
    const fetcher = fallbackFetcher(
      dataCite({
        titles: [{ title: "Attention Is All You Need" }],
        creators: [
          {
            name: "Smith, Jane",
            givenName: "Jane",
            familyName: "Smith",
            nameIdentifiers: [
              { nameIdentifier: "https://orcid.org/0000-0002-1825-0097", nameIdentifierScheme: "ORCID" },
            ],
          },
          {
            name: "Bad, Bob",
            givenName: "Bob",
            familyName: "Bad",
            nameIdentifiers: [{ nameIdentifier: "x", nameIdentifierScheme: "ISNI" }],
          },
          { name: "The Zenodo Consortium", nameType: "Organizational" },
        ],
      }),
    );

    expect(await lookupDoiWork("10.48550/arXiv.1706.03762", fetcher)).toEqual({
      ok: true,
      title: "Attention Is All You Need",
      authors: [
        { name: "Jane Smith", orcid: "0000-0002-1825-0097" },
        { name: "Bob Bad" },
        { name: "The Zenodo Consortium" },
      ],
    });
    expect(String(fetcher.mock.calls[1]?.[0])).toBe("https://api.datacite.org/dois/10.48550%2FarXiv.1706.03762");
  });

  it("reports NOT_FOUND only when both registries miss", async () => {
    const fetcher = fallbackFetcher(new Response(null, { status: 404 }));
    expect(await lookupDoiWork("10.1038/x", fetcher)).toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("does not ask DataCite when Crossref is merely unavailable", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
    expect(await lookupDoiWork("10.1038/x", fetcher)).toMatchObject({ status: 502, code: "UNAVAILABLE" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("maps DataCite failure and a malformed body to UNAVAILABLE", async () => {
    expect(await lookupDoiWork("10.1038/x", fallbackFetcher(new Response(null, { status: 500 })))).toMatchObject({
      code: "UNAVAILABLE",
    });
    expect(await lookupDoiWork("10.1038/x", fallbackFetcher(new Response("{}", { status: 200 })))).toMatchObject({
      code: "UNAVAILABLE",
    });
  });

  it("applies the same author-count rules", async () => {
    const many = Array.from({ length: 201 }, (_, i) => ({ givenName: "A", familyName: `Author${i}` }));
    expect(await lookupDoiWork("10.1038/x", fallbackFetcher(dataCite({ creators: many })))).toMatchObject({
      code: "TOO_MANY_AUTHORS",
    });
    expect(await lookupDoiWork("10.1038/x", fallbackFetcher(dataCite({ creators: [] })))).toMatchObject({
      code: "NO_AUTHORS",
    });
  });
});
