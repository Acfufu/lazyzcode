// LazyZCode P1 隔离试点：SQLite 存储层原型（**不入 npm 包**——scripts/ 不在 files 白名单；P2 晋升 core/）
// 实施依据：docs/design-sqlite-store.md（schema 定案/语义对账/锁序/迁移协议）。
// 纪律（ADR-0039）：地板 Node ≥24.0.0；只用 SQL 层操作（PRAGMA/VACUUM INTO/纯 SQL 事务），
// 构造器唯一例外 {readOnly}；节点内禁取目录锁/网络/spawn（本模块全部同步短事务）；
// busy=PRAGMA busy_timeout=5000，超时→StatedbBusyError；WAL 打开即回读校验（≠wal 拒启不降级）；
// dedup_key UNIQUE 判重（errcode 2067/1555→duplicate no-op）；seq=事务内显式 MAX+1（稠密单调）。
// 本模块**不被任何生产路径 import**（core/queue.js、core/review.js、cli/lzy.js、plugin/hooks/* 零引用，
// N5 以 grep 核）。
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
export const SCHEMA_VERSION = 1;
export const PILOT_WRITER_VERSION = "p1-sqlite-pilot";
export const BUSY_TIMEOUT_MS = 5000;
export const NODE_FLOOR_MAJOR = 24;

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

function withWriteTx(db, fn) {
  if (db.isTransaction) return fn(); // 已在事务内=调用方事务（不嵌套）
  try {
    db.exec("BEGIN IMMEDIATE");
  } catch (e) {
    throw wrapBusy(e); // BEGIN 即撞 busy（持锁竞争）也须具名
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

// 打开存储：readOnly 面跳过 WAL 设置（只读消费放行）；写面 WAL 回读校验 + busy + 外键 + schema 版本。
export function openStore(dbPath, { readOnly = false } = {}) {
  const sup = runtimeSupport();
  if (!sup.supported) throw new StatedbUnsupportedError(sup.reason);
  const { DatabaseSync } = require("node:sqlite");
  if (!readOnly) mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath, readOnly ? { readOnly: true } : {});
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
      db.exec("PRAGMA busy_timeout=1000");
    }
    return db;
  } catch (e) {
    try { db.close(); } catch {}
    throw e;
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
  db.prepare("INSERT OR IGNORE INTO meta(key,value) VALUES('writer_version',?)").run(PILOT_WRITER_VERSION);
}

// 条目写入（试点夹具面；P2 的 addQueueItem 走真实路径，本助手不参与生产语义）。
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
  db.prepare(`INSERT INTO queue_budget (id,points_limit,wall_limit_ms,notes_json,ack_json) VALUES (1,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET points_limit=excluded.points_limit, wall_limit_ms=excluded.wall_limit_ms,
      notes_json=excluded.notes_json, ack_json=excluded.ack_json`).run(
    pointsLimit, wallLimitMs, JSON.stringify(notes), ack != null ? JSON.stringify(ack) : null,
  );
}

// 唯一事件约束（A2）：事务内 seq=MAX+1 显式分配 + dedup_key UNIQUE 判重（2067/1555→duplicate no-op）。
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

// 结算事务（A2）：逐段 U 族入账 + overrun 派生（事务内读聚合）+ tx settled + 条目终态一次提交。
// 重复结算=全 dedupKey duplicate（幂等，不双计）。
export function settleDispatch(db, { txId, segments, queryPoints = DEFAULT_QUERY_POINTS, itemFinalState, provenance = null }) {
  return withWriteTx(db, () => {
    const tx = db.prepare("SELECT * FROM dispatch_txs WHERE tx_id=?").get(txId);
    if (!tx) throw new StatedbError(`派发事务缺失：${txId}（事件账与内存态不一致，拒绝写）`);
    const authorization = { slug: tx.goal_slug, contractHash: undefined };
    const item = db.prepare("SELECT contract_hash FROM queue_items WHERE id=?").get(tx.item_id);
    authorization.contractHash = item?.contract_hash;
    const at = new Date().toISOString();
    const out = { wallEntries: 0, pointsEntries: 0, absentEntries: 0, duplicates: 0, points: 0 };
    segments.forEach((seg, i) => {
      const sid = seg.sessionId ?? `seg-${i}`;
      const base = { authorization, provenance, itemId: tx.item_id, txId, sessionId: seg.sessionId ?? null, at };
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
    db.prepare("UPDATE dispatch_txs SET phase='settled', settled_at=? WHERE tx_id=?").run(at, txId);
    if (itemFinalState) db.prepare("UPDATE queue_items SET state=?, updated_at=? WHERE id=?").run(itemFinalState, at, tx.item_id);
    return out;
  });
}

// 预算聚合（对齐 budgetView 语义：overrun 不入消费累计、评审独立轴、未决占用保守计入、ack-by-seq）。
export function readBudgetAggregate(db) {
  const limitRow = db.prepare("SELECT points_limit, wall_limit_ms, ack_json FROM queue_budget WHERE id=1").get();
  const ack = limitRow?.ack_json ? JSON.parse(limitRow.ack_json) : null;
  const ackSeq = Number(ack?.ackSeq) || 0;
  let wallMs = 0, points = 0, reviewPoints = 0, overrunPointsDerived = 0;
  const stopKinds = [];
  for (const e of db.prepare("SELECT seq, kind, ms, points FROM budget_events ORDER BY seq").all()) {
    if (e.kind === "review") { reviewPoints += Number(e.points) || 0; continue; }
    if (e.kind === "overrun") continue; // 超额只作审计痕迹/派生读数
    wallMs += Number(e.ms) || 0;
    points += Number(e.points) || 0;
    if (["metering-absent", "killed-inflight"].includes(e.kind) && (Number(e.seq) || 0) > ackSeq) stopKinds.push({ seq: e.seq, kind: e.kind });
  }
  let openWallMs = 0, openPoints = 0;
  for (const t of db.prepare("SELECT limits_json FROM dispatch_txs WHERE phase='open'").all()) {
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

// 备份（VACUUM INTO；不复制主文件冒充 WAL 快照）+ 完整性核验。
export function backupTo(db, targetPath) {
  if (targetPath.includes("'")) throw new StatedbError(`备份目标含单引号，拒绝拼入 SQL：${targetPath}`);
  db.exec(`VACUUM INTO '${targetPath}'`);
  return targetPath;
}

export function integrityCheck(db) {
  return db.prepare("PRAGMA integrity_check").get();
}
