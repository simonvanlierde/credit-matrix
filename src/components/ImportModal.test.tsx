import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type Author, createAuthor, MAX_STATEMENT_LENGTH, toJson } from "@/core";
import { MAX_AUTHORS } from "@/core/author";
import { type DoiLookupResult, lookupDoiWork } from "@/core/lookup";
import { fetchOrcidKeys, type OrcidKey } from "@/core/orcid-proof";
import { ConverterUnavailableError, convertCitation } from "@/lib/citation-import";
import { english } from "@/lib/test-messages";
import { IntlProvider } from "@/lib/translations";
import { messages as en } from "@/locales/en/messages";
import { ImportModal } from "./ImportModal";

vi.mock("@/lib/citation-import", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/citation-import")>()),
  convertCitation: vi.fn(),
}));
vi.mock("@/lib/announce", () => ({ announce: vi.fn() }));
vi.mock("@/core/orcid-proof", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/orcid-proof")>()),
  fetchOrcidKeys: vi.fn(),
}));
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
  // The candidate picker's list scrolls its selected option into view on open.
  Element.prototype.scrollIntoView ??= () => undefined;
});

/** A lookup that resolves only when the test says so. */
function deferLookup() {
  const { promise, resolve } = Promise.withResolvers<DoiLookupResult>();
  vi.mocked(lookupDoiWork).mockReturnValue(promise);
  return (result: DoiLookupResult) => act(async () => resolve(result));
}

function renderModal(
  existingContributorCount = 0,
  onLink: (url: string, current: () => boolean) => Promise<null> = async () => null,
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
  const input = screen.getByLabelText(english.importFromDoi);
  fireEvent.change(input, { target: { value: DOI } });
  return { ...view, onImport, onApplyStatement, input };
}

describe("DOI lookup", () => {
  it("drops a result that lands after the dialog closed", async () => {
    const resolve = deferLookup();
    const { container, onImport } = renderModal(0);
    fireEvent.click(screen.getByRole("button", { name: english.doiLookUp }));

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
    fireEvent.click(screen.getByRole("button", { name: english.doiLookUp }));

    act(() => {
      container.ownerDocument.querySelector("dialog")?.dispatchEvent(new Event("close"));
    });
    await resolve(WORK);

    expect(screen.queryByText(english.importChoiceTitle)).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: english.doiLookUp }));

    onLine.mockReturnValue(false);
    await resolve({ ok: false, status: 502, code: "UNAVAILABLE", error: "" });

    expect(screen.getByText(english.errDoiOFFLINE)).toBeTruthy();
  });
});

describe("a pasted share link", () => {
  it("imports once when Import is clicked again while the link decodes", async () => {
    const { promise, resolve } = Promise.withResolvers<null>();
    const onLink = vi.fn(() => promise);
    renderModal(0, onLink);
    fireEvent.change(screen.getByLabelText(english.pasteRawData), { target: { value: "#s=abc" } });
    const button = screen.getByRole("button", { name: english.importData });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onLink).toHaveBeenCalledTimes(1);
    await act(async () => resolve(null));
  });
});

