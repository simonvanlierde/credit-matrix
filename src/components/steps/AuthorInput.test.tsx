import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthor, lookupOrcidPerson, type OrcidLookupResult } from "@/core";
import { announce } from "@/lib/announce";
import { decodeShareHash } from "@/lib/share";
import en from "@/messages/en.json";
import { useContributionStore } from "@/store/contribution-store";
import { AuthorList } from "./AuthorInput";

vi.mock("@/lib/announce", () => ({ announce: vi.fn() }));
vi.mock("@/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core")>()),
  lookupOrcidPerson: vi.fn(),
}));

const ALICE = "0000-0002-1825-0097";
const BOB = "0000-0001-5109-3700";
const NOT_FOUND: OrcidLookupResult = { ok: false, status: 404, code: "NOT_FOUND", error: "" };
const UNAVAILABLE: OrcidLookupResult = { ok: false, status: 502, code: "UNAVAILABLE", error: "" };

const initial = useContributionStore.getState();

function found(displayName: string): OrcidLookupResult {
  return { ok: true, firstName: "", surname: "", displayName };
}

/** One held lookup per iD, each resolved only when the test says so. */
function deferLookups() {
  const held = new Map<string, (result: OrcidLookupResult) => void>();
  vi.mocked(lookupOrcidPerson).mockImplementation((orcid) => {
    const { promise, resolve } = Promise.withResolvers<OrcidLookupResult>();
    held.set(orcid, resolve);
    return promise;
  });
  return (orcid: string, result: OrcidLookupResult) => act(async () => held.get(orcid)?.(result));
}

function renderList() {
  return render(
    <IntlProvider locale="en" messages={en}>
      <AuthorList />
    </IntlProvider>,
  );
}

const authors = () => useContributionStore.getState().authors;
const addField = () => screen.getByLabelText<HTMLInputElement>(en.addContributor);

function addById(orcid: string) {
  fireEvent.change(addField(), { target: { value: orcid } });
  fireEvent.keyDown(addField(), { key: "Enter" });
}

beforeEach(() => {
  useContributionStore.setState(initial, true);
});

describe("adding a contributor by ORCID iD", () => {
  it("drops the seeded row and restores the iD when the lookup fails", async () => {
    const resolve = deferLookups();
    renderList();
    addById(ALICE);
    expect(authors()).toHaveLength(1);

    await resolve(ALICE, NOT_FOUND);

    expect(authors()).toHaveLength(0);
    expect(addField().value).toBe(ALICE);
  });

  it("keeps a row the user renamed during the lookup, and what they typed next", async () => {
    const resolve = deferLookups();
    renderList();
    addById(ALICE);
    const id = authors()[0]?.id ?? "";
    act(() => {
      useContributionStore.getState().updateAuthorName(id, "Alice Carberry");
    });
    fireEvent.change(addField(), { target: { value: "Bob Smith" } });

    await resolve(ALICE, NOT_FOUND);

    expect(authors().map((a) => a.name)).toEqual(["Alice Carberry"]);
    expect(addField().value).toBe("Bob Smith");
  });

  it("keeps a row the user gave a role during the lookup", async () => {
    const resolve = deferLookups();
    renderList();
    addById(ALICE);
    act(() => {
      useContributionStore.getState().toggleContribution(authors()[0]?.id ?? "", 0);
    });

    await resolve(ALICE, NOT_FOUND);

    expect(authors()).toHaveLength(1);
  });

  it("says offline when the connection dropped during the request", async () => {
    const resolve = deferLookups();
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    renderList();
    addById(ALICE);

    onLine.mockReturnValue(false);
    await resolve(ALICE, UNAVAILABLE);

    expect(screen.getByText(en.errOffline)).toBeTruthy();
  });
});

