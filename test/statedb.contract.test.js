// P1 N2 起：SQLite 存储层契约测试（P2 N1 晋升 core/statedb.js——本文件自 P2 起测生产模块，
// 不再是试点原型；tmp 目录隔离；地板守卫具名 skip；零宿主依赖）
// 五面=①唯一事件约束 ②占用事务 ③结算事务（含幂等/overrun）④并发冲突（busy 具名）⑤崩溃恢复（SIGKILL）
// 另：⑥WAL 回读拒面单测（stub 注入）⑦地板守卫语义 ⑧结构性不嵌套（P2 N1 纪律句：每操作恰一个
// 顶层事务；既有事务在途时再开操作=具名拒，不静默加入——④/⑤ 的构造随之改为「BEGIN 独占持锁」
// 与「SQL 层未提交行」，不再依赖旧的原型级事务合并行为，如实记档于 N1）。
// 契约：docs/design-sqlite-store.md §3–§6；拍板地板 Node ≥24.0.0（22 线不入支持面）。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import {
  SCHEMA_VERSION, StatedbBusyError, StatedbError, StatedbUnsupportedError,
  openStore, ensureSchema, putQueueItem, setBudget, occupyDispatch, settleDispatch,
  appendBudgetEvent, readSnapshot, readBudgetAggregate, assertWal, runtimeSupport, stateDbPath,
  replaceDispatchTxs, patchDispatchTx, replaceBudgetEvents,
} from "../core/statedb.js";

const MAJOR = Number(process.versions.node.split(".")[0]);
const FLOOR_SKIP = MAJOR >= 24 ? false : `地板 Node ≥24.0.0（拍板 2026-10-16；22 线不入支持面）；当前 v${process.versions.node} 跳过`;
const AUTH = { slug: "fixture-goal", contractHash: "ab".repeat(32) };

function freshDir() {
  return mkdtempSync(join(tmpdir(), "lzy-statedb-"));
}
function putItem(db, id = "q-1") {
  putQueueItem(db, {
    id, goalSlug: "fixture-goal", contractHash: AUTH.contractHash, endpoint: "A", state: "authorized",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    title: `夹具 ${id}`, contractPath: "contracts/fixture.md", planPath: ".lazyzcode/plans/fixture.md",
    deps: [], seq: 1,
  });
}
async function waitFor(path, timeoutMs = 10000) {
  const t0 = Date.now();
  while (!existsSync(path)) {
    if (Date.now() - t0 > timeoutMs) return false;
    await sleep(50);
  }
  return true;
}

// ── 子进程模式（崩溃恢复腿：本文件自 spawn；STATEDB_CHILD 在场时不跑测试） ──
if (process.env.STATEDB_CHILD === "crash-midtx") {
  const dbPath = process.env.STATEDB_CHILD_DB;
  const ready = process.env.STATEDB_CHILD_READY;
  const db = openStore(dbPath);
  ensureSchema(db);
  putItem(db, "q-crash");
  occupyDispatch(db, { txId: "t-committed", itemId: "q-crash", goalSlug: "fixture-goal", limits: { wallMs: 1000, points: 1 } });
  appendBudgetEvent(db, { kind: "wall", dedupKey: "committed-marker", ms: 500, authorization: AUTH });
  // 未提交行=SQL 层直写（结构性不嵌套：不在手动事务内再调存储操作——旧原型级合并行为已移除）
  db.exec("BEGIN IMMEDIATE");
  db.prepare(`INSERT INTO budget_events (seq,at,kind,authorization_json,dedup_key,ms)
    VALUES ((SELECT COALESCE(MAX(seq),0)+1 FROM budget_events),?,?,?,?,?)`)
    .run(new Date().toISOString(), "wall", JSON.stringify(AUTH), "uncommitted-marker", 999);
  writeFileSync(ready, "1");
  await sleep(60000); // 悬挂等待父进程 SIGKILL
  process.exit(0);
}

