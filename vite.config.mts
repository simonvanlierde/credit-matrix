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
      // transformers.js imports the WebGPU build, whose 27 MB runtime is over Cloudflare's 25 MiB file
      // limit; the statement reader runs on the CPU build (14 MB), served from this site.
      { find: /^onnxruntime-web\/webgpu$/, replacement: "onnxruntime-web/wasm" },
    ],
  },
  build: { manifest: true, outDir: "out", target: "es2022" },
  // The statement reader's worker imports transformers.js, which splits into chunks.
  worker: { format: "es" as const },
}));
