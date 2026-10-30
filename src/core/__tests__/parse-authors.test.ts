import { describe, expect, it } from "vitest";
import type { Author } from "../author";
import { MAX_AUTHOR_NAME_LENGTH } from "../author";
import {
  buildInitials,
  cleanNamePart,
  createAuthor,
  deduplicateAuthorInitials,
  normalizeRoster,
  parseAuthorText,
  parseNameParts,
  splitCommaSuffix,
  splitNameList,
} from "../parse-authors";

describe("parseNameParts", () => {
  it("parses a three-part name", () => {
    expect(parseNameParts("Jane A Smith")).toEqual({
      firstName: "Jane",
      middleName: "A",
      surname: "Smith",
    });
  });

  it("keeps a generational suffix out of the surname", () => {
    expect(parseNameParts("Martin Luther King Jr.")).toEqual({
      firstName: "Martin",
      middleName: "Luther",
      surname: "King",
    });
    expect(parseNameParts("Bob White III")).toEqual({ firstName: "Bob", middleName: "", surname: "White" });
    expect(parseNameParts("Ann Jr")).toEqual({ firstName: "Ann", middleName: "", surname: "Jr" });
  });

  it.each([
    ["King Jr., Martin", { firstName: "Martin", middleName: "", surname: "King" }],
    ["Smith Jr., John", { firstName: "John", middleName: "", surname: "Smith" }],
    ["King, Martin Luther, Jr.", { firstName: "Martin", middleName: "Luther", surname: "King" }],
  ])("keeps the suffix of the inverted name %s out of the surname", (name, parts) => {
    expect(parseNameParts(name)).toEqual(parts);
    expect(createAuthor(name)).toMatchObject({ name, ...parts });
  });

  it("reads a name with a comma before its suffix the usual way", () => {
    expect(parseNameParts("Martin Luther King, Jr.")).toEqual({
      firstName: "Martin",
      middleName: "Luther",
      surname: "King",
    });
  });

  it("re-parses an inverted name with a suffix rather than keep parts read front to back", () => {
    const old = createAuthor("King Jr., Martin", { firstName: "King", middleName: "Jr", surname: "Martin" });
    expect(normalizeRoster([old])[0]).toMatchObject({ firstName: "Martin", middleName: "", surname: "King" });
  });

  it("reads a suffix only from a whole word", () => {
    expect(parseNameParts("Priya Raman Srinivasan").surname).toBe("Srinivasan");
    expect(parseNameParts("Hiro Kenta Fujii").surname).toBe("Fujii");
  });

  it("keeps the middle dots, joiners and ZWNJ of a name", () => {
    expect(cleanNamePart("ジョン・スミス")).toBe("ジョン・スミス");
    expect(cleanNamePart("Gal·la")).toBe("Gal·la");
    expect(cleanNamePart("می\u200Cخواهم\u200D")).toBe("می\u200Cخواهم\u200D");
  });

  it("parses a two-part name (no middle)", () => {
    expect(parseNameParts("Bob White")).toEqual({
      firstName: "Bob",
      middleName: "",
      surname: "White",
    });
  });

  it("keeps Unicode letters, apostrophes and hyphens; drops other punctuation", () => {
    // spell-checker: ignore Séan García
    expect(parseNameParts("José García")).toEqual({
      firstName: "José",
      middleName: "",
      surname: "García",
    });
    expect(parseNameParts("Mary-Jane Watson")).toEqual({
      firstName: "Mary-Jane",
      middleName: "",
      surname: "Watson",
    });
    // Surname-first notation is normalized, and the apostrophe survives.
    expect(parseNameParts("O'Brien, Séan")).toEqual({ firstName: "Séan", middleName: "", surname: "O'Brien" });
  });

  it("parses surname-first notation into canonical name fields", () => {
    expect(parseNameParts("Curie, Marie")).toEqual({
      firstName: "Marie",
      middleName: "",
      surname: "Curie",
    });
    expect(parseNameParts("van der Berg, Anne")).toEqual({
      firstName: "Anne",
      middleName: "",
      surname: "van der Berg",
    });
  });

  it("keeps particles with the surname, in any case, as the comma form does", () => {
    const parts = { firstName: "Anne", middleName: "", surname: "van der Berg" };
    expect(parseNameParts("Anne van der Berg")).toEqual(parts);
    expect(parseNameParts("van der Berg, Anne")).toEqual(parts);
    expect(parseNameParts("Maria Luisa de la Cruz")).toEqual({
      firstName: "Maria",
      middleName: "Luisa",
      surname: "de la Cruz",
    });
    expect(parseNameParts("Anne Van der Berg").surname).toBe("Van der Berg");
    expect(parseNameParts("Anne DE LA CRUZ").surname).toBe("DE LA CRUZ");
    expect(parseNameParts("Jacobus van’t Hoff").surname).toBe("van’t Hoff");
    expect(parseNameParts("João dos Santos").surname).toBe("dos Santos");
    expect(parseNameParts("Ahmad bin Ali").surname).toBe("bin Ali");
    // The first name is never a particle, and "y" joins two surnames rather than leading one.
    expect(parseNameParts("van Berg").firstName).toBe("van");
    expect(parseNameParts("José Ortega y Gasset").surname).toBe("Gasset");
  });

  it("treats a single-token name as a first name with empty surname", () => {
    expect(parseNameParts("Madonna")).toEqual({
      firstName: "Madonna",
      middleName: "",
      surname: "",
    });
  });
});

