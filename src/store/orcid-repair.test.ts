import { expect, it } from "vitest";
import { type Draft, useContributionStore } from "./contribution-store";

it("rehydrates a hand-edited stored ORCID iD in its canonical form", () => {
  const initial = useContributionStore.getState();
  const merged = useContributionStore.persist.getOptions().merge?.(
    {
      activeDraftId: "d1",
      drafts: { d1: { authors: [{ name: "Ada Lovelace", orcid: " orcid.org/0000-0002-1694-233x/" }] } },
    },
    initial,
  ) as { drafts: Record<string, Draft> };
  expect(merged.drafts.d1?.authors[0]?.orcid).toBe("0000-0002-1694-233X");
});
