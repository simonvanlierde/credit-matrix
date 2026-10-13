import { act, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { beforeEach, expect, it } from "vitest";
import en from "@/messages/en.json";
import { useContributionStore } from "@/store/contribution-store";
import { PersistenceStatus } from "./PersistenceStatus";
import { StatusBanner, showStatus } from "./StatusBanner";

const initial = useContributionStore.getState();
beforeEach(() => useContributionStore.setState(initial, true));

function renderStatus() {
  render(
    <IntlProvider locale="en" messages={en}>
      <PersistenceStatus />
      <StatusBanner />
    </IntlProvider>,
  );
}

it("keeps saying saving stopped when another status shows", () => {
  renderStatus();
  act(() => useContributionStore.setState({ saveFailure: "full" }));
  act(() => showStatus({ kind: "success", message: "Link copied." }));

  expect(screen.getByRole("alert").textContent).toBe(en.errStorageFull);
  expect(screen.getByText("Link copied.")).toBeTruthy();
});

it("says the browser blocks storage when that is why saving stopped, and leaves once saving works", () => {
  renderStatus();
  act(() => useContributionStore.setState({ saveFailure: "blocked" }));
  expect(screen.getByRole("alert").textContent).toBe(en.errStorageBlocked);

  act(() => useContributionStore.setState({ saveFailure: null }));
  expect(screen.getByRole("alert").textContent).toBe("");
});
