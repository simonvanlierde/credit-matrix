// biome-ignore lint/correctness/noNodejsModules: tests run in Node; the corpus is a file on disk
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREDIT_ROLES } from "../credit-roles";
import {
  MAX_STATEMENT_LENGTH,
  namesCredit,
  parseStatement,
  readsAsStatement,
  resolveInitials,
  type StatementAuthor,
  statementAuthor,
} from "../statement";

const SLUG = new Map(CREDIT_ROLES.map((role) => [role.name, role.url.split("/").at(-2) ?? ""]));
const author = (given: string, surname: string): StatementAuthor => ({ given, surname });

/** The parse as the census tests write it: sorted [index, slug] pairs and the unresolved tokens. */
function run(text: string, authors: StatementAuthor[]) {
  const parsed = parseStatement(text, authors);
  const pairs = parsed.assignments.map(({ author: i, role }): [number, string] => [i, SLUG.get(role) ?? ""]);
  pairs.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1));
  return { pairs, unresolved: parsed.unresolved };
}

const pairsOf = (text: string, authors: StatementAuthor[]) => run(text, authors).pairs;

interface CorpusCase {
  pmcid: string;
  authors: [string, string][];
  statement: string;
  expected: [number, string][];
  expected_unresolved: string[];
}

// The census parser's own regression corpus: real CC BY statements and what the Python parser
// returned for each. The port must return exactly the same.
const CORPUS: CorpusCase[] = readFileSync("census/tests/corpus.jsonl", "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

describe("parity with the census parser", () => {
  it("covers the whole corpus", () => {
    expect(CORPUS).toHaveLength(60);
  });

  it.each(CORPUS.map((c) => [c.pmcid, c] as const))("%s", (_, c) => {
    const got = run(
      c.statement,
      c.authors.map(([given, surname]) => author(given, surname)),
    );
    expect(got).toEqual({ pairs: c.expected, unresolved: c.expected_unresolved });
  });
});

const AUTHORS = [
  author("Anna", "Peters"),
  author("Nils", "Zandvoort"),
  author("Li-Jun", "Zhao"),
  author("Qinming", "Li"),
  author("Yibo", "Lu"),
  author("Yang", "Lin"),
];
const THREE = [author("Ann", "Bell"), author("Carl", "Dunn"), author("Eva", "Fox")];

describe("parseStatement", () => {
  it("reads author-first statements with initials", () => {
    expect(pairsOf("AP: conceptualization, methodology; NZ, L.-J.Z.: writing – original draft.", AUTHORS)).toEqual([
      [0, "conceptualization"],
      [0, "methodology"],
      [1, "writing-original-draft"],
      [2, "writing-original-draft"],
    ]);
  });

  it("reads role-first statements and drops the closing approval sentence", () => {
    const text =
      "Conceptualization, A.P. and N.Z.; Methodology, A.P.; Supervision, N.Z. " +
      "All authors have read and agreed to the published version of the manuscript.";
    expect(pairsOf(text, AUTHORS)).toEqual([
      [0, "conceptualization"],
      [0, "methodology"],
      [1, "conceptualization"],
      [1, "supervision"],
    ]);
  });

  it("reads full names and 'All authors'", () => {
    const pairs = pairsOf(
      "Anna Peters: Software. Nils Zandvoort: Validation. All authors: Writing – review & editing.",
      AUTHORS,
    );
    expect(pairs.filter(([i]) => i === 0)).toEqual([
      [0, "software"],
      [0, "writing-review-editing"],
    ]);
    expect(pairs.filter(([i]) => i === 5)).toEqual([[5, "writing-review-editing"]]);
  });

  it("reports ambiguous initials instead of guessing", () => {
    expect(run("YL: software; AP: validation.", AUTHORS)).toEqual({ pairs: [[0, "validation"]], unresolved: ["YL"] });
  });

  it("yields nothing for prose", () => {
    expect(pairsOf("A.P. conceived the study and N.Z. wrote the paper.", AUTHORS)).toEqual([]);
  });

  it("counts 'All authors contributed to' as an assignment", () => {
    const text =
      "All authors contributed to the investigation and conceptualization. All authors read and approved the manuscript.";
    expect(pairsOf(text, AUTHORS.slice(0, 2))).toEqual([
      [0, "conceptualization"],
      [0, "investigation"],
      [1, "conceptualization"],
      [1, "investigation"],
    ]);
  });

  it.each([
    [
      "AB: conceptualization. CD: drew the figures. EF: software.",
      [
        [0, "conceptualization"],
        [2, "software"],
      ],
    ],
    [
      "Conceptualization, A.B. Methodology, C.D. and E.F.",
      [
        [0, "conceptualization"],
        [1, "methodology"],
        [2, "methodology"],
      ],
    ],
    [
      "A.B.: conceptualization; methodology. C.D.: software.",
      [
        [0, "conceptualization"],
        [0, "methodology"],
        [1, "software"],
      ],
    ],
    ["Supervision: EF. AB is the guarantor.", [[2, "supervision"]]],
    [
      "A.B.: software; Dunn, C: writing - review and editing",
      [
        [0, "software"],
        [1, "writing-review-editing"],
      ],
    ],
    [
      "Software: Bell, Ann, Fox, E.",
      [
        [0, "software"],
        [2, "software"],
      ],
    ],
    ["A.B.: software; Dunne, C: writing - review and editing", [[0, "software"]]],
    ["Software, A.B. All authors read and approved the manuscript.", [[0, "software"]]],
    ["A.B.: software. All authors have read and approved the final manuscript.", [[0, "software"]]],
  ])("splits clauses in %j", (text, expected) => {
    expect(pairsOf(text, THREE)).toEqual(expected);
  });

  it("reads Vancouver style, non-ASCII initials, particles and initials before a surname", () => {
    expect(
      pairsOf("Conceptualization: Nam KC. Data curation: Yim DG.", [
        author("Ki Chang", "Nam"),
        author("Dong Gyun", "Yim"),
      ]),
    ).toEqual([
      [0, "conceptualization"],
      [1, "data-curation"],
    ]);
    expect(pairsOf("Software: H.Š. and F.H.", [author("Hana", "Šigutová"), author("Filip", "Harabiš")])).toEqual([
      [0, "software"],
      [1, "software"],
    ]);
    const particles = [author("Fernanda", "da Silva Nunes"), author("João Antonio", "dos Santos-Silva")];
    expect(pairsOf("Methodology, F.d.S.N. and J.A.d.S.-S.", particles)).toEqual([
      [0, "methodology"],
      [1, "methodology"],
    ]);
    const before = [author("Brendan James", "Houston"), author("Duc", "Merriner")];
    expect(pairsOf("BJ Houston: data curation. D. Merriner: software.", before)).toEqual([
      [0, "data-curation"],
      [1, "software"],
    ]);
  });

  it("does not read a first name inside hyphenated initials", () => {
    expect(
      pairsOf("X.-M. Li: software; M. Li: validation.", [author("Xiao-Ming", "Li"), author("Ming", "Li")]),
    ).toEqual([
      [0, "software"],
      [1, "validation"],
    ]);
    expect(pairsOf("X.M. Li: software; M. Li: validation.", [author("Xiao Ming", "Li"), author("Ming", "Li")])).toEqual(
      [
        [0, "software"],
        [1, "validation"],
      ],
    );
  });

  it.each([
    [[author("Hong", "Wang"), author("Wei", "Zhang"), author("Hao", "Wang")], "H Wang: software", ["H Wang"]],
    [[author("Li", "Wang"), author("Wang", "Li")], "Li Wang: software. Wang Li: validation.", ["Li Wang", "Wang Li"]],
  ])("leaves a name two authors share unresolved", (authors, text, unresolved) => {
    expect(run(text, authors)).toEqual({ pairs: [], unresolved });
  });

  it("does not split a list of names on 'Surname, Given'", () => {
    const authors = [author("Ajaya", "Sharma"), author("Monica", "Sharma")];
    expect(pairsOf("Data curation: Ajaya Sharma, Monica Sharma.", authors)).toEqual([
      [0, "data-curation"],
      [1, "data-curation"],
    ]);
  });

  it("reads hyphenated given names", () => {
    const authors = [author("Jun-Ho", "Kim"), author("Wei-Jie", "Zhang")];
    expect(pairsOf("J.-H. Kim: software. Zhang W.-J.: validation.", authors)).toEqual([
      [0, "software"],
      [1, "validation"],
    ]);
    expect(pairsOf("Software: Kim J-H and W.-J. Zhang.", authors)).toEqual([
      [0, "software"],
      [1, "software"],
    ]);
  });

  it("matches full names in any case", () => {
    const authors = [author("Isik", "Demir"), author("Bo", "Wu")];
    expect(pairsOf("ISIK DEMIR: methodology. bo wu: software.", authors)).toEqual([
      [0, "methodology"],
      [1, "software"],
    ]);
  });

  it("matches a decomposed accent to a composed one", () => {
    expect(pairsOf("Software: H.Š.", [author("Hana", "Šigutová")])).toEqual([[0, "software"]]);
  });

  it("reads every role wording", () => {
    const wordings = [
      "Conceptualisation",
      "Data curation",
      "formal analyses",
      "Funding acquisition",
      "Investigation",
      "Methodology",
      "Project administration",
      "Resources",
      "Software",
      "Supervision",
      "Validation",
      "visualisation",
      "Writing—original draft preparation",
      "Writing − review & editing",
    ];
    const pairs = pairsOf(`AB: ${wordings.join(", ")}.`, THREE);
    expect(pairs.map(([, slug]) => slug).sort()).toEqual([...SLUG.values()].sort());
  });
});

describe("resolveInitials", () => {
  it.each([
    ["AP", 0],
    ["L.J.Z.", 2],
    ["Q.M.L.", 3],
    ["YiL", 4],
    ["YL", null],
    ["XX", null],
    ["", null],
  ])("resolves %s", (token, expected) => {
    expect(resolveInitials(token, AUTHORS)).toBe(expected);
  });

  it("prefers given name first", () => {
    expect(resolveInitials("L.H.", [author("Hao", "Leng"), author("Liang", "Hong")])).toBe(1);
  });

  it.each([
    ["JvdB", author("Jan", "van der Berg")],
    ["AdS", author("Ana", "da Silva")],
    ["CL", author("Chiara", "De Luca")],
    ["JG", author("José", "García López")],
    ["ZL", author("Li", "Zhao")],
    ["L.Z.", author("Li-Jun", "Zhao")],
  ])("resolves %s through its tier", (token, who) => {
    expect(resolveInitials(token, [author("Ann", "Bell"), who])).toBe(1);
  });

  it("lets a stricter tier win over particles", () => {
    expect(resolveInitials("CL", [author("Chiara", "De Luca"), author("Carlo", "Lanza")])).toBe(1);
  });
});

describe("namesCredit", () => {
  it.each([
    ["Conceptualization", true],
    ["Data curation", true],
    ["Writing – original draft", true],
    ["review & editing", true],
    ["Software", false],
    ["Supervision", false],
    ["under the supervision of B.J.", false],
    ["Anne Namer, Bob Smith", false],
  ])("%s → %s", (text, expected) => {
    expect(namesCredit(text)).toBe(expected);
  });
});

describe("edge cases", () => {
  it("keeps positions when lower case changes a letter's length", () => {
    // "İ" lowers to two code units; the name after it must still be found.
    expect(pairsOf("İŞ: software. Ann Bell: data curation.", THREE)).toEqual([[0, "data-curation"]]);
  });

  it("reads a contributor with one name only, and skips a name inside a longer word", () => {
    const authors = [author("", "Madonna"), author("Ann", "Bell")];
    expect(pairsOf("Madonna: data curation. Bellamy: software. Ann Bell: methodology.", authors)).toEqual([
      [0, "data-curation"],
      [1, "methodology"],
    ]);
  });
});

describe("unmatched", () => {
  it("names each unresolved token once, with its candidates and the roles left out", () => {
    const authors = [author("Mark", "Green"), author("Maria", "Garcia"), author("Eva", "Mills")];
    const { unmatched } = parseStatement(
      "MG: writing - original draft, conceptualization. EM: software. YL: funding acquisition. MG: data curation.",
      authors,
    );
    expect(unmatched).toEqual([
      { token: "MG", candidates: [0, 1], roles: ["Conceptualization", "Data curation", "Writing – original draft"] },
      { token: "YL", candidates: [], roles: ["Funding acquisition"] },
    ]);
  });

  it("reports a full name two authors share, with the roles it was given", () => {
    const { assignments, unmatched } = parseStatement("Ann Lee: Software.", [
      author("Ann", "Lee"),
      author("Ann", "Lee"),
    ]);
    expect(assignments).toEqual([]);
    expect(unmatched).toEqual([{ token: "Ann Lee", candidates: [0, 1], roles: ["Software"] }]);
  });

  it("matches a one-word name in its own case only", () => {
    const wu = [author("", "Wu")];
    expect(pairsOf("Wu: Software.", wu)).toEqual([[0, "software"]]);
    expect(pairsOf("WU: Software.", wu)).toEqual([]);
  });

  it("gives the roles of a role-first clause to the token it names", () => {
    const { unmatched } = parseStatement("Methodology, XY and A.B.", [author("Ann", "Bell")]);
    expect(unmatched).toEqual([{ token: "XY", candidates: [], roles: ["Methodology"] }]);
  });
});

describe("assignment order", () => {
  it("lists assignments by author, then in CRediT order, whatever order the text gives", () => {
    const text = "Eva Fox: software, conceptualization. Ann Bell: writing – original draft, methodology.";
    expect(parseStatement(text, THREE).assignments).toEqual([
      { author: 0, role: "Methodology" },
      { author: 0, role: "Writing – original draft" },
      { author: 2, role: "Conceptualization" },
      { author: 2, role: "Software" },
    ]);
  });
});

describe("size", () => {
  it(`refuses a statement longer than ${MAX_STATEMENT_LENGTH} characters`, () => {
    expect(() => parseStatement("a".repeat(MAX_STATEMENT_LENGTH + 1), THREE)).toThrow(
      new RangeError(
        `A statement is read up to ${MAX_STATEMENT_LENGTH} characters; this one has ${MAX_STATEMENT_LENGTH + 1}.`,
      ),
    );
    expect(() => parseStatement("a".repeat(MAX_STATEMENT_LENGTH), THREE)).not.toThrow();
  });

  it.each([
    ["spaces", (n: number) => `AB: conceptualization.${" ".repeat(n)}x`],
    ["line breaks", (n: number) => `AB: conceptualization.${"\n".repeat(n)}x`],
    ["unknown initials", (n: number) => `${"XY, ".repeat(n / 4)}: conceptualization`],
    ["names and roles", (n: number) => "Ann Bell: conceptualization; ".repeat(n / 29)],
  ])("reads %s up to the cap in well under a second", (_, make) => {
    const text = make(MAX_STATEMENT_LENGTH - 100);
    const start = performance.now();
    namesCredit(text);
    parseStatement(text, THREE);
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe("resolveInitials with particles and double surnames", () => {
  it("reads initials over a surname without its particles, when it has two words left", () => {
    expect(resolveInitials("CLR", [author("Chiara", "De Luca Rossi")])).toBe(0);
  });

  it("reads initials inside a one-word given name only in their order", () => {
    const qinming = [author("Qinming", "Li")];
    expect(resolveInitials("Q.M.L.", qinming)).toBe(0);
    expect(resolveInitials("Q.X.L.", qinming)).toBeNull();
    expect(resolveInitials("Q.M.M.L.", qinming)).toBeNull();
  });

  it("leaves out a capitalised particle when reading initials", () => {
    for (const surname of ["Del Rio", "Ten Berge", "Van Dijk"]) {
      const initials = `J${surname.split(" ")[1]?.[0]}`;
      expect(resolveInitials(initials, [author("Juan", surname)])).toBe(0);
    }
  });

  it("reads initials over the first of two surnames, after one or more given names", () => {
    const maria = [author("María José", "García López")];
    expect(resolveInitials("MG", maria)).toBe(0);
    expect(resolveInitials("MJG", maria)).toBe(0);
  });
});

describe("approval wording", () => {
  it("drops the closing approval sentence whole, roles named in it included", () => {
    const authors = [author("Ann", "Lee")];
    expect(
      pairsOf("Ann Lee: Conceptualization. All authors read and approved the manuscript and its methodology.", authors),
    ).toEqual([[0, "conceptualization"]]);
  });
});

describe("name boundaries", () => {
  it("does not find a name inside a longer word", () => {
    const authors = [author("Ann", "Li")];
    expect(pairsOf("Joann Li: Software.", authors)).toEqual([]);
    expect(pairsOf("Ann Lim: Software.", authors)).toEqual([]);
    expect(pairsOf("Ann Li: Software.", authors)).toEqual([[0, "software"]]);
    // The end of the text bounds a name too.
    expect(pairsOf("Software: Ann Li", authors)).toEqual([[0, "software"]]);
  });

  it("does not find initials and a surname after another initial", () => {
    expect(pairsOf("X.M. Li: Software.", [author("Ming", "Li")])).toEqual([]);
    expect(pairsOf("M. Li: Software.", [author("Ming", "Li")])).toEqual([[0, "software"]]);
  });
});

describe("name matching order", () => {
  it("reads a comma between two full names as a list, not as an inverted third name", () => {
    const authors = [author("Bo", "Lee"), author("Ann", "Lee"), author("Bo", "Wu")];
    expect(pairsOf("Ann Lee, Bo Wu: Software. Bo Lee: Validation.", authors)).toEqual([
      [0, "validation"],
      [1, "software"],
      [2, "software"],
    ]);
  });

  it("matches the longer of two names that start alike", () => {
    const authors = [author("Ann", "Lee"), author("Ann", "Lee-Wu")];
    expect(pairsOf("Ann Lee-Wu: Software; Ann Lee: Validation.", authors)).toEqual([
      [0, "validation"],
      [1, "software"],
    ]);
  });
});

describe("statementAuthor", () => {
  it.each([
    [
      { name: "Jane Anne Marie Smith", firstName: "Jane", middleName: "Anne", surname: "Smith" },
      "Jane Anne Marie",
      "Smith",
    ],
    [{ name: "Smith, Jane A.", firstName: "Jane", middleName: "A", surname: "Smith" }, "Jane A.", "Smith"],
    [{ name: "Madonna", firstName: "Madonna", middleName: "", surname: "" }, "Madonna", ""],
    [{ name: "Jane Smith", firstName: "Jane", middleName: "", surname: "Smith" }, "Jane", "Smith"],
    // A name edited since it was parsed no longer holds the surname: the stored parts stand in.
    [{ name: "J. Doe", firstName: "Jane", middleName: "Ann", surname: "Smith" }, "Jane Ann", "Smith"],
    // Family name first, as Hungarian writes it: nothing comes before the surname.
    [{ name: "Kovács János", firstName: "János", middleName: "", surname: "Kovács" }, "János", "Kovács"],
    // A comma that does not follow the surname is not the inverted form.
    [{ name: "Jane, Smith", firstName: "Jane", middleName: "", surname: "Smith" }, "Jane,", "Smith"],
  ])("splits %j", (input, given, surname) => {
    expect(statementAuthor(input)).toEqual({ given, surname });
  });
});

describe("readsAsStatement", () => {
  it.each([
    // Two sentences with four plain words between them read as prose.
    ["Jane did all. Bob wrote code.", true],
    ["Conceptualization - JP", true],
    ["J.-P. Martin; conceptualization", false],
    ["JP - conceptualization", true],
    ["Conceptualization, Jo Lee", false],
    // Many plain words, but no sentence and no distinctive role.
    ["Jane Smith is the one who did it", false],
    // Name particles and "and" are not prose words.
    ["Ann van der Berg and Bob de la Cruz, conceptualization", false],
    ["Ann Lee and Bob Kim and Cy Moe and Di Wu, conceptualization", false],
    // Each distinctive role is enough with initials beside it.
    ["Formal analysis - JP", true],
    ["Funding acquisition - JP", true],
    ["Project administration - JP", true],
    ["Visualization - JP", true],
    // Three plain words beside a distinctive role read as a statement.
    ["Jane did all the conceptualization", true],
    // Initials beside any one role are enough.
    ["Visualization, conceptualization AB", true],
    // "Author" with a verb is prose about who did what, singular or plural, with words between.
    ["The first author wrote the software.", true],
    ["The authors jointly wrote and revised the text.", true],
  ])("reads %j as a statement: %s", (text, expected) => {
    expect(readsAsStatement(text)).toBe(expected);
  });
});
