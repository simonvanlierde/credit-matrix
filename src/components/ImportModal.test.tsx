import { act, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type Author, createAuthor } from "@/core";
import { type DoiLookupResult, lookupDoiWork } from "@/core/lookup";
import en from "@/messages/en.json";
import { ImportModal } from "./ImportModal";

vi.mock("@/lib/announce", () => ({ announce: vi.fn() }));
vi.mock("@/core/lookup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/lookup")>()),
  lookupDoiWork: vi.fn(),
}));

const DOI = "10.1234/abcd";
const WORK: DoiLookupResult = { ok: true, title: "A paper", authors: [{ name: "Jane Smith" }] };

// jsdom has no modal dialog API; stand in for the two calls useModalDialog makes.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

/** A lookup that resolves only when the test says so. */
function deferLookup() {
  const { promise, resolve } = Promise.withResolvers<DoiLookupResult>();
  vi.mocked(lookupDoiWork).mockReturnValue(promise);
  return (result: DoiLookupResult) => act(async () => resolve(result));
}

function renderModal(
  existingContributorCount = 0,
  onLink: () => Promise<null> = async () => null,
  { authors = [], graded = false }: { authors?: Author[]; graded?: boolean } = {},
) {
  const onImport = vi.fn();
  const onApplyStatement = vi.fn();
  const view = render(
    <IntlProvider locale="en" messages={en}>
      <ImportModal
        open
        existingContributorCount={existingContributorCount}
        authors={authors}
        graded={graded}
        onImport={onImport}
        onLink={onLink}
        onApplyStatement={onApplyStatement}
        onClose={vi.fn()}
      />
    </IntlProvider>,
  );
  const input = screen.getByLabelText(en.importFromDoi);
  fireEvent.change(input, { target: { value: DOI } });
  return { ...view, onImport, onApplyStatement, input };
}

describe("DOI lookup", () => {
  it("drops a result that lands after the dialog closed", async () => {
    const resolve = deferLookup();
    const { container, onImport } = renderModal(0);
    fireEvent.click(screen.getByRole("button", { name: en.doiLookUp }));

    const dialog = container.ownerDocument.querySelector("dialog");
    act(() => {
      dialog?.dispatchEvent(new Event("close"));
    });
    await resolve(WORK);

    expect(onImport).not.toHaveBeenCalled();
  });

  it("does not stage a replace confirmation in a dialog that closed", async () => {
    const resolve = deferLookup();
    const { container } = renderModal(3);
    fireEvent.click(screen.getByRole("button", { name: en.doiLookUp }));

    act(() => {
      container.ownerDocument.querySelector("dialog")?.dispatchEvent(new Event("close"));
    });
    await resolve(WORK);

    expect(screen.queryByText(en.replaceWorkspaceTitle)).toBeNull();
  });

  it("ignores Enter while a lookup is already running", async () => {
    const resolve = deferLookup();
    const { input } = renderModal(0);
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(lookupDoiWork).toHaveBeenCalledTimes(1);
    await resolve(WORK);
  });

  it("says offline when the connection dropped during the request", async () => {
    const resolve = deferLookup();
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    renderModal(0);
    fireEvent.click(screen.getByRole("button", { name: en.doiLookUp }));

    onLine.mockReturnValue(false);
    await resolve({ ok: false, status: 502, code: "UNAVAILABLE", error: "" });

    expect(screen.getByText(en.errDoiOFFLINE)).toBeTruthy();
  });
});

describe("a pasted share link", () => {
  it("imports once when Import is clicked again while the link decodes", async () => {
    const { promise, resolve } = Promise.withResolvers<null>();
    const onLink = vi.fn(() => promise);
    renderModal(0, onLink);
    fireEvent.change(screen.getByLabelText(en.pasteRawData), { target: { value: "#s=abc" } });
    const button = screen.getByRole("button", { name: en.importData });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onLink).toHaveBeenCalledTimes(1);
    await act(async () => resolve(null));
  });
});

describe("a JSON export from a newer version", () => {
  it("says so, instead of failing validation", async () => {
    const { onImport } = renderModal(0);
    fireEvent.change(screen.getByLabelText(en.pasteRawData), {
      target: { value: JSON.stringify({ version: 2, authors: [{ name: "Jane Smith", future: true }] }) },
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: en.importData })));

    expect(screen.getByText(en.errImportNewerVersion)).toBeTruthy();
    expect(onImport).not.toHaveBeenCalled();
  });
});

describe("accessibility and drops", () => {
  it("ties the form error to the textarea", async () => {
    renderModal(0);
    const text = screen.getByLabelText(en.pasteRawData);
    fireEvent.change(text, { target: { value: JSON.stringify({ version: 2, authors: [] }) } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: en.importData })));

    expect(text.getAttribute("aria-invalid")).toBe("true");
    const id = text.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(id)?.textContent).toBe(en.errImportNewerVersion);
  });

  it("ties the DOI hint and error to the DOI input", () => {
    const { input } = renderModal(0);
    const id = input.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(id)?.textContent).toBe(en.doiHint);
    expect(input.getAttribute("aria-invalid")).toBeNull();

    fireEvent.change(input, { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: en.doiLookUp }));
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(id)?.textContent).toBe(en.errDoiINVALID_DOI);
  });

  it("stops a file dropped outside the zone from navigating away", () => {
    renderModal(0);
    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    expect(fireEvent.drop(dialog)).toBe(false);
    expect(fireEvent.dragOver(dialog)).toBe(false);
  });

  it("names the file that replaced the textarea", async () => {
    renderModal(0);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["Jane Smith"], "authors.csv");
    await act(async () => fireEvent.change(input, { target: { files: [file] } }));
    expect(screen.getByText(en.fileLoaded.replace("{name}", "authors.csv"))).toBeTruthy();
  });
});

