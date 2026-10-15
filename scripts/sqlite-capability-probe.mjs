#!/usr/bin/env node
// SQLite 能力矩阵探针（P1 N4 入库版；可重放）——F3 证据表面：
//   node scripts/sqlite-capability-probe.mjs [workdir]
// stdout=JSON 矩阵（含三判 verdict）；退出码 0 当且仅当 verdict="supported-pass"。
// 判据（ADR-0039）：必需能力全过 ∧ 模块在场 ∧ Node major≥24（地板，用户拍板 2026-10-16）。
// 只证 SQL 层纪律所需面：基本读写/WAL 回读/busy pragma 等待+errcode 5/唯一约束 errcode/
// VACUUM INTO+integrity/readOnly 只读打开+写必败/kill -9 崩溃恢复；experimental 告警=信息行。
// 计时断言用宽容忍（防 CI 抖动假红）；构造与 2026-10-16 侦察探针同源（artifacts/sqlite-p1-recon）。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const FLOOR_MAJOR = 24;
const NODE = process.execPath;
const SELF = new URL(import.meta.url).pathname;
const workdir = process.argv[2] ?? mkdtempSync(join(tmpdir(), "lzy-sqlite-probe-"));
mkdirSync(workdir, { recursive: true });

// ── 子进程模式 ──
if (process.env.PROBE_CHILD === "crash") {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(join(workdir, "crash.sqlite"));
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("CREATE TABLE IF NOT EXISTS t(id TEXT PRIMARY KEY)");
  db.exec("BEGIN IMMEDIATE");
  db.prepare("INSERT INTO t VALUES(?)").run("committed");
  db.exec("COMMIT");
  db.exec("BEGIN IMMEDIATE");
  db.prepare("INSERT INTO t VALUES(?)").run("uncommitted");
  writeFileSync(join(workdir, "child-ready"), "1");
  await sleep(60000);
  process.exit(0);
}
if (process.env.PROBE_CHILD === "warn-check") {
  require("node:sqlite");
  process.exit(0);
}

const major = Number(process.versions.node.split(".")[0]);
const out = {
  node: process.version, floorMajor: FLOOR_MAJOR, workdir,
  modulePresent: false, capabilities: {}, experimentalWarning: null,
  verdict: "capability-fail", allRequiredPass: false,
};
let DatabaseSync = null;
try {
  ({ DatabaseSync } = require("node:sqlite"));
  out.modulePresent = true;
} catch (e) {
  out.verdict = "module-missing";
  out.error = e?.code ?? String(e?.message).slice(0, 80);
}

const C = out.capabilities;
const F = (name, fn) => { try { C[name] = fn() ?? { ok: true }; } catch (e) { C[name] = { ok: false, error: `${e?.name}: ${String(e?.message).slice(0, 120)}` }; } };

