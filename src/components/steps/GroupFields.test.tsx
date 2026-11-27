import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isGroup } from "@/core";
import { MAX_GROUP_MEMBERS } from "@/core/author";
import { announce } from "@/lib/announce";
import { IntlProvider } from "@/lib/translations";
import { messages } from "@/locales/en/messages";
import { useContributionStore } from "@/store/contribution-store";
import { AuthorList } from "./AuthorInput";
import { GroupFields } from "./GroupFields";

vi.mock("@/lib/announce", () => ({ announce: vi.fn() }));

const group = () => {
  const found = useContributionStore.getState().authors.find(isGroup);
  if (!found) throw new Error("no group");
  return found;
};

describe("a group row", () => {
  beforeEach(async () => {
    vi.mocked(announce).mockClear();
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
    expect(group().ror).toBe("05dxps055");
    expect(announce).toHaveBeenCalledWith("That is not a valid ROR id.", { assertive: true });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(group()).not.toHaveProperty("ror");
    expect(screen.queryByText("That is not a valid ROR id.")).toBeNull();
  });

  it("keeps a member's link to a person row while the name stays in the list", () => {
    const person = useContributionStore.getState().authors.find((a) => !isGroup(a));
    fireEvent.change(screen.getByLabelText("Contact person (answers review requests)"), {
      target: { value: person?.id },
    });
    const members = screen.getByLabelText("Members (one name per line)");
    fireEvent.change(members, { target: { value: "Ada Lovelace\nGrace Hopper" } });
    fireEvent.blur(members);
    expect(group().members).toEqual([{ name: "Ada Lovelace" }, { name: "Grace Hopper", personId: person?.id }]);
    expect(group().contactId).toBe(person?.id);
  });

  it("refuses more members than a group holds, and says so", () => {
    const members = screen.getByLabelText("Members (one name per line)");
    const names = Array.from({ length: MAX_GROUP_MEMBERS + 1 }, (_, i) => `Member ${i}`).join("\n");
    fireEvent.change(members, { target: { value: names } });
    fireEvent.blur(members);
    expect(group().members).toEqual([]);
    const message = `A group holds at most ${MAX_GROUP_MEMBERS} members. Remove some to save the list.`;
    expect(screen.getByText(message)).toBeTruthy();
    expect(members.getAttribute("aria-invalid")).toBe("true");
    expect(announce).toHaveBeenCalledWith(message, { assertive: true });
  });
});

describe("a locked group row", () => {
  afterEach(cleanup);

  it("shows its fields read-only and does not dim its selects as read-only", () => {
    useContributionStore.getState().loadAuthors([]);
    useContributionStore.getState().addAuthor("Grace Hopper");
    useContributionStore.getState().addGroup("Study Group");
    render(
      <IntlProvider locale="en" messages={messages}>
        <GroupFields group={group()} rowLocked />
      </IntlProvider>,
    );
    for (const label of ["Short name (chips and figure)", "ROR id or URL", "Members (one name per line)"])
      expect(screen.getByLabelText(label).hasAttribute("readonly")).toBe(true);
    for (const label of ["Members are", "Contact person (answers review requests)"]) {
      const select = screen.getByLabelText(label);
      expect(select.hasAttribute("disabled")).toBe(true);
      expect(select.className).not.toContain("read-only:");
    }
  });
});
