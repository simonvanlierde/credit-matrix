import { renderToString } from "react-dom/server";
import RootLayout from "./app/layout";
import { PathnameContext } from "./lib/pathname";
import { type Route, routes } from "./routes";

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
