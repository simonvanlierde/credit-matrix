import * as z from "zod/mini";

export const TOOLCHAINS = ["word", "markdown", "latex", "quarto", "typst", "pandoc", "myst", "sphinx"] as const;
export type Toolchain = (typeof TOOLCHAINS)[number];
export const ToolchainSchema = /* @__PURE__ */ z.enum(TOOLCHAINS);
