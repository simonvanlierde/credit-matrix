import { act, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { TEST_ORCID } from "@/core/__tests__/orcid-test-issuer";
import { toSharePayload } from "@/core/share-payload";
import { english } from "@/lib/test-messages";
import { IntlProvider } from "@/lib/translations";
import { messages as en } from "@/locales/en/messages";
import { useContributionStore } from "@/store/contribution-store";
import { ReviewPanel } from "./ReviewPanel";

const ROW_ORCID = "0000-0001-5109-3700";

it("warns when a signed reply put a different iD on the row than the one asked", () => {
  act(() => {
    useContributionStore.getState().createDraft();
    useContributionStore.getState().addAuthor("Charles Darwin", ROW_ORCID);
  });
  const { activeDraftId, authors } = useContributionStore.getState();
  const charles = authors[0];
  if (!charles) throw new Error("expected Charles");
  // Someone holding a forwarded link signs in as themselves and types their own iD into the row.
  act(() => {
    useContributionStore.getState().applyAskStep(activeDraftId, {
      kind: "reply",
      contributorId: charles.id,
      row: { ...charles, orcid: TEST_ORCID, contributions: [{ role: "Investigation", score: 100 }] },
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
  expect(screen.getByText(english.reviewOrcidOtherId)).toBeTruthy();
  expect(screen.queryByText(english.reviewOrcidNoRowId)).toBeNull();
});

it("notes a signed reply on a row with no iD to compare with", () => {
  act(() => {
    useContributionStore.getState().createDraft();
    useContributionStore.getState().addAuthor("Charles Darwin");
  });
  const { activeDraftId, authors } = useContributionStore.getState();
  const charles = authors[0];
  if (!charles) throw new Error("expected Charles");
  act(() => {
    useContributionStore.getState().applyAskStep(activeDraftId, {
      kind: "reply",
      contributorId: charles.id,
      row: { ...charles, contributions: [{ role: "Investigation", score: 100 }] },
      sentAt: 1,
      at: 2,
      orcid: { orcid: TEST_ORCID, name: "Charles Darwin", issuedAt: 1, token: "t", payload: "p" },
    });
  });
  expect(useContributionStore.getState().authors[0]?.orcid).toBeUndefined();

  render(
    <IntlProvider locale="en" messages={en}>
      <ReviewPanel />
    </IntlProvider>,
  );
  expect(screen.getByText(`Verified by ORCID as Charles Darwin (${TEST_ORCID})`, { exact: false })).toBeTruthy();
  expect(screen.getByText(english.reviewOrcidNoRowId)).toBeTruthy();
  expect(screen.queryByText(english.reviewOrcidOtherId)).toBeNull();
});

it("does not show a sign-in an offline import could not check as verified", () => {
  act(() => {
    useContributionStore.getState().createDraft();
    useContributionStore.getState().addAuthor("Charles Darwin", TEST_ORCID);
  });
  const charles = useContributionStore.getState().authors[0];
  if (!charles) throw new Error("expected Charles");
  const orcid = { orcid: TEST_ORCID, name: "Charles Darwin", issuedAt: 1, token: "t", payload: "p" };
  const reply = {
    contributions: [{ role: "Investigation" as const, score: 100 }],
    equalContribution: false,
    corresponding: false,
    sentAt: 1,
    receivedAt: 2,
    provenance: { uncheckedOrcid: orcid },
    decisions: {},
  };
  act(() =>
    useContributionStore.getState().loadAuthors([charles], { [charles.id]: { sentAt: 1, prefilled: true, reply } }),
  );

  const { container } = render(
    <IntlProvider locale="en" messages={en}>
      <ReviewPanel />
    </IntlProvider>,
  );
  expect(screen.getByRole("heading", { name: "Charles Darwin" })).toBeTruthy();
  expect(container.querySelector("[data-orcid-verified]")).toBeNull();
});

it("shows a sign-in given for another row as a warning, not as verified", () => {
  act(() => {
    useContributionStore.getState().createDraft();
    useContributionStore.getState().addAuthor("Charles Darwin", TEST_ORCID);
  });
  const charles = useContributionStore.getState().authors[0];
  if (!charles) throw new Error("expected Charles");
  const orcid = { orcid: TEST_ORCID, name: "Charles Darwin", issuedAt: 1, token: "t", payload: "p" };
  const reply = {
    contributions: [{ role: "Investigation" as const, score: 100 }],
    equalContribution: false,
    corresponding: false,
    sentAt: 1,
    receivedAt: 2,
    provenance: { orcid, signedElsewhere: true as const },
    decisions: {},
  };
  act(() =>
    useContributionStore.getState().loadAuthors([charles], { [charles.id]: { sentAt: 1, prefilled: true, reply } }),
  );

  const { container } = render(
    <IntlProvider locale="en" messages={en}>
      <ReviewPanel />
    </IntlProvider>,
  );
  expect(screen.getByText(/^Not verified for this row: Charles Darwin \(/)).toBeTruthy();
  expect(container.querySelector("[data-orcid-verified]")).toBeNull();
  expect(screen.queryByText("Verified by ORCID", { exact: false })).toBeNull();
});

it("shows the paper title a verified sign-in was given for only when it differs from the draft's", () => {
  act(() => {
    useContributionStore.getState().createDraft();
    useContributionStore.getState().setTitle("Sea otters");
    useContributionStore.getState().addAuthor("Charles Darwin", TEST_ORCID);
  });
  const charles = useContributionStore.getState().authors[0];
  if (!charles) throw new Error("expected Charles");
  const payload = toSharePayload({
    authors: [charles],
    title: "Kelp forests",
    claimId: charles.id,
    sourceDraftId: "d",
    reply: true,
  });
  const orcid = { orcid: TEST_ORCID, name: "Charles Darwin", issuedAt: 1, token: "t", payload };
  const reply = {
    contributions: [{ role: "Investigation" as const, score: 100 }],
    equalContribution: false,
    corresponding: false,
    sentAt: 1,
    receivedAt: 2,
    provenance: { orcid },
    decisions: {},
  };
  act(() =>
    useContributionStore.getState().loadAuthors([charles], { [charles.id]: { sentAt: 1, prefilled: true, reply } }),
  );

  const { container } = render(
    <IntlProvider locale="en" messages={en}>
      <ReviewPanel />
    </IntlProvider>,
  );
  expect(container.querySelector("[data-orcid-verified]")).toBeTruthy();
  expect(screen.getByText("Signed for “Kelp forests”.")).toBeTruthy();

  act(() => useContributionStore.getState().setTitle("Kelp forests"));
  expect(container.querySelector("[data-orcid-verified]")).toBeTruthy();
  expect(container.querySelector("[data-orcid-signed-for]")).toBeNull();
});
