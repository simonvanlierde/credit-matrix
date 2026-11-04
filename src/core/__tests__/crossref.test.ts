// biome-ignore-all lint/correctness/noNodejsModules: scripts/validate-crossref.sh reads the export from disk
import { writeFileSync } from "node:fs";
import process from "node:process";
import { describe, expect, it } from "vitest";
import { CREDIT_ROLES } from "../credit-roles";
import { fromCrossrefContributors, isCrossrefContributors, toCrossrefContributors } from "../export/crossref";
import { detectFormat, importAny } from "../import";
import { createAuthor } from "../parse-authors";

const jane = createAuthor("Jane A. Smith", {
  orcid: "0000-0002-1825-0097",
  corresponding: true,
  contributions: [
    { role: "Conceptualization", score: 100 },
    { role: "Writing – review & editing", score: 33 },
  ],
});
const bob = createAuthor("Bob White", {
  contributorType: "non-author",
  contributions: [{ role: "Investigation", score: 66 }],
});

describe("toCrossrefContributors", () => {
  it("writes name parts, Crossref and CRediT roles, and the ORCID URL in schema order", () => {
    const xml = toCrossrefContributors([jane]);
    expect(xml).toContain(`<contributors>
  <person_name sequence="first">
    <given_name>Jane A.</given_name>
    <surname>Smith</surname>
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
    const xml = toCrossrefContributors([jane]);
    expect(xml).not.toMatch(/degree|lead|authenticated/);
  });

  it("lists authors first, gives 'first' to the first of them, and marks non-authors 'other'", () => {
    const xml = toCrossrefContributors([bob, jane]);
    expect(xml).toMatch(
      /<contributors>\n {2}<person_name sequence="first">\n {4}<given_name>Jane A\.[\s\S]*<person_name sequence="additional">\n {4}<given_name>Bob<\/given_name>[\s\S]*?type="other"\/>/,
    );
  });

  it("leaves out a contributor whose name is still an ORCID iD, and says so", () => {
    const xml = toCrossrefContributors([createAuthor("0000-0001-5109-3700"), jane]);
    expect(xml).not.toContain("<surname>0000-0001-5109-3700</surname>");
    expect(xml).toContain("<!-- Left out: 0000-0001-5109-3700 has no name yet. -->");
    expect(xml).toMatch(/<person_name sequence="first">\n {4}<given_name>Jane A\./);
  });

  it("puts each person and each left-out note on its own line", () => {
    const xml = toCrossrefContributors([createAuthor("0000-0001-5109-3700"), jane, bob]);
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
    toCrossrefContributors([jane, everyRole, bob, createAuthor("Madonna"), createAuthor("0000-0003-1415-9269")]),
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
  const roster = [jane, createAuthor("Martin Luther King Jr."), createAuthor("Ana García López"), bob];

  it("reads the app's own export back to the same authors, roles and ORCIDs", () => {
    const back = fromCrossrefContributors(toCrossrefContributors(roster));
    // The schema has no level slot, so the exported roles come back as lead.
    expect(back.map(shape)).toEqual(roster.map(shape));
    expect(back.find((a) => a.name === "Jane A. Smith")?.contributions.find((c) => c.score > 0)?.score).toBe(100);
  });

  it("reads an author before the people credited only in the Acknowledgements, in export order", () => {
    const back = fromCrossrefContributors(toCrossrefContributors([bob, jane]));
    expect(back.map((a) => [a.name, a.contributorType])).toEqual([
      ["Jane A. Smith", "author"],
      ["Bob White", "non-author"],
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
    ).toThrow(/entity/);
    expect(
      fromCrossrefContributors(
        '<contributors><person_name><role vocab="crossref" type="author"/></person_name></contributors>',
      ),
    ).toEqual([]);
  });
});

describe("isCrossrefContributors", () => {
  it("stays fast on runs of empty comments", () => {
    for (const n of [30, 5000]) {
      const start = performance.now();
      expect(isCrossrefContributors(`${"<!---->".repeat(n)}<x/>`)).toBe(false);
      expect(isCrossrefContributors(`${"<!---->".repeat(n)}<contributors>`)).toBe(true);
      expect(performance.now() - start).toBeLessThan(100);
    }
  });

  it("accepts a BOM, a declaration, comments and a self-closing root", () => {
    expect(isCrossrefContributors('\uFEFF<?xml version="1.0"?>\n<!-- a -->\n<!-- b -->\n<contributors/>')).toBe(true);
    expect(isCrossrefContributors("<contributorsX>")).toBe(false);
  });
});

describe("fromCrossrefContributors display name", () => {
  it("rebuilds the name as given + surname + suffix", () => {
    const xml =
      "<contributors><person_name><given_name>Jane</given_name><surname>Smith</surname><suffix>Jr</suffix></person_name></contributors>";
    expect(fromCrossrefContributors(xml).map((a) => a.name)).toEqual(["Jane Smith Jr"]);
    // A family-first name ("Smith, Jane") comes back given-first, as fromJats4rXml does.
    const author = createAuthor("Smith, Jane");
    expect(fromCrossrefContributors(toCrossrefContributors([author])).map((a) => a.name)).toEqual(["Jane Smith"]);
  });
});
