import { describe, expect, it } from "vitest";
import { readPerson } from "../export/xml-import";

describe("readPerson", () => {
  it("squashes whitespace and splits given names into first and middle", () => {
    const person = readPerson({ given: "  Ana\n  Maria ", surname: "García  López" }, {});
    expect(person).toMatchObject({ firstName: "Ana", middleName: "Maria", surname: "García López" });
  });

  it("returns null for a nameless person", () => {
    expect(readPerson({ given: " ", surname: null }, {})).toBeNull();
  });

  it("drops an ORCID with a bad check digit and keeps a good one, bare or as a URI", () => {
    expect(readPerson({ given: "A", surname: "B", orcid: "0000-0002-1825-0098" }, {})?.orcid).toBeUndefined();
    expect(readPerson({ given: "A", surname: "B", orcid: "https://orcid.org/0000-0002-1825-0097" }, {})?.orcid).toBe(
      "0000-0002-1825-0097",
    );
  });
});
