// LazyZCode 局部状态存储层（生产面；P1 试点 scripts/p1-sqlite-pilot/statedb.mjs 晋升，P2 N1）。
// 实施依据：docs/design-sqlite-store.md（§3 schema 定案 / §4 语义对账 / §5 锁序与事务纪律）。
// 纪律（ADR-0039 拍板）：地板 Node ≥24.0.0；只用 SQL 层操作（PRAGMA/VACUUM INTO/纯 SQL 事务），
// 构造器唯一例外 {readOnly}；事务内禁取目录锁/网络/spawn（本模块全部同步短事务）；
// busy=PRAGMA busy_timeout=5000（全连接统一，含 readOnly），超时→StatedbBusyError（errcode 5）；
// WAL 打开即回读校验（≠wal 拒启不降级）；dedup_key UNIQUE 判重（errcode 2067/1555→duplicate no-op）；
// seq=事务内显式 MAX+1（稠密单调，对齐现行 entries.length+1）。
// 结构性不嵌套（P2 N1 纪律句，替代 db.isTransaction 窥探）：每个导出操作恰一个顶层事务，
// 多写面在同一事务内展开；在既有事务内再调操作=SQLite 拒（「cannot start a transaction within
// a transaction」）→ 本模块包装为具名 StatedbError，绝不做静默加入/静默降级。
// 锁序：withLock（目录锁）→ 单一 DB 事务；本模块不取锁（调用方持锁）。
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export const SCHEMA_VERSION = 1;
export const BUSY_TIMEOUT_MS = 5000;
export const NODE_FLOOR_MAJOR = 24;

function packageVersion() {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}
export const WRITER_VERSION = `lzy@${packageVersion() ?? "unknown"}`;

export class StatedbError extends Error {
  constructor(message, opts) { super(message, opts); this.name = "StatedbError"; }
}
export class StatedbBusyError extends StatedbError {
  constructor(message, opts) { super(message, opts); this.name = "StatedbBusyError"; }
}
export class StatedbUnsupportedError extends StatedbError {
  constructor(message, opts) { super(message, opts); this.name = "StatedbUnsupportedError"; }
}

export function stateDbPath(cwd) {
  return join(cwd, ".lazyzcode", "state.sqlite");
}

// 地板与能力探针（模块可用性 ∧ major≥24）：不满足=具名拒绝（拍板依据在文案）。
export function runtimeSupport() {
  const major = Number(process.versions.node.split(".")[0]);
  if (!(major >= NODE_FLOOR_MAJOR)) {
    return { supported: false, reason: `Node ${process.versions.node} 低于地板 ≥24.0.0（用户拍板 2026-10-16；22 线不入支持面）` };
  }
  try {
    require("node:sqlite");
  } catch (e) {
    return { supported: false, reason: `node:sqlite 不可用：${e?.code ?? e?.message ?? e}` };
  }
  return { supported: true };
}

// WAL 回读校验（导出供确定性单测注入 stub 句柄；≠wal=拒启，不静默降级）。
export function assertWal(db) {
  let mode;
  try {
    mode = db.prepare("PRAGMA journal_mode").get()?.journal_mode;
  } catch (e) {
    throw new StatedbUnsupportedError(`journal_mode 回读失败：${e?.message ?? e}——拒启 DB 模式`, { cause: e });
  }
  if (String(mode).toLowerCase() !== "wal") {
    throw new StatedbUnsupportedError(
      `journal_mode 回读为 ${JSON.stringify(mode)} ≠ wal——当前文件系统可能不支持 WAL；按设计拒启 DB 模式（不静默降级）`,
    );
  }
  return mode;
}

function wrapBusy(e) {
  if (e && (e.errcode === 5 || /database is locked|database table is locked/i.test(String(e.message)))) {
    return new StatedbBusyError(`SQLite busy（errcode ${e.errcode}）：${e.message}——busy_timeout=${BUSY_TIMEOUT_MS}ms 已等待超时`, { cause: e });
  }
  return e;
}

function wrapNested(e) {
  if (/cannot start a transaction within a transaction/i.test(String(e?.message))) {
    return new StatedbError(
      `结构性不嵌套被打破：已有事务在途时再次开启写事务——每个存储操作恰一个顶层事务（多写面应在同一事务内展开）；` +
      `本操作已拒绝，未做静默加入。原始错误：${e.message}`,
      { cause: e },
    );
  }
  return e;
}

function withWriteTx(db, fn) {
  try {
    db.exec("BEGIN IMMEDIATE");
  } catch (e) {
    throw wrapBusy(wrapNested(e)); // BEGIN 即撞 busy / 撞嵌套：两者都须具名
  }
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    throw wrapBusy(e);
  }
}

