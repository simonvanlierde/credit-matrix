// biome-ignore lint/correctness/noNodejsModules: tests run in Node; the corpus is a file on disk
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_AUTHORS } from "../author";
import { CREDIT_ROLES, creditSlug } from "../credit-roles";
import { generateStatement } from "../generate-statement";
import { createAuthor } from "../parse-authors";
import {
  MAX_STATEMENT_LENGTH,
  namesCredit,
  parseStatement,
  readsAsStatement,
  resolveInitials,
  type StatementAuthor,
  statementAuthor,
} from "../statement";
import { BY_AUTHOR, BY_ROLE } from "./statement-fixtures";

const SLUG = new Map(CREDIT_ROLES.map((role) => [role.name, creditSlug(role.url)]));
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
// CI's changes job runs this on a census-only PR that touches the corpus or the parser.
const CORPUS: CorpusCase[] = readFileSync("census/tests/corpus.jsonl", "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

describe("parity with the census parser", () => {
  it("covers the whole corpus", () => {
    expect(CORPUS).toHaveLength(67);
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
const THREE = [
  statementAuthor(createAuthor("Ada Lovelace")),
  statementAuthor(createAuthor("Charles Darwin")),
  author("Eva", "Fox"),
];

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
      "A.L. wrote the original draft. C.D. and E.F. reviewed and edited the manuscript.",
      [
        [0, "writing-original-draft"],
        [1, "writing-review-editing"],
        [2, "writing-review-editing"],
      ],
    ],
    [
      "The original draft was written by A.L. and reviewed and edited by C.D.",
      [
        [0, "writing-original-draft"],
        [1, "writing-review-editing"],
      ],
    ],
    [
      "AL: conceptualization. CD: drew the figures. EF: software.",
      [
        [0, "conceptualization"],
        [2, "software"],
      ],
    ],
    [
      "Conceptualization, A.L. Methodology, C.D. and E.F.",
      [
        [0, "conceptualization"],
        [1, "methodology"],
        [2, "methodology"],
      ],
    ],
    [
      "A.L.: conceptualization; methodology. C.D.: software.",
      [
        [0, "conceptualization"],
        [0, "methodology"],
        [1, "software"],
      ],
    ],
    ["Supervision: EF. AL is the guarantor.", [[2, "supervision"]]],
    [
      "A.L.: software; Darwin, C: writing - review and editing",
      [
        [0, "software"],
        [1, "writing-review-editing"],
      ],
    ],
    [
      "Software: Lovelace, Ada, Fox, E.",
      [
        [0, "software"],
        [2, "software"],
      ],
    ],
    ["A.L.: software; Darwine, C: writing - review and editing", [[0, "software"]]],
    ["A.L.: software; Darwine: C: writing - review and editing", [[0, "software"]]],
    ["A.L.: software; Darwine, C:  \n writing - review and editing", [[0, "software"]]],
    [
      "A.L.: software; darwine c: writing - review and editing",
      [
        [0, "software"],
        [0, "writing-review-editing"],
      ],
    ],
    [
      "A.L.: software; Darwine, C: x: writing - review and editing",
      [
        [0, "software"],
        [0, "writing-review-editing"],
      ],
    ],
    ["Software, A.L. All authors read and approved the manuscript.", [[0, "software"]]],
    ["A.L.: software. All authors have read and approved the final manuscript.", [[0, "software"]]],
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
    const pairs = pairsOf(`AL: ${wordings.join(", ")}.`, THREE);
    expect(pairs.map(([, slug]) => slug).sort()).toEqual([...SLUG.values()].sort());
  });
});

