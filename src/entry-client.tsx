import { createRoot, hydrateRoot } from "react-dom/client";
import RootLayout from "./app/layout";
import { PathnameContext } from "./lib/pathname";
import { routeFor, routes } from "./routes";

const path = routeFor(window.location.pathname);
const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
const page = path ? await routes[path]() : null;
const Page =
  page?.default ??
  (() => (
    <p>
      Page not found. <a href="/">Return to CRediT Matrix</a>.
    </p>
  ));
if (page && "title" in page.metadata && typeof page.metadata.title === "string") document.title = page.metadata.title;
const app = (
  <PathnameContext value={path ?? window.location.pathname}>
    <RootLayout>
      <Page />
    </RootLayout>
  </PathnameContext>
);
if (path && root.hasChildNodes()) hydrateRoot(root, app);
else createRoot(root).render(app);
