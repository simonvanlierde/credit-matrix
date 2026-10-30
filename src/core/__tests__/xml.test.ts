import { describe, expect, it, vi } from "vitest";
import { escapeXml } from "../export/escape-xml";
import { toJats4rXml } from "../export/xml";
import { fromJats4rXml } from "../export/xml-import";
import { createAuthor, parseAuthorText } from "../parse-authors";

// `fromJats4rXml` defaults to the global DOMParser, native in the browser and
// linkedom's here (see setup.ts), so this exercises the same entry point the
// web app calls.
describe("fromJats4rXml (DOMParser entry point)", () => {
  it("round-trips through the browser-facing parser", () => {
    const authors = parseAuthorText("Jane Smith");
    const [jane] = authors;
    if (!jane) throw new Error("expected author");
    const conc = jane.contributions[0];
    if (!conc) throw new Error("expected contribution");
    conc.score = 100;
    jane.orcid = "0000-0002-1825-0097";

    const xml = toJats4rXml(authors);
    // JATS4R Authors and Affiliations v2.0 asks for the full ORCID URL.
    expect(xml).toContain('<contrib-id contrib-id-type="orcid">https://orcid.org/0000-0002-1825-0097</contrib-id>');
    const parsed = fromJats4rXml(xml);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.surname).toBe("Smith");
    expect(parsed[0]?.orcid).toBe("0000-0002-1825-0097");
    expect(parsed[0]?.contributions.find((c) => c.role === "Conceptualization")?.score).toBe(100);
  });

  it("writes a generational suffix as <suffix>, not as the surname", () => {
    const [king] = parseAuthorText("Martin Luther King Jr.");
    if (!king) throw new Error("expected contributor");
    const xml = toJats4rXml([king]);
    expect(xml).toContain("<given-names>Martin Luther</given-names>");
    expect(xml).toContain("<surname>King</surname>");
    expect(xml).toContain("<suffix>Jr.</suffix>");
    expect(fromJats4rXml(xml)[0]).toMatchObject({ name: "Martin Luther King Jr.", surname: "King" });
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

  it("throws on the <parsererror> document browsers return instead of raising", () => {
    // Browsers never throw from DOMParser: they return a document with a
    // <parsererror> element inside it, here after a valid <contrib> so the
    // guard, not an empty result, is what must stop the import.
    const doc = new DOMParser().parseFromString("<root/>", "application/xml");
    doc.documentElement.innerHTML = "<contrib/><parsererror>error on line 1 at column 9</parsererror>";
    const parser = { parseFromString: () => doc };
    expect(() => fromJats4rXml("<article><contrib>", { parser })).toThrow(
      "XML parse error: error on line 1 at column 9",
    );
  });

  it("reports a custom parser's empty error element and skips a role with no text", () => {
    type El = import("../export/xml-import").XmlElement;
    const el = (text: string | null, attrs: Record<string, string> = {}, kids: Record<string, El[]> = {}): El => ({
      textContent: text,
      getAttribute: (name) => attrs[name] ?? null,
      querySelector: (selector) => kids[selector]?.[0] ?? null,
      querySelectorAll: (selector) => kids[selector] ?? [],
    });
    const failing = { parseFromString: () => el(null, {}, { parsererror: [el(null)] }) };
    expect(() => fromJats4rXml("<x/>", { parser: failing })).toThrow("XML parse error: invalid XML");

    const contrib = el(null, {}, { "given-names": [el("Jane")], surname: [el("Smith")], role: [el(null)] });
    const ok = { parseFromString: () => el(null, {}, { contrib: [contrib] }) };
    const [jane] = fromJats4rXml("<x/>", { parser: ok });
    expect(jane?.name).toBe("Jane Smith");
    expect(jane?.contributions.every((c) => c.score === 0)).toBe(true);
  });

  it("says what to pass where there is no global DOMParser", () => {
    vi.stubGlobal("DOMParser", undefined);
    try {
      expect(() => fromJats4rXml("<article/>")).toThrow(/pass \{ parser \}/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // Browsers expand internal entities and linkedom leaves them as text, so the same file would
  // import different names in the app and the CLI. A large expansion also freezes the tab.
  const contrib = '<contrib contrib-type="author"><name><surname>&x;</surname></name></contrib>';
  it.each([
    ["an internal entity", `<!DOCTYPE article [<!ENTITY x "Smith">]><article>${contrib}</article>`],
    ["a SYSTEM entity", `<!DOCTYPE article [<!ENTITY x SYSTEM "file:///etc/passwd">]><article>${contrib}</article>`],
    [
      "a billion-laughs expansion",
      `<!DOCTYPE article [<!ENTITY a "lol"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">` +
        `<!ENTITY x "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">]><article>${contrib}</article>`,
    ],
    ["a lower-case declaration", `<!DOCTYPE article [<!entity x "Smith">]><article>${contrib}</article>`],
  ])("refuses %s", (_, xml) => {
    expect(() => fromJats4rXml(xml)).toThrow(/^XML parse error: entity declarations are not supported/);
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

  it("writes equal-contrib only when two or more authors share first authorship", () => {
    const [jane, bob, ann] = parseAuthorText("Jane Smith, Bob White, Ann Lee");
    if (!jane || !bob || !ann) throw new Error("expected authors");
    const count = (xml: string) => xml.match(/equal-contrib="yes"/g)?.length ?? 0;

    expect(count(toJats4rXml([{ ...jane, equalContribution: true }, bob]))).toBe(0);
    expect(count(toJats4rXml([{ ...jane, equalContribution: true }, { ...bob, equalContribution: true }, ann]))).toBe(
      2,
    );
    // A non-author contributor does not make a lone author's flag shared.
    const acknowledged = { ...bob, equalContribution: true, contributorType: "non-author" as const };
    expect(count(toJats4rXml([{ ...jane, equalContribution: true }, acknowledged]))).toBe(0);
    // Nor does a flagged non-author get the attribute when two authors do share it.
    const shared = toJats4rXml([
      { ...jane, equalContribution: true },
      { ...ann, equalContribution: true },
      acknowledged,
    ]);
    expect(count(shared)).toBe(2);
    expect(shared).toContain('<contrib contrib-type="contributor">');
  });

  it("writes every given name of a surname-first name", () => {
    const [curie] = parseAuthorText("Curie, Marie Salomea Skłodowska");
    if (!curie) throw new Error("expected contributor");
    const xml = toJats4rXml([curie]);
    expect(xml).toContain("<given-names>Marie Salomea Skłodowska</given-names>");
    expect(xml).toContain("<surname>Curie</surname>");
  });

  it("falls back to the stored given names when the name no longer holds the surname", () => {
    const [jane] = parseAuthorText("Jane Q Smith");
    if (!jane) throw new Error("expected author");
    const xml = toJats4rXml([{ ...jane, name: "J. Q. S." }]);
    expect(xml).toContain("<given-names>Jane Q</given-names>");
  });

  it("writes the ORCID iD as a full orcid.org URI", () => {
    const [jane] = parseAuthorText("Jane Smith");
    if (!jane) throw new Error("expected author");
    jane.orcid = "0000-0002-1825-0097";

    const xml = toJats4rXml([jane]);
    expect(xml).toContain('<contrib-id contrib-id-type="orcid">https://orcid.org/0000-0002-1825-0097</contrib-id>');
    expect(xml).not.toContain("authenticated");
  });

  it("does not double the prefix of an iD stored as a URL", () => {
    const [jane] = parseAuthorText("Jane Smith");
    if (!jane) throw new Error("expected author");
    jane.orcid = "https://orcid.org/0000-0002-1825-0097";

    expect(toJats4rXml([jane])).toContain(">https://orcid.org/0000-0002-1825-0097</contrib-id>");
  });

  it.each(["https://orcid.org/0000-0002-1825-0097", "http://orcid.org/0000-0002-1825-0097", "0000-0002-1825-0097"])(
    "imports the ORCID iD written as %s",
    (id) => {
      const xml = `<article><contrib contrib-type="author"><contrib-id contrib-id-type="orcid">${id}</contrib-id><name><surname>Smith</surname><given-names>Jane</given-names></name></contrib></article>`;
      expect(fromJats4rXml(xml)[0]?.orcid).toBe("0000-0002-1825-0097");
    },
  );

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

  it("imports each member of a collab once, and collapses spaces inside names", () => {
    const xml = `<article><contrib-group>
      <contrib contrib-type="author"><collab>The Lab
        <contrib-group>
          <contrib contrib-type="author"><name><surname>Smith</surname><given-names>Jane   Ann</given-names></name></contrib>
          <contrib contrib-type="author"><name><surname>White</surname><given-names>Bob</given-names></name></contrib>
        </contrib-group>
      </collab></contrib>
    </contrib-group></article>`;

    expect(fromJats4rXml(xml).map((a) => a.name)).toEqual(["Jane Ann Smith", "Bob White"]);
  });

  it("keeps a double surname as JATS splits it, with single spaces", () => {
    const [ana, dot] = fromJats4rXml(
      `<article>
        <contrib contrib-type="author"><name><surname>García  López</surname><given-names>Ana</given-names></name></contrib>
        <contrib contrib-type="author"><name><surname>Smith</surname><given-names>.</given-names></name></contrib>
      </article>`,
    );
    expect(ana).toMatchObject({ name: "Ana García López", firstName: "Ana", surname: "García López", initials: "AG" });
    // Given names with no letters leave the first name empty.
    expect(dot).toMatchObject({ firstName: "", middleName: "", surname: "Smith" });
  });

  it("drops an ORCID iD that is not valid and keeps the contributor", () => {
    const authors = fromJats4rXml(
      `<article><contrib contrib-type="author"><contrib-id contrib-id-type="orcid">0000-0000-0000-0000</contrib-id>
        <name><surname>Smith</surname><given-names>Jane</given-names></name></contrib></article>`,
    );
    expect(authors.map((a) => [a.name, a.orcid])).toEqual([["Jane Smith", undefined]]);
  });

  it("reads a role from its identifier alone, over http and without the trailing slash, or from vocab-term alone", () => {
    const [jane] = fromJats4rXml(`<article><contrib contrib-type="author">
      <name><surname>Smith</surname><given-names>Jane</given-names></name>
      <role vocab-term-identifier="http://credit.niso.org/contributor-roles/software">Code</role>
      <role vocab-term-identifier=" HTTPS://credit.niso.org/contributor-roles/methodology// ">Methods</role>
      <role vocab-term="Validation"/>
    </contrib></article>`);
    const active = jane?.contributions.filter((c) => c.score > 0).map((c) => c.role);
    expect(active).toEqual(["Methodology", "Software", "Validation"]);
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

  it("matches role names without an identifier whatever their case or dash", () => {
    const xml = `<article><contrib contrib-type="author">
      <name><surname>Smith</surname><given-names>Jane</given-names></name>
      <role vocab-term="Writing - original draft">Writing - original draft</role>
      <role>conceptualization</role>
      <role vocab-term="nonsense">Software</role>
    </contrib></article>`;

    const [jane] = fromJats4rXml(xml);
    const active = jane?.contributions.filter((c) => c.score > 0).map((c) => c.role);
    expect(active).toEqual(["Conceptualization", "Software", "Writing – original draft"]);
  });

  it("reads degree-contribution, and falls back to lead when it is missing or unknown", () => {
    const xml = `<article><contrib contrib-type="author">
      <name><surname>Smith</surname><given-names>Jane</given-names></name>
      <role vocab-term="Conceptualization" degree-contribution="supporting">Conceptualization</role>
      <role vocab-term="Methodology">Methodology</role>
      <role vocab-term="Software" degree-contribution="major">Software</role>
      <role vocab-term="Resources" degree-contribution="supporting">Resources</role>
      <role vocab-term="Resources" degree-contribution="equal">Resources</role>
      <role degree-contribution="equal">Visualization</role>
      <role>Not a CRediT role</role>
    </contrib></article>`;

    const [jane] = fromJats4rXml(xml);
    const score = (role: string) => jane?.contributions.find((c) => c.role === role)?.score;
    expect(score("Conceptualization")).toBe(33);
    expect(score("Methodology")).toBe(100);
    expect(score("Software")).toBe(100);
    // A role listed twice keeps its higher level.
    expect(score("Resources")).toBe(66);
    // Only the text content names the role.
    expect(score("Visualization")).toBe(66);
    expect(jane?.contributions.filter((c) => c.score > 0)).toHaveLength(5);
  });

  it("leaves out degree-contribution in yes/no mode and keeps it when a score is graded", () => {
    const yesNo = [
      createAuthor("Jane Smith", { contributions: [{ role: "Conceptualization", score: 100 }] }),
      createAuthor("Bob White", { contributions: [{ role: "Software", score: 100 }] }),
    ];
    const xml = toJats4rXml(yesNo, { yesNo: true });
    expect(xml).not.toContain("degree-contribution");
    expect(xml).toContain('vocab-term="Software"');
    // Without the level, every role imports as contributed (100), as it was.
    const parsed = fromJats4rXml(xml);
    expect(parsed.map((a) => a.contributions.filter((c) => c.score > 0).map((c) => c.score))).toEqual([[100], [100]]);

    // Levels mode, or yes/no with a graded score left over, keeps the level.
    expect(toJats4rXml(yesNo)).toContain('degree-contribution="lead"');
    const graded = [createAuthor("Jane Smith", { contributions: [{ role: "Conceptualization", score: 33 }] })];
    expect(toJats4rXml(graded, { yesNo: true })).toContain('degree-contribution="supporting"');
  });
});

describe("toJats4rXml with characters XML cannot hold", () => {
  it("writes none of them, even from a contributor built without createAuthor", () => {
    const [author] = parseAuthorText("Jane Smith");
    if (!author) throw new Error("expected author");
    const xml = toJats4rXml([{ ...author, firstName: "Ja\u0001ne", surname: "Sm\u000Bith\uFFFE" }]);
    expect(xml).toContain("<given-names>Jane</given-names>");
    expect(xml).toContain("<surname>Smith</surname>");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the characters under test.
    expect(xml).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/);
  });
});

describe("escapeXml", () => {
  it("escapes the five predefined entities and drops what XML cannot hold", () => {
    expect(escapeXml(`<a href="x">'Tom' & Jerry</a>\u0007`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&apos;Tom&apos; &amp; Jerry&lt;/a&gt;",
    );
  });
});

describe("fromJats4rXml reading", () => {
  const contrib = (inner: string, attrs = 'contrib-type="author"') =>
    `<article><contrib ${attrs}>${inner}</contrib></article>`;
  const active = (author: { contributions: { role: string; score: number }[] } | undefined) =>
    author?.contributions.filter((c) => c.score > 0).map((c) => `${c.role}:${c.score}`);

  it("trusts the role identifier over the term, whatever its scheme, case or trailing slash", () => {
    const xml = contrib(`<name><surname>Smith</surname><given-names>Jane</given-names></name>
      <role vocab-term="Methodology" vocab-term-identifier=" HTTPS://CREDIT.NISO.ORG/contributor-roles/software// ">Methodology</role>
      <role vocab-term="Methodology" vocab-term-identifier="ftp://credit.niso.org/contributor-roles/data-curation/">Methodology</role>`);
    expect(active(fromJats4rXml(xml)[0])).toEqual(["Methodology:100", "Software:100"]);
  });

  it("reads a listed role as lead when its degree is none", () => {
    const xml = contrib(`<name><surname>Smith</surname><given-names>Jane</given-names></name>
      <role vocab-term="Software" degree-contribution="none">Software</role>`);
    expect(active(fromJats4rXml(xml)[0])).toEqual(["Software:100"]);
  });

  it("collapses line breaks inside the name parts and hands them over as they stand", () => {
    const xml = contrib(`<name><surname>van der
        Berg</surname><given-names>Anne
        Marie</given-names></name>`);
    expect(fromJats4rXml(xml)[0]).toMatchObject({
      name: "Anne Marie van der Berg",
      firstName: "Anne",
      middleName: "Marie",
      surname: "van der Berg",
    });
  });

  it("parses the name itself when only one part is given", () => {
    const [jane] = fromJats4rXml(contrib("<name><surname>Jane Ann Smith</surname></name>"));
    expect(jane).toMatchObject({ name: "Jane Ann Smith", firstName: "Jane", middleName: "Ann", surname: "Smith" });
  });

  it("keeps an ORCID iD padded with spaces and drops one with a bad check digit", () => {
    const orcid = (id: string) =>
      fromJats4rXml(
        contrib(`<contrib-id contrib-id-type="orcid">${id}</contrib-id><name><surname>Smith</surname></name>`),
      )[0]?.orcid;
    expect(orcid(" https://orcid.org/0000-0002-1825-0097 ")).toBe("0000-0002-1825-0097");
    expect(orcid("0000-0002-1825-0098")).toBeUndefined();
  });

  it("asks the parser for XML and reports its error text trimmed", () => {
    const types: string[] = [];
    const error = {
      textContent: "  line 1: bad  ",
      getAttribute: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const parser = {
      parseFromString(_: string, type: "application/xml") {
        types.push(type);
        return { querySelector: () => error, querySelectorAll: () => [] };
      },
    };
    expect(() => fromJats4rXml("<x/>", { parser })).toThrow(/^XML parse error: line 1: bad$/);
    expect(types).toEqual(["application/xml"]);
  });
});
