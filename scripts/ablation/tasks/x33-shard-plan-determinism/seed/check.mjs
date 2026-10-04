import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const manifestPath = "fixtures/manifest-a.json";
const shardCount = 2;

const failures = [];
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const durations = new Map(manifest.files.map((file) => [file.id, file.durationMs]));

function run() {
  return execFileSync(
    process.execPath,
    ["src/cli.mjs", manifestPath, String(shardCount)],
    { encoding: "utf8" },
  );
}

const outputs = [];
for (let i = 0; i < 3; i += 1) {
  outputs.push(run());
}

for (let i = 1; i < outputs.length; i += 1) {
  if (outputs[i] !== outputs[0]) {
    failures.push("run " + (i + 1) + " printed something different from run 1");
  }
}

let plan = null;
try {
  plan = JSON.parse(outputs[0]);
} catch {
  failures.push("stdout is not valid JSON");
}

if (plan) {
  if (!Array.isArray(plan.shards) || plan.shards.length !== shardCount) {
    failures.push("expected " + shardCount + " shards");
  } else {
    const seen = [];
    for (let i = 0; i < plan.shards.length; i += 1) {
      const shard = plan.shards[i];
      if (shard.index !== i) {
        failures.push("shard " + i + " reports index " + shard.index);
      }
      if (!Array.isArray(shard.files)) {
        failures.push("shard " + i + " has no file list");
        continue;
      }
      let shardSum = 0;
      for (const id of shard.files) {
        if (!durations.has(id)) {
          failures.push("shard " + i + " lists unknown file " + id);
          continue;
        }
        shardSum += durations.get(id);
        seen.push(id);
      }
      if (shardSum !== shard.totalMs) {
        failures.push("shard " + i + " totalMs does not match its files");
      }
    }
    let total = 0;
    for (const value of durations.values()) total += value;
    if (seen.length !== manifest.files.length) {
      failures.push("expected every file exactly once, saw " + seen.length);
    }
    if (new Set(seen).size !== manifest.files.length) {
      failures.push("some file appears in more than one shard");
    }
    if (plan.fileCount !== manifest.files.length) {
      failures.push("fileCount does not match the manifest");
    }
    if (plan.totalMs !== total) {
      failures.push("totalMs does not match the manifest");
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error("FAIL: " + failure);
  process.exit(1);
}

console.log("check.mjs: ok");
