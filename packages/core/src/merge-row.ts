import type { Author } from "./author";

export interface MergeResult {
  /** The list with the claimed row replaced, or the original list unchanged. */
  authors: Author[];
  /** The contributor whose row was taken, once merged. */
  merged: Author | null;
  /** The returned contributor when nothing in the list matched them. */
  unmatched: Author | null;
}

/**
 * Fold one co-author's returned draft back into yours.
 *
 * Only their own row is taken, and on that row they are the authority: the
 * name, iD, type, roles, and markers they set on themselves replace yours. A
 * cleared value is an answer, and nobody spells a person's name better than
 * they do. Edits they made to anyone else are discarded on purpose: each
 * person answers for themselves, and a stale copy must not be able to
 * overwrite the rows they were not asked about. That is the whole conflict
 * story — there is no diff to review and no per-cell merge.
 *
 * `claimId` selects who answered, and it is also the only thing that decides
 * who they are in *your* list: the row replaced is the one with that id, or
 * none, and they are reported as unmatched. Matching by ORCID or name would
 * let a reply under an id nobody was asked about overwrite whichever
 * co-author it names. Falling back to position would let a contributor nobody
 * recognises overwrite whoever happens to sit at that index.
 */
export function mergeContributorRow(current: Author[], incoming: Author[], claimId: string): MergeResult {
  const claimed = incoming.find((author) => author.id === claimId);
  if (!claimed) return { authors: current, merged: null, unmatched: null };

  const index = current.findIndex((author) => author.id === claimId);
  if (index === -1) return { authors: current, merged: null, unmatched: claimed };

  const existing = current[index];
  if (!existing) return { authors: current, merged: null, unmatched: claimed };

  // Their whole row replaces yours; only the id stays, so the row keeps its
  // place in every id-keyed lookup. The derived name fields travel with the
  // name and are re-derived by the store's normalization on load anyway.
  const merged: Author = { ...claimed, id: existing.id };

  const authors = [...current];
  authors[index] = merged;
  return { authors, merged, unmatched: null };
}

/**
 * Give imported contributors the ids they already have in `current`.
 *
 * A file import (names, CSV, XML) mints fresh ids, and an open ask is keyed by
 * id. Without this, re-importing a roster turns every pending reply into
 * "unmatched". A contributor keeps an id the import already carries, else takes
 * the id of the row with the same ORCID iD, else of the row with the same name
 * (ignoring case and spacing). Each existing id goes to one contributor only.
 *
 * This is for your own import. A reply still merges by `claimId` alone.
 */
export function keepKnownIds(current: Author[], incoming: Author[]): Author[] {
  const nameKey = (author: Author) => author.name.trim().replace(/\s+/g, " ").toLowerCase();
  const free = new Map(current.map((author) => [author.id, author]));
  // Ids the import already carries are spoken for, so a name match cannot take one first.
  const carried = new Set(incoming.map((author) => author.id).filter((id) => free.has(id)));
  for (const id of carried) free.delete(id);

  const take = (match: (author: Author) => boolean): string | undefined => {
    for (const [id, author] of free) {
      if (match(author)) {
        free.delete(id);
        return id;
      }
    }
    return undefined;
  };

  return incoming.map((author) => {
    if (carried.has(author.id)) return author;
    const id =
      (author.orcid ? take((known) => known.orcid === author.orcid) : undefined) ??
      take((known) => nameKey(known) === nameKey(author));
    return id ? { ...author, id } : author;
  });
}
