// biome-ignore-all lint/correctness/noNodejsModules: runs in Node before the core tests.
import { execFileSync } from "node:child_process";

/** Build dist/ once per run, so package.test.ts checks what would be published. */
export default function setup() {
  try {
    execFileSync("pnpm", ["run", "build"], { cwd: new URL("..", import.meta.url), stdio: "pipe" });
  } catch (error) {
    // Without the build's own output the error says only "Command failed".
    const { stdout, stderr } = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`Building the package failed:\n${stdout ?? ""}${stderr ?? ""}`, { cause: error });
  }
}
