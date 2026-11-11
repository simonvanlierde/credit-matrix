import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CREDIT_ROLES, createAuthor } from "@/core";
import { IntlProvider } from "@/lib/translations";
import { messages as en } from "@/locales/en/messages";
import { useContributionStore } from "@/store/contribution-store";
import { ContributionGrid } from "./ContributionGrid";
import { StatementOutput } from "./StatementOutput";

vi.mock("@/lib/announce", () => ({ announce: vi.fn() }));
vi.mock("@/lib/use-settled", () => ({ useSettled: () => true }));

const store = () => useContributionStore.getState();
const initial = store();

const jane = createAuthor("Jane Smith", {
  contributions: [
    { role: "Conceptualization", score: 100 },
    { role: "Software", score: 50 },
  ],
});
const bob = createAuthor("Bob White", { contributions: [{ role: "Conceptualization", score: 20 }] });

const renderBoth = () =>
  render(
    <IntlProvider locale="en" messages={en}>
      <ContributionGrid />
      <StatementOutput />
    </IntlProvider>,
  );

const softwareIndex = CREDIT_ROLES.findIndex((r) => r.name === "Software");

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  useContributionStore.setState(initial, true);
  act(() => store().loadAuthors([jane, bob]));
});

const menuItems = () =>
  within(screen.getByRole("dialog"))
    .getAllByRole("button")
    .map((button) => button.textContent);
const scoreOf = (id: string, role: string) =>
  store()
    .authors.find((a) => a.id === id)
    ?.contributions.find((c) => c.role === role)?.score;

it("opens the same person menu from the grid's name header and from the name in the statement", () => {
  const { container } = renderBoth();
  const header = container.querySelector<HTMLElement>("[data-name-head='0']");
  const name = container.querySelector<HTMLElement>("section [data-author]:not([data-role])");
  if (!(header && name)) throw new Error("expected a name header and a statement name");

  fireEvent.click(header);
  const fromGrid = menuItems();
  expect(screen.getByRole("dialog", { name: "Actions for Jane Smith" })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

  fireEvent.click(name);
  const fromStatement = menuItems();

  expect(fromStatement).toEqual(fromGrid);
  expect(fromGrid).toEqual(expect.arrayContaining(["Edit in list", "Clear every role", "Assign every role"]));
});

it("clears a person's roles from the menu", () => {
  const { container } = renderBoth();
  const header = container.querySelector<HTMLElement>("[data-name-head='0']");
  if (!header) throw new Error("expected a name header");
  fireEvent.click(header);
  fireEvent.click(screen.getByRole("button", { name: "Clear every role" }));
  expect(store().authors[0]?.contributions.every((c) => c.score === 0)).toBe(true);
});

it("asks for a level before assigning a role to everyone", () => {
  act(() => store().setInputMode("levels"));
  const { container } = renderBoth();
  const role = container.querySelector<HTMLElement>(`[data-role-head='${softwareIndex}']`);
  if (!role) throw new Error("expected a role label");

  fireEvent.click(role);
  fireEvent.click(screen.getByRole("button", { name: "Assign to everyone…" }));
  // Nothing is assigned until a level is chosen.
  expect(scoreOf(bob.id, "Software")).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Equal" }));

  expect(scoreOf(bob.id, "Software")).toBe(66);
  expect(scoreOf(jane.id, "Software")).toBe(66);
});

it("jumps to the cell when a phrase in the statement is clicked", () => {
  const { container } = renderBoth();
  const phrase = container.querySelector<HTMLElement>(`[data-author="${jane.id}"][data-role="Software"]`);
  if (!phrase) throw new Error("expected the phrase");
  fireEvent.click(phrase);
  expect(document.activeElement?.getAttribute("data-cell-key")).toBe(`${jane.id}:${softwareIndex}`);
});
