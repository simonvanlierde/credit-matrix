import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { type Author, createAuthor } from "@/core";
import { english } from "@/lib/test-messages";
import { IntlProvider } from "@/lib/translations";
import { messages as en } from "@/locales/en/messages";
import { useContributionStore } from "@/store/contribution-store";
import { useGuide } from "@/store/guide-store";
import { StatementOutput } from "./StatementOutput";

const store = () => useContributionStore.getState();
const initial = store();

function twoAuthors(): Author[] {
  return [
    createAuthor("Jane Smith", {
      contributions: [
        { role: "Conceptualization", score: 100 },
        { role: "Software", score: 50 },
      ],
    }),
    createAuthor("Bob White", { contributions: [{ role: "Conceptualization", score: 20 }] }),
  ];
}

const renderStatement = () =>
  render(
    <IntlProvider locale="en" messages={en}>
      <StatementOutput />
    </IntlProvider>,
  );

beforeEach(() => {
  useContributionStore.setState(initial, true);
  useGuide.setState({ copied: false, dismissed: false });
});

it("shows a contributor without roles as a note, not as an error", () => {
  act(() => store().loadAuthors([...twoAuthors(), createAuthor("Grace Hopper")]));
  renderStatement();
  const note = screen.getByText("Grace Hopper has no assigned CRediT roles.").closest("li");
  expect(note?.className).toContain("text-on-surface-variant");
  expect(note?.className).not.toMatch(/error/);
});

it("marks the phrase of the cell under the pointer, by author and by role", () => {
  const authors = twoAuthors();
  const [jane, bob] = authors;
  if (!(jane && bob)) throw new Error("expected 2 authors");
  act(() => store().loadAuthors(authors));
  const { container } = renderStatement();
  const marks = () => [...container.querySelectorAll("[data-linked]")].map((mark) => mark.textContent);
  const statement = () => container.querySelector("section p")?.textContent;
  const before = statement();
  expect(marks()).toEqual([]);

  act(() => store().setStatementLink({ contributorId: bob.id, role: "Conceptualization", from: "cell" }));
  // Bob's Conceptualization, not Jane's: the same word appears in both their segments.
  expect(marks()).toEqual(["Conceptualization"]);
  expect(container.querySelector("[data-linked]")?.getAttribute("data-author")).toBe(bob.id);
  // Marking changes no text.
  expect(statement()).toBe(before);

  fireEvent.click(screen.getByRole("radio", { name: english.groupByRole }));
  expect(marks()).toEqual(["Bob White"]);
  act(() => store().setStatementLink(null));
  expect(marks()).toEqual([]);
});

it("points the phrase under the pointer at its cell", () => {
  const authors = twoAuthors();
  const jane = authors[0];
  if (!jane) throw new Error("expected Jane");
  act(() => store().loadAuthors(authors));
  const { container } = renderStatement();
  const phrase = container.querySelector(`[data-author="${jane.id}"][data-role="Software"]`);
  if (!phrase) throw new Error("expected Jane's Software phrase");
  fireEvent.pointerOver(phrase);
  expect(store().statementLink).toEqual({ contributorId: jane.id, role: "Software", from: "phrase" });
  expect(container.querySelector("[data-linked]")?.textContent).toBe("Software");
  const paragraph = phrase.closest("p");
  if (!paragraph) throw new Error("expected the statement");
  fireEvent.pointerLeave(paragraph);
  expect(store().statementLink).toBeNull();
});

it("keeps a phrase's text node in place as its mark comes and goes, so a selection being dragged holds", () => {
  const authors = twoAuthors();
  const jane = authors[0];
  if (!jane) throw new Error("expected Jane");
  act(() => store().loadAuthors(authors));
  const { container } = renderStatement();
  const text = () => container.querySelector(`[data-author="${jane.id}"][data-role="Software"]`)?.firstChild;
  const before = text();
  expect(before?.nodeType).toBe(Node.TEXT_NODE);
  act(() => store().setStatementLink({ contributorId: jane.id, role: "Software", from: "cell" }));
  expect(text()).toBe(before);
  act(() => store().setStatementLink(null));
  expect(text()).toBe(before);
  // Never announced: no live region or extra element joins the statement.
  expect(container.querySelector("section mark, section [aria-live]")).toBeNull();
});

it("links a contributor's name in the statement to their sidebar row and column", () => {
  const authors = twoAuthors();
  const jane = authors[0];
  if (!jane) throw new Error("expected Jane");
  act(() => store().loadAuthors(authors));
  const { container } = renderStatement();
  fireEvent.click(screen.getByRole("radio", { name: english.groupByAuthor }));
  const name = container.querySelector(`[data-author="${jane.id}"]:not([data-role])`);
  if (!name) throw new Error("expected Jane's name span");
  fireEvent.pointerOver(name);
  expect(store().statementLink).toEqual({ contributorId: jane.id, from: "name" });
  expect(name.hasAttribute("data-linked")).toBe(true);
  // Her phrases take the mark too.
  expect(container.querySelector(`[data-author="${jane.id}"][data-role="Software"]`)?.hasAttribute("data-linked")).toBe(
    true,
  );
  const paragraph = name.closest("p");
  if (!paragraph) throw new Error("expected the statement");
  fireEvent.pointerLeave(paragraph);
  expect(store().statementLink).toBeNull();
});

it("marks a role's phrase for everyone, and no names, while its label in the grid is hovered", () => {
  const authors = twoAuthors();
  act(() => store().loadAuthors(authors));
  const { container } = renderStatement();
  fireEvent.click(screen.getByRole("radio", { name: english.groupByAuthor }));
  act(() => store().setStatementLink({ role: "Conceptualization", from: "role" }));
  const marked = [...container.querySelectorAll("[data-linked]")].map((span) => span.getAttribute("data-role"));
  expect(marked).toEqual(["Conceptualization", "Conceptualization"]);
});

it("leaves no mark behind after a tap on a phrase, which never sends a leave", () => {
  act(() => store().loadAuthors(twoAuthors()));
  const { container } = renderStatement();
  const phrase = container.querySelector("[data-author][data-role]");
  if (!phrase) throw new Error("expected a phrase");
  fireEvent.pointerOver(phrase, { pointerType: "touch" });
  expect(store().statementLink).toBeNull();
});

it("marks the getting-started copy step once the statement is copied", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("ClipboardItem", undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  act(() => store().loadAuthors(twoAuthors()));
  renderStatement();
  expect(useGuide.getState().copied).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Copy statement" }));
  await waitFor(() => expect(useGuide.getState().copied).toBe(true));
  expect(writeText).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});
