import { render, screen } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { Announcer, announce } from "./announce";

/** Announcements land a frame late, on purpose; run that frame. */
async function flushFrame() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

describe("Announcer", () => {
  it("routes polite and assertive messages to their own live regions", async () => {
    render(<Announcer />);

    act(() => announce("Copied to clipboard"));
    await flushFrame();
    expect(screen.getByRole("status")).toHaveProperty("textContent", "Copied to clipboard");
    expect(screen.getByRole("alert")).toHaveProperty("textContent", "");

    act(() => announce("Copy failed. Try again.", { assertive: true }));
    await flushFrame();
    expect(screen.getByRole("alert")).toHaveProperty("textContent", "Copy failed. Try again.");
  });

  it("clears before re-setting, so an identical repeat is still announced", async () => {
    render(<Announcer />);

    act(() => announce("Copied to clipboard"));
    await flushFrame();

    act(() => announce("Copied to clipboard"));
    // The clear happens synchronously; a screen reader sees the region empty
    // and then refilled, which is what re-triggers the announcement.
    expect(screen.getByRole("status")).toHaveProperty("textContent", "");
    await flushFrame();
    expect(screen.getByRole("status")).toHaveProperty("textContent", "Copied to clipboard");
  });

  it("stops listening on unmount, so nothing announces into a dead tree", () => {
    render(<Announcer />).unmount();

    expect(() => announce("Copied to clipboard")).not.toThrow();
  });
});
