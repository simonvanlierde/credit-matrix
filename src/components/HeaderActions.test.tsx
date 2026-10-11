import { render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { expect, it } from "vitest";
import { createAuthor } from "@/core";
import { buildShareUrl } from "@/lib/share";
import en from "@/messages/en.json";
import { useContributionStore } from "@/store/contribution-store";
import { HeaderActions } from "./HeaderActions";
import { StatusBanner } from "./StatusBanner";

it("opens a link even when the address bar lost its hash before hashchange fired", async () => {
  render(
    <IntlProvider locale="en" messages={en}>
      <HeaderActions />
      <StatusBanner />
    </IntlProvider>,
  );
  const link = await buildShareUrl({ authors: [createAuthor("Ann One")] });
  // Next.js syncs its router to the URL the previous link's handler left
  // behind, and that write can land after the next hash navigation: the
  // event still names the link, the address bar no longer does.
  expect(window.location.hash).toBe("");
  window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL: window.location.href, newURL: link }));

  expect(await screen.findByText("Opened the shared draft.")).toBeTruthy();
  expect(useContributionStore.getState().authors.map((author) => author.name)).toEqual(["Ann One"]);
});
