// biome-ignore lint/correctness/noNodejsModules: tests run in Node; fixtures are files on disk
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Author } from "../author";
import { CREDIT_ROLES } from "../credit-roles";
import { fromTenzing, isTenzing, toTenzing } from "../export/tenzing";
import { detectFormat } from "../import";
import { createAuthor } from "../parse-authors";

function fixture(name: string): string {
  return readFileSync(`src/core/__tests__/fixtures/${name}`, "utf8");
}

function roles(author: Author | undefined): string[] {
  return (author?.contributions ?? []).filter((c) => c.score > 0).map((c) => `${c.role}:${c.score}`);
}

const ANA_ROLES = [
  "Conceptualization:100",
  "Funding acquisition:100",
  "Methodology:100",
  "Supervision:100",
  "Writing – original draft:100",
  "Writing – review & editing:100",
];

describe("fromTenzing", () => {
  it("skips a row with no usable name and keeps the rest", () => {
    const authors = fromTenzing("Firstname,Surname,Conceptualization\nAna,Lee,TRUE\n--,--,TRUE\nBo,Kim,FALSE");
    expect(authors.map((a) => a.name)).toEqual(["Ana Lee", "Bo Kim"]);
  });

  it("reads tenzing's example CSV layout in publication order", () => {
    const [ana, bob, carol, ...rest] = fromTenzing(fixture("tenzing.csv"));
    expect(rest).toEqual([]);

    expect(ana).toMatchObject({
      name: "Ana María José-García",
      firstName: "Ana",
      middleName: "María",
      surname: "José-García",
      orcid: "0000-0002-1825-0097",
      contributorType: "author",
      corresponding: true,
    });
    expect(roles(ana)).toEqual(ANA_ROLES);

    expect(bob).toMatchObject({ name: "Bob White", contributorType: "author", corresponding: false });
    expect(bob?.orcid).toBeUndefined();
    expect(roles(bob)).toEqual([
      "Data curation:100",
      "Formal analysis:100",
      "Software:100",
      "Writing – review & editing:100",
    ]);

    expect(carol).toMatchObject({ name: "Carol Black", contributorType: "non-author" });
    expect(roles(carol)).toEqual(["Investigation:100"]);
  });

  it("still reads the older Acknowledgee value as an acknowledgee", () => {
    const [ana] = fromTenzing("Author/Acknowledgee,Firstname,Surname\nAcknowledgee,Ana,Lopez");
    expect(ana).toMatchObject({ contributorType: "non-author" });
  });

  it('drops a row where tenzing records "Don\'t agree to be named", but keeps a blank status as an author', () => {
    const sheet = [
      "Author/Acknowledgee,Firstname,Surname",
      "Author,Ana,Lee",
      "Don't agree to be named,Bo,Kim",
      "don\u2019t agree to be named,Cy,Ray",
      ",Di,Fox",
    ].join("\n");
    const authors = fromTenzing(sheet);
    expect(authors.map((a) => a.name)).toEqual(["Ana Lee", "Di Fox"]);
    expect(authors.every((a) => a.contributorType === "author")).toBe(true);
  });

  it("matches headers by name in a reordered TSV with a Note column", () => {
    const [ana, ...rest] = fromTenzing(fixture("tenzing-reordered.tsv"));
    expect(rest).toEqual([]);
    expect(ana).toMatchObject({ name: "Ana María José-García", orcid: "0000-0002-1825-0097", corresponding: true });
    expect(roles(ana)).toEqual(ANA_ROLES);
  });
});

