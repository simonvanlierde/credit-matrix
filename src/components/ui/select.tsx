"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  children,
  ref,
  ...props
}: React.ComponentPropsWithRef<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        "flex min-w-0 items-center justify-between gap-1 rounded border border-outline-variant bg-surface-bright [&>span]:truncate",
        "px-2 py-1 text-xs text-on-surface",
        "focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[placeholder]:text-on-surface-variant",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDown className="h-3 w-3 shrink-0 text-on-surface-variant" />
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  container,
  ref,
  ...props
}: React.ComponentPropsWithRef<typeof SelectPrimitive.Content> & {
  /** Portal target. Pass an open <dialog> element when the trigger lives inside
   *  one: the top layer renders everything outside it inert. */
  container?: HTMLElement | null;
}) {
  return (
    <SelectPrimitive.Portal container={container}>
      <SelectPrimitive.Content
        ref={ref}
        position="popper"
        sideOffset={4}
        className={cn(
          "z-50 max-w-[calc(100vw-1rem)] min-w-[8rem] overflow-hidden rounded border border-outline-variant bg-surface-bright shadow-md",
          "panel-motion [transform-origin:var(--radix-select-content-transform-origin)]",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ref,
  ...props
}: React.ComponentPropsWithRef<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center overflow-hidden rounded py-1.5 pl-8 pr-2 text-xs text-on-surface",
        "outline-none focus:bg-surface-container-low",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-3 w-3 text-primary" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
