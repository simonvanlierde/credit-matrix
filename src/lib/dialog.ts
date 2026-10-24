import { type MouseEvent, useEffect } from "react";

/**
 * Drive a native modal `<dialog>` from a boolean. `showModal()` supplies the
 * focus trap, Escape handling, backdrop and inert background; the caller keeps
 * `open` in sync from the dialog's own `onClose`.
 */
export function useModalDialog(dialog: HTMLDialogElement | null, open: boolean) {
  useEffect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [dialog, open]);
}

// Only one modal is open at a time, so one flag serves them all.
let pressedOnBackdrop = false;

/**
 * Handlers for a modal `<dialog>`: it closes on a click whose press and release
 * both landed on the backdrop (the element itself, outside its content). Closing
 * on the press would lose typed text to a stray touch, and a drag that starts
 * inside and ends outside must not count.
 */
export const closeOnBackdrop = {
  onMouseDown(event: MouseEvent<HTMLDialogElement>) {
    pressedOnBackdrop = event.target === event.currentTarget;
  },
  // A press on the backdrop released on the content still clicks the dialog, the element both share.
  onMouseUp(event: MouseEvent<HTMLDialogElement>) {
    pressedOnBackdrop &&= event.target === event.currentTarget;
  },
  onClick(event: MouseEvent<HTMLDialogElement>) {
    if (pressedOnBackdrop && event.target === event.currentTarget) event.currentTarget.close();
    pressedOnBackdrop = false;
  },
};
