// biome-ignore-all lint/correctness/noNodejsModules: build-time dependency download.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import manifest from "./citesync-runtime.json" with { type: "json" };

const target = new URL("../public/citesync/", import.meta.url);
await mkdir(target, { recursive: true });
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
