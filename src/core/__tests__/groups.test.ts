import { describe, expect, it } from "vitest";
import { ContributorSchema, isValidRor, MAX_GROUP_MEMBERS, normalizeRor } from "../author";
import { toCodemeta } from "../export/codemeta";
import { fromCrossrefContributors, toCrossrefContributors } from "../export/crossref";
import { fromCsv, toCsv } from "../export/csv";
import { toMyst, toQuarto } from "../export/frontmatter";
import { fromJson, toJson } from "../export/json";
import { toRoCrateFragment } from "../export/ro-crate";
import { fromTenzing, toTenzing } from "../export/tenzing";
import { toJats4rXml } from "../export/xml";
import { fromJats4rXml } from "../export/xml-import";
import { generateStatement } from "../generate-statement";
import { importAny } from "../import";
import { keepKnownIds, newContributors } from "../merge-row";
import { createAuthor, createGroup, groupInitials, normalizeRoster } from "../parse-authors";
import { decodeShareHash, encodeShareHash } from "../share-link";
import { fromSharePayload, toSharePayload } from "../share-payload";

// Caltech's ROR id: a real one, so the checksum is tested against a published value.
const ROR = "05dxps055";

const covid = () =>
  createGroup("The COVIDSurg Collaborative", {
    id: "covid",
    alias: "COVIDSurg",
    ror: `https://ror.org/${ROR}`,
    members: [{ name: "Ada Lovelace" }, { name: "Smith, Jones & Lee" }],
    membersAre: "authors",
    contributions: [{ role: "Investigation", score: 100 }],
  });

describe("ROR ids", () => {
  it("checks shape and checksum, not existence", () => {
    expect(isValidRor(ROR)).toBe(true);
    expect(isValidRor(`https://ror.org/${ROR}/`)).toBe(true);
    expect(isValidRor("05dxps056")).toBe(false);
    expect(isValidRor("15dxps055")).toBe(false);
    expect(isValidRor("")).toBe(false);
    expect(normalizeRor(" HTTPS://ROR.ORG/05DXPS055 ")).toBe(ROR);
  });
});

describe("group model", () => {
  it("derives chip initials from the alias, else the name without a leading The", () => {
    expect(groupInitials("The COVIDSurg Collaborative")).toBe("CC");
    expect(groupInitials("COVIDSurg Collaborative")).toBe("CC");
    expect(groupInitials("The COVIDSurg Collaborative", "COVIDSurg")).toBe("COVIDSurg");
    expect(groupInitials("The")).toBe("T");
  });

  it("is a discriminated union on kind, and a row without kind is a person", () => {
    const group = covid();
    expect(ContributorSchema.parse(group)).toEqual(group);
    const { kind: _kind, ...legacy } = createAuthor("Ada Lovelace");
    expect(ContributorSchema.parse(legacy).kind).toBe("person");
    expect(() => ContributorSchema.parse({ ...group, ror: "05dxps056" })).toThrow();
    // A group has no ORCID iD: the schema drops one, as it drops any unknown field.
    expect(ContributorSchema.parse({ ...group, orcid: "0000-0002-1825-0097" })).not.toHaveProperty("orcid");
    expect(() => createGroup("123")).toThrow();
    expect(() => createGroup("Group", { ror: "nope" })).toThrow(/ROR/);
  });

  it("keeps the contact only while a linked member is that person", () => {
    const ada = createAuthor("Ada Lovelace", { id: "ada" });
    const group = createGroup("Group", {
      members: [{ name: "Ada Lovelace", personId: "ada" }, { name: "Alan" }],
      contactId: "ada",
    });
    expect(group.contactId).toBe("ada");
    expect(createGroup("Group", { members: [{ name: "Ada" }], contactId: "ada" }).contactId).toBeUndefined();
    // Deleting the row drops the link and keeps the name, and with the link the contact.
    const [, kept] = normalizeRoster([ada, group]);
    expect(kept).toMatchObject({ members: [{ name: "Ada Lovelace", personId: "ada" }, { name: "Alan" }] });
    const [after] = normalizeRoster([group]);
    expect(after).toMatchObject({ members: [{ name: "Ada Lovelace" }, { name: "Alan" }] });
    expect(after).not.toHaveProperty("contactId");
  });

  it("returns an unchanged roster as the same rows, groups included", () => {
    const roster = normalizeRoster([createAuthor("Ada Lovelace"), covid()]);
    expect(normalizeRoster(roster)[1]).toBe(roster[1]);
  });

  it("numbers repeated chip text instead of looping", () => {
    const [a, b] = normalizeRoster([createGroup("Alpha Beta"), createGroup("Alpha Beta")]);
    expect(a?.initials).toBe("AB");
    expect(b?.initials).toBe("AB1");
  });

  it("caps the member list", () => {
    const members = Array.from({ length: MAX_GROUP_MEMBERS + 5 }, (_, i) => ({ name: `Member ${i}` }));
    expect(createGroup("Big Group", { members }).members).toHaveLength(MAX_GROUP_MEMBERS);
  });

  it("never matches a person when merging an import", () => {
    const person = createAuthor("Ada Lovelace");
    const group = createGroup("Ada Lovelace");
    expect(newContributors([person], [group])).toEqual([group]);
    expect(keepKnownIds([person], [group])[0]?.id).toBe(group.id);
  });
});