describe("fromTenzing edge cases", () => {
  it("drops a bad ORCID but keeps the person, and leaves a blank one unset", () => {
    const [ana, bob] = fromTenzing("Firstname,Surname,ORCID ID\nAna,Lopez,not-an-orcid\nBob,White,");
    expect(ana).toMatchObject({ name: "Ana Lopez" });
    expect(ana?.orcid).toBeUndefined();
    expect(bob?.orcid).toBeUndefined();
  });

  it("keeps sheet order for rows without an order, and sorts the numbered rows first", () => {
    const names = fromTenzing(
      "Firstname,Surname,Order in publication\nCy,Third,\nAl,Second,2\nDi,Fourth,\nBo,First,1",
    ).map((a) => a.name);
    expect(names).toEqual(["Bo First", "Al Second", "Cy Third", "Di Fourth"]);
  });

  it("reads a sheet with a BOM, CRLF lines and short rows", () => {
    const [ana, ...rest] = fromTenzing("\uFEFFFirstname,Surname,Software\r\nAna,Lopez\r\n");
    expect(rest).toEqual([]);
    expect(ana?.name).toBe("Ana Lopez");
    expect(roles(ana)).toEqual([]);
  });

  it("reads a header-only sheet and empty text as nobody", () => {
    expect(fromTenzing("Firstname,Surname")).toEqual([]);
    expect(fromTenzing("")).toEqual([]);
  });

  it("keeps a comma inside a quoted cell", () => {
    const [ana] = fromTenzing('Firstname,Surname,Software\nAna,"Lopez, Jr",TRUE');
    expect(ana).toMatchObject({ firstName: "Ana", surname: "Lopez, Jr" });
    expect(roles(ana)).toEqual(["Software:100"]);
  });

  it("reads a semicolon sheet, as Excel saves it in Dutch, German or French", () => {
    // The quoted "Led the work, wrote it" note becomes a quoted cell holding a semicolon.
    const sheet = fixture("tenzing.csv").replaceAll(",", ";");
    expect(isTenzing(sheet)).toBe(true);
    const [ana] = fromTenzing(sheet);
    expect(ana).toMatchObject({ name: "Ana María José-García", corresponding: true });
    expect(roles(ana)).toEqual(ANA_ROLES);
  });

  it("reads a TSV", () => {
    const [ana] = fromTenzing("Firstname\tSurname\tSoftware\nAna\tLopez\tTRUE");
    expect(ana?.name).toBe("Ana Lopez");
    expect(roles(ana)).toEqual(["Software:100"]);
  });

  it("ignores unknown headers and reads the first of two same-named columns", () => {
    const [ana] = fromTenzing("Firstname,Surname,Shoe size,Software,Software\nAna,Lopez,38,TRUE,");
    expect(ana?.name).toBe("Ana Lopez");
    expect(roles(ana)).toEqual(["Software:100"]);
  });
});

describe("isTenzing", () => {
  it("recognises both layouts", () => {
    expect(isTenzing(fixture("tenzing.csv"))).toBe(true);
    expect(isTenzing(fixture("tenzing-reordered.tsv"))).toBe(true);
  });

  it("recognises a header without the Author/Acknowledgee column by its roles", () => {
    const roleHeaders = "Conceptualization,Data curation,Formal analysis,Funding acquisition,Investigation";
    const more = "Methodology,Project administration,Resources,Software,Supervision";
    expect(isTenzing(`Firstname,Surname,${roleHeaders},${more}`)).toBe(true);
    expect(isTenzing(`Name,${roleHeaders},${more}`)).toBe(false);
    expect(isTenzing("Anne Namer, Bob Smith")).toBe(false);
    expect(isTenzing("Firstname,Surname")).toBe(false);
    expect(isTenzing("")).toBe(false);
  });
});