describe("clause ends and initials", () => {
  it("reads two dashes in a row as one", () => {
    expect(pairsOf("L. -- J. Z.: conceptualization", AUTHORS)).toEqual([[2, "conceptualization"]]);
  });

  it("skips a token that starts with a lower-case letter", () => {
    expect(pairsOf("éB: conceptualization", [author("Émile", "Bernard")])).toEqual([]);
  });

  it("ends a clause at a full stop after a closing bracket", () => {
    expect(pairsOf("Conceptualization (lead). AP: Software.", AUTHORS)).toEqual([[0, "software"]]);
    expect(pairsOf("Conceptualization [lead]. AP: Software.", AUTHORS)).toEqual([[0, "software"]]);
  });

  it("ends a clause after all authors, whatever the case", () => {
    expect(pairsOf("Methodology, ALL AUTHORS. Software", THREE)).toEqual([
      [0, "methodology"],
      [0, "software"],
      [1, "methodology"],
      [1, "software"],
      [2, "methodology"],
      [2, "software"],
    ]);
  });

  it("ends a clause after initials when a comma comes before the next role", () => {
    expect(pairsOf("Methodology, A.L., Software", THREE)).toEqual([
      [0, "methodology"],
      [0, "software"],
    ]);
  });

  it("joins two authors only with a comma or the word and", () => {
    expect(pairsOf("Methodology, EF. Standard AL: software", THREE)).toEqual([
      [0, "software"],
      [2, "methodology"],
    ]);
  });
});

// The census tests' three authors, so these cases read the same as theirs.
const BELL = [author("Ann", "Bell"), author("Carl", "Dunn"), author("Eva", "Fox")];
const holdersOf = (text: string, slug: string) =>
  pairsOf(text, BELL)
    .filter(([, s]) => s === slug)
    .map(([i]) => i);

describe("all other authors", () => {
  it("heading a list item, leaves out everyone named before it", () => {
    expect(pairsOf("A.B.: software. All other authors: validation.", BELL)).toEqual([
      [0, "software"],
      [1, "validation"],
      [2, "validation"],
    ]);
    expect(holdersOf("A.B.: software. C.D.: methodology. All other authors: validation.", "validation")).toEqual([2]);
  });

  it("after roles, leaves out the run of authors given roles just before it", () => {
    const text = "Software: A.B., C.D.; methodology: A.B.; validation: all other authors.";
    expect(pairsOf(text, BELL)).toEqual([
      [0, "methodology"],
      [0, "software"],
      [1, "software"],
      [1, "validation"],
      [2, "validation"],
    ]);
  });

  it("leaves the same authors out of a clause of roles alone after it", () => {
    expect(holdersOf("A.B.: software. All other authors: validation; visualization.", "visualization")).toEqual([1, 2]);
    const text = "A.B., C.D.: software; all other authors: validation; visualization.";
    expect(holdersOf(text, "visualization")).toEqual([2]);
  });

  it("after another all other authors, leaves out the same authors", () => {
    const text = "Software: A.B.; validation: all other authors; writing - original draft: all other authors.";
    expect(holdersOf(text, "writing-original-draft")).toEqual([1, 2]);
    expect(holdersOf("A.B.: software. All other authors: validation. Formal analysis.", "formal-analysis")).toEqual([
      1, 2,
    ]);
  });

  it("heading a list item, also leaves out authors named before it without roles", () => {
    expect(pairsOf("A.B. and C.D. conceived the study. All other authors: validation.", BELL)).toEqual([
      [2, "validation"],
    ]);
  });

  it("after all authors, leaves out everyone", () => {
    expect(holdersOf("All authors: software. All other authors: validation.", "validation")).toEqual([]);
  });

  it("beside named authors, leaves out no one", () => {
    expect(holdersOf("E.F.: software; A.B. and all the other authors: validation.", "validation")).toEqual([0, 1, 2]);
  });

  it("keeps authors named without roles", () => {
    const text = "A.B. was the PI and all other authors wrote the original draft.";
    expect(new Set(pairsOf(text, BELL).map(([i]) => i))).toEqual(new Set([0, 1, 2]));
  });

  it("leaves plain all authors as everyone", () => {
    expect(pairsOf("A.B.: software. All authors: validation.", BELL)).toEqual([
      [0, "software"],
      [0, "validation"],
      [1, "validation"],
      [2, "validation"],
    ]);
  });
});

