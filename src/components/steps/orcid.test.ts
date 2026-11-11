import { describe, expect, it } from "vitest";
import { nameBesideOrcid } from "./orcid";

const ID = "0000-0002-1825-0097";

describe("nameBesideOrcid", () => {
  it.each([
    [`Grace Hopper ${ID}`, "Grace Hopper"],
    [`${ID} Grace Hopper`, "Grace Hopper"],
    [`Grace Hopper (https://orcid.org/${ID})`, "Grace Hopper"],
    [`Grace Hopper – ORCID iD: ${ID}`, "Grace Hopper"],
    [`Hopper, Grace ${ID}`, "Hopper, Grace"],
    [`王小明：${ID}`, "王小明"],
    [`（王小明、${ID}）`, "王小明"],
  ])("finds the name in %s", (text, name) => {
    expect(nameBesideOrcid(text)).toBe(name);
  });

  it.each([ID, `https://orcid.org/${ID}`, `orcid.org/${ID}`, `ORCID: ${ID}`, `(${ID})`])(
    "finds none beside a bare iD: %s",
    (text) => {
      expect(nameBesideOrcid(text)).toBeNull();
    },
  );

  it("takes linear time over a long run of spaces", () => {
    const started = performance.now();
    expect(nameBesideOrcid(`Jane${" ".repeat(100_000)}x ${ID}`)).toBe("Jane x");
    expect(performance.now() - started).toBeLessThan(200);
  });
});
