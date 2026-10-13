import { useState } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { useShallow } from "zustand/react/shallow";
import { isValidOrcid } from "@/core";
import { hasContributions, MAX_AUTHORS } from "@/core/author";
import { splitNameList } from "@/core/parse-authors";
import { announce } from "@/lib/announce";
import { useContributionStore } from "@/store/contribution-store";
import { detectOrcid, fetchOrcidName, nameBesideOrcid, orcidErrorText } from "./orcid";

/** The user renamed a row seeded from an iD while its lookup ran; their name wins. */
function renamedDuringLookup(id: string, orcid: string): boolean {
  const row = useContributionStore.getState().authors.find((a) => a.id === id);
  return row !== undefined && row.name !== orcid;
}

// NOTE: a courtesy cap on concurrent ORCID lookups, not app correctness — a
// plain Promise.all would work; keep the cap so a 100-iD paste doesn't hammer
// the registry from one browser.
async function forEachWithConcurrency<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      if (item !== undefined) await task(item);
    }
  });
  await Promise.all(workers);
}

/**
 * The add field: one name, a pasted list, or ORCID iDs whose names fill in
 * from the registry. Owns the field's text and its error.
 */
export function useAddContributors() {
  const t = useTranslations();
  const format = useFormatter();
  const { authorCount, addAuthor, removeAuthor, updateAuthorName } = useContributionStore(
    useShallow((s) => ({
      authorCount: s.authors.length,
      addAuthor: s.addAuthor,
      removeAuthor: s.removeAuthor,
      updateAuthorName: s.updateAuthorName,
    })),
  );
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  /** Seed a row from an ORCID iD, then fill its name from the registry. */
  async function addOrcidAuthor(orcid: string): Promise<{ id: string | null; error: string | null }> {
    const id = addAuthor(orcid, orcid);
    if (!id) return { id, error: null };
    const result = await fetchOrcidName(orcid);
    if ("code" in result) return { id, error: orcidErrorText(result, t) };
    if (renamedDuringLookup(id, orcid)) return { id, error: null };
    // A refused write (the row went with a draft switch mid-lookup) leaves the
    // row named after its iD, so it is a failure, not a success.
    if (!updateAuthorName(id, result.displayName)) {
      return { id, error: t("annOrcidLookupsFailed", { count: 1, ids: orcid }) };
    }
    return { id, error: null };
  }

  /**
   * Add several contributors at once. Every row lands immediately, in the pasted
   * order; ORCID names then fill in from concurrent lookups.
   */
  async function addMany(tokens: string[]) {
    const pending: { id: string; orcid: string }[] = [];
    const rejected: string[] = [];
    const capacity = Math.max(0, MAX_AUTHORS - authorCount);
    const acceptedTokens = tokens.slice(0, capacity);
    const skippedForLimit = tokens.length - acceptedTokens.length;

    // An iD with the right shape but a bad check digit used to fall through to
    // addAuthor, throw inside createAuthor, and land in `rejected`; reported
    // as "no name in them", which is the wrong diagnosis. The single-add path
    // already checks the checksum, so bucket it the same way here.
    const badChecksum: string[] = [];
    for (const token of acceptedTokens) {
      const orcid = detectOrcid(token);
      if (orcid && !isValidOrcid(orcid)) {
        badChecksum.push(orcid);
        continue;
      }
      // A name typed with the iD is the user's; only a bare iD needs a lookup.
      const name = orcid ? nameBesideOrcid(token) : null;
      const id = addAuthor(name ?? orcid ?? token, orcid ?? undefined);
      if (!id) rejected.push(token);
      else if (orcid && !name) pending.push({ id, orcid });
    }

    // Keep the row on a failed lookup (named after its iD) so one bad token
    // doesn't silently vanish from a pasted list, but say which ones failed,
    // so the rows still named after an iD aren't mistaken for real names.
    const failed: string[] = [];
    await forEachWithConcurrency(pending, 4, async ({ id, orcid }) => {
      const result = await fetchOrcidName(orcid);
      if (!("code" in result) && renamedDuringLookup(id, orcid)) return;
      // A refused write leaves the row named after its iD, same as a failed lookup.
      if ("code" in result || !updateAuthorName(id, result.displayName)) failed.push(orcid);
    });

    const addedCount = acceptedTokens.length - rejected.length - badChecksum.length;
    const added = t("annContributorsAdded", { count: addedCount });
    // The UI locale's own list punctuation: "、" in Japanese, not ", ".
    const list = (items: string[]) => format.list(items, { type: "conjunction" });
    const problems = [
      rejected.length > 0 && t("annEntriesSkippedNoName", { count: rejected.length, entries: list(rejected) }),
      badChecksum.length > 0 && t("annOrcidChecksumsSkipped", { count: badChecksum.length, ids: list(badChecksum) }),
      failed.length > 0 && t("annOrcidLookupsFailed", { count: failed.length, ids: list(failed) }),
      skippedForLimit > 0 && t("annContributorsSkippedLimit", { count: skippedForLimit, limit: MAX_AUTHORS }),
    ].filter(Boolean);

    if (problems.length === 0) {
      announce(added);
      return;
    }
    const message = problems.join(" ");
    setAddError(message);
    announce(`${added} ${message}`, { assertive: true });
  }

  /** Add from the input: a bare ORCID seeds the row then fills its name from ORCID. */
  async function handleAdd() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setAddError(null);
    // addAuthor returns null both for an unparseable name and for a full list,
    // so check the cap here. Without it, adding at the limit either reported
    // "that doesn't look like a name" (false) or, for an ORCID, cleared the
    // input and silently did nothing. addMany already reports this separately.
    if (authorCount >= MAX_AUTHORS) {
      const message = t("errAtContributorLimit", { limit: MAX_AUTHORS });
      setAddError(message);
      announce(message, { assertive: true });
      return;
    }
    const tokens = splitNameList(trimmed);
    if (tokens.length > 1) {
      setNewName("");
      await addMany(tokens);
      return;
    }
    const orcid = detectOrcid(trimmed);
    if (orcid) {
      if (!isValidOrcid(orcid)) {
        setAddError(t("errOrcidChecksum"));
        announce(t("errOrcidChecksum"), { assertive: true });
        return;
      }
      // A name typed with the iD is the user's: keep it, and skip the lookup.
      const name = nameBesideOrcid(trimmed);
      if (name) {
        if (addAuthor(name, orcid)) setNewName("");
        else setAddError(t("errNameNoLetter"));
        return;
      }
      setNewName("");
      const { id, error } = await addOrcidAuthor(orcid);
      if (error) {
        // No junk author named after the iD survives a failed lookup, but a row
        // the user renamed or gave roles while waiting is theirs, not junk.
        // Read from the store: `authors` here is the list from before the await.
        const row = useContributionStore.getState().authors.find((a) => a.id === id);
        if (row && row.name === orcid && !hasContributions(row)) removeAuthor(row.id);
        setAddError(error);
        announce(error, { assertive: true });
        // Hand the text back only to an empty field, not over the next name typed.
        setNewName((current) => (current.trim() ? current : trimmed));
      }
    } else if (addAuthor(trimmed)) {
      setNewName("");
    } else {
      setAddError(t("errNameNoLetter"));
    }
  }

  /** Pasting a whole author list adds every name; single names paste normally. */
  function handleAddPaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const tokens = splitNameList(event.clipboardData.getData("text"));
    if (tokens.length <= 1) return;
    event.preventDefault();
    setAddError(null);
    void addMany(tokens);
  }

  return { newName, setNewName, addError, setAddError, handleAdd, handleAddPaste };
}
