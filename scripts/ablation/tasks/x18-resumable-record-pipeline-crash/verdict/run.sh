#!/usr/bin/env bash
set -u
# Read-only contract verification for the resumable record pipeline.
set -u

ROOT="$(pwd)"
TMPD="$(mktemp -d "${TMPDIR:-/tmp}/pipeline-verify.XXXXXX")" || exit 1
trap 'rm -rf "$TMPD"' EXIT

cat > "$TMPD/driver.mjs" <<'DRIVER'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.argv[2] || process.cwd();
const loaded = await import(pathToFileURL(join(root, "src", "pipeline.mjs")).href);
const runPipeline = loaded.runPipeline;
if (typeof runPipeline !== "function") {
  throw new Error("src/pipeline.mjs does not export runPipeline");
}

const N = 12;
const RECORDS = Array.from({ length: N }, (_, i) => `item ${i} #${(i * 7) % 5}`);
const INPUT_TEXT = `${RECORDS.join("\n")}\n`;
const EXPECTED_LINES = RECORDS.map((record, index) => `${index}:${record.toUpperCase()}`);
const EXPECTED = `${EXPECTED_LINES.join("\n")}\n`;
const INTERRUPT = new Error("interrupted on purpose");
const cleanups = [];

function assertOk(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function scratch(inputText) {
  const dir = mkdtempSync(join(tmpdir(), "pipeline-case-"));
  cleanups.push(dir);
  const ctx = {
    dir,
    inputPath: join(dir, "input.txt"),
    outPath: join(dir, "out.txt"),
    statePath: join(dir, "state.json"),
  };
  writeFileSync(ctx.inputPath, inputText);
  return ctx;
}

function stateCommitted(ctx) {
  if (!existsSync(ctx.statePath)) {
    return 0;
  }
  const raw = readFileSync(ctx.statePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`the state file is not valid JSON: ${raw.slice(0, 80)}`);
  }
  assertOk(parsed !== null && typeof parsed === "object" && !Array.isArray(parsed), "the state file does not hold an object");
  assertOk(Number.isInteger(parsed.committed) && parsed.committed >= 0, `the state file records a bad committed count: ${JSON.stringify(parsed.committed)}`);
  return parsed.committed;
}

function outputLines(ctx) {
  if (!existsSync(ctx.outPath)) {
    return [];
  }
  return readFileSync(ctx.outPath, "utf8").split("\n").slice(0, -1);
}

function checkWindow(ctx, phase, index) {
  const committed = stateCommitted(ctx);
  const out = outputLines(ctx);
  if (phase === "before-output") {
    assertOk(committed === index, `before-output(${index}): the state records ${committed} committed records`);
    assertOk(out.length === index, `before-output(${index}): the output holds ${out.length} complete lines`);
  } else if (phase === "after-output") {
    assertOk(committed === index, `after-output(${index}): the state must still record ${index} committed records, it records ${committed}`);
    assertOk(out.length === index + 1, `after-output(${index}): the output holds ${out.length} complete lines`);
  } else if (phase === "after-state") {
    assertOk(committed === index + 1, `after-state(${index}): the state records ${committed} committed records, expected ${index + 1}`);
    assertOk(out.length === index + 1, `after-state(${index}): the output holds ${out.length} complete lines`);
  } else {
    throw new Error(`unknown interrupt phase: ${phase}`);
  }
  const handled = phase === "before-output" ? index : index + 1;
  for (let k = 0; k < handled; k += 1) {
    assertOk(out[k] === EXPECTED_LINES[k], `output line ${k} is ${JSON.stringify(out[k])}, expected ${JSON.stringify(EXPECTED_LINES[k])}`);
  }
}