describe("closing the dialog while ORCID's keys load", () => {
  const close = () =>
    act(() => {
      document.querySelector("dialog")?.dispatchEvent(new Event("close"));
    });
  /** A JSON export whose answer includes a sign-in, so importing it fetches ORCID's keys. */
  function signedFile() {
    const bob = createAuthor("Bob White", { id: "bob" });
    const orcid = { orcid: "0000-0002-1825-0097", issuedAt: 1, token: "t", payload: "p" };
    const reply = { ...bob, sentAt: 1, receivedAt: 2, provenance: { orcid }, decisions: {} };
    return toJson([bob], { asks: { bob: { sentAt: 1, prefilled: true, reply } } });
  }

  it.each([0, 3])("imports nothing and stages no prompt (%i contributors already)", async (existing) => {
    const { promise, resolve } = Promise.withResolvers<OrcidKey[] | null>();
    vi.mocked(fetchOrcidKeys).mockReturnValue(promise);
    const { onImport } = renderModal(existing);
    fireEvent.change(screen.getByLabelText(english.pasteRawData), { target: { value: signedFile() } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: english.importData })));
    expect(fetchOrcidKeys).toHaveBeenCalled();
    close();
    await act(async () => resolve(null));

    expect(onImport).not.toHaveBeenCalled();
    expect(screen.queryByText(english.importChoiceTitle)).toBeNull();
  });

  it("keeps a DOI lookup and an import from running at once, so neither lands over the other", async () => {
    const { promise, resolve } = Promise.withResolvers<OrcidKey[] | null>();
    vi.mocked(fetchOrcidKeys).mockReturnValue(promise);
    renderModal(0);
    fireEvent.change(screen.getByLabelText(english.pasteRawData), { target: { value: signedFile() } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: english.importData })));
    expect((screen.getByRole("button", { name: english.doiLookUp }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolve(null));
  });

  it("lets the dialog import again after it closes while the keys load", async () => {
    const { promise, resolve } = Promise.withResolvers<OrcidKey[] | null>();
    vi.mocked(fetchOrcidKeys).mockReturnValue(promise);
    renderModal(0);
    fireEvent.change(screen.getByLabelText(english.pasteRawData), { target: { value: signedFile() } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: english.importData })));
    close();
    fireEvent.change(screen.getByLabelText(english.pasteRawData), { target: { value: signedFile() } });
    expect((screen.getByRole("button", { name: english.importData }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => resolve(null));
  });

  it("imports nothing when the dialog unmounts while the keys load", async () => {
    const { promise, resolve } = Promise.withResolvers<OrcidKey[] | null>();
    vi.mocked(fetchOrcidKeys).mockReturnValue(promise);
    const { onImport, unmount } = renderModal(0);
    fireEvent.change(screen.getByLabelText(english.pasteRawData), { target: { value: signedFile() } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: english.importData })));
    unmount();
    await act(async () => resolve(null));

    expect(onImport).not.toHaveBeenCalled();
  });

  it("tells a pasted link it no longer belongs to an open dialog", async () => {
    const { promise, resolve } = Promise.withResolvers<null>();
    const onLink = vi.fn((_url: string, _current: () => boolean) => promise);
    renderModal(0, onLink);
    fireEvent.change(screen.getByLabelText(english.pasteRawData), { target: { value: "#s=abc" } });
    fireEvent.click(screen.getByRole("button", { name: english.importData }));
    const current = onLink.mock.calls[0]?.[1];
    expect(current?.()).toBe(true);
    close();
    expect(current?.()).toBe(false);
    await act(async () => resolve(null));
  });
});

describe("a JSON export from a newer version", () => {
  it("says so, instead of failing validation", async () => {
    const { onImport } = renderModal(0);
    fireEvent.change(screen.getByLabelText(english.pasteRawData), {
      target: { value: JSON.stringify({ version: 2, authors: [{ name: "Jane Smith", future: true }] }) },
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: english.importData })));

    expect(screen.getByText(english.errImportNewerVersion)).toBeTruthy();
    expect(onImport).not.toHaveBeenCalled();
  });
});

describe("a JSON export that repeats a contributor id", () => {
  it("says so, instead of the catch-all failure", async () => {
    const { onImport } = renderModal(0);
    const jane = createAuthor("Jane Smith");
    fireEvent.change(screen.getByLabelText(english.pasteRawData), {
      target: { value: JSON.stringify({ version: 1, authors: [jane, jane] }) },
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: english.importData })));

    expect(screen.getByText(english.errImportRepeatedId)).toBeTruthy();
    expect(onImport).not.toHaveBeenCalled();
  });
});

