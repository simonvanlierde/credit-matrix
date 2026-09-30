import type { Author } from "./author";
import { DEFAULT_UI_TRANSLATOR, fillTemplate, type UiTranslator } from "./credit-i18n/ui-strings";

/** How a statement names a contributor: their initials, or their name with whitespace collapsed. */
export function contributorLabel(author: Author, useInitials: boolean): string {
  return useInitials ? author.initials : author.name.replace(/\s+/g, " ").trim();
}

/**
 * Notes for the two authorship markers that sit outside CRediT: shared first
 * authorship and corresponding authorship.
 *
 * They are rendered as sentences naming the people, not as symbols attached to
 * each name. A by-role statement lists a contributor once per role, so an
 * inline dagger would repeat up to fourteen times; a note at the end says the
 * same thing once, and reads the way a journal prints it.
 */
export function markerNotes(
  authors: Author[],
  options: { useInitials?: boolean; translateUi?: UiTranslator; locale?: string } = {},
): string[] {
  const { useInitials = false, translateUi = DEFAULT_UI_TRANSLATOR, locale = "en" } = options;
  // CLDR owns the list wording ("A, B, and C" / "A、B") per locale.
  const list = new Intl.ListFormat(locale, { type: "conjunction" });
  const join = (people: Author[]) => list.format(people.map((author) => contributorLabel(author, useInitials)));

  const notes: string[] = [];
  const equal = authors.filter((author) => author.equalContribution);
  const corresponding = authors.filter((author) => author.corresponding);

  // One marked contributor cannot have contributed "equally" with anyone, so
  // the note would be nonsense; the marker stays in the data and in the
  // structured exports, which is where a lone flag still means something.
  if (equal.length > 1) notes.push(fillTemplate(translateUi("equalContributionNote"), { names: join(equal) }));
  if (corresponding.length > 0) {
    notes.push(fillTemplate(translateUi("correspondenceNote"), { names: join(corresponding) }));
  }
  return notes;
}
