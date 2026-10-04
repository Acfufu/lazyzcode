#!/usr/bin/env bash
set -u

ROOT="$(pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/plan-verify.XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

mkdir -p "$WORK/scratch"

cat > "$WORK/verify.mjs" <<'PLAN_VERIFY_EOF'
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] || process.cwd();
const work = process.argv[3] || process.cwd();
const problems = [];
let seq = 0;

function expectedPlan(files, shardCount) {
  const count = Math.max(1, Math.floor(shardCount));
  const ordered = files.slice().sort((a, b) => {
    if (a.durationMs !== b.durationMs) return b.durationMs - a.durationMs;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
  const shards = [];
  for (let i = 0; i < count; i += 1) shards.push({ index: i, totalMs: 0, files: [] });
  for (const file of ordered) {
    let target = shards[0];
    for (const shard of shards) if (shard.totalMs < target.totalMs) target = shard;
    target.files.push(file.id);
    target.totalMs += file.durationMs;
  }
  for (const shard of shards) shard.files.sort();
  return {
    shards,
    totalMs: shards.reduce((sum, shard) => sum + shard.totalMs, 0),
    fileCount: files.length,
  };
}

function canon(value) {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canon(value[key]);
    return out;
  }
  return value;
}

function invoke(files, shardCount, env) {
  const manifestPath = join(work, "manifest-" + seq + ".json");
  seq += 1;
  writeFileSync(manifestPath, JSON.stringify({ name: "case", files }, null, 2));
  const args = [join(root, "src", "cli.mjs"), manifestPath];
  if (shardCount !== null) args.push(String(shardCount));
  return execFileSync(process.execPath, args, {
    encoding: "utf8",
    timeout: 5000,
    env: Object.assign({}, process.env, env || {}),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function firstLine(text) {
  return String(text).split("\n")[0];
}

function runCase(name, files, shards) {
  const raws = [];
  for (let i = 0; i < 3; i += 1) {
    try {
      raws.push(invoke(files, shards));
    } catch (err) {
      problems.push(name + ": invocation failed (" + firstLine(err.message) + ")");
      return;
    }
  }
  for (let i = 1; i < raws.length; i += 1) {
    if (raws[i] !== raws[0]) {
      problems.push(name + ": output changed between identical runs");
      break;
    }
  }
  const trimmed = raws[0].replace(/\s+$/, "");
  if (trimmed.includes("\n")) {
    problems.push(name + ": stdout must be a single line of JSON");
  }
  let actual;
  try {
    actual = JSON.parse(trimmed);
  } catch (err) {
    problems.push(name + ": stdout is not valid JSON");
    return;
  }
  const want = expectedPlan(files, shards);
  if (JSON.stringify(canon(actual)) !== JSON.stringify(canon(want))) {
    problems.push(name + ": plan does not match the documented balancing rule");
  }
}

runCase("mixed", [
  { id: "a", durationMs: 5 },
  { id: "b", durationMs: 1 },
  { id: "c", durationMs: 4 },
  { id: "d", durationMs: 2 },
  { id: "e", durationMs: 3 },
], 2);

runCase("equal-durations", [
  { id: "z", durationMs: 3 },
  { id: "m", durationMs: 3 },
  { id: "a", durationMs: 3 },
  { id: "q", durationMs: 3 },
], 3);

runCase("more-shards-than-files", [
  { id: "x", durationMs: 2 },
  { id: "y", durationMs: 2 },
], 4);

runCase("single-shard", [
  { id: "b", durationMs: 3 },
  { id: "a", durationMs: 3 },
  { id: "c", durationMs: 1 },
], 1);

runCase("zero-durations", [
  { id: "k", durationMs: 0 },
  { id: "j", durationMs: 0 },
  { id: "i", durationMs: 0 },
], 2);

let seedValue = 7;
const big = [];
for (let i = 0; i < 24; i += 1) {
  seedValue = (seedValue * 1103515245 + 12345) % 2147483648;
  big.push({ id: "f" + String(i).padStart(2, "0"), durationMs: seedValue % 40 });
}
runCase("larger-manifest", big, 5);

try {
  const single = [{ id: "only", durationMs: 4 }];
  const raw = invoke(single, null);
  const parsed = JSON.parse(raw.replace(/\s+$/, ""));
  const want = expectedPlan(single, 1);
  if (JSON.stringify(canon(parsed)) !== JSON.stringify(canon(want))) {
    problems.push("default-shards: omitting the shard count must use 1 shard");
  }
} catch (err) {
  problems.push("default-shards: invocation failed (" + firstLine(err.message) + ")");
}

try {
  const files = [{ id: "a", durationMs: 5 }, { id: "b", durationMs: 3 }];
  const base = invoke(files, 2);
  const alt = invoke(files, 2, {
    TZ: "Pacific/Kiritimati",
    LANG: "de_DE.UTF-8",
    LC_ALL: "de_DE.UTF-8",
    LC_NUMERIC: "de_DE.UTF-8",
  });
  if (base !== alt) problems.push("environment: output depends on time zone or locale");
} catch (err) {
  problems.push("environment: invocation failed (" + firstLine(err.message) + ")");
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
process.exit(0);
PLAN_VERIFY_EOF

if node "$WORK/verify.mjs" "$ROOT" "$WORK/scratch" >"$WORK/out" 2>"$WORK/err"; then
  echo "VERDICT: PASS"
  exit 0
fi

sed -n '1,12p' "$WORK/err" >&2
echo "VERDICT: FAIL"
exit 1
