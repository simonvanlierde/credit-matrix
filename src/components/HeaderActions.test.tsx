import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createAuthor, toJson } from "@/core";
import { buildShareUrl } from "@/lib/share";
import { english } from "@/lib/test-messages";
import { IntlProvider } from "@/lib/translations";
import { messages as en } from "@/locales/en/messages";
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
  act(() => useContributionStore.getState().setToolchain("word"));
  const link = await buildShareUrl({ authors: [createAuthor("Ada Lovelace")], toolchain: "quarto" });
  // A queued navigation event keeps its URL when the address bar has already changed.
  expect(window.location.hash).toBe("");
  window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL: window.location.href, newURL: link }));

  expect(await screen.findByText("Opened the shared draft.")).toBeTruthy();
  expect(useContributionStore.getState().authors.map((author) => author.name)).toEqual(["Ada Lovelace"]);
  expect(useContributionStore.getState().toolchain).toBe("quarto");
  expect(useContributionStore.getState().lastToolchain).toBe("word");
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

/** Grace asked in a fresh draft, and a reply link from her claiming a role by `sentAt`. */
async function graceAsked() {
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
    useContributionStore.getState().addAuthor("Grace Hopper");
  });
  const state = useContributionStore.getState();
  const grace = state.authors[0];
  if (!grace) throw new Error("expected Grace");
  const draftId = state.activeDraftId;
  const reply = (role: number, sentAt: number) =>
    buildShareUrl({
      authors: [
        createAuthor(grace.name, {
          id: grace.id,
          contributions: grace.contributions.map((c, index) => ({ ...c, score: index === role ? 100 : 0 })),
        }),
      ],
      claimId: grace.id,
      sourceDraftId: draftId,
      reply: true,
      sentAt,
    });
  return { grace, draftId, reply };
}

it("keeps the row mark of a newer reply from the same person when it replaces the strip", async () => {
  const { grace, reply } = await graceAsked();
  await openReply(await reply(0, 5), grace.id, 5);
  expect(useContributionStore.getState().recentReply).toBe(grace.id);
  await openReply(await reply(1, 6), grace.id, 6);
  expect(useContributionStore.getState().recentReply).toBe(grace.id);
});

it("takes the arrival strip down once the lead decides on that reply", async () => {
  const { grace, draftId, reply } = await graceAsked();
  await openReply(await reply(0, 5), grace.id, 5);
  expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  act(() => {
    useContributionStore
      .getState()
      .applyAskStep(draftId, { kind: "settle", contributorId: grace.id, choices: "theirs", at: 7 });
  });
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  expect(useContributionStore.getState().recentReply).toBeNull();
});

it("leaves the strip's Undo on its own reply when other rows are asked meanwhile", async () => {
  const { grace, draftId, reply } = await graceAsked();
  act(() => {
    useContributionStore.getState().addAuthor("Charles Darwin");
  });
  const charles = useContributionStore.getState().authors[1];
  if (!charles) throw new Error("expected Charles");
  await openReply(await reply(0, 5), grace.id, 5);
  act(() => {
    useContributionStore
      .getState()
      .applyAskStep(draftId, { kind: "sent", contributorId: charles.id, prefilled: false, at: 6 });
  });
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  const { asks } = useContributionStore.getState();
  expect(asks[grace.id]).toBeUndefined();
  expect(asks[charles.id]).toEqual({ sentAt: 6, prefilled: false });
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
    useContributionStore.getState().addAuthor("Katherine Johnson");
  });
  const held = useContributionStore.getState().activeDraftId;
  full.mockRestore();

  const link = await buildShareUrl({ authors: [createAuthor("Ben Shared")] });
  window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL: window.location.href, newURL: link }));

  expect(await screen.findByText("Opened the shared draft beside your own work.")).toBeTruthy();
  expect(useContributionStore.getState().drafts[held]?.authors.map((author) => author.name)).toEqual([
    "Katherine Johnson",
  ]);
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
      useContributionStore.getState().addAuthor("Ada Lovelace");
    });
    fireEvent.click(screen.getByRole("button", { name: english.import }));
    fireEvent.change(screen.getByLabelText(english.pasteRawData), { target: { value: "AL: conceptualization." } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: english.statementReview })));
    fireEvent.click(screen.getByRole("button", { name: english.statementApply }));
    const ada = useContributionStore.getState().authors[0];
    if (!ada) throw new Error("expected Ada");
    return ada;
  }
  const score = (role: string) =>
    useContributionStore.getState().authors[0]?.contributions.find((c) => c.role === role)?.score;

  it("takes the roles back", async () => {
    await applyStatement();
    expect(score("Conceptualization")).toBe(100);
    fireEvent.click(screen.getByRole("button", { name: english.undo }));
    expect(score("Conceptualization")).toBe(0);
  });

  it("keeps an edit made after applying, and says why nothing was undone", async () => {
    const ada = await applyStatement();
    act(() => useContributionStore.getState().setAuthorScore(ada.id, 1, 100));
    fireEvent.click(screen.getByRole("button", { name: english.undo }));
    expect(score("Conceptualization")).toBe(100);
    expect(score("Data curation")).toBe(100);
    expect(screen.getByText(english.statementUndoStale)).toBeTruthy();
  });
});