// 打开存储：readOnly 面跳过 WAL 设置（只读消费放行，busy 同值 5000）；写面 WAL 回读校验 +
// busy + 外键 + schema 版本（有 meta 表才校验——全新建库放行，建表在 ensureSchema）。
export function openStore(dbPath, { readOnly = false } = {}) {
  const sup = runtimeSupport();
  if (!sup.supported) throw new StatedbUnsupportedError(sup.reason);
  const { DatabaseSync } = require("node:sqlite");
  if (!readOnly) mkdirSync(dirname(dbPath), { recursive: true });
  let db;
  try {
    db = new DatabaseSync(dbPath, readOnly ? { readOnly: true } : {});
  } catch (e) {
    throw new StatedbError(`打开失败（${e?.code ?? e?.errstr ?? e?.message ?? e}）：${dbPath}`, { cause: e });
  }
  try {
    if (!readOnly) {
      db.exec("PRAGMA journal_mode=WAL");
      assertWal(db);
      db.exec(`PRAGMA busy_timeout=${BUSY_TIMEOUT_MS}`);
      db.exec("PRAGMA foreign_keys=ON");
      const meta = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").get();
      if (meta) {
        const row = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
        if (row && String(row.value) !== String(SCHEMA_VERSION)) {
          throw new StatedbUnsupportedError(`schema_version=${row.value} 不识别（本代 ${SCHEMA_VERSION}）——拒启`);
        }
      }
    } else {
      db.exec(`PRAGMA busy_timeout=${BUSY_TIMEOUT_MS}`);
    }
    return db;
  } catch (e) {
    try { db.close(); } catch {}
    if (e instanceof StatedbError) throw e;
    throw new StatedbError(`打开校验失败（${e?.code ?? e?.message ?? e}——库损坏/非本存储格式？）：${dbPath}`, { cause: e });
  }
}

export function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS queue_items (
      id TEXT PRIMARY KEY,
      goal_slug TEXT NOT NULL,
      contract_hash TEXT NOT NULL,
      endpoint TEXT NOT NULL CHECK (endpoint IN ('A','B','C')),
      state TEXT NOT NULL CHECK (state IN ('proposed','authorized','ready','running','completed','blocked','failed','cancelled')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      title TEXT NOT NULL,
      contract_path TEXT NOT NULL,
      plan_path TEXT NOT NULL,
      blocked_reason TEXT,
      completed_endpoint TEXT,
      tier TEXT,
      risk TEXT,
      seq INTEGER,
      plan_hash TEXT,
      deps_json TEXT NOT NULL,
      delivery_json TEXT,
      plan_review_json TEXT
    );
    CREATE TABLE IF NOT EXISTS queue_budget (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      points_limit REAL,
      wall_limit_ms INTEGER,
      notes_json TEXT NOT NULL,
      ack_json TEXT
    );
    CREATE TABLE IF NOT EXISTS dispatch_txs (
      tx_id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      goal_slug TEXT NOT NULL,
      phase TEXT NOT NULL CHECK (phase IN ('open','settled','killed','reconciled-orphan')),
      opened_at TEXT NOT NULL,
      settled_at TEXT,
      limits_json TEXT NOT NULL,
      delivering_since_ms INTEGER,
      delivering_pid INTEGER,
      note TEXT
    );
    CREATE TABLE IF NOT EXISTS dispatch_segments (
      tx_id TEXT NOT NULL REFERENCES dispatch_txs(tx_id),
      seg_index INTEGER NOT NULL,
      session_id TEXT,
      duration_ms INTEGER NOT NULL,
      extra_json TEXT,
      PRIMARY KEY (tx_id, seg_index)
    );
    CREATE TABLE IF NOT EXISTS budget_events (
      seq INTEGER PRIMARY KEY,
      at TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('wall','points','metering-absent','killed-inflight','overrun','review')),
      authorization_json TEXT NOT NULL,
      provenance TEXT,
      item_id TEXT,
      tx_id TEXT,
      session_id TEXT,
      ms INTEGER,
      points REAL,
      overrun_points REAL,
      note TEXT,
      dedup_key TEXT NOT NULL UNIQUE
    );
    CREATE INDEX IF NOT EXISTS idx_dispatch_txs_phase ON dispatch_txs(phase);
    CREATE INDEX IF NOT EXISTS idx_queue_items_state ON queue_items(state);
  `);
  db.prepare("INSERT OR IGNORE INTO meta(key,value) VALUES('schema_version',?)").run(String(SCHEMA_VERSION));
  // writer_version=建库写入者（OR IGNORE：既有库不改写——版本冲突检测面属 P3 设计，写侧不越权）。
  // meta.backend 刻意不在此写：设计原文「backend（P3 切换窗口写）」，P2 读侧不依赖该键。
  db.prepare("INSERT OR IGNORE INTO meta(key,value) VALUES('writer_version',?)").run(WRITER_VERSION);
}

// 条目整行写入（测试夹具与未来 P3 迁移面；生产 addQueueItem 走 queue.js 的操作面）。
export function putQueueItem(db, it) {
  db.prepare(`INSERT OR REPLACE INTO queue_items
    (id,goal_slug,contract_hash,endpoint,state,created_at,updated_at,title,contract_path,plan_path,
     blocked_reason,completed_endpoint,tier,risk,seq,plan_hash,deps_json,delivery_json,plan_review_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    it.id, it.goalSlug, it.contractHash, it.endpoint, it.state, it.createdAt, it.updatedAt, it.title,
    it.contractPath, it.planPath, it.blockedReason ?? null, it.completedEndpoint ?? null, it.tier ?? null,
    it.risk ?? null, it.seq ?? null, it.planHash ?? null, JSON.stringify(it.deps ?? []),
    it.delivery != null ? JSON.stringify(it.delivery) : null,
    it.planReview != null ? JSON.stringify(it.planReview) : null,
  );
}

