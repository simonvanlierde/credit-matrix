import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { decodeShareHash } from "@/core";
import { IntlProvider } from "@/lib/translations";
import { messages as en } from "@/locales/en/messages";
import { useContributionStore } from "@/store/contribution-store";
import { ClaimGate } from "./CoauthorPage";

it("sends the same answer with the same send time, shared or copied", async () => {
  const store = useContributionStore.getState();
  store.addAuthor("Grace Hopper");
  const grace = useContributionStore.getState().authors[0];
  if (!grace) throw new Error("expected Grace");
  store.setClaim({ contributorId: grace.id, sourceDraftId: "src-1", sentAt: 1 });
  // The co-author's own writing tool is theirs, not the lead's: it stays out of the reply.
  store.setToolchain("quarto");
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
  expect(await decodeShareHash(new URL(writeText.mock.calls[0]?.[0] ?? "").hash)).not.toHaveProperty("toolchain");
  fireEvent.click(await screen.findByRole("button", { name: /Copy the link instead|Link copied/ }));
  expect(await sentAt(2)).toBe(first);

  // A changed answer is a newer one.
  act(() => useContributionStore.getState().setAuthorScore(grace.id, 0, 100));
  fireEvent.click(screen.getByRole("button", { name: /Copy the link instead|Link copied/ }));
  expect(await sentAt(3)).toBeGreaterThan(first ?? Number.POSITIVE_INFINITY);
});