describe("parseNameParts particles", () => {
  it.each([
    "van",
    "von",
    "de",
    "del",
    "della",
    "di",
    "da",
    "du",
    "le",
    "la",
    "den",
    "der",
    "ten",
    "ter",
    "dos",
    "das",
    "do",
    "los",
    "las",
    "degli",
    "dei",
    "dalla",
    "dal",
    "zu",
    "zur",
    "af",
    "bin",
    "ibn",
    "el",
    "al",
    "van't",
  ])("keeps %s with the surname", (particle) => {
    expect(parseNameParts(`Anna ${particle} Berg`)).toEqual({
      firstName: "Anna",
      middleName: "",
      surname: `${particle} Berg`,
    });
  });

  it("never pulls the first name into the surname", () => {
    expect(parseNameParts("van Berg")).toEqual({ firstName: "van", middleName: "", surname: "Berg" });
  });
});

describe("createAuthor", () => {
  it("uses the name parts it is given over the ones it would parse", () => {
    expect(
      createAuthor("Anne Marie Curie", { firstName: "Annie", middleName: "", surname: "Marie Curie" }),
    ).toMatchObject({ firstName: "Annie", middleName: "", surname: "Marie Curie" });
  });

  it("takes a name of exactly the maximum length", () => {
    const name = `Jane ${"a".repeat(MAX_AUTHOR_NAME_LENGTH - 5)}`;
    expect(createAuthor(name).name).toHaveLength(MAX_AUTHOR_NAME_LENGTH);
    expect(() => createAuthor(`${name}a`)).toThrow(/characters or fewer/);
  });

  it("writes initials in upper case for a name typed in lower case", () => {
    expect(createAuthor("jane anne smith").initials).toBe("JAS");
  });

  it.each([
    ["さくら", "さくら"],
    ["サクラ", "サクラ"],
    ["김민준", "김민준"],
    ["王 小明", "王小"],
    ["A王", "A"],
  ])("labels %s as %s", (name, initials) => {
    expect(createAuthor(name).initials).toBe(initials);
  });

  it("throws when the name contains no letters", () => {
    expect(() => createAuthor("123")).toThrow(/at least one letter/);
    expect(() => createAuthor("!!!")).toThrow(/at least one letter/);
  });

  it("rejects a malformed ORCID but accepts bare and URL forms", () => {
    expect(() => createAuthor("Jane Smith", { orcid: "not-an-orcid" })).toThrow(/ORCID/);
    expect(createAuthor("Jane Smith", { orcid: "0000-0002-1825-0097" }).orcid).toBe("0000-0002-1825-0097");
    expect(createAuthor("Jane Smith", { orcid: "https://orcid.org/0000-0002-1825-0097" }).orcid).toBe(
      "0000-0002-1825-0097",
    );
  });

  it("labels an unspaced CJK name by the whole name", () => {
    // Han, kana and Hangul names are written without spaces, so the first
    // character is the family name alone, not an initial.
    expect(createAuthor("王小明").initials).toBe("王小明");
    expect(createAuthor("ヤマダタロー").initials).toBe("ヤマダタロー");
    expect(createAuthor("김민준").initials).toBe("김민준");
    expect(parseAuthorText("王小明\n王大明").map((a) => a.initials)).toEqual(["王小明", "王大明"]);
  });

  it("never builds initials from punctuation", () => {
    // A row still named by its ORCID (lookup failed) keeps the iD as its label.
    expect(createAuthor("0000-0002-1825-0097").initials).toBe("0000-0002-1825-0097");
    expect(createAuthor("0000-0002-1694-233X").initials).toBe("0000-0002-1694-233X");
    expect(createAuthor("https://orcid.org/0000-0002-1825-0097").initials).toBe("0000-0002-1825-0097");
    expect(createAuthor("Jane - Smith").initials).toBe("JS");
  });

  it("takes the surname initial from its first word that is not a particle", () => {
    expect(createAuthor("Anne van der Berg").initials).toBe("AB");
    expect(createAuthor("van der Berg, Anne").initials).toBe("AB");
    expect(createAuthor("Leonardo da Vinci").initials).toBe("LV");
    expect(createAuthor("Jean-Luc de la Fontaine").initials).toBe("JF");
    expect(
      createAuthor("Anne van der Berg", { firstName: "Anne", middleName: "", surname: "van der Berg" }).initials,
    ).toBe("AB");
    // Telling two apart continues from that word, not from the particle.
    expect(parseAuthorText("Anne Bakker\nAnne van der Berg").map((a) => a.initials)).toEqual(["AB", "ABe"]);
  });

  it("keeps one character per name part when upper case would add one", () => {
    // "ß".toUpperCase() is "SS".
    expect(createAuthor("ßtefan Weiß").initials).toBe("ßW");
  });

  it("stores names in one Unicode form", () => {
    const nfd = createAuthor("Zoë Müller", { firstName: "Zoë" });
    expect(nfd.name).toBe("Zoë Müller");
    expect(nfd.firstName).toBe("Zoë");
    expect(nfd.initials).toBe("ZM");
  });

  it("turns control characters in a name into a space", () => {
    const author = createAuthor("Ann\u0001Lee\t", { surname: "Lee\u0000" });
    expect(author.name).toBe("Ann Lee");
    expect(author.surname).toBe("Lee");
  });

  it("cleans a long run of spaces in linear time, then applies the length cap", () => {
    const started = performance.now();
    expect(() => createAuthor(`a${" ".repeat(1_000_000)}b`)).toThrow(/characters or fewer/);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("deduplicateAuthorInitials", () => {
  it("does not mutate the input authors", () => {
    const original = [createAuthor("Alice Brown"), createAuthor("Amy Burke")];
    const beforeInitials = original.map((a) => a.initials);

    const deduped = deduplicateAuthorInitials(original);

    expect(original.map((a) => a.initials)).toEqual(beforeInitials);
    expect(deduped[0]).not.toBe(original[0]);
    expect(deduped[1]?.initials).not.toBe(deduped[0]?.initials);
  });

  it("still assigns unique initials when the surname runs out of letters", () => {
    // "Jo Li" → JL, then JLi (the surname's 2nd letter), and then the surname is
    // spent, so the disambiguator falls back to a counter suffix.
    const initials = parseAuthorText("Jo Li\nJo Li\nJo Li").map((a) => a.initials);
    expect(new Set(initials).size).toBe(3);
    expect(initials.slice(0, 2)).toEqual(["JL", "JLi"]);
  });

  it("counts on from 2 once the surname has no letters left", () => {
    expect(parseAuthorText("Jo Li\nJo Li\nJo Li\nJo Li").map((a) => a.initials)).toEqual(["JL", "JLi", "JL2", "JL3"]);
  });

  it("deduplicates supplementary-plane initials without corrupting Unicode", () => {
    const initials = parseAuthorText("A 𐐀x\nA 𐐀y").map((author) => author.initials);

    expect(initials).toEqual(["A𐐀", "A𐐀y"]);
    expect(initials.every((value) => value.isWellFormed())).toBe(true);
  });

  it("terminates when the counter suffix collides with an existing label", () => {
    // Raw name-part overrides (as XML import passes) can yield a digit initial
    // ("J" + "2nd" → "J2"), which the counter fallback then has to step past.
    const authors = [createAuthor("J 2nd", { firstName: "J", surname: "2nd" }), createAuthor("J"), createAuthor("J")];
    expect(authors[0]?.initials).toBe("J2");

    const initials = deduplicateAuthorInitials(authors).map((a) => a.initials);
    expect(new Set(initials).size).toBe(3);
  });
});

describe("parseAuthorText", () => {
  it("parses newline-separated names", () => {
    const authors = parseAuthorText("Alice Brown\nBob White\nCarol Ann Davis");
    expect(authors).toHaveLength(3);
    expect(authors[0]?.initials).toBe("AB");
    expect(authors[1]?.initials).toBe("BW");
    expect(authors[2]?.initials).toBe("CAD");
  });

  it("keeps a surname-first name as one contributor", () => {
    const authors = parseAuthorText("Curie, Marie");

    expect(authors).toHaveLength(1);
    expect(authors[0]).toMatchObject({ name: "Curie, Marie", firstName: "Marie", surname: "Curie", initials: "MC" });
  });

  it("deduplicates initials when authors share them", () => {
    const authors = parseAuthorText("Alice Brown\nAmy Burke");
    expect(authors[0]?.initials).toBe("AB");
    // Second author "Amy Burke" also starts as AB, so it should be disambiguated
    expect(authors[1]?.initials).not.toBe("AB");
  });

  it("assigns 14 default zero-score contributions to each author", () => {
    const authors = parseAuthorText("Alice Brown");
    expect(authors[0]?.contributions).toHaveLength(14);
    expect(authors[0]?.contributions.every((c) => c.score === 0)).toBe(true);
  });
});

describe("splitNameList", () => {
  it("splits on newlines, semicolons, and commas", () => {
    expect(splitNameList("Alice Brown, Bob White; Carol Davis\nDan Evans")).toEqual([
      "Alice Brown",
      "Bob White",
      "Carol Davis",
      "Dan Evans",
    ]);
  });

  it("splits on Word's Shift+Enter, form feeds and bare carriage returns", () => {
    expect(splitNameList("Ann Lee\vBob Kim\fCay Dunn\rDee Fox\r\nEd Ng")).toEqual([
      "Ann Lee",
      "Bob Kim",
      "Cay Dunn",
      "Dee Fox",
      "Ed Ng",
    ]);
  });

  it("keeps a 'Lastname, Firstname' pair as one contributor", () => {
    expect(splitNameList("Curie, Marie")).toEqual(["Curie, Marie"]);
    expect(splitNameList("Curie, M.")).toEqual(["Curie, M."]);
    expect(splitNameList("Curie, Marie; Smith, Jane")).toEqual(["Curie, Marie", "Smith, Jane"]);
  });

  it("keeps multi-token given names and initials attached to their surname", () => {
    expect(splitNameList("Smith, J. A.")).toEqual(["Smith, J. A."]);
    expect(splitNameList("Curie, Marie Skłodowska")).toEqual(["Curie, Marie Skłodowska"]);
    expect(splitNameList("van der Berg, Anne")).toEqual(["van der Berg, Anne"]);
  });

  it("reads a comma-only list of inverted names as pairs", () => {
    expect(splitNameList("Curie, Marie, Smith, J. A.")).toEqual(["Curie, Marie", "Smith, J. A."]);
  });

  it("treats commas as separators when the chunks don't pair up as surname + given name", () => {
    expect(splitNameList("Alice Brown, Bob White")).toEqual(["Alice Brown", "Bob White"]);
    expect(splitNameList("Marie Curie, Jane Smith, Cher, Madonna")).toEqual([
      "Marie Curie",
      "Jane Smith",
      "Cher",
      "Madonna",
    ]);
  });

  it("reads up to three given names as the second half of an inverted name, not four", () => {
    expect(splitNameList("Smith, Jane Ann Marie")).toEqual(["Smith, Jane Ann Marie"]);
    expect(splitNameList("Smith, Jane Ann Marie Lou")).toEqual(["Smith", "Jane Ann Marie Lou"]);
  });

  it("does not read a chunk that ends without a letter as a surname", () => {
    expect(splitNameList("Lab 42, Jane")).toEqual(["Lab 42", "Jane"]);
  });

  it("splits a list containing a mononym", () => {
    expect(splitNameList("Marie Curie, Jane Smith, Cher")).toEqual(["Marie Curie", "Jane Smith", "Cher"]);
  });

  it("splits a name paired with an ORCID iD rather than reading it as an inverted name", () => {
    expect(splitNameList("Jane Smith, 0000-0002-1825-0097")).toEqual(["Jane Smith", "0000-0002-1825-0097"]);
  });

  it("ignores empty entries and surrounding whitespace", () => {
    expect(splitNameList("  Alice Brown ,, \n\n ; Bob White ")).toEqual(["Alice Brown", "Bob White"]);
  });
});

describe("name parsing edge cases", () => {
  it("reads an inverted name past a stray comma and doubled spaces", () => {
    expect(parseNameParts("Curie, Marie,")).toEqual({ firstName: "Marie", middleName: "", surname: "Curie" });
    expect(parseNameParts("Curie, Marie  Anne")).toEqual({ firstName: "Marie", middleName: "Anne", surname: "Curie" });
    expect(parseNameParts("Jane  Ann Smith")).toEqual({ firstName: "Jane", middleName: "Ann", surname: "Smith" });
  });

  it("gives no name parts for a name without letters", () => {
    expect(parseNameParts("1234")).toEqual({ firstName: "", middleName: "", surname: "" });
  });

  it("trims what it keeps of a name part", () => {
    expect(cleanNamePart(" O'Brien! ")).toBe("O'Brien");
  });

  it("labels a name with no lettered part by the name itself, trimmed", () => {
    expect(buildInitials(" 0000-0002-1825-009X ", "", "", "")).toBe("0000-0002-1825-009X");
    expect(buildInitials(" #1 ", "", "", "")).toBe("#1");
  });

  it("takes the surname initial from an all-particle surname", () => {
    expect(createAuthor("Anne De La").initials).toBe("AD");
  });

  it("turns a run of pasted line breaks into one space", () => {
    expect(createAuthor("Jane\n\r\nSmith").name).toBe("Jane Smith");
  });
});

describe("splitNameList comma pairs", () => {
  it("keeps an inverted name whole past a trailing comma", () => {
    expect(splitNameList("Curie, Marie,")).toEqual(["Curie, Marie"]);
  });

  it("keeps a suffix with the name it follows", () => {
    expect(splitNameList("King Jr., Martin; King, Martin Luther, Jr.")).toEqual([
      "King Jr., Martin",
      "King, Martin Luther, Jr.",
    ]);
    expect(splitNameList("Martin Luther King, Jr., Jane Smith")).toEqual(["Martin Luther King, Jr.", "Jane Smith"]);
  });

  it("joins a suffix only to a name before it, and reads a lone one as a surname", () => {
    expect(splitNameList("Jr., Ann Lee")).toEqual(["Jr., Ann Lee"]);
    expect(splitNameList("Jr, Ann")).toEqual(["Jr, Ann"]);
    expect(splitNameList("van der Berg Jr., Anne")).toEqual(["van der Berg Jr., Anne"]);
  });

  it("does not read an ORCID iD or a number as a surname", () => {
    expect(splitNameList("0000-0002-1825-009X, Jane")).toEqual(["0000-0002-1825-009X", "Jane"]);
    expect(splitNameList("2, Jane")).toEqual(["2", "Jane"]);
  });

  it("pairs a surname only with given names made of letters", () => {
    for (const given of ["Jane 2", "2Jane", "Jane2"]) {
      expect(splitNameList(`Smith, ${given}`)).toEqual(["Smith", given]);
    }
  });
});

describe("normalizeRoster name parts", () => {
  const rebuilt = (author: Author) => {
    const [row] = normalizeRoster([author]);
    return row && { firstName: row.firstName, middleName: row.middleName, surname: row.surname };
  };

  it("keeps a structured multi-word surname with more given names than the middle name holds", () => {
    const ana = createAuthor("Ana María José García López", {
      firstName: "Ana",
      middleName: "María",
      surname: "García López",
    });
    expect(rebuilt(ana)).toEqual({ firstName: "Ana", middleName: "María", surname: "García López" });
  });

  it("looks past a suffix after the stored surname, but not one the surname holds", () => {
    const parts = (name: string, firstName: string, middleName: string, surname: string) =>
      rebuilt(createAuthor(name, { firstName, middleName, surname }));
    expect(parts("Maria Garcia Lopez Jr.", "Maria", "", "Garcia Lopez")).toEqual({
      firstName: "Maria",
      middleName: "",
      surname: "Garcia Lopez",
    });
    expect(parts("Martin Luther King Jr.", "Martin", "Luther", "King Jr.")).toMatchObject({ surname: "King Jr." });
    expect(parts("Ann B Jr", "Ann", "B", "Jr")).toMatchObject({ surname: "Jr" });
    expect(parts("Ann Jr", "Ann", "", "")).toMatchObject({ surname: "Jr" });
  });

  it("re-parses a renamed row whose surname no longer ends the name", () => {
    const maria = createAuthor("Maria Garcia Lopez", { firstName: "Maria", middleName: "", surname: "Garcia Lopez" });
    expect(rebuilt({ ...maria, name: "Maria Garcia Lopez Smith" })).toEqual({
      firstName: "Maria",
      middleName: "Garcia",
      surname: "Smith",
    });
  });

  it("re-parses parts that leave out the first name or use a word twice", () => {
    const jane = createAuthor("Jane Smith");
    expect(rebuilt({ ...jane, firstName: "" })).toEqual({ firstName: "Jane", middleName: "", surname: "Smith" });
    const smith = createAuthor("Smith");
    expect(rebuilt({ ...smith, firstName: "Smith", surname: "Smith" })).toEqual({
      firstName: "Smith",
      middleName: "",
      surname: "",
    });
  });

  it("re-parses a row whose name parts are missing, as an old export has", () => {
    const old = { ...createAuthor("Jane Ann Smith"), firstName: undefined, middleName: undefined, surname: undefined };
    expect(rebuilt(old as unknown as Author)).toEqual({ firstName: "Jane", middleName: "Ann", surname: "Smith" });
  });

  it("fills in the roles a stored row is missing", () => {
    const jane = createAuthor("Jane Smith");
    const [row] = normalizeRoster([{ ...jane, contributions: jane.contributions.slice(0, 3) }]);
    expect(row?.contributions).toHaveLength(jane.contributions.length);
  });
});

describe("splitCommaSuffix", () => {
  it("takes the suffix out of an inverted name", () => {
    expect(splitCommaSuffix("van der Berg Jr., Anne")).toEqual(["van der Berg, Anne", "Jr."]);
    expect(splitCommaSuffix("King  Jr., Martin")).toEqual(["King, Martin", "Jr."]);
    expect(splitCommaSuffix("King, Martin, III")).toEqual(["King, Martin", "III"]);
  });

  it("leaves any other name whole", () => {
    for (const name of [
      "Martin King Jr.",
      "Jr., Martin",
      "Curie, Marie, Anne",
      "King, Martin, Jr., Ann",
      "King Jr.,",
    ]) {
      expect(splitCommaSuffix(name)).toEqual([name, ""]);
    }
  });
});
