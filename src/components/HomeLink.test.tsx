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

it("elsewhere, follows the link", () => {
  renderAt("/census");
  expect(fireEvent.click(screen.getByRole("link", { name: "Home" }))).toBe(true);
});
