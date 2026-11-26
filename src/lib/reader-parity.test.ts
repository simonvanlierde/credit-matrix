import { describe, expect, it } from "vitest";
import { CREDIT_ROLES } from "@/core";
import { creditSlug } from "@/core/credit-roles";
import shipped from "../../census/model.json";
// From the census export's parity.json, cut by scripts/reader-parity-fixture.mjs: what Python's tokenizer,
// `onepass.Encoded` and onnxruntime (w8) gave for each case.
import parity from "./__fixtures__/reader-parity.json";
import { authorText, chunks, decode, MARKER, MAX_TOKENS, MODEL_FILE, statementRoom } from "./statement-reader";
import { type TokenizerJson, tokenizer } from "./tokenizer";

const tokens = tokenizer(parity.tokenizer as TokenizerJson);
const special = (token: string) => tokens.id(token) ?? -1;
const ids = { cls: special("[CLS]"), sep: special("[SEP]"), marker: special(MARKER) };
const slug = new Map(CREDIT_ROLES.map((role) => [role.name, creditSlug(role.url)]));

describe("the reader's inputs and outputs match the census model's", () => {
  it("in the export it reads", () => {
    expect(parity.model).toMatchObject({ file: MODEL_FILE, max_length: MAX_TOKENS, marker: MARKER });
    // The tokenizer and model the app downloads: a new census/model.json needs a new fixture.
    expect(parity.model.sha256).toEqual({
      "tokenizer.json": shipped.sha256["tokenizer.json"],
      [MODEL_FILE]: shipped.sha256[MODEL_FILE],
    });
  });

  it.each(parity.cases.map((c) => [c.case, c] as const))("%s", (_, c) => {
    const texts = c.authors.map((name, i) => authorText(name, i + 1, c.authors.length));
    expect(texts).toEqual(c.author_text);
    const byline = texts.map(tokens.encode);
    const statement = tokens.encode(c.statement);
    expect(statement.length > statementRoom(byline)).toBe(c.statement_cut);
    const made = chunks(byline, statement, ids);
    expect(
      made.map((m) => ({ authors: m.authors.map((i) => i + 1), input_ids: m.ids, marker_positions: m.markers })),
    ).toEqual(c.chunks.map(({ authors, input_ids, marker_positions }) => ({ authors, input_ids, marker_positions })));

    // Python's logits, read back as the worker reads them, give Python's pairs.
    const probabilities: number[][] = [];
    for (const chunk of c.chunks) {
      chunk.authors.forEach((a, k) => {
        probabilities[a - 1] = (chunk.logits[k] ?? []).map((x) => 1 / (1 + Math.exp(-x)));
      });
    }
    const read = decode({ probabilities, labels: parity.model.roles, threshold: parity.model.threshold });
    const pairs = read.flatMap(({ roles }, i) => roles.map(({ role }) => [i + 1, slug.get(role)]));
    expect(pairs.sort((a, b) => String(a).localeCompare(String(b)))).toEqual(
      c.pairs.sort((a, b) => String(a).localeCompare(String(b))),
    );
  });
});
