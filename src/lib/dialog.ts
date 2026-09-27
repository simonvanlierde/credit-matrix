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

/** `onMouseDown` for a modal `<dialog>`: a press on the backdrop (the element itself, outside its content) closes it. */
export function closeOnBackdrop(event: MouseEvent<HTMLDialogElement>) {
  if (event.target === event.currentTarget) event.currentTarget.close();
}