describe("toTenzing", () => {
  const scored = (done: string[], score = 100) =>
    CREDIT_ROLES.map((role) => ({ role: role.name, score: done.includes(role.name) ? score : 0 }));

  const draft = [
    createAuthor("Ana María José-García", {
      firstName: "Ana",
      middleName: "María",
      surname: "José-García",
      orcid: "0000-0002-1825-0097",
      corresponding: true,
      contributions: scored(["Conceptualization", "Writing – original draft", "Writing – review & editing"]),
    }),
    createAuthor("Kim Nam-joon", { contributorType: "non-author", contributions: scored(["Investigation"], 33) }),
    createAuthor("Martin Luther King Jr.", { contributions: scored(["Software", "Data curation"], 66) }),
    createAuthor("Gerard 't Hooft", { contributions: scored(CREDIT_ROLES.map((role) => role.name)) }),
    createAuthor("María José García López", { corresponding: true, contributions: scored(["Resources"]) }),
    createAuthor("Plato", { contributions: scored(["Validation", "Visualization"]) }),
    createAuthor("Jane A. Smith", { contributorType: "non-author" }),
    createAuthor("Seán O'Brien", { contributions: scored(["Supervision", "Project administration"]) }),
    // A spreadsheet runs a cell that starts with "=" or "@"; a comma or quote needs quoting.
    createAuthor("=Cy Lee, Jr", { firstName: "=Cy", surname: "Lee, Jr", contributions: scored(["Methodology"]) }),
    createAuthor('@Dee "DJ" Ray', { firstName: "@Dee", middleName: '"DJ"', surname: "Ray" }),
  ];

  it("writes the columns of tenzing's example CSV, in its order", () => {
    const header = (text: string) => text.split(/\r?\n/)[0];
    expect(header(toTenzing([]))).toBe(header(fixture("tenzing.csv")));
  });

  it("is read back as a tenzing sheet", () => {
    const sheet = toTenzing(draft);
    expect(isTenzing(sheet)).toBe(true);
    expect(detectFormat(sheet)).toBe("tenzing");
  });

  it("keeps every contributor and every role through a round trip", () => {
    const summary = (authors: Author[]) =>
      authors
        .map((author) => ({
          name: author.name,
          orcid: author.orcid,
          contributorType: author.contributorType,
          corresponding: author.corresponding,
          // tenzing has no degree, so a role keeps whether it was done.
          roles: author.contributions.filter((c) => c.score > 0).map((c) => c.role),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    expect(summary(fromTenzing(toTenzing(draft)))).toEqual(summary(draft));
  });

  it("numbers authors in draft order and puts acknowledgees after them", () => {
    const names = fromTenzing(toTenzing(draft)).map((a) => a.name);
    expect(names).toEqual([
      "Ana María José-García",
      "Martin Luther King Jr.",
      "Gerard 't Hooft",
      "María José García López",
      "Plato",
      "Seán O'Brien",
      "=Cy Lee, Jr",
      '@Dee "DJ" Ray',
      "Kim Nam-joon",
      "Jane A. Smith",
    ]);
  });

  it("writes a role as TRUE whatever its level, and keeps every word of a name", () => {
    const rows = toTenzing(draft).split("\n");
    expect(rows[2]).toBe(
      "Acknowledgment only,9,Kim,,Nam-joon,FALSE,FALSE,FALSE,FALSE,TRUE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,,,,,,,,FALSE,",
    );
    expect(rows[3]?.startsWith("Author,2,Martin,Luther King,Jr.,FALSE,TRUE,")).toBe(true);
  });

  it("numbers every row, acknowledgees after the authors, so tenzing can build its acknowledgee section", () => {
    const order = toTenzing(draft)
      .split("\n")
      .slice(1)
      .map((row) => row.split(",")[1]);
    expect(order).not.toContain("NA");
    expect(order).toEqual(["1", "9", "2", "3", "4", "5", "10", "6", "7", "8"]);
  });

  it("exports a leading apostrophe once, and reads it back", () => {
    const rows = toTenzing(draft).split("\n");
    expect(rows[4]).toContain(",Gerard,'t,Hooft,");
    expect(rows[4]).not.toContain("''t");
    expect(fromTenzing(toTenzing(draft)).map((a) => a.name)).toContain("Gerard 't Hooft");
  });

  it("marks only an author as corresponding", () => {
    const people = [
      createAuthor("Ana Lee", { corresponding: true }),
      createAuthor("Bo Kim", { contributorType: "non-author", corresponding: true }),
    ];
    const cells = toTenzing(people)
      .split("\n")
      .slice(1)
      .map((row) => row.split(",").at(-2));
    expect(cells).toEqual(["TRUE", "FALSE"]);
  });

  it("marks acknowledgees with the exact value tenzing keeps, and authors with Author", () => {
    // tenzing's filter_acknowledgees matches "Acknowledgment only" exactly, filter_authors "Author".
    const column = toTenzing(draft)
      .split("\n")
      .slice(1)
      .map((row) => row.split(",")[0]);
    expect(column.filter((value) => value !== "Author")).toEqual(["Acknowledgment only", "Acknowledgment only"]);
    expect(column.filter((value) => value === "Author")).toHaveLength(8);
  });

  it("guards a cell a spreadsheet would run as a formula", () => {
    const rows = toTenzing(draft).split("\n");
    expect(rows[9]?.startsWith('Author,7,\'=Cy,,"Lee, Jr",')).toBe(true);
    expect(rows[10]?.startsWith('Author,8,\'@Dee,"""DJ""",Ray,')).toBe(true);
  });

  it("guards a cell that starts with + or -, and reads it back unchanged", () => {
    const people = [
      createAuthor("+Pat Lee", { firstName: "+Pat", surname: "Lee" }),
      createAuthor("-Sam Ray", { firstName: "-Sam", surname: "Ray" }),
    ];
    const rows = toTenzing(people).split("\n");
    expect(rows[1]?.startsWith("Author,1,'+Pat,,Lee,")).toBe(true);
    expect(rows[2]?.startsWith("Author,2,'-Sam,,Ray,")).toBe(true);
    expect(fromTenzing(toTenzing(people)).map((a) => a.name)).toEqual(["+Pat Lee", "-Sam Ray"]);
  });
});
