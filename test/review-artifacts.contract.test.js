import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { createReviewSandbox } from "../core/review-sandbox.js";
import { readReviewArtifact, findReviewTranscript, queryReviewHostDb, ReviewArtifactError } from "../core/review-artifacts.js";

test("artifact readers require the OS launcher", () => {
  assert.throws(() => readReviewArtifact({ home: "/tmp", path: "/tmp/a" }), ReviewArtifactError);
  assert.equal(queryReviewHostDb({ home: "/tmp", dbPath: "/tmp/a", sql: "SELECT 1" }), null);
});

test("real sandbox readers accept regular artifacts and deny links, FIFOs and concurrent escapes", { skip: process.platform !== "darwin" }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "lzy-artifact-test-"));
  const outside = mkdtempSync(join(tmpdir(), "lzy-artifact-secret-"));
  let sandbox;
  let racer;
  try {
    const candidateDir = join(root, "candidate"); const home = join(root, "home");
    mkdirSync(candidateDir); mkdirSync(home);
    const inputPath = join(root, "input.json"); const enginePath = join(candidateDir, "engine.mjs");
    writeFileSync(inputPath, "{}"); writeFileSync(enginePath, "");
    const secret = join(outside, "secret"); writeFileSync(secret, "synthetic-parent-secret");
    const rollout = join(home, ".zcode", "cli", "rollout"); mkdirSync(rollout, { recursive: true });
    const transcript = join(rollout, "model-io-session.jsonl"); writeFileSync(transcript, '{"ok":true}\n');
    sandbox = await createReviewSandbox({ runDir: root, candidateDir, home, inputPath, enginePath, endpoints: ["https://example.com"] });
    assert.equal(readReviewArtifact({ home, path: transcript, sandbox }).toString(), '{"ok":true}\n');
    const found = findReviewTranscript({ home, sessionId: "session", sandbox });
    assert.equal(found.path, transcript);
    assert.equal(found.bytes.toString(), '{"ok":true}\n');
    t.diagnostic("normal transcript: exact bytes and discovery passed through sandbox-exec");
    assert.equal(readReviewArtifact({ home, path: join(home, "absent"), sandbox }), null);
    assert.throws(() => readReviewArtifact({ home, path: secret, sandbox }), ReviewArtifactError);

    const link = join(home, "link"); symlinkSync(secret, link);
    // Red baseline: the previous parent read followed a guest-controlled link.
    assert.equal(readFileSync(link, "utf8"), "synthetic-parent-secret");
    t.diagnostic("red baseline: parent readFileSync followed guest symlink and returned synthetic-parent-secret");
    assert.throws(() => readReviewArtifact({ home, path: link, sandbox }), ReviewArtifactError);
    const dirlink = join(home, "dirlink"); symlinkSync(outside, dirlink);
    assert.throws(() => readReviewArtifact({ home, path: join(dirlink, "secret"), sandbox }), ReviewArtifactError);
    const fifo = join(home, "fifo"); assert.equal(spawnSync("/usr/bin/mkfifo", [fifo]).status, 0);
    assert.throws(() => readReviewArtifact({ home, path: fifo, sandbox }), ReviewArtifactError);
    t.diagnostic("green: outside path, leaf link, intermediate directory link, FIFO all rejected");
    // 47MiB 夹具：旧限（16MiB）下拒、标定后（64MiB，ADR-0038 三改）应可读——边界迁移断言
    const withinCap = join(home, "within-cap"); writeFileSync(withinCap, Buffer.alloc(20 * 1024 * 1024, 0x61));
    assert.equal(readReviewArtifact({ home, path: withinCap, sandbox }).length, 20 * 1024 * 1024);
    t.diagnostic("green: 20 MiB artifact readable after 16→64 MiB calibration (was rejected pre-三改)");
    const oversized = join(home, "oversized"); writeFileSync(oversized, Buffer.alloc(64 * 1024 * 1024 + 1));
    assert.throws(() => readReviewArtifact({ home, path: oversized, sandbox }), ReviewArtifactError);
    t.diagnostic("green: 64 MiB + 1 byte artifact rejected");

    const db = join(home, "db.sqlite");
    assert.equal(spawnSync("/usr/bin/sqlite3", [db, "CREATE TABLE usage(tokens INTEGER); INSERT INTO usage VALUES(42);"]).status, 0);
    assert.deepEqual(queryReviewHostDb({ home, dbPath: db, sql: "SELECT tokens FROM usage", sandbox }), [{ tokens: 42 }]);
    symlinkSync(secret, db + "-wal");
    assert.equal(queryReviewHostDb({ home, dbPath: db, sql: "SELECT tokens FROM usage", sandbox }), null);
    unlinkSync(db + "-wal");
    assert.equal(queryReviewHostDb({ home, dbPath: link, sql: "SELECT 1", sandbox }), null);
    const dbFifo = db + "-shm"; assert.equal(spawnSync("/usr/bin/mkfifo", [dbFifo]).status, 0);
    assert.equal(queryReviewHostDb({ home, dbPath: db, sql: "SELECT tokens FROM usage", sandbox }), null);
    unlinkSync(dbFifo);
    t.diagnostic("SQLite: normal SELECT returned [{tokens:42}]; DB symlink, WAL symlink and SHM FIFO returned null");
    const closedWal = join(home, "closed-wal.sqlite");
    assert.equal(spawnSync("/usr/bin/sqlite3", [closedWal, "PRAGMA journal_mode=WAL; CREATE TABLE usage(tokens INTEGER); INSERT INTO usage VALUES(43); PRAGMA wal_checkpoint(TRUNCATE);"]).status, 0);
    if (existsSync(closedWal + "-wal")) assert.equal(readFileSync(closedWal + "-wal").length, 0);
    rmSync(closedWal + "-wal", { force: true }); rmSync(closedWal + "-shm", { force: true });
    assert.equal(existsSync(closedWal + "-wal"), false);
    assert.deepEqual(queryReviewHostDb({ home, dbPath: closedWal, sql: "SELECT tokens FROM usage", sandbox }), [{ tokens: 43 }]);
    assert.equal(queryReviewHostDb({ home, dbPath: closedWal, sql: "INSERT INTO usage VALUES(999)", sandbox }), null);
    assert.deepEqual(queryReviewHostDb({ home, dbPath: closedWal, sql: "SELECT tokens FROM usage", sandbox }), [{ tokens: 43 }]);
    t.diagnostic("SQLite closed WAL: absent sidecars initialized without immutable fallback, exact 43 tokens returned");
    t.diagnostic("SQLite query_only: INSERT refused and subsequent SELECT remains exactly 43 tokens");

    const crashWal = join(home, "crash-wal.sqlite");
    const writer = spawn("/usr/bin/sqlite3", ["-batch", crashWal], { stdio: ["pipe", "pipe", "pipe"] });
    const ready = new Promise((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(() => { writer.kill("SIGKILL"); reject(Error("WAL fixture timeout")); }, 5000);
      writer.stdout.on("data", data => { output += data; if (output.includes("fixture-ready")) { clearTimeout(timeout); resolve(); } });
      writer.on("error", error => { clearTimeout(timeout); reject(error); });
    });
    writer.stdin.write("PRAGMA journal_mode=WAL; CREATE TABLE usage(tokens INTEGER); INSERT INTO usage VALUES(44);\n.print fixture-ready\n");
    await ready;
    const killed = new Promise(resolve => writer.once("exit", resolve)); writer.kill("SIGKILL"); await killed;
    assert.equal(existsSync(crashWal + "-wal"), true);
    assert.deepEqual(queryReviewHostDb({ home, dbPath: crashWal, sql: "SELECT tokens FROM usage", sandbox }), [{ tokens: 44 }]);
    t.diagnostic("SQLite crashed WAL: committed 44-token row remains in WAL and is included by restricted query");

    const raced = join(home, "raced"); writeFileSync(raced, "safe");
    racer = spawn(process.execPath, ["--input-type=module", "-e", `
import { writeFileSync, unlinkSync, symlinkSync } from 'node:fs';
const [target,secret]=process.argv.slice(1);
for (;;) { try { unlinkSync(target); } catch {} try { symlinkSync(secret,target); } catch {} try { unlinkSync(target); } catch {} try { writeFileSync(target,'safe',{flag:'wx'}); } catch {} }
`, raced, secret], { stdio: "ignore" });
    for (let i = 0; i < 15; i++) {
      try {
        const result = readReviewArtifact({ home, path: raced, sandbox });
        if (result !== null) assert.ok(["", "safe"].includes(result.toString()), "concurrent escape exposed parent data");
      } catch (error) { assert.ok(error instanceof ReviewArtifactError); }
    }
    assert.equal(readFileSync(secret, "utf8"), "synthetic-parent-secret");
    t.diagnostic("race: 15 concurrent file/symlink replacements never returned outside bytes; external secret unchanged");
  } finally {
    if (racer) { const exited = new Promise(resolve => racer.once("exit", resolve)); racer.kill("SIGKILL"); await exited; }
    await sandbox?.close();
    rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true });
  }
});
