import { docFiles } from "./docs/pages";

export const routes: Record<
  string,
  () => Promise<{ default: () => React.ReactNode; metadata: { title?: string; description: string } }>
> = {
  "/": () => import("./app/page"),
  "/about": () => import("./app/about/page"),
  "/census": () => import("./app/census/page"),
  "/accessibility": () => import("./app/accessibility/page"),
  "/docs": () => import("./app/docs/page").then((page) => page.docsIndex()),
  ...Object.fromEntries(
    docFiles.map((file) => [file.route, () => import("./app/docs/page").then((page) => page.docPage(file.route))]),
  ),
};

export type Route = keyof typeof routes;
export const routeFor = (path: string): Route | null => {
  const normalized = path.replace(/(?:\/|\.html)$/, "") || "/";
  return Object.hasOwn(routes, normalized) ? (normalized as Route) : null;
};