describe("accessibility and drops", () => {
  it("ties the form error to the textarea", async () => {
    renderModal(0);
    const text = screen.getByLabelText(english.pasteRawData);
    fireEvent.change(text, { target: { value: JSON.stringify({ version: 2, authors: [] }) } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: english.importData })));

    expect(text.getAttribute("aria-invalid")).toBe("true");
    const id = text.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(id)?.textContent).toBe(english.errImportNewerVersion);
  });

  it("ties the DOI hint and error to the DOI input", () => {
    const { input } = renderModal(0);
    const id = input.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(id)?.textContent).toBe(english.doiHint);
    expect(input.getAttribute("aria-invalid")).toBeNull();

    fireEvent.change(input, { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: english.doiLookUp }));
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(id)?.textContent).toBe(english.errDoiINVALID_DOI);
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
    expect(screen.getByText(english.fileLoaded.replace("{name}", "authors.csv"))).toBeTruthy();
  });
});

describe("a pasted CRediT statement", () => {
  const paste = (value: string) => fireEvent.change(screen.getByLabelText(english.pasteRawData), { target: { value } });
  const review = () => act(async () => fireEvent.click(screen.getByRole("button", { name: english.statementReview })));
  const roster = () => [
    createAuthor("Ann Bell", { contributions: [{ role: "Software", score: 33 }] }),
    createAuthor("Carl Dunn"),
    createAuthor("Yibo Lu"),
    createAuthor("Yang Lin"),
  ];
  // The first match is the contributor's row; a picker can show the same name further down.
  const listOf = (name: string) => screen.getAllByText(name)[0]?.nextElementSibling?.textContent;
  const noRolesLine = () => screen.queryByText(/^No roles found for: /)?.textContent;
  /** Choose `option` in the picker labelled `token`, by keyboard: jsdom has no pointer capture. */
  const pick = async (token: string, option: string) => {
    await act(async () => fireEvent.keyDown(screen.getByRole("combobox", { name: token }), { key: "Enter" }));
    await act(async () => fireEvent.keyDown(screen.getByRole("option", { name: option }), { key: "Enter" }));
  };

  it("asks for contributors first when the draft is empty", async () => {
    renderModal(0);
    paste("AB: conceptualization.");
    await review();
    expect(screen.getByText(english.errStatementNoContributors)).toBeTruthy();
  });

  it("shows what matched and what did not, and applies only on request", async () => {
    const { onApplyStatement } = renderModal(4, undefined, { authors: roster() });
    paste("AB: conceptualization, software, review & editing. YL: data curation.");
    await review();

    const heading = screen.getByRole("heading", { name: english.statementReviewTitle });
    expect(heading).toBe(document.activeElement);
    expect(document.getElementById(heading.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "2 roles to add for 1 contributor. Roles already in the grid stay as they are.",
    );
    // Commas only, and the role already set says so in words.
    expect(listOf("Ann Bell")).toBe("Conceptualization, Software (already set), Writing – review & editing");
    // Nobody without roles gets a row; one muted line names them, with the hint for the ambiguous token.
    expect(screen.queryByText("Carl Dunn")).toBeNull();
    expect(noRolesLine()).toBe("No roles found for: Carl Dunn, Yibo Lu (could be YL), Yang Lin (could be YL)");
    // An ambiguous token gets a picker that leaves its roles out until someone is chosen.
    expect(screen.getByRole("combobox", { name: "YL" }).textContent).toBe(english.statementLeaveOut);
    // The review's Apply is the only primary action on screen.
    expect(screen.queryByRole("button", { name: english.statementReview })).toBeNull();
    expect(onApplyStatement).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: english.statementApply }));
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

  it("gives an ambiguous token's roles to the contributor picked for it", async () => {
    const { onApplyStatement } = renderModal(4, undefined, { authors: roster() });
    paste("AB: conceptualization. YL: data curation, software.");
    await review();
    await pick("YL", "Yang Lin");

    expect(
      screen.getByText("3 roles to add for 2 contributors. Roles already in the grid stay as they are."),
    ).toBeTruthy();
    expect(listOf("Yang Lin")).toBe("Data curation, Software");
    expect(screen.queryByText("Yibo Lu")).toBeNull();
    expect(noRolesLine()).toBe("No roles found for: Carl Dunn, Yibo Lu (could be YL)");
    fireEvent.click(screen.getByRole("button", { name: english.statementApply }));
    const [next, added] = onApplyStatement.mock.calls[0] ?? [];
    expect(added).toBe(3);
    const roles = (author: Author) => author.contributions.filter((c) => c.score > 0).map((c) => c.role);
    expect(roles(next[3])).toEqual(["Data curation", "Software"]);
    expect(roles(next[2])).toEqual([]);
  });

  it("leaves an ambiguous token's roles out when switched back to Leave out", async () => {
    const { onApplyStatement } = renderModal(4, undefined, { authors: roster() });
    paste("AB: conceptualization. YL: data curation.");
    await review();
    await pick("YL", "Yibo Lu");
    expect(listOf("Yibo Lu")).toBe("Data curation");
    await pick("YL", english.statementLeaveOut);
    expect(noRolesLine()).toContain("Yibo Lu (could be YL)");
    fireEvent.click(screen.getByRole("button", { name: english.statementApply }));
    const [next, added] = onApplyStatement.mock.calls[0] ?? [];
    expect(added).toBe(1);
    expect(next[2].contributions.every((c: { score: number }) => c.score === 0)).toBe(true);
  });

  it("forgets the choices when the text changes", async () => {
    renderModal(4, undefined, { authors: roster() });
    paste("AB: conceptualization. YL: data curation.");
    await review();
    await pick("YL", "Yibo Lu");
    paste("AB: conceptualization. YL: data curation. ");
    await review();
    expect(screen.getByRole("combobox", { name: "YL" }).textContent).toBe(english.statementLeaveOut);
    expect(noRolesLine()).toContain("Yibo Lu (could be YL)");
  });

  it("adds roles at Equal in a Levels draft, and names the level", async () => {
    const { onApplyStatement } = renderModal(4, undefined, { authors: roster(), graded: true });
    paste("CD: conceptualization. XY: funding acquisition.");
    await review();

    expect(
      screen.getByText("1 role to add as Equal for 1 contributor. Roles already in the grid stay as they are."),
    ).toBeTruthy();
    expect(screen.getByText("XY: no contributor — left out: Funding acquisition")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: english.statementApply }));
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
    fireEvent.click(screen.getByRole("button", { name: english.statementApply }));
    expect(onApplyStatement.mock.calls[0]?.[1]).toBe(2);
  });

  it.each([
    [
      "Conceptualization, A.B. and C.D.; Formal\nanalysis, C.D.",
      "Conceptualization",
      "Conceptualization, Formal analysis",
    ],
    ["Conceptualization, A.B.\nand C.D.; Data curation, A.B.", "Conceptualization, Data curation", "Conceptualization"],
    [
      "A.B.: conceptualization, writing - original\ndraft; C.D.: software.",
      "Conceptualization, Writing – original draft",
      "Software",
    ],
    ["Conceptualization: A.B.\nSoftware: C.D.", "Conceptualization", "Software"],
  ])("joins a line that runs on, and splits one that starts a new entry: %j", async (text, ann, carl) => {
    renderModal(2, undefined, { authors: [createAuthor("Ann Bell"), createAuthor("Carl Dunn")] });
    paste(text);
    await review();
    expect(listOf("Ann Bell")).toBe(ann);
    expect(listOf("Carl Dunn")).toBe(carl);
  });

  it("says so when nothing matches the draft", async () => {
    renderModal(1, undefined, { authors: [createAuthor("Ann Bell")] });
    paste("XY: conceptualization.");
    await review();
    expect(screen.getByText(english.errStatementNoRoles)).toBeTruthy();
  });

  it("explains that prose is not read, and never offers to replace the workspace", async () => {
    renderModal(1, undefined, { authors: [createAuthor("Ann Bell")] });
    paste("A.B. conceived the study. A.B. wrote the paper and analysed the data.");
    await review();
    expect(screen.getByText(`${english.errStatementNoRoles} ${english.statementOnlyCredit}`)).toBeTruthy();
    expect(screen.queryByText(english.importChoiceTitle)).toBeNull();
  });

  it("refuses a statement over the length cap", async () => {
    renderModal(1, undefined, { authors: [createAuthor("Ann Bell")] });
    paste(`AB: conceptualization. ${"x".repeat(MAX_STATEMENT_LENGTH)}`);
    await review();
    expect(screen.getByText(english.errStatementTooLong.replace("{limit}", "120,000"))).toBeTruthy();
  });
});

