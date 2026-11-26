import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isGroup } from "@/core";
import { IntlProvider } from "@/lib/translations";
import { messages } from "@/locales/en/messages";
import { useContributionStore } from "@/store/contribution-store";
import { AuthorList } from "./AuthorInput";

const group = () => {
  const found = useContributionStore.getState().authors.find(isGroup);
  if (!found) throw new Error("no group");
  return found;
};

describe("a group row", () => {
  beforeEach(async () => {
    localStorage.clear();
    await useContributionStore.persist.rehydrate();
    useContributionStore.setState({ welcomeOpen: false, welcomeSeen: true });
    useContributionStore.getState().loadAuthors([]);
    useContributionStore.getState().addAuthor("Grace Hopper");
    useContributionStore.getState().addGroup("The COVIDSurg Collaborative");
    render(
      <IntlProvider locale="en" messages={messages}>
        <AuthorList />
      </IntlProvider>,
    );
  });
  afterEach(cleanup);

  it("stores alias, ROR, members and contact from its details", () => {
    fireEvent.change(screen.getByLabelText("Short name (chips and figure)"), { target: { value: "CovidSurg" } });
    fireEvent.blur(screen.getByLabelText("Short name (chips and figure)"));
    fireEvent.change(screen.getByLabelText("Members (one name per line)"), {
      target: { value: "Ada Lovelace\n\nAlan Turing" },
    });
    fireEvent.blur(screen.getByLabelText("Members (one name per line)"));
    fireEvent.change(screen.getByLabelText("Members are"), { target: { value: "collaborators" } });
    const person = useContributionStore.getState().authors.find((a) => !isGroup(a));
    fireEvent.change(screen.getByLabelText("Contact person (answers review requests)"), {
      target: { value: person?.id },
    });

    const g = group();
    expect(g.alias).toBe("CovidSurg");
    expect(g.membersAre).toBe("collaborators");
    expect(g.members.map((m) => m.name)).toEqual(["Ada Lovelace", "Alan Turing", "Grace Hopper"]);
    expect(g.contactId).toBe(person?.id);
    expect(g.members.at(-1)?.personId).toBe(person?.id);

    fireEvent.change(screen.getByLabelText("Contact person (answers review requests)"), { target: { value: "" } });
    expect(group().contactId).toBeUndefined();
  });

  it("accepts a valid ROR id and flags a bad one", () => {
    const input = screen.getByLabelText("ROR id or URL");
    fireEvent.change(input, { target: { value: "https://ror.org/05dxps055" } });
    fireEvent.blur(input);
    expect(group().ror).toBe("05dxps055");
    fireEvent.change(input, { target: { value: "nonsense" } });
    fireEvent.blur(input);
    expect(screen.getByText("That is not a valid ROR id.")).toBeTruthy();
    act(() => undefined);
  });
});
