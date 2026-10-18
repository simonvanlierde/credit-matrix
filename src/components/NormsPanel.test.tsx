import { act, render, screen, within } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { describe, expect, it } from "vitest";
import { CREDIT_ROLES } from "@/core";
import { type FieldNorms, NORM_FIELDS, NORMS, normRows, positionOf } from "@/lib/field-norms";
import en from "@/messages/en.json";
import { useContributionStore } from "@/store/contribution-store";
import { NormsPanel } from "./NormsPanel";

describe("positionOf", () => {
  it("names the byline position the census counts", () => {
    expect(positionOf(0, 1)).toBe("single");
    expect(positionOf(0, 2)).toBe("first");
    expect(positionOf(1, 2)).toBe("last");
    expect(positionOf(1, 3)).toBe("middle");
    expect(positionOf(-1, 3)).toBeNull(); // nobody marked as you
    expect(positionOf(3, 3)).toBeNull();
  });
});

describe("normRows", () => {
  const norms: FieldNorms = {
    ...NORMS,
    // Reversed on purpose: rows follow the app's role order, not the file's.
    roles: [...NORMS.roles].reverse(),
    fields: {
      Ecology: {
        articles: 1000,
        authors: { single: 10, first: 100, middle: 100, last: 100 },
        shares: {
          single: null,
          first: [0.5, ...Array(13).fill(0)],
          middle: Array(14).fill(0),
          last: Array(14).fill(0),
        },
      },
    },
  };

  it("maps each role by its slug, in the app's role order", () => {
    const rows = normRows("Ecology", norms);
    expect(rows?.map((row) => row.role)).toEqual(CREDIT_ROLES.map((role) => role.name));
    expect(rows?.at(-1)).toEqual({
      role: "Writing – review & editing",
      shares: { single: null, first: 0.5, middle: 0, last: 0 },
    });
  });

  it("has nothing for no field or one the file does not hold", () => {
    expect(normRows(null, norms)).toBeNull();
    expect(normRows("Astrology", norms)).toBeNull();
  });

  it("holds every role for every field in the committed file", () => {
    expect(NORM_FIELDS.length).toBeGreaterThan(0);
    for (const field of NORM_FIELDS) {
      expect(NORMS.fields[field]?.articles).toBeGreaterThanOrEqual(NORMS.min_articles);
      for (const row of normRows(field) ?? []) {
        for (const share of Object.values(row.shares)) {
          if (share !== null) expect(share).toBeGreaterThanOrEqual(0);
        }
      }
    }
    expect(NORMS.roles).toHaveLength(14);
  });
});

describe("NormsPanel", () => {
  function renderPanel() {
    render(
      <IntlProvider locale="en" messages={en} timeZone="UTC">
        <NormsPanel />
      </IntlProvider>,
    );
  }

  it("shows the field's shares as a table, marks your column, and leaves the grid alone", () => {
    const field = NORM_FIELDS[0] ?? "";
    act(() => {
      const store = useContributionStore.getState();
      store.createDraft();
      for (const name of ["Ann Lee", "Bo Chen", "Cy Diaz"]) store.addAuthor(name);
      const last = useContributionStore.getState().authors[2];
      if (last) store.setSelfId(last.id);
      store.setNormsField(field);
    });
    const before = useContributionStore.getState().authors;
    renderPanel();

    const table = screen.getByRole("table", { name: en.normsCaption });
    expect(within(table).getAllByRole("row")).toHaveLength(15);
    expect(within(table).getByRole("columnheader", { name: /Last\s*You/ })).toBeTruthy();
    expect(screen.getByText(/you are the last author/)).toBeTruthy();
    expect(screen.getByText(/not been checked by hand/)).toBeTruthy();
    const articles = (NORMS.fields[field]?.articles ?? 0).toLocaleString("en");
    expect(screen.getByText(new RegExp(`^${articles} open-access research articles`))).toBeTruthy();
    // Context only: showing the norms writes nothing to the roster.
    expect(useContributionStore.getState().authors).toBe(before);
  });

  it("asks for a field when none is picked", () => {
    act(() => useContributionStore.getState().setNormsField(null));
    renderPanel();
    expect(screen.getByText(en.normsEmpty)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
