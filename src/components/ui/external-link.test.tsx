import { render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { expect, it } from "vitest";
import { ExternalLink } from "./external-link";

it("opens in a new tab and says so in its accessible name", () => {
  render(
    <IntlProvider locale="en" messages={{ opensInNewTab: "(opens in new tab)" }}>
      <ExternalLink href="https://example.org" className="gap-1">
        Docs
      </ExternalLink>
    </IntlProvider>,
  );
  const link = screen.getByRole("link", { name: /^Docs.*opens in new tab/ });
  expect(link.getAttribute("href")).toBe("https://example.org");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  expect(link.className).toBe("inline-flex items-center gap-1");
});
