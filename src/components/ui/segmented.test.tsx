import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SegmentedControl } from "./segmented";

const OPTIONS = [
  { value: "a", label: "A" },
  { value: "b", label: "B" },
  { value: "c", label: "C" },
] as const;

function renderGroup(value: string) {
  const onChange = vi.fn();
  render(<SegmentedControl options={[...OPTIONS]} value={value as "a"} onChange={onChange} ariaLabel="Pick" />);
  return { onChange, group: screen.getByRole("radiogroup") };
}

it("keeps a group with no matching value reachable and steps in from either end", () => {
  const { onChange, group } = renderGroup("unknown");
  expect(screen.getAllByRole("radio").map((radio) => radio.tabIndex)).toEqual([0, -1, -1]);

  fireEvent.keyDown(group, { key: "ArrowLeft" });
  fireEvent.keyDown(group, { key: "ArrowDown" });

  expect(onChange.mock.calls).toEqual([["c"], ["a"]]);
});

it("leaves arrow keys with a modifier to the browser", () => {
  const { onChange, group } = renderGroup("b");

  const handled = !fireEvent.keyDown(group, { key: "ArrowLeft", altKey: true });

  expect(handled).toBe(false);
  expect(onChange).not.toHaveBeenCalled();
});