describe("deposited DOI roles", () => {
  it("marks and previews imported roles, and waits for confirmation", async () => {
    vi.mocked(lookupDoiWork).mockResolvedValue({
      ok: true,
      title: "A paper",
      authors: [{ name: "Tu Youyou", roles: ["Software"] }],
    });
    const { onImport } = renderModal();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: english.doiLookUp })));
    expect(onImport).not.toHaveBeenCalled();
    expect(screen.getByText(english.doiRolesImported)).toBeTruthy();
    expect(screen.getByText("Tu Youyou: Software")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: english.doiConfirm }));
    expect(onImport.mock.calls[0]?.[0].authors[0].contributions).toContainEqual({ role: "Software", score: 100 });
  });

  it("says when roles are absent, and imports an empty matrix after confirmation", async () => {
    vi.mocked(lookupDoiWork).mockResolvedValue(WORK);
    const { onImport } = renderModal();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: english.doiLookUp })));
    expect(screen.getByText(english.doiNoRoles)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: english.doiConfirm }));
    expect(onImport.mock.calls[0]?.[0].authors[0].contributions.every((c: { score: number }) => c.score === 0)).toBe(
      true,
    );
  });
});

describe("a citation converter completing after close", () => {
  it.each(["failure", "empty"])("ignores the stale %s result", async (outcome) => {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    vi.mocked(convertCitation).mockReturnValue(promise);
    const { container, input, onImport } = renderModal();
    fireEvent.change(screen.getByLabelText(english.pasteRawData), {
      target: { value: "cff-version: 1.2.0\ntitle: Example" },
    });
    fireEvent.click(screen.getByRole("button", { name: english.importData }));
    expect(screen.getByText(english.citationConverting)).toBeTruthy();
    act(() => {
      container.ownerDocument.querySelector("dialog")?.dispatchEvent(new Event("close"));
    });
    fireEvent.change(input, { target: { value: "invalid" } });
    fireEvent.click(screen.getByRole("button", { name: english.doiLookUp }));
    await act(async () => {
      if (outcome === "failure") reject(new Error("No runtime"));
      else resolve(JSON.stringify({ author: [] }));
      await Promise.resolve();
    });
    expect(screen.getByText(english.errDoiINVALID_DOI)).toBeTruthy();
    expect(screen.queryByText(english.errCitationConverter)).toBeNull();
    expect(screen.queryByText(english.errImportNoCitationAuthors)).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
  });
});

