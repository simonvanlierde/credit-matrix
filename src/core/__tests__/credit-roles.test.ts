import { describe, expect, it } from "vitest";
import { CREDIT_ROLES, getRoleByName } from "../credit-roles";

describe("CREDIT_ROLES", () => {
  it("defines exactly the 14 NISO roles with unique names, official UUIDs, and URLs", () => {
    expect(CREDIT_ROLES).toHaveLength(14);

    const names = CREDIT_ROLES.map((r) => r.name);
    expect(new Set(names).size).toBe(14);

    const ids = CREDIT_ROLES.map((r) => r.id);
    expect(new Set(ids).size).toBe(14);

    for (const role of CREDIT_ROLES) {
      expect(role.description.length).toBeGreaterThan(0);
      expect(role.url).toMatch(/^https:\/\/credit\.niso\.org\/contributor-roles\//);
      // Official NISO role UUID (e.g. 8b73531f-db56-4914-9502-4cc4d4d8ed73).
      expect(role.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  // Share links store scores by position, so reordering or renaming a role
  // silently reassigns every link already out there.
  it("keeps the role names in the order share links depend on", () => {
    expect(CREDIT_ROLES.map((r) => r.name)).toEqual([
      "Conceptualization",
      "Data curation",
      "Formal analysis",
      "Funding acquisition",
      "Investigation",
      "Methodology",
      "Project administration",
      "Resources",
      "Software",
      "Supervision",
      "Validation",
      "Visualization",
      "Writing \u2013 original draft",
      "Writing \u2013 review & editing",
    ]);
  });

  it("uses NISO's canonical role names (e.g. lowercase 'Formal analysis')", () => {
    const names = CREDIT_ROLES.map((r) => r.name);
    expect(names).toContain("Formal analysis");
    expect(names).not.toContain("Formal Analysis");
  });
});

describe("getRoleByName", () => {
  it("returns the matching role", () => {
    expect(getRoleByName("Software").url).toBe("https://credit.niso.org/contributor-roles/software/");
  });

  it("throws on an unknown role", () => {
    expect(() => getRoleByName("Nonexistent")).toThrow(/Unknown CRediT role/);
  });
});