describe("a pasted CRediT statement", () => {
  const paste = (value: string) => fireEvent.change(screen.getByLabelText(en.pasteRawData), { target: { value } });
  const review = () => act(async () => fireEvent.click(screen.getByRole("button", { name: en.statementReview })));
  const roster = () => [
    createAuthor("Ann Bell", { contributions: [{ role: "Software", score: 33 }] }),
    createAuthor("Carl Dunn"),
    createAuthor("Yibo Lu"),
    createAuthor("Yang Lin"),
  ];
  const listOf = (name: string) => screen.getByText(name).nextElementSibling?.textContent;

  it("asks for contributors first when the draft is empty", async () => {
    renderModal(0);
    paste("AB: conceptualization.");
    await review();
    expect(screen.getByText(en.errStatementNoContributors)).toBeTruthy();
  });

  it("shows what matched and what did not, and applies only on request", async () => {
    const { onApplyStatement } = renderModal(4, undefined, { authors: roster() });
    paste("AB: conceptualization, software, review & editing. YL: data curation.");
    await review();

    const heading = screen.getByRole("heading", { name: en.statementReviewTitle });
    expect(heading).toBe(document.activeElement);
    expect(document.getElementById(heading.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "2 roles to add for 1 contributor. Roles already in the grid stay as they are.",
    );
    // Commas only, and the role already set says so in words.
    expect(listOf("Ann Bell")).toBe("Conceptualization, Software (already set), Writing – review & editing");
    expect(screen.getAllByText(en.statementNoRoles)).toHaveLength(3);
    expect(screen.getByText("YL: could be Yibo Lu or Yang Lin — left out: Data curation")).toBeTruthy();
    // The review's Apply is the only primary action on screen.
    expect(screen.queryByRole("button", { name: en.statementReview })).toBeNull();
    expect(onApplyStatement).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: en.statementApply }));
    const [next, added, level] = onApplyStatement.mock.calls[0] ?? [];
    expect([added, level]).toEqual([2, undefined]);
    const scores = next[0].contributions.filter((c: { score: number }) => c.score > 0);
    // The level already set stays; the new roles are set.
    expect(scores).toEqual([
      { role: "Conceptualization", score: 100 },
      { role: "Software", score: 33 },
      { role: "Writing – review & editing", score: 100 },
    ]);
  });

  it("adds roles at Equal in a Levels draft, and names the level", async () => {
    const { onApplyStatement } = renderModal(4, undefined, { authors: roster(), graded: true });
    paste("CD: conceptualization. XY: funding acquisition.");
    await review();

    expect(
      screen.getByText("1 role to add as Equal for 1 contributor. Roles already in the grid stay as they are."),
    ).toBeTruthy();
    expect(screen.getByText("XY: no contributor — left out: Funding acquisition")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: en.statementApply }));
    const [next, added, level] = onApplyStatement.mock.calls[0] ?? [];
    expect([added, level]).toEqual([1, "Equal"]);
    expect(next[1].contributions.find((c: { role: string }) => c.role === "Conceptualization").score).toBe(66);
  });

  it("reads a line break as the end of a contributor's roles", async () => {
    const { onApplyStatement } = renderModal(2, undefined, {
      authors: [createAuthor("Ann Bell"), createAuthor("Carl Dunn")],
    });
    paste("A.B. - conceptualization\nC.D. - writing - original draft");
    await review();
    expect(listOf("Ann Bell")).toBe("Conceptualization");
    expect(listOf("Carl Dunn")).toBe("Writing – original draft");
    fireEvent.click(screen.getByRole("button", { name: en.statementApply }));
    expect(onApplyStatement.mock.calls[0]?.[1]).toBe(2);
  });

  it("says so when nothing matches the draft", async () => {
    renderModal(1, undefined, { authors: [createAuthor("Ann Bell")] });
    paste("XY: conceptualization.");
    await review();
    expect(screen.getByText(en.errStatementNoRoles)).toBeTruthy();
  });

  it("explains that prose is not read, and never offers to replace the workspace", async () => {
    renderModal(1, undefined, { authors: [createAuthor("Ann Bell")] });
    paste("A.B. conceived the study. A.B. wrote the paper and analysed the data.");
    await review();
    expect(screen.getByText(`${en.errStatementNoRoles} ${en.statementOnlyCredit}`)).toBeTruthy();
    expect(screen.queryByText(en.replaceWorkspaceTitle)).toBeNull();
  });

  it("refuses a statement over the length cap", async () => {
    renderModal(1, undefined, { authors: [createAuthor("Ann Bell")] });
    paste(`AB: conceptualization. ${"x".repeat(50_000)}`);
    await review();
    expect(screen.getByText(en.errStatementTooLong.replace("{limit}", "50,000"))).toBeTruthy();
  });
});