describe("importing over a draft", () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.open = false;
    };
  });

  /** A draft holding Ada Lovelace, and the import dialog filled with `text` and submitted. */
  async function importOver(text: string) {
    render(
      <IntlProvider locale="en" messages={en}>
        <HeaderActions />
        <StatusBanner />
      </IntlProvider>,
    );
    await act(() => useContributionStore.persist.rehydrate());
    act(() => {
      useContributionStore.getState().createDraft();
      useContributionStore.getState().addAuthor("Ada Lovelace");
    });
    const ada = useContributionStore.getState().authors[0];
    fireEvent.click(screen.getByRole("button", { name: english.import }));
    fireEvent.change(screen.getByLabelText(english.pasteRawData), { target: { value: text } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: english.importData })));
    return ada;
  }
  const names = () => useContributionStore.getState().authors.map((author) => author.name);

  it("replaces with an Undo that brings the draft back", async () => {
    await importOver("Grace Hopper");
    fireEvent.click(screen.getByRole("button", { name: english.replaceWorkspace }));
    expect(names()).toEqual(["Grace Hopper"]);
    expect(screen.getByText("Imported 1 contributor.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: english.undo }));
    expect(names()).toEqual(["Ada Lovelace"]);
  });

  it("restores a JSON toolchain on replace and its previous choice on Undo", async () => {
    await importOver(toJson([createAuthor("Grace Hopper")], { toolchain: "typst" }));
    act(() => useContributionStore.getState().setToolchain("word"));
    fireEvent.click(screen.getByRole("button", { name: english.replaceWorkspace }));
    expect(useContributionStore.getState().toolchain).toBe("typst");
    expect(useContributionStore.getState().lastToolchain).toBe("word");
    fireEvent.click(screen.getByRole("button", { name: english.undo }));
    expect(useContributionStore.getState().toolchain).toBe("word");
  });

  it("undoes a replace that set no toolchain after a tool is picked", async () => {
    await importOver("Grace Hopper");
    fireEvent.click(screen.getByRole("button", { name: english.replaceWorkspace }));
    act(() => useContributionStore.getState().setToolchain("quarto"));
    fireEvent.click(screen.getByRole("button", { name: english.undo }));
    expect(names()).toEqual(["Ada Lovelace"]);
    expect(useContributionStore.getState().toolchain).toBe("quarto");
  });

  it("imports a file naming an unknown toolchain and says it was left out", async () => {
    await importOver(JSON.stringify({ ...JSON.parse(toJson([createAuthor("Grace Hopper")])), toolchain: "rmarkdown" }));
    expect(screen.getByText(english.importToolchainDropped)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: english.replaceWorkspace }));
    expect(names()).toEqual(["Grace Hopper"]);
  });

  it("keeps the current toolchain when adding contributors from another toolchain", async () => {
    await importOver(toJson([createAuthor("Grace Hopper")], { toolchain: "typst" }));
    act(() => useContributionStore.getState().setToolchain("word"));
    fireEvent.click(screen.getByRole("button", { name: "Add 1 new" }));
    expect(useContributionStore.getState().toolchain).toBe("word");
  });

  it("adds only the new contributors and keeps the ones already here", async () => {
    const ada = await importOver("Ada Lovelace\nGrace Hopper");
    fireEvent.click(screen.getByRole("button", { name: "Add 1 new" }));
    expect(names()).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect(useContributionStore.getState().authors[0]?.id).toBe(ada?.id);
    expect(screen.getByText("Added 1 contributor to this draft.")).toBeTruthy();
  });

  it("brings the answers a file holds for the contributors it adds", async () => {
    const ada = createAuthor("Ada Lovelace");
    const grace = createAuthor("Grace Hopper");
    const asks = { [ada.id]: { sentAt: 1, prefilled: false }, [grace.id]: { sentAt: 2, prefilled: false } };
    await importOver(toJson([ada, grace], { asks }));
    fireEvent.click(screen.getByRole("button", { name: "Add 1 new" }));
    const state = useContributionStore.getState();
    expect(state.asks[grace.id]).toEqual(asks[grace.id]);
    // Ada was already here: her row and its asks stay the draft's.
    expect(state.authors[0]?.id).not.toBe(ada.id);
    expect(Object.keys(state.asks)).toEqual([grace.id]);
  });

  const askGrace = () => {
    const { activeDraftId, authors } = useContributionStore.getState();
    const grace = authors.find((author) => author.name === "Grace Hopper");
    if (!grace) throw new Error("expected Grace");
    useContributionStore
      .getState()
      .applyAskStep(activeDraftId, { kind: "sent", contributorId: grace.id, prefilled: false, at: 9 });
  };
  const markGrace = () => {
    const grace = useContributionStore.getState().authors.find((author) => author.name === "Grace Hopper");
    useContributionStore.getState().setSelfId(grace?.id ?? null);
  };
  const retitle = () => useContributionStore.getState().setTitle("A newer title");

  it.each([
    ["an ask sent", askGrace],
    ["the you mark set", markGrace],
    ["the title edited", retitle],
  ])("refuses Undo of a replace after %s, and keeps it", async (_, change) => {
    await importOver("Grace Hopper");
    fireEvent.click(screen.getByRole("button", { name: english.replaceWorkspace }));
    act(change);
    const after = useContributionStore.getState();
    fireEvent.click(screen.getByRole("button", { name: english.undo }));
    const now = useContributionStore.getState();
    expect(names()).toEqual(["Grace Hopper"]);
    expect([now.asks, now.selfId, now.title]).toEqual([after.asks, after.selfId, after.title]);
    expect(screen.getByText(english.importUndoStale)).toBeTruthy();
  });

  it.each([
    ["an ask sent", askGrace],
    ["the you mark set", markGrace],
    ["the title edited", retitle],
  ])("refuses Undo of an add after %s, and keeps it", async (_, change) => {
    await importOver("Ada Lovelace\nGrace Hopper");
    fireEvent.click(screen.getByRole("button", { name: "Add 1 new" }));
    act(change);
    const after = useContributionStore.getState();
    fireEvent.click(screen.getByRole("button", { name: english.undo }));
    const now = useContributionStore.getState();
    expect(names()).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect([now.asks, now.selfId, now.title]).toEqual([after.asks, after.selfId, after.title]);
    expect(screen.getByText(english.importUndoStale)).toBeTruthy();
  });
});