describe("all other authors after a semicolon", () => {
  it("reads a semicolon between names as part of the list, so the author before it is not left out", () => {
    expect(pairsOf("Dunn, C.; All other authors: visualization.", BELL)).toEqual([
      [0, "visualization"],
      [1, "visualization"],
      [2, "visualization"],
    ]);
    expect(holdersOf("A.B.: software; C.D.; all other authors: visualization.", "visualization")).toEqual([0, 1, 2]);
  });

  it.each([
    "A.B.: software. The remaining authors: validation.",
    "A.B.: software. All remaining authors: validation.",
    "Software: A.B.; validation: all the remaining authors.",
    "A.B.: software. Remaining authors: validation.",
  ])("reads the remaining authors as all other authors: %s", (text) => {
    expect(pairsOf(text, BELL)).toEqual([
      [0, "software"],
      [1, "validation"],
      [2, "validation"],
    ]);
  });

  it("does not read the other authors, which is mostly prose", () => {
    expect(pairsOf("Formal analysis: A.B., with feedback from the other authors.", BELL)).toEqual([
      [0, "formal-analysis"],
    ]);
  });

  it("reads the remaining authors only where it opens or heads a clause", () => {
    expect(pairsOf("Formal analysis: A.B., with input from the remaining authors.", BELL)).toEqual([
      [0, "formal-analysis"],
    ]);
  });

  it.each([
    "A.B.: software. The remaining authors, C.D., contributed to review and editing.",
    "A.B.: software. Remaining authors (C.D.) contributed to review and editing.",
    "A.B.: software; all other authors (C.D.): review and editing.",
  ])("reads names right after all other authors as who it means: %s", (text) => {
    expect(pairsOf(text, BELL)).toEqual([
      [0, "software"],
      [1, "writing-review-editing"],
    ]);
  });

  it.each([
    // Only names that resolve to an author say who it means: not an acronym, a degree or a group.
    ["A.B.: software. All other authors (UCL): validation.", [1, 2]],
    ["A.B.: software. All other authors, MD, PhD: validation.", [1, 2]],
    ["A.B.: software. All other authors, PhD students, contributed to validation.", [1, 2]],
    // The first mention decides: unresolved, so it is beside named authors and means everyone.
    ["A.B.: software. All other authors (XY and C.D.): validation.", [0, 1, 2]],
    ["A.B.: software. All other authors, all authors: validation.", [0, 1, 2]],
    // An exception, not a list of who it means.
    ["All other authors, A.B. excepted, did validation.", [0, 1, 2]],
    ["Software: A.B.; validation: all other authors, C.D. excluded.", [0, 1, 2]],
    // Names after the comma are who it means, also after other names and into a list item.
    ["A.B. and all other authors, C.D.: validation.", [0, 1]],
    ["A.B.: software; all other authors, C.D.: validation; E.F.: visualization.", [1]],
  ])("before other mentions: %s", (text, expected) => {
    expect(holdersOf(text, "validation")).toEqual(expected);
  });

  it.each([
    "A.B.: software. All other authors (i.e. C.D.): validation.",
    "A.B.: software. All other authors (authors 2-2: C.D.): validation.",
    "A.B.: software. All other authors, i.e. C.D., contributed to validation.",
  ])("reads a word before the names as who it means: %s", (text) => {
    expect(holdersOf(text, "validation")).toEqual([1]);
  });

  it.each([
    // Lower-case words between the initials and the role: the same clause.
    [
      "A.B.: software. E.F. contributed to the writing of the original draft.",
      [
        [0, "software"],
        [2, "writing-original-draft"],
      ],
    ],
    // A role right after, or a capital after the dot: a new clause. All other authors do not share the role.
    [
      "A.B. Methodology. E.F. Software.",
      [
        [0, "methodology"],
        [2, "software"],
      ],
    ],
    ["A.B. wrote the original draft and all other authors reviewed it.", [[0, "writing-original-draft"]]],
  ])("keeps initials, lower-case words and a role in one clause: %s", (text, expected) => {
    expect(pairsOf(text, BELL)).toEqual(expected);
  });

  it.each([
    [
      "A.B. did the formal analysis under supervision of C.D.",
      [
        [0, "formal-analysis"],
        [1, "supervision"],
      ],
    ],
    [
      "A.B. did the formal analysis under the direct supervision of C.D. and E.F.",
      [
        [0, "formal-analysis"],
        [1, "supervision"],
        [2, "supervision"],
      ],
    ],
    // The supervisor does not take the next clause's roles, and the subject keeps them.
    [
      "A.B. did the formal analysis under the supervision of C.D., and wrote the original draft.",
      [
        [0, "formal-analysis"],
        [0, "writing-original-draft"],
        [1, "supervision"],
      ],
    ],
    // A name that is no author: no one supervised, and the subject did not.
    ["A.B. did the formal analysis under the supervision of Prof. Zed.", [[0, "formal-analysis"]]],
    // The names end at the sentence: EF is not a supervisor.
    [
      "AB did the formal analysis under the supervision of CD. EF was involved in funding acquisition.",
      [
        [0, "formal-analysis"],
        [1, "supervision"],
        [2, "funding-acquisition"],
      ],
    ],
    // "supervision" with no "under ... of" before it is a role of the subject.
    ["A.B.: supervision.", [[0, "supervision"]]],
  ])("gives the supervision role to the supervisor: %s", (text, expected) => {
    expect(pairsOf(text, BELL)).toEqual(expected);
  });

  it.each([
    [
      "The experiments were supervised by A.B. and C.D.",
      [
        [0, "supervision"],
        [1, "supervision"],
      ],
    ],
    // The subject keeps its own roles and does not get the supervision.
    [
      "E.F. did the formal analysis, supervised by A.B.",
      [
        [0, "supervision"],
        [2, "formal-analysis"],
      ],
    ],
    [
      "E.F. did the formal analysis, supervised by A.B., and wrote the original draft.",
      [
        [0, "supervision"],
        [2, "formal-analysis"],
        [2, "writing-original-draft"],
      ],
    ],
    // A name that is no author: no one supervised, and the subject did not.
    ["E.F. did the formal analysis, supervised by Prof. Zed.", [[2, "formal-analysis"]]],
    // The names end at the sentence: EF is not a supervisor.
    [
      "AB did the formal analysis, supervised by CD. EF was involved in funding acquisition.",
      [
        [0, "formal-analysis"],
        [1, "supervision"],
        [2, "funding-acquisition"],
      ],
    ],
    // The active verb is not read here.
    ["A.B. supervised the project.", []],
  ])("gives the supervision role to who supervised: %s", (text, expected) => {
    expect(pairsOf(text, BELL)).toEqual(expected);
  });

  it.each([
    [
      "A.B.: software. All of the authors contributed to validation.",
      [
        [0, "software"],
        [0, "validation"],
        [1, "validation"],
        [2, "validation"],
      ],
    ],
    [
      "A.B.: software. All of the other authors contributed to validation.",
      [
        [0, "software"],
        [1, "validation"],
        [2, "validation"],
      ],
    ],
    // Approval wording is still dropped.
    ["A.B.: software. All of the authors read and approved the manuscript.", [[0, "software"]]],
  ])("reads all of the authors as all authors: %s", (text, expected) => {
    expect(pairsOf(text, BELL)).toEqual(expected);
  });

  it.each([
    [
      "The work was done under the supervision of A.B. and C.D. E.F. wrote the original draft.",
      [
        [0, "supervision"],
        [1, "supervision"],
        [2, "writing-original-draft"],
      ],
    ],
    [
      "A.B. did the formal analysis under the supervision of C.D. E.F. wrote the original draft.",
      [
        [0, "formal-analysis"],
        [1, "supervision"],
        [2, "writing-original-draft"],
      ],
    ],
    // A list missing its comma stays one clause.
    [
      "Software, A.B. C.D.; validation, E.F.",
      [
        [0, "software"],
        [1, "software"],
        [2, "validation"],
      ],
    ],
    // A verb after the second part starts a sentence: C.D. is not in the list before it.
    [
      "Project administration, A.B. C.D. wrote the original draft.",
      [
        [0, "project-administration"],
        [1, "writing-original-draft"],
      ],
    ],
    // Every part must be a different author: "C.D. Z.Z." stays one unresolved token.
    ["C.D. Z.Z. wrote the original draft.", []],
    ["C.D. C.D. wrote the original draft.", []],
  ])("splits adjacent initials that are no author together: %s", (text, expected) => {
    expect(pairsOf(text, BELL)).toEqual(expected);
  });

  it("does not read ambiguous initials after it as who it means", () => {
    const text = "C.D.: software. All other authors (A.B.): validation.";
    const holders = run(text, [...BELL, author("Amy", "Bloom")]).pairs.filter(([, s]) => s === "validation");
    expect(holders.map(([i]) => i)).toEqual([0, 2, 3]);
  });

  it("still reads all other authors including named authors as everyone", () => {
    const text = "A.B.: software. All other authors, including C.D., contributed to validation.";
    expect(holdersOf(text, "validation")).toEqual([0, 1, 2]);
  });

  it("does not read the remaining authors approving the manuscript as an assignment", () => {
    const text =
      "A.B.: software. C.D.: validation. The remaining authors have read and approved the manuscript, " +
      "including its original draft.";
    expect(pairsOf(text, BELL)).toEqual([
      [0, "software"],
      [1, "validation"],
    ]);
  });
});

