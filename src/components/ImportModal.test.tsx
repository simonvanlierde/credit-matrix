import { act, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { beforeAll, describe, expect, it, vi } from "vitest";
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

function renderModal(existingContributorCount = 0, onLink: () => Promise<null> = async () => null) {
  const onImport = vi.fn();
  const view = render(
    <IntlProvider locale="en" messages={en}>
      <ImportModal
        open
        existingContributorCount={existingContributorCount}
        onImport={onImport}
        onLink={onLink}
        onClose={vi.fn()}
      />
    </IntlProvider>,
  );
  const input = screen.getByLabelText(en.importFromDoi);
  fireEvent.change(input, { target: { value: DOI } });
  return { ...view, onImport, input };
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
