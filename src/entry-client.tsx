import { createRoot, hydrateRoot } from "react-dom/client";
import RootLayout from "./app/layout";
import { PathnameContext } from "./lib/pathname";
import { reloadForNewBuild } from "./lib/reload-for-new-build";
import { routeFor, routes } from "./routes";

const path = routeFor(window.location.pathname);
const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
let page: Awaited<ReturnType<(typeof routes)[keyof typeof routes]>> | null = null;
try {
  if (path) page = await routes[path]();
} catch {
  // The page's chunk is gone (a deploy since this tab loaded) or the network failed. Without a
  // page the prerendered markup stays inert, so reload once, else say so with a way out.
  if (!reloadForNewBuild()) {
    const notice = document.createElement("p");
    notice.setAttribute("role", "alert");
    notice.append("This page could not load. ");
    const link = document.createElement("a");
    link.href = window.location.href;
    link.textContent = "Reload the page";
    notice.append(link, ".");
    // Prepended: the prerendered page stays readable without its script.
    root.prepend(notice);
  }
  await new Promise<never>(() => undefined);
}
const Page =
  page?.default ??
  (() => (
    <p>
      Page not found. <a href="/">Return to CRediT Matrix</a>.
    </p>
  ));
if (!page) document.title = "Page not found · CRediT Matrix";
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
