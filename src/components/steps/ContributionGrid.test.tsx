import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { type Author, CREDIT_ROLES, createAuthor } from "@/core";
import { announce } from "@/lib/announce";
import { english } from "@/lib/test-messages";
import { IntlProvider } from "@/lib/translations";
import { messages as en } from "@/locales/en/messages";
import { useContributionStore } from "@/store/contribution-store";
import { ContributionGrid } from "./ContributionGrid";

vi.mock("@/lib/announce", () => ({ announce: vi.fn() }));
// Past the restored draft's first frame, as on a live page.
vi.mock("@/lib/use-settled", () => ({ useSettled: () => true }));

const store = () => useContributionStore.getState();
const initial = store();

function twoAuthors(): Author[] {
  return [
    createAuthor("Grace Hopper", { contributions: [{ role: "Conceptualization", score: 100 }] }),
    createAuthor("Charles Darwin", { contributions: [{ role: "Investigation", score: 100 }] }),
  ];
}

/** A reply from `author` that says exactly what the draft says. */
function agreeingReply(author: Author) {
  return {
    contributions: author.contributions,
    equalContribution: false,
    corresponding: false,
    sentAt: 1,
    receivedAt: 2,
    decisions: {},
  };
}

const renderGrid = () =>
  render(
    <IntlProvider locale="en" messages={en}>
      <ContributionGrid />
    </IntlProvider>,
  );

beforeEach(() => {
  useContributionStore.setState(initial, true);
  vi.mocked(announce).mockClear();
});

it("offers only the way to ask on a draft where nobody was asked", () => {
  act(() => store().loadAuthors(twoAuthors()));
  renderGrid();
  expect(screen.getByRole("button", { name: english.stripOpenTeam })).toBeTruthy();
  expect(screen.queryByText(/answered$/)).toBeNull();
});

it("counts the answers once someone was asked", () => {
  const authors = twoAuthors();
  act(() => store().loadAuthors(authors, { [authors[1]?.id ?? ""]: { sentAt: 1, prefilled: false } }));
  renderGrid();
  expect(screen.getByText("0 of 2 answered")).toBeTruthy();
  expect(screen.queryByText(english.stripEveryoneAgreed)).toBeNull();
});

it("says everyone agreed, once, when the last asked co-author's answer leaves nothing to review", () => {
  const authors = twoAuthors();
  const [grace, charles] = authors;
  if (!(grace && charles)) throw new Error("expected 2 authors");
  act(() =>
    store().loadAuthors(authors, {
      [grace.id]: { sentAt: 1, prefilled: false, reply: agreeingReply(grace) },
      [charles.id]: { sentAt: 1, prefilled: false },
    }),
  );
  const { rerender } = renderGrid();
  expect(screen.getByText("1 of 2 answered")).toBeTruthy();
  expect(announce).not.toHaveBeenCalledWith(english.stripEveryoneAgreed);

  act(() =>
    store().applyAskStep(store().activeDraftId, {
      kind: "reply",
      contributorId: charles.id,
      row: charles,
      sentAt: 1,
      at: 2,
    }),
  );
  expect(screen.getByText(english.stripEveryoneAgreed)).toBeTruthy();
  expect(screen.queryByText(/answered$/)).toBeNull();
  rerender(
    <IntlProvider locale="en" messages={en}>
      <ContributionGrid />
    </IntlProvider>,
  );
  expect(vi.mocked(announce).mock.calls.filter(([message]) => message === english.stripEveryoneAgreed)).toHaveLength(1);
});

it("does not announce agreement for a draft that opens already agreed", () => {
  const authors = twoAuthors();
  const [grace, charles] = authors;
  if (!(grace && charles)) throw new Error("expected 2 authors");
  // Grace is you, so Charles is everyone there is to ask.
  act(() =>
    store().loadAuthors(
      authors,
      { [charles.id]: { sentAt: 1, prefilled: false, reply: agreeingReply(charles) } },
      grace.id,
    ),
  );
  renderGrid();
  expect(screen.getByText(english.stripEveryoneAgreed)).toBeTruthy();
  expect(announce).not.toHaveBeenCalled();
});

it("does not say everyone agreed while a co-author was never asked", () => {
  const authors = [...twoAuthors(), createAuthor("Katherine Johnson")];
  const charles = authors[1];
  if (!charles) throw new Error("expected Charles");
  act(() =>
    store().loadAuthors(authors, { [charles.id]: { sentAt: 1, prefilled: false, reply: agreeingReply(charles) } }),
  );
  renderGrid();
  expect(screen.getByText("1 of 3 answered")).toBeTruthy();
  expect(screen.queryByText(english.stripEveryoneAgreed)).toBeNull();
});

