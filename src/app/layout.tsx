import { ThemeProvider } from "next-themes";
import { AboutPopover } from "@/components/AboutPopover";
import { Lockup } from "@/components/BrandMark";
import { BrandMenu } from "@/components/BrandMenu";
import { CensusLink } from "@/components/CensusLink";
import { DocsLink } from "@/components/DocsLink";
import { HeaderActions } from "@/components/HeaderActions";
import { HomeLink } from "@/components/HomeLink";
import { HowItWorks } from "@/components/HowItWorks";
import { LanguageSelector } from "@/components/LanguageSelector";
import { PersistenceStatus } from "@/components/PersistenceStatus";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { SkipLink } from "@/components/SkipLink";
import { StatusBanner } from "@/components/StatusBanner";
import { ThemeHue } from "@/components/ThemeHue";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Announcer } from "@/lib/announce";
import { AppIntlProvider } from "@/lib/intl";
import packageJson from "../../package.json";
import "./fonts.css";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppIntlProvider>
      {/* Follows the OS on first visit; the header toggle's choice then persists. */}
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <ThemeHue />
        <SkipLink />
        {/* pr compensates the scrollbar width modal primitives remove on open; the fixed
              header escapes the body padding that keeps <main> from reflowing. */}
        <header
          data-app-header
          className="fixed top-0 w-full z-50 bg-surface border-b-[1.5px] border-edge pr-[var(--removed-body-scroll-bar-size,0px)]"
        >
          <div className="mx-auto flex h-13 items-center justify-between gap-2 px-3 sm:px-8">
            {/* Brand */}
            <div className="flex items-center gap-8">
              <h1 className="flex items-center text-primary">
                {/* Below lg the lockup is the trigger for the two links the
                        nav has no room for; from lg it is the plain lockup and
                        the nav shows them itself. Exactly one is ever shown.
                        The boundary is lg, not md: at md the lockup, the nav and
                        the labelled actions together overrun the row, and the
                        wordmark used to absorb it by wrapping out of the header. */}
                <BrandMenu version={packageJson.version} />
                {/* The lockup goes home, as a site's logo does; below lg it opens the menu instead. */}
                <HomeLink className="hidden shrink-0 items-center gap-2.5 rounded-lg lg:flex">
                  <Lockup />
                </HomeLink>
              </h1>
              <nav aria-label="Primary" className="hidden lg:flex gap-6 items-center">
                <HowItWorks />
                <AboutPopover version={packageJson.version} />
                <DocsLink />
                <CensusLink />
              </nav>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <div className="hidden md:flex items-center gap-2">
                <LanguageSelector />
                <ThemeToggle />
              </div>
              <HeaderActions />
            </div>
          </div>
        </header>

        {/* On a desktop-sized window the workspace is height-locked to the viewport
              (see the `desk` variant): the page itself never scrolls, and each of the
              three panes scrolls its own content. Narrow, short, or zoomed viewports
              keep ordinary document flow. */}
        {/* No page cap: the workflow row sizes itself to its content and
                centers, so a big monitor goes to the matrix when the roster
                needs it and to symmetric gutters when it does not. */}
        {/* The save-failure notice sits in flow above the page, so on a
                height-locked desk it shortens the workspace rather than covering it. */}
        {/* A page that hides the app header puts its own <header> here: inside <main> a
                header is no banner landmark. */}
        <div id="page-banner" />
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto outline-none pt-13 desk:flex desk:h-dvh desk:flex-col desk:overflow-hidden"
        >
          <PersistenceStatus />
          <div className="desk:min-h-0 desk:flex-1">{children}</div>
        </main>
        <Announcer />
        <StatusBanner />
        <ServiceWorkerRegistrar />
      </ThemeProvider>
    </AppIntlProvider>
  );
}
