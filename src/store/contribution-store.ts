import type { Author, CreditRoleName, LocaleCode } from "@credit-generator/core";
import {
  CREDIT_ROLES,
  clampScore,
  createAuthor,
  DEFAULT_MONO_COLOR,
  deduplicateAuthorInitials,
  isUsableAuthorName,
  isValidOrcid,
  MAX_AUTHOR_NAME_LENGTH,
  MAX_AUTHORS,
  normalizeLocaleCode,
  normalizeOrcid,
} from "@credit-generator/core";
import { create } from "zustand";
import { type PersistStorage, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { requestStorageFullAnnouncement } from "@/lib/announce";
import { PERSIST_KEY, PERSIST_VERSION } from "./persist-meta";

export type InputMode = "toggle" | "levels";

/** A claim link's target: which contributor, on which draft it came from. */
export interface DraftClaim {
  contributorId: string;
  sourceDraftId: string;
}

/**
 * One paper's worth of work.
 *
 * Everything describing *this paper* lives here; everything describing *this
 * person's preferences* (interface language, whether the welcome has been seen)
 * stays outside it, so switching drafts never changes the interface.
 */
export interface Draft {
  id: string;
  title: string;
  authors: Author[];
  inputMode: InputMode;
  heatmapMonoColor: string;
  outputLocale: LocaleCode;
  /** Last write, in epoch milliseconds. Orders the picker. */
  updatedAt: number;
  /**
   * Set when this draft was opened from a link addressed to one contributor.
   * Travels with the draft (persisted), so the lock survives a switch away
   * and back, unlike the old ephemeral claim fields it replaces.
   */
  claim: DraftClaim | null;
  /**
   * When each contributor was asked to fill in their own row, by id. An entry
   * appears when their ask link is copied and leaves when their reply merges,
   * so a row can say "Asked" during the days an email round trip takes.
   */
  asked: Record<string, number>;
}

/** More than anyone writes at once, and well inside what localStorage holds. */
export const MAX_DRAFTS = 50;

interface ContributionState {
  authors: Author[];
  /** The work's title, filled by a DOI import. Draft data, so `reset` clears it. */
  title: string;
  inputMode: InputMode;
  heatmapMonoColor: string;
  /** Language for the generated statement + human-facing exports (role names only). */
  outputLocale: LocaleCode;
  /**
   * Language for the app's own interface. Separate from `outputLocale` on
   * purpose: a researcher may want a Dutch interface while submitting an
   * English statement to an English-language journal.
   */
  uiLocale: LocaleCode;
  /** Whether the first-run welcome has ever been shown. Persisted; only ever set
   *  true, so returning users are never auto-greeted again. */
  welcomeSeen: boolean;
  /**
   * Mirrors the active draft's `claim`, like `title` mirrors its title.
   * While set, the lock rule refuses any edit but the claimed contributor's
   * own row (see `claimRefuses`).
   */
  claim: DraftClaim | null;
  /** Ask timestamps for the live draft, by contributor id. See `Draft.asked`. */
  asked: Record<string, number>;
  /**
   * The contributor whose row a just-opened reply filled in, so the status
   * strip's message has a matching mark on the row itself. Ephemeral: the
   * strip owns its lifetime (its onDismiss clears it however the strip
   * leaves), and a draft switch clears it too.
   */
  recentReply: string | null;
  /** Whether the welcome card is currently open. Ephemeral (not persisted), so a
   *  "How it works" re-open never survives a reload as a fake first run. */
  welcomeOpen: boolean;
  /**
   * Every draft *except* the live one, which is held in the top-level fields
   * above so no component has to reach through a map to read its authors.
   * Storage sees the normalized form: `partialize` folds the live fields back
   * into this map on the way out, and `merge` unpacks the active one on the
   * way in.
   */
  drafts: Record<string, Draft>;
  activeDraftId: string;
  loadAuthors: (authors: Author[]) => void;
  setClaim: (claim: DraftClaim | null) => void;
  /** Unlock a draft's claim, active or parked. */
  clearClaimFor: (draftId: string) => void;
  /** Point at (or clear) the row a just-opened reply filled in. */
  setRecentReply: (contributorId: string | null) => void;
  /** Record that this contributor's ask link was copied just now. */
  markAsked: (contributorId: string) => void;
  /** Forget the ask, because the reply landed (or the merge was undone). */
  clearAsked: (contributorId: string) => void;
  setTitle: (title: string) => void;
  /** Start an empty draft and switch to it. Returns its id, or null at the cap. */
  createDraft: () => string | null;
  switchDraft: (draftId: string) => void;
  renameDraft: (draftId: string, title: string) => void;
  /** Copy a draft, contributions and all. Returns the new id, or null at the cap. */
  duplicateDraft: (draftId: string) => string | null;
  deleteDraft: (draftId: string) => void;
  loadSample: (names: readonly string[]) => void;
  /** Adds a contributor and returns its id; null when the name has no letters to parse. */
  addAuthor: (name: string, orcid?: string) => string | null;
  removeAuthor: (authorId: string) => void;
  /** Re-insert a removed contributor. False when the cap or a duplicate id refuses it. */
  restoreAuthor: (author: Author, index: number) => boolean;
  moveAuthor: (fromIndex: number, toIndex: number) => void;
  updateAuthorName: (authorId: string, name: string) => boolean;
  updateAuthorOrcid: (authorId: string, orcid: string) => void;
  setAuthorType: (authorId: string, contributorType: Author["contributorType"]) => void;
  /** Toggle one of the two markers that sit outside the CRediT taxonomy. */
  setAuthorMarker: (authorId: string, marker: "equalContribution" | "corresponding", value: boolean) => void;
  setAuthorScore: (authorId: string, roleIndex: number, score: number) => void;
  setAllAuthorScores: (authorId: string, score: number) => void;
  setRoleScores: (roleIndex: number, score: number) => void;
  toggleContribution: (authorId: string, roleIndex: number) => void;
  setInputMode: (mode: InputMode) => void;
  setHeatmapMonoColor: (color: string) => void;
  setOutputLocale: (locale: LocaleCode) => void;
  setUiLocale: (locale: LocaleCode) => void;
  openWelcome: () => void;
  closeWelcome: () => void;
  reset: () => void;
}

export const ROLE_NAMES = CREDIT_ROLES.map((role) => role.name);

/** Cap on the stored work title. Long enough for any real one, short enough
 *  that a pasted document cannot bloat the persisted draft. */
const MAX_TITLE_LENGTH = 500;

/**
 * A small, realistic dataset for the first-run "Load sample" action.
 *
 * The names come from the caller because they are translated: each interface
 * language seeds the example with scientists from its own language area, and
 * the catalogs are the place translators can change them. The role scores are
 * positional, so extra names beyond the three role sets are dropped rather
 * than seeded with an empty row.
 */
function buildSampleAuthors(names: readonly string[]): Author[] {
  const roleSets: Partial<Record<CreditRoleName, number>>[] = [
    {
      Conceptualization: 100,
      Methodology: 66,
      "Writing – original draft": 100,
      Supervision: 33,
    },
    {
      Investigation: 100,
      "Data curation": 100,
      Software: 66,
      "Formal analysis": 66,
    },
    {
      "Funding acquisition": 100,
      "Project administration": 100,
      "Writing – review & editing": 100,
      Resources: 66,
    },
  ];

  return names.slice(0, roleSets.length).map((name, index) =>
    createAuthor(name, {
      contributions: ROLE_NAMES.map((role) => ({
        role,
        score: roleSets[index]?.[role as CreditRoleName] ?? 0,
      })),
    }),
  );
}

function findAuthorIndex(authors: Author[], authorId: string): number {
  return authors.findIndex((author) => author.id === authorId);
}

function normalizeAuthors(authors: Author[]): Author[] {
  if (authors.length > MAX_AUTHORS) {
    throw new Error(`A draft can contain at most ${MAX_AUTHORS} contributors.`);
  }
  const seenIds = new Set<string>();
  return deduplicateAuthorInitials(
    authors.map((author) => {
      // Ids key every lookup and must survive a share link: an imported
      // duplicate or unshareable id gets a fresh one.
      const id = CLAIM_ID_REGEX.test(author.id) && !seenIds.has(author.id) ? author.id : globalThis.crypto.randomUUID();
      seenIds.add(id);
      return createAuthor(author.name, {
        id,
        orcid: author.orcid,
        contributorType: author.contributorType,
        contributions: author.contributions,
        equalContribution: author.equalContribution,
        corresponding: author.corresponding,
        ...consistentNameParts(author),
      });
    }),
  );
}

/**
 * The stored name parts, while they still describe the name. Re-parsing the
 * name cannot recover a structured import's multi-word surname ("van der
 * Berg"); a rename re-parses, so parts that no longer fit are dropped.
 */
function consistentNameParts(author: Author): Pick<Author, "firstName" | "middleName" | "surname"> | undefined {
  const { name, firstName, middleName, surname } = author;
  if (![firstName, middleName, surname].every((part) => typeof part === "string")) return undefined;
  const fits = name.startsWith(firstName) && name.endsWith(surname) && name.includes(middleName);
  return fits ? { firstName, middleName, surname } : undefined;
}

/** Snapshot the live top-level fields as a draft record. */
function liveDraft(state: ContributionState): Draft {
  return {
    id: state.activeDraftId,
    title: state.title,
    authors: state.authors,
    inputMode: state.inputMode,
    heatmapMonoColor: state.heatmapMonoColor,
    outputLocale: state.outputLocale,
    updatedAt: Date.now(),
    claim: state.claim,
    asked: state.asked,
  };
}

/** Write a draft record into the live top-level fields. */
function applyDraft(state: ContributionState, draft: Draft): void {
  state.activeDraftId = draft.id;
  state.title = draft.title;
  state.authors = draft.authors;
  state.inputMode = draft.inputMode;
  state.heatmapMonoColor = draft.heatmapMonoColor;
  state.outputLocale = draft.outputLocale;
  state.claim = draft.claim;
  state.asked = draft.asked;
  // The highlight describes a moment, not the draft: leaving the draft ends it.
  state.recentReply = null;
}

/** A fresh, empty draft. */
function emptyDraft(title = ""): Draft {
  return {
    id: globalThis.crypto.randomUUID(),
    title,
    authors: [],
    inputMode: "toggle",
    heatmapMonoColor: DEFAULT_MONO_COLOR,
    outputLocale: "en",
    updatedAt: Date.now(),
    claim: null,
    asked: {},
  };
}

/** Park the live draft in the map, so a switch does not lose it. */
function stashLive(state: ContributionState): void {
  state.drafts[state.activeDraftId] = liveDraft(state);
}

/**
 * There are no per-version migration steps: `hydrateDrafts` repairs and
 * normalizes the whole persisted shape on every load anyway (see its doc), so
 * until launch a shape change only needs a version bump to invalidate newer
 * drafts. A draft from a *newer* build may hold fields this one does not
 * understand, and there is no way to walk backwards: start fresh rather than
 * guess. A real migration registry comes back with the first post-launch bump.
 */
function migratePersisted(persisted: unknown, from: number): PersistedState {
  // The cast is a formality for persist's types: `hydrateDrafts` re-checks
  // every field of whatever this returns.
  if (persisted === null || typeof persisted !== "object") return {} as PersistedState;
  return (from > PERSIST_VERSION ? {} : persisted) as PersistedState;
}

/** Drop anything from a draft's contributor list that would make a later edit throw. */
function repairAuthors(authors: unknown): Author[] {
  if (!Array.isArray(authors)) return [];
  return authors
    .filter((author): author is Author => {
      if (author === null || typeof author !== "object") return false;
      const name = (author as { name?: unknown }).name;
      // The exact rule createAuthor enforces; anything else throws on the next
      // list edit rather than at load, which is far harder to diagnose.
      return typeof name === "string" && name.length <= MAX_AUTHOR_NAME_LENGTH && isUsableAuthorName(name);
    })
    .slice(0, MAX_AUTHORS)
    .map((author) => ({
      ...author,
      // Same reasoning as the name check: createAuthor throws on an invalid
      // iD, and normalizeContributions iterates the array and dereferences
      // each entry. A malformed field costs that field, not the workspace.
      orcid: typeof author.orcid === "string" && isValidOrcid(author.orcid) ? author.orcid : undefined,
      contributions: Array.isArray(author.contributions)
        ? author.contributions.filter(
            (c) => c !== null && typeof c === "object" && typeof c.role === "string" && typeof c.score === "number",
          )
        : [],
    }));
}

/** A contributor id or draft id, as they appear in a claim: bounded, and free of anything a URL hash would mangle. */
const CLAIM_ID_REGEX = /^[\w-]{1,64}$/;

function isDraftClaim(value: unknown): value is DraftClaim {
  if (value === null || typeof value !== "object") return false;
  const { contributorId, sourceDraftId } = value as Partial<DraftClaim>;
  return (
    typeof contributorId === "string" &&
    CLAIM_ID_REGEX.test(contributorId) &&
    typeof sourceDraftId === "string" &&
    CLAIM_ID_REGEX.test(sourceDraftId)
  );
}

/** Ask timestamps by contributor id; a malformed entry costs that entry. */
function repairAsked(value: unknown): Record<string, number> {
  if (value === null || typeof value !== "object") return {};
  const asked: Record<string, number> = {};
  for (const [id, at] of Object.entries(value)) {
    if (CLAIM_ID_REGEX.test(id) && typeof at === "number") asked[id] = at;
  }
  return asked;
}

/** Rebuild one persisted draft, filling anything missing or malformed. */
function repairSingleDraft(value: unknown, id: string): Draft {
  const raw = (value !== null && typeof value === "object" ? value : {}) as Partial<Draft>;
  return {
    id,
    title: typeof raw.title === "string" ? raw.title.slice(0, MAX_TITLE_LENGTH) : "",
    authors: repairAuthors(raw.authors),
    inputMode: raw.inputMode === "levels" ? "levels" : "toggle",
    heatmapMonoColor: typeof raw.heatmapMonoColor === "string" ? raw.heatmapMonoColor : DEFAULT_MONO_COLOR,
    outputLocale: normalizeLocaleCode(raw.outputLocale),
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
    claim: isDraftClaim(raw.claim) ? raw.claim : null,
    asked: repairAsked(raw.asked),
  };
}

/**
 * Turn the persisted, normalized shape back into the live one.
 *
 * Repair runs on every load, not just on a version change: a draft can be
 * malformed without its version being wrong — localStorage edited by hand, a
 * half-written value from a crashed tab, or a field this build no longer
 * accepts. `normalizeAuthors` throws on a contributor it cannot rebuild, and it
 * runs inside the reducer for *every* list edit, so one bad row means adding,
 * removing or renaming anything throws uncaught and the workspace is unusable
 * until localStorage is cleared. Dropping the bad rows costs those rows;
 * keeping them costs the app.
 */
function hydrateDrafts(persisted: unknown): Partial<ContributionState> {
  if (persisted === null || typeof persisted !== "object") return {};
  const state = persisted as Record<string, unknown>;

  const rawDrafts = (state.drafts !== null && typeof state.drafts === "object" ? state.drafts : {}) as Record<
    string,
    unknown
  >;
  const drafts: Record<string, Draft> = {};
  for (const [id, value] of Object.entries(rawDrafts)) drafts[id] = repairSingleDraft(value, id);

  // "No active draft" is not a renderable state. Prefer the stored choice, then
  // the most recently touched survivor, then a fresh empty one.
  const storedId = typeof state.activeDraftId === "string" ? state.activeDraftId : "";
  const active = drafts[storedId] ?? Object.values(drafts).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? emptyDraft();
  drafts[active.id] = active;

  return {
    drafts,
    activeDraftId: active.id,
    title: active.title,
    authors: active.authors,
    inputMode: active.inputMode,
    heatmapMonoColor: active.heatmapMonoColor,
    outputLocale: active.outputLocale,
    claim: active.claim,
    asked: active.asked,
    uiLocale: normalizeLocaleCode(state.uiLocale),
    ...(typeof state.welcomeSeen === "boolean" ? { welcomeSeen: state.welcomeSeen } : {}),
  };
}

/** The shape partialize hands to storage. */
interface PersistedState {
  drafts: Record<string, Draft>;
  activeDraftId: string;
  uiLocale: LocaleCode;
  welcomeSeen: boolean;
}

/** Where a parked draft lives: one localStorage key per draft, under the main key's namespace. */
const DRAFT_KEY_PREFIX = `${PERSIST_KEY}:draft:`;

/** Every parked-draft key currently in localStorage. */
function draftKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key?.startsWith(DRAFT_KEY_PREFIX)) keys.push(key);
  }
  return keys;
}

