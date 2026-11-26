// The census model's tokenizer (ModernBERT's byte-level BPE, as GPT-2's) read from its tokenizer.json, for
// the one setting the model uses: no special tokens added, no truncation. statement-reader.worker.ts runs it.

/** The parts of a Hugging Face tokenizer.json this reads. */
export interface TokenizerJson {
  model: { vocab: Record<string, number>; merges: (string[] | string)[] };
  added_tokens: { id: number; content: string }[];
}

// GPT-2's split, as the ByteLevel pre-tokenizer runs it, with Unicode White_Space for \s as Oniguruma has it.
const WORDS =
  /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\p{White_Space}\p{L}\p{N}]+|\p{White_Space}+(?!\P{White_Space})|\p{White_Space}+/gu;

// Each byte as the printable character GPT-2's vocabulary spells it with.
const BYTE_CHARS: string[] = [];
for (let b = 0, shift = 0; b < 256; b++) {
  const printable = (b >= 33 && b <= 126) || (b >= 161 && b <= 172) || b >= 174;
  BYTE_CHARS[b] = String.fromCharCode(printable ? b : 256 + shift++);
}

/**
 * `encode(text)` gives the ids Python's `tokenizer(text, add_special_tokens=False)` gives; `id(token)` a
 * token's id. Added tokens ("[unused0]", runs of spaces) are split out of the NFC text first, longest first.
 */
export function tokenizer({ model, added_tokens }: TokenizerJson) {
  // shortcut: ignores [MASK]'s lstrip (it eats the spaces before it), as no statement writes "[MASK]".
  const added = new Map(added_tokens.map(({ id, content }) => [content, id]));
  const escaped = [...added.keys()]
    .sort((a, b) => b.length - a.length)
    .map((s) => s.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&"));
  const split = new RegExp(`(${escaped.join("|")})`);
  const ranks = new Map(model.merges.map((m, i) => [typeof m === "string" ? m : m.join(" "), i]));
  const seen = new Map<string, number[]>();
  const utf8 = new TextEncoder();

  // One pair at a time, the leftmost of the lowest rank, as the Rust tokenizers do, and as they do it: with a
  // heap of candidate pairs over a linked list of symbols, as rescanning the word per merge is quadratic.
  const bpe = (word: string): number[] => {
    const parts = [...word];
    const n = parts.length;
    const next = parts.map((_, i) => i + 1);
    const prev = parts.map((_, i) => i - 1);
    // A candidate as rank * SLOT + position, so the least is the leftmost of the lowest rank. Exact in a double
    // for words under 2^32 bytes and up to 2^21 merges (this vocabulary has about 50,000).
    const SLOT = 2 ** 32;
    const heap: number[] = [];
    const key = (i: number) => heap[i] ?? Number.POSITIVE_INFINITY;
    const swap = (i: number, j: number) => {
      [heap[i], heap[j]] = [key(j), key(i)];
    };
    const pair = (at: number) => {
      const right = next[at] ?? n;
      return right < n ? ranks.get(`${parts[at]} ${parts[right]}`) : undefined;
    };
    const offer = (at: number) => {
      const rank = pair(at);
      if (rank === undefined) return;
      heap.push(rank * SLOT + at);
      const up = (i: number) => Math.floor((i - 1) / 2);
      for (let i = heap.length - 1; i > 0 && key(i) < key(up(i)); i = up(i)) swap(i, up(i));
    };
    const take = () => {
      const top = key(0);
      const last = heap.pop() ?? 0;
      if (heap.length) heap[0] = last;
      for (let i = 0; ; ) {
        const child = key(2 * i + 2) < key(2 * i + 1) ? 2 * i + 2 : 2 * i + 1;
        if (!(key(child) < key(i))) break;
        swap(i, child);
        i = child;
      }
      return top;
    };
    for (let at = 0; at < n - 1; at++) offer(at);
    while (heap.length) {
      const top = take();
      const at = top % SLOT;
      // Stale: merged into its left neighbour, or its pair has changed since (each pair has its own rank).
      if (parts[at] === "" || pair(at) !== Math.floor(top / SLOT)) continue;
      const right = next[at] ?? n;
      parts[at] = `${parts[at]}${parts[right]}`;
      parts[right] = "";
      const after = next[right] ?? n;
      next[at] = after;
      if (after < n) prev[after] = at;
      const left = prev[at] ?? -1;
      if (left >= 0) offer(left);
      offer(at);
    }
    return parts.filter((p) => p !== "").map((p) => model.vocab[p] ?? 0);
  };

  const encode = (text: string): number[] =>
    text
      .normalize("NFC")
      .split(split)
      .flatMap((piece, i) => {
        if (i % 2) return [added.get(piece) ?? 0];
        return [...piece.matchAll(WORDS)].flatMap(([word]) => {
          let ids = seen.get(word);
          if (!ids) {
            ids = bpe(Array.from(utf8.encode(word), (b) => BYTE_CHARS[b]).join(""));
            seen.set(word, ids);
          }
          return ids;
        });
      });

  return { encode, id: (token: string) => added.get(token) ?? model.vocab[token] };
}