export function setBudget(db, { pointsLimit = null, wallLimitMs = null, notes = [], ack = null }) {
  return withWriteTx(db, () => {
    db.prepare(`INSERT INTO queue_budget (id,points_limit,wall_limit_ms,notes_json,ack_json) VALUES (1,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET points_limit=excluded.points_limit, wall_limit_ms=excluded.wall_limit_ms,
        notes_json=excluded.notes_json, ack_json=excluded.ack_json`).run(
      pointsLimit, wallLimitMs, JSON.stringify(notes), ack != null ? JSON.stringify(ack) : null,
    );
  });
}

// 唯一事件约束（A2）：事务内 seq=MAX+1 显式分配 + dedup_key UNIQUE 判重（2067/1555→duplicate no-op）。
// 仅在同一 withWriteTx 事务内调用（内部函数，结构性不嵌套）。
function insertEvent(db, entry) {
  const next = db.prepare("SELECT COALESCE(MAX(seq),0)+1 AS next FROM budget_events").get().next;
  try {
    db.prepare(`INSERT INTO budget_events
      (seq,at,kind,authorization_json,provenance,item_id,tx_id,session_id,ms,points,overrun_points,note,dedup_key)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      next, entry.at ?? new Date().toISOString(), entry.kind, JSON.stringify(entry.authorization),
      entry.provenance ?? null, entry.itemId ?? null, entry.txId ?? null, entry.sessionId ?? null,
      entry.ms ?? null, entry.points ?? null, entry.overrunPoints ?? null, entry.note ?? null, entry.dedupKey,
    );
    return { duplicate: false, seq: next };
  } catch (e) {
    const uniq = e?.errcode === 2067 || e?.errcode === 1555 || /UNIQUE constraint failed/.test(String(e?.message));
    if (uniq) return { duplicate: true, seq: null };
    throw e;
  }
}

export function appendBudgetEvent(db, entry) {
  return withWriteTx(db, () => insertEvent(db, entry));
}

// 占用事务（A2）：登记 tx(open) + 条目置 running 一次提交；同条目已有 open tx=拒（不重复认领）。
export function occupyDispatch(db, { txId, itemId, goalSlug, limits, itemState = "running", at = new Date().toISOString() }) {
  return withWriteTx(db, () => {
    const open = db.prepare("SELECT tx_id FROM dispatch_txs WHERE item_id=? AND phase='open'").get(itemId);
    if (open) throw new StatedbError(`条目已有在途派发事务（不重复认领）：${itemId} → ${open.tx_id}`);
    db.prepare(`INSERT INTO dispatch_txs (tx_id,item_id,goal_slug,phase,opened_at,settled_at,limits_json) VALUES (?,?,?,'open',?,NULL,?)`)
      .run(txId, itemId, goalSlug, at, JSON.stringify(limits));
    const r = db.prepare("UPDATE queue_items SET state=?, updated_at=? WHERE id=?").run(itemState, at, itemId);
    if (r.changes === 0) throw new StatedbError(`条目不存在：${itemId}（占用登记与队列状态不一致，拒绝写）`);
    return { txId };
  });
}

const DEFAULT_QUERY_POINTS = () => ({ absent: false, unpriced: [], points: 0 }); // P2 接线 cost.querySessionPoints

// 段记录写入 helper（tx 的段行整体替换；{sessionId, durationMs, ...extra} 逐字保形）。
function writeSegments(db, txId, segments) {
  db.prepare("DELETE FROM dispatch_segments WHERE tx_id=?").run(txId);
  segments.forEach((seg, i) => {
    const extra = {};
    for (const [k, v] of Object.entries(seg ?? {})) if (k !== "sessionId" && k !== "durationMs") extra[k] = v;
    db.prepare("INSERT INTO dispatch_segments (tx_id,seg_index,session_id,duration_ms,extra_json) VALUES (?,?,?,?,?)")
      .run(txId, i, seg?.sessionId ?? null, seg?.durationMs ?? 0, Object.keys(extra).length > 0 ? JSON.stringify(extra) : null);
  });
}

// 事务补丁（P2 N3：patchTx 的 DB 侧；JSON 侧字段名 → 列名的显式映射，未知字段=拒）。
// 单事务内可同时补 tx 行、条目行与段集（调用方据此把跨文件写收成一笔）。
const TX_PATCH_COLS = { phase: "phase", settledAt: "settled_at", deliveringSinceMs: "delivering_since_ms", deliveringPid: "delivering_pid", note: "note" };
const ITEM_PATCH_COLS = { state: "state", blockedReason: "blocked_reason", completedEndpoint: "completed_endpoint", updatedAt: "updated_at" };

export function patchDispatchTx(db, { txId, tx = null, itemId = null, item = null, segments = null }) {
  return withWriteTx(db, () => {
    const exists = db.prepare("SELECT tx_id FROM dispatch_txs WHERE tx_id=?").get(txId);
    if (!exists) throw new StatedbError(`派发事务缺失：${txId}（事件账与内存态不一致，拒绝写）`);
    if (tx && Object.keys(tx).length > 0) {
      const sets = []; const vals = [];
      for (const [k, v] of Object.entries(tx)) {
        const col = TX_PATCH_COLS[k];
        if (!col) throw new StatedbError(`patchDispatchTx 未知 tx 字段：${k}`);
        sets.push(`${col}=?`); vals.push(v ?? null);
      }
      db.prepare(`UPDATE dispatch_txs SET ${sets.join(",")} WHERE tx_id=?`).run(...vals, txId);
    }
    if (itemId && item && Object.keys(item).length > 0) {
      const sets = []; const vals = [];
      for (const [k, v] of Object.entries(item)) {
        const col = ITEM_PATCH_COLS[k];
        if (!col) throw new StatedbError(`patchDispatchTx 未知 item 字段：${k}`);
        sets.push(`${col}=?`); vals.push(v ?? null);
      }
      const r = db.prepare(`UPDATE queue_items SET ${sets.join(",")} WHERE id=?`).run(...vals, itemId);
      if (r.changes === 0) throw new StatedbError(`条目不存在：${itemId}（事务补丁与队列状态不一致，拒绝写）`);
    }
    if (Array.isArray(segments)) writeSegments(db, txId, segments);
    return { txId };
  });
}

// 结算事务（A2 + P2 N3/N4）：逐段 U 族入账 + overrun 派生（事务内读聚合）+ 交付墙钟事件 +
// tx 相位（settled/killed）+ 条目/全量队列应达态一次提交。重复结算=全 dedupKey duplicate（幂等，不双计）。
// segments=null → 从 dispatch_segments 行自读（DB 侧调用缺省）；queueItems=refreshStates 级联后的
// 全量队列（整集 upsert，同事务——取代「锁内 saveQueue(refreshStates(q))」）；itemFinalState=兼容简写；
// deliveryWall={ms?,note} → 交付段墙钟事件（dedup wall:<txId>:delivery，与 JSON 侧同键；ms 缺省=
// 事务内按 tx.delivering_since_ms 派生，基准缺位=0）；
// txNote=字符串或 (out)=>字符串（完成注记含结算读数——同事务内成文）。
export function settleDispatch(db, {
  txId, segments = null, queryPoints = DEFAULT_QUERY_POINTS, provenance = null,
  itemFinalState = null, queueItems = null, txNote = null, txPhase = "settled", deliveryWall = null, at = null,
}) {
  return withWriteTx(db, () => {
    const tx = db.prepare("SELECT * FROM dispatch_txs WHERE tx_id=?").get(txId);
    if (!tx) throw new StatedbError(`派发事务缺失：${txId}（事件账与内存态不一致，拒绝写）`);
    const authorization = { slug: tx.goal_slug, contractHash: undefined };
    const item = db.prepare("SELECT contract_hash FROM queue_items WHERE id=?").get(tx.item_id);
    authorization.contractHash = item?.contract_hash;
    const sealedAt = at ?? new Date().toISOString();
    const segs = segments ?? db.prepare("SELECT session_id, duration_ms FROM dispatch_segments WHERE tx_id=? ORDER BY seg_index").all(txId)
      .map((r) => ({ sessionId: r.session_id, durationMs: r.duration_ms }));
    const out = { wallEntries: 0, pointsEntries: 0, absentEntries: 0, duplicates: 0, points: 0, deliveryWalls: 0 };
    segs.forEach((seg, i) => {
      const sid = seg.sessionId ?? `seg-${i}`;
      const base = { authorization, provenance, itemId: tx.item_id, txId, sessionId: seg.sessionId ?? null, at: sealedAt };
      const wall = insertEvent(db, { ...base, kind: "wall", dedupKey: `wall:${txId}:${sid}`, ms: seg.durationMs ?? 0 });
      if (wall.duplicate) out.duplicates += 1; else out.wallEntries += 1;
      const m = queryPoints(seg.sessionId);
      if (m.absent) {
        const e = insertEvent(db, { ...base, kind: "metering-absent", dedupKey: `metering-absent:${txId}:${sid}`,
          note: "该会话零完成用量行——计量缺席不算零，受积分限额约束的派发停止（#32）" });
        if (e.duplicate) out.duplicates += 1; else out.absentEntries += 1;
      } else {
        if (m.unpriced.length > 0) {
          const e = insertEvent(db, { ...base, kind: "metering-absent", dedupKey: `metering-absent:${txId}:${sid}:unpriced`,
            note: `未计价模型：${m.unpriced.join(",")}——未知价格不算零（#32）` });
          if (e.duplicate) out.duplicates += 1; else out.absentEntries += 1;
        }
        if (m.points > 0) {
          const e = insertEvent(db, { ...base, kind: "points", dedupKey: `points:${txId}:${sid}`, points: m.points });
          if (e.duplicate) out.duplicates += 1; else { out.pointsEntries += 1; out.points += m.points; }
          const v = readBudgetAggregate(db);
          if (v.pointsLimit != null && v.points > v.pointsLimit) {
            insertEvent(db, { ...base, kind: "overrun", dedupKey: `overrun:${txId}:${sid}`,
              overrunPoints: v.points - v.pointsLimit, points: null,
              note: `在途超额 ${Math.round((v.points - v.pointsLimit) * 100) / 100}（总额 ${v.pointsLimit}）——超额单列不进消费累计` });
          }
        }
      }
    });
    if (deliveryWall != null) {
      // 交付段墙钟基准=事务内读 tx 行（delivering_since_ms；JSON 侧同式 Math.max(0, now−基准)，
      // 基准缺位=0）；ms 显式传入时优先。计数单列 deliveryWalls 不入 wallEntries——完成注记的
      // 「wall N 段」口径与 JSON settleTxLedger 逐字对齐（交付段不入段墙钟计数）。
      const baseMs = tx.delivering_since_ms != null ? Math.max(0, Date.now() - tx.delivering_since_ms) : 0;
      const e = insertEvent(db, {
        authorization, provenance: `${provenance ?? ""}:delivery` || null, itemId: tx.item_id, txId,
        sessionId: null, at: sealedAt, kind: "wall", dedupKey: `wall:${txId}:delivery`,
        ms: Number.isFinite(deliveryWall.ms) ? deliveryWall.ms : baseMs, note: deliveryWall.note ?? null,
      });
      if (e.duplicate) out.duplicates += 1; else out.deliveryWalls += 1;
    }
    const phase = txPhase === "killed" ? "killed" : "settled";
    if (txNote != null) {
      const note = typeof txNote === "function" ? txNote(out) : txNote;
      db.prepare("UPDATE dispatch_txs SET phase=?, settled_at=?, note=? WHERE tx_id=?").run(phase, sealedAt, note, txId);
    } else {
      db.prepare("UPDATE dispatch_txs SET phase=?, settled_at=? WHERE tx_id=?").run(phase, sealedAt, txId);
    }
    if (queueItems != null) {
      const keep = new Set();
      for (const it of queueItems) { upsertQueueItemRow(db, it); keep.add(it.id); }
      for (const r of db.prepare("SELECT id FROM queue_items").all()) {
        if (!keep.has(r.id)) db.prepare("DELETE FROM queue_items WHERE id=?").run(r.id);
      }
    } else if (itemFinalState) {
      db.prepare("UPDATE queue_items SET state=?, updated_at=? WHERE id=?").run(itemFinalState, sealedAt, tx.item_id);
    }
    return out;
  });
}

