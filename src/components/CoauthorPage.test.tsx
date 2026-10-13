import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { expect, it, vi } from "vitest";
import { decodeShareHash } from "@/core";
import en from "@/messages/en.json";
import { useContributionStore } from "@/store/contribution-store";
import { ClaimGate } from "./CoauthorPage";

it("sends the same answer with the same send time, shared or copied", async () => {
  const store = useContributionStore.getState();
  store.addAuthor("Jane Smith");
  const jane = useContributionStore.getState().authors[0];
  if (!jane) throw new Error("expected Jane");
  store.setClaim({ contributorId: jane.id, sourceDraftId: "src-1", sentAt: 1 });
  const writeText = vi.fn((_: string) => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  let now = 1_000;
  vi.spyOn(Date, "now").mockImplementation(() => {
    now += 1_000;
    return now;
  });

  render(
    <IntlProvider locale="en" messages={en}>
      <ClaimGate>{null}</ClaimGate>
    </IntlProvider>,
  );
  const sentAt = async (calls: number) => {
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(calls));
    const url = writeText.mock.calls[calls - 1]?.[0] ?? "";
    return (await decodeShareHash(new URL(url).hash))?.sentAt;
  };

  fireEvent.click(screen.getByRole("button", { name: "Send back" }));
  const first = await sentAt(1);
  fireEvent.click(await screen.findByRole("button", { name: /Copy the link instead|Link copied/ }));
  expect(await sentAt(2)).toBe(first);

  // A changed answer is a newer one.
  act(() => useContributionStore.getState().setAuthorScore(jane.id, 0, 100));
  fireEvent.click(screen.getByRole("button", { name: /Copy the link instead|Link copied/ }));
  expect(await sentAt(3)).toBeGreaterThan(first ?? Number.POSITIVE_INFINITY);
});
