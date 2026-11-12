// Images ship with the site, so the strict img-src CSP holds and a page view asks no other host.
// Only these folders are bundled; the link test fails on an image anywhere else.
export const images = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("../../integrations/*/examples/*.{png,jpg,svg,webp}", {
      query: "?url",
      import: "default",
      eager: true,
    }),
  ).map(([key, url]) => [key.replace(/^(?:\.\.\/)+/, ""), url]),
);
