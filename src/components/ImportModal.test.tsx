import { act, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type DoiLookupResult, lookupDoiWork } from "@/core";
import en from "@/messages/en.json";
import { detect, ImportModal, madeByNewerVersion } from "./ImportModal";

vi.mock("@/lib/announce", () => ({ announce: vi.fn() }));
vi.mock("@/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core")>()),
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

function renderModal(existingContributorCount = 0) {
  const onImport = vi.fn();
  const view = render(
    <IntlProvider locale="en" messages={en}>
      <ImportModal
        open
        existingContributorCount={existingContributorCount}
        onImport={onImport}
        onLink={async () => null}
        onClose={vi.fn()}
      />
    </IntlProvider>,
  );
  const input = screen.getByLabelText(en.importFromDoi);
  fireEvent.change(input, { target: { value: DOI } });
  return { ...view, onImport, input };
}

describe("detect", () => {
  it("reads a comma list of names containing 'name' as names, not CSV", () => {
    expect(detect("Anne Namer, Bob Smith")).toBe("names");
  });

  it("reads text with a Name header cell as CSV", () => {
    expect(detect("Name,ORCID\nJane Smith,")).toBe("csv");
    expect(detect('"name" , Conceptualization\nJane Smith,100')).toBe("csv");
    expect(detect("﻿Name,Conceptualization\nJane Smith,100")).toBe("csv");
  });
});

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

  it("reads only a numeric version above 1 as newer", () => {
    expect(madeByNewerVersion('{"version": 2}')).toBe(true);
    expect(madeByNewerVersion('{"version": 1}')).toBe(false);
    expect(madeByNewerVersion('{"version": "2"}')).toBe(false);
    expect(madeByNewerVersion("[]")).toBe(false);
    expect(madeByNewerVersion("null")).toBe(false);
  });
});