describe("citation converter", () => {
  const cff = "cff-version: 1.2.0\ntitle: Example";
  const paste = () => fireEvent.change(screen.getByLabelText(english.pasteRawData), { target: { value: cff } });

  it("names the converter only when it rejected; other failures use their own message", async () => {
    const many = JSON.stringify({
      author: Array.from({ length: MAX_AUTHORS + 1 }, (_, i) => ({ name: `Person ${i} Name` })),
    });
    vi.mocked(convertCitation).mockResolvedValue(many);
    renderModal();
    paste();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: english.importData })));
    expect(await screen.findByText(new RegExp(String(MAX_AUTHORS)))).toBeTruthy();
    expect(screen.queryByText(english.errCitationConverter)).toBeNull();
  });

  it.each([
    ["an unavailable converter", new ConverterUnavailableError("offline"), english.errCitationConverter],
    ["a file the converter rejects", new Error("Bad CFF"), english.errImportFailed],
  ])("names %s plainly", async (_, failure, message) => {
    vi.mocked(convertCitation).mockRejectedValue(failure);
    renderModal();
    paste();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: english.importData })));
    expect(await screen.findByText(message)).toBeTruthy();
  });

  it("aborts the converter on close and announces progress inside the dialog", () => {
    vi.mocked(convertCitation).mockReturnValue(Promise.withResolvers<string>().promise);
    const { container } = renderModal();
    paste();
    fireEvent.click(screen.getByRole("button", { name: english.importData }));
    const progress = screen.getByText(english.citationConverting);
    expect(progress.closest("[role=status]")?.closest("dialog")).toBeTruthy();
    const signal = vi.mocked(convertCitation).mock.calls.at(-1)?.[2] as AbortSignal;
    expect(signal.aborted).toBe(false);
    act(() => {
      container.ownerDocument.querySelector("dialog")?.dispatchEvent(new Event("close"));
    });
    expect(signal.aborted).toBe(true);
  });

  it("puts form and DOI errors in alerts inside the dialog", () => {
    const { input } = renderModal();
    fireEvent.change(input, { target: { value: "invalid" } });
    fireEvent.click(screen.getByRole("button", { name: english.doiLookUp }));
    const doiAlert = screen.getByText(english.errDoiINVALID_DOI);
    expect(doiAlert.getAttribute("role")).toBe("alert");
    expect(doiAlert.closest("dialog")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(english.pasteRawData), { target: { value: "cff-version: 1.2.0" } });
    vi.mocked(convertCitation).mockRejectedValue(new Error("x"));
  });
});

