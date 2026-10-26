import type { Author } from "@/core";

/**
 * A contributor's initials badge, with the full name as a tooltip. Hidden from
 * screen readers: every place it appears also gives the full name, so reading
 * both said "A L, Ada Lovelace".
 */
export function InitialsChip({ author }: { author: Author }) {
  return (
    <span
      aria-hidden="true"
      title={author.name}
      className="shrink-0 inline-flex items-center justify-center min-w-[2.5rem] h-6 px-1.5 rounded-md font-mono text-[11px] font-semibold bg-primary/10 text-primary"
    >
      {author.initials}
    </span>
  );
}
