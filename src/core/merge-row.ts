import type { Contributor } from "./author";
import { isPerson, orcidOf } from "./author";
import { relinkGroups } from "./parse-authors";

/**
 * Give imported contributors the ids they already have in `current`.
 *
 * A file import (names, CSV, XML) mints fresh ids, and an open ask is keyed by
 * id. Without this, re-importing a roster turns every pending reply into
 * "unmatched". A contributor keeps an id the import already has, else takes
 * the id of the row with the same ORCID iD, else of the row with the same name
 * (ignoring case and spacing) unless both rows have different ORCID iDs. Each
 * existing id goes to one contributor only.
 *
 * This is for your own import. A reply is matched by its claimed id alone. An incoming group's
 * links to a re-keyed person follow that person's new id.
 */
const nameKey = (author: Contributor) => author.name.trim().replace(/\s+/g, " ").toLowerCase();

export function keepKnownIds(current: Contributor[], incoming: Contributor[]): Contributor[] {
  const free = new Map(current.map((author) => [author.id, author]));
  // Ids the import already has are spoken for, so a name match cannot take one first.
  const kept = new Set(incoming.map((author) => author.id).filter((id) => free.has(id)));
  for (const id of kept) free.delete(id);

  const take = (match: (author: Contributor) => boolean): string | undefined => {
    for (const [id, author] of free) {
      if (match(author)) {
        free.delete(id);
        return id;
      }
    }
    return undefined;
  };

  const renamed = new Map<string, string>();
  const mapped = incoming.map((author) => {
    if (kept.has(author.id)) return author;
    const id =
      (orcidOf(author) ? take((known) => orcidOf(known) === orcidOf(author)) : undefined) ??
      take((known) => samePerson(known, author));
    if (id && isPerson(author)) renamed.set(author.id, id);
    return id ? { ...author, id } : author;
  });
  return relinkGroups(mapped, renamed);
}

/** Same id, same ORCID iD, or the same name when at least one of them has no ORCID iD. */
function samePerson(a: Contributor, b: Contributor): boolean {
  if (a.id === b.id) return true;
  // A group and a person never match, even when the name does.
  if (a.kind !== b.kind) return false;
  if (orcidOf(a) && orcidOf(b)) return orcidOf(a) === orcidOf(b);
  return nameKey(a) === nameKey(b);
}

/**
 * The imported contributors who match nobody in `current` nor an earlier row of
 * `incoming`, as they came in. Unlike {@link keepKnownIds} a match is not used
 * up, so a file listing someone twice adds them at most once. An added group's links to a person
 * already in `current` point at that row.
 */
export function newContributors(current: Contributor[], incoming: Contributor[]): Contributor[] {
  const added: Contributor[] = [];
  // An added group's link to a person who is already here points at that person's row.
  const renamed = new Map<string, string>();
  for (const author of incoming) {
    const known = current.find((row) => samePerson(row, author)) ?? added.find((row) => samePerson(row, author));
    if (!known) added.push(author);
    else if (isPerson(author)) renamed.set(author.id, known.id);
  }
  return relinkGroups([...current, ...added], renamed).slice(current.length);
}
