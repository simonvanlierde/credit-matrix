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
const nameKey = (author: Author) => author.name.trim().replace(/\s+/g, " ").toLowerCase();

export function keepKnownIds(current: Author[], incoming: Author[]): Author[] {
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

/** Same id, same ORCID iD, or the same name when at least one of them has no ORCID iD. */
function samePerson(a: Author, b: Author): boolean {
  if (a.id === b.id) return true;
  if (a.orcid && b.orcid) return a.orcid === b.orcid;
  return nameKey(a) === nameKey(b);
}

/**
 * The imported contributors who match nobody in `current` nor an earlier row of
 * `incoming`, as they came in. Unlike {@link keepKnownIds} a match is not used
 * up, so a file listing someone twice adds them at most once.
 */
export function newContributors(current: Author[], incoming: Author[]): Author[] {
  const added: Author[] = [];
  for (const author of incoming) {
    if (!current.some((known) => samePerson(known, author)) && !added.some((known) => samePerson(known, author)))
      added.push(author);
  }
  return added;
}
