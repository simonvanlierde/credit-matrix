import { showStatus } from "@/components/StatusBanner";
import {
  type Contributor,
  CREDIT_ROLES,
  generateStatement,
  importAnswers,
  importAny,
  MAX_AUTHORS,
  STATEMENT_FORMATS,
  type StatementFormat,
  toJson,
} from "@/core";
import { type ContributionLevel, LEVEL_SCORE } from "@/core/author";
import { roleNamed } from "@/core/credit-roles";
import { keepKnownIds, newContributors } from "@/core/merge-row";
import { announce } from "@/lib/announce";
import type { MessageKey } from "@/locales/keys";
import { ensureHydrated, useContributionStore } from "@/store/contribution-store";

export interface ModelContextToolAnnotations {
  readOnlyHint?: boolean;
  consequentialHint?: boolean;
  untrustedContentHint?: boolean;
}

export interface ModelContextTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ModelContextToolAnnotations;
  execute: (input?: Record<string, unknown>, context?: { signal?: AbortSignal }) => Promise<unknown>;
}

export interface ModelContext {
  registerTool: (tool: ModelContextTool, options?: { signal?: AbortSignal }) => Promise<void> | void;
}

declare global {
  interface Navigator {
    modelContext?: ModelContext;
  }
}

export type Translate = (key: MessageKey, values?: Record<string, string | number | Date>) => string;

const LEVELS = Object.keys(LEVEL_SCORE) as ContributionLevel[];
const ROLE_NAMES = CREDIT_ROLES.map((r) => r.name);

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("cancelled");
}

function findAuthor(authors: Contributor[], wanted: string): Contributor {
  const byId = authors.find((a) => a.id === wanted);
  if (byId) return byId;
  const lower = wanted.normalize("NFC").toLowerCase();
  const byName = authors.filter((a) => a.name.normalize("NFC").toLowerCase() === lower);
  if (byName.length === 1 && byName[0]) return byName[0];
  if (byName.length > 1) {
    throw new Error(`Multiple contributors are named "${wanted}". Pass the contributor id from get_matrix.`);
  }
  throw new Error(`No contributor matching "${wanted}". Call get_matrix for current contributors.`);
}