// 预算聚合（对齐 budgetView 语义：overrun 不入消费累计、评审独立轴、未决占用保守计入、ack-by-seq）。
// stopKinds=全事件对象保形（N4③ 逐字对齐：JSON 侧 push 整条 ledger entry，读数面双后端同构）。
// excludeTxId=结算级联专用读选项：该 tx 相位随结算事务翻转，级联视图按翻转后口径计未决占用
//（JSON 家法：patchTx 先于 refreshStates——缺此排除，占用全额保守计入会把回 ready 的条目恒判预算耗尽）。
export function readBudgetAggregate(db, { excludeTxId = null } = {}) {
  const limitRow = db.prepare("SELECT points_limit, wall_limit_ms, ack_json FROM queue_budget WHERE id=1").get();
  const ack = limitRow?.ack_json ? JSON.parse(limitRow.ack_json) : null;
  const ackSeq = Number(ack?.ackSeq) || 0;
  let wallMs = 0, points = 0, reviewPoints = 0, overrunPointsDerived = 0;
  const stopKinds = [];
  for (const r of db.prepare("SELECT * FROM budget_events ORDER BY seq").all()) {
    const e = {
      seq: r.seq, at: r.at, kind: r.kind, authorization: JSON.parse(r.authorization_json), provenance: r.provenance,
      itemId: r.item_id, txId: r.tx_id, sessionId: r.session_id, ms: r.ms, points: r.points,
      overrunPoints: r.overrun_points, note: r.note, dedupKey: r.dedup_key,
    };
    if (e.kind === "review") { reviewPoints += Number(e.points) || 0; continue; }
    if (e.kind === "overrun") continue; // 超额只作审计痕迹/派生读数
    wallMs += Number(e.ms) || 0;
    points += Number(e.points) || 0;
    if (["metering-absent", "killed-inflight"].includes(e.kind) && (Number(e.seq) || 0) > ackSeq) stopKinds.push(e);
  }
  let openWallMs = 0, openPoints = 0;
  for (const t of db.prepare("SELECT tx_id, limits_json FROM dispatch_txs WHERE phase='open'").all()) {
    if (excludeTxId != null && t.tx_id === excludeTxId) continue;
    const l = JSON.parse(t.limits_json);
    openWallMs += Number(l?.wallMs) || 0;
    openPoints += Number(l?.points) || 0;
  }
  const pointsLimit = limitRow?.points_limit ?? null;
  const wallLimitMs = limitRow?.wall_limit_ms ?? null;
  if (pointsLimit != null) overrunPointsDerived = Math.max(0, points - pointsLimit);
  return {
    pointsLimit, wallLimitMs, wallMs, points, reviewPoints, overrunPoints: overrunPointsDerived,
    openWallMs, openPoints,
    wallRemainingMs: wallLimitMs != null ? wallLimitMs - wallMs - openWallMs : null,
    pointsRemaining: pointsLimit != null ? pointsLimit - points - openPoints : null,
    wallExhausted: wallLimitMs != null && wallMs + openWallMs >= wallLimitMs,
    pointsExhausted: pointsLimit != null && points + openPoints >= pointsLimit,
    pointsStopped: pointsLimit != null && stopKinds.length > 0,
    stopKinds,
  };
}

