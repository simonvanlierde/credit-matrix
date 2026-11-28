import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { english } from "@/lib/test-messages";
import { IntlProvider } from "@/lib/translations";
import { messages as en } from "@/locales/en/messages";
import { useContributionStore } from "@/store/contribution-store";
import { Inspector } from "./Inspector";

const initial = useContributionStore.getState();
beforeEach(() => {
  useContributionStore.setState(initial, true);
  // jsdom has no layout, so no scrollIntoView.
  Element.prototype.scrollIntoView ??= () => undefined;
});

it("leaves Alt+Left to the browser as Back, and moves between tabs on a bare arrow", () => {
  render(
    <IntlProvider locale="en" messages={en}>
      <Inspector />
    </IntlProvider>,
  );
  const statement = screen.getByRole("tab", { name: english.stepStatement });
  expect(fireEvent.keyDown(statement, { key: "ArrowLeft", altKey: true })).toBe(true);
  expect(useContributionStore.getState().inspectorTab).toBe("statement");
  fireEvent.keyDown(statement, { key: "ArrowLeft" });
  expect(useContributionStore.getState().inspectorTab).toBe("norms");
});

it("toggles the phone inspector sheet and closes it on Escape", () => {
  render(
    <IntlProvider locale="en" messages={en}>
      <Inspector />
    </IntlProvider>,
  );
  const toggle = screen.getByRole("button", { name: english.a11yInspector });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
});
