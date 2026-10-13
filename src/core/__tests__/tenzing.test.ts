// biome-ignore lint/correctness/noNodejsModules: tests run in Node; fixtures are files on disk
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Author } from "../author";
import { fromTenzing, isTenzing } from "../export/tenzing";

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
