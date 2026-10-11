import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { registerReviewCleanup, cleanupReviewSandbox, reviewSandboxResidues, recoverReviewSandbox, seatbeltPolicy } from "../core/review-sandbox.js";

const evidenceRoot = resolve(".omo/evidence/review-cleanup");
mkdirSync(evidenceRoot, { recursive: true });
const evidence = mkdtempSync(join(evidenceRoot, "run-"));
writeFileSync(join(evidence, "manifest.json"), JSON.stringify({ pid: process.pid, evidence, test: "review-cleanup" }, null, 2));
console.log(`cleanup evidence: ${evidence}`);
const cli = resolve("cli/lzy.js");
const secret = "SYNTHETIC_REVIEW_SECRET";
function fixture(name, runId = "fixture.a0.r1") {
  const cwd = join(evidence, name);
  const runDir = join(cwd, ".lazyzcode", "review", runId);
  rmSync(cwd, { recursive: true, force: true });
  mkdirSync(join(runDir, "home", "tmp", "nested"), { recursive: true });
  mkdirSync(join(runDir, "home", ".zcode", "cli", "db"), { recursive: true });
  writeFileSync(join(runDir, "home", "provider-config.sandbox.json"), secret);
  writeFileSync(join(runDir, "home", "builtin-config.sandbox.json"), secret);
  writeFileSync(join(runDir, "home", "tmp", "nested", "fixture.txt"), "temporary");
  writeFileSync(join(runDir, "home", ".zcode", "cli", "db", "db.sqlite"), "SYNTHETIC_USAGE_DB");
  writeFileSync(join(runDir, "transcript.jsonl"), "SYNTHETIC_TRANSCRIPT\n");
  return { cwd, runDir, runId, marker: join(runDir, "sandbox-cleanup.json") };
}
function record(name, value) { writeFileSync(join(evidence, `${name}.json`), JSON.stringify(value, null, 2)); }

test("register precedes cleanup; credential and tmp destruction preserves usage DB and transcript", () => {
  const f = fixture("normal");
  registerReviewCleanup(f.runDir);
  const registered = JSON.parse(readFileSync(f.marker));
  assert.equal(registered.state, "pending");
  assert.equal(registered.ownerPid, process.pid);
  const cleaned = cleanupReviewSandbox(f.runDir);
  assert.equal(cleaned.state, "clean");
  for (const name of ["provider-config.sandbox.json", "builtin-config.sandbox.json", "tmp"]) assert.equal(existsSync(join(f.runDir, "home", name)), false);
  assert.equal(readFileSync(join(f.runDir, "home", ".zcode", "cli", "db", "db.sqlite"), "utf8"), "SYNTHETIC_USAGE_DB");
  assert.equal(readFileSync(join(f.runDir, "transcript.jsonl"), "utf8"), "SYNTHETIC_TRANSCRIPT\n");
  assert.deepEqual(reviewSandboxResidues(f.cwd), []);
  record("normal-observable", { registered, cleaned, credentialsAbsent: true, tmpAbsent: true, dbPreserved: true, transcriptPreserved: true });
});

test("failed credential removal persists failed marker and remains observable", () => {
  const f = fixture("failed");
  registerReviewCleanup(f.runDir);
  rmSync(join(f.runDir, "home", "provider-config.sandbox.json"));
  mkdirSync(join(f.runDir, "home", "provider-config.sandbox.json"));
  const cleaned = cleanupReviewSandbox(f.runDir);
  assert.equal(cleaned.state, "failed");
  assert.ok(cleaned.errors.length > 0);
  const persisted = JSON.parse(readFileSync(f.marker));
  assert.equal(persisted.state, "failed");
  const residues = reviewSandboxResidues(f.cwd);
  assert.equal(residues.length, 1);
  assert.equal(residues[0].state, "failed");
  record("failed-observable", { cleaned, persisted, residues });
});

