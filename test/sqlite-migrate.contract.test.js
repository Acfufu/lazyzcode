// P3 SQLite 显式迁移契约测试（goal p3-sqlite-switch；实施依据 docs/design-sqlite-store.md §7/§8 + 计划定案①-⑥）。
// N1④ 骨架先落红腿：core/sqlite-migrate.js 未建时本文件 import 失败=F3 红半（改前树取证在案）；
// N2（迁移机器）/N4（误写检测）落地后逐腿转绿。命名避开 p3-sweep（0.4.0 M1 既有文件，无关联）。
// 纪律：只在隔离 tmpdir 工作区取证（绝不指向本仓 .lazyzcode）；stopAfterPhase 为测试专用中断钩子
//（生产 CLI 不传；用于确定性构造断点态，真 kill -9 腿由 F3 取证脚本承接）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const MAJOR = Number(process.versions.node.split(".")[0]);
const FLOOR_SKIP = MAJOR >= 24 ? false : `地板 Node ≥24.0.0（ADR-0039；22 线不入 DB 支持面）；当前 v${process.versions.node} 跳过`;

const { saveQueue, saveDispatch, saveLedger } = await import(
  pathToFileURL(join(ROOT, "core", "queue.js")).href
);
// 迁移机器（N2 建）——本文件落盘时模块缺席，import 即红（F3 红半形态）。
const { migrateToSqlite, assertNoJsonMiswrite } = await import(
  pathToFileURL(join(ROOT, "core", "sqlite-migrate.js")).href
);
const { openStore, stateDbPath } = await import(pathToFileURL(join(ROOT, "core", "statedb.js")).href);

const FIXED = "2026-03-01T00:00:00.000Z";
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// 种子源工作区（迁移可过前置：无 open/delivering tx、无 running 条目）。
function seedSource(dir) {
  const g = (args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(dir, "a.txt"), "a\n");
  writeFileSync(join(dir, ".gitignore"), ".lazyzcode/\n");
  const cHash = sha256(`mig-${dir}`);
  const bh = "cd".repeat(32);
  const auth = (h) => ({ slug: "mig-goal", contractHash: h });
  saveQueue(dir, {
    items: [
      { id: "q1", title: "就绪", goalSlug: "mig-goal", contractHash: cHash, contractPath: "c.md", planPath: "p.md", endpoint: "A", state: "ready", createdAt: FIXED, updatedAt: FIXED, deps: [], seq: 1, tier: "heavy", risk: "med", blockedReason: null, completedEndpoint: null, planHash: cHash, planReview: "plan-reviewer: PASS — 种子" },
      { id: "q2", title: "完成B", goalSlug: "mig-goal", contractHash: cHash, contractPath: "c.md", planPath: "p.md", endpoint: "B", state: "completed", createdAt: FIXED, updatedAt: FIXED, deps: ["q1"], seq: 2, tier: "light", risk: "low", blockedReason: null, completedEndpoint: "B", delivery: { B: { path: "b.md", hash: bh } } },
      { id: "q3", title: "阻断", goalSlug: "mig-goal", contractHash: cHash, contractPath: "c.md", planPath: "p.md", endpoint: "A", state: "blocked", createdAt: FIXED, updatedAt: FIXED, deps: [], seq: 3, tier: null, risk: null, blockedReason: "种子阻断", completedEndpoint: null },
    ],
    budget: { pointsLimit: 100, wallLimitMs: 3600000, notes: [{ at: FIXED, note: "种子" }], pointsStoppedAck: { at: FIXED, ackSeq: 3, note: "ack 水位" } },
  });
  saveDispatch(dir, {
    txs: [
      { txId: "tx-a", itemId: "q2", goalSlug: "mig-goal", phase: "settled", openedAt: FIXED, settledAt: FIXED, limits: { wallMs: 60000, points: 10 }, segments: [{ sessionId: "s1", durationMs: 100 }, { sessionId: "s2", durationMs: 200, model: "glm-test", turns: 3 }], deliveringSinceMs: null, deliveringPid: null, note: "结算" },
      { txId: "tx-b", itemId: "q-orph", goalSlug: "mig-goal", phase: "reconciled-orphan", openedAt: FIXED, settledAt: FIXED, limits: { wallMs: 60000, points: 5 }, segments: [], deliveringSinceMs: null, deliveringPid: null, note: "孤儿" },
    ],
  });
  saveLedger(dir, {
    entries: [
      { seq: 1, kind: "wall", at: FIXED, dedupKey: "wall:tx-a:s1", authorization: auth(cHash), provenance: "tx:tx-a", itemId: "q2", txId: "tx-a", sessionId: "s1", ms: 100, points: null, note: "w1" },
      { seq: 2, kind: "points", at: FIXED, dedupKey: "points:tx-a:s1", authorization: auth(cHash), provenance: "tx:tx-a", itemId: "q2", txId: "tx-a", sessionId: "s1", ms: null, points: 1.5, note: "p1" },
      { seq: 3, kind: "overrun", at: FIXED, dedupKey: "overrun:tx-a:s2", authorization: auth(cHash), provenance: "tx:tx-a", itemId: "q2", txId: "tx-a", sessionId: "s2", ms: null, points: 2, note: "o1" },
    ],
  });
  return { cHash };
}

