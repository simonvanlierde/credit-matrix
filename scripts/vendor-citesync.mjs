// biome-ignore-all lint/correctness/noNodejsModules: build-time dependency download.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import manifest from "./citesync-runtime.json" with { type: "json" };

const target = new URL("../public/citesync/", import.meta.url);
// The Python runtime comes from the pyodide devDependency, so the pnpm lockfile's integrity
// hash pins it and the site serves it itself: no third-party origin in the worker's CSP.
const pyodideSource = new URL("../node_modules/pyodide/", import.meta.url);
const pyodideTarget = new URL("pyodide/", target);
// Exactly what loadPyodide fetches when no packages are loaded from its repository.
const pyodideFiles = ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];
await mkdir(pyodideTarget, { recursive: true });
await Promise.all(pyodideFiles.map((name) => copyFile(new URL(name, pyodideSource), new URL(name, pyodideTarget))));
await Promise.all(
  manifest.wheels.map(async ({ name, url, sha256 }) => {
    if (!/^https:\/\/files\.pythonhosted\.org\//.test(url) || name.includes("/")) throw new Error("Invalid wheel URL");
    const path = new URL(name, target);
    let bytes = await readFile(path).catch(() => null);
    if (!bytes || createHash("sha256").update(bytes).digest("hex") !== sha256) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Cannot download ${name}: ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
      if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error(`Hash mismatch for ${name}`);
      await writeFile(path, bytes);
    }
  }),
);
await writeFile(new URL("runtime.json", target), JSON.stringify(manifest));