describe("statements", () => {
  it("names a group by its name, or its chip text in the short formats", () => {
    const roster = [covid(), createAuthor("Ada Lovelace", { contributions: [{ role: "Software", score: 100 }] })];
    expect(generateStatement([covid()], { format: "by-author" })).toBe(
      "CRediT: The COVIDSurg Collaborative: Investigation",
    );
    expect(generateStatement(roster, { format: "by-role" })).toBe(
      "CRediT: Investigation: The COVIDSurg Collaborative; Software: Ada Lovelace",
    );
    expect(generateStatement(roster, { format: "by-author-short" })).toContain("COVIDSurg: Investigation");
  });
});

describe("JSON export", () => {
  it("writes version 2 and reads a group back whole", () => {
    const roster = [createAuthor("Ada Lovelace", { id: "ada" }), covid()];
    const text = toJson(roster);
    expect(JSON.parse(text).version).toBe(2);
    expect(fromJson(text).authors).toEqual(roster);
  });

  it("still reads a version 1 file, whose rows have no kind", () => {
    const { kind: _kind, ...legacy } = createAuthor("Ada Lovelace");
    const [ada] = fromJson(JSON.stringify({ version: 1, authors: [legacy] })).authors;
    expect(ada).toMatchObject({ kind: "person", name: "Ada Lovelace" });
  });

  it("imports through importAny", async () => {
    expect((await importAny(toJson([covid()]))).authors[0]).toMatchObject({ kind: "group", ror: ROR });
  });
});

describe("share links", () => {
  it("round-trips a group in a v3 payload", () => {
    const payload = toSharePayload({ authors: [covid()] });
    expect(JSON.parse(payload).v).toBe(3);
    expect(fromSharePayload(payload).authors[0]).toEqual(covid());
  });

  it("round-trips a contact and a member's person link", () => {
    const ada = createAuthor("Ada Lovelace", { id: "ada" });
    const group = createGroup("Group", { id: "g", members: [{ name: "Ada", personId: "ada" }], contactId: "ada" });
    expect(fromSharePayload(toSharePayload({ authors: [ada, group] })).authors[1]).toEqual(group);
  });

  it("decodes a v2 link, and refuses a bad ROR id", () => {
    const v2 = JSON.parse(toSharePayload({ authors: [createAuthor("Ada Lovelace")] }));
    v2.v = 2;
    expect(fromSharePayload(JSON.stringify(v2)).authors[0]?.name).toBe("Ada Lovelace");
    const bad = JSON.parse(toSharePayload({ authors: [covid()] }));
    bad.a[0].r = "05dxps056";
    expect(() => fromSharePayload(JSON.stringify(bad))).toThrow();
  });

  it("encodes and decodes a hash", async () => {
    const hash = await encodeShareHash({ authors: [covid()] }, "https://example.org/");
    expect((await decodeShareHash(new URL(hash).hash))?.authors).toEqual([covid()]);
  });
});

describe("JATS", () => {
  const roster = () => [covid(), createAuthor("Ada Lovelace", { contributions: [{ role: "Software", score: 100 }] })];

  it("writes a 1.3 <collab> with its members in a linked contrib-group, and reads it back", () => {
    const xml = toJats4rXml(roster());
    expect(xml).toContain('dtd-version="1.3"');
    expect(xml).toContain("<collab>The COVIDSurg Collaborative</collab>");
    expect(xml).toContain('<xref ref-type="other" rid="collab-members-1"/>');
    expect(xml).toContain('<contrib-group id="collab-members-1"');
    expect(xml).toContain('<contrib-id contrib-id-type="ror">https://ror.org/05dxps055</contrib-id>');
    expect(xml).not.toContain("collab-wrap");
    const [group, person] = fromJats4rXml(xml);
    expect(group).toMatchObject({
      kind: "group",
      name: "The COVIDSurg Collaborative",
      ror: ROR,
      membersAre: "authors",
      members: [{ name: "Ada Lovelace" }, { name: "Smith, Jones & Lee" }],
    });
    expect(group?.contributions.find((c) => c.score > 0)?.role).toBe("Investigation");
    expect(person).toMatchObject({ kind: "person", name: "Ada Lovelace" });
  });

  it("writes a 1.4 <collab-wrap>, and reads it back", () => {
    const xml = toJats4rXml(roster(), { jatsVersion: "1.4" });
    expect(xml).toContain('dtd-version="1.4"');
    expect(xml).toContain("<collab-wrap><collab-name>The COVIDSurg Collaborative</collab-name><contrib-group");
    const [group] = fromJats4rXml(xml);
    expect(group).toMatchObject({
      kind: "group",
      name: "The COVIDSurg Collaborative",
      members: [{ name: "Ada Lovelace" }, { name: "Smith, Jones & Lee" }],
    });
    expect(fromJats4rXml(xml)).toHaveLength(2);
  });

  it("marks a collaborator group, and a non-author one as a contributor", () => {
    const group = createGroup("Study Group", { members: [{ name: "Ana" }], contributorType: "non-author" });
    const xml = toJats4rXml([group]);
    expect(xml).toContain('<contrib contrib-type="contributor">');
    expect(xml).toContain('content-type="collaborators"');
    expect(fromJats4rXml(xml)[0]).toMatchObject({ membersAre: "collaborators", contributorType: "non-author" });
  });
});

