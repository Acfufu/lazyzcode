import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

const runs = [];
for (let i = 0; i < 6; i += 1) {
  const result = spawnSync(process.execPath, ["roster.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error(`run ${i + 1} exited with status ${result.status}`);
    process.exit(1);
  }
  runs.push(result.stdout);
}

const first = runs[0];
for (let i = 1; i < runs.length; i += 1) {
  if (runs[i] !== first) {
    console.error(`run ${i + 1} printed a different report than run 1`);
    console.error("--- run 1 ---");
    console.error(first);
    console.error(`--- run ${i + 1} ---`);
    console.error(runs[i]);
    process.exit(1);
  }
}

const lines = first.split("\n").filter((line) => line.length > 0);
if (lines[0] !== "ROSTER") {
  console.error('first line must be exactly "ROSTER"');
  process.exit(1);
}
const totalsAt = lines.indexOf("TOTALS");
if (totalsAt === -1) {
  console.error('missing "TOTALS" line');
  process.exit(1);
}
for (const line of lines.slice(1, totalsAt)) {
  if (line.split(/\s+/).length !== 3) {
    console.error(`roster line is not three fields: ${line}`);
    process.exit(1);
  }
}

console.log("OK: report is stable across runs and well formed");