describe("clauses that run across a semicolon or a full stop", () => {
  const split = (...names: string[]) =>
    names.map((n) => author(n.slice(0, n.lastIndexOf(" ")), n.slice(n.lastIndexOf(" ") + 1)));

  it("reads a semicolon inside a list of authors as part of the list", () => {
    const authors = [
      author("Tomás Andrés", "Ruiz-López"),
      author("Carlos", "Ortiz-Pérez"),
      author("José María", "García-Ruiz"),
    ];
    expect(pairsOf("T.A.R.-L., C.O.-P.; J.M.G.-R.: software. T.A.R.-L.: validation.", authors)).toEqual([
      [0, "software"],
      [0, "validation"],
      [1, "software"],
      [2, "software"],
    ]);
    // A clause that names a role keeps its semicolon.
    expect(pairsOf("Validation: T.A.R.-L.; C.O.-P.: software.", authors)).toEqual([
      [0, "validation"],
      [1, "software"],
    ]);
    // So does a sentence: its authors do not take the next clause's roles.
    const text = "S.A.D. and M.R. conceptualized the project; M.R. prepared the original draft.";
    expect(pairsOf(text, split("Moritz Reese", "Sameer A. Dhayat"))).toEqual([[0, "writing-original-draft"]]);
  });

  it("closes a role-first clause with the initials after its full stop", () => {
    expect(pairsOf("Software, A.B.; visualization. C.D.; supervision. C.D.;", BELL)).toEqual([
      [0, "software"],
      [1, "supervision"],
      [1, "visualization"],
    ]);
  });

  it("does not close a clause of roles with a full name, unresolved initials or an author-first statement", () => {
    const text =
      "Emmanuel Luciano, MD; conceptualization. Sarah Macek; methodology. Felipe Pacheco, MD; final review and editing.";
    const parsed = pairsOf(text, split("Emmanuel Luciano", "Sarah Macek", "Felipe Pacheco"));
    expect(parsed.filter(([i]) => i === 2)).toEqual([[2, "writing-review-editing"]]);
    const authorFirst = "DP; wrote the original draft. PP; reviewed and edited the manuscript.";
    expect(pairsOf(authorFirst, split("Duc-Vinh Pham", "Pil-Hoon Park"))).toEqual([
      [0, "writing-original-draft"],
      [1, "writing-review-editing"],
    ]);
  });

  it("does not close a clause of roles with initials in a sentence", () => {
    const text = "Funding acquisition, writing - original draft. Funding was acquired by H.-J.L.";
    expect(pairsOf(text, split("Seon-Joo Park", "Hae-Jeung Lee"))).toEqual([]);
  });
});

