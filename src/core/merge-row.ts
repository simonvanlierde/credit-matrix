import type { Author } from "./author";

/**
 * Give imported contributors the ids they already have in `current`.
 *
 * A file import (names, CSV, XML) mints fresh ids, and an open ask is keyed by
 * id. Without this, re-importing a roster turns every pending reply into
 * "unmatched". A contributor keeps an id the import already carries, else takes
 * the id of the row with the same ORCID iD, else of the row with the same name
 * (ignoring case and spacing). Each existing id goes to one contributor only.
 *
 * This is for your own import. A reply is matched by its claimed id alone.
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