const famPaths = (d) => ({
  queue: join(d, ".lazyzcode", "queue", "queue.json"),
  dispatch: join(d, ".lazyzcode", "queue", "dispatch.json"),
  ledger: join(d, ".lazyzcode", "budget", "ledger.json"),
});
const markerPath = (d) => join(d, ".lazyzcode", "state.backend.json");
const journalPhases = (d) => {
  const jdir = join(d, ".lazyzcode", "migration", "sqlite", "journal");
  const runs = readdirSync(jdir).filter((n) => n.endsWith(".jsonl"));
  return { runs, phases: runs.flatMap((r) => readFileSync(join(jdir, r), "utf8").trim().split("\n").map((l) => JSON.parse(l).phase)) };
};
function readMeta(root, key) {
  const db = openStore(stateDbPath(root));
  try {
    return db.prepare("SELECT value FROM meta WHERE key = ?").get(key)?.value ?? null;
  } finally {
    db.close();
  }
}

test("①迁移全链：导入对账/不动源/marker+meta.backend/journal 相位/重跑拒", { skip: FLOOR_SKIP }, () => {
  const d = mkdtempSync(join(tmpdir(), "lzy-mig-full-"));
  seedSource(d);
  const fam = famPaths(d);
  const before = Object.fromEntries(Object.entries(fam).map(([k, p]) => [k, sha256(readFileSync(p))]));

  const res = migrateToSqlite(d);
  assert.equal(res.phases.at(-1), "done");
  assert.equal(res.counts.items, 3);
  assert.equal(res.counts.events, 3);

  for (const k of Object.keys(fam)) assert.equal(sha256(readFileSync(fam[k])), before[k], `源 ${k} 被改动`);

  const marker = JSON.parse(readFileSync(markerPath(d), "utf8"));
  assert.equal(marker.backend, "sqlite");
  assert.equal(readMeta(d, "backend"), "sqlite");
  assert.equal(JSON.parse(readMeta(d, "json_frozen")).queue, before.queue);

  const { runs, phases } = journalPhases(d);
  assert.equal(runs.length, 1, "恰一 journal");
  for (const ph of ["start", "backup", "import", "reconcile", "install", "commit", "done"]) {
    assert.ok(phases.includes(ph), `journal 缺相位 ${ph}`);
  }

  assert.throws(() => migrateToSqlite(d), /已迁移/);
  rmSync(d, { recursive: true, force: true });
});

test("②journal 断点续跑：import 后中断→重跑完成不双导、复用同一 journal", { skip: FLOOR_SKIP }, () => {
  const d = mkdtempSync(join(tmpdir(), "lzy-mig-resume-"));
  seedSource(d);
  let interrupted = false;
  try {
    migrateToSqlite(d, { stopAfterPhase: "import" });
  } catch (e) {
    interrupted = /stopAfterPhase|中断/.test(e.message);
  }
  assert.ok(interrupted, "stopAfterPhase 未生效（中断模拟失败）");
  assert.ok(existsSync(join(d, ".lazyzcode", "migration", "sqlite")), "staged/journal 未落");

  const res = migrateToSqlite(d); // 续跑
  assert.equal(res.phases.at(-1), "done");
  assert.equal(res.counts.items, 3, "条目不双导");
  assert.equal(res.counts.events, 3, "事件不双导");
  const { runs, phases } = journalPhases(d);
  assert.equal(runs.length, 1, "续跑复用同一 runId journal");
  for (const ph of ["install", "commit", "done"]) assert.ok(phases.includes(ph), `续跑缺相位 ${ph}`);
  rmSync(d, { recursive: true, force: true });
});

test("③误写检测：篡改源 JSON=拒/恢复=放行/删除备份=不违例", { skip: FLOOR_SKIP }, () => {
  const d = mkdtempSync(join(tmpdir(), "lzy-mig-miswrite-"));
  seedSource(d);
  migrateToSqlite(d);
  const fam = famPaths(d);
  const orig = readFileSync(fam.queue, "utf8");
  const dbRO = openStore(stateDbPath(d), { readOnly: true });

  writeFileSync(fam.queue, orig.replace("就绪", "篡改"));
  assert.throws(() => assertNoJsonMiswrite(d, dbRO), /误写|改写/);

  writeFileSync(fam.queue, orig);
  assert.doesNotThrow(() => assertNoJsonMiswrite(d, dbRO));

  rmSync(fam.queue);
  assert.doesNotThrow(() => assertNoJsonMiswrite(d, dbRO), "缺席备份=不违例（删备份是用户权利）");
  dbRO.close();
  rmSync(d, { recursive: true, force: true });
});
