import { Lexer } from "marked";

const LIVE_TARGETS = ["quarto", "pandoc", "myst", "typst", "sphinx", "ro-crate"] as const;
export type LiveTarget = (typeof LIVE_TARGETS)[number];
export type DocPart = string | { live: LiveTarget };

/** Split standalone live comments before rendering Markdown, keeping static source unchanged. */
export function splitLiveMarkers(source: string): DocPart[] {
  const parts: DocPart[] = [];
  let offset = 0;
  let start = 0;
  for (const token of Lexer.lex(source)) {
    const tokenStart = offset;
    // marked normalizes CRLF and CR to LF; track offsets in the original source.
    for (let i = 0; i < token.raw.length; i++, offset++) {
      if (source[offset] === "\r" && source[offset + 1] === "\n") offset++;
    }
    const marker =
      token.type === "html" && /^[ \t]*<!--\s*live:\s*((?:(?!-->)[\s\S])*?)\s*-->[ \t]*\n?$/.exec(token.raw);
    if (!marker) continue;
    const target = marker[1]?.trim() ?? "";
    const live = LIVE_TARGETS.find((candidate) => candidate === target);
    if (!live) throw new Error(`Invalid live target: ${JSON.stringify(target)}`);
    if (tokenStart > start) parts.push(source.slice(start, tokenStart));
    parts.push({ live });
    start = offset;
    // A blank line makes marked leave the directive line's ending in the next token.
    if (!token.raw.endsWith("\n") && source[start] === "\r") start++;
    if (!token.raw.endsWith("\n") && source[start] === "\n") start++;
  }
  if (start < source.length || parts.length === 0) parts.push(source.slice(start));
  return parts;
}
