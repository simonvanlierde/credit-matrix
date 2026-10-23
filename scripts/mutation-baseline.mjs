// Writes the surviving mutants from reports/mutation/mutation.json to test/mutation-baseline.txt.
// The list is sorted and has no run times, so a diff of it shows only mutants that changed.
// biome-ignore-all lint/correctness/noNodejsModules: Node script, not client code.
// biome-ignore-all lint/suspicious/noConsole: console is the script's summary output.

import { readFileSync, writeFileSync } from "node:fs";

const report = JSON.parse(readFileSync("reports/mutation/mutation.json", "utf8"));
const root = `${process.cwd()}/`;

const lines = [];
let killed = 0;
let survived = 0;
let noCoverage = 0;
for (const [file, { source, mutants }] of Object.entries(report.files)) {
  const rows = source.split("\n");
  for (const m of mutants) {
    if (m.status === "Killed" || m.status === "Timeout") killed += 1;
    if (m.status === "Survived") survived += 1;
    if (m.status === "NoCoverage") noCoverage += 1;
    if (m.status !== "Survived" && m.status !== "NoCoverage") continue;
    const { line, column } = m.location.start;
    const code = rows[line - 1].trim().slice(0, 100);
    const replacement = m.replacement.replaceAll("\n", " ").slice(0, 60);
    lines.push(`${file.replace(root, "")}:${line}:${column} ${m.status} ${m.mutatorName} -> ${replacement} | ${code}`);
  }
}
lines.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

const total = killed + survived + noCoverage;
const score = ((100 * killed) / total).toFixed(2);
const header = [
  "# Mutants that no test kills, from `pnpm mutation` on src/core.",
  "# Each line: file:line:column status mutator -> replacement | original line.",
  `# Score ${score}%: ${killed} killed, ${survived} survived, ${noCoverage} without coverage.`,
];
writeFileSync("test/mutation-baseline.txt", `${[...header, ...lines].join("\n")}\n`);
console.log(`Mutation score ${score}% (${survived} survived, ${noCoverage} no coverage): test/mutation-baseline.txt`);
