// Visible check: basic merge of two shards that share one id.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "merge-shards-check-"));

let ok = true;
const problems = [];

function check(label, actual, expected) {
  if (actual !== expected) {
    ok = false;
    problems.push(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

try {
  writeFileSync(join(dir, "s1.jsonl"), '{"id":"b","v":1}\n{"id":"a","v":1}\n');
  writeFileSync(join(dir, "s2.jsonl"), '{"id":"b","v":2}\n');

  let stdout = "";
  let code = 0;
  try {
    stdout = execFileSync(
      process.execPath,
      [
        join(here, "merge-shards.mjs"),
        join(dir, "out.jsonl"),
        join(dir, "s1.jsonl"),
        join(dir, "s2.jsonl")
      ],
      { encoding: "utf8" }
    );
  } catch (err) {
    code = err.status === undefined || err.status === null ? 1 : err.status;
    stdout = String(err.stdout === undefined ? "" : err.stdout);
  }

  const lines = stdout.replace(/\s+$/, "").split("\n");
  const summary = lines[lines.length - 1];
  const out = readFileSync(join(dir, "out.jsonl"), "utf8");

  check("exit code", code, 0);
  check("outfile", out, '{"id":"a","v":1}\n{"id":"b","v":2}\n');
  check("summary", summary, "status=OK shards=2 read=3 written=2 replaced=1 rejected=0");
} catch (err) {
  ok = false;
  problems.push(String(err && err.message));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (ok) {
  console.log("visible check: PASS");
  process.exit(0);
} else {
  console.log("visible check: FAIL");
  for (const p of problems) console.log("  - " + p);
  process.exit(1);
}
