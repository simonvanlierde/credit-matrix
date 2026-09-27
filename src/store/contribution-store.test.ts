import { createAuthor, type LocaleCode } from "@credit-generator/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestStorageFullAnnouncement } from "@/lib/announce";
import { announcingStorage, type Draft, MAX_DRAFTS, ROLE_NAMES, useContributionStore } from "./contribution-store";
import { PERSIST_KEY, PERSIST_VERSION } from "./persist-meta";

vi.mock("@/lib/announce", () => ({ requestStorageFullAnnouncement: vi.fn() }));

const initial = useContributionStore.getState();

function store() {
  return useContributionStore.getState();
}

describe("contribution store", () => {
  beforeEach(() => {
    useContributionStore.setState(initial, true);
  });

  describe("title", () => {
    it("trims what it is given", () => {
      store().setTitle("  A study of studies  ");
      expect(store().title).toBe("A study of studies");
    });

    it("caps a pasted document so it cannot bloat the persisted draft", () => {
      store().setTitle("x".repeat(2000));
      expect(store().title).toHaveLength(500);
    });

    it("is draft data, so a reset clears it", () => {
      store().setTitle("A study of studies");
      store().addAuthor("Jane Smith");
      store().reset();
      expect(store().title).toBe("");
      expect(store().authors).toHaveLength(0);
    });

    it("survives a DOI import that carries no title, when cleared deliberately", () => {
      store().setTitle("An earlier import");
      store().setTitle("");
      expect(store().title).toBe("");
    });
  });

  describe("contributors", () => {
    it("returns the new id, and null for a name with nothing to parse", () => {
      const id = store().addAuthor("Jane Smith");
      expect(id).toBeTruthy();
      expect(store().authors[0]?.name).toBe("Jane Smith");
      expect(store().addAuthor("   ")).toBeNull();
      expect(store().authors).toHaveLength(1);
    });

    it("keeps an ORCID iD given alongside the name", () => {
      store().addAuthor("Jane Smith", "0000-0002-1825-0097");
      expect(store().authors[0]?.orcid).toBe("0000-0002-1825-0097");
    });

    it("seeds the sample with the translated names it is given, one role set each", () => {
      store().loadSample(["Marie Curie", "Ada Lovelace", "Rosalind Franklin", "Dropped Name"]);

      const authors = store().authors;
      // Three positional role sets: a fourth name has no scores to seed, so it
      // would land as an empty row rather than an example.
      expect(authors.map((a) => a.name)).toEqual(["Marie Curie", "Ada Lovelace", "Rosalind Franklin"]);
      expect(authors[0]?.contributions.find((c) => c.role === "Conceptualization")?.score).toBe(100);
      expect(authors[1]?.contributions.find((c) => c.role === "Investigation")?.score).toBe(100);
      expect(authors[2]?.contributions.find((c) => c.role === "Conceptualization")?.score).toBe(0);
      // Graded scores deserve the graded view: the sample switches to Levels.
      expect(store().inputMode).toBe("levels");
    });

    it("refuses the sample under a claim, like every other whole-roster write", () => {
      store().addAuthor("Jane Smith");
      const jane = store().authors[0];
      if (!jane) throw new Error("expected an author");
      store().setClaim({ contributorId: jane.id, sourceDraftId: "src-1" });

      store().loadSample(["Marie Curie"]);
      expect(store().authors.map((a) => a.name)).toEqual(["Jane Smith"]);
    });

    it("rejects a load of more contributors than a draft can hold", () => {
      const authors = Array.from({ length: 201 }, (_, i) => createAuthor(`Author ${i}`));
      expect(() => store().loadAuthors(authors)).toThrow(/at most/);
    });
  });

  describe("markers", () => {
    it("toggles each marker independently", () => {
      const id = store().addAuthor("Jane Smith");
      if (!id) throw new Error("expected an author");

      store().setAuthorMarker(id, "equalContribution", true);
      expect(store().authors[0]?.equalContribution).toBe(true);
      expect(store().authors[0]?.corresponding).toBe(false);

      store().setAuthorMarker(id, "corresponding", true);
      store().setAuthorMarker(id, "equalContribution", false);
      expect(store().authors[0]?.equalContribution).toBe(false);
      expect(store().authors[0]?.corresponding).toBe(true);
    });

    it("keeps the markers through an unrelated edit", () => {
      // Every mutation rebuilds the list through `normalizeAuthors`; a field it
      // forgets to carry is silently lost on the next keystroke.
      const id = store().addAuthor("Jane Smith");
      if (!id) throw new Error("expected an author");
      store().setAuthorMarker(id, "corresponding", true);

      store().addAuthor("Bob White");
      store().updateAuthorName(id, "Jane A. Smith");

      expect(store().authors[0]?.corresponding).toBe(true);
    });

    it("ignores a marker set on an unknown contributor", () => {
      store().addAuthor("Jane Smith");
      expect(() => store().setAuthorMarker("no-such-id", "corresponding", true)).not.toThrow();
      expect(store().authors[0]?.corresponding).toBe(false);
    });
  });

  describe("contributor edits", () => {
    /** Two contributors, in list order, with their ids. */
    function pair() {
      store().addAuthor("Jane Smith");
      store().addAuthor("Bob White");
      const [jane, bob] = store().authors;
      if (!(jane && bob)) throw new Error("expected two authors");
      return { jane, bob };
    }

    it("refuses a name with no letter in it, at add and at rename alike", () => {
      const { jane } = pair();
      expect(store().addAuthor("123")).toBeNull();
      expect(store().authors).toHaveLength(2);
      expect(store().updateAuthorName(jane.id, "123")).toBe(false);
      expect(store().authors[0]?.name).toBe("Jane Smith");
    });

    it("renames in place, keeping the id and everything hanging off it", () => {
      const { jane } = pair();
      store().setAuthorMarker(jane.id, "corresponding", true);
      store().setAuthorScore(jane.id, 0, 66);

      expect(store().updateAuthorName(jane.id, "  Jane A. Smith  ")).toBe(true);
      const renamed = store().authors[0];
      expect(renamed?.id).toBe(jane.id);
      expect(renamed?.name).toBe("Jane A. Smith");
      expect(renamed?.corresponding).toBe(true);
      expect(renamed?.contributions[0]?.score).toBe(66);

      // An empty rename is a cleared input, not a request to blank the row.
      expect(store().updateAuthorName(jane.id, "   ")).toBe(false);
      expect(store().updateAuthorName("no-such-id", "Ghost Author")).toBe(false);
      expect(store().authors[0]?.name).toBe("Jane A. Smith");
    });

    it("takes a valid ORCID iD, normalizes it, and clears it on an empty value", () => {
      const { jane } = pair();

      store().updateAuthorOrcid(jane.id, " https://orcid.org/0000-0002-1825-0097 ");
      expect(store().authors[0]?.orcid).toBe("0000-0002-1825-0097");

      // An unvalidated iD here would make the next list edit throw in the reducer.
      store().updateAuthorOrcid(jane.id, "0000-0002-1825-0098");
      expect(store().authors[0]?.orcid).toBe("0000-0002-1825-0097");

      store().updateAuthorOrcid(jane.id, "  ");
      expect(store().authors[0]?.orcid).toBeUndefined();
      expect(() => store().updateAuthorOrcid("no-such-id", "0000-0002-1825-0097")).not.toThrow();
    });

    it("marks a contributor as acknowledged rather than an author, and ignores an unknown row", () => {
      const { jane } = pair();
      store().setAuthorType(jane.id, "non-author");
      expect(store().authors[0]?.contributorType).toBe("non-author");
      expect(() => store().setAuthorType("no-such-id", "non-author")).not.toThrow();
    });

    it("removes a contributor and restores it at the index undo asks for", () => {
      const { jane, bob } = pair();
      store().addAuthor("Carol Davis");

      store().removeAuthor(bob.id);
      expect(store().authors.map((a) => a.name)).toEqual(["Jane Smith", "Carol Davis"]);
      store().removeAuthor("no-such-id");
      expect(store().authors).toHaveLength(2);

      expect(store().restoreAuthor(bob, 1)).toBe(true);
      expect(store().authors.map((a) => a.name)).toEqual(["Jane Smith", "Bob White", "Carol Davis"]);
      // Already back: a double undo must not duplicate the row.
      expect(store().restoreAuthor(bob, 1)).toBe(false);
      expect(store().authors).toHaveLength(3);
      expect(store().authors.map((a) => a.id)).toContain(jane.id);
    });

    it("clamps a restore index that no longer exists onto the list", () => {
      const { bob } = pair();
      store().removeAuthor(bob.id);

      expect(store().restoreAuthor(bob, 99)).toBe(true);
      expect(store().authors.map((a) => a.name)).toEqual(["Jane Smith", "Bob White"]);
    });

    it("refuses a restore into a list that refilled to the cap", () => {
      const spare = createAuthor("Spare Author");
      store().loadAuthors(Array.from({ length: 200 }, (_, i) => createAuthor(`Author ${i}`)));

      // Without the guard the splice pushes past the cap and the reducer throws.
      expect(store().restoreAuthor(spare, 0)).toBe(false);
      expect(store().authors).toHaveLength(200);
      expect(store().addAuthor("One Too Many")).toBeNull();
    });

    it("reorders by index and ignores a drag that lands nowhere", () => {
      pair();
      store().addAuthor("Carol Davis");

      store().moveAuthor(0, 2);
      expect(store().authors.map((a) => a.name)).toEqual(["Bob White", "Carol Davis", "Jane Smith"]);

      for (const [from, to] of [
        [-1, 0],
        [0, -1],
        [3, 0],
        [0, 3],
        [1, 1],
      ]) {
        store().moveAuthor(from ?? 0, to ?? 0);
      }
      expect(store().authors.map((a) => a.name)).toEqual(["Bob White", "Carol Davis", "Jane Smith"]);
    });

    it("re-derives initials on every list edit, so two J. Smiths stay distinct", () => {
      store().addAuthor("Jane Smith");
      store().addAuthor("John Smith");
      const [jane, john] = store().authors;
      expect(jane?.initials).not.toBe(john?.initials);
    });
  });

  describe("scores", () => {
    function jane() {
      const author = store().authors[0];
      if (!author) throw new Error("expected an author");
      return author;
    }

    beforeEach(() => {
      store().addAuthor("Jane Smith");
      store().addAuthor("Bob White");
    });

    it("clamps a score to the 0-100 range rather than storing it out of band", () => {
      store().setAuthorScore(jane().id, 0, 500);
      expect(jane().contributions[0]?.score).toBe(100);
      store().setAuthorScore(jane().id, 0, -20);
      expect(jane().contributions[0]?.score).toBe(0);
    });

    it("ignores a score set on a role or contributor that is not there", () => {
      store().setAuthorScore(jane().id, 99, 100);
      store().setAuthorScore("no-such-id", 0, 100);
      expect(jane().contributions.every((c) => c.score === 0)).toBe(true);
    });

    it("fills or clears a whole row at once", () => {
      store().setAllAuthorScores(jane().id, 66);
      expect(jane().contributions.every((c) => c.score === 66)).toBe(true);
      store().setAllAuthorScores(jane().id, 0);
      expect(jane().contributions.every((c) => c.score === 0)).toBe(true);
      expect(() => store().setAllAuthorScores("no-such-id", 100)).not.toThrow();
    });

    it("fills a whole column at once, and refuses a column that is not there", () => {
      store().setRoleScores(0, 150);
      expect(store().authors.map((a) => a.contributions[0]?.score)).toEqual([100, 100]);

      store().setRoleScores(-1, 100);
      store().setRoleScores(ROLE_NAMES.length, 100);
      expect(store().authors.map((a) => a.contributions[1]?.score)).toEqual([0, 0]);
    });

    it("toggles between none and full, whatever the level was", () => {
      store().toggleContribution(jane().id, 0);
      expect(jane().contributions[0]?.score).toBe(100);
      store().toggleContribution(jane().id, 0);
      expect(jane().contributions[0]?.score).toBe(0);

      store().setAuthorScore(jane().id, 0, 33);
      store().toggleContribution(jane().id, 0);
      expect(jane().contributions[0]?.score).toBe(0);

      expect(() => store().toggleContribution(jane().id, 99)).not.toThrow();
    });
  });

  describe("preferences", () => {
    it("keeps the input mode and heatmap colour as draft data", () => {
      store().setInputMode("levels");
      store().setHeatmapMonoColor("#123456");
      expect(store().inputMode).toBe("levels");
      expect(store().heatmapMonoColor).toBe("#123456");

      store().reset();
      expect(store().inputMode).toBe("toggle");
      expect(store().heatmapMonoColor).not.toBe("#123456");
    });

    it("normalizes both language choices, and keeps them independent", () => {
      store().setOutputLocale("pt" as LocaleCode);
      store().setUiLocale("zh" as LocaleCode);
      expect(store().outputLocale).toBe("pt-PT");
      expect(store().uiLocale).toBe("zh-Hans");

      store().setOutputLocale("xx" as LocaleCode);
      expect(store().outputLocale).toBe("en");
      expect(store().uiLocale).toBe("zh-Hans");

      // The interface language belongs to the person, not the paper.
      store().reset();
      expect(store().uiLocale).toBe("zh-Hans");
    });

    it("marks the welcome seen whether it is opened or dismissed", () => {
      expect(store().welcomeSeen).toBe(false);
      store().openWelcome();
      expect(store().welcomeOpen).toBe(true);
      expect(store().welcomeSeen).toBe(true);

      store().closeWelcome();
      expect(store().welcomeOpen).toBe(false);
      expect(store().welcomeSeen).toBe(true);
    });

    it("dismisses an open welcome card on reset, so it cannot undo the reset", () => {
      store().openWelcome();
      store().reset();
      expect(store().welcomeOpen).toBe(false);
      expect(store().welcomeSeen).toBe(true);
    });
  });

  describe("drafts", () => {
    it("starts with one active draft", () => {
      expect(store().activeDraftId).toBeTruthy();
    });

    it("parks the current work when switching away, and restores it coming back", () => {
      const first = store().activeDraftId;
      store().addAuthor("Jane Smith");
      store().setTitle("First paper");
      store().setHeatmapMonoColor("#123456");

      const second = store().createDraft();
      if (!second) throw new Error("expected a new draft");
      expect(store().authors).toHaveLength(0);
      expect(store().title).toBe("");

      store().addAuthor("Bob White");
      store().switchDraft(first);

      expect(store().title).toBe("First paper");
      expect(store().authors[0]?.name).toBe("Jane Smith");
      // Output settings travel with the draft; the interface language does not.
      expect(store().heatmapMonoColor).toBe("#123456");

      store().switchDraft(second);
      expect(store().authors[0]?.name).toBe("Bob White");
    });

    it("leaves the interface language alone across a switch", () => {
      store().setUiLocale("nl");
      const second = store().createDraft();
      if (!second) throw new Error("expected a new draft");
      expect(store().uiLocale).toBe("nl");
    });

    it("renames the live draft and an inactive one alike", () => {
      const first = store().activeDraftId;
      const second = store().createDraft();
      if (!second) throw new Error("expected a new draft");

      store().renameDraft(second, "  Second paper  ");
      store().renameDraft(first, "First paper");

      expect(store().title).toBe("Second paper");
      store().switchDraft(first);
      expect(store().title).toBe("First paper");
    });

    it("duplicates a draft with fresh contributor ids", () => {
      store().addAuthor("Jane Smith");
      store().setTitle("Original");
      const source = store().activeDraftId;

      const copy = store().duplicateDraft(source);
      if (!copy) throw new Error("expected a copy");
      // A duplicate is made in the background: you keep working where you were.
      expect(store().activeDraftId).toBe(source);

      store().switchDraft(copy);
      expect(store().title).toBe("Original");
      expect(store().authors[0]?.name).toBe("Jane Smith");
      // Two drafts sharing a contributor id would make every lookup ambiguous.
      store().switchDraft(source);
      const originalId = store().authors[0]?.id;
      store().switchDraft(copy);
      expect(store().authors[0]?.id).not.toBe(originalId);
    });

    it("lands on the most recent survivor when the active draft is deleted", () => {
      const first = store().activeDraftId;
      store().setTitle("First paper");
      const second = store().createDraft();
      if (!second) throw new Error("expected a new draft");
      store().setTitle("Second paper");

      store().deleteDraft(second);

      expect(store().activeDraftId).toBe(first);
      expect(store().title).toBe("First paper");
    });

    it("always leaves one draft behind, even deleting the last", () => {
      const only = store().activeDraftId;
      store().addAuthor("Jane Smith");

      store().deleteDraft(only);

      expect(store().activeDraftId).toBeTruthy();
      expect(store().authors).toHaveLength(0);
      expect(Object.keys(store().drafts)).toHaveLength(1);
    });

    it("deleting an inactive draft leaves the workspace alone", () => {
      store().setTitle("Keep me");
      const active = store().activeDraftId;
      const other = store().createDraft();
      if (!other) throw new Error("expected a new draft");
      store().switchDraft(active);

      store().deleteDraft(other);

      expect(store().activeDraftId).toBe(active);
      expect(store().title).toBe("Keep me");
    });

    it("refuses to go past the cap rather than failing to save", () => {
      for (let i = 1; i < MAX_DRAFTS; i += 1) {
        expect(store().createDraft()).toBeTruthy();
      }
      expect(Object.keys(store().drafts)).toHaveLength(MAX_DRAFTS);
      expect(store().createDraft()).toBeNull();
      expect(store().duplicateDraft(store().activeDraftId)).toBeNull();
    });

    it("empties the draft you are in without touching the others", () => {
      store().addAuthor("Jane Smith");
      store().setTitle("First paper");
      const first = store().activeDraftId;
      const second = store().createDraft();
      if (!second) throw new Error("expected a new draft");
      store().addAuthor("Bob White");

      store().reset();

      expect(store().authors).toHaveLength(0);
      store().switchDraft(first);
      expect(store().authors[0]?.name).toBe("Jane Smith");
    });
  });

  describe("claim lock", () => {
    it("persists the claim on the draft across a switch and back", () => {
      store().addAuthor("Jane Smith");
      const jane = store().authors[0];
      if (!jane) throw new Error("expected an author");
      const home = store().activeDraftId;
      store().setClaim({ contributorId: jane.id, sourceDraftId: "src-1" });
      store().createDraft();
      expect(store().claim).toBeNull();
      store().switchDraft(home);
      expect(store().claim).toEqual({ contributorId: jane.id, sourceDraftId: "src-1" });
    });

    it("locks every row but the claimed one, and the list shape entirely", () => {
      store().addAuthor("Jane Smith");
      store().addAuthor("Bob White");
      const [jane, bob] = store().authors;
      if (!(jane && bob)) throw new Error("expected two authors");
      store().setClaim({ contributorId: bob.id, sourceDraftId: "src-1" });

      store().toggleContribution(jane.id, 0);
      expect(store().authors[0]?.contributions[0]?.score).toBe(0);
      store().toggleContribution(bob.id, 0);
      expect(store().authors[1]?.contributions[0]?.score).toBe(100);

      expect(store().addAuthor("Carol Davis")).toBeNull();
      store().removeAuthor(jane.id);
      store().moveAuthor(0, 1);
      expect(store().authors.map((a) => a.name)).toEqual(["Jane Smith", "Bob White"]);
      expect(store().updateAuthorName(jane.id, "Renamed")).toBe(false);
      expect(store().updateAuthorName(bob.id, "Bob B. White")).toBe(true);
    });

    it("refuses a whole-roster load, so a late import cannot overwrite a claim", () => {
      store().addAuthor("Jane Smith");
      const jane = store().authors[0];
      if (!jane) throw new Error("expected an author");
      const replacement = [createAuthor("Bob White")];

      store().loadAuthors(replacement);
      expect(store().authors.map((a) => a.name)).toEqual(["Bob White"]);

      store().setClaim({ contributorId: store().authors[0]?.id ?? "", sourceDraftId: "src-1" });
      store().loadAuthors([createAuthor("Carol Davis")]);
      expect(store().authors.map((a) => a.name)).toEqual(["Bob White"]);
    });

    it("clearClaimFor reaches a draft you are not looking at", () => {
      store().addAuthor("Jane Smith");
      const jane = store().authors[0];
      if (!jane) throw new Error("expected an author");
      store().setClaim({ contributorId: jane.id, sourceDraftId: "src-1" });
      const claimed = store().activeDraftId;

      store().createDraft();
      store().clearClaimFor(claimed);
      expect(() => store().clearClaimFor("no-such-draft")).not.toThrow();

      store().switchDraft(claimed);
      expect(store().claim).toBeNull();
    });

    it("ends the reply highlight on the way out of the draft it belongs to", () => {
      store().addAuthor("Jane Smith");
      const jane = store().authors[0];
      if (!jane) throw new Error("expected an author");
      const home = store().activeDraftId;
      store().setRecentReply(jane.id);
      expect(store().recentReply).toBe(jane.id);

      // The highlight describes a moment, not the draft.
      store().createDraft();
      expect(store().recentReply).toBeNull();
      store().switchDraft(home);
      expect(store().recentReply).toBeNull();
    });

    it("clearClaimFor unlocks the active draft", () => {
      store().addAuthor("Jane Smith");
      const jane = store().authors[0];
      if (!jane) throw new Error("expected an author");
      store().setClaim({ contributorId: jane.id, sourceDraftId: "src-1" });
      store().clearClaimFor(store().activeDraftId);
      expect(store().claim).toBeNull();
      expect(store().addAuthor("Bob White")).not.toBeNull();
    });
  });

  describe("asked tracking", () => {
    it("marks per draft, survives a switch away and back, and clears", () => {
      store().addAuthor("Jane Smith");
      const jane = store().authors[0];
      if (!jane) throw new Error("expected Jane");
      store().markAsked(jane.id);
      expect(store().asked[jane.id]).toBeTypeOf("number");

      const home = store().activeDraftId;
      store().createDraft();
      // A fresh draft has no open asks of its own.
      expect(store().asked).toEqual({});
      store().switchDraft(home);
      expect(store().asked[jane.id]).toBeTypeOf("number");

      store().clearAsked(jane.id);
      expect(store().asked[jane.id]).toBeUndefined();
    });
  });

  describe("first-draft id", () => {
    it("replaces the SSR-constant draft-1 id with a UUID at hydration", async () => {
      await useContributionStore.persist.rehydrate();
      expect(store().activeDraftId).not.toBe("draft-1");
    });
  });

  describe("persistence", () => {
    it("persists draft data and the interface language, but nothing ephemeral", () => {
      // `welcomeOpen` is deliberately absent: a re-opened "How it works" must
      // not survive a reload as a fake first run.
      const options = useContributionStore.persist.getOptions();
      const persisted = options.partialize?.(store()) ?? {};
      // Storage sees the normalized shape: drafts in one map, plus the two
      // preferences that belong to the person rather than to any paper.
      expect(Object.keys(persisted).sort()).toEqual(["activeDraftId", "drafts", "uiLocale", "welcomeSeen"]);
    });

    it("normalizes legacy Portuguese and Chinese locale aliases on load", () => {
      // Owned by the repair pass in `merge`, which runs on every load, not by
      // a migration step: a version bump is not required for a legacy alias.
      const options = useContributionStore.persist.getOptions();
      expect(
        options.merge?.(
          {
            uiLocale: "pt",
            activeDraftId: "paper",
            drafts: { paper: { outputLocale: "zh" } },
          },
          store(),
        ),
      ).toMatchObject({
        uiLocale: "pt-PT",
        drafts: { paper: { outputLocale: "zh-Hans" } },
      });
    });

    it("discards a draft from a newer version rather than guessing", () => {
      // A rolled-back deploy or a second tab on an older bundle. There is no
      // way to walk a schema backwards, so a fresh start beats a half-read one.
      const migrate = useContributionStore.persist.getOptions().migrate;
      expect(migrate?.({ title: "from the future" }, 99)).toEqual({});
    });

    it("discards a persisted value that is not an object", () => {
      const migrate = useContributionStore.persist.getOptions().migrate;
      expect(migrate?.(null, 0)).toEqual({});
      expect(migrate?.("corrupted", 0)).toEqual({});
    });

    /**
     * Repair runs on every load, not only on a version change: a draft can be
     * malformed while its version is current (hand-edited storage, a
     * half-written value from a crashed tab). `normalizeAuthors` throws on a
     * contributor it cannot rebuild and runs on every list edit, so one bad row
     * would make add/remove/rename all throw uncaught.
     */
    it("says so once when the browser refuses to save", () => {
      const storage = useContributionStore.persist.getOptions().storage;
      if (!storage) throw new Error("expected a storage adapter");
      // Writes are refused before the restore lands; this is about the ones
      // after it, where a full quota is the realistic failure.
      const hydrated = vi.spyOn(useContributionStore.persist, "hasHydrated").mockReturnValue(true);
      // Spy where setItem lives: jsdom's Storage.prototype, or the instance
      // when src/test-setup.ts swapped in its plain in-memory stand-in. A spy
      // on a jsdom Storage instance is stored as an item and never called.
      const ls = globalThis.localStorage;
      const owner = Object.hasOwn(ls, "setItem") ? ls : (Object.getPrototypeOf(ls) as Storage);
      const full = vi.spyOn(owner, "setItem").mockImplementation(() => {
        throw new DOMException("QuotaExceededError");
      });

      const state = { drafts: {}, activeDraftId: "a", uiLocale: "en" as const, welcomeSeen: true };
      storage.setItem("credit-generator-state", { state, version: 1 });
      storage.setItem("credit-generator-state", { state, version: 1 });

      // Once per run of failures, not once per keystroke.
      expect(requestStorageFullAnnouncement).toHaveBeenCalledTimes(1);
      full.mockRestore();
      hydrated.mockRestore();
    });

    it("survives a normalize/denormalize round trip", () => {
      // The one contract that matters here: what partialize writes, merge must
      // read back as the same live workspace.
      const options = useContributionStore.persist.getOptions();
      store().addAuthor("Jane Smith");
      store().setTitle("First paper");
      const other = store().createDraft();
      if (!other) throw new Error("expected a new draft");
      store().setTitle("Second paper");

      const written = JSON.parse(JSON.stringify(options.partialize?.(store())));
      const restored = options.merge?.(written, initial) as typeof initial;

      expect(restored.title).toBe("Second paper");
      expect(Object.keys(restored.drafts)).toHaveLength(2);
      expect(
        Object.values(restored.drafts)
          .map((draft) => draft.title)
          .sort(),
      ).toEqual(["First paper", "Second paper"]);
    });

    it("falls back to one empty draft when storage holds none", () => {
      const merge = useContributionStore.persist.getOptions().merge;
      const merged = merge?.({ uiLocale: "nl" }, initial) as typeof initial;
      expect(Object.keys(merged.drafts)).toHaveLength(1);
      expect(merged.activeDraftId).toBeTruthy();
      expect(merged.authors).toHaveLength(0);
      expect(merged.uiLocale).toBe("nl");
    });

    it("drops contributors that would throw on the next edit", () => {
      const merge = useContributionStore.persist.getOptions().merge;
      const good = createAuthor("Jane A. Smith");
      const merged = merge?.(
        {
          activeDraftId: "d1",
          drafts: { d1: { authors: [{ ...good, name: "A".repeat(600) }, { ...good, name: "12345" }, good] } },
        },
        initial,
      ) as { authors: { name: string }[] };

      expect(merged.authors.map((a) => a.name)).toEqual(["Jane A. Smith"]);
    });

    it("clears an unreadable persisted value rather than failing hydration forever", () => {
      // A truncated write from a crashed tab. Left in place, zustand's
      // JSON.parse would reject hydration on every visit: hasHydrated never
      // flips, the inputs stay readOnly, and the write guard drops every save.
      const storage = useContributionStore.persist.getOptions().storage;
      if (!storage) throw new Error("expected a storage adapter");
      globalThis.localStorage.setItem("credit-generator-state", "{truncated");

      expect(storage.getItem("credit-generator-state")).toBeNull();
      // Removed, not just skipped: the next save must not sit behind it.
      expect(globalThis.localStorage.getItem("credit-generator-state")).toBeNull();
    });

    it("drops a malformed iD or contributions list, not the contributor", () => {
      // createAuthor throws on a bad ORCID and iterates contributions, and it
      // runs inside the reducer on every list edit: a field that would throw
      // there must cost the field, never the workspace.
      const merge = useContributionStore.persist.getOptions().merge;
      const good = createAuthor("Jane A. Smith");
      const merged = merge?.(
        {
          activeDraftId: "d1",
          drafts: {
            d1: {
              authors: [
                { ...good, orcid: "not-an-orcid" },
                { ...createAuthor("Bob White"), contributions: "corrupt" },
                { ...createAuthor("Carol Davis"), contributions: [null, { role: "Software", score: 100 }] },
              ],
            },
          },
        },
        initial,
      ) as typeof initial;

      expect(merged.authors.map((a) => a.name)).toEqual(["Jane A. Smith", "Bob White", "Carol Davis"]);
      expect(merged.authors[0]?.orcid).toBeUndefined();
      expect(merged.authors[1]?.contributions).toEqual([]);
      expect(merged.authors[2]?.contributions).toEqual([{ role: "Software", score: 100 }]);
    });

    it("drops a hand-edited claim or ask entry rather than trusting it", () => {
      const merge = useContributionStore.persist.getOptions().merge;
      const merged = merge?.(
        {
          activeDraftId: "d1",
          drafts: {
            d1: {
              // A claim is a lock: an id that a URL fragment would mangle, or a
              // half-written one, must not be honoured.
              claim: { contributorId: "not a valid id", sourceDraftId: "src-1" },
              asked: { "bad id": 1, "good-id": 2, "another-good-id": "yesterday" },
            },
          },
        },
        initial,
      ) as typeof initial;

      expect(merged.claim).toBeNull();
      expect(merged.asked).toEqual({ "good-id": 2 });
    });

    it("keeps a well-formed claim through the repair pass", () => {
      const merge = useContributionStore.persist.getOptions().merge;
      const claim = { contributorId: "contributor-1", sourceDraftId: "draft-2" };
      const merged = merge?.({ activeDraftId: "d1", drafts: { d1: { claim } } }, initial) as typeof initial;
      expect(merged.claim).toEqual(claim);
    });

    it("parks each held draft in its own key, and reads the shelf back as one map", () => {
      const storage = useContributionStore.persist.getOptions().storage;
      if (!storage) throw new Error("expected a storage adapter");
      const hydrated = vi.spyOn(useContributionStore.persist, "hasHydrated").mockReturnValue(true);
      globalThis.localStorage.clear();

      const draft = (id: string, title: string): Draft => ({
        id,
        title,
        authors: [],
        inputMode: "toggle",
        heatmapMonoColor: "#2563eb",
        outputLocale: "en",
        updatedAt: 0,
        claim: null,
        asked: {},
      });
      const state = {
        drafts: { a: draft("a", "Active paper"), b: draft("b", "Held paper") },
        activeDraftId: "a",
        uiLocale: "en" as const,
        welcomeSeen: true,
      };
      storage.setItem(PERSIST_KEY, { state, version: PERSIST_VERSION });

      // The active draft rides in the main key; only the shelf gets its own,
      // so a grid click does not re-serialize every held paper.
      expect(globalThis.localStorage.getItem(`${PERSIST_KEY}:draft:a`)).toBeNull();
      expect(globalThis.localStorage.getItem(`${PERSIST_KEY}:draft:b`)).toContain("Held paper");

      const read = storage.getItem(PERSIST_KEY) as { state: typeof state } | null;
      expect(Object.keys(read?.state.drafts ?? {}).sort()).toEqual(["a", "b"]);
      expect(read?.state.drafts.b?.title).toBe("Held paper");

      // A deleted draft's key would otherwise resurrect it on the next load.
      storage.setItem(PERSIST_KEY, { state: { ...state, drafts: { a: state.drafts.a } }, version: PERSIST_VERSION });
      expect(globalThis.localStorage.getItem(`${PERSIST_KEY}:draft:b`)).toBeNull();

      storage.removeItem(PERSIST_KEY);
      expect(storage.getItem(PERSIST_KEY)).toBeNull();
      hydrated.mockRestore();
      globalThis.localStorage.clear();
    });

    it("keeps drafts another tab created or parked when this tab writes", () => {
      // Two tabs are two storage adapters over one localStorage.
      const tabA = announcingStorage();
      const tabB = announcingStorage();
      const hydrated = vi.spyOn(useContributionStore.persist, "hasHydrated").mockReturnValue(true);
      globalThis.localStorage.clear();

      const draft = (id: string, title: string): Draft => ({
        id,
        title,
        authors: [],
        inputMode: "toggle",
        heatmapMonoColor: "#2563eb",
        outputLocale: "en",
        updatedAt: 0,
        claim: null,
        asked: {},
      });
      const write = (tab: typeof tabA, active: string, drafts: Draft[]) =>
        tab.setItem(PERSIST_KEY, {
          state: {
            drafts: Object.fromEntries(drafts.map((d) => [d.id, d])),
            activeDraftId: active,
            uiLocale: "en",
            welcomeSeen: true,
          },
          version: PERSIST_VERSION,
        });
      const storedTitles = () => {
        const read = announcingStorage().getItem(PERSIST_KEY) as { state: { drafts: Record<string, Draft> } } | null;
        return Object.values(read?.state.drafts ?? {})
          .map((d) => d.title)
          .sort();
      };

      const p = draft("p", "Shared paper");
      write(tabA, "p", [p]);
      tabA.getItem(PERSIST_KEY);
      tabB.getItem(PERSIST_KEY);

      // Tab A starts a new paper, which lives only in the main key...
      write(tabA, "x", [p, draft("x", "Paper from A")]);
      // ...until tab B saves an edit to its own active draft.
      write(tabB, "p", [draft("p", "Shared paper, edited")]);
      expect(storedTitles()).toEqual(["Paper from A", "Shared paper, edited"]);

      // Tab A parks its paper; tab B's next save must not delete that key.
      write(tabA, "y", [p, draft("x", "Paper from A"), draft("y", "Third paper")]);
      write(tabB, "p", [draft("p", "Shared paper, edited again")]);
      expect(storedTitles()).toEqual(["Paper from A", "Shared paper, edited again", "Third paper"]);

      // A draft this tab deletes is still removed.
      write(tabA, "y", [p, draft("y", "Third paper")]);
      expect(globalThis.localStorage.getItem(`${PERSIST_KEY}:draft:x`)).toBeNull();

      hydrated.mockRestore();
      globalThis.localStorage.clear();
    });

    it("loads an old single-key value, from before the shelf was split out", () => {
      const storage = useContributionStore.persist.getOptions().storage;
      if (!storage) throw new Error("expected a storage adapter");
      globalThis.localStorage.clear();
      globalThis.localStorage.setItem(
        PERSIST_KEY,
        JSON.stringify({
          state: { activeDraftId: "d1", drafts: { d1: { id: "d1", title: "One key" } } },
          version: PERSIST_VERSION,
        }),
      );

      const read = storage.getItem(PERSIST_KEY) as { state: { drafts: Record<string, { title: string }> } } | null;
      expect(read?.state.drafts.d1?.title).toBe("One key");
      globalThis.localStorage.clear();
    });

    it("leaves a persisted draft alone when nothing is wrong with it", () => {
      const merge = useContributionStore.persist.getOptions().merge;
      const authors = [createAuthor("Jane A. Smith"), createAuthor("Bob White")];
      const merged = merge?.({ activeDraftId: "d1", drafts: { d1: { authors } } }, initial) as {
        authors: { name: string }[];
      };
      expect(merged.authors.map((a) => a.name)).toEqual(["Jane A. Smith", "Bob White"]);
    });
  });
});
