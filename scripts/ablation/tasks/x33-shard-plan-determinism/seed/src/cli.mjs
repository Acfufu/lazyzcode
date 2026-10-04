import { readFileSync } from "node:fs";
import { buildPlan } from "./plan.mjs";

const [manifestPath, shardCountArg] = process.argv.slice(2);

if (!manifestPath) {
  console.error("usage: node src/cli.mjs <manifest.json> [shardCount]");
  process.exit(2);
}

const shardCount = shardCountArg === undefined ? 1 : Number.parseInt(shardCountArg, 10);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const plan = buildPlan(manifest.files, shardCount);

process.stdout.write(JSON.stringify(plan) + "\n");
