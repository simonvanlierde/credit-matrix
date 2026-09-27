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
