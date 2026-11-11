import { fireEvent, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CustomColorInput } from "./custom-color-input";

it("passes on the custom color when it is committed, not on every drag step", () => {
  const onChange = vi.fn();
  const { unmount } = render(<CustomColorInput id="custom" value="#0072b2" onChange={onChange} />);
  const input = document.getElementById("custom") as HTMLInputElement;

  fireEvent.input(input, { target: { value: "#111111" } });
  fireEvent.input(input, { target: { value: "#123456" } });
  expect(onChange).not.toHaveBeenCalled();

  fireEvent.change(input, { target: { value: "#123456" } });
  expect(onChange.mock.calls).toEqual([["#123456"]]);
  unmount();
  expect(onChange).toHaveBeenCalledTimes(1);
});

it("passes on the last custom color when settings close before the picker commits", () => {
  const onChange = vi.fn();
  const { unmount } = render(<CustomColorInput id="custom" value="#0072b2" onChange={onChange} />);
  const input = document.getElementById("custom") as HTMLInputElement;

  fireEvent.input(input, { target: { value: "#111111" } });
  fireEvent.input(input, { target: { value: "#123456" } });
  unmount();
  expect(onChange.mock.calls).toEqual([["#123456"]]);
});

it("keeps a stored short hex color when settings open and close", () => {
  const onChange = vi.fn();
  const { unmount } = render(<CustomColorInput id="custom" value="#abc" onChange={onChange} />);
  expect((document.getElementById("custom") as HTMLInputElement).value).toBe("#aabbcc");
  unmount();
  expect(onChange).not.toHaveBeenCalled();
});
