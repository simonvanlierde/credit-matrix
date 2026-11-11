import type { ReactNode } from "react";
import { usePathname } from "@/lib/pathname";

/**
 * The lockup goes home, as a site's logo does. On the main page it is already home: a
 * reload there would only flash the app, and with site data blocked it would throw the
 * unsaved draft away, so it scrolls to the top instead.
 */
export function HomeLink({ className, children }: { className?: string; children: ReactNode }) {
  const home = usePathname() === "/";
  return (
    <a
      href="/"
      className={className}
      onClick={(event) => {
        if (!home || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        window.scrollTo({ top: 0 });
      }}
    >
      {children}
    </a>
  );
}
