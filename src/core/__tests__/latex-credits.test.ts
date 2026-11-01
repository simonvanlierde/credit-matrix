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
  it("writes one granular \\credit line per author, 14 values in CRediT order", () => {
    const tex = toLatexCredits([curie]);
    expect(tex).toContain("\\credit{Marie Skłodowska-Curie}{1,0,0,0,0.66,0,0,0,0,0,0,0,0,0.33}");
  });

  it("keeps custom scores as fractions", () => {
    const a = createAuthor("Tu Youyou", { contributions: [{ role: "Software", score: 50 }] });
    expect(toLatexCredits([a])).toContain("\\credit{Tu Youyou}{0,0,0,0,0,0,0,0,0.5,0,0,0,0,0}");
  });

  it("escapes LaTeX specials in names", () => {
    const a = createAuthor("A & B_C #1 {x} 50% $y ~ ^ \\", { contributions: [{ role: "Software", score: 100 }] });
    expect(toLatexCredits([a])).toContain(
      "\\credit{A \\& B\\_C \\#1 \\{x\\} 50\\% \\$y \\textasciitilde{} \\textasciicircum{} \\textbackslash{}}{",
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

  it("carries the generator note and usage in comments, with the package options", () => {
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
