// biome-ignore-all lint/correctness/noNodejsModules: scripts/validate-crossref.sh reads the export from disk
import { writeFileSync } from "node:fs";
import process from "node:process";
import { DOMParser as LinkedomParser } from "linkedom";
import { describe, expect, it, vi } from "vitest";
import { activeContributions } from "../author";
import { CREDIT_ROLES } from "../credit-roles";
import { fromCrossrefContributors, isCrossrefContributors, toCrossrefContributors } from "../export/crossref";
import { detectFormat, importAny } from "../import";
import { createAuthor } from "../parse-authors";

const grace = createAuthor("Grace B. Hopper", {
  orcid: "0000-0002-1825-0097",
  corresponding: true,
  contributions: [
    { role: "Conceptualization", score: 100 },
    { role: "Writing – review & editing", score: 33 },
  ],
});
const charles = createAuthor("Charles Darwin", {
  contributorType: "non-author",
  contributions: [{ role: "Investigation", score: 66 }],
});

describe("toCrossrefContributors", () => {
  it("writes name parts, Crossref and CRediT roles, and the ORCID URL in schema order", () => {
    const xml = toCrossrefContributors([grace]);
    expect(xml).toContain(`<contributors>
  <person_name sequence="first">
    <given_name>Grace B.</given_name>
    <surname>Hopper</surname>
    <role vocab="crossref" type="author"/>
    <role vocab="crossref" type="corresponding-author"/>
    <role vocab="credit" type="conceptualization"/>
    <role vocab="credit" type="writing-review-editing"/>
    <ORCID>https://orcid.org/0000-0002-1825-0097</ORCID>
  </person_name>
</contributors>`);
  });

  it("writes a generational suffix after the surname", () => {
    const xml = toCrossrefContributors([createAuthor("Martin Luther King Jr.")]);
    expect(xml).toContain(`<given_name>Martin Luther</given_name>
    <surname>King</surname>
    <suffix>Jr.</suffix>
    <role vocab="crossref" type="author"/>`);
  });

  it("writes the suffix of an inverted name after the surname", () => {
    expect(toCrossrefContributors([createAuthor("Smith Jr., John")])).toContain(`<given_name>John</given_name>
    <surname>Smith</surname>
    <suffix>Jr.</suffix>`);
  });

  it("writes only the elements a person has", () => {
    expect(toCrossrefContributors([createAuthor("Madonna")])).toContain(`<person_name sequence="first">
    <surname>Madonna</surname>
    <role vocab="crossref" type="author"/>
  </person_name>`);
  });

  it("never claims a degree or an authenticated ORCID iD", () => {
    const xml = toCrossrefContributors([grace]);
    expect(xml).not.toMatch(/degree|lead|authenticated/);
  });

  it("lists authors first, gives 'first' to the first of them, and marks non-authors 'other'", () => {
    const xml = toCrossrefContributors([charles, grace]);
    expect(xml).toMatch(
      /<contributors>\n {2}<person_name sequence="first">\n {4}<given_name>Grace B\.[\s\S]*<person_name sequence="additional">\n {4}<given_name>Charles<\/given_name>[\s\S]*?type="other"\/>/,
    );
  });

  it("leaves out a contributor whose name is still an ORCID iD, and says so", () => {
    const xml = toCrossrefContributors([createAuthor("0000-0001-5109-3700"), grace]);
    expect(xml).not.toContain("<surname>0000-0001-5109-3700</surname>");
    expect(xml).toContain("<!-- Left out: 0000-0001-5109-3700 has no name yet. -->");
    expect(xml).toMatch(/<person_name sequence="first">\n {4}<given_name>Grace B\./);
  });

  it("puts each person and each left-out note on its own line", () => {
    const xml = toCrossrefContributors([createAuthor("0000-0001-5109-3700"), grace, charles]);
    expect(xml).toContain(`has no name yet. -->
  <person_name sequence="first">`);
    expect(xml).toContain(`</person_name>
  <person_name sequence="additional">`);
  });

  it("puts a single name in surname, as Crossref asks", () => {
    const xml = toCrossrefContributors([createAuthor("Madonna")]);
    expect(xml).toContain("<surname>Madonna</surname>");
    expect(xml).not.toContain("<given_name>");
  });

  it("escapes names", () => {
    expect(toCrossrefContributors([createAuthor("Ann <O'Neil> & Co")])).toContain(
      "<given_name>Ann &lt;O&apos;Neil&gt; &amp;</given_name>",
    );
  });
});

