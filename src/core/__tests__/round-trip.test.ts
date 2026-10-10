import { describe, expect, it } from "vitest";
import { MAX_AUTHORS } from "../author";
import { fromJson, NewerVersionError, toJson } from "../export/json";
import { toJats4rXml } from "../export/xml";
import { fromJats4rXml } from "../export/xml-import";
import { parseAuthorText } from "../parse-authors";

describe("round-trip exports", () => {
  it("XML round-trip preserves names, initials, contributions, and ORCID", () => {
    const authors = parseAuthorText("Jane Smith\nBob White");
    // set some scores and an ORCID
    const [jane, bob] = authors;
    if (!(jane && bob)) throw new Error("expected 2 authors");

    const jc0 = jane.contributions[0];
    if (!jc0) throw new Error("expected contribution 0 for jane");
    jc0.score = 100;
    const jc8 = jane.contributions[8];
    if (!jc8) throw new Error("expected contribution 8 for jane");
    jc8.score = 50;
    const bc0 = bob.contributions[0];
    if (!bc0) throw new Error("expected contribution 0 for bob");
    bc0.score = 20;
    const bc4 = bob.contributions[4];
    if (!bc4) throw new Error("expected contribution 4 for bob");
    bc4.score = 100;
    jane.orcid = "0000-0002-1825-0097";

    const xml = toJats4rXml(authors);
    const parsed = fromJats4rXml(xml);

    expect(parsed).toHaveLength(2);
    const [pJane, pBob] = parsed;
    expect(pJane?.surname).toBe(jane.surname);
    expect(pJane?.firstName).toBe(jane.firstName);
    expect(pJane?.initials).toBe(jane.initials);
    expect(pJane?.orcid).toBe(jane.orcid);

    expect(pBob?.surname).toBe(bob.surname);
    expect(pBob?.initials).toBe(bob.initials);

    // contributions should be present and have the active ones set to 100
    const janeActive = pJane?.contributions.filter((c) => c.score > 0).map((c) => c.role);
    expect(janeActive).toContain("Conceptualization");
    expect(janeActive).toContain("Software");

    // `degree-contribution` keeps the level, not the exact score: 50 (equal)
    // comes back as 66, 20 (supporting) as 33.
    expect(pJane?.contributions.find((c) => c.role === "Software")?.score).toBe(66);
    expect(pBob?.contributions[0]?.score).toBe(33);
    expect(pBob?.contributions[4]?.score).toBe(100);
    expect(xml).not.toContain("permissions");
  });

  it("JSON round-trip preserves all fields including id", () => {
    const authors = parseAuthorText("Jane Smith\nBob White");
    const [jane] = authors;
    if (!jane) throw new Error("expected at least one author");

    const jc = jane.contributions[0];
    if (!jc) throw new Error("expected contribution 0 for jane");
    jc.score = 100;
    const json = toJson(authors);
    const parsed = fromJson(json);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.id).toBeDefined();
    expect(parsed[0]?.name).toBe(jane.name);
    expect(parsed[0]?.contributions[0]?.score).toBe(100);
  });

  it("rejects JSON payloads beyond the contributor limit", () => {
    const [author] = parseAuthorText("Jane Smith");
    if (!author) throw new Error("expected author");
    const payload = JSON.stringify({ version: 1, authors: Array.from({ length: MAX_AUTHORS + 1 }, () => author) });

    expect(() => fromJson(payload)).toThrow();
  });

  it("rejects only a numeric version above the supported one as newer", () => {
    expect(() => fromJson('{"version": 2, "authors": []}')).toThrow(NewerVersionError);
    expect(() => fromJson('{"version": "2", "authors": []}')).not.toThrow(NewerVersionError);
    expect(() => fromJson("[]")).not.toThrow(NewerVersionError);
    expect(() => fromJson("null")).not.toThrow(NewerVersionError);
    expect(fromJson('{"version": 1, "authors": []}')).toEqual([]);
  });

  it("XML round-trip preserves ORCID value", () => {
    const authors = parseAuthorText("Jane Smith");
    const [jane] = authors;
    if (!jane) throw new Error("expected author");

    jane.orcid = "0000-0001-2345-6789";
    const xml = toJats4rXml(authors);

    const parsed = fromJats4rXml(xml);
    expect(parsed[0]?.orcid).toBe("0000-0001-2345-6789");
  });

  it("XML round-trip preserves non-author contributor type", () => {
    const [contributor] = parseAuthorText("Alex Rivera");
    if (!contributor) throw new Error("expected contributor");
    contributor.contributorType = "non-author";

    const [parsed] = fromJats4rXml(toJats4rXml([contributor]));

    expect(parsed?.contributorType).toBe("non-author");
  });

  it("exports surname-first names into the correct JATS fields", () => {
    const [curie] = parseAuthorText("Curie, Marie");
    if (!curie) throw new Error("expected contributor");

    const xml = toJats4rXml([curie]);

    expect(xml).toContain("<given-names>Marie</given-names>");
    expect(xml).toContain("<surname>Curie</surname>");
  });

  // Regression: the importer used to rejoin given + surname and re-parse the
  // string, which cannot recover a multi-word surname. "van der Berg" came
  // back as middle name "van" + surname "Berg", changing the initials too.
  it.each([
    ["van der Berg, Anne", "Anne", "", "van der Berg", "AV"],
    ["de la Cruz, Maria", "Maria", "", "de la Cruz", "MD"],
    ["Smith, John", "John", "", "Smith", "JS"],
  ])("XML round-trip preserves the particle surname in %s", (input, first, middle, surname, initials) => {
    const [author] = parseAuthorText(input);
    if (!author) throw new Error("expected contributor");

    const [parsed] = fromJats4rXml(toJats4rXml([author]));

    expect(parsed?.firstName).toBe(first);
    expect(parsed?.middleName).toBe(middle);
    expect(parsed?.surname).toBe(surname);
    expect(parsed?.initials).toBe(initials);
  });
});
