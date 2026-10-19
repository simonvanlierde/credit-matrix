import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { IntlProvider } from "use-intl";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createAuthor } from "@/core";
import { buildShareUrl } from "@/lib/share";
import en from "@/messages/en.json";
import { useContributionStore } from "@/store/contribution-store";
import { HeaderActions } from "./HeaderActions";
import { StatusBanner } from "./StatusBanner";

it("opens a link even when the address bar lost its hash before hashchange fired", async () => {
  render(
    <IntlProvider locale="en" messages={en}>
      <HeaderActions />
      <StatusBanner />
    </IntlProvider>,
  );
  const link = await buildShareUrl({ authors: [createAuthor("Ann One")] });
  // Next.js syncs its router to the URL the previous link's handler left
  // behind, and that write can land after the next hash navigation: the
  // event still names the link, the address bar no longer does.
  expect(window.location.hash).toBe("");
  window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL: window.location.href, newURL: link }));

  expect(await screen.findByText("Opened the shared draft.")).toBeTruthy();
  expect(useContributionStore.getState().authors.map((author) => author.name)).toEqual(["Ann One"]);
});

it("clears ORCID's tokens and the pending sign-in when no ask is open to take them", async () => {
  sessionStorage.setItem("credit-matrix:orcid-sign-in", JSON.stringify({ state: "s", nonce: "n", payload: "p" }));
  window.history.replaceState(null, "", "/#access_token=a&id_token=b.c.d&state=s");
  render(
    <IntlProvider locale="en" messages={en}>
      <HeaderActions />
    </IntlProvider>,
  );
  await waitFor(() => expect(window.location.hash).toBe(""));
  expect(sessionStorage.getItem("credit-matrix:orcid-sign-in")).toBeNull();
});

/** Open a reply link and wait until its answer, sent at `sentAt`, is held. */
async function openReply(link: string, contributorId: string, sentAt: number) {
  window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL: window.location.href, newURL: link }));
  await waitFor(() => expect(useContributionStore.getState().asks[contributorId]?.reply?.sentAt).toBe(sentAt));
}

/** Jane asked in a fresh draft, and a reply link from her claiming a role by `sentAt`. */
async function janeAsked() {
  render(
    <StrictMode>
      <IntlProvider locale="en" messages={en}>
        <HeaderActions />
        <StatusBanner />
      </IntlProvider>
    </StrictMode>,
  );
  await act(() => useContributionStore.persist.rehydrate());
  const store = useContributionStore.getState();
  act(() => {
    store.createDraft();
    useContributionStore.getState().addAuthor("Jane Smith");
  });
  const state = useContributionStore.getState();
  const jane = state.authors[0];
  if (!jane) throw new Error("expected Jane");
  const draftId = state.activeDraftId;
  const reply = (role: number, sentAt: number) =>
    buildShareUrl({
      authors: [
        createAuthor(jane.name, {
          id: jane.id,
          contributions: jane.contributions.map((c, index) => ({ ...c, score: index === role ? 100 : 0 })),
        }),
      ],
      claimId: jane.id,
      sourceDraftId: draftId,
      reply: true,
      sentAt,
    });
  return { jane, draftId, reply };
}

it("keeps the row mark of a newer reply from the same person when it replaces the strip", async () => {
  const { jane, reply } = await janeAsked();
  await openReply(await reply(0, 5), jane.id, 5);
  expect(useContributionStore.getState().recentReply).toBe(jane.id);
  await openReply(await reply(1, 6), jane.id, 6);
  expect(useContributionStore.getState().recentReply).toBe(jane.id);
});

it("takes the arrival strip down once the lead decides on that reply", async () => {
  const { jane, draftId, reply } = await janeAsked();
  await openReply(await reply(0, 5), jane.id, 5);
  expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  act(() => {
    useContributionStore
      .getState()
      .applyAskStep(draftId, { kind: "settle", contributorId: jane.id, choices: "theirs", at: 7 });
  });
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  expect(useContributionStore.getState().recentReply).toBeNull();
});

it("leaves the strip's Undo on its own reply when other rows are asked meanwhile", async () => {
  const { jane, draftId, reply } = await janeAsked();
  act(() => {
    useContributionStore.getState().addAuthor("Bob White");
  });
  const bob = useContributionStore.getState().authors[1];
  if (!bob) throw new Error("expected Bob");
  await openReply(await reply(0, 5), jane.id, 5);
  act(() => {
    useContributionStore
      .getState()
      .applyAskStep(draftId, { kind: "sent", contributorId: bob.id, prefilled: false, at: 6 });
  });
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  const { asks } = useContributionStore.getState();
  expect(asks[jane.id]).toBeUndefined();
  expect(asks[bob.id]).toEqual({ sentAt: 6, prefilled: false });
});

it("keeps what this tab holds unsaved when a link opens", async () => {
  render(
    <IntlProvider locale="en" messages={en}>
      <HeaderActions />
      <StatusBanner />
    </IntlProvider>,
  );
  await act(() => useContributionStore.persist.rehydrate());
  // The browser refuses the save, so the edit lives in memory only.
  const full = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("full", "QuotaExceededError");
  });
  act(() => {
    useContributionStore.getState().createDraft();
    useContributionStore.getState().addAuthor("Ann Unsaved");
  });
  const held = useContributionStore.getState().activeDraftId;
  full.mockRestore();

  const link = await buildShareUrl({ authors: [createAuthor("Ben Shared")] });
  window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL: window.location.href, newURL: link }));

  expect(await screen.findByText("Opened the shared draft beside your own work.")).toBeTruthy();
  expect(useContributionStore.getState().drafts[held]?.authors.map((author) => author.name)).toEqual(["Ann Unsaved"]);
});

describe("Undo after a pasted statement", () => {
  beforeAll(() => {
    // jsdom has no modal dialog API; stand in for the two calls useModalDialog makes.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.open = false;
    };
  });

  async function applyStatement() {
    render(
      <IntlProvider locale="en" messages={en}>
        <HeaderActions />
        <StatusBanner />
      </IntlProvider>,
    );
    await act(() => useContributionStore.persist.rehydrate());
    act(() => {
      useContributionStore.getState().createDraft();
      useContributionStore.getState().addAuthor("Ann Bell");
    });
    fireEvent.click(screen.getByRole("button", { name: en.import }));
    fireEvent.change(screen.getByLabelText(en.pasteRawData), { target: { value: "AB: conceptualization." } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: en.statementReview })));
    fireEvent.click(screen.getByRole("button", { name: en.statementApply }));
    const ann = useContributionStore.getState().authors[0];
    if (!ann) throw new Error("expected Ann");
    return ann;
  }
  const score = (role: string) =>
    useContributionStore.getState().authors[0]?.contributions.find((c) => c.role === role)?.score;

  it("takes the roles back", async () => {
    await applyStatement();
    expect(score("Conceptualization")).toBe(100);
    fireEvent.click(screen.getByRole("button", { name: en.undo }));
    expect(score("Conceptualization")).toBe(0);
  });

  it("keeps an edit made after applying, and says why nothing was undone", async () => {
    const ann = await applyStatement();
    act(() => useContributionStore.getState().setAuthorScore(ann.id, 1, 100));
    fireEvent.click(screen.getByRole("button", { name: en.undo }));
    expect(score("Conceptualization")).toBe(100);
    expect(score("Data curation")).toBe(100);
    expect(screen.getByText(en.statementUndoStale)).toBeTruthy();
  });
});
