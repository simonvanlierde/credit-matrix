import { renderToString } from "react-dom/server";
import RootLayout from "./app/layout";
import { PathnameContext } from "./lib/pathname";
import { type Route, routes } from "./routes";

/** Every page's path: the list the prerender, the sitemap, the service worker and postbuild work from. */
export const paths = Object.keys(routes);

/** The Vite manifest keys of the modules a page loads, for its preload links. */
export function sourcesOf(path: Route) {
  if (path === "/") return ["src/app/page.tsx"];
  if (path === "/docs" || path.startsWith("/docs/")) return ["src/app/docs/page.tsx"];
  return [`src/app${path}/page.tsx`];
}

export async function render(path: Route) {
  const page = await routes[path]?.();
  if (!page) throw new Error(`render: no route ${path}`);
  const { default: Page, metadata } = page;
  return {
    html: renderToString(
      <PathnameContext value={path}>
        <RootLayout>
          <Page />
        </RootLayout>
      </PathnameContext>,
    ),
    metadata,
  };
}
