import { expect, it } from "vitest";
import { useContributionStore } from "@/store/contribution-store";
import { toJats4rXml } from "../export/xml";

// The JATS export of the sample draft, kept as a file so `pnpm validate:jats`
// can check it against the JATS 1.3 DTD. A change to the export fails here
// until the fixture is regenerated (`pnpm vitest run -u`) and validated again.
it("exports the sample draft as the JATS fixture", async () => {
  const store = useContributionStore.getState();
  store.loadSample(["Ada Lovelace", "Rosalind E. Franklin", "Alan M. Turing"]);
  const [ada, rosalind, alan] = useContributionStore.getState().authors;
  if (!(ada && rosalind && alan)) throw new Error("expected three sample authors");

  // Cover every optional element and attribute the export can write.
  const authors = [
    { ...ada, orcid: "0000-0002-1825-0097", corresponding: true, equalContribution: true },
    { ...rosalind, equalContribution: true },
    { ...alan, contributorType: "non-author" as const },
  ];

  await expect(toJats4rXml(authors)).toMatchFileSnapshot("./fixtures/sample.jats.xml");
});
