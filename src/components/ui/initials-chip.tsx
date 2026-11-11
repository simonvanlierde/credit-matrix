import type { Author } from "@/core";
import { useContributorHue } from "@/lib/use-contributor-hue";

/**
 * A contributor's initials badge, with the full name as a tooltip. Hidden from
 * screen readers: every place it appears also gives the full name, so reading
 * both said "A L, Ada Lovelace". With colour by contributor on, the badge is
 * filled in that person's hue, the same one their grid column uses.
 */
export function InitialsChip({ author }: { author: Author }) {
  const hue = useContributorHue(author.id);
  return (
    <span
      aria-hidden="true"
      title={author.name}
      className={`shrink-0 inline-flex items-center justify-center min-w-[2.5rem] h-6 px-1.5 rounded-sm font-mono text-[11px] font-semibold ${
        hue ? "text-white" : "bg-accent/10 text-accent"
      }`}
      style={hue ? { backgroundColor: hue } : undefined}
    >
      {author.initials}
    </span>
  );
}
