import { create } from "zustand";
import { type PersistStorage, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { useShallow } from "zustand/react/shallow";
import { shallow } from "zustand/shallow";
import {
  type Ask,
  type AskEvent,
  AskSchema,
  type Author,
  applyPatch,
  askStep,
  CREDIT_ROLES,
  type CreditRoleName,
  createAuthor,
  isValidOrcid,
  normalizeOrcid,
  normalizeRoster,
  type Outcome,
  type Patch,
  review,
  type Target,
} from "@/core";
import { clampScore, isUsableAuthorName, MAX_AUTHOR_NAME_LENGTH, MAX_AUTHORS } from "@/core/author";
import { DEFAULT_MONO_COLOR } from "@/core/contributor-color";
import { type LocaleCode, normalizeLocaleCode } from "@/core/i18n";
import { requestStorageFullAnnouncement } from "@/lib/announce";
import { reloadForNewerSave } from "@/lib/reload-for-new-build";
import { PERSIST_KEY, PERSIST_VERSION } from "./persist-meta";

export type InputMode = "toggle" | "levels";
export type InspectorTab = "statement" | "team" | "review";

/** A claim link's target: which contributor, on which draft it came from. */
export interface DraftClaim {
  contributorId: string;
  sourceDraftId: string;
  /** The ask came with the row empty. Absent on asks made before blank asks existed, which were all pre-filled. */
  blank?: boolean;
  /** The ask link's send time (`w`), so a newer request can replace this one. Absent on links without one. */
  sentAt?: number;
}

export type { Ask };

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
   * Asks and their latest answers, by contributor id. An entry appears when
   * the ask link is copied and holds the reply beside the row, so a row can say
   * "Asked" during the days an email round trip takes and show what differs after.
   */
  asks: Record<string, Ask>;
  /** The contributor the person using this browser is, if they said so: never asked, never counted as a co-author. */
  selfId: string | null;
}