/**
 * localStorage, but a failed write says so — and the shelf is split from the
 * workspace.
 *
 * The main key holds the active draft and the person's preferences; each
 * parked draft has its own `:draft:<id>` key, written only when that draft
 * changes (stash, switch, delete). Persist calls setItem on every store
 * change, so keeping the shelf out of the main key is what stops a single
 * grid click from re-serializing every held paper. Reads merge the two back
 * into the one shape `hydrateDrafts` expects, so an old single-key value (and
 * every test fixture) still loads.
 *
 * A quota error is the realistic failure once several drafts are held, and
 * zustand's default storage swallows it into a console message nobody reads:
 * the app keeps working, the drafts keep growing, and nothing has been saved
 * since some point the user cannot identify. Saying it once, when it happens,
 * is the difference between losing this edit and losing the afternoon.
 */
export function announcingStorage(): PersistStorage<PersistedState> {
  let warned = false;
  // Parked drafts already on disk, by reference. Immer's structural sharing
  // keeps an untouched draft's identity across edits, so a reference match
  // means the stored JSON is current and the write can be skipped.
  const written = new Map<string, Draft>();
  // Draft ids this tab held at its last read or write. Another tab shares the
  // same storage, so an id missing from this tab's drafts is only a deletion
  // when this tab held it before; anything else belongs to the other tab.
  let known = new Set<string>();

  // An unreadable value must not escape as a throw: a parse failure would
  // abort hydration with hasHydrated never set — inputs stay readOnly and the
  // setItem guard below drops every write, on every visit, until the user
  // clears localStorage by hand. A truncated value from a crashed tab is
  // exactly the case hydrateDrafts exists for, but repair only runs on a
  // parsed value. Drop what cannot be read instead — for a parked draft that
  // costs one draft, not the workspace.
  const readJson = (key: string): unknown => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    } catch {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Storage blocked entirely (SecurityError): nothing to clean up.
      }
      return null;
    }
  };

  return {
    // Guarded rather than assumed: this module is imported during the server
    // render, where there is no localStorage at all.
    getItem: (key) => {
      if (typeof window === "undefined") return null;
      const main = readJson(key);
      const parked: Record<string, unknown> = {};
      for (const draftKey of draftKeys()) {
        const draft = readJson(draftKey);
        if (draft !== null) parked[draftKey.slice(DRAFT_KEY_PREFIX.length)] = draft;
      }
      if (main === null && Object.keys(parked).length === 0) return null;
      const record = (main !== null && typeof main === "object" ? main : {}) as Record<string, unknown>;
      const mainState = (record.state !== null && typeof record.state === "object" ? record.state : {}) as Record<
        string,
        unknown
      >;
      const mainDrafts = (
        mainState.drafts !== null && typeof mainState.drafts === "object" ? mainState.drafts : {}
      ) as Record<string, unknown>;
      // Main wins for the active draft; hydrateDrafts repairs whatever merges.
      const state = { ...mainState, drafts: { ...parked, ...mainDrafts } };
      known = new Set(Object.keys(state.drafts));
      return {
        state: state as unknown as PersistedState,
        version: typeof record.version === "number" ? record.version : 0,
      };
    },
    removeItem: (key) => {
      if (typeof window === "undefined") return;
      window.localStorage.removeItem(key);
      for (const draftKey of draftKeys()) window.localStorage.removeItem(draftKey);
      written.clear();
    },
    setItem: (key, value) => {
      if (typeof window === "undefined") return;
      // Never write before the restore has happened. Persist saves on every
      // change, hydrated or not, so a change made in the window between first
      // paint and the rehydrate would save the *empty* initial state over the
      // draft in storage — and the rehydrate that follows would then read that
      // emptied value back. One early keystroke could erase a saved paper.
      if (!useContributionStore.persist.hasHydrated()) return;
      const { drafts, activeDraftId, uiLocale, welcomeSeen } = value.state;
      const deleted = new Set([...known].filter((id) => !(id in drafts)));
      try {
        // The main key may hold another tab's active draft, stored nowhere
        // else: park it before this write replaces the main key. First, so this
        // tab's own changed drafts below still win.
        const main = readJson(key) as { state?: { drafts?: unknown } } | null;
        const mainDrafts = main?.state?.drafts;
        if (mainDrafts !== null && typeof mainDrafts === "object") {
          for (const [id, draft] of Object.entries(mainDrafts)) {
            if (id === activeDraftId || deleted.has(id)) continue;
            window.localStorage.setItem(DRAFT_KEY_PREFIX + id, JSON.stringify(draft));
          }
        }
        for (const [id, draft] of Object.entries(drafts)) {
          if (id === activeDraftId || written.get(id) === draft) continue;
          window.localStorage.setItem(DRAFT_KEY_PREFIX + id, JSON.stringify(draft));
          written.set(id, draft);
        }
        // The active draft lives in the main key, and a deleted draft's key
        // would otherwise resurrect it on the next load.
        for (const id of [activeDraftId, ...deleted]) {
          window.localStorage.removeItem(DRAFT_KEY_PREFIX + id);
          written.delete(id);
        }
        known = new Set(Object.keys(drafts));
        window.localStorage.setItem(
          key,
          JSON.stringify({
            state: { drafts: { [activeDraftId]: drafts[activeDraftId] }, activeDraftId, uiLocale, welcomeSeen },
            version: value.version,
          }),
        );
        warned = false;
      } catch {
        // Every change retries the write; announcing each one would flood
        // the live region. Say it once per run of failures.
        if (warned) return;
        warned = true;
        requestStorageFullAnnouncement();
      }
    },
  };
}

