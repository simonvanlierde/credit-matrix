import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { AboutPopover } from "@/components/AboutPopover";
import { Lockup } from "@/components/BrandMark";
import { BrandMenu } from "@/components/BrandMenu";
import { HeaderActions } from "@/components/HeaderActions";
import { HowItWorks } from "@/components/HowItWorks";
import { LanguageSelector } from "@/components/LanguageSelector";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { SkipLink } from "@/components/SkipLink";
import { StatusBanner } from "@/components/StatusBanner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Announcer } from "@/lib/announce";
import { AppIntlProvider } from "@/lib/intl";
import { PERSIST_KEY } from "@/store/persist-meta";
// Server component: the manifest is read at build time and never bundled for the
// client: only the version string is passed down to AboutPopover.
import packageJson from "../../package.json";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-newsreader",
  display: "swap",
});

const description = "Draft CRediT contribution statements for scholarly publications.";

export const metadata: Metadata = {
  // The social card needs absolute URLs; Next resolves them against this.
  metadataBase: new URL("https://credit.duinlab.nl"),
  title: "CRediT Matrix",
  description,
  // og/twitter title and description inherit from the top-level fields.
  openGraph: {
    type: "website",
    siteName: "CRediT Matrix",
  },
  twitter: {
    card: "summary_large_image",
  },
};

/** Colors the browser chrome to match the theme the page will actually paint. */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#16181c" },
  ],
};

/**
 * Declare the saved interface language before first paint.
 *
 * The page is prerendered once as `en`, and AppIntlProvider only corrects the
 * attribute after hydration. Reading a locale cookie here instead would make
 * every route dynamic (a per-request render on the Worker, not the static
 * shell). This reads the persisted store directly instead. The provider still
 * has the final word once the catalog loads.
 */
const LANG_SCRIPT = `try{var l=JSON.parse(localStorage.getItem(${JSON.stringify(PERSIST_KEY)})).state.uiLocale;if(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(l))document.documentElement.lang=l}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable} ${newsreader.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant script, no user input */}
        <script dangerouslySetInnerHTML={{ __html: LANG_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-surface text-on-surface">
        <AppIntlProvider>
          {/* Follows the OS on first visit; the header toggle's choice then persists. */}
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            <SkipLink />
            {/* pr compensates the scrollbar width modal primitives remove on open; the fixed
              header escapes the body padding that keeps <main> from reflowing. */}
            <header className="fixed top-0 w-full z-50 bg-surface-bright/80 backdrop-blur-md border-b border-outline-variant/20 pr-[var(--removed-body-scroll-bar-size,0px)]">
              <div className="mx-auto flex h-13 items-center justify-between gap-2 px-3 sm:px-8">
                {/* Brand */}
                <div className="flex items-center gap-8">
                  <h1 className="flex items-center text-primary">
                    {/* Below lg the lockup is the trigger for the two links the
                        nav has no room for; from lg it is the plain lockup and
                        the nav carries them itself. Exactly one is ever shown.
                        The boundary is lg, not md: at md the lockup, the nav and
                        the labelled actions together overrun the row, and the
                        wordmark used to absorb it by wrapping out of the header. */}
                    <BrandMenu version={packageJson.version} />
                    <span className="hidden shrink-0 items-center gap-2.5 lg:flex">
                      <Lockup />
                    </span>
                  </h1>
                  <nav className="hidden lg:flex gap-6 items-center">
                    <HowItWorks />
                    <AboutPopover version={packageJson.version} />
                  </nav>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <LanguageSelector />
                  <ThemeToggle />
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
            <main id="main-content" className="mx-auto pt-13 desk:h-dvh desk:overflow-hidden">
              {children}
            </main>
            <Announcer />
            <StatusBanner />
            <ServiceWorkerRegistrar />
          </ThemeProvider>
        </AppIntlProvider>
      </body>
    </html>
  );
}