test("recover refuses live owner without deleting credentials", () => {
  const f = fixture("live");
  registerReviewCleanup(f.runDir);
  assert.throws(() => recoverReviewSandbox(f.cwd, f.runId), /仍在场|活动评审/);
  assert.equal(readFileSync(join(f.runDir, "home", "provider-config.sandbox.json"), "utf8"), secret);
  assert.equal(JSON.parse(readFileSync(f.marker)).state, "pending");
  record("live-observable", { refused: true, credentialsPreserved: true, marker: JSON.parse(readFileSync(f.marker)) });
});

test("dead owner recovers through actual lzy review cleanup CLI", () => {
  const f = fixture("dead-cli");
  const home = join(evidence, "cli-home");
  mkdirSync(home, { recursive: true });
  writeFileSync(f.marker, JSON.stringify({ version: 1, state: "pending", ownerPid: 2147483647 }));
  const result = spawnSync(process.execPath, [cli, "review", "cleanup", f.runId], {
    cwd: f.cwd, encoding: "utf8", timeout: 10000,
    env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, LZY_ZCODE_ENGINE: join(home, "disabled-engine.cjs") },
  });
  writeFileSync(join(evidence, "cleanup-cli.stdout.txt"), result.stdout || "(empty stdout)\n");
  writeFileSync(join(evidence, "cleanup-cli.stderr.txt"), result.stderr || "(empty stderr)\n");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(f.marker)).state, "clean");
  assert.equal(existsSync(join(f.runDir, "home", "provider-config.sandbox.json")), false);
  assert.equal(existsSync(join(f.runDir, "home", "tmp")), false);
  assert.equal(existsSync(join(f.runDir, "home", ".zcode", "cli", "db", "db.sqlite")), true);
  assert.equal(existsSync(join(f.runDir, "transcript.jsonl")), true);
  assert.equal(result.stdout.includes(secret), false);
  record("cli-observable", { exitCode: result.status, marker: JSON.parse(readFileSync(f.marker)), secretOmitted: true, credentialsAbsent: true, tmpAbsent: true, dbPreserved: true, transcriptPreserved: true });
});

test("scan observes every failed marker beyond 2000 directories including tail", () => {
  const cwd = join(evidence, "many-runs");
  rmSync(cwd, { recursive: true, force: true });
  const root = join(cwd, ".lazyzcode", "review");
  mkdirSync(root, { recursive: true });
  for (let i = 0; i < 2002; i++) {
    const runDir = join(root, `scan${String(i).padStart(5, "0")}.a0.r1`);
    mkdirSync(runDir);
    writeFileSync(join(runDir, "sandbox-cleanup.json"), JSON.stringify({ version: 1, state: "failed", ownerPid: 2147483647 }));
  }
  const directoryOrder = readdirSync(root);
  const tail = directoryOrder.at(-1);
  const residues = reviewSandboxResidues(cwd);
  record("scan-observable", { directoryCount: directoryOrder.length, tail, residueCount: residues.length, tailFound: residues.some(r => r.runId === tail) });
  assert.equal(directoryOrder.length, 2002);
  assert.equal(residues.length, 2002);
  assert.equal(residues.some(r => r.runId === tail), true);
});

test("policy rejects root and actual HOME ancestor engine directory without accessing credentials", () => {
  const f = fixture("policy");
  const candidateDir = join(f.runDir, "candidate");
  mkdirSync(candidateDir);
  const inputPath = join(f.runDir, "input.json");
  writeFileSync(inputPath, "{}");
  const base = { home: join(f.runDir, "home"), candidateDir, inputPath, policyPath: join(f.runDir, "sandbox.sb"), proxyPort: 12345 };
  for (const engineRoot of ["/", homedir(), dirname(homedir())]) {
    assert.throws(() => seatbeltPolicy({ ...base, enginePath: join(engineRoot, "synthetic-engine.cjs") }), /过宽|HOME.*祖先/);
  }
  record("policy-observable", { rootRejected: true, actualHomeRejected: true, homeAncestorRejected: true });
});