if (out.modulePresent) {
  F("basic", () => {
    const db = new DatabaseSync(join(workdir, "basic.sqlite"));
    db.exec("CREATE TABLE IF NOT EXISTS t(a INTEGER PRIMARY KEY, b TEXT)");
    db.prepare("INSERT INTO t(b) VALUES(?)").run("x");
    const got = db.prepare("SELECT b FROM t WHERE a=?").get(1).b;
    db.close();
    if (got !== "x") throw new Error(`读回 ${got} ≠ x`);
    return { ok: true, readback: got };
  });
  F("wal", () => {
    const db = new DatabaseSync(join(workdir, "wal.sqlite"));
    const mode = db.prepare("PRAGMA journal_mode=WAL").get().journal_mode;
    db.close();
    if (String(mode).toLowerCase() !== "wal") throw new Error(`journal_mode 回读 ${mode} ≠ wal`);
    return { ok: true, mode };
  });
  F("busyPragma", () => {
    const p = join(workdir, "busy.sqlite");
    const a = new DatabaseSync(p);
    a.exec("PRAGMA journal_mode=WAL");
    a.exec("CREATE TABLE IF NOT EXISTS t(a)");
    const b = new DatabaseSync(p);
    b.exec("PRAGMA busy_timeout=400");
    a.exec("BEGIN IMMEDIATE");
    a.prepare("INSERT INTO t VALUES(1)").run();
    const t0 = Date.now();
    let errcode = null;
    try { b.prepare("INSERT INTO t VALUES(2)").run(); } catch (e) { errcode = e.errcode; }
    const waitedMs = Date.now() - t0;
    a.exec("ROLLBACK"); a.close(); b.close();
    if (errcode !== 5) throw new Error(`errcode=${errcode} ≠ 5`);
    if (waitedMs < 150) throw new Error(`等待 ${waitedMs}ms < 150ms（busy_timeout 未生效）`);
    return { ok: true, errcode, waitedMs };
  });
  F("uniqueConflict", () => {
    const db = new DatabaseSync(join(workdir, "uniq.sqlite"));
    db.exec("CREATE TABLE IF NOT EXISTS e(k TEXT UNIQUE, v TEXT)");
    db.prepare("INSERT INTO e VALUES(?,?)").run("k1", "a");
    let errcode = null;
    try { db.prepare("INSERT INTO e VALUES(?,?)").run("k1", "b"); } catch (e) { errcode = e.errcode; }
    db.close();
    if (![2067, 1555].includes(errcode)) throw new Error(`errcode=${errcode} ∉ {2067(UNIQUE),1555(PK)}`);
    return { ok: true, errcode };
  });
  F("vacuumInto", () => {
    const db = new DatabaseSync(join(workdir, "src.sqlite"));
    db.exec("CREATE TABLE IF NOT EXISTS t(a)");
    db.exec("INSERT INTO t VALUES(42)");
    const bak = join(workdir, "backup.sqlite");
    try { rmSync(bak); } catch {}
    db.exec(`VACUUM INTO '${bak}'`);
    db.close();
    const b = new DatabaseSync(bak);
    const rows = b.prepare("SELECT count(*) c FROM t").get().c;
    const integrity = b.prepare("PRAGMA integrity_check").get().integrity_check;
    b.close();
    if (!existsSync(bak) || rows !== 1 || integrity !== "ok") throw new Error(`rows=${rows} integrity=${integrity}`);
    return { ok: true, rows, integrity };
  });
  F("readOnly", () => {
    const p = join(workdir, "ro.sqlite");
    const w = new DatabaseSync(p);
    w.exec("PRAGMA journal_mode=WAL");
    w.exec("CREATE TABLE IF NOT EXISTS t(a)"); w.exec("INSERT INTO t VALUES(7)");
    w.close();
    const r = new DatabaseSync(p, { readOnly: true });
    const v = r.prepare("SELECT a FROM t").get().a;
    let writeErr = null;
    try { r.prepare("INSERT INTO t VALUES(8)").run(); } catch (e) { writeErr = e.errcode; }
    r.close();
    if (v !== 7) throw new Error(`读回 ${v} ≠ 7`);
    if (writeErr !== 8) throw new Error(`写尝试应 errcode 8（readonly），实得 ${writeErr}`);
    return { ok: true, readback: v, writeErrcode: writeErr };
  });
}

// experimental 告警面（信息行，不影响判据）：子进程加载模块的 stderr 计数
try {
  if (out.modulePresent) {
    const r = spawnSync(NODE, ["-e", "require('node:sqlite')"], { encoding: "utf8", timeout: 20000 });
    out.experimentalWarning = (r.stderr ?? "").split("ExperimentalWarning").length - 1;
  }
} catch { out.experimentalWarning = null; }

if (out.modulePresent) {
  // kill -9 崩溃恢复（同步等待：spawn + ready 轮询）
  try {
    const crashDb = join(workdir, "crash.sqlite");
    for (const s of ["", "-wal", "-shm"]) { try { rmSync(crashDb + s); } catch {} }
    try { rmSync(join(workdir, "child-ready")); } catch {}
    const child = spawn(NODE, [SELF, workdir], { env: { ...process.env, PROBE_CHILD: "crash" }, stdio: "ignore" });
    let ready = false;
    for (let i = 0; i < 200 && !ready; i++) { if (existsSync(join(workdir, "child-ready"))) ready = true; else await sleep(50); }
    child.kill("SIGKILL");
    await new Promise((r) => child.on("exit", r));
    const db = new DatabaseSync(crashDb);
    const rows = db.prepare("SELECT id FROM t ORDER BY id").all().map((r) => r.id);
    const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
    db.close();
    const ok = ready && rows.includes("committed") && !rows.includes("uncommitted") && integrity === "ok";
    C.crashRecovery = ok ? { ok: true, rowsAfterKill: rows, integrity }
      : { ok: false, error: `ready=${ready} rows=${JSON.stringify(rows)} integrity=${integrity}` };
  } catch (e) { C.crashRecovery = { ok: false, error: `${e?.name}: ${String(e?.message).slice(0, 120)}` }; }
}

const required = ["basic", "wal", "busyPragma", "uniqueConflict", "vacuumInto", "readOnly", "crashRecovery"];
out.allRequiredPass = out.modulePresent && required.every((k) => C[k]?.ok === true);
if (!out.modulePresent) out.verdict = "module-missing";
else if (!(major >= FLOOR_MAJOR)) out.verdict = "below-floor";
else out.verdict = out.allRequiredPass ? "supported-pass" : "capability-fail";
out.required = required;

console.log(JSON.stringify(out, null, 2));
process.exit(out.verdict === "supported-pass" ? 0 : 1);
