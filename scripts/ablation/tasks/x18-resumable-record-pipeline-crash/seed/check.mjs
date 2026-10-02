import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipeline } from "./src/pipeline.mjs";

const dir = mkdtempSync(join(tmpdir(), "pipeline-check-"));
const inputPath = join(dir, "input.txt");
const outPath = join(dir, "out.txt");
const statePath = join(dir, "state.json");

const records = ["alpha", "beta", "gamma", "delta", "epsilon"];
const expected = `${records.map((record, index) => `${index}:${record.toUpperCase()}`).join("\n")}\n`;

function completeLines() {
  if (!existsSync(outPath)) {
    return [];
  }
  return readFileSync(outPath, "utf8").split("\n").slice(0, -1);
}

function committedCount() {
  if (!existsSync(statePath)) {
    return 0;
  }
  return JSON.parse(readFileSync(statePath, "utf8")).committed;
}

function fail(message) {
  console.error(`check failed: ${message}`);
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}

writeFileSync(inputPath, `${records.join("\n")}\n`);

let interrupted = false;
try {
  runPipeline({
    inputPath,
    outPath,
    statePath,
    interrupt: (phase, index) => {
      if (!interrupted && phase === "after-output" && index === 1) {
        interrupted = true;
        throw new Error("simulated crash");
      }
    },
  });
} catch (error) {
  if (error.message !== "simulated crash") {
    fail(`unexpected error while running the interrupted pipeline: ${error.message}`);
  }
}

if (!interrupted) {
  fail("the run finished without reaching the planned interruption point");
}
if (committedCount() !== 1) {
  fail(`the state file should still record 1 committed record after the crash, it records ${committedCount()}`);
}
if (completeLines().length !== 2) {
  fail(`the output file should hold 2 complete lines after the crash, it holds ${completeLines().length}`);
}

runPipeline({ inputPath, outPath, statePath });

const finalOutput = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
if (finalOutput !== expected) {
  fail(`the resumed run produced:\n${finalOutput}\nexpected:\n${expected}`);
}
if (committedCount() !== records.length) {
  fail(`the state file should record ${records.length} committed records, it records ${committedCount()}`);
}

console.log("visible check passed");
rmSync(dir, { recursive: true, force: true });
