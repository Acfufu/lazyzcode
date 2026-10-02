import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadState, saveState } from "./state.mjs";

export function readRecords(inputPath) {
  if (!existsSync(inputPath)) {
    throw new Error(`input file not found: ${inputPath}`);
  }
  return readFileSync(inputPath, "utf8").split("\n").filter((line) => line.length > 0);
}

export function runPipeline({ inputPath, outPath, statePath, interrupt = () => {} }) {
  interrupt("start", 0);

  const records = readRecords(inputPath);
  const state = loadState(statePath);

  let committed = 0;
  if (state === null) {
    if (!existsSync(outPath)) {
      writeFileSync(outPath, "");
    }
  } else {
    committed = state.committed;
  }

  for (let i = committed; i < records.length; i += 1) {
    interrupt("before-output", i);
    saveState(statePath, i + 1);
    appendFileSync(outPath, `${i}:${records[i].toUpperCase()}\n`);
    interrupt("after-output", i);
    interrupt("after-state", i);
  }

  return { total: records.length, committed: records.length };
}
