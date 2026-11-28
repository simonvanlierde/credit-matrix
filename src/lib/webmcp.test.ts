import Ajv from "ajv/dist/2020";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as StatusBanner from "@/components/StatusBanner";
import {
  type Contributor,
  CREDIT_ROLES,
  createAuthor,
  encodeShareHash,
  MAX_AUTHORS,
  MAX_IMPORT_BYTES,
  STATEMENT_FORMATS,
  toCrossrefContributors,
  toCsv,
  toJats4rXml,
  toJson,
  toTenzing,
} from "@/core";
import { LEVEL_SCORE } from "@/core/author";
import contributorsSchema from "@/core/contributors.schema.json";
import { useContributionStore } from "@/store/contribution-store";
import {
  buildWebMcpTools,
  type ModelContext,
  type ModelContextTool,
  registerWebMcpTools,
  type Translate,
} from "./webmcp";

const ajv = new Ajv({ strict: false });
const validateContributors = ajv.compile(contributorsSchema);

const t: Translate = (key, values) => (values ? `${key}:${JSON.stringify(values)}` : key);

function getTool(name: string): ModelContextTool {
  const tool = buildWebMcpTools(t).find((item) => item.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool;
}

function setScore(author: Contributor, roleIndex: number, score: number): void {
  const entry = author.contributions[roleIndex];
  if (entry) entry.score = score;
}

function makeStandIn() {
  const tools = new Map<string, ModelContextTool>();
  const refused: string[] = [];
  const modelContext: ModelContext = {
    registerTool: (tool, { signal } = {}) => {
      if (signal?.aborted || tools.has(tool.name)) {
        refused.push(tool.name);
        return Promise.reject(new DOMException(`refused ${tool.name}`, "InvalidStateError"));
      }
      tools.set(tool.name, tool);
      signal?.addEventListener("abort", () => tools.delete(tool.name));
      return Promise.resolve();
    },
  };
  return { tools, refused, modelContext };
}

beforeEach(async () => {
  localStorage.clear();
  await useContributionStore.persist.rehydrate();
  useContributionStore.getState().deleteAllDrafts();
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "modelContext");
});

describe("registerWebMcpTools", () => {
  it("registers all five tools once and unregisters on abort", async () => {
    const { tools, refused, modelContext } = makeStandIn();
    Object.defineProperty(navigator, "modelContext", { value: modelContext, configurable: true });
    const ac = new AbortController();

    registerWebMcpTools({ signal: ac.signal, t });
    await Promise.resolve();

    expect([...tools.keys()]).toEqual(["list_roles", "get_matrix", "import_contributors", "set_role", "get_statement"]);
    expect(refused).toEqual([]);

    // Re-registering without tearing down is refused quietly by the stand-in.
    registerWebMcpTools({ signal: ac.signal, t });
    await Promise.resolve();
    expect(refused).toHaveLength(5);

    ac.abort();
    expect(tools.size).toBe(0);

    // Already-aborted signal does not attempt registration.
    const before = refused.length;
    registerWebMcpTools({ signal: ac.signal, t });
    expect(refused.length).toBe(before);
  });

  it("is a no-op when navigator.modelContext is absent", () => {
    const ac = new AbortController();
    expect(() => registerWebMcpTools({ signal: ac.signal, t })).not.toThrow();
  });
});

describe("list_roles", () => {
  it("returns all 14 CRediT roles and 4 levels with readOnlyHint", async () => {
    const tool = getTool("list_roles");
    expect(tool.annotations).toEqual({ readOnlyHint: true });
    const result = (await tool.execute()) as {
      roles: { name: string; id: string; description: string; url: string }[];
      levels: { name: string; score: number }[];
    };
    expect(result.roles).toHaveLength(CREDIT_ROLES.length);
    expect(result.roles[0]?.name).toBe("Conceptualization");
    expect(result.levels).toEqual(Object.entries(LEVEL_SCORE).map(([name, score]) => ({ name, score })));
  });

  it("rejects when signal is already aborted", () => {
    const ac = new AbortController();
    ac.abort();
    expect(() => getTool("list_roles").execute({}, { signal: ac.signal })).toThrow("cancelled");
  });
});

