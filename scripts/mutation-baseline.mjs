// Writes the surviving mutants from reports/mutation/mutation.json to test/mutation-baseline.txt.
// The list is sorted and has no run times, so a diff of it shows only mutants that changed.
// biome-ignore-all lint/correctness/noNodejsModules: Node script, not client code.
// biome-ignore-all lint/suspicious/noConsole: console is the script's summary output.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const BASELINE = "test/mutation-baseline.txt";
// A survivor left on purpose carries its reason after this marker: an equivalent mutant no test can
// tell apart, or a design constant a test would only restate.
const REASON = "  # kept: ";

const report = JSON.parse(readFileSync("reports/mutation/mutation.json", "utf8"));
const reasons = new Map();
if (existsSync(BASELINE)) {
  for (const row of readFileSync(BASELINE, "utf8").split("\n")) {
    const at = row.lastIndexOf(REASON);
    if (at > 0) reasons.set(row.slice(0, at), row.slice(at));
  }
}
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
    const { line } = m.location.start;
    const code = rows[line - 1].trim().slice(0, 100);
    const replacement = m.replacement.replaceAll("\n", " ").slice(0, 60);
    // A literal BOM in the list trips the invisible-character check, so write it as an escape.
    lines.push(
      `${file.replace(root, "")} ${m.status} ${m.mutatorName} -> ${replacement} | ${code}`.replaceAll(
        "\uFEFF",
        "\\uFEFF",
      ),
    );
  }
}
lines.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
const annotated = lines.map((row) => row + (reasons.get(row) ?? ""));
const kept = annotated.filter((row) => row.includes(REASON)).length;

const total = killed + survived + noCoverage;
const score = ((100 * killed) / total).toFixed(2);
const header = [
  "# Mutants that no test kills, from `pnpm mutation` on src/core.",
  "# Each line: file status mutator -> replacement | original line, and why it is kept, for one left on purpose.",
  `# Score ${score}%: ${killed} killed, ${survived} survived, ${noCoverage} without coverage, ${kept} kept with a reason.`,
];
writeFileSync(BASELINE, `${[...header, ...annotated].join("\n")}\n`);
console.log(`Mutation score ${score}% (${survived} survived, ${noCoverage} no coverage): ${BASELINE}`);
