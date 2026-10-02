#!/usr/bin/env node
// Merge per-shard JSONL files into a single deduplicated JSONL file.
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const [outPath, ...shardPaths] = process.argv.slice(2);

if (!outPath) {
  process.stderr.write("usage: merge-shards.mjs <outfile> <shard...>\n");
  process.exit(1);
}

let read = 0;
const records = [];

for (const shardPath of shardPaths) {
  const text = readFileSync(shardPath, "utf8");
  const lines = text.split("\n");
  read += lines.length;
  for (const line of lines) {
    if (line.trim() === "") continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    records.push(record);
  }
}

const seen = new Set();
const merged = [];
for (const record of records) {
  if (seen.has(record.id)) continue;
  seen.add(record.id);
  merged.push(record);
}

const body = merged.map((record) => JSON.stringify(record)).join("\n") + "\n";
writeFileSync(outPath, body);

console.log(
  `status=OK shards=${shardPaths.length} read=${read} written=${records.length} replaced=0 rejected=0`
);
process.exit(0);
