// biome-ignore-all lint/correctness/noNodejsModules: Node fixture generator.
// biome-ignore-all lint/suspicious/noConsole: generator output.
// Writes src/lib/__fixtures__/reader-parity.json from a census browser export's parity.json (`census` writes it
// with `onepass.parity`): its cases, and the part of tokenizer.json they use (their vocabulary, the merges
// that build it, the added tokens), so the test needs no 3.4 MB tokenizer. Fails if the cut tokenizer would
// tokenize the cases otherwise than the whole one.
//   node scripts/reader-parity-fixture.mjs <export dir>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";
import { tokenizer } from "../src/lib/tokenizer.ts";

const dir = process.argv[2];
if (!dir) throw new Error("usage: node scripts/reader-parity-fixture.mjs <export dir>");
const parity = JSON.parse(readFileSync(join(dir, "parity.json"), "utf8"));
const whole = JSON.parse(readFileSync(join(dir, "tokenizer.json"), "utf8"));
const texts = parity.cases.flatMap((c) => [c.statement, ...c.author_text]);

// Every merge that builds a token the cases use, and the merges that build its parts: a merge outside
// that set never makes a token on the way to the cases' ones, so dropping it changes nothing.
const pairs = whole.model.merges.map((m) => (Array.isArray(m) ? m : m.split(" ")));
const making = Map.groupBy(pairs.keys(), (i) => pairs[i].join(""));
const byId = new Map(Object.entries(whole.model.vocab).map(([token, id]) => [id, token]));
const needed = new Set(texts.flatMap((t) => tokenizer(whole).encode(t)).map((id) => byId.get(id)));
const kept = new Set();
for (const token of needed) {
  for (const i of making.get(token) ?? []) {
    kept.add(i);
    for (const part of pairs[i]) needed.add(part);
  }
}
const merges = whole.model.merges.filter((_, i) => kept.has(i));
const vocab = Object.fromEntries(Object.entries(whole.model.vocab).filter(([token]) => needed.has(token)));
const cut = { model: { vocab, merges }, added_tokens: whole.added_tokens.map(({ id, content }) => ({ id, content })) };
for (const text of texts) {
  if (!isDeepStrictEqual(tokenizer(cut).encode(text), tokenizer(whole).encode(text))) {
    throw new Error(`the cut tokenizer reads ${JSON.stringify(text.slice(0, 40))} otherwise`);
  }
}
// Without attention_mask (all ones) and probabilities (the logits' sigmoid).
const cases = parity.cases.map((c) => ({
  ...c,
  chunks: c.chunks.map(({ authors, input_ids, marker_positions, logits }) => ({
    authors,
    input_ids,
    marker_positions,
    logits,
  })),
}));
const out = join(import.meta.dirname, "..", "src", "lib", "__fixtures__", "reader-parity.json");
// Invisible characters (the soft hyphen in a case) as \u escapes, so a reader of the file can see them.
const json = JSON.stringify({ model: parity.model, tokenizer: cut, cases }).replace(
  /\p{Cf}/gu,
  (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
);
writeFileSync(out, `${json}\n`);
console.log(`${out}: ${cases.length} cases, ${Object.keys(vocab).length} tokens, ${merges.length} merges`);