// Not a real test: scripts/validate-crossref.sh sets CROSSREF_OUT to get a
// fresh export on disk for the XSD check, and the run is skipped otherwise.
it.runIf(process.env.CROSSREF_OUT)("writes a fresh export for XSD validation", () => {
  const everyRole = createAuthor("María José García López", {
    orcid: "0000-0001-5109-3700",
    contributions: CREDIT_ROLES.map((role) => ({ role: role.name, score: 66 })),
  });
  writeFileSync(
    process.env.CROSSREF_OUT as string,
    toCrossrefContributors([grace, everyRole, charles, createAuthor("Madonna"), createAuthor("0000-0003-1415-9269")]),
  );
});

describe("fromCrossrefContributors", () => {
  const shape = (a: ReturnType<typeof createAuthor>) => ({
    name: a.name,
    firstName: a.firstName,
    middleName: a.middleName,
    surname: a.surname,
    initials: a.initials,
    orcid: a.orcid,
    corresponding: a.corresponding,
    contributorType: a.contributorType,
    active: a.contributions.filter((c) => c.score > 0).map((c) => c.role),
  });
  // Authors first, then the others: the order the export writes.
  const roster = [grace, createAuthor("Martin Luther King Jr."), createAuthor("Ana García López"), charles];

  it("reads the app's own export back to the same authors, roles and ORCIDs", () => {
    const back = fromCrossrefContributors(toCrossrefContributors(roster));
    // The schema has no level slot, so the exported roles come back as lead.
    expect(back.map(shape)).toEqual(roster.map(shape));
    expect(back.find((a) => a.name === "Grace B. Hopper")?.contributions.find((c) => c.score > 0)?.score).toBe(100);
  });

  it("reads an author before the people credited only in the Acknowledgements, in export order", () => {
    const back = fromCrossrefContributors(toCrossrefContributors([charles, grace]));
    expect(back.map((a) => [a.name, a.contributorType])).toEqual([
      ["Grace B. Hopper", "author"],
      ["Charles Darwin", "non-author"],
    ]);
  });

  it("recognises the block in detectFormat and importAny", async () => {
    const xml = toCrossrefContributors(roster);
    expect(detectFormat(xml)).toBe("crossref");
    expect(detectFormat(`<?xml version="1.0"?>\n${xml}`)).toBe("crossref");
    expect(detectFormat("<article><contrib-group/></article>")).toBe("xml");
    const imported = await importAny(xml);
    expect(imported.format).toBe("crossref");
    expect(imported.authors.map((a) => a.name)).toEqual(roster.map((a) => a.name));
  });

  it("refuses malformed XML and entity declarations, and skips a nameless person", () => {
    // Browsers return a <parsererror> document instead of throwing; linkedom is lenient.
    const doc = new DOMParser().parseFromString("<root/>", "application/xml");
    doc.documentElement.innerHTML = "<person_name/><parsererror>error on line 1</parsererror>";
    expect(() =>
      fromCrossrefContributors("<contributors><person_name>", { parser: { parseFromString: () => doc } }),
    ).toThrow("XML parse error: error on line 1");
    expect(() =>
      fromCrossrefContributors(
        '<!DOCTYPE c [<!ENTITY x "y">]><contributors><person_name><surname>&x;</surname></person_name></contributors>',
      ),
    ).toThrow(/entity and attribute-list/);
    expect(
      fromCrossrefContributors(
        '<contributors><person_name><role vocab="crossref" type="author"/></person_name></contributors>',
      ),
    ).toEqual([]);
    // Punctuation only: createAuthor throws, so the person is skipped.
    expect(
      fromCrossrefContributors("<contributors><person_name><surname>--</surname></person_name></contributors>"),
    ).toEqual([]);
  });

  it("reads roles of the crossref vocabulary only, for author type and corresponding mark", () => {
    const xml = `<contributors><person_name><surname>Hopper</surname>
      <role vocab="crossref" type="other"/><role vocab="credit" type="author"/><role vocab="credit" type="corresponding-author"/>
      <role vocab="crossref"/></person_name></contributors>`;
    const [smith] = fromCrossrefContributors(xml);
    expect(smith?.contributorType).toBe("non-author");
    expect(smith?.corresponding).toBe(false);
  });

  it("says which reader needs a DOMParser where there is no global one", () => {
    vi.stubGlobal("DOMParser", undefined);
    try {
      expect(() => fromCrossrefContributors("<contributors/>")).toThrow(/^fromCrossrefContributors needs a DOMParser/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses an attribute-list declaration", () => {
    expect(() => fromCrossrefContributors('<!DOCTYPE c [<!ATTLIST person_name x CDATA "y">]><contributors/>')).toThrow(
      /^XML parse error: entity and attribute-list declarations are not supported\.$/,
    );
  });

  it("reads deeply nested person_name in linear time and keeps the outer one", () => {
    const n = 8000;
    const xml = `<contributors>${"<person_name>".repeat(n)}<surname>Hopper</surname>${"</person_name>".repeat(n)}</contributors>`;
    const linkedom = new LinkedomParser();
    const start = performance.now();
    const authors = fromCrossrefContributors(xml, {
      parser: { parseFromString: (text) => linkedom.parseFromString(text, "text/xml") },
    });
    expect(performance.now() - start).toBeLessThan(500);
    expect(authors).toHaveLength(1);
  });

  it("reads hand-written roles and ORCIDs", () => {
    const person = (name: string, inner: string) => `<person_name><surname>${name}</surname>${inner}</person_name>`;
    const xml = `<contributors>
      ${person("Badorcid", "<ORCID>1234</ORCID>")}
      ${person("Goodorcid", "<ORCID>https://orcid.org/0000-0002-1825-0097</ORCID>")}
      ${person("Unknownslug", '<role vocab="credit" type="no-such-role"/>')}
      ${person("Otherauthor", '<role vocab="crossref" type="other"/><role vocab="crossref" type="author"/>')}
      ${person("Othercorr", '<role vocab="crossref" type="other"/><role vocab="crossref" type="corresponding-author"/>')}
    </contributors>`;
    const [bad, good, slug, both, corr] = fromCrossrefContributors(xml);
    expect(bad?.orcid).toBeUndefined();
    expect(good?.orcid).toBe("0000-0002-1825-0097");
    expect(slug && activeContributions(slug)).toEqual([]);
    expect(both?.contributorType).toBe("author");
    expect(corr).toMatchObject({ contributorType: "non-author", corresponding: true });
  });
});

describe("isCrossrefContributors", () => {
  it("stays fast on runs of empty comments", () => {
    for (const n of [30, 5000]) {
      const start = performance.now();
      expect(isCrossrefContributors(`${"<!---->".repeat(n)}<x/>`)).toBe(false);
      expect(isCrossrefContributors(`${"<!---->".repeat(n)}<contributors>`)).toBe(true);
      expect(performance.now() - start).toBeLessThan(500);
    }
  });

  it("rejects an unterminated comment or declaration", () => {
    expect(isCrossrefContributors("<!-- never closed <contributors>")).toBe(false);
    expect(isCrossrefContributors('<?xml version="1.0"<contributors>')).toBe(false);
  });

  it("looks only at the root element", () => {
    expect(isCrossrefContributors("<article><contributors>")).toBe(false);
    expect(isCrossrefContributors("<!-- a --><body><contributors/></body>")).toBe(false);
    expect(isCrossrefContributors("\uFEFF\n <contributors>")).toBe(true);
  });

  it("accepts a BOM, a declaration, comments and a self-closing root", () => {
    expect(isCrossrefContributors('\uFEFF<?xml version="1.0"?>\n<!-- a -->\n<!-- b -->\n<contributors/>')).toBe(true);
    expect(isCrossrefContributors("<contributorsX>")).toBe(false);
  });
});

describe("fromCrossrefContributors display name", () => {
  it("rebuilds the name as given + surname + suffix", () => {
    const xml =
      "<contributors><person_name><given_name>Grace</given_name><surname>Hopper</surname><suffix>Jr</suffix></person_name></contributors>";
    expect(fromCrossrefContributors(xml).map((a) => a.name)).toEqual(["Grace Hopper Jr"]);
    // A family-first name ("Hopper, Grace") comes back given-first, as fromJats4rXml does.
    const author = createAuthor("Hopper, Grace");
    expect(fromCrossrefContributors(toCrossrefContributors([author])).map((a) => a.name)).toEqual(["Grace Hopper"]);
  });
});