function attempt(ctx, predicate) {
  const beforeCommitted = existsSync(ctx.statePath) ? stateCommitted(ctx) : 0;
  const beforeLines = outputLines(ctx).length;
  let perRun = 0;
  const interrupt = (phase, index) => {
    perRun += 1;
    if (phase === "start") {
      const now = existsSync(ctx.statePath) ? stateCommitted(ctx) : 0;
      assertOk(now === beforeCommitted, "start: the state file changed before the pipeline read anything");
      assertOk(outputLines(ctx).length === beforeLines, "start: the output file changed before the pipeline read anything");
    } else {
      checkWindow(ctx, phase, index);
    }
    if (predicate.test(phase, index, perRun)) {
      throw INTERRUPT;
    }
  };
  try {
    const result = runPipeline({
      inputPath: ctx.inputPath,
      outPath: ctx.outPath,
      statePath: ctx.statePath,
      interrupt,
    });
    return { completed: true, result };
  } catch (err) {
    if (err === INTERRUPT) {
      return { completed: false, result: null };
    }
    throw err;
  }
}

function cycle(label, predicate) {
  const ctx = scratch(INPUT_TEXT);
  let lastCommitted = 0;
  let finished = null;
  for (let round = 0; round < 300; round += 1) {
    const res = attempt(ctx, predicate);
    const now = existsSync(ctx.statePath) ? stateCommitted(ctx) : 0;
    assertOk(now >= lastCommitted, `${label}: the committed count went backwards (${lastCommitted} -> ${now})`);
    lastCommitted = now;
    if (res.completed) {
      finished = res;
      break;
    }
  }
  assertOk(finished !== null, `${label}: the pipeline never reached the end of the input`);
  assertOk(predicate.fired, `${label}: the planned interruption point was never reached`);
  assertOk(finished.result && finished.result.total === N, `${label}: result.total should be ${N}`);
  assertOk(finished.result && finished.result.committed === N, `${label}: result.committed should be ${N}`);
  assertOk(readFileSync(ctx.outPath, "utf8") === EXPECTED, `${label}: the final output does not match the expected records`);
  assertOk(stateCommitted(ctx) === N, `${label}: the state should record ${N} committed records`);
}

function once(phase, index) {
  const predicate = {
    fired: false,
    test: (ph, ix) => {
      if (!predicate.fired && ph === phase && ix === index) {
        predicate.fired = true;
        return true;
      }
      return false;
    },
  };
  return predicate;
}

function startTimes(times) {
  let left = times;
  const predicate = {
    fired: false,
    test: (ph) => {
      if (ph === "start" && left > 0) {
        left -= 1;
        predicate.fired = true;
        return true;
      }
      return false;
    },
  };
  return predicate;
}

function everyFifth(budget) {
  let seen = 0;
  let left = budget;
  const predicate = {
    fired: false,
    test: () => {
      seen += 1;
      if (left > 0 && seen % 5 === 0) {
        left -= 1;
        predicate.fired = true;
        return true;
      }
      return false;
    },
  };
  return predicate;
}

