// biome-ignore-all lint/correctness/noNodejsModules: lists the locale folders.
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cast } from "@/core/__tests__/cast";
import { catalog, english } from "@/lib/test-messages";

// "Load sample data" seeds one row per sample name and drops names past the third role set.
const SAMPLE_SIZE = 3;

describe("sampleNames", () => {
  it("is the cast's English trio, so e2e tests can name the people the sample loads", () => {
    expect(english.sampleNames.split("\n")).toEqual([cast.ada, cast.rosalind, cast.alan]);
  });

  it.each(readdirSync("src/locales", { withFileTypes: true }).filter((entry) => entry.isDirectory()))(
    "lists $name sample people, one per role set",
    ({ name }) => {
      const names = catalog(name).sampleNames.split("\n");
      expect(names).toHaveLength(SAMPLE_SIZE);
      expect(new Set(names).size).toBe(SAMPLE_SIZE);
    },
  );
});
