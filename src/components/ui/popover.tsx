import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
/** For panels anchored to a point (a right-clicked cell) rather than a trigger. */
export const PopoverAnchor = PopoverPrimitive.Anchor;

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
          // `panel-motion` (globals.css) carries the open/close keyframes; the
          // origin makes the panel grow from the trigger it hangs off.
          "panel-motion [transform-origin:var(--radix-popover-content-transform-origin)]",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