it("rings the cell whose phrase is under the pointer in the statement", () => {
  const authors = twoAuthors();
  const grace = authors[0];
  if (!grace) throw new Error("expected Grace");
  act(() => store().loadAuthors(authors));
  const { container } = renderGrid();
  const cell = () => container.querySelector(`table [data-cell-key="${grace.id}:0"]`);
  expect(cell()?.hasAttribute("data-linked")).toBe(false);
  act(() => store().setStatementLink({ contributorId: grace.id, role: "Conceptualization", from: "phrase" }));
  expect(cell()?.hasAttribute("data-linked")).toBe(true);
  expect(container.querySelectorAll("[data-linked]")).toHaveLength(1);
});

it("points a hovered or focused cell at its phrase, and lets go on leaving", () => {
  const authors = twoAuthors();
  const grace = authors[0];
  if (!grace) throw new Error("expected Grace");
  act(() => store().loadAuthors(authors));
  const { container } = renderGrid();
  const cell = container.querySelector<HTMLButtonElement>(`table [data-cell-key="${grace.id}:0"]`);
  if (!cell) throw new Error("expected the cell");
  fireEvent.pointerEnter(cell, { pointerType: "mouse" });
  expect(store().statementLink).toEqual({ contributorId: grace.id, role: "Conceptualization", from: "cell" });
  fireEvent.pointerLeave(cell, { pointerType: "mouse" });
  expect(store().statementLink).toBeNull();
  act(() => cell.focus());
  expect(store().statementLink?.from).toBe("cell");
  act(() => cell.blur());
  expect(store().statementLink).toBeNull();
});

it("leaves no mark behind after a tap, which never sends a mouse leave", () => {
  const authors = twoAuthors();
  const grace = authors[0];
  if (!grace) throw new Error("expected Grace");
  act(() => store().loadAuthors(authors));
  const { container } = renderGrid();
  const cell = container.querySelector<HTMLButtonElement>(`table [data-cell-key="${grace.id}:0"]`);
  if (!cell) throw new Error("expected the cell");
  // iOS fires mouseenter on a tap, and no mouseleave to undo it.
  fireEvent.mouseEnter(cell);
  fireEvent.pointerEnter(cell, { pointerType: "touch" });
  expect(store().statementLink).toBeNull();
});

it("keeps a focused cell's mark when the mouse passes over another cell and leaves", () => {
  const authors = twoAuthors();
  const [grace, charles] = authors;
  if (!(grace && charles)) throw new Error("expected 2 authors");
  act(() => store().loadAuthors(authors));
  const { container } = renderGrid();
  const cellOf = (author: Author, role: number) => {
    const cell = container.querySelector<HTMLButtonElement>(`table [data-cell-key="${author.id}:${role}"]`);
    if (!cell) throw new Error("expected the cell");
    return cell;
  };
  const investigation = CREDIT_ROLES.findIndex((role) => role.name === "Investigation");
  act(() => cellOf(grace, 0).focus());
  fireEvent.pointerEnter(cellOf(charles, investigation), { pointerType: "mouse" });
  expect(store().statementLink).toEqual({ contributorId: charles.id, role: "Investigation", from: "cell" });
  fireEvent.pointerLeave(cellOf(charles, investigation), { pointerType: "mouse" });
  expect(store().statementLink).toEqual({ contributorId: grace.id, role: "Conceptualization", from: "cell" });
});

it("describes the grid with its keys, even where the hint is hidden for touch", () => {
  act(() => store().loadAuthors(twoAuthors()));
  renderGrid();
  const hint = screen.getByText(english.toggleKeysHint);
  expect(hint.className).toContain("pointer-coarse:hidden");
  expect(screen.getByRole("table").getAttribute("aria-describedby")).toBe(hint.id);
});

it("keeps the statement's mark when a cell's leave event lands after the pointer reached a phrase", () => {
  const authors = twoAuthors();
  const [grace, charles] = authors;
  if (!(grace && charles)) throw new Error("expected 2 authors");
  act(() => store().loadAuthors(authors));
  const { container } = renderGrid();
  const cell = container.querySelector<HTMLButtonElement>(`table [data-cell-key="${grace.id}:0"]`);
  if (!cell) throw new Error("expected the cell");
  const phraseLink = { contributorId: charles.id, role: "Investigation" as const, from: "phrase" as const };
  act(() => store().setStatementLink(phraseLink));
  fireEvent.pointerLeave(cell, { pointerType: "mouse" });
  expect(store().statementLink).toEqual(phraseLink);
});

it("drops the bulk Undo once the roster changes another way, so it cannot restore a stale roster", () => {
  act(() => store().loadAuthors(twoAuthors()));
  renderGrid();
  fireEvent.click(screen.getByRole("button", { name: english.bulkAssign }));
  fireEvent.click(screen.getAllByRole("button", { name: english.bulkAssignAll })[0] as HTMLElement);
  expect(screen.getByText(english.bulkChangeApplied)).toBeTruthy();
  const grace = store().authors[0];
  if (!grace) throw new Error("expected an author");
  act(() => {
    store().updateAuthorName(grace.id, "Ada Lovelace");
  });
  expect(screen.queryByText(english.bulkChangeApplied)).toBeNull();
  expect(screen.queryByRole("button", { name: english.undo })).toBeNull();
  expect(store().authors[0]?.name).toBe("Ada Lovelace");
});
