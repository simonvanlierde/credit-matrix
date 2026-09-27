import { describe, expect, it } from "vitest";
import { toJats4rXml } from "../export/xml";
import { fromJats4rXml } from "../export/xml-import";
import { parseAuthorText } from "../parse-authors";

// `fromJats4rXml` relies on a global DOMParser. In the browser this is native;
// here it is provided by linkedom in test-setup.ts, so this exercises the same
// entry point the web app calls.
describe("fromJats4rXml (DOMParser entry point)", () => {
  it("round-trips through the browser-facing parser", () => {
    const authors = parseAuthorText("Jane Smith");
    const [jane] = authors;
    if (!jane) throw new Error("expected author");
    const conc = jane.contributions[0];
    if (!conc) throw new Error("expected contribution");
    conc.score = 100;
    jane.orcid = "0000-0002-1825-0097";

    const parsed = fromJats4rXml(toJats4rXml(authors));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.surname).toBe("Smith");
    expect(parsed[0]?.orcid).toBe("0000-0002-1825-0097");
    expect(parsed[0]?.contributions.find((c) => c.role === "Conceptualization")?.score).toBe(100);
  });

  it.each([
    "Anne van der Berg",
    // spell-checker: ignore Carmen García López
    "Maria del Carmen García López",
    "Jane A. Smith",
    "Madonna",
    // A row still named by its ORCID iD after a failed lookup.
    "0000-0002-1825-0097",
  ])("round-trips the full name %s", (name) => {
    const parsed = fromJats4rXml(toJats4rXml(parseAuthorText(name)));
    expect(parsed.map((a) => a.name)).toEqual([name]);
  });

  it("round-trips a name imported with a multi-word surname", () => {
    const [anne] = fromJats4rXml(
      `<article><contrib contrib-type="author"><name><surname>van der Berg</surname><given-names>Anne</given-names></name></contrib></article>`,
    );
    if (!anne) throw new Error("expected author");
    const [again] = fromJats4rXml(toJats4rXml([anne]));
    expect(again?.name).toBe("Anne van der Berg");
    expect(again?.surname).toBe("van der Berg");
  });

  it("returns an empty array when there are no contrib elements", () => {
    expect(fromJats4rXml("<article><front/></article>")).toEqual([]);
  });

  // Note: the malformed-XML throw path depends on the browser DOMParser emitting
  // a <parsererror> element. linkedom (the Node test DOM) does not replicate this,
  // so that branch is only exercisable in a real browser / e2e test.
});

describe("toJats4rXml", () => {
  it("escapes XML special characters in role names", () => {
    const authors = parseAuthorText("Jane Smith");
    const [jane] = authors;
    if (!jane) throw new Error("expected author");
    // "Writing – review & editing" is the last role (index 13).
    const reviewEditing = jane.contributions[13];
    if (!reviewEditing) throw new Error("expected contribution");
    reviewEditing.score = 100;

    const xml = toJats4rXml(authors);
    expect(xml).toContain("Writing – review &amp; editing");
    expect(xml).not.toMatch(/review & editing/);
  });

  it("only emits role elements for active contributions", () => {
    const authors = parseAuthorText("Jane Smith");
    const [jane] = authors;
    if (!jane) throw new Error("expected author");
    const conc = jane.contributions[0];
    if (!conc) throw new Error("expected contribution");
    conc.score = 80;

    const xml = toJats4rXml(authors);
    const roleCount = (xml.match(/<role /g) ?? []).length;
    expect(roleCount).toBe(1);
    expect(xml).toContain('vocab-term="Conceptualization"');
  });

  it('tags non-author contributors with contrib-type="contributor"', () => {
    const [jane, bob] = parseAuthorText("Jane Smith\nBob White");
    if (!(jane && bob)) throw new Error("expected 2 authors");
    bob.contributorType = "non-author";

    const xml = toJats4rXml([jane, bob]);
    expect(xml).toContain('<contrib contrib-type="author">');
    expect(xml).toContain('<contrib contrib-type="contributor">');
  });

  it("skips a nameless contrib (e.g. a <collab> group) instead of aborting the import", () => {
    const xml = `<article><contrib-group>
      <contrib contrib-type="author"><name><surname>Smith</surname><given-names>Jane</given-names></name></contrib>
      <contrib contrib-type="author"><collab>The Working Group</collab></contrib>
    </contrib-group></article>`;

    const parsed = fromJats4rXml(xml);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.name).toBe("Jane Smith");
  });
});