// 读面快照（items/txs/segments/events/budget）——CLI 读路径与钩子读器共用语义的数据面。
export function readSnapshot(db) {
  const items = db.prepare("SELECT * FROM queue_items ORDER BY COALESCE(seq, 999999), id").all().map((r) => ({
    id: r.id, goalSlug: r.goal_slug, contractHash: r.contract_hash, endpoint: r.endpoint, state: r.state,
    createdAt: r.created_at, updatedAt: r.updated_at, title: r.title, contractPath: r.contract_path,
    planPath: r.plan_path, blockedReason: r.blocked_reason, completedEndpoint: r.completed_endpoint,
    tier: r.tier, risk: r.risk, seq: r.seq, planHash: r.plan_hash, deps: JSON.parse(r.deps_json),
    delivery: r.delivery_json ? JSON.parse(r.delivery_json) : null,
    planReview: r.plan_review_json ? JSON.parse(r.plan_review_json) : null,
  }));
  const txs = db.prepare("SELECT * FROM dispatch_txs ORDER BY opened_at, tx_id").all().map((r) => ({
    txId: r.tx_id, itemId: r.item_id, goalSlug: r.goal_slug, phase: r.phase, openedAt: r.opened_at,
    settledAt: r.settled_at, limits: JSON.parse(r.limits_json), deliveringSinceMs: r.delivering_since_ms,
    deliveringPid: r.delivering_pid, note: r.note,
  }));
  const segments = db.prepare("SELECT * FROM dispatch_segments ORDER BY tx_id, seg_index").all().map((r) => ({
    txId: r.tx_id, segIndex: r.seg_index, sessionId: r.session_id, durationMs: r.duration_ms,
    extra: r.extra_json ? JSON.parse(r.extra_json) : null,
  }));
  const events = db.prepare("SELECT * FROM budget_events ORDER BY seq").all().map((r) => ({
    seq: r.seq, at: r.at, kind: r.kind, authorization: JSON.parse(r.authorization_json), provenance: r.provenance,
    itemId: r.item_id, txId: r.tx_id, sessionId: r.session_id, ms: r.ms, points: r.points,
    overrunPoints: r.overrun_points, note: r.note, dedupKey: r.dedup_key,
  }));
  const b = db.prepare("SELECT * FROM queue_budget WHERE id=1").get();
  const budget = b ? {
    pointsLimit: b.points_limit, wallLimitMs: b.wall_limit_ms,
    notes: JSON.parse(b.notes_json), pointsStoppedAck: b.ack_json ? JSON.parse(b.ack_json) : null,
  } : null;
  return { items, txs, segments, events, budget };
}