describe("resolveInitials", () => {
  it("matches initials without diacritics, but as written first", () => {
    const authors = [author("Ngọc Ánh", "Nguyễn"), author("Văn Đức", "Trần"), author("Nam", "Nguyen")];
    expect(pairsOf("N.N.A.: software; TVD: validation; NN: investigation.", authors)).toEqual([
      [0, "software"],
      [1, "validation"],
      [2, "investigation"],
    ]);
    expect(resolveInitials("D.D.", [author("Đức", "Đặng")])).toBe(0);
    expect(resolveInitials("A.A.-A.", [author("Ana", "Hernández-Martín"), author("Ángel", "Arias-Arias")])).toBe(1);
    // Folded, "ŞY" would fit the second author as well.
    expect(resolveInitials("ŞY", [author("Şilan", "Yavuz"), author("Sema", "Yılmaz")])).toBe(0);
    // U+0941, a Devanagari vowel sign, is a nonspacing mark of combining class 0: the census drops it too.
    expect(resolveInitials("सम", [author("", "सुमन")])).toBe(0);
  });

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
    expect(resolveInitials(token, [statementAuthor(createAuthor("Ada Lovelace")), who])).toBe(1);
  });

  it("lets a stricter tier win over particles", () => {
    expect(resolveInitials("CL", [author("Chiara", "De Luca"), author("Carlo", "Lanza")])).toBe(1);
  });

  it("drops lower-case particles between dots from the initials", () => {
    expect(resolveInitials("F.d.S.N.", [author("Fernanda", "De Silva Nunes")])).toBe(0);
  });

  it("keeps a lower-case letter that follows a dot but no dot follows", () => {
    expect(resolveInitials("A.b", [author("Anna", "")])).toBeNull();
  });

  it("ignores separators at the edges of a name", () => {
    const peters = [author("A. B.", "Peters"), author("Abel", "Peters")];
    expect(resolveInitials("ABP", peters)).toBe(0);
    expect(resolveInitials("AP", [author("Anna", "Peters "), author("Peter", "Adams")])).toBe(0);
  });

  it("keeps a surname written in a script without case", () => {
    expect(resolveInitials("W", [author("Wei", "王")])).toBeNull();
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
  it.each([
    ["ınvestigation", "investigation"],
    ["İnvestigation", "investigation"],
    ["ſoftware", "software"],
  ])("matches %s as the census does, reading ı and İ as i and ſ as s", (word, slug) => {
    expect(pairsOf(`A.B.: ${word}.`, BELL)).toEqual([[0, slug]]);
  });

  it.each(["crıtıcally", "crİtİcally"])("does not read approval written %s as an assignment", (word) => {
    expect(pairsOf(`A.B.: software. All authors ${word} reviewed the original draft.`, BELL)).toEqual([
      [0, "software"],
    ]);
  });

  it("keeps İ in initials when it reads role words with İ as i", () => {
    expect(pairsOf("İ.K.: İnvestigation.", [author("İpek", "Kaya")])).toEqual([[0, "investigation"]]);
  });

  it("keeps positions when lower case changes a letter's length", () => {
    // "İ" lowers to two code units; the name after it must still be found.
    expect(pairsOf("İŞ: software. Ada Lovelace: data curation.", THREE)).toEqual([[0, "data-curation"]]);
  });

  it("reads a contributor with one name only, and skips a name inside a longer word", () => {
    const authors = [author("", "Madonna"), statementAuthor(createAuthor("Ada Lovelace"))];
    expect(pairsOf("Madonna: data curation. Lovelacely: software. Ada Lovelace: methodology.", authors)).toEqual([
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
    const { unmatched } = parseStatement("Methodology, XY and A.L.", [statementAuthor(createAuthor("Ada Lovelace"))]);
    expect(unmatched).toEqual([{ token: "XY", candidates: [], roles: ["Methodology"] }]);
  });
});

describe("assignment order", () => {
  it("lists assignments by author, then in CRediT order, whatever order the text gives", () => {
    const text = "Eva Fox: software, conceptualization. Ada Lovelace: writing – original draft, methodology.";
    expect(parseStatement(text, THREE).assignments).toEqual([
      { author: 0, role: "Methodology" },
      { author: 0, role: "Writing – original draft" },
      { author: 2, role: "Conceptualization" },
      { author: 2, role: "Software" },
    ]);
  });
});

describe("size", () => {
  it("reads back a full draft's by-author statement with every role", () => {
    // Letters only: the parser reads names without digits, so "Franklin 1" and "Franklin 2" would tie.
    const letters = (i: number) => String.fromCharCode(97 + (i % 26), 97 + Math.floor(i / 26));
    const authors = Array.from({ length: MAX_AUTHORS }, (_, i) => {
      const person = createAuthor(`Rosalind Elsie Franklin-Lavoisier${letters(i)}`);
      for (const c of person.contributions) c.score = 100;
      return person;
    });
    const text = generateStatement(authors, { format: "by-author" });
    expect(text.length).toBeLessThanOrEqual(MAX_STATEMENT_LENGTH);
    const parsed = parseStatement(text, authors.map(statementAuthor));
    expect(parsed.assignments).toHaveLength(MAX_AUTHORS * CREDIT_ROLES.length);
  });

  it(`refuses a statement longer than ${MAX_STATEMENT_LENGTH} characters`, () => {
    expect(() => parseStatement("a".repeat(MAX_STATEMENT_LENGTH + 1), THREE)).toThrow(
      new RangeError(
        `A statement is read up to ${MAX_STATEMENT_LENGTH} characters; this one has ${MAX_STATEMENT_LENGTH + 1}.`,
      ),
    );
    expect(() => parseStatement("a".repeat(MAX_STATEMENT_LENGTH), THREE)).not.toThrow();
  });

  it.each([
    ["spaces", (n: number) => `AL: conceptualization.${" ".repeat(n)}x`],
    ["line breaks", (n: number) => `AL: conceptualization.${"\n".repeat(n)}x`],
    ["unknown initials", (n: number) => `${"XY, ".repeat(n / 4)}: conceptualization`],
    ["names and roles", (n: number) => "Ada Lovelace: conceptualization; ".repeat(n / 33)],
    ["author-first initials", () => BY_AUTHOR],
    ["role-first initials", () => BY_ROLE],
  ])("reads %s up to the cap in well under a second", (_, make) => {
    const text = make(MAX_STATEMENT_LENGTH - 100);
    const start = performance.now();
    namesCredit(text);
    parseStatement(text, THREE);
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe("name hits next to initials", () => {
  const ADA: [number, string][] = [[0, "conceptualization"]];
  const offsets = (prefix: string) =>
    Array.from({ length: 10 }, (_, k) => `${",".repeat(k)}${prefix}Ada Lovelace: conceptualization`);
  // Expected values are what the parser returned before the fast path for hits.
  it.each([
    ["after an initial and a dot, at offsets 0 to 9", offsets("A. "), ADA, []],
    ["after an initial, dot and dash, at offsets 0 to 9", offsets("A.- "), [], ["A. - Ada"]],
    ["after an astral initial", ["𝐀. Ada Lovelace: conceptualization"], ADA, []],
    ["after an astral initial and dash", ["𝐀.- Ada Lovelace: conceptualization"], [], ["𝐀. - Ada"]],
    ["twice in a row", ["Ada Lovelace, Ada Lovelace: conceptualization"], ADA, []],
    [
      "right after a role",
      ["Conceptualization, Ada Lovelace; methodology, Charles Darwin"],
      [
        [0, "conceptualization"],
        [1, "methodology"],
      ],
      [],
    ],
  ])("reads a name hit %s", (_, texts, pairs, unresolved) => {
    for (const text of texts) expect(run(text, THREE)).toEqual({ pairs, unresolved });
  });
});

describe("empty name needles", () => {
  it("skips an author whose surname is blank", () => {
    expect(parseStatement("Ada Lovelace: conceptualization", [author("", " ")])).toEqual(
      parseStatement("Ada Lovelace: conceptualization", []),
    );
  }, 1000);
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
      { name: "Grace Anne Marie Hopper", firstName: "Grace", middleName: "Anne", surname: "Hopper" },
      "Grace Anne Marie",
      "Hopper",
    ],
    [{ name: "Hopper, Grace A.", firstName: "Grace", middleName: "A", surname: "Hopper" }, "Grace A.", "Hopper"],
    [{ name: "Madonna", firstName: "Madonna", middleName: "", surname: "" }, "Madonna", ""],
    [{ name: "Grace Hopper", firstName: "Grace", middleName: "", surname: "Hopper" }, "Grace", "Hopper"],
    // A name edited since it was parsed no longer holds the surname: the stored parts stand in.
    [{ name: "J. Doe", firstName: "Grace", middleName: "Ann", surname: "Hopper" }, "Grace Ann", "Hopper"],
    // Family name first, as Hungarian writes it: nothing comes before the surname.
    [{ name: "Kovács János", firstName: "János", middleName: "", surname: "Kovács" }, "János", "Kovács"],
    // A comma that does not follow the surname is not the inverted form.
    [{ name: "Grace, Hopper", firstName: "Grace", middleName: "", surname: "Hopper" }, "Grace,", "Hopper"],
  ])("splits %j", (input, given, surname) => {
    expect(statementAuthor(input)).toEqual({ given, surname });
  });
});

describe("readsAsStatement", () => {
  it.each([
    // Two sentences with four plain words between them read as prose.
    ["Grace did all. Bob wrote code.", true],
    ["Conceptualization - JP", true],
    ["J.-P. Martin; conceptualization", false],
    ["JP - conceptualization", true],
    ["Conceptualization, Jo Lee", false],
    // Many plain words, but no sentence and no distinctive role.
    ["Grace Hopper is the one who did it", false],
    // Name particles and "and" are not prose words.
    ["Ann van der Berg and Bob de la Cruz, conceptualization", false],
    ["Ann Lee and Bob Kim and Cy Moe and Di Wu, conceptualization", false],
    // Each distinctive role is enough with initials beside it.
    ["Formal analysis - JP", true],
    ["Funding acquisition - JP", true],
    ["Project administration - JP", true],
    ["Visualization - JP", true],
    // Three plain words beside a distinctive role read as a statement.
    ["Grace did all the conceptualization", true],
    // Initials beside any one role are enough.
    ["Visualization, conceptualization AB", true],
    // "Author" with a verb is prose about who did what, singular or plural, with words between.
    ["The first author wrote the software.", true],
    ["The authors jointly wrote and revised the text.", true],
    ["The authors analyzed the data.", true],
    ["The authors analysed the data.", true],
    // Sentences that end in two-letter words count as sentences too.
    ["He did it. She saw us. Then go on.", true],
    // Initials count only right after a role, or right before it with nothing but separators between.
    ["Conceptualization of AB", false],
    ["Conceptualization, J", false],
    ["Conceptualization AB.", true],
    ["AB and the Conceptualization", false],
    ["Hopper AB Conceptualization", true],
    ["McAB, Conceptualization", false],
  ])("reads %j as a statement: %s", (text, expected) => {
    expect(readsAsStatement(text)).toBe(expected);
  });
});

const FOUR = [author("Anna", "Bell"), author("Chen", "Dong"), author("Eva", "Fox"), author("Gus", "Hill")];
const pairsOfFour = (text: string) => pairsOf(text, FOUR);

describe("supervision and other lookups", () => {
  it.each([
    "A.B.: investigation under the supervision of C.D.; E.F.: software. All other authors: writing – original draft.",
    "A.B.: investigation, supervised by C.D.; E.F.: software. All other authors: writing – original draft.",
  ])("all other authors counts supervisors as named: %s", (text) => {
    const pairs = pairsOfFour(text);
    expect(pairs).toContainEqual([3, "writing-original-draft"]);
    expect(pairs).not.toContainEqual([1, "writing-original-draft"]);
  });
});

describe("supervised by", () => {
  it.each(["supervised", "supervısed", "SUPERVİSED"])("reads %s with dotted and dotless i", (word) => {
    expect(pairsOfFour(`A.B. did the formal analysis, ${word} by C.D.`)).toEqual([
      [0, "formal-analysis"],
      [1, "supervision"],
    ]);
  });
});

describe("modifier letters", () => {
  // Lower case as in Python's str.islower(): ª, ᵃ and ʰ are not Ll but are Lowercase.
  it.each([
    [
      "Methodology, G.H. A.B. ª contributed to the investigation.",
      [
        [0, "investigation"],
        [3, "methodology"],
      ],
    ],
    [
      "Investigation: A.B. C.D. ᵃdrafted; software: E.F.",
      [
        [0, "investigation"],
        [2, "software"],
      ],
    ],
  ])("count as lower case: %s", (text, expected) => {
    expect(pairsOfFour(text)).toEqual(expected);
  });
});

describe("apposition", () => {
  it("reads only ASCII digits in an author range", () => {
    const text = "A.B.: investigation. The remaining authors (authors ２-３: C.D., E.F.): software.";
    expect(pairsOfFour(text)).toEqual([
      [0, "investigation"],
      [0, "software"],
      [1, "software"],
      [2, "software"],
      [3, "software"],
    ]);
  });
});

describe("supervisor lists", () => {
  it.each([
    "A.B. conceived the study. C.D. and E.F. did the investigation under the supervision of A.B. and G.H. wrote the original draft.",
    "A.B. conceived the study. C.D. and E.F. did the investigation, supervised by A.B. and G.H. wrote the original draft.",
  ])("stop before the next subject: %s", (text) => {
    expect(pairsOfFour(text)).toEqual([
      [0, "supervision"],
      [1, "investigation"],
      [2, "investigation"],
      [3, "writing-original-draft"],
    ]);
  });
});
