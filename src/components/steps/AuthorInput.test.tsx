import { act, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthor, lookupOrcidPerson, type OrcidLookupResult } from "@/core";
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
beforeEach(() => {
  useContributionStore.setState(initial, true);
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
});