describe("pasting a list of ORCID iDs", () => {
  it("reports lookups whose name could not be written as failed", async () => {
    const resolve = deferLookups();
    renderList();
    fireEvent.paste(addField(), { clipboardData: { getData: () => `${ALICE}, ${BOB}` } });
    expect(authors()).toHaveLength(2);

    // A draft switch mid-lookup: the rows the names were meant for are gone.
    act(() => {
      useContributionStore.getState().createDraft();
    });
    await resolve(ALICE, found("Alice Carberry"));
    await resolve(BOB, found("Bob Smith"));

    expect(vi.mocked(announce)).toHaveBeenLastCalledWith(expect.stringContaining("Could not look up 2 ORCID iDs"), {
      assertive: true,
    });
  });
});

describe("a row's ORCID lookup", () => {
  it("keeps the name of the latest iD when an older lookup finishes last", async () => {
    const resolve = deferLookups();
    useContributionStore.setState({ authors: [createAuthor("Someone", { orcid: ALICE })] });
    renderList();

    fireEvent.click(screen.getByRole("button", { name: en.lookupOrcidName }));
    fireEvent.paste(screen.getByLabelText(en.nameLabel), { clipboardData: { getData: () => BOB } });
    await resolve(BOB, found("Bob Smith"));
    await resolve(ALICE, found("Alice Carberry"));

    expect(authors()[0]).toMatchObject({ name: "Bob Smith", orcid: BOB });
  });

  it("says why when the registry's name fails the name rules, and keeps the old one", async () => {
    const resolve = deferLookups();
    useContributionStore.setState({ authors: [createAuthor("Someone", { orcid: ALICE })] });
    renderList();

    fireEvent.click(screen.getByRole("button", { name: en.lookupOrcidName }));
    await resolve(ALICE, found("x".repeat(600)));

    expect(authors()[0]?.name).toBe("Someone");
    expect(announce).toHaveBeenCalledWith(en.errNameTooLong, { assertive: true });
    expect(announce).not.toHaveBeenCalledWith(expect.stringContaining("x".repeat(600)));
  });
});

describe("asking a contributor", () => {
  let writeText = vi.fn<(text: string) => Promise<void>>();
  function stubClipboard(impl: (text: string) => Promise<void>) {
    writeText = vi.fn(impl);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  }

  /** Click an ask item and wait out the link build and the clipboard write. */
  async function ask(item: string) {
    // The menu stays open after an item, so open it only the first time.
    if (!screen.queryByRole("button", { name: item })) {
      fireEvent.click(screen.getByRole("button", { name: "Actions for Jane Smith" }));
    }
    fireEvent.click(screen.getByRole("button", { name: item }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    await act(async () => {
      await writeText.mock.results[0]?.value?.catch(() => undefined);
    });
  }

  it("records the ask only once the link reached the clipboard", async () => {
    useContributionStore.setState({ authors: [createAuthor("Jane Smith")] });
    const id = authors()[0]?.id ?? "";
    renderList();

    stubClipboard(() => Promise.reject(new Error("denied")));
    await ask("Ask Jane Smith what they did");
    expect(useContributionStore.getState().asks).toEqual({});

    let copied = "";
    stubClipboard((text) => {
      copied = text;
      return Promise.resolve();
    });
    await ask("Ask Jane Smith what they did");
    const recorded = useContributionStore.getState().asks[id];
    expect(recorded).toMatchObject({ prefilled: false });

    // The link and the record agree on what was sent and when.
    const shared = await decodeShareHash(copied.slice(copied.indexOf("#")));
    expect(shared).toMatchObject({ blank: true, sentAt: recorded?.sentAt, claimId: id });
  });

  it("records a pre-filled ask as such", async () => {
    useContributionStore.setState({ authors: [createAuthor("Jane Smith")] });
    renderList();
    stubClipboard(() => Promise.resolve());
    await ask("Ask Jane Smith to check your guess");
    expect(Object.values(useContributionStore.getState().asks)).toEqual([
      { sentAt: expect.any(Number), prefilled: true },
    ]);
  });
});