describe("Crossref", () => {
  it("writes an <organization> and says its roles were dropped", () => {
    const xml = toCrossrefContributors([covid(), createAuthor("Ada Lovelace")]);
    expect(xml).toContain(
      '<organization sequence="first" contributor_role="author">The COVIDSurg Collaborative</organization>',
    );
    expect(xml).toContain("Roles of The COVIDSurg Collaborative dropped");
    expect(xml).toContain("Investigation");
    expect(fromCrossrefContributors(xml).map((a) => [a.kind, a.name])).toEqual([
      ["group", "The COVIDSurg Collaborative"],
      ["person", "Ada Lovelace"],
    ]);
  });

  it("leaves out a group credited only in the Acknowledgements, with a comment", () => {
    const xml = toCrossrefContributors([createGroup("Helpers", { contributorType: "non-author" })]);
    expect(xml).not.toContain("<organization");
    expect(xml).toContain("Left out: Helpers");
  });
});

describe("CodeMeta and RO-Crate", () => {
  it("writes an Organization with its alias and ROR id", () => {
    const { metadata, warnings } = toCodemeta([covid()]);
    expect(metadata.author[0]).toEqual({
      type: "Organization",
      id: `https://ror.org/${ROR}`,
      name: "The COVIDSurg Collaborative",
      alternateName: "COVIDSurg",
    });
    expect(warnings.join()).not.toContain("ROR");
  });

  it("falls back to a local id and says so when there is no ROR id", () => {
    const { metadata, warnings } = toCodemeta([
      createGroup("Study Group", { contributions: [{ role: "Software", score: 100 }] }),
    ]);
    expect(metadata.author[0]).toMatchObject({ type: "Organization", id: "#credit-matrix-person-1" });
    expect(warnings.join()).toContain("Study Group has no ROR id");
  });

  it("reads an Organization back as a group", async () => {
    const text = JSON.stringify(toCodemeta([covid()]).metadata);
    expect((await importAny(text)).authors[0]).toMatchObject({
      kind: "group",
      name: "The COVIDSurg Collaborative",
      alias: "COVIDSurg",
      ror: ROR,
    });
  });

  it("puts the Organization in an RO-Crate graph", () => {
    const graph = toRoCrateFragment([covid()]).metadata["@graph"];
    expect(graph.find((entry) => entry["@id"] === `https://ror.org/${ROR}`)).toMatchObject({
      "@type": "Organization",
      alternateName: "COVIDSurg",
    });
  });
});

describe("tabular formats", () => {
  it("writes the whole group name in Surname for tenzing, comma and all", () => {
    const group = createGroup("Smith, Jones & Lee Collaborative", {
      contributions: [{ role: "Software", score: 100 }],
    });
    const [header, row] = toTenzing([group]).split("\n");
    expect(header?.split(",").slice(2, 5)).toEqual(["Firstname", "Middle name", "Surname"]);
    expect(row?.startsWith('Author,1,,,"Smith, Jones & Lee Collaborative",')).toBe(true);
    expect(fromTenzing(toTenzing([group]))).toHaveLength(1);
  });

  it("round-trips a group through CSV without splitting a comma name", () => {
    const roster = [createAuthor("Ada Lovelace"), covid(), createGroup("Smith, Jones & Lee Collaborative")];
    const back = fromCsv(toCsv(roster));
    expect(back.map((a) => [a.kind, a.name])).toEqual(roster.map((a) => [a.kind, a.name]));
    expect(back[1]).toMatchObject({
      alias: "COVIDSurg",
      ror: ROR,
      members: [{ name: "Ada Lovelace" }, { name: "Smith, Jones & Lee" }],
    });
  });

  it("keeps the columns of a roster of people unchanged", () => {
    expect(toCsv([createAuthor("Ada Lovelace")]).split("\n")[0]).not.toContain("Kind");
  });
});

describe("front matter", () => {
  it("marks a group and keeps its alias", () => {
    expect(toQuarto([covid()])).toContain(
      '  - name: "The COVIDSurg Collaborative"\n    kind: group\n    alias: "COVIDSurg"\n',
    );
    expect(toMyst([covid()])).not.toContain("orcid");
  });
});
