import * as PopoverPrimitive from "@radix-ui/react-popover";
import {
  cloneElement,
  type MouseEvent,
  type MouseEventHandler,
  type PointerEvent,
  type PointerEventHandler,
  type ReactElement,
  useRef,
} from "react";
import { cn } from "@/lib/utils";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
/** For panels anchored to a point (a right-clicked cell) rather than a trigger. */
export const PopoverAnchor = PopoverPrimitive.Anchor;

/**
 * A click shortcut on running text: the panel hangs off the text, but the text stays text, with no
 * popup state and no tab stop. Only for a panel the keyboard already reaches from a real trigger
 * elsewhere. A click that ends a text selection does not open it, and a click on the text while
 * the panel is open closes it (the pointerdown already did, as an outside click). Spread
 * `contentProps` on the panel and wrap the text in `anchorOn`: with no trigger to go back to, closing it returns focus to the text.
 */
export function useTextAnchor(open: boolean, onOpen: () => void) {
  const anchor = useRef<HTMLElement | null>(null);
  const closedByThisPress = useRef(false);
  const closedOutside = useRef(false);

  function anchorOn(children: ReactElement<{ onClick?: MouseEventHandler; onPointerDown?: PointerEventHandler }>) {
    return (
      <PopoverPrimitive.Anchor asChild>
        {cloneElement(children, {
          // Focusable by script only, so focus can come back here; still no tab stop.
          tabIndex: -1,
          onPointerDown: (event: PointerEvent) => {
            children.props.onPointerDown?.(event);
            closedByThisPress.current = open;
          },
          onClick: (event: MouseEvent<HTMLElement>) => {
            children.props.onClick?.(event);
            if (closedByThisPress.current) {
              closedByThisPress.current = false;
              return;
            }
            if (window.getSelection()?.isCollapsed === false) return;
            anchor.current = event.currentTarget;
            closedOutside.current = false;
            onOpen();
          },
        } as object)}
      </PopoverPrimitive.Anchor>
    );
  }

  const contentProps = {
    onInteractOutside: () => {
      closedOutside.current = true;
    },
    onCloseAutoFocus: (event: Event) => {
      // An outside click keeps focus where it went, as Radix does for a trigger.
      if (!anchor.current || closedOutside.current) return;
      event.preventDefault();
      anchor.current.focus({ preventScroll: true });
    },
  };
  return { anchorOn, contentProps };
}

export function PopoverContent({
  className,
  align = "start",
  sideOffset = 6,
  container,
  ref,
  ...props
}: React.ComponentPropsWithRef<typeof PopoverPrimitive.Content> & {
  /** Portal target. Pass an open <dialog> element when the trigger lives inside
   *  one: the top layer renders everything outside it inert. */
  container?: HTMLElement | null;
}) {
  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 rounded border border-edge bg-surface-bright p-3 shadow-float",
          // `panel-motion` (globals.css) holds the open/close keyframes; the
          // origin makes the panel grow from the trigger it hangs off.
          "panel-motion [transform-origin:var(--radix-popover-content-transform-origin)]",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
