// biome-ignore-all lint/correctness/noNodejsModules: reads the source catalogs.
import { readdirSync, readFileSync } from "node:fs";
import { parsePoFile } from "@lingui/format-po";
import { describe, expect, it } from "vitest";
import { cast } from "@/core/__tests__/cast";

// "Load sample data" seeds one row per sample name and drops names past the third role set.
const SAMPLE_SIZE = 3;

const sampleNames = (locale: string) =>
  parsePoFile(readFileSync(`src/locales/${locale}/messages.po`, "utf8"))
    .items.find((item) => item.msgid === "sampleNames")
    ?.msgstr[0]?.split("\n") ?? [];

describe("sampleNames", () => {
  it("is the cast's English trio, so e2e tests can name the people the sample loads", () => {
    expect(sampleNames("en")).toEqual([cast.ada, cast.rosalind, cast.alan]);
  });

  it.each(readdirSync("src/locales", { withFileTypes: true }).filter((entry) => entry.isDirectory()))(
    "lists $name sample people, one per role set",
    ({ name }) => {
      const names = sampleNames(name);
      expect(names).toHaveLength(SAMPLE_SIZE);
      expect(new Set(names).size).toBe(SAMPLE_SIZE);
    },
  );
});
