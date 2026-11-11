import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { copyAskMessage } from "@/lib/ask-message";
import { english } from "@/lib/test-messages";
import { IntlProvider } from "@/lib/translations";
import { messages as en } from "@/locales/en/messages";
import { useContributionStore } from "@/store/contribution-store";
import { TeamPanel } from "./TeamPanel";

vi.mock("@/lib/ask-message", () => ({ copyAskMessage: vi.fn() }));

it("skips someone removed mid-queue and still asks everyone after them", async () => {
  vi.mocked(copyAskMessage).mockResolvedValue(true);
  act(() => {
    const store = useContributionStore.getState();
    store.createDraft();
    for (const name of ["Ada Lovelace", "Charles Darwin", "Grace Hopper"])
      useContributionStore.getState().addAuthor(name);
  });
  render(
    <IntlProvider locale="en" messages={en}>
      <TeamPanel />
    </IntlProvider>,
  );
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Ask everyone/ })));
  const charles = useContributionStore.getState().authors.find((author) => author.name === "Charles Darwin");
  act(() => useContributionStore.getState().removeAuthor(charles?.id ?? ""));

  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy next: Grace Hopper (2 of 2)" })));

  expect(vi.mocked(copyAskMessage).mock.calls.map(([author]) => author.name)).toEqual(["Ada Lovelace", "Grace Hopper"]);
});

it("ends the queue when everyone left in it is removed", async () => {
  vi.mocked(copyAskMessage).mockResolvedValue(true);
  act(() => {
    useContributionStore.getState().createDraft();
    for (const name of ["Ada Lovelace", "Charles Darwin", "Grace Hopper"])
      useContributionStore.getState().addAuthor(name);
  });
  render(
    <IntlProvider locale="en" messages={en}>
      <TeamPanel />
    </IntlProvider>,
  );
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Ask everyone/ })));
  act(() => {
    for (const author of useContributionStore.getState().authors.filter((a) => a.name !== "Ada Lovelace")) {
      useContributionStore.getState().removeAuthor(author.id);
    }
  });

  expect(screen.queryByRole("button", { name: english.cancel })).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Ask everyone/ })));
  expect(vi.mocked(copyAskMessage)).toHaveBeenCalledTimes(2);
});

it("clears the copied confirmation after five seconds and offers the copy again", async () => {
  vi.mocked(copyAskMessage).mockResolvedValue(true);
  act(() => {
    useContributionStore.getState().createDraft();
    for (const name of ["Ada Lovelace", "Charles Darwin"]) useContributionStore.getState().addAuthor(name);
  });
  render(
    <IntlProvider locale="en" messages={en}>
      <TeamPanel />
    </IntlProvider>,
  );
  vi.useFakeTimers();
  try {
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy message for Ada Lovelace" })));
    expect(screen.getByText(/Message for Ada Lovelace copied/)).toBeTruthy();
    act(() => vi.advanceTimersByTime(4900));
    expect(screen.getByText(/Message for Ada Lovelace copied/)).toBeTruthy();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText(/Message for Ada Lovelace copied/)).toBeNull();
    expect(screen.getByRole("button", { name: "Copy message for Ada Lovelace" }).textContent).not.toMatch(/Copied/);
  } finally {
    vi.useRealTimers();
  }
});
