import { describe, expect, it } from "vitest";
import { GENERATOR_NOTE } from "../export/generator-note";
import { toLatexCredits } from "../export/latex-credits";
import { createAuthor } from "../parse-authors";

const curie = createAuthor("Marie Skłodowska-Curie", {
  contributions: [
    { role: "Conceptualization", score: 100 },
    { role: "Investigation", score: 66 },
    { role: "Writing – review & editing", score: 33 },
  ],
});

describe("toLatexCredits", () => {
  it("writes the whole file: header, macros once for a mixed team, then one line per author", () => {
    const plain = createAuthor("Tu Youyou", { contributions: [{ role: "Software", score: 100 }] });
    const split = createAuthor("van_Leeuwenhoek \r\n\n  Antonie", { contributions: [] });
    expect(toLatexCredits([plain, split])).toBe(
      [
        "% CRediT contributions for the latex-credits package",
        "% (https://github.com/Pseudomanifold/latex-credits). Put credits.sty next to your .tex file, then:",
        "%   \\usepackage{credits}           % in the preamble; the option skipempty hides unused roles",
        "%   \\insertcreditsgranular        % in the text: the role table, shaded by level",
        "%   \\insertcreditsgranularstatement  % or: the statement as sentences",
        "% Values run 0 to 1 in CRediT order. Lead is 1, equal 0.66, supporting 0.33.",
        "% Acknowledgees are left out: the package lists authors only.",
        "% Names outside Latin scripts need lualatex or xelatex with a suitable font.",
        `% ${GENERATOR_NOTE}`,
        "\\protected\\def\\crUS{\\_}\\protected\\def\\crDOLLAR{\\$}",
        "\\protected\\def\\crTILDE{\\textasciitilde}\\protected\\def\\crCARET{\\textasciicircum}",
        "\\protected\\def\\crBSLASH{\\textbackslash}",
        "\\credit{Tu Youyou}{0,0,0,0,0,0,0,0,1,0,0,0,0,0}",
        "\\credit{van\\crUS{}Leeuwenhoek Antonie}{0,0,0,0,0,0,0,0,0,0,0,0,0,0}",
      ].join("\n"),
    );
  });

  it("writes one granular \\credit line per author, 14 values in CRediT order", () => {
    const tex = toLatexCredits([curie]);
    expect(tex).toContain("\\credit{Marie Skłodowska-Curie}{1,0,0,0,0.66,0,0,0,0,0,0,0,0,0.33}");
  });

  it("keeps custom scores as fractions", () => {
    const a = createAuthor("Tu Youyou", { contributions: [{ role: "Software", score: 50 }] });
    expect(toLatexCredits([a])).toContain("\\credit{Tu Youyou}{0,0,0,0,0,0,0,0,0.5,0,0,0,0,0}");
  });

  it("escapes every LaTeX special in names, with protected macros for the ones \\xdef breaks", () => {
    const a = createAuthor("A & B_C #1 {x} 50% $y ~ ^ \\", { contributions: [{ role: "Software", score: 100 }] });
    const tex = toLatexCredits([a]);
    expect(tex).toContain(
      "\\credit{A \\& B\\crUS{}C \\#1 \\{x\\} 50\\% \\crDOLLAR{}y \\crTILDE{} \\crCARET{} \\crBSLASH{}}{",
    );
    const macros = tex.indexOf("\\protected\\def\\crUS{\\_}");
    expect(macros).toBeGreaterThan(-1);
    for (const m of [
      "crDOLLAR{\\$}",
      "crTILDE{\\textasciitilde}",
      "crCARET{\\textasciicircum}",
      "crBSLASH{\\textbackslash}",
    ])
      expect(tex).toContain(`\\protected\\def\\${m}`);
    expect(macros).toBeLessThan(tex.indexOf("\\credit{"));
  });

  it("writes no macro block when no name needs one", () => {
    const a = createAuthor("A & B #1 {x} 50%", { contributions: [{ role: "Software", score: 100 }] });
    const tex = toLatexCredits([curie, a]);
    expect(tex).not.toContain("\\protected");
    expect(tex).toContain("\\credit{A \\& B \\#1 \\{x\\} 50\\%}{");
  });

  it("writes a comment and no \\credit line when no author has a role", () => {
    const ack = createAuthor("Antonie van Leeuwenhoek", {
      contributorType: "non-author",
      contributions: [{ role: "Software", score: 100 }],
    });
    for (const authors of [[], [ack], [createAuthor("Tu Youyou")]]) {
      const tex = toLatexCredits(authors);
      expect(tex).toContain("% No authors with roles yet");
      expect(tex).not.toContain("\\credit{");
    }
  });

  it("writes 1 or 0 in Yes/No mode", () => {
    expect(toLatexCredits([curie], { yesNo: true })).toContain(
      "\\credit{Marie Skłodowska-Curie}{1,0,0,0,1,0,0,0,0,0,0,0,0,1}",
    );
  });

  it("leaves non-author contributors out", () => {
    const ack = createAuthor("Antonie van Leeuwenhoek", {
      contributorType: "non-author",
      contributions: [{ role: "Software", score: 100 }],
    });
    const tex = toLatexCredits([curie, ack]);
    expect(tex).not.toContain("Leeuwenhoek");
  });

  it("writes the generator note and usage in comments, with the package options", () => {
    const tex = toLatexCredits([curie]);
    expect(tex).toContain(`% ${GENERATOR_NOTE}`);
    expect(tex).toContain("\\usepackage{credits}");
    expect(tex).toContain("\\insertcreditsgranular");
    expect(tex).toContain("\\insertcreditsgranularstatement");
    for (const line of tex.split("\n").filter((l) => !l.startsWith("%") && l)) {
      expect(line.startsWith("\\credit{")).toBe(true);
    }
  });
});