describe("get_matrix", () => {
  it("returns JSON export matching contributors.schema.json with readOnlyHint and untrustedContentHint", async () => {
    const tool = getTool("get_matrix");
    expect(tool.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true });

    const grace = createAuthor("Grace B. Hopper");
    setScore(grace, 0, 100);
    useContributionStore.getState().loadAuthors([grace]);
    useContributionStore.getState().setToolchain("quarto");

    const result = await tool.execute();
    expect(validateContributors(result)).toBe(true);
    expect((result as { version: number; authors: { name: string }[]; toolchain: string }).version).toBe(2);
    expect((result as { authors: { name: string }[] }).authors[0]?.name).toBe("Grace B. Hopper");
  });
});

describe("import_contributors", () => {
  it("imports every supported format (names, CSV, JSON, Crossref, Tenzing, JATS XML, share link)", async () => {
    const tool = getTool("import_contributors");
    expect(tool.annotations).toEqual({ consequentialHint: true, untrustedContentHint: true });

    const ada = createAuthor("Ada Lovelace");
    setScore(ada, 8, 100); // Software
    const charles = createAuthor("Charles Babbage");
    setScore(charles, 0, 66); // Conceptualization

    const fixtures: [string, string][] = [
      ["names", "Ada Lovelace, Charles Babbage"],
      ["csv", toCsv([ada, charles])],
      ["json", toJson([ada, charles])],
      ["crossref", toCrossrefContributors([ada, charles])],
      ["tenzing", toTenzing([ada, charles])],
      ["xml", toJats4rXml([ada, charles])],
      ["link", await encodeShareHash({ authors: [ada, charles], title: "Analytical Engine", toolchain: "myst" })],
    ];

    for (const [expectedFormat, text] of fixtures) {
      const res = (await tool.execute({ text, mode: "replace" })) as { format: string; count: number; total: number };
      expect(res.format).toBe(expectedFormat);
      expect(res.count).toBe(2);
      expect(res.total).toBe(2);
    }
    expect(useContributionStore.getState().title).toBe("Analytical Engine");
    expect(useContributionStore.getState().toolchain).toBe("myst");
  });

  it("merges new contributors by default ('add') and supports Undo toast + stale Undo refusal", async () => {
    const statuses: StatusBanner.Status[] = [];
    vi.spyOn(StatusBanner, "showStatus").mockImplementation((s) => statuses.push(s));

    const tool = getTool("import_contributors");
    const ada = createAuthor("Ada Lovelace");
    useContributionStore.getState().loadAuthors([ada]);

    const res = (await tool.execute({ text: "Ada Lovelace\nGrace Hopper" })) as {
      mode: string;
      count: number;
      total: number;
    };
    expect(res.mode).toBe("add");
    expect(res.count).toBe(1);
    expect(res.total).toBe(2);
    expect(useContributionStore.getState().authors.map((a) => a.name)).toEqual(["Ada Lovelace", "Grace Hopper"]);

    // Click Undo on the toast -> restores just Ada.
    const toast = statuses.at(-1);
    expect(toast?.kind).toBe("success");
    toast?.actions?.[0]?.onAct();
    expect(useContributionStore.getState().authors.map((a) => a.name)).toEqual(["Ada Lovelace"]);

    // Replace with toolchain, then mutate before Undo -> Undo refuses as stale.
    const jsonWithTool = toJson([createAuthor("Alan Turing")], { toolchain: "typst" });
    await tool.execute({ text: jsonWithTool, mode: "replace" });
    const replaceToast = statuses.at(-1);
    useContributionStore.getState().setTitle("Edited later");
    replaceToast?.actions?.[0]?.onAct();
    expect(statuses.at(-1)?.kind).toBe("error");
    expect(statuses.at(-1)?.message).toBe("importUndoStale");
    expect(useContributionStore.getState().authors.map((a) => a.name)).toEqual(["Alan Turing"]);
  });

  it("imports JSON asks on add and undo restores toolchain on replace", async () => {
    const statuses: StatusBanner.Status[] = [];
    vi.spyOn(StatusBanner, "showStatus").mockImplementation((s) => statuses.push(s));
    const tool = getTool("import_contributors");
    useContributionStore.getState().setToolchain("word");

    const grace = createAuthor("Grace Hopper");
    const withUnknownTool = JSON.stringify({ ...JSON.parse(toJson([grace])), toolchain: "future-tool" });
    const warned = (await tool.execute({ text: withUnknownTool, mode: "replace" })) as { warnings?: string[] };
    expect(warned.warnings?.length).toBe(1);

    // Replace with known toolchain, then undo cleanly restores previous toolchain.
    const alan = createAuthor("Alan Turing");
    await tool.execute({ text: toJson([alan], { toolchain: "quarto" }), mode: "replace" });
    expect(useContributionStore.getState().toolchain).toBe("quarto");
    statuses.at(-1)?.actions?.[0]?.onAct();
    expect(useContributionStore.getState().toolchain).toBe("word");

    // Add mode with asks in JSON.
    const withAsks = toJson([alan], { asks: { [alan.id]: { state: "asked", sentAt: 1000, prefilled: true } } });
    await tool.execute({ text: withAsks, mode: "add" });
    expect(useContributionStore.getState().authors.map((a) => a.name)).toEqual(["Grace Hopper", "Alan Turing"]);
  });

  it("enforces input validation, caps (MAX_IMPORT_BYTES, MAX_AUTHORS), and claim lock", async () => {
    const tool = getTool("import_contributors");
    await expect(tool.execute({ text: 123 })).rejects.toThrow("text must be a string");
    await expect(tool.execute({ text: "Ada", mode: "overwrite" })).rejects.toThrow('mode must be "add" or "replace"');
    await expect(tool.execute({ text: "Name,Conceptualization\n" })).rejects.toThrow("No contributors found");
    await expect(tool.execute({ text: "a".repeat(MAX_IMPORT_BYTES + 1) })).rejects.toThrow("smaller than 2 MB");

    const tooMany = Array.from(
      { length: MAX_AUTHORS + 1 },
      (_, i) => `Author ${String.fromCharCode(65 + (i % 26))}${i}`,
    ).join("\n");
    await expect(tool.execute({ text: tooMany, mode: "replace" })).rejects.toThrow(`limit ${MAX_AUTHORS}`);

    // Combined add cap check.
    const existing = Array.from({ length: MAX_AUTHORS }, (_, i) =>
      createAuthor(`Person ${String.fromCharCode(65 + (i % 26))}${i}`),
    );
    useContributionStore.getState().loadAuthors(existing);
    await expect(tool.execute({ text: "Extra Contributor", mode: "add" })).rejects.toThrow(`limit ${MAX_AUTHORS}`);

    // Claim lock refusal.
    useContributionStore.getState().setClaim({ contributorId: existing[0]?.id ?? "id-0", sourceDraftId: "remote" });
    await expect(tool.execute({ text: "Ada Lovelace", mode: "add" })).rejects.toThrow("locked");
  });
});

