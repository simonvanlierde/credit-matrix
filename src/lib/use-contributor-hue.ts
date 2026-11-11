import { contributorHue } from "@/core/contributor-color";
import { useContributionStore } from "@/store/contribution-store";

/**
 * This contributor's own hue, or null when the view uses the draft's one hue:
 * colour by contributor is off, or the list is longer than the palette.
 */
export function useContributorHue(authorId: string | undefined): string | null {
  return useContributionStore((s) => {
    if (!authorId || !s.colorByContributor) return null;
    return contributorHue(s.authors, authorId);
  });
}