/** Build the WebMCP tools over the live contribution store and `src/core`. */
export function buildWebMcpTools(t: Translate): ModelContextTool[] {
  return [
    {
      name: "list_roles",
      title: "List CRediT roles and levels",
      description: "Return the 14 NISO CRediT roles with definitions, IDs and URLs, plus the four contribution levels.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: (_input, context) => {
        checkAborted(context?.signal);
        return Promise.resolve({
          roles: CREDIT_ROLES.map(({ name, id, description, url }) => ({ name, id, description, url })),
          levels: LEVELS.map((name) => ({ name, score: LEVEL_SCORE[name] })),
        });
      },
    },
    {
      name: "get_matrix",
      title: "Get the current contribution matrix",
      description: "Return the open draft's contributors and CRediT roles as the app's JSON export (version 2).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (_input, context) => {
        checkAborted(context?.signal);
        await ensureHydrated();
        checkAborted(context?.signal);
        const { authors, selfId, toolchain } = useContributionStore.getState();
        return JSON.parse(toJson(authors, { includeAnswers: false, selfId, toolchain }));
      },
    },
    {
      name: "import_contributors",
      title: "Import contributors into the matrix",
      description:
        "Import contributors from text in any format CRediT Matrix reads (name list, CSV, JSON export, Crossref XML, Tenzing, JATS XML, CodeMeta, or share link). Defaults to merging new contributors ('add'); pass mode 'replace' to swap the roster. Shows an Undo toast so the author can revert in one step.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Contributor data in any supported import format." },
          mode: {
            enum: ["add", "replace"],
            description: "'add' appends contributors not already in the draft (default); 'replace' swaps the roster.",
          },
        },
        required: ["text"],
        additionalProperties: false,
      },
      annotations: { consequentialHint: true, untrustedContentHint: true },
      execute: async (input = {}, context) => {
        checkAborted(context?.signal);
        const { text, mode = "add" } = input;
        if (typeof text !== "string") throw new Error("text must be a string.");
        if (mode !== "add" && mode !== "replace") throw new Error('mode must be "add" or "replace".');
        await ensureHydrated();
        checkAborted(context?.signal);
        const before = useContributionStore.getState();
        if (before.claim !== null) {
          throw new Error("This draft is locked to a co-author request and cannot be imported into.");
        }
        const parsed = await importAny(text);
        checkAborted(context?.signal);
        if (parsed.authors.length === 0) throw new Error("No contributors found in the input.");
        if (parsed.authors.length > MAX_AUTHORS) {
          throw new Error(`Too many contributors (limit ${MAX_AUTHORS}).`);
        }

        const current = useContributionStore.getState();
        if (current.claim !== null) {
          throw new Error("This draft is locked to a co-author request and cannot be imported into.");
        }
        const draftId = current.activeDraftId;
        let count: number;
        if (mode === "add") {
          const added = newContributors(current.authors, parsed.authors);
          if (current.authors.length + added.length > MAX_AUTHORS) {
            throw new Error(`Too many contributors (limit ${MAX_AUTHORS}).`);
          }
          const answers = parsed.asks ? importAnswers([], added, added, {}, { asks: parsed.asks }).asks : undefined;
          current.loadAuthors([...current.authors, ...added], answers ? { ...current.asks, ...answers } : undefined);
          count = added.length;
        } else {
          const mapped = keepKnownIds(current.authors, parsed.authors);
          const answers = importAnswers(current.authors, parsed.authors, mapped, current.asks, {
            asks: parsed.asks,
            selfId: parsed.selfId,
          });
          current.loadAuthors(mapped, answers.asks, answers.selfId);
          if (parsed.toolchain !== undefined) useContributionStore.setState({ toolchain: parsed.toolchain });
          if (parsed.title !== undefined) current.setTitle(parsed.title);
          count = useContributionStore.getState().authors.length;
        }

        const applied = useContributionStore.getState();
        const setsToolchain = mode === "replace" && parsed.toolchain !== undefined;
        showStatus({
          kind: "success",
          message: t(mode === "add" ? "importAddedContributors" : "importedContributors", { count }),
          actions: [
            {
              label: t("undo"),
              onAct: () => {
                const now = useContributionStore.getState();
                if (
                  now.activeDraftId !== draftId ||
                  now.authors !== applied.authors ||
                  now.asks !== applied.asks ||
                  now.selfId !== applied.selfId ||
                  now.title !== applied.title ||
                  (setsToolchain && now.toolchain !== applied.toolchain)
                ) {
                  showStatus({ kind: "error", message: t("importUndoStale") });
                  return;
                }
                now.loadAuthors(current.authors, current.asks);
                now.setSelfId(current.selfId);
                now.setTitle(current.title);
                if (setsToolchain) useContributionStore.setState({ toolchain: current.toolchain });
                announce(t("annImportUndone"));
              },
            },
          ],
        });

        return {
          format: parsed.format,
          mode,
          count,
          total: applied.authors.length,
          ...(parsed.warnings ? { warnings: parsed.warnings } : {}),
        };
      },
    },
    {
      name: "set_role",
      title: "Set a contributor's CRediT role level",
      description:
        "Set one contributor's contribution level (none, supporting, equal, or lead) for one CRediT role. Shows an Undo toast so the author can revert in one step.",
      inputSchema: {
        type: "object",
        properties: {
          author: { type: "string", description: "Contributor id or name from get_matrix." },
          role: { enum: ROLE_NAMES, description: "CRediT role name from list_roles." },
          level: { enum: LEVELS, description: "Contribution level: none, supporting, equal, or lead." },
        },
        required: ["author", "role", "level"],
        additionalProperties: false,
      },
      annotations: { consequentialHint: true },
      execute: async (input = {}, context) => {
        checkAborted(context?.signal);
        const { author: wantedAuthor, role: wantedRole, level } = input;
        if (typeof wantedAuthor !== "string" || !wantedAuthor.trim()) {
          throw new Error("author must be a non-empty contributor id or name.");
        }
        if (typeof wantedRole !== "string") throw new Error("role must be a CRediT role name.");
        const canonicalRole = roleNamed(wantedRole);
        if (!canonicalRole) {
          throw new Error(`Unknown CRediT role: "${wantedRole}". Call list_roles for valid names.`);
        }
        if (typeof level !== "string" || !Object.hasOwn(LEVEL_SCORE, level)) {
          throw new Error(`Unknown level: "${String(level)}". Use one of ${LEVELS.join(", ")}.`);
        }

        await ensureHydrated();
        checkAborted(context?.signal);
        const state = useContributionStore.getState();
        const contributor = findAuthor(state.authors, wantedAuthor);
        if (state.claim !== null && contributor.id !== state.claim.contributorId) {
          throw new Error("This draft is locked to one co-author's request; only that contributor's roles can change.");
        }
        const roleIndex = CREDIT_ROLES.findIndex((r) => r.name === canonicalRole);
        const score = LEVEL_SCORE[level as ContributionLevel];
        const previousScore = contributor.contributions[roleIndex]?.score ?? 0;
        const draftId = state.activeDraftId;

        state.setAuthorScore(contributor.id, roleIndex, score);
        const appliedAuthors = useContributionStore.getState().authors;

        showStatus({
          kind: "success",
          message: `${contributor.name}: ${canonicalRole} (${level})`,
          actions: [
            {
              label: t("undo"),
              onAct: () => {
                const now = useContributionStore.getState();
                if (now.activeDraftId !== draftId || now.authors !== appliedAuthors) {
                  showStatus({ kind: "error", message: t("statementUndoStale") });
                  return;
                }
                now.setAuthorScore(contributor.id, roleIndex, previousScore);
                announce(t("annBulkUndone"));
              },
            },
          ],
        });

        return { authorId: contributor.id, role: canonicalRole, level, score };
      },
    },
    {
      name: "get_statement",
      title: "Generate the CRediT author statement",
      description: `Generate the CRediT statement from the open draft in one of: ${STATEMENT_FORMATS.join(", ")}.`,
      inputSchema: {
        type: "object",
        properties: {
          format: {
            enum: [...STATEMENT_FORMATS],
            description: `Statement format (default "by-role"): ${STATEMENT_FORMATS.join(", ")}.`,
          },
          showLevels: {
            type: "boolean",
            description: "Append Equal or Supporting after non-lead contributions (defaults to the draft's setting).",
          },
          separateAcknowledgements: {
            type: "boolean",
            description:
              "List non-author contributors on a separate Acknowledgements line (defaults to the draft's setting).",
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input = {}, context) => {
        checkAborted(context?.signal);
        const { format = "by-role", showLevels, separateAcknowledgements } = input;
        if (typeof format !== "string" || !(STATEMENT_FORMATS as readonly string[]).includes(format)) {
          throw new Error(`Unknown statement format: "${String(format)}". Use one of ${STATEMENT_FORMATS.join(", ")}.`);
        }
        await ensureHydrated();
        checkAborted(context?.signal);
        const { authors, statementOptions } = useContributionStore.getState();
        const statement = generateStatement(authors, {
          format: format as StatementFormat,
          showLevels: typeof showLevels === "boolean" ? showLevels : statementOptions.showLevels,
          separateAcknowledgements:
            typeof separateAcknowledgements === "boolean" ? separateAcknowledgements : statementOptions.separateAck,
        });
        return { format, statement };
      },
    },
  ];
}

/** Register the workspace's WebMCP tools on `navigator.modelContext`, tearing down when `signal` aborts. */
export function registerWebMcpTools({ signal, t }: { signal: AbortSignal; t: Translate }): void {
  const mc = navigator.modelContext;
  if (!mc?.registerTool || signal.aborted) return;
  for (const tool of buildWebMcpTools(t)) {
    Promise.resolve(mc.registerTool(tool, { signal })).catch(() => undefined);
  }
}
