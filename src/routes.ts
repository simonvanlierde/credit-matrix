export const routes = {
  "/": () => import("./app/page"),
  "/about": () => import("./app/about/page"),
  "/census": () => import("./app/census/page"),
  "/accessibility": () => import("./app/accessibility/page"),
};

export type Route = keyof typeof routes;
export const routeFor = (path: string): Route | null => {
  const normalized = path.replace(/(?:\/|\.html)$/, "") || "/";
  return Object.hasOwn(routes, normalized) ? (normalized as Route) : null;
};
