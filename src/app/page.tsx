import { ClaimGate } from "@/components/CoauthorPage";
import { Inspector } from "@/components/Inspector";
import { LabelledSection } from "@/components/LabelledSection";
import { AuthorList } from "@/components/steps/AuthorInput";
import { ContributionGrid } from "@/components/steps/ContributionGrid";
import { WelcomeCard } from "@/components/WelcomeCard";
import { homeDescription, webApplicationJsonLd } from "@/lib/json-ld";

export const metadata = {
  description: homeDescription,
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <>
      {/* Outside ClaimGate, which swaps its children for the co-author page. */}
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant built at build time, no user input
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webApplicationJsonLd) }}
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
              className="min-w-0 border-b border-outline-variant xl:border-b-0 desk:min-h-0"
            >
              <AuthorList />
            </LabelledSection>

            <LabelledSection id="grid" labelKey="a11yContributionGrid" className="min-w-0 scroll-mt-16 desk:min-h-0">
              <ContributionGrid />
            </LabelledSection>

            <LabelledSection
              id="inspector"
              labelKey="a11yInspector"
              className="min-w-0 scroll-mt-16 border-t border-outline-variant xl:border-t-0 desk:min-h-0"
            >
              <Inspector />
            </LabelledSection>
          </div>
        </div>
      </ClaimGate>
    </>
  );
}
