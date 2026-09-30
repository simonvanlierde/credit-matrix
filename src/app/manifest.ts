import type { MetadataRoute } from "next";

export const dynamic = "force-static";

/**
 * Web app manifest, served at `/manifest.webmanifest`.
 *
 * Paired with `public/sw.js`, this makes the app installable and lets a draft
 * survive a flight: everything except the ORCID and DOI lookups runs in the
 * browser (see the architecture note in the README).
 *
 * The maskable icon is rendered from `docs/brand/maskable-icon.html`; the SVG
 * is the same favicon the document links.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CRediT Matrix",
    short_name: "CRediT",
    description: "Draft CRediT contribution statements for scholarly publications.",
    start_url: "/",
    display: "standalone",
    // Matches --color-surface / --color-primary in globals.css.
    background_color: "#fafaf9",
    theme_color: "#1f4e79",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/icon-512.png", type: "image/png", sizes: "512x512", purpose: "maskable" },
    ],
  };
}
