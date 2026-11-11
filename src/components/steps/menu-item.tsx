import type { ReactNode } from "react";
import { MENU_ITEM } from "./grid-shared";

const ITEM = `${MENU_ITEM} aria-disabled:cursor-not-allowed aria-disabled:text-on-surface-variant/50 aria-disabled:hover:bg-transparent`;
/** The icon class for a menu row's leading icon. */
export const MENU_ICON = "h-3.5 w-3.5 shrink-0 text-on-surface-variant";

/**
 * One row of the person menu or a role popover. Disabled stays focusable (aria-disabled), so a
 * keyboard user still finds the action and hears why it does nothing. A toggle names its next
 * action ("This is not me") and so takes no aria-pressed, which would read as the opposite.
 */
export function MenuItem({
  icon,
  disabled,
  onClick,
  children,
}: {
  icon: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      aria-disabled={disabled || undefined}
      className={ITEM}
    >
      {icon}
      {children}
    </button>
  );
}
