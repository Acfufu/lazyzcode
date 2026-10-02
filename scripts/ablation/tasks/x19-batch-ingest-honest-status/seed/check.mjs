// Visible check for the batch ingest CLI. Run: node check.mjs
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const cli = join(root, "bin", "ingest-batch.mjs");
const work = mkdtempSync(join(tmpdir(), "batch-visible-"));
let failures = 0;

function note(message) {
  failures += 1;
  console.log("FAIL: " + message);
}
function pass(message) {
  console.log("ok: " + message);
}
function runCli(input, outDir) {
  const res = spawnSync(process.execPath, [cli, input, outDir], { encoding: "utf8" });
  return { code: res.status, stdout: (res.stdout || "").trim() };
}
function parseSummary(res) {
  try {
    return JSON.parse(res.stdout);
  } catch {
    return null;
  }
}
function listDir(dir) {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

// Case 1: two valid records are written with a numeric qty.
{
  const input = join(work, "good.txt");
  const out = join(work, "out-good");
  writeFileSync(input, "id: alpha\nname: First\nqty: 3\n---\nid: beta\nname: Second\nqty: 12\n");
  const res = runCli(input, out);
  const summary = parseSummary(res);
  if (res.code !== 0) {
    note("valid batch: exit code " + res.code);
  } else if (!summary || summary.ok !== true || summary.written !== 2 || summary.rejected !== 0) {
    note("valid batch: summary " + res.stdout);
  } else if (listDir(out).join(",") !== "alpha.json,beta.json") {
    note("valid batch: files " + listDir(out).join(","));
  } else {
    const body = existsSync(join(out, "alpha.json")) ? readFileSync(join(out, "alpha.json"), "utf8") : "";
    if (body !== '{"id":"alpha","name":"First","qty":3}\n') {
      note("valid batch: alpha.json is " + JSON.stringify(body));
    } else {
      pass("valid batch written");
    }
  }
}

// Case 2: a batch with one invalid record changes nothing.
{
  const input = join(work, "bad.txt");
  const out = join(work, "out-bad");
  writeFileSync(input, "id: alpha\nname: First\nqty: 3\n---\nid: beta\nname: Second\nqty: twelve\n");
  const res = runCli(input, out);
  const summary = parseSummary(res);
  if (res.code !== 1) {
    note("invalid batch: exit code " + res.code);
  } else if (!summary || summary.ok !== false || summary.written !== 0 || summary.rejected !== 1) {
    note("invalid batch: summary " + res.stdout);
  } else if (listDir(out).length !== 0) {
    note("invalid batch: files " + listDir(out).join(","));
  } else {
    pass("invalid batch rejected");
  }
}

rmSync(work, { recursive: true, force: true });

if (failures > 0) {
  console.log("CHECK FAILED");
  process.exit(1);
}
console.log("CHECK PASSED");
