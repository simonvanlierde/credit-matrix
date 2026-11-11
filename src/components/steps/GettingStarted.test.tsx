import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { createAuthor } from "@/core";
import { english } from "@/lib/test-messages";
import { IntlProvider } from "@/lib/translations";
import { messages as en } from "@/locales/en/messages";
import { useContributionStore } from "@/store/contribution-store";
import { useGuide } from "@/store/guide-store";
import { GettingStarted } from "./GettingStarted";

const initial = useContributionStore.getState();

beforeEach(() => {
  useContributionStore.setState(initial, true);
  useGuide.setState({ copied: false, dismissed: false });
});

const renderGuide = (asked = 0) =>
  render(
    <IntlProvider locale="en" messages={en}>
      <GettingStarted asked={asked} />
    </IntlProvider>,
  );

const current = () => document.querySelector("[aria-current=step]")?.textContent;

it("ticks itself from the draft and rings the next step's control", () => {
  act(() => useContributionStore.getState().loadAuthors([createAuthor("Ada Lovelace"), createAuthor("Grace Hopper")]));
  const { rerender } = renderGuide();
  expect(current()).toBe(english.guideStepRoles);
  expect(document.documentElement.dataset.guide).toBe("roles");

  act(() =>
    useContributionStore.getState().setAuthorScore(useContributionStore.getState().authors[0]?.id ?? "", 0, 100),
  );
  expect(current()).toBe(english.guideStepAsk);

  rerender(
    <IntlProvider locale="en" messages={en}>
      <GettingStarted asked={1} />
    </IntlProvider>,
  );
  expect(current()).toBe(english.guideStepCopy);

  act(() => useGuide.getState().markCopied());
  expect(screen.queryByText(english.guideTitle)).toBeNull();
  expect(document.documentElement.dataset.guide).toBeUndefined();
});

it("stays closed once dismissed", () => {
  act(() => useContributionStore.getState().loadAuthors([createAuthor("Ada Lovelace")]));
  renderGuide();
  fireEvent.click(screen.getByRole("button", { name: english.guideDismiss }));
  expect(screen.queryByText(english.guideTitle)).toBeNull();
  expect(useGuide.getState().dismissed).toBe(true);
});
