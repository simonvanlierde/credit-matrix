import { act, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { expect, it } from "vitest";
import { TEST_ORCID } from "@/core/__tests__/orcid-test-issuer";
import en from "@/messages/en.json";
import { useContributionStore } from "@/store/contribution-store";
import { ReviewPanel } from "./ReviewPanel";

const ROW_ORCID = "0000-0001-5109-3700";

it("warns when a signed reply put a different iD on the row than the one asked", () => {
  act(() => {
    useContributionStore.getState().createDraft();
    useContributionStore.getState().addAuthor("Bob White", ROW_ORCID);
  });
  const { activeDraftId, authors } = useContributionStore.getState();
  const bob = authors[0];
  if (!bob) throw new Error("expected Bob");
  // Someone holding a forwarded link signs in as themselves and types their own iD into the row.
  act(() => {
    useContributionStore.getState().applyAskStep(activeDraftId, {
      kind: "reply",
      contributorId: bob.id,
      row: { ...bob, orcid: TEST_ORCID, contributions: [{ role: "Investigation", score: 100 }] },
      sentAt: 1,
      at: 2,
      orcid: { orcid: TEST_ORCID, name: "Eve Other", issuedAt: 1, token: "t", payload: "p" },
    });
  });
  expect(useContributionStore.getState().authors[0]?.orcid).toBe(TEST_ORCID);

  render(
    <IntlProvider locale="en" messages={en}>
      <ReviewPanel />
    </IntlProvider>,
  );
  expect(screen.getByText(`Verified by ORCID as Eve Other (${TEST_ORCID})`, { exact: false })).toBeTruthy();
  expect(screen.getByText(en.reviewOrcidOtherId)).toBeTruthy();
});
