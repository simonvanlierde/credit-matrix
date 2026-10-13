import { act, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { expect, it, vi } from "vitest";
import { copyAskMessage } from "@/lib/ask-message";
import en from "@/messages/en.json";
import { useContributionStore } from "@/store/contribution-store";
import { TeamPanel } from "./TeamPanel";

vi.mock("@/lib/ask-message", () => ({ copyAskMessage: vi.fn() }));

it("skips someone removed mid-queue and still asks everyone after them", async () => {
  vi.mocked(copyAskMessage).mockResolvedValue(true);
  act(() => {
    const store = useContributionStore.getState();
    store.createDraft();
    for (const name of ["Ann One", "Bob Two", "Cat Three"]) useContributionStore.getState().addAuthor(name);
  });
  render(
    <IntlProvider locale="en" messages={en}>
      <TeamPanel />
    </IntlProvider>,
  );
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Ask everyone/ })));
  const bob = useContributionStore.getState().authors.find((author) => author.name === "Bob Two");
  act(() => useContributionStore.getState().removeAuthor(bob?.id ?? ""));

  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy next: Cat Three (2 of 2)" })));

  expect(vi.mocked(copyAskMessage).mock.calls.map(([author]) => author.name)).toEqual(["Ann One", "Cat Three"]);
});