// ── 整集写（P2 N2：saveQueue/saveDispatch/saveLedger 的 DB 侧映射）──
// 语义=JSON「整本重写」的事务化等价：全集中缺席的行删除、在场行 upsert、随事务字段逐列随写。
// 这些是保 API 面的兼容写面（测试夹具与少数据面工具）；生产业务路径走占用/结算/追加等操作面。

function upsertQueueItemRow(db, it) {
  db.prepare(`INSERT OR REPLACE INTO queue_items
    (id,goal_slug,contract_hash,endpoint,state,created_at,updated_at,title,contract_path,plan_path,
     blocked_reason,completed_endpoint,tier,risk,seq,plan_hash,deps_json,delivery_json,plan_review_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    it.id, it.goalSlug, it.contractHash, it.endpoint, it.state, it.createdAt, it.updatedAt, it.title,
    it.contractPath, it.planPath, it.blockedReason ?? null, it.completedEndpoint ?? null, it.tier ?? null,
    it.risk ?? null, it.seq ?? null, it.planHash ?? null, JSON.stringify(it.deps ?? []),
    it.delivery != null ? JSON.stringify(it.delivery) : null,
    it.planReview != null ? JSON.stringify(it.planReview) : null,
  );
}

function writeBudgetRow(db, budget) {
  const b = budget ?? {};
  db.prepare(`INSERT INTO queue_budget (id,points_limit,wall_limit_ms,notes_json,ack_json) VALUES (1,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET points_limit=excluded.points_limit, wall_limit_ms=excluded.wall_limit_ms,
      notes_json=excluded.notes_json, ack_json=excluded.ack_json`).run(
    b.pointsLimit ?? null, b.wallLimitMs ?? null, JSON.stringify(b.notes ?? []),
    b.pointsStoppedAck != null ? JSON.stringify(b.pointsStoppedAck) : null,
  );
}

export function replaceQueueFamily(db, { items, budget = null }) {
  return withWriteTx(db, () => {
    const keep = new Set();
    for (const it of items) { upsertQueueItemRow(db, it); keep.add(it.id); }
    for (const r of db.prepare("SELECT id FROM queue_items").all()) {
      if (!keep.has(r.id)) db.prepare("DELETE FROM queue_items WHERE id=?").run(r.id);
    }
    writeBudgetRow(db, budget);
    return { items: items.length };
  });
}

function upsertTxRow(db, t) {
  db.prepare(`INSERT OR REPLACE INTO dispatch_txs
    (tx_id,item_id,goal_slug,phase,opened_at,settled_at,limits_json,delivering_since_ms,delivering_pid,note)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    t.txId, t.itemId, t.goalSlug, t.phase, t.openedAt, t.settledAt ?? null,
    JSON.stringify(t.limits ?? {}), t.deliveringSinceMs ?? null, t.deliveringPid ?? null, t.note ?? null,
  );
}

// 段记录逐字保形：sessionId/durationMs 上列，其余键（exitCode/endedAt/…）进 extra_json，
// 读面按 {sessionId, durationMs, ...extra} 还原（drive.js 段记录形态的往返保全）。
export function replaceDispatchTxs(db, txs) {
  return withWriteTx(db, () => {
    const keep = new Set();
    for (const t of txs) {
      upsertTxRow(db, t);
      keep.add(t.txId);
      writeSegments(db, t.txId, t.segments ?? []);
    }
    for (const r of db.prepare("SELECT tx_id FROM dispatch_txs").all()) {
      if (!keep.has(r.tx_id)) {
        db.prepare("DELETE FROM dispatch_segments WHERE tx_id=?").run(r.tx_id);
        db.prepare("DELETE FROM dispatch_txs WHERE tx_id=?").run(r.tx_id);
      }
    }
    return { txs: txs.length };
  });
}

export function replaceBudgetEvents(db, entries) {
  return withWriteTx(db, () => {
    db.prepare("DELETE FROM budget_events").run();
    entries.forEach((e, i) => {
      db.prepare(`INSERT INTO budget_events
        (seq,at,kind,authorization_json,provenance,item_id,tx_id,session_id,ms,points,overrun_points,note,dedup_key)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        Number.isInteger(e.seq) ? e.seq : i + 1, e.at ?? new Date().toISOString(), e.kind,
        JSON.stringify(e.authorization), e.provenance ?? null, e.itemId ?? null, e.txId ?? null,
        e.sessionId ?? null, e.ms ?? null, e.points ?? null, e.overrunPoints ?? null, e.note ?? null, e.dedupKey,
      );
    });
    return { events: entries.length };
  });
}

// 备份（VACUUM INTO；不复制主文件冒充 WAL 快照）+ 完整性核验。
export function backupTo(db, targetPath) {
  if (targetPath.includes("'")) throw new StatedbError(`备份目标含单引号，拒绝拼入 SQL：${targetPath}`);
  db.exec(`VACUUM INTO '${targetPath}'`);
  return targetPath;
}

export function integrityCheck(db) {
  return db.prepare("PRAGMA integrity_check").get();
}

// ── 库外读向 marker（P3 定案②；design §7 P3 定案面收口）──
// 迁移机器在提交链写（install→marker→meta.backend 最后写=提交点）；core stateBackend 与钩子
// 读向闸以它区分「迁移未做」（无 marker→现行判据）与「迁移已做」（marker 在场→DB 必须，绝不回落）。
// marker 损坏（存在但解析失败/形状不识别）=fail-closed 具名拒，不静默当缺席。
export function backendMarkerPath(cwd) {
  return join(cwd, ".lazyzcode", "state.backend.json");
}

export function readBackendMarker(cwd) {
  const p = backendMarkerPath(cwd);
  let text;
  try {
    text = readFileSync(p, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw new StatedbError(
      `读向标记不可读（${err?.code ?? err?.message ?? err}）：${p}。恢复：该文件由 lzy migrate sqlite 写入；` +
      `迁移已完成后 state.sqlite 为唯一权威——核对/恢复该标记，勿手改标记期望回落 JSON`,
    );
  }
  let m = null;
  try {
    m = JSON.parse(text);
  } catch {
    m = null;
  }
  if (!m || m.backend !== "sqlite" || m.format !== 1) {
    throw new StatedbError(
      `读向标记不可读（解析失败或形状不识别）：${p}。恢复：该文件由 lzy migrate sqlite 写入（{backend:"sqlite",format:1}）；` +
      `迁移已完成后 state.sqlite 为唯一权威——核对/恢复该标记，勿手改标记期望回落 JSON`,
    );
  }
  return m;
}

export function writeBackendMarker(cwd, { migratedAt = new Date().toISOString() } = {}) {
  const p = backendMarkerPath(cwd);
  const payload = { backend: "sqlite", format: 1, migratedAt, writerVersion: WRITER_VERSION };
  mkdirSync(dirname(p), { recursive: true });
  const tmp = join(dirname(p), `.${basename(p)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, p);
  return payload;
}

// ── 旧状态误写检测（P3 定案⑥）：meta.json_frozen 冻结指纹（在场=sha256、缺席=null）；
// 「在场但内容≠冻结」=违例（旧版 CLI 误写），缺席=不违例（删备份是用户权利）。
export const JSON_FAMILIES = [
  { key: "queue", rel: join(".lazyzcode", "queue", "queue.json") },
  { key: "dispatch", rel: join(".lazyzcode", "queue", "dispatch.json") },
  { key: "ledger", rel: join(".lazyzcode", "budget", "ledger.json") },
];

function sha256File(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

export function currentFamilyFingerprints(root) {
  const out = {};
  for (const f of JSON_FAMILIES) {
    const p = join(root, f.rel);
    try {
      out[f.key] = sha256File(p);
    } catch (err) {
      if (err?.code === "ENOENT") out[f.key] = null;
      else throw new StatedbError(`旧状态指纹不可读（${err?.code ?? err?.message ?? err}）：${p}`);
    }
  }
  return out;
}

export function readFrozenFingerprints(db) {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'json_frozen'").get();
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    throw new StatedbError(`meta.json_frozen 解析失败（库内元数据损坏）——指路：用 .lazyzcode/migration/sqlite/<runId>/backup/ 备份核对`);
  }
}

// 违例=具名拒（文案含核对/恢复/删备份三路指路）；调用方=dispatch/reconcile 入口（N4）与迁移机器。
export function assertNoJsonMiswrite(root, db) {
  const frozen = readFrozenFingerprints(db);
  if (!frozen) return { violations: [], frozen: null };
  const now = currentFamilyFingerprints(root);
  const violations = JSON_FAMILIES
    .filter((f) => frozen[f.key] != null && now[f.key] != null && now[f.key] !== frozen[f.key])
    .map((f) => join(root, f.rel));
  if (violations.length) {
    throw new StatedbError(
      `检测到迁移后旧状态文件被改写（state.sqlite 为唯一权威，旧 JSON 仅作备份/导出）：${violations.join("、")}。` +
      `指路：①若为旧版 CLI 误写——从 .lazyzcode/migration/sqlite/<runId>/backup/ 恢复该文件后重试；` +
      `②若确认无需保留——删除该备份文件后重试（缺席=不违例）；③核对期间派发/对账保持阻断。`,
    );
  }
  return { violations: [], frozen };
}
