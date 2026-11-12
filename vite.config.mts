// biome-ignore-all lint/correctness/noNodejsModules: Vite runs in Node.
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { docsPlugin } from "./src/docs/plugin.mjs";

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [
    react(),
    docsPlugin(),
    ...(isSsrBuild
      ? [
          {
            name: "skip-server-styles",
            enforce: "pre" as const,
            load(id: string) {
              if (id.endsWith(".css")) return "";
            },
          },
        ]
      : []),
  ],
  resolve: {
    alias: [
      { find: /^@\/core$/, replacement: fileURLToPath(new URL("./src/core/index.ts", import.meta.url)) },
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
    ],
  },
  build: { manifest: true, outDir: "out", target: "es2022" },
}));