test("①唯一事件约束：同 dedupKey 二次入账=duplicate no-op；等额不同身份不吞", { skip: FLOOR_SKIP }, () => {
  const dir = freshDir();
  try {
    const db = openStore(stateDbPath(dir));
    ensureSchema(db);
    const e1 = appendBudgetEvent(db, { kind: "points", dedupKey: "k1", points: 2.5, authorization: AUTH });
    const e2 = appendBudgetEvent(db, { kind: "points", dedupKey: "k1", points: 2.5, authorization: AUTH });
    assert.deepEqual(e1, { duplicate: false, seq: 1 });
    assert.equal(e2.duplicate, true);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM budget_events").get().c, 1);
    const e3 = appendBudgetEvent(db, { kind: "points", dedupKey: "k2", points: 2.5, authorization: AUTH });
    assert.deepEqual(e3, { duplicate: false, seq: 2 });
    assert.equal(db.prepare("SELECT COUNT(*) c FROM budget_events").get().c, 2);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test("②占用事务：登记+置 running 同窗可见；同条目重复占用=拒（不重复认领）", { skip: FLOOR_SKIP }, () => {
  const dir = freshDir();
  try {
    const db = openStore(stateDbPath(dir));
    ensureSchema(db);
    putItem(db);
    occupyDispatch(db, { txId: "t-1", itemId: "q-1", goalSlug: "fixture-goal", limits: { wallMs: 1000, points: 2 } });
    const snap = readSnapshot(db);
    assert.equal(snap.txs.length, 1);
    assert.equal(snap.txs[0].phase, "open");
    assert.equal(snap.items[0].state, "running"); // 同窗（一次提交）
    assert.throws(
      () => occupyDispatch(db, { txId: "t-2", itemId: "q-1", goalSlug: "fixture-goal", limits: { wallMs: 1, points: 1 } }),
      (e) => e instanceof StatedbError && /不重复认领/.test(e.message),
    );
    // 未决占用保守计入预算
    setBudget(db, { pointsLimit: 10, wallLimitMs: 60000 });
    const agg = readBudgetAggregate(db);
    assert.equal(agg.openPoints, 2);
    assert.equal(agg.openWallMs, 1000);
    assert.equal(agg.pointsRemaining, 8);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test("③结算事务：三面同窗/重复结算幂等不双计/overrun 派生单列", { skip: FLOOR_SKIP }, () => {
  const dir = freshDir();
  try {
    const db = openStore(stateDbPath(dir));
    ensureSchema(db);
    putItem(db);
    setBudget(db, { pointsLimit: 3, wallLimitMs: 60000 });
    occupyDispatch(db, { txId: "t-1", itemId: "q-1", goalSlug: "fixture-goal", limits: { wallMs: 1000, points: 9 } });
    const queryPoints = (sid) => (sid === "s0" ? { absent: false, unpriced: [], points: 5 } : { absent: true, unpriced: [], points: 0 });
    const out = settleDispatch(db, {
      txId: "t-1", segments: [{ sessionId: "s0", durationMs: 1000 }, { sessionId: "s1", durationMs: 500 }],
      queryPoints, itemFinalState: "completed", provenance: "tx:t-1:seg-0",
    });
    assert.deepEqual(
      { wall: out.wallEntries, points: out.pointsEntries, absent: out.absentEntries, dup: out.duplicates },
      { wall: 2, points: 1, absent: 1, dup: 0 },
    );
    const snap = readSnapshot(db);
    assert.equal(snap.txs[0].phase, "settled");
    assert.equal(snap.items[0].state, "completed");
    const agg1 = readBudgetAggregate(db);
    assert.equal(agg1.points, 5);          // overrun 不入消费累计
    assert.equal(agg1.wallMs, 1500);
    assert.equal(agg1.overrunPoints, 2);   // max(0, 5-3)
    assert.equal(agg1.pointsRemaining, -2);// 负值如实不钳零
    const overrunRow = snap.events.find((e) => e.kind === "overrun");
    assert.equal(overrunRow.overrunPoints, 2);
    assert.equal(overrunRow.points, null);
    assert.equal(agg1.pointsStopped, true); // metering-absent 在案（未 ack）→ 停受限额约束派发
    // 重复结算：全 duplicate no-op，总账不双计
    const out2 = settleDispatch(db, {
      txId: "t-1", segments: [{ sessionId: "s0", durationMs: 1000 }, { sessionId: "s1", durationMs: 500 }],
      queryPoints, itemFinalState: "completed", provenance: "tx:t-1:seg-0",
    });
    assert.equal(out2.duplicates, 4); // wall×2 + absent + points（overrun 追加不计 duplicates——对齐现行 settleTxLedger 语义）
    const agg2 = readBudgetAggregate(db);
    assert.equal(agg2.points, 5);
    assert.equal(readSnapshot(db).events.length, snap.events.length); // 真 no-op：事件面零新增
    // ack 后停派旗撤回（ackSeq=当前最大 seq）
    const maxSeq = db.prepare("SELECT MAX(seq) m FROM budget_events").get().m;
    setBudget(db, { pointsLimit: 3, wallLimitMs: 60000, notes: [], ack: { at: "2026-01-02T00:00:00.000Z", ackSeq: maxSeq, note: "人工恢复" } });
    assert.equal(readBudgetAggregate(db).pointsStopped, false);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test("④并发冲突：持锁期间竞争者 busy_timeout 等待后具名 StatedbBusyError（errcode 5）", { skip: FLOOR_SKIP }, async () => {
  const dir = freshDir();
  try {
    const dbPath = stateDbPath(dir);
    const setup = openStore(dbPath);
    ensureSchema(setup);
    setup.close();
    const a = openStore(dbPath);
    const b = openStore(dbPath);
    b.exec("PRAGMA busy_timeout=300");
    a.exec("BEGIN IMMEDIATE"); // 持写锁（未提交）——独占持锁即可，不再依赖原型级事务合并
    const t0 = Date.now();
    let busyErr = null;
    try { appendBudgetEvent(b, { kind: "wall", dedupKey: "challenger", ms: 100, authorization: AUTH }); } catch (e) { busyErr = e; }
    const elapsed = Date.now() - t0;
    a.exec("ROLLBACK"); a.close(); b.close();
    assert.ok(busyErr, "竞争者必须失败而非静默成功");
    assert.equal(busyErr.name, "StatedbBusyError");
    assert.match(busyErr.message, /errcode 5/);
    assert.ok(elapsed >= 150, `busy 等待过短（${elapsed}ms）——未走 busy_timeout`);
    assert.ok(elapsed <= 5000, `busy 等待过长（${elapsed}ms）`);
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test("⑤崩溃恢复：写事务中 kill -9 → 已提交在/未提交无/open 占用持续可见/integrity ok", { skip: FLOOR_SKIP }, async () => {
  const dir = freshDir();
  try {
    const dbPath = stateDbPath(dir);
    mkdirSync(join(dir, ".lazyzcode"), { recursive: true });
    const ready = join(dir, "child-ready");
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, STATEDB_CHILD: "crash-midtx", STATEDB_CHILD_DB: dbPath, STATEDB_CHILD_READY: ready },
      stdio: "ignore",
    });
    const readyOk = await waitFor(ready);
    assert.ok(readyOk, "子进程未到达 ready（构造失败）");
    child.kill("SIGKILL");
    await new Promise((r) => child.on("exit", r));
    const db = openStore(dbPath); // 重开即 WAL 恢复
    const snap = readSnapshot(db);
    const keys = snap.events.map((e) => e.dedupKey).sort();
    assert.deepEqual(keys, ["committed-marker"], "未提交事务必须被回滚（uncommitted 不得在场）");
    assert.equal(snap.txs.length, 1);
    assert.equal(snap.txs[0].phase, "open"); // 未决占用持续可见（绝不当零）
    assert.equal(snap.items[0].state, "running");
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    const agg = readBudgetAggregate(db);
    assert.equal(agg.openPoints, 1); // 占用上限保守计入
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test("⑥WAL 回读拒面：≠wal → 具名 StatedbUnsupportedError（不静默降级）", () => {
  const stub = (mode) => ({ prepare: () => ({ get: () => ({ journal_mode: mode }) }) });
  assert.equal(assertWal(stub("wal")), "wal");
  assert.throws(() => assertWal(stub("delete")), (e) => e instanceof StatedbUnsupportedError && /拒启 DB 模式|≠ wal/.test(e.message));
});

test("⑦地板守卫语义：地板与模块检查在职；schema 版本常量=1", () => {
  const sup = runtimeSupport();
  assert.equal(typeof sup.supported, "boolean");
  if (MAJOR >= 24) assert.equal(sup.supported, true, `Node ${process.versions.node} 应支持`);
  else assert.equal(sup.supported, false);
  assert.equal(SCHEMA_VERSION, 1);
});

test("⑧结构性不嵌套：既有事务在途时再开操作=具名拒（不静默加入）；回滚后恢复可写", { skip: FLOOR_SKIP }, () => {
  const dir = freshDir();
  try {
    const db = openStore(stateDbPath(dir));
    ensureSchema(db);
    const plain = appendBudgetEvent(db, { kind: "wall", dedupKey: "first", ms: 1, authorization: AUTH });
    assert.equal(plain.duplicate, false);
    db.exec("BEGIN IMMEDIATE"); // 手动事务在途
    assert.throws(
      () => appendBudgetEvent(db, { kind: "wall", dedupKey: "nested", ms: 1, authorization: AUTH }),
      (e) => e instanceof StatedbError && !(e instanceof StatedbBusyError) && /结构性不嵌套/.test(e.message),
    );
    assert.equal(db.prepare("SELECT COUNT(*) c FROM budget_events").get().c, 1, "被拒操作不得留残行");
    db.exec("ROLLBACK"); // 外层事务收束
    const after = appendBudgetEvent(db, { kind: "wall", dedupKey: "after-rollback", ms: 2, authorization: AUTH });
    assert.equal(after.duplicate, false, "回滚后应恢复可写");
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test("⑨段行往返与结算自读：replaceDispatchTxs 写段（extra 保形）→ settleDispatch 缺省自读成事件；patchDispatchTx 单事务合补+未知字段拒", { skip: FLOOR_SKIP }, () => {
  const dir = freshDir();
  try {
    const db = openStore(stateDbPath(dir));
    ensureSchema(db);
    putItem(db);
    replaceDispatchTxs(db, [{
      txId: "t-sr", itemId: "q-1", goalSlug: "fixture-goal", phase: "open",
      openedAt: "2026-01-01T00:00:00.000Z", settledAt: null, limits: { wallMs: 1000, points: 1 },
      segments: [
        { sessionId: "s-a", durationMs: 10, exitCode: 0, endedAt: "2026-01-01T00:00:01.000Z" },
        { sessionId: "s-b", durationMs: 20 },
      ],
    }]);
    const back = readSnapshot(db).segments;
    assert.deepEqual(back.map((g) => ({ sessionId: g.sessionId, durationMs: g.durationMs, ...(g.extra ?? {}) })),
      [{ sessionId: "s-a", durationMs: 10, exitCode: 0, endedAt: "2026-01-01T00:00:01.000Z" }, { sessionId: "s-b", durationMs: 20 }]);
    const out = settleDispatch(db, { txId: "t-sr", queryPoints: () => ({ absent: false, unpriced: [], points: 0 }) });
    assert.equal(out.wallEntries, 2, "缺省 segments=自读段行（不得静默零段）");
    assert.deepEqual(readSnapshot(db).events.map((e) => e.dedupKey).sort(), ["wall:t-sr:s-a", "wall:t-sr:s-b"]);
    // patchDispatchTx：tx+item 单事务合补；未知字段=具名拒
    patchDispatchTx(db, { txId: "t-sr", tx: { phase: "killed", note: "合补" }, itemId: "q-1", item: { state: "failed", blockedReason: "冒烟" } });
    const snap = readSnapshot(db);
    assert.equal(snap.txs[0].phase, "killed");
    assert.equal(snap.txs[0].note, "合补");
    assert.equal(snap.items[0].state, "failed");
    assert.equal(snap.items[0].blockedReason, "冒烟");
    assert.throws(() => patchDispatchTx(db, { txId: "t-sr", tx: { nope: 1 } }), (e) => e instanceof StatedbError && /未知 tx 字段/.test(e.message));
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test("⑩备份恢复重放回路（N7④）：scripts/backup-replay.mjs 全链 exit 0（VACUUM INTO→删→恢复→integrity ok+行数一致）+破坏性守卫（已存在 state.sqlite=exit 2）", { skip: FLOOR_SKIP }, () => {
  const r = spawnSync(process.execPath, [join(fileURLToPath(new URL("../scripts/backup-replay.mjs", import.meta.url)))], { encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, (r.stderr || r.stdout).slice(0, 300));
  const receipt = JSON.parse(r.stdout);
  assert.equal(receipt.ok, true);
  assert.ok(receipt.steps.every((s) => s.ok), JSON.stringify(receipt.steps));
  const verify = receipt.steps.find((s) => s.step === "只读恢复核验");
  assert.equal(verify.integrity, "ok");
  assert.equal(verify.sameItems && verify.sameEvents && verify.sameAgg, true);
  // 破坏性守卫：已存在库的目标目录=拒（exit 2，不覆盖用户数据）
  const guardDir = freshDir();
  try {
    mkdirSync(join(guardDir, ".lazyzcode"), { recursive: true });
    writeFileSync(stateDbPath(guardDir), "x");
    const g = spawnSync(process.execPath, [join(fileURLToPath(new URL("../scripts/backup-replay.mjs", import.meta.url))), guardDir], { encoding: "utf8", timeout: 60000 });
    assert.equal(g.status, 2, `守卫须 exit 2（得 ${g.status}）`);
    assert.match(g.stderr, /已存在 state\.sqlite/);
  } finally { rmSync(guardDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

// 0.6.1 N3：provenance 列 TEXT 规约统一（N1 写侧 stringify/N2 读侧双态还原）。
// 载荷=宿主仓真实形态（评审运行器对象 provenance）；红绿同源面=迁移导入 replaceBudgetEvents
//（0.6.0 对象直绑 TEXT 列即炸——fix-061-batch F1 探针红半在案）。
test("⑨provenance 规约：对象/数组 round-trip 保形、字符串与字面量不误还原（0.6.1 N1/N2）", { skip: FLOOR_SKIP }, () => {
  const dir = freshDir();
  try {
    const db = openStore(join(dir, "t.sqlite"));
    ensureSchema(db);
    const objProv = { runId: "fx.contract.r1", duty: "review.general-correctness", source: "review-runner" };
    const base = {
      at: "2026-10-24T00:00:00.000Z", kind: "review", authorization: AUTH, itemId: null, txId: null,
      sessionId: "s1", ms: 10, points: 1, overrunPoints: null, note: null,
    };
    replaceBudgetEvents(db, [
      { ...base, seq: 1, provenance: objProv, dedupKey: "k1" },
      { ...base, seq: 2, provenance: "reconcile:tx-1", dedupKey: "k2" },
      { ...base, seq: 3, provenance: "123", dedupKey: "k3" },
      { ...base, seq: 4, provenance: "true", dedupKey: "k4" },
      { ...base, seq: 5, provenance: null, dedupKey: "k5" },
      { ...base, seq: 6, provenance: [1, 2], dedupKey: "k6" },
    ]);
    const ev = readSnapshot(db).events;
    assert.equal(ev.length, 6);
    assert.deepEqual(ev[0].provenance, objProv, "对象 provenance 写侧 stringify+读侧还原=保形");
    assert.equal(ev[1].provenance, "reconcile:tx-1", "裸字符串原样");
    assert.equal(ev[2].provenance, "123", "可 parse 非对象字面量不误还原");
    assert.equal(ev[3].provenance, "true");
    assert.equal(ev[4].provenance, null);
    assert.deepEqual(ev[5].provenance, [1, 2], "数组保形");
    // 生产 append 路径同规约（appendBudgetEvent→insertEvent）＋dedupKey 必填契约（NOT NULL 列=机器门）
    appendBudgetEvent(db, { ...base, provenance: objProv, dedupKey: "k7" });
    assert.throws(
      () => appendBudgetEvent(db, { ...base, provenance: "x" }),
      /dedupKey 必填/, "dedupKey 缺席=入口具名拒（防 undefined 直绑的密码化报文）",
    );
    const ev2 = readSnapshot(db).events;
    assert.equal(ev2.length, 7);
    assert.deepEqual(ev2[6].provenance, objProv);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
