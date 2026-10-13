"use client";

import { useEffect, useState } from "react";

type Announcement = { message: string; assertive: boolean };

// Module-level fan-out so any component can announce without prop-drilling a
// context through the (server-component) layout.
const listeners = new Set<(a: Announcement) => void>();

/**
 * Announce a transient message to assistive tech via the global live region.
 * Use `assertive` for errors that should interrupt; the default (polite) waits
 * for the screen reader to be idle. Requires <Announcer /> mounted once.
 */
export function announce(message: string, opts?: { assertive?: boolean }) {
  const event = { message, assertive: opts?.assertive ?? false };
  for (const listener of listeners) listener(event);
}

/** The single visually-hidden live region. Mount once near the app root. */
export function Announcer() {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");

  useEffect(() => {
    const onAnnounce = ({ message, assertive: isAssertive }: Announcement) => {
      const set = isAssertive ? setAssertive : setPolite;
      // Clear first, then set on the next frame, so an identical consecutive
      // message (e.g. copying twice) still re-triggers the announcement.
      set("");
      requestAnimationFrame(() => set(message));
    };
    listeners.add(onAnnounce);
    return () => {
      listeners.delete(onAnnounce);
    };
  }, []);

  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">
        {polite}
      </span>
      <span className="sr-only" role="alert" aria-live="assertive">
        {assertive}
      </span>
    </>
  );
}
