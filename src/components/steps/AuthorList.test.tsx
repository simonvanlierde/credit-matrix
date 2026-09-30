import { act, cleanup, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import messages from "@/messages/en.json";
import { useContributionStore } from "@/store/contribution-store";
import { AuthorList } from "./AuthorInput";

const names = () =>
  screen.getAllByLabelText("Name or ORCID iD", { exact: true }).map((el) => (el as HTMLInputElement).value);
const ids = () => useContributionStore.getState().authors.map((a) => a.id);

/**
 * AuthorRow is memoized; these guard against a row keeping a stale name after
 * the list reorders, shrinks or renames.
 */
describe("AuthorList", () => {
  beforeEach(async () => {
    localStorage.clear();
    await useContributionStore.persist.rehydrate();
    useContributionStore.setState({ welcomeOpen: false, welcomeSeen: true });
    useContributionStore.getState().loadAuthors([]);
    for (const name of ["Ada Lovelace", "Bob White", "Carol Davis"]) useContributionStore.getState().addAuthor(name);
    render(
      <IntlProvider locale="en" messages={messages}>
        <AuthorList />
      </IntlProvider>,
    );
  });
  afterEach(cleanup);

  it("renders names in store order across move, remove and rename", () => {
    expect(names()).toEqual(["Ada Lovelace", "Bob White", "Carol Davis"]);

    act(() => useContributionStore.getState().moveAuthor(0, 2));
    expect(names()).toEqual(["Bob White", "Carol Davis", "Ada Lovelace"]);

    act(() => useContributionStore.getState().removeAuthor(ids()[1] as string));
    expect(names()).toEqual(["Bob White", "Ada Lovelace"]);

    act(() => {
      useContributionStore.getState().updateAuthorName(ids()[0] as string, "Robert White");
    });
    expect(names()).toEqual(["Robert White", "Ada Lovelace"]);
  });
});
