import { renderHook } from "@testing-library/react";
import type { MouseEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { closeOnBackdrop, useModalDialog } from "./dialog";

/** jsdom has no showModal(), so stand in for the two calls the hook makes. */
function fakeDialog() {
  const dialog = { open: false, showModal: vi.fn(), close: vi.fn() };
  dialog.showModal.mockImplementation(() => {
    dialog.open = true;
  });
  dialog.close.mockImplementation(() => {
    dialog.open = false;
  });
  return dialog;
}

describe("useModalDialog", () => {
  it("opens and closes the dialog to follow the flag", () => {
    const dialog = fakeDialog();
    const { rerender } = renderHook(({ open }) => useModalDialog(dialog as unknown as HTMLDialogElement, open), {
      initialProps: { open: false },
    });
    expect(dialog.showModal).not.toHaveBeenCalled();

    rerender({ open: true });
    expect(dialog.showModal).toHaveBeenCalledTimes(1);
    // Already open: a re-render must not call showModal() again, which throws.
    rerender({ open: true });
    expect(dialog.showModal).toHaveBeenCalledTimes(1);

    rerender({ open: false });
    expect(dialog.close).toHaveBeenCalledTimes(1);
  });

  it("does nothing before the dialog element exists", () => {
    expect(() => renderHook(() => useModalDialog(null, true))).not.toThrow();
  });
});

describe("closeOnBackdrop", () => {
  it("closes only on a press on the dialog itself, not its content", () => {
    const dialog = fakeDialog();
    const press = (target: unknown) =>
      closeOnBackdrop({ target, currentTarget: dialog } as unknown as MouseEvent<HTMLDialogElement>);

    press({});
    expect(dialog.close).not.toHaveBeenCalled();
    press(dialog);
    expect(dialog.close).toHaveBeenCalledTimes(1);
  });
});
