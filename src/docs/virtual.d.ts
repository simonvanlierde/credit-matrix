// The modules src/docs/plugin.mjs builds from the repo's Markdown files.
declare module "virtual:doc-files" {
  export const docFiles: import("./pages").DocFile[];
}

declare module "virtual:docs" {
  export const docs: (import("./pages").DocFile & { title: string; description: string; source?: string })[];
  export const imageSizes: Record<string, { width: number; height: number }>;
}