/**
 * The id the very first draft carries before anything is persisted. A constant
 * rather than a fresh uuid, so the server render and the first client render
 * agree (see `skipHydration`).
 */
const INITIAL_DRAFT_ID = "draft-1";

/**
 * While a claim locks the draft, only the claimed contributor's own row may
 * change, and the list shape may not change at all. Enforced here, at the
 * single choke point every edit flows through, so no UI path — grid cell,
 * drag, bulk action, keyboard — can corrupt a claim draft.
 */
function claimRefuses(state: ContributionState, authorId?: string): boolean {
  return state.claim !== null && authorId !== state.claim.contributorId;
}

export const useContributionStore = create<ContributionState>()(
  persist(
    immer((set) => ({
      authors: [],
      title: "",
      // One empty draft always exists: "no active draft" is not a renderable
      // state, so the store never allows it.
      drafts: {},
      activeDraftId: INITIAL_DRAFT_ID,
      inputMode: "toggle",
      heatmapMonoColor: DEFAULT_MONO_COLOR,
      outputLocale: "en",
      uiLocale: "en",
      welcomeSeen: false,
      welcomeOpen: false,
      claim: null,
      asked: {},
      recentReply: null,

      createDraft: () => {
        let created: string | null = null;
        set((state) => {
          // Stash first: only then does the map certainly contain the live
          // draft, which makes the count exact rather than off by one.
          stashLive(state);
          if (Object.keys(state.drafts).length >= MAX_DRAFTS) return;
          const draft = emptyDraft();
          state.drafts[draft.id] = draft;
          applyDraft(state, draft);
          created = draft.id;
        });
        return created;
      },

      switchDraft: (draftId) =>
        set((state) => {
          if (draftId === state.activeDraftId) return;
          const target = state.drafts[draftId];
          if (!target) return;
          stashLive(state);
          applyDraft(state, target);
        }),

      renameDraft: (draftId, title) =>
        set((state) => {
          const trimmed = title.trim().slice(0, MAX_TITLE_LENGTH);
          // The live draft's title is the top-level one; the map copy is
          // refreshed on the way out, so writing only here would be lost.
          if (draftId === state.activeDraftId) {
            state.title = trimmed;
            return;
          }
          const target = state.drafts[draftId];
          if (!target) return;
          target.title = trimmed;
          target.updatedAt = Date.now();
        }),

      duplicateDraft: (draftId) => {
        let created: string | null = null;
        set((state) => {
          stashLive(state);
          if (Object.keys(state.drafts).length >= MAX_DRAFTS) return;
          const source = state.drafts[draftId];
          if (!source) return;
          const copy: Draft = {
            ...source,
            id: globalThis.crypto.randomUUID(),
            // Fresh ids throughout: two drafts sharing a contributor id would
            // make every id-keyed lookup ambiguous once both are in memory.
            authors: source.authors.map((author) => ({ ...author, id: globalThis.crypto.randomUUID() })),
            updatedAt: Date.now(),
            // Fresh contributor ids invalidate the claim and the asks anyway.
            claim: null,
            asked: {},
          };
          state.drafts[copy.id] = copy;
          created = copy.id;
        });
        return created;
      },

      deleteDraft: (draftId) =>
        set((state) => {
          stashLive(state);
          if (!state.drafts[draftId]) return;
          delete state.drafts[draftId];

          if (draftId !== state.activeDraftId) return;
          // Deleting what you are looking at lands on the most recently touched
          // survivor, or on a fresh empty draft when there is none.
          const next = Object.values(state.drafts).sort((a, b) => b.updatedAt - a.updatedAt)[0];
          const target = next ?? emptyDraft();
          state.drafts[target.id] = target;
          applyDraft(state, target);
        }),

      // Guarded like every other whole-roster write: an Import dialog or a bulk
      // undo can still be in flight when a claim link lands, and replacing the
      // roster under a claim would break the lock's one rule.
      loadAuthors: (authors) =>
        set((state) => {
          if (claimRefuses(state)) return;
          state.authors = normalizeAuthors(authors);
        }),

      setClaim: (claim) =>
        set((state) => {
          state.claim = claim;
        }),

      clearClaimFor: (draftId) =>
        set((state) => {
          if (draftId === state.activeDraftId) {
            state.claim = null;
            return;
          }
          const target = state.drafts[draftId];
          if (target) target.claim = null;
        }),

      setRecentReply: (contributorId) =>
        set((state) => {
          state.recentReply = contributorId;
        }),

      markAsked: (contributorId) =>
        set((state) => {
          state.asked[contributorId] = Date.now();
        }),

      clearAsked: (contributorId) =>
        set((state) => {
          delete state.asked[contributorId];
        }),

      setTitle: (title) =>
        set((state) => {
          state.title = title.trim().slice(0, MAX_TITLE_LENGTH);
        }),

      loadSample: (names) =>
        set((state) => {
          if (claimRefuses(state)) return;
          state.authors = normalizeAuthors(buildSampleAuthors(names));
          // The sample's scores are graded; yes/no would hide the very thing
          // it exists to demonstrate.
          state.inputMode = "levels";
        }),

      addAuthor: (name, orcid) => {
        const trimmed = name.trim();
        if (!trimmed) return null;
        let nextAuthor: Author;
        try {
          nextAuthor = createAuthor(trimmed, orcid ? { orcid } : undefined);
        } catch {
          // Unparseable as a name (a stray affiliation marker in a pasted list,
          // say). Reject it here rather than letting it throw through the caller.
          return null;
        }
        let added = false;
        set((state) => {
          if (claimRefuses(state)) return;
          if (state.authors.length >= MAX_AUTHORS) return;
          state.authors = normalizeAuthors([...state.authors, nextAuthor]);
          added = true;
        });
        return added ? nextAuthor.id : null;
      },

      removeAuthor: (authorId) =>
        set((state) => {
          if (claimRefuses(state)) return;
          const index = findAuthorIndex(state.authors, authorId);
          if (index === -1) return;
          state.authors.splice(index, 1);
          state.authors = normalizeAuthors(state.authors);
        }),

      restoreAuthor: (author, index) => {
        let restored = false;
        set((state) => {
          if (claimRefuses(state)) return;
          if (state.authors.some((candidate) => candidate.id === author.id)) return;
          // Undo can arrive after the list refilled to the cap; without this
          // the splice pushes past MAX_AUTHORS and normalizeAuthors throws
          // uncaught inside the reducer. Matches addAuthor's guard.
          if (state.authors.length >= MAX_AUTHORS) return;
          state.authors.splice(Math.max(0, Math.min(index, state.authors.length)), 0, author);
          state.authors = normalizeAuthors(state.authors);
          restored = true;
        });
        return restored;
      },

      moveAuthor: (fromIndex, toIndex) =>
        set((state) => {
          if (claimRefuses(state)) return;
          if (
            fromIndex < 0 ||
            toIndex < 0 ||
            fromIndex >= state.authors.length ||
            toIndex >= state.authors.length ||
            fromIndex === toIndex
          ) {
            return;
          }
          const [movedAuthor] = state.authors.splice(fromIndex, 1);
          if (!movedAuthor) return;
          state.authors.splice(toIndex, 0, movedAuthor);
          state.authors = normalizeAuthors(state.authors);
        }),

      updateAuthorName: (authorId, name) => {
        let updated = false;
        set((state) => {
          if (claimRefuses(state, authorId)) return;
          const index = findAuthorIndex(state.authors, authorId);
          const currentAuthor = state.authors[index];
          const trimmed = name.trim();
          if (!(currentAuthor && trimmed)) return;
          try {
            state.authors[index] = createAuthor(trimmed, {
              id: currentAuthor.id,
              orcid: currentAuthor.orcid,
              contributorType: currentAuthor.contributorType,
              contributions: currentAuthor.contributions,
              equalContribution: currentAuthor.equalContribution,
              corresponding: currentAuthor.corresponding,
            });
          } catch {
            return;
          }
          state.authors = normalizeAuthors(state.authors);
          updated = true;
        });
        return updated;
      },

      updateAuthorOrcid: (authorId, orcid) =>
        set((state) => {
          if (claimRefuses(state, authorId)) return;
          const index = findAuthorIndex(state.authors, authorId);
          const author = state.authors[index];
          if (!author) return;
          const trimmed = orcid.trim();
          // Reject invalid values: an unvalidated iD here would make the next
          // normalizeAuthors() -> createAuthor() throw inside this reducer.
          if (trimmed && !isValidOrcid(trimmed)) return;
          author.orcid = trimmed ? normalizeOrcid(trimmed) : undefined;
        }),

      setAuthorType: (authorId, contributorType) =>
        set((state) => {
          if (claimRefuses(state, authorId)) return;
          const author = state.authors[findAuthorIndex(state.authors, authorId)];
          if (!author) return;
          author.contributorType = contributorType;
        }),

      setAuthorMarker: (authorId, marker, value) =>
        set((state) => {
          if (claimRefuses(state, authorId)) return;
          const author = state.authors[findAuthorIndex(state.authors, authorId)];
          if (!author) return;
          author[marker] = value;
        }),

      setAuthorScore: (authorId, roleIndex, score) =>
        set((state) => {
          if (claimRefuses(state, authorId)) return;
          const index = findAuthorIndex(state.authors, authorId);
          const contribution = state.authors[index]?.contributions[roleIndex];
          if (contribution) {
            contribution.score = clampScore(score);
          }
        }),

      setAllAuthorScores: (authorId, score) =>
        set((state) => {
          if (claimRefuses(state, authorId)) return;
          const author = state.authors[findAuthorIndex(state.authors, authorId)];
          if (!author) return;
          const nextScore = clampScore(score);
          for (const contribution of author.contributions) {
            contribution.score = nextScore;
          }
        }),

      setRoleScores: (roleIndex, score) =>
        set((state) => {
          if (claimRefuses(state)) return;
          if (roleIndex < 0 || roleIndex >= ROLE_NAMES.length) return;
          const nextScore = clampScore(score);
          for (const author of state.authors) {
            const contribution = author.contributions[roleIndex];
            if (contribution) contribution.score = nextScore;
          }
        }),

      toggleContribution: (authorId, roleIndex) =>
        set((state) => {
          if (claimRefuses(state, authorId)) return;
          const index = findAuthorIndex(state.authors, authorId);
          const contribution = state.authors[index]?.contributions[roleIndex];
          if (contribution) {
            contribution.score = contribution.score > 0 ? 0 : 100;
          }
        }),

      setInputMode: (mode) =>
        set((state) => {
          state.inputMode = mode;
        }),

      setHeatmapMonoColor: (color) =>
        set((state) => {
          state.heatmapMonoColor = color;
        }),

      setOutputLocale: (locale) =>
        set((state) => {
          state.outputLocale = normalizeLocaleCode(locale);
        }),

      setUiLocale: (locale) =>
        set((state) => {
          state.uiLocale = normalizeLocaleCode(locale);
        }),

      // Open marks it seen too: once the card has been shown (first run or an
      // explicit re-open), the user is never auto-greeted on a later visit.
      openWelcome: () =>
        set((state) => {
          state.welcomeOpen = true;
          state.welcomeSeen = true;
        }),

      closeWelcome: () =>
        set((state) => {
          state.welcomeOpen = false;
          state.welcomeSeen = true;
        }),

      // Clears the workspace, not the user's history: welcomeSeen stays true, so
      // a reset doesn't stage a fake first run. The open card is dismissed with
      // it. Left up over an emptied workspace it would re-offer "Load sample
      // data", quietly undoing the reset.
      reset: () =>
        set((state) => {
          if (claimRefuses(state)) return;
          state.authors = [];
          state.title = "";
          state.inputMode = "toggle";
          state.heatmapMonoColor = DEFAULT_MONO_COLOR;
          state.outputLocale = "en";
          // uiLocale is a display preference, not draft data: a workspace reset
          // should not silently switch the interface back to English.
          state.welcomeOpen = false;
          // Empties the draft you are in; the other drafts are untouched.
          // Discarding them would make one button destroy a year of papers.
          state.drafts[state.activeDraftId] = liveDraft(state);
        }),
    })),
    {
      name: PERSIST_KEY,
      storage: announcingStorage(),
      /**
       * Stays at 1 until launch. There are no users, so the persisted shape can
       * change freely without a migration step for a version nobody holds.
       *
       * After launch: bump this and grow `migratePersisted` into a real
       * per-version migration chain (today it only discards shapes from a
       * newer build; see its doc).
       */
      version: PERSIST_VERSION,
      migrate: migratePersisted,
      /** Unpack the stored drafts and repair them; see `hydrateDrafts`. */
      merge: (persisted, current) => {
        const next = { ...current, ...hydrateDrafts(persisted) };
        // The SSR-constant first-draft id is the same in every browser, which
        // would defeat the "is this reply mine?" check. Re-key it once, client-side.
        if (next.activeDraftId === INITIAL_DRAFT_ID) {
          const id = globalThis.crypto.randomUUID();
          const drafts = { ...next.drafts };
          const first = drafts[INITIAL_DRAFT_ID];
          delete drafts[INITIAL_DRAFT_ID];
          drafts[id] = first ? { ...first, id } : { ...emptyDraft(), id };
          return { ...next, drafts, activeDraftId: id };
        }
        return next;
      },
      // Don't read localStorage during store creation: the server renders the
      // empty initial state, so a synchronous rehydrate here would desync the
      // first client render (hydration mismatch). A client effect calls
      // rehydrate() after mount instead; see HeaderActions.
      skipHydration: true,
      // spell-checker: ignore partialize
      partialize: (state) => ({
        // Storage sees the normalized shape: every draft in one map, with the
        // live top-level fields folded back into the active entry. Memory keeps
        // them unpacked so components read `authors` directly.
        drafts: { ...state.drafts, [state.activeDraftId]: liveDraft(state) },
        activeDraftId: state.activeDraftId,
        uiLocale: state.uiLocale,
        welcomeSeen: state.welcomeSeen,
      }),
    },
  ),
);
