import type { Metadata } from "next";
import { ClaimGate } from "@/components/CoauthorPage";
import { Inspector } from "@/components/Inspector";
import { LabelledSection } from "@/components/LabelledSection";
import { AuthorList } from "@/components/steps/AuthorInput";
import { ContributionGrid } from "@/components/steps/ContributionGrid";
import { WelcomeCard } from "@/components/WelcomeCard";
import { authors } from "@/lib/json-ld";
import codemeta from "../../codemeta.json";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// Structured data for search engines, built from codemeta.json (which citesync keeps in step with
// CITATION.cff), so the licence, version and authors never drift from the release metadata.
// Search engines read only schema.org terms, so the CodeMeta record is mapped, not embedded.
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: codemeta.name,
  description: codemeta.description,
  url: codemeta.url,
  applicationCategory: "ReferenceApplication",
  operatingSystem: codemeta.operatingSystem,
  isAccessibleForFree: true,
  license: codemeta.license,
  softwareVersion: codemeta.version,
  identifier: codemeta.identifier,
  keywords: codemeta.keywords.join(", "),
  sameAs: codemeta.codeRepository,
  author: authors,
};

export default function HomePage() {
  return (
    <>
      {/* Outside ClaimGate, which swaps its children for the co-author page. */}
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant built at build time, no user input
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <ClaimGate>
        <div className="desk:flex desk:h-full desk:flex-col">
          <WelcomeCard />
          {/* The workspace: the roster as a slim rail, the grid as the canvas, and
          the inspector (statement, team, review) on the right. Below xl they
          stack in that order and the page scrolls. The grid column takes all
          the width the two side columns leave, so a big roster gets the
          screen and a small one sits in a calm, wide canvas.

          `desk` additionally locks the row to the viewport height; each pane
          scrolls its own content from there. */}
          <div className="flex flex-col xl:grid xl:grid-cols-[auto_minmax(0,1fr)_26rem] 2xl:grid-cols-[auto_minmax(0,1fr)_30rem] desk:min-h-0 desk:flex-1 desk:overflow-hidden">
            <LabelledSection
              labelKey="stepContributors"
              className="min-w-0 border-b border-outline-variant/40 bg-surface-bright xl:border-b-0 xl:border-r desk:min-h-0"
            >
              <AuthorList />
            </LabelledSection>

            <LabelledSection
              id="grid"
              labelKey="a11yContributionGrid"
              className="min-w-0 scroll-mt-16 bg-surface-bright desk:min-h-0"
            >
              <ContributionGrid />
            </LabelledSection>

            <LabelledSection
              id="inspector"
              labelKey="a11yInspector"
              className="min-w-0 scroll-mt-16 border-t border-outline-variant/40 bg-surface-bright xl:border-t-0 xl:border-l desk:min-h-0"
            >
              <Inspector />
            </LabelledSection>
          </div>
        </div>
      </ClaimGate>
    </>
  );
}
