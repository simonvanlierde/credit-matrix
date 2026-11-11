import { renderToString } from "react-dom/server";
import RootLayout from "./app/layout";
import { PathnameContext } from "./lib/pathname";
import { type Route, routes } from "./routes";

/** Every page's path: the list the prerender, the sitemap, the service worker and postbuild work from. */
export const paths = Object.keys(routes);

/** The Vite manifest keys of the modules a page loads, for its preload links. */
export function sourcesOf(path: Route) {
  return [path === "/" ? "src/app/page.tsx" : `src/app${path}/page.tsx`];
}

export async function render(path: Route) {
  const { default: Page, metadata } = await routes[path]();
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