describe("a newer request in the claim draft", () => {
  /** Grace's request from another browser, sent at `sentAt`, and the claim draft it opened. */
  async function requested() {
    render(
      <IntlProvider locale="en" messages={en}>
        <HeaderActions />
        <StatusBanner />
      </IntlProvider>,
    );
    const grace = createAuthor("Grace Hopper");
    const request = (sentAt: number, title: string) =>
      buildShareUrl({ authors: [grace], title, claimId: grace.id, sourceDraftId: "elsewhere", sentAt });
    const open = (link: string) =>
      window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL: window.location.href, newURL: link }));
    open(await request(1, "First ask"));
    await waitFor(() => expect(useContributionStore.getState().claim?.sentAt).toBe(1));
    open(await request(2, "Second ask"));
    await screen.findByText(english.claimRequestUpdated);
    return grace;
  }

  it("undoes to the earlier answers while the draft is untouched", async () => {
    await requested();
    fireEvent.click(screen.getByRole("button", { name: english.undo }));
    const state = useContributionStore.getState();
    expect([state.title, state.claim?.sentAt]).toEqual(["First ask", 1]);
  });

  it("refuses Undo once an answer changed since, and keeps that answer", async () => {
    const grace = await requested();
    act(() => useContributionStore.getState().setAuthorScore(grace.id, 0, 100));
    fireEvent.click(screen.getByRole("button", { name: english.undo }));
    const state = useContributionStore.getState();
    expect(state.authors[0]?.contributions[0]?.score).toBe(100);
    expect([state.title, state.claim?.sentAt]).toEqual(["Second ask", 2]);
    expect(screen.getByText(english.claimUndoStale)).toBeTruthy();
  });
});
