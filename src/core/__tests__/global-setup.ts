// biome-ignore lint/correctness/noNodejsModules: runs in Node before the core tests.
import { execFileSync } from "node:child_process";

/** Build dist/ once per run, so package.test.ts checks what would be published. */
export default function setup() {
  execFileSync("pnpm", ["run", "build"], { cwd: new URL("..", import.meta.url), stdio: "ignore" });
}
