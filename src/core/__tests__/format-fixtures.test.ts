// biome-ignore lint/correctness/noNodejsModules: tests run in Node; fixtures are files on disk
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeShareHash } from "@/lib/share";
import type { Author } from "../author";
import { fromCsv } from "../export/csv";
import { fromJson } from "../export/json";
import { fromJats4rXml } from "../export/xml-import";

// Frozen files, written once by the encoders of the day. Never regenerate them
// to make a test pass: a change that breaks one of these breaks every link or
// file a user already holds.
function fixture(name: string): string {
  return readFileSync(`src/core/__tests__/fixtures/${name}`, "utf8").trim();
}

/** Role names with a score above zero, as `name:score`. */
function scores(author: Author | undefined): string[] {
  return (author?.contributions ?? []).filter((c) => c.score > 0).map((c) => `${c.role}:${c.score}`);
}

/** What a decoded author list holds, for comparing against {@link ROSTER}. */
function summarize(authors: Author[]) {
  return authors.map((a) => ({
    name: a.name,
    type: a.contributorType,
    equal: a.equalContribution,
    corresponding: a.corresponding,
    orcid: a.orcid,
    scores: scores(a),
  }));
}

/** The three contributors every fixture was written from. Scores sit on 33/66/100, which JATS keeps exactly. */
const ROSTER = [
  {
    name: "Ada Lovelace",
    type: "author",
    equal: true,
    corresponding: true,
    orcid: "0000-0002-1825-0097",
    scores: ["Conceptualization:100", "Methodology:66", "Writing – original draft:100"],
  },
  {
    name: "Marie Curie",
    type: "author",
    equal: true,
    corresponding: false,
    orcid: undefined,
    scores: ["Data curation:33", "Investigation:100", "Writing – review & editing:66"],
  },
  {
    name: "Alan Turing",
    type: "non-author",
    equal: false,
    corresponding: false,
    orcid: undefined,
    scores: ["Software:100", "Supervision:33"],
  },
];

describe("frozen format fixtures", () => {
  it("decodes the v2 share link", async () => {
    const data = await decodeShareHash(fixture("share-link-v2.txt"));
    if (!data) throw new Error("fixture link no longer decodes");

    expect(data.title).toBe("Frozen fixture");
    expect(data.sourceDraftId).toBe("draft-1");
    expect(data.claimId).toBeNull();
    expect(data.reply).toBe(false);
    expect(data.authors.map((a) => a.id)).toEqual(["ada", "marie", "alan"]);
    expect(summarize(data.authors)).toEqual(ROSTER);
  });

  it("reads the version-1 JSON export", () => {
    expect(JSON.parse(fixture("export-v1.json")).version).toBe(1);
    const authors = fromJson(fixture("export-v1.json"));
    expect(authors.map((a) => a.id)).toEqual(["ada", "marie", "alan"]);
    expect(summarize(authors)).toEqual(ROSTER);
  });

  it("reads the current CSV export", () => {
    expect(summarize(fromCsv(fixture("export-current.csv")))).toEqual(ROSTER);
  });

  it("reads a CSV written before the Equal contribution and Corresponding columns", () => {
    const authors = fromCsv(fixture("export-legacy.csv"));
    expect(authors.map((a) => a.name)).toEqual(["Ada Lovelace", "Alan Turing"]);
    expect(authors.map((a) => a.contributorType)).toEqual(["author", "non-author"]);
    expect(authors.map((a) => a.orcid)).toEqual(["0000-0002-1825-0097", undefined]);
    expect(authors.every((a) => !(a.equalContribution || a.corresponding))).toBe(true);
    expect(scores(authors[0])).toEqual(["Conceptualization:100", "Methodology:66"]);
    expect(scores(authors[1])).toEqual(["Software:100"]);
  });

  it("reads the JATS export", () => {
    const xml = fixture("export-jats.xml");
    // The full URI is what JATS4R asks for.
    expect(xml).toContain('<contrib-id contrib-id-type="orcid">https://orcid.org/0000-0002-1825-0097</contrib-id>');
    expect(summarize(fromJats4rXml(xml))).toEqual(ROSTER);
  });

  it("reads a JATS file that holds a bare ORCID iD", () => {
    const xml = fixture("export-jats.xml").replace("https://orcid.org/", "");
    expect(fromJats4rXml(xml)[0]?.orcid).toBe("0000-0002-1825-0097");
  });
});