/** A grid cell the Review list points at: a contributor and a role or marker. */
export interface ReviewCell {
  contributorId: string;
  target: Target;
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
  /** Open asks for the live draft, by contributor id. See `Draft.asks`. */
  asks: Record<string, Ask>;
  /** Mirrors the active draft's `selfId`. */
  selfId: string | null;
  /** The cell the Review line under the pointer or focus is about. Ephemeral. */
  reviewHighlight: ReviewCell | null;
  /** The cells a Review choice just changed, so the grid can mark the change. Ephemeral. */
  reviewSettled: { contributorId: string; targets: Target[] } | null;
  /** The contributor whose answers the Review tab should bring into view. Ephemeral. */
  reviewFocus: string | null;
  /**
   * The contributor whose row a just-opened reply filled in, so the status
   * strip's message has a matching mark on the row itself. Ephemeral: the
   * strip owns its lifetime (its onDismiss clears it however the strip
   * leaves), and a draft switch clears it too.
   */
  recentReply: string | null;
  /**
   * Counts Reset and Delete all. Ephemeral. Components holding an undo
   * buffer drop it when this changes, so Undo cannot bring back cleared work.
   */
  workspaceCleared: number;
  /**
   * A newer build saved the drafts and this tab could not reload into it, so
   * nothing here is saved any more. State rather than an event: at load it is
   * found before anything that shows it has mounted. Not persisted.
   */
  newerVersionBlocked: boolean;
  /** Whether the welcome card is currently open. Ephemeral (not persisted), so a
   *  "How it works" re-open never survives a reload as a fake first run. */
  welcomeOpen: boolean;
  /** The open tab of the workspace inspector. UI state only: never persisted. */
  inspectorTab: InspectorTab;
  /**
   * Every draft *except* the live one, which is held in the top-level fields
   * above so no component has to reach through a map to read its authors.
   * Storage sees the normalized form: `partialize` folds the live fields back
   * into this map on the way out, and `merge` unpacks the active one on the
   * way in.
   */
  drafts: Record<string, Draft>;
  activeDraftId: string;
  /** Replace the roster. `asks`, when given, replaces the asks too, for the rows the roster keeps. */
  /** With `selfId`, also marks that row as you, when it survives normalizing. */
  loadAuthors: (authors: Author[], asks?: Record<string, Ask>, selfId?: string) => void;
  setClaim: (claim: DraftClaim | null) => void;
  /** Unlock a draft's claim, active or parked. */
  clearClaimFor: (draftId: string) => void;
  /** Point at (or clear) the row a just-opened reply filled in. */
  setRecentReply: (contributorId: string | null) => void;
  /** Send, reply or settle on one draft, open or parked, in one write. The undo is the caller's to keep. */
  applyAskStep: (draftId: string, event: AskEvent) => { outcome: Outcome; undo: Patch };
  /**
   * Write a patch (an ask step's undo) into that draft only. Its asks for rows
   * the draft no longer has are skipped. False when the draft is gone.
   */
  applyAskPatch: (draftId: string, patch: Patch) => boolean;
  /** Mark (or, with null, unmark) the contributor who is the person using this browser. */
  setSelfId: (contributorId: string | null) => void;
  setReviewHighlight: (cell: ReviewCell | null) => void;
  setReviewSettled: (cells: { contributorId: string; targets: Target[] } | null) => void;
  /** Open the Review tab on one contributor's answers. */
  openReview: (contributorId: string | null) => void;
  setTitle: (title: string) => void;
  /** Start an empty draft and switch to it. Returns its id, or null at the cap. */
  createDraft: () => string | null;
  switchDraft: (draftId: string) => void;
  renameDraft: (draftId: string, title: string) => void;
  /** Copy a draft, contributions and all. Returns the new id, or null at the cap. */
  duplicateDraft: (draftId: string) => string | null;
  deleteDraft: (draftId: string) => void;
  /** Delete every draft, on disk too, and start over with one empty one. Preferences stay. */
  deleteAllDrafts: () => void;
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
  setInspectorTab: (tab: InspectorTab) => void;
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

/** Snapshot the live top-level fields as a draft record. */
function liveDraft(state: ContributionState): Draft {
  return {
    // The map copy carries keys a newer build wrote, which this one keeps.
    ...state.drafts[state.activeDraftId],
    id: state.activeDraftId,
    title: state.title,
    authors: state.authors,
    inputMode: state.inputMode,
    heatmapMonoColor: state.heatmapMonoColor,
    outputLocale: state.outputLocale,
    updatedAt: Date.now(),
    claim: state.claim,
    asks: state.asks,
    selfId: state.selfId,
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
  state.asks = draft.asks;
  state.selfId = draft.selfId;
  state.reviewHighlight = null;
  state.reviewSettled = null;
  state.reviewFocus = null;
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
    asks: {},
    selfId: null,
  };
}

/** Apply a patch to a draft, open or parked, in one write. False when the draft is gone. */
function writeAskPatch(state: ContributionState, draftId: string, patch: Patch): boolean {
  const live = draftId === state.activeDraftId;
  const target = live ? state : state.drafts[draftId];
  if (!target) return false;
  // applyPatch re-derives what a rename changes and leaves every other row the same object.
  const next = applyPatch(target, patch);
  target.authors = next.authors as Author[];
  target.asks = next.asks;
  if (!live) (target as Draft).updatedAt = Date.now();
  return true;
}

/** Park the live draft in the map, so a switch does not lose it. */
function stashLive(state: ContributionState): void {
  state.drafts[state.activeDraftId] = liveDraft(state);
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

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";

/**
 * Open asks by contributor id; a malformed entry costs that entry. `legacy` is
 * the `asked` map of timestamps that came before, and every one of those asks
 * carried the asker's guess.
 */
function repairAsks(value: unknown, legacy: unknown): Record<string, Ask> {
  const asks: Record<string, Ask> = {};
  if (isRecord(legacy)) {
    for (const [id, at] of Object.entries(legacy)) {
      if (CLAIM_ID_REGEX.test(id) && typeof at === "number") asks[id] = { sentAt: at, prefilled: true };
    }
  }
  if (isRecord(value)) {
    for (const [id, ask] of Object.entries(value)) {
      if (!(CLAIM_ID_REGEX.test(id) && isRecord(ask))) continue;
      const { sentAt, prefilled } = ask;
      if (!(typeof sentAt === "number" && typeof prefilled === "boolean")) continue;
      // A malformed reply costs the reply, not the ask.
      const { reply: _reply, ...rest } = ask;
      const parsed = AskSchema.safeParse(ask);
      asks[id] = parsed.success ? parsed.data : { ...rest, sentAt, prefilled };
    }
  }
  return asks;
}

/**
 * Rebuild one persisted draft, filling anything missing or malformed. Keys
 * this build does not know are kept: a newer build's fields must survive an
 * older tab's save.
 */
function repairSingleDraft(value: unknown, id: string): Draft {
  const { asked, ...raw } = (isRecord(value) ? value : {}) as Partial<Draft> & { asked?: unknown };
  return {
    ...raw,
    id,
    title: typeof raw.title === "string" ? raw.title.slice(0, MAX_TITLE_LENGTH) : "",
    authors: repairAuthors(raw.authors),
    inputMode: raw.inputMode === "levels" ? "levels" : "toggle",
    heatmapMonoColor: typeof raw.heatmapMonoColor === "string" ? raw.heatmapMonoColor : DEFAULT_MONO_COLOR,
    outputLocale: normalizeLocaleCode(raw.outputLocale),
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
    claim: isDraftClaim(raw.claim) ? raw.claim : null,
    asks: repairAsks(raw.asks, asked),
    selfId: typeof raw.selfId === "string" && CLAIM_ID_REGEX.test(raw.selfId) ? raw.selfId : null,
  };
}

/**
 * Turn the persisted, normalized shape back into the live one.
 *
 * Repair runs on every load, not just on a version change: a draft can be
 * malformed without its version being wrong — localStorage edited by hand, a
 * half-written value from a crashed tab, or a field this build no longer
 * accepts. `normalizeRoster` throws on a contributor it cannot rebuild, and it
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

  const out = {
    drafts,
    uiLocale: normalizeLocaleCode(state.uiLocale),
    ...(typeof state.welcomeSeen === "boolean" ? { welcomeSeen: state.welcomeSeen } : {}),
  } as ContributionState;
  applyDraft(out, active);
  return out;
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

/**
 * Where the last value that failed to parse is kept, so a corrupted draft can
 * still be recovered by hand. One slot, overwritten: a backup, not a history.
 */
const UNREADABLE_KEY = `${PERSIST_KEY}:unreadable`;

/**
 * Set while this tab adopts another tab's save: the ids of the drafts it
 * takes. The adopted state is already on disk, and writing it back (with a
 * fresh `updatedAt`) would wake the other tab, which would adopt that and
 * write it back in turn.
 */
let adopting: ReadonlySet<string> | null = null;

/**
 * The last value partialize built, returned again while nothing it reads has
 * changed. Persist calls setItem on every set(), hover highlights included;
 * the stable reference lets setItem skip those writes.
 */
let lastPersisted: { state: ContributionState; value: PersistedState } | undefined;

function persistedState(state: ContributionState): PersistedState {
  const prev = lastPersisted;
  // updatedAt is stamped on every call, so it alone never counts as a change.
  if (
    prev &&
    prev.state.drafts === state.drafts &&
    prev.state.activeDraftId === state.activeDraftId &&
    prev.state.uiLocale === state.uiLocale &&
    prev.state.welcomeSeen === state.welcomeSeen &&
    shallow({ ...liveDraft(prev.state), updatedAt: 0 }, { ...liveDraft(state), updatedAt: 0 })
  ) {
    return prev.value;
  }
  const value = {
    // Storage sees the normalized shape: every draft in one map, with the
    // live top-level fields folded back into the active entry. Memory keeps
    // them unpacked so components read `authors` directly.
    drafts: { ...state.drafts, [state.activeDraftId]: liveDraft(state) },
    activeDraftId: state.activeDraftId,
    uiLocale: state.uiLocale,
    welcomeSeen: state.welcomeSeen,
  };
  lastPersisted = { state, value };
  return value;
}

/** The store's storage adapter; see `announcingStorage`. */
export interface DraftStorage extends PersistStorage<PersistedState> {
  /**
   * Read one key as stored, or null. Reading the main key also yields to a
   * newer build that saved there.
   */
  readKey: (key: string) => unknown;
  /** Note that these parked drafts are what storage holds, as just restored. */
  restored: (drafts: Record<string, Draft>, activeDraftId: string) => void;
}

/** Every parked-draft key currently in localStorage; none when site data is blocked. */
function draftKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(DRAFT_KEY_PREFIX)) keys.push(key);
    }
  } catch {
    // Reading `window.localStorage` throws a SecurityError when the browser
    // blocks site data. Thrown here it would abort the restore, and the
    // workspace would stay read-only.
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
export function announcingStorage(): DraftStorage {
  let warned = false;
  // A newer build saved here, so this tab is the old one: reload to become
  // that build. When the reload is refused (offline, or it just happened),
  // flag that edits here are not being saved.
  let yielded = false;
  const yieldToNewerBuild = () => {
    if (yielded) return;
    yielded = true;
    if (!reloadForNewerSave()) useContributionStore.setState({ newerVersionBlocked: true });
  };
  // Parked drafts already on disk, by reference: as restored, adopted from
  // another tab, or written here. Immer's structural sharing keeps an untouched
  // draft's identity across edits, so a reference match means the stored JSON
  // is current and the write can be skipped. Seeded at the restore, or this
  // tab's first save would write its copy of every parked draft over newer
  // ones another tab saved since.
  const written = new Map<string, Draft>();
  // The value of the last successful main-key write (see persistedState).
  let lastWritten: PersistedState | undefined;
  // Draft ids this tab held at its last read or write. Another tab shares the
  // same storage, so an id missing from this tab's drafts is only a deletion
  // when this tab held it before. Anything else belongs to the other tab.
  let known = new Set<string>();

  // An unreadable value must not escape as a throw: a parse failure would
  // abort hydration with hasHydrated never set — inputs stay readOnly and the
  // setItem guard below drops every write, on every visit, until the user
  // clears localStorage by hand. A truncated value from a crashed tab is
  // exactly the case hydrateDrafts exists for, but repair only runs on a
  // parsed value. Drop what cannot be read instead — for a parked draft that
  // costs one draft, not the workspace — after copying it aside, since a value
  // JSON cannot parse may still be mostly a paper a person can piece together.
  const readJson = (key: string): unknown => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    } catch {
      try {
        if (raw !== null) window.localStorage.setItem(UNREADABLE_KEY, raw);
      } catch {
        // Best effort: a full quota must not keep the value blocking hydration.
      }
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
      const version = typeof record.version === "number" ? record.version : 0;
      // A newer build's drafts are discarded in memory (see `migrate`), not on
      // disk: this tab reloads into that build, and setItem refuses to write
      // over them meanwhile. They stay unknown, so nothing counts as deleted.
      known = version > PERSIST_VERSION ? new Set() : new Set(Object.keys(state.drafts));
      // Yield now, before this idle tab's first edit is refused.
      if (version > PERSIST_VERSION) yieldToNewerBuild();
      return { state: state as unknown as PersistedState, version };
    },
    readKey: (key) => {
      if (typeof window === "undefined") return null;
      const value = readJson(key);
      if (key === PERSIST_KEY && isRecord(value) && typeof value.version === "number") {
        if (value.version > PERSIST_VERSION) yieldToNewerBuild();
      }
      return value;
    },
    restored: (drafts, activeDraftId) => {
      written.clear();
      for (const [id, draft] of Object.entries(drafts)) if (id !== activeDraftId) written.set(id, draft);
    },
    removeItem: (key) => {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.removeItem(key);
        for (const draftKey of draftKeys()) window.localStorage.removeItem(draftKey);
        // Holds draft data too; clearing the drafts should not leave a copy behind.
        window.localStorage.removeItem(UNREADABLE_KEY);
      } catch {
        // Storage blocked entirely (SecurityError): nothing on disk to clear.
      }
      written.clear();
      lastWritten = undefined;
    },
    setItem: (key, value) => {
      if (typeof window === "undefined") return;
      // Never write before the restore has happened. Persist saves on every
      // change, hydrated or not, so a change made in the window between first
      // paint and the rehydrate would save the *empty* initial state over the
      // draft in storage — and the rehydrate that follows would then read that
      // emptied value back. One early keystroke could erase a saved paper.
      if (!useContributionStore.persist.hasHydrated()) return;
      if (value.state === lastWritten) return;
      const { drafts, activeDraftId, uiLocale, welcomeSeen } = value.state;
      // Adopting another tab's save writes nothing back (it would wake that
      // tab, which would adopt, write back...), but this tab now holds those
      // drafts, so deleting one later must remove its key.
      if (adopting) {
        // What it adopted is on disk as it is now, so no save writes it back.
        for (const id of adopting) {
          const draft = drafts[id];
          if (id !== activeDraftId && draft) written.set(id, draft);
        }
        known = new Set(Object.keys(drafts));
        lastWritten = value.state;
        return;
      }
      const deleted = new Set([...known].filter((id) => !(id in drafts)));
      // A tab that loaded before a newer build saved must not write that
      // build's data back in a shape it does not fully know. Checked on every
      // write, since a tab open on the active draft never re-reads it.
      const main = readJson(key) as { state?: { drafts?: unknown }; version?: unknown } | null;
      if (typeof main?.version === "number" && main.version > PERSIST_VERSION) {
        yieldToNewerBuild();
        return;
      }
      try {
        // The main key may hold another tab's active draft, stored nowhere
        // else: park it before this write replaces the main key. First, so this
        // tab's own changed drafts below still win.
        const mainDrafts = main?.state?.drafts;
        if (mainDrafts !== null && typeof mainDrafts === "object") {
          for (const [id, draft] of Object.entries(mainDrafts)) {
            if (id === activeDraftId || deleted.has(id)) continue;
            window.localStorage.setItem(DRAFT_KEY_PREFIX + id, JSON.stringify(draft));
            // Another tab's save this tab may not have heard of yet: its event
            // can arrive after this write, when the main key no longer holds
            // it. Take it in once this save is done, or a stale copy stays here.
            if (id in drafts) queueMicrotask(() => adoptKey(DRAFT_KEY_PREFIX + id));
          }
        }
        for (const [id, draft] of Object.entries(drafts)) {
          if (id === activeDraftId || written.get(id) === draft) continue;
          window.localStorage.setItem(DRAFT_KEY_PREFIX + id, JSON.stringify(draft));
          written.set(id, draft);
        }
        window.localStorage.setItem(
          key,
          JSON.stringify({
            state: { drafts: { [activeDraftId]: drafts[activeDraftId] }, activeDraftId, uiLocale, welcomeSeen },
            version: value.version,
          }),
        );
        // The active draft lives in the main key, and a deleted draft's key
        // would otherwise resurrect it on the next load. Only after the main
        // write: until it lands, a just-opened draft's own key is its only copy.
        for (const id of [activeDraftId, ...deleted]) {
          window.localStorage.removeItem(DRAFT_KEY_PREFIX + id);
          written.delete(id);
        }
        known = new Set(Object.keys(drafts));
        lastWritten = value.state;
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
 * Follow another tab's saves.
 *
 * Two tabs on one draft would otherwise overwrite each other, each save
 * silently discarding the other tab's edits, and a tab holding a stale copy of
 * a parked draft would open that copy later. So a `storage` event on the main
 * key or on a parked draft's key reads that one key and adopts the drafts it
 * holds that differ from this tab's copies. When the open draft is among them,
 * the preferences saved with it come along. The open draft stays open: another
 * tab switching papers is not a reason to switch here, and a draft the other
 * tab deleted stays here until a reload, unless it changes here.
 *
 * Returns whether the open draft changed, so the caller can say so.
 */
export function followOtherTab(event: StorageEvent): boolean {
  if (event.storageArea !== window.localStorage || event.key === null) return false;
  return adoptKey(event.key);
}

/** Adopt what one key holds; see `followOtherTab`. */
function adoptKey(key: string): boolean {
  if (!useContributionStore.persist.hasHydrated()) return false;
  // Only the key that changed is read: another tab typing saves on every
  // keystroke, and re-reading the whole shelf would parse every draft each time.
  let theirs: Record<string, unknown>;
  let prefs: Record<string, unknown> = {};
  if (key === PERSIST_KEY) {
    // A newer build's save is not this tab's to adopt; reading it is what makes
    // this tab yield to that build (see announcingStorage).
    const main = draftStorage.readKey(PERSIST_KEY);
    if (!isRecord(main) || (typeof main.version === "number" && main.version > PERSIST_VERSION)) return false;
    prefs = isRecord(main.state) ? main.state : {};
    theirs = isRecord(prefs.drafts) ? prefs.drafts : {};
  } else if (key.startsWith(DRAFT_KEY_PREFIX)) {
    const draft = draftStorage.readKey(key);
    // Removed: opened in the other tab, which the main key's event covers, or deleted there.
    if (draft === null) return false;
    theirs = { [key.slice(DRAFT_KEY_PREFIX.length)]: draft };
  } else {
    return false;
  }

  const live = useContributionStore.getState();
  const id = live.activeDraftId;
  // Every save by a tab not on a draft still rewrites that draft's key with
  // the content this tab saved. Compare as the repair pass sees both, without
  // the save time, so only a real edit counts.
  const comparable = (draft: unknown, draftId: string) =>
    JSON.stringify({ ...repairSingleDraft(draft, draftId), updatedAt: 0 });
  const changed: Record<string, Draft> = {};
  for (const [draftId, draft] of Object.entries(theirs)) {
    const ours = draftId === id ? liveDraft(live) : live.drafts[draftId];
    if (ours && comparable(draft, draftId) === comparable(ours, draftId)) continue;
    changed[draftId] = repairSingleDraft(draft, draftId);
  }
  if (Object.keys(changed).length === 0) return false;
  const open = changed[id];

  adopting = new Set(Object.keys(changed));
  try {
    useContributionStore.setState((state) => {
      Object.assign(state.drafts, changed);
      if (!open) return;
      applyDraft(state, open);
      if ("uiLocale" in prefs) state.uiLocale = normalizeLocaleCode(prefs.uiLocale);
      if (typeof prefs.welcomeSeen === "boolean") state.welcomeSeen = prefs.welcomeSeen;
    });
  } finally {
    adopting = null;
  }
  return open !== undefined;
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

const draftStorage = announcingStorage();

export const useContributionStore = create<ContributionState>()(
  persist(
    immer((set, get) => ({
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
      inspectorTab: "statement",
      newerVersionBlocked: false,
      claim: null,
      asks: {},
      selfId: null,
      reviewHighlight: null,
      reviewSettled: null,
      reviewFocus: null,
      recentReply: null,
      workspaceCleared: 0,

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
          const authors = source.authors.map((author) => ({ ...author, id: globalThis.crypto.randomUUID() }));
          const selfIndex = source.authors.findIndex((author) => author.id === source.selfId);
          const copy: Draft = {
            ...source,
            id: globalThis.crypto.randomUUID(),
            // Fresh ids throughout: two drafts sharing a contributor id would
            // make every id-keyed lookup ambiguous once both are in memory.
            authors,
            selfId: authors[selfIndex]?.id ?? null,
            updatedAt: Date.now(),
            // Fresh contributor ids invalidate the claim and the asks anyway.
            claim: null,
            asks: {},
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

      deleteAllDrafts: () => {
        // Through the adapter's removeItem first: the next save only removes
        // the shelf keys of drafts this tab knew, and another tab's would
        // otherwise survive the "all".
        useContributionStore.persist.clearStorage();
        set((state) => {
          const draft = emptyDraft();
          state.drafts = { [draft.id]: draft };
          applyDraft(state, draft);
          state.workspaceCleared += 1;
        });
      },

      // Guarded like every other whole-roster write: an Import dialog or a bulk
      // undo can still be in flight when a claim link lands, and replacing the
      // roster under a claim would break the lock's one rule.
      loadAuthors: (authors, asks, selfId) =>
        set((state) => {
          if (claimRefuses(state)) return;
          state.authors = normalizeRoster(authors);
          // Normalizing re-keys a row whose id was unusable; answers under the old id have no row left.
          const ids = new Set(state.authors.map((author) => author.id));
          if (selfId !== undefined && ids.has(selfId)) state.selfId = selfId;
          else if (state.selfId !== null && !ids.has(state.selfId)) state.selfId = null;
          if (!asks) return;
          state.asks = Object.fromEntries(Object.entries(asks).filter(([id]) => ids.has(id)));
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

      applyAskStep: (draftId, event) => {
        const state = get();
        const source = draftId === state.activeDraftId ? state : state.drafts[draftId];
        if (!source) return { outcome: { kind: "unmatched" }, undo: { rows: {}, asks: {} } };
        const { outcome, patch, undo } = askStep(source, event);
        if (Object.keys(patch.rows).length > 0 || Object.keys(patch.asks).length > 0) {
          set((draft) => {
            writeAskPatch(draft, draftId, patch);
          });
        }
        return { outcome, undo };
      },

      applyAskPatch: (draftId, patch) => {
        let written = false;
        set((draft) => {
          written = writeAskPatch(draft, draftId, patch);
        });
        return written;
      },

      setSelfId: (contributorId) =>
        set((state) => {
          state.selfId = contributorId;
        }),

      setReviewHighlight: (cell) =>
        set((state) => {
          state.reviewHighlight = cell;
        }),

      setReviewSettled: (cells) =>
        set((state) => {
          state.reviewSettled = cells;
        }),

      openReview: (contributorId) =>
        set((state) => {
          state.inspectorTab = "review";
          state.reviewFocus = contributorId;
        }),

      setTitle: (title) =>
        set((state) => {
          state.title = title.trim().slice(0, MAX_TITLE_LENGTH);
        }),

      loadSample: (names) =>
        set((state) => {
          if (claimRefuses(state)) return;
          state.authors = normalizeRoster(buildSampleAuthors(names));
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
          state.authors = normalizeRoster([...state.authors, nextAuthor]);
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
          state.authors = normalizeRoster(state.authors);
          // Undo of the removal puts the ask back through applyAskPatch.
          delete state.asks[authorId];
          if (state.selfId === authorId) state.selfId = null;
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
          state.authors = normalizeRoster(state.authors);
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
          state.authors = normalizeRoster(state.authors);
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
          state.authors = normalizeRoster(state.authors);
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
          // normalizeRoster() -> createAuthor() throw inside this reducer.
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

      setInspectorTab: (tab) =>
        set((state) => {
          state.inspectorTab = tab;
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
          state.asks = {};
          state.selfId = null;
          // uiLocale is a display preference, not draft data: a workspace reset
          // should not silently switch the interface back to English.
          state.welcomeOpen = false;
          // Empties the draft you are in; the other drafts are untouched.
          // Discarding them would make one button destroy a year of papers.
          state.drafts[state.activeDraftId] = liveDraft(state);
          state.workspaceCleared += 1;
        }),
    })),
    {
      name: PERSIST_KEY,
      storage: draftStorage,
      onRehydrateStorage: () => (state) => {
        if (state) draftStorage.restored(state.drafts, state.activeDraftId);
      },
      version: PERSIST_VERSION,
      // No per-version steps: `hydrateDrafts` repairs the whole shape on every
      // load. A draft from a *newer* build may hold fields this one does not
      // understand, and there is no walking backwards, so start fresh. The
      // cast is for persist's types; `hydrateDrafts` re-checks every field.
      migrate: (persisted, from) => (from > PERSIST_VERSION ? {} : persisted) as PersistedState,
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
      partialize: persistedState,
    },
  ),
);

/**
 * The co-authors' answers at a glance: how many co-authors there are (you
 * excluded), how many answered (and were not asked again since), and how many
 * differences still wait for a decision.
 */
export function askSummary(
  authors: readonly Author[],
  asks: Readonly<Record<string, Ask>>,
  selfId: string | null,
): { total: number; answered: number; open: number } {
  let total = 0;
  let answered = 0;
  let open = 0;
  for (const author of authors) {
    if (author.id === selfId) continue;
    total += 1;
    const ask = asks[author.id];
    if (!ask) continue;
    const result = review(author, ask);
    if (result.status.kind === "differs" || result.status.kind === "settled") answered += 1;
    open += result.open.length;
  }
  return { total, answered, open };
}

export const useAskSummary = () => useContributionStore(useShallow((s) => askSummary(s.authors, s.asks, s.selfId)));

export const useOpenDifferences = () => useContributionStore((s) => askSummary(s.authors, s.asks, s.selfId).open);