describe("import progress and outcome", () => {
  const paste = (value: string) => fireEvent.change(screen.getByLabelText(english.pasteRawData), { target: { value } });

  it("says Converting on the Import button and keeps the progress line beside it", () => {
    vi.mocked(convertCitation).mockReturnValue(Promise.withResolvers<string>().promise);
    renderModal();
    paste("cff-version: 1.2.0\ntitle: Example");
    fireEvent.click(screen.getByRole("button", { name: english.importData }));
    const button = screen.getByRole("button", { name: english.importConverting });
    expect(button.parentElement?.parentElement?.contains(screen.getByText(english.citationConverting))).toBe(true);
  });

  it("offers to add only the contributors the draft lacks, without a second Cancel", async () => {
    const ann = createAuthor("Ann Bell");
    const { onImport } = renderModal(1, undefined, { authors: [ann] });
    paste("Ann Bell\nBo Chen");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: english.importData })));
    expect(screen.getByText(english.importChoiceTitle)).toBeTruthy();
    expect(screen.queryByText(/cannot be undone/)).toBeNull();
    expect(screen.queryByRole("button", { name: english.cancel })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: english.importAddNew.replace("{count}", "1") }));
    expect(onImport.mock.calls[0]?.[1]).toBe("add");
  });

  it("says plainly when XML cannot be read", async () => {
    renderModal();
    paste("<article><contrib-group><contrib>");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: english.importData })));
    expect(screen.getByText(english.errImportXmlUnreadable)).toBeTruthy();
  });

  it("says plainly when the pasted text is an export-only format", async () => {
    renderModal();
    paste('# Keep native JSON for scores.\nauthors:\n  - name: "Ann Bell"\n    roles: []');
    await act(async () => fireEvent.click(screen.getByRole("button", { name: english.importData })));
    expect(screen.getByText(english.errImportExportOnly)).toBeTruthy();
  });

  it("lists every file type the picker accepts", () => {
    renderModal();
    const accept = (document.querySelector('input[type="file"]') as HTMLInputElement).accept.split(",");
    expect(accept).toContain(".cff");
    const listed = screen.getByText(/^Accepts /).textContent ?? "";
    for (const type of accept) expect(listed).toContain(type);
  });
});
