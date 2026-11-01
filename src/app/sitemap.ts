import type { MetadataRoute } from "next";

export const dynamic = "force-static";

/** Served at `/sitemap.xml`. Lists every page a search engine should index; add new pages here. */
export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/about", "/census", "/accessibility"].map((path) => ({ url: `https://credit.duinlab.nl${path}` }));
}
