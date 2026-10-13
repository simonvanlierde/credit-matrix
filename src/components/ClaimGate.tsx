"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { useContributionStore } from "@/store/contribution-store";

// Only someone opening an ask link sees this page, so it loads on demand.
const CoauthorPage = dynamic(() => import("@/components/CoauthorPage").then((m) => m.CoauthorPage), {
  ssr: false,
  // Holds the screen the page is about to fill, so the footer does not jump up meanwhile.
  loading: () => <div className="min-h-dvh" />,
});

/**
 * The workspace's main area while a claim (ask) link is open: the workspace
 * itself, or the single-purpose page that answers the ask in its place.
 */
export function ClaimGate({ children }: { children: ReactNode }) {
  // Keyed on the ask, so a newer request (or its Undo) opens on the form, never on "Sent".
  const askKey = useContributionStore((s) =>
    s.claim && s.authors.some((author) => author.id === s.claim?.contributorId)
      ? `${s.claim.sourceDraftId}:${s.claim.contributorId}:${s.claim.sentAt ?? ""}`
      : null,
  );
  return askKey ? <CoauthorPage key={askKey} /> : children;
}
