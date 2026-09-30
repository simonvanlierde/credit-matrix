import { describe, expect, it, vi } from "vitest";
import { toJats4rXml } from "../export/xml";
import { fromJats4rXml } from "../export/xml-import";
import { parseAuthorText } from "../parse-authors";

// `fromJats4rXml` relies on a global DOMParser. In the browser this is native;
// here jsdom provides it, so this exercises the same
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

  it("throws on malformed XML", () => {
    expect(() => fromJats4rXml("<article><contrib>")).toThrow(/XML parse error/);
  });

  it("throws on the <parsererror> document browsers return instead of raising", () => {
    // Browsers never throw from DOMParser: they return a document with a
    // <parsererror> element inside it, here after a valid <contrib> so the
    // guard, not an empty result, is what must stop the import.
    const doc = new DOMParser().parseFromString("<root/>", "application/xml");
    doc.documentElement.innerHTML = "<contrib/><parsererror>error on line 1 at column 9</parsererror>";
    const spy = vi.spyOn(DOMParser.prototype, "parseFromString").mockReturnValue(doc);
    try {
      expect(() => fromJats4rXml("<article><contrib>")).toThrow("XML parse error: error on line 1 at column 9");
    } finally {
      spy.mockRestore();
    }
  });
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

  it("falls back to the stored given names when the name no longer holds the surname", () => {
    const [jane] = parseAuthorText("Jane Q Smith");
    if (!jane) throw new Error("expected author");
    const xml = toJats4rXml([{ ...jane, name: "J. Q. S." }]);
    expect(xml).toContain("<given-names>Jane Q</given-names>");
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

  it("skips a contrib whose name is rejected instead of aborting the import", () => {
    const xml = `<article><contrib-group>
      <contrib contrib-type="author"><name><surname>123</surname><given-names>!!!</given-names></name></contrib>
      <contrib contrib-type="author"><name><surname>Smith</surname><given-names>Jane</given-names></name></contrib>
    </contrib-group></article>`;

    expect(fromJats4rXml(xml).map((a) => a.name)).toEqual(["Jane Smith"]);
  });

  it("imports only authors and contributors, not editors or reviewers", () => {
    const xml = `<article><contrib-group>
      <contrib contrib-type="author"><name><surname>Smith</surname><given-names>Jane</given-names></name></contrib>
      <contrib contrib-type="editor"><name><surname>Editor</surname><given-names>Ed</given-names></name></contrib>
      <contrib contrib-type="reviewer"><name><surname>Reviewer</surname><given-names>Rev</given-names></name></contrib>
      <contrib contrib-type="contributor"><name><surname>White</surname><given-names>Bob</given-names></name></contrib>
    </contrib-group></article>`;

    expect(fromJats4rXml(xml).map((a) => a.name)).toEqual(["Jane Smith", "Bob White"]);
  });

  it("matches roles by their CRediT identifier before the term text", () => {
    const xml = `<article><contrib contrib-type="author">
      <name><surname>Smith</surname><given-names>Jane</given-names></name>
      <role vocab="credit" vocab-term="Writing - original draft" vocab-term-identifier="http://credit.niso.org/contributor-roles/writing-original-draft">Writing - original draft</role>
      <role vocab="credit" vocab-term="Conceptualization">Conceptualization</role>
    </contrib></article>`;

    const [jane] = fromJats4rXml(xml);
    const active = jane?.contributions.filter((c) => c.score > 0).map((c) => c.role);
    expect(active).toEqual(["Conceptualization", "Writing – original draft"]);
  });
});
