// biome-ignore-all lint/correctness/noNodejsModules: Vite runs in Node.
import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { type Connect, defineConfig, type Plugin } from "vite";
import { docsPlugin } from "./src/docs/plugin.mjs";

const MODEL_JSON = fileURLToPath(new URL("./census/model.json", import.meta.url));

/**
 * For development only, never in CI: `READER_MODEL_DIR=<a census browser export>` points the statement
 * reader at that export, served at /reader-model/ by `pnpm dev` and `pnpm preview` (e2e/statement-reader.spec.ts
 * routes it in a production build), in place of the Hub commit census/model.json pins.
 */
function readerModel(dir: string | undefined): Plugin[] {
  if (!dir) return [];
  if (process.env.GITHUB_ACTIONS) throw new Error("READER_MODEL_DIR is for local builds only.");
  // What src/lib/statement-reader.worker.ts downloads, each pinned by size and sha256.
  const files = ["tokenizer.json", "config.json", "best.json", "onnx/model_w8.onnx"].map((file) => {
    const body = readFileSync(join(dir, file));
    return { file, bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") };
  });
  // The hash in the path keeps the reader's cache from serving an earlier export.
  const all = createHash("sha256")
    .update(files.map((f) => f.sha256).join())
    .digest("hex");
  const base = `/reader-model/${all.slice(0, 12)}/`;
  const pinned = {
    ...JSON.parse(readFileSync(MODEL_JSON, "utf8")),
    base,
    sha256: Object.fromEntries(files.map((f) => [f.file, f.sha256])),
    bytes: Object.fromEntries(files.map((f) => [f.file, f.bytes])),
  };
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    const path = req.url?.startsWith(base) && join(dir, decodeURIComponent(req.url.slice(base.length)));
    if (!path || relative(dir, path).startsWith("..")) return next();
    createReadStream(path).on("error", next).pipe(res);
  };
  return [
    {
      name: "reader-model",
      enforce: "pre",
      load: (id) => (id === MODEL_JSON ? JSON.stringify(pinned) : undefined),
      configureServer: (server) => void server.middlewares.use(serve),
      configurePreviewServer: (server) => void server.middlewares.use(serve),
    },
  ];
}

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [
    react(),
    docsPlugin(),
    ...readerModel(process.env.READER_MODEL_DIR),
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
  // onnxruntime-web starts its threads as module workers of the statement reader's own script.
  // The worker build runs only these plugins.
  worker: { format: "es" as const, plugins: () => readerModel(process.env.READER_MODEL_DIR) },
}));
