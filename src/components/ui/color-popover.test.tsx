import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { english } from "@/lib/test-messages";
import { IntlProvider } from "@/lib/translations";
import { messages as en } from "@/locales/en/messages";
import { ColorPopover } from "./color-popover";

it("passes on the custom color when it is committed, not on every drag step", () => {
  const onChange = vi.fn();
  render(
    <IntlProvider locale="en" messages={en}>
      <ColorPopover value="#0072b2" onChange={onChange} label="Color" trigger={<button type="button">Open</button>} />
    </IntlProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  const input = screen.getByLabelText(english.customColor);

  fireEvent.input(input, { target: { value: "#111111" } });
  fireEvent.input(input, { target: { value: "#123456" } });
  expect(onChange).not.toHaveBeenCalled();

  fireEvent.change(input, { target: { value: "#123456" } });
  expect(onChange.mock.calls).toEqual([["#123456"]]);
});

it("passes on the last custom color when the popover closes before the picker commits", () => {
  const onChange = vi.fn();
  render(
    <IntlProvider locale="en" messages={en}>
      <ColorPopover value="#0072b2" onChange={onChange} label="Color" trigger={<button type="button">Open</button>} />
    </IntlProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  const input = screen.getByLabelText(english.customColor);

  fireEvent.input(input, { target: { value: "#111111" } });
  fireEvent.input(input, { target: { value: "#123456" } });
  fireEvent.keyDown(input, { key: "Escape" });

  expect(screen.queryByLabelText(english.customColor)).toBeNull();
  expect(onChange.mock.calls).toEqual([["#123456"]]);
});