async function main() {
  for (const phase of ["before-output", "after-output", "after-state"]) {
    for (let i = 0; i < N; i += 1) {
      cycle(`${phase} at record ${i}`, once(phase, i));
    }
  }
  cycle("interrupts at the start of a run", startTimes(3));
  cycle("interrupts scattered over many runs", everyFifth(25));

  {
    const ctx = scratch(INPUT_TEXT);
    const first = runPipeline({ inputPath: ctx.inputPath, outPath: ctx.outPath, statePath: ctx.statePath });
    assertOk(first && first.committed === N, "the first complete run should commit every record");
    assertOk(existsSync(ctx.statePath), "a completed run must leave a state file behind");
    const outBefore = readFileSync(ctx.outPath, "utf8");
    const stateBefore = readFileSync(ctx.statePath, "utf8");
    const second = runPipeline({
      inputPath: ctx.inputPath,
      outPath: ctx.outPath,
      statePath: ctx.statePath,
      interrupt: (phase) => {
        if (phase !== "start") {
          throw new Error(`a finished pipeline still touched the ${phase} window`);
        }
      },
    });
    assertOk(second && second.committed === N, "re-running a finished pipeline should report every record as committed");
    assertOk(readFileSync(ctx.outPath, "utf8") === outBefore, "re-running a finished pipeline changed the output file");
    assertOk(readFileSync(ctx.statePath, "utf8") === stateBefore, "re-running a finished pipeline changed the state file");
  }

  {
    const ctx = scratch("alpha\nbeta\ngamma\n");
    writeFileSync(ctx.outPath, "stale output\nfrom an earlier run\n");
    const res = runPipeline({ inputPath: ctx.inputPath, outPath: ctx.outPath, statePath: ctx.statePath });
    assertOk(res && res.committed === 3, "expected three committed records");
    assertOk(readFileSync(ctx.outPath, "utf8") === "0:ALPHA\n1:BETA\n2:GAMMA\n", "a fresh start must discard stale output content");
  }

  for (const tail of ["9:BOGUS\n", "9:BOGUS"]) {
    const ctx = scratch("alpha\nbeta\ngamma\n");
    writeFileSync(ctx.statePath, `${JSON.stringify({ version: 1, committed: 2 })}\n`);
    writeFileSync(ctx.outPath, `0:ALPHA\n1:BETA\n${tail}`);
    runPipeline({ inputPath: ctx.inputPath, outPath: ctx.outPath, statePath: ctx.statePath });
    assertOk(readFileSync(ctx.outPath, "utf8") === "0:ALPHA\n1:BETA\n2:GAMMA\n", `output written after the last committed record (${JSON.stringify(tail)}) must be dropped on resume`);
  }

  const corruptCases = [
    ["not json", (ctx) => writeFileSync(ctx.statePath, "{ not json")],
    ["not an object", (ctx) => writeFileSync(ctx.statePath, "[1,2,3]\n")],
    ["negative count", (ctx) => writeFileSync(ctx.statePath, `${JSON.stringify({ version: 1, committed: -1 })}\n`)],
    ["non numeric count", (ctx) => writeFileSync(ctx.statePath, `${JSON.stringify({ version: 1, committed: "2" })}\n`)],
    ["missing count", (ctx) => writeFileSync(ctx.statePath, `${JSON.stringify({ version: 1 })}\n`)],
    ["count past the input", (ctx) => {
      writeFileSync(ctx.statePath, `${JSON.stringify({ version: 1, committed: 99 })}\n`);
      writeFileSync(ctx.outPath, "0:ALPHA\n1:BETA\n2:GAMMA\n");
    }],
    ["count past the output", (ctx) => {
      writeFileSync(ctx.statePath, `${JSON.stringify({ version: 1, committed: 2 })}\n`);
      writeFileSync(ctx.outPath, "0:ALPHA\n");
    }],
  ];
  for (const [label, setup] of corruptCases) {
    const ctx = scratch("alpha\nbeta\ngamma\n");
    setup(ctx);
    let error = null;
    try {
      runPipeline({ inputPath: ctx.inputPath, outPath: ctx.outPath, statePath: ctx.statePath });
    } catch (err) {
      error = err;
    }
    assertOk(error !== null, `corrupt state (${label}) was accepted instead of being rejected`);
    assertOk(/corrupt state/i.test(String(error.message)), `corrupt state (${label}) should fail with a message containing "corrupt state", got: ${error.message}`);
  }

  {
    const ctx = scratch("");
    const res = runPipeline({ inputPath: ctx.inputPath, outPath: ctx.outPath, statePath: ctx.statePath });
    assertOk(res && res.total === 0 && res.committed === 0, "an empty input should report zero records");
    assertOk(!existsSync(ctx.outPath) || readFileSync(ctx.outPath, "utf8") === "", "an empty input must leave the output file empty");
    const again = runPipeline({ inputPath: ctx.inputPath, outPath: ctx.outPath, statePath: ctx.statePath });
    assertOk(again && again.total === 0, "a second run over an empty input should succeed");
    assertOk(!existsSync(ctx.outPath) || readFileSync(ctx.outPath, "utf8") === "", "a second run over an empty input must stay empty");
  }
}

try {
  await main();
  console.log("all contract cases passed");
} catch (err) {
  console.log(`FAIL: ${err && err.message ? err.message : String(err)}`);
  process.exitCode = 1;
}

for (const dir of cleanups) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    // ignore cleanup problems
  }
}
DRIVER

if node "$TMPD/driver.mjs" "$ROOT" > "$TMPD/report.txt" 2>&1; then
  cat "$TMPD/report.txt"
  echo "VERDICT: PASS"
  exit 0
fi

cat "$TMPD/report.txt"
echo "VERDICT: FAIL"
exit 1
