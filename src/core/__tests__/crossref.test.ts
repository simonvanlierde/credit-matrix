// biome-ignore-all lint/correctness/noNodejsModules: scripts/validate-crossref.sh reads the export from disk
import { writeFileSync } from "node:fs";
import process from "node:process";
import { describe, expect, it } from "vitest";
import { CREDIT_ROLES } from "../credit-roles";
import { toCrossrefContributors } from "../export/crossref";
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

  it("never claims a degree or an authenticated ORCID iD", () => {
    const xml = toCrossrefContributors([jane]);
    expect(xml).not.toMatch(/degree|lead|authenticated/);
  });

  it("marks non-authors 'other', and gives 'first' to the first author", () => {
    const xml = toCrossrefContributors([bob, jane]);
    expect(xml).toMatch(
      /<person_name sequence="additional">\n {4}<given_name>Bob<\/given_name>[\s\S]*?type="other"\/>/,
    );
    expect(xml).toMatch(/<person_name sequence="first">\n {4}<given_name>Jane A\./);
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
    toCrossrefContributors([jane, everyRole, bob, createAuthor("Madonna")]),
  );
});
