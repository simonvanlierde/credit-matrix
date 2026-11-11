import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PathnameContext } from "@/lib/pathname";
import { HomeLink } from "./HomeLink";

const renderAt = (path: string) =>
  render(
    <PathnameContext value={path}>
      <HomeLink>Home</HomeLink>
    </PathnameContext>,
  );

it("on the main page, scrolls to the top instead of reloading", () => {
  const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  renderAt("/");
  const clicked = fireEvent.click(screen.getByRole("link", { name: "Home" }));
  expect(clicked).toBe(false);
  expect(scroll).toHaveBeenCalled();
  scroll.mockRestore();
});

it("scrolls a pane that scrolls on its own back to the top", () => {
  const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  render(
    <PathnameContext value="/">
      <HomeLink>Home</HomeLink>
      <main>
        <section data-testid="pane" />
      </main>
    </PathnameContext>,
  );
  const pane = screen.getByTestId("pane");
  pane.scrollTop = 300;
  pane.scrollTo = vi.fn();
  fireEvent.click(screen.getByRole("link", { name: "Home" }));
  expect(pane.scrollTo).toHaveBeenCalledWith({ top: 0 });
  scroll.mockRestore();
});

it.each([
  ["a ctrl-click", { ctrlKey: true }],
  ["a cmd-click", { metaKey: true }],
  ["a shift-click", { shiftKey: true }],
  ["a middle click", { button: 1 }],
])("on the main page, leaves %s to the browser", (_, init) => {
  const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  renderAt("/");
  expect(fireEvent.click(screen.getByRole("link", { name: "Home" }), init)).toBe(true);
  expect(scroll).not.toHaveBeenCalled();
  scroll.mockRestore();
});

it("elsewhere, follows the link", () => {
  renderAt("/census");
  expect(fireEvent.click(screen.getByRole("link", { name: "Home" }))).toBe(true);
});