describe("set_role", () => {
  it("sets a role by name or id, accepts hyphenated role names, and supports Undo + stale Undo", async () => {
    const statuses: StatusBanner.Status[] = [];
    vi.spyOn(StatusBanner, "showStatus").mockImplementation((s) => statuses.push(s));

    const tool = getTool("set_role");
    expect(tool.annotations).toEqual({ consequentialHint: true });

    const grace = createAuthor("Grace B. Hopper");
    useContributionStore.getState().loadAuthors([grace]);

    const res = await tool.execute({
      author: "grace b. hopper",
      role: "Writing - original draft",
      level: "equal",
    });
    expect(res).toEqual({
      authorId: grace.id,
      role: "Writing – original draft",
      level: "equal",
      score: 66,
    });
    const roleIdx = CREDIT_ROLES.findIndex((r) => r.name === "Writing – original draft");
    expect(useContributionStore.getState().authors[0]?.contributions[roleIdx]?.score).toBe(66);

    // Undo restores previous score (0).
    statuses.at(-1)?.actions?.[0]?.onAct();
    expect(useContributionStore.getState().authors[0]?.contributions[roleIdx]?.score).toBe(0);

    // Set by id, then mutate before Undo -> stale error.
    await tool.execute({ author: grace.id, role: "Software", level: "lead" });
    const toast = statuses.at(-1);
    useContributionStore.getState().setAuthorScore(grace.id, 0, 33);
    toast?.actions?.[0]?.onAct();
    expect(statuses.at(-1)?.kind).toBe("error");
    expect(statuses.at(-1)?.message).toBe("statementUndoStale");
  });

  it("validates author, role, level, ambiguity, and claim lock", async () => {
    const tool = getTool("set_role");
    const a1 = createAuthor("Alex Smith");
    const a2 = createAuthor("Alex Smith");
    const grace = createAuthor("Grace Hopper");
    useContributionStore.getState().loadAuthors([a1, a2, grace]);

    await expect(tool.execute({ author: "", role: "Software", level: "lead" })).rejects.toThrow("non-empty");
    await expect(tool.execute({ author: grace.id, role: 42, level: "lead" })).rejects.toThrow("role must be");
    await expect(tool.execute({ author: grace.id, role: "Coding", level: "lead" })).rejects.toThrow(
      "Unknown CRediT role",
    );
    await expect(tool.execute({ author: grace.id, role: "Software", level: "major" })).rejects.toThrow("Unknown level");
    await expect(tool.execute({ author: "Nobody", role: "Software", level: "lead" })).rejects.toThrow("No contributor");
    await expect(tool.execute({ author: "Alex Smith", role: "Software", level: "lead" })).rejects.toThrow(
      "Multiple contributors",
    );

    // Claim lock: other contributor refused, claimed contributor allowed.
    useContributionStore.getState().setClaim({ contributorId: grace.id, sourceDraftId: "remote" });
    await expect(tool.execute({ author: a1.id, role: "Software", level: "lead" })).rejects.toThrow("locked");
    const ok = await tool.execute({ author: grace.id, role: "Software", level: "supporting" });
    expect(ok).toEqual({ authorId: grace.id, role: "Software", level: "supporting", score: 33 });
  });
});

describe("get_statement", () => {
  it("generates statements in every STATEMENT_FORMATS format with options", async () => {
    const tool = getTool("get_statement");
    expect(tool.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true });

    const grace = createAuthor("Grace B. Hopper");
    setScore(grace, 8, 66); // Software: equal
    const ada = createAuthor("Ada Lovelace", { contributorType: "non-author" });
    setScore(ada, 0, 100); // Conceptualization: lead
    useContributionStore.getState().loadAuthors([grace, ada]);

    // Default format ("by-role").
    const def = (await tool.execute()) as { format: string; statement: string };
    expect(def.format).toBe("by-role");
    expect(def.statement).toContain("CRediT: Software: Grace B. Hopper");
    expect(def.statement).toContain("Acknowledgements: Conceptualization: Ada Lovelace");

    for (const format of STATEMENT_FORMATS) {
      const res = (await tool.execute({ format, showLevels: true, separateAcknowledgements: false })) as {
        format: string;
        statement: string;
      };
      expect(res.format).toBe(format);
      expect(res.statement).toContain("Equal");
      expect(res.statement).not.toContain("Acknowledgements:");
    }

    await expect(tool.execute({ format: "bibtex" })).rejects.toThrow("Unknown statement format");
  });
});
