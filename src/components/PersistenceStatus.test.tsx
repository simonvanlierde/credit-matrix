import { act, render, screen, waitFor } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { beforeEach, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import { useContributionStore } from "@/store/contribution-store";
import { PERSIST_KEY } from "@/store/persist-meta";
import { PersistenceStatus } from "./PersistenceStatus";
import { StatusBanner, showStatus } from "./StatusBanner";

const initial = useContributionStore.getState();
beforeEach(() => {
  useContributionStore.setState(initial, true);
  globalThis.localStorage.clear();
});

async function renderStatus() {
  render(
    <IntlProvider locale="en" messages={en}>
      <PersistenceStatus />
      <StatusBanner />
    </IntlProvider>,
  );
  await waitFor(() => expect(useContributionStore.persist.hasHydrated()).toBe(true));
}

/** Make the browser refuse saves with `error` while `edit` runs. */
function refusing(error: DOMException, edit: () => void) {
  const refuse = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw error;
  });
  act(edit);
  refuse.mockRestore();
}

it("keeps saying saving stopped when another status shows", async () => {
  await renderStatus();
  refusing(new DOMException("full", "QuotaExceededError"), () => useContributionStore.getState().setTitle("Lost"));
  act(() => showStatus({ kind: "success", message: "Link copied." }));

  expect(screen.getByRole("alert").textContent).toBe(en.errStorageFull);
  expect(screen.getByText("Link copied.")).toBeTruthy();
});

it("says the browser blocks storage when that is why saving stopped, and leaves once saving works", async () => {
  await renderStatus();
  refusing(new DOMException("insecure", "SecurityError"), () => useContributionStore.getState().setTitle("Lost"));
  expect(screen.getByRole("alert").textContent).toBe(en.errStorageBlocked);

  act(() => useContributionStore.getState().setTitle("Saved"));
  expect(screen.getByRole("alert").textContent).toBe("");
});

it("restores the saved drafts and follows another tab's saves", async () => {
  await renderStatus();
  act(() => useContributionStore.getState().setTitle("Here"));

  const saved = JSON.parse(globalThis.localStorage.getItem(PERSIST_KEY) ?? "{}");
  saved.state.drafts[useContributionStore.getState().activeDraftId].title = "Edited there";
  globalThis.localStorage.setItem(PERSIST_KEY, JSON.stringify(saved));
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: PERSIST_KEY, storageArea: globalThis.localStorage }));
  });

  expect(useContributionStore.getState().title).toBe("Edited there");
  expect(screen.getByText(en.draftUpdatedElsewhere)).toBeTruthy();
});
