import { act, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import { StatusBanner, showStatus } from "./StatusBanner";

it("shows its actions in order before Dismiss, and each one runs and leaves", () => {
  render(
    <IntlProvider locale="en" messages={en}>
      <StatusBanner />
    </IntlProvider>,
  );
  const undo = vi.fn();
  const review = vi.fn();
  const onDismiss = vi.fn();
  act(() =>
    showStatus({
      kind: "success",
      message: "Bob's answer arrived: 2 differences.",
      actions: [
        { label: "Undo", onAct: undo },
        { label: "Review", onAct: review },
      ],
      onDismiss,
    }),
  );
  expect(
    screen.getAllByRole("button").map((button) => button.textContent || button.getAttribute("aria-label")),
  ).toEqual(["Undo", "Review", "Dismiss"]);
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  expect(review).toHaveBeenCalledOnce();
  expect(undo).not.toHaveBeenCalled();
  expect(onDismiss).toHaveBeenCalledOnce();
  expect(screen.queryByText("Bob's answer arrived: 2 differences.")).toBeNull();
});
