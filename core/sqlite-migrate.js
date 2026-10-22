// LazyZCode 局部状态 SQLite 显式迁移机器（P3；goal p3-sqlite-switch）。
// 实施依据：docs/design-sqlite-store.md §7（迁移提交点与 journal 协议，冻结）/§8（回退姿态）
// + 计划定案①-⑥（.lazyzcode/plans/p3-sqlite-switch.md）。ADR-0029 机器（core/migrate.js，
// state.json 版本入口）语义不动——本文件独立 journal 命名空间 .lazyzcode/migration/sqlite/。
// 协议：前置活性检查（活跃 tx/running 条目=具名拒）→ withLock 整段（与队列写入者同一目录锁）
// → 备份（三族复制 + manifest sha256 双读校验；ADR-0029 backup-mismatch 家法）→ 导入 staged 库
// （loadX 版本/形状/checksum 三门；经 replaceX 整集写原语；显式 seq/id/dedup_key 保留，
// UNIQUE 冲突=停不静默合并）→ 逐项语义对账（readSnapshot 回读 vs 源逐字段 canonical 比较）
// + integrity_check → install 前源漂移双读校验（漂移=停）→ 原子安装（close 后同卷 rename）→
// 库外 marker（读向翻转）→ meta.backend 最后写=提交点（design §7.5）→ journal done。
// 姿态（ADR-0039）：前向单向；update/sync 永不自动迁移（本文件唯一生产调用方=cli/lzy.js
// migrate sqlite）；已迁移重跑=具名拒（永不覆盖既有库）；中断重入按 journal 相位幂等续跑。
// 提交点序（P3 定案③）：install→marker→meta.backend。install→marker 窗口=P2 判据（库在场）
// 已认 DB 且内容为忠实导入，语义安全；marker→meta.backend 窗口=读向已翻、resume 补提交点。
// stopAfterPhase 为测试专用中断钩子（生产 CLI 不传）：相位完成后具名抛出，供契约测试确定性
// 构造断点态；真 kill -9 中断腿由取证脚本承接。
import { createHash } from "node:crypto";
import {
  appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync,
  renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import {
  StatedbError, StatedbUnsupportedError, WRITER_VERSION, stateDbPath, runtimeSupport,
  openStore, ensureSchema, integrityCheck, readSnapshot, replaceQueueFamily,
  replaceDispatchTxs, replaceBudgetEvents, readBackendMarker, writeBackendMarker,
  currentFamilyFingerprints, JSON_FAMILIES,
} from "./statedb.js";
import { loadQueue, loadDispatch, loadLedger, QueueError } from "./queue.js";
import { withLock } from "./loop.js";

const PHASES = ["start", "backup", "import", "reconcile", "install", "commit", "done"];
const STOPPABLE = new Set(["backup", "import", "reconcile", "install"]);

// 三族规格：load=现行读入口（版本/形状/checksum 三门，损坏=QueueError 停）；
// fallback=家族缺席（loadFamilyFile ENOENT→null）的空族语义（design §7.3 缺家族=空族合法导入）。
const FAMILY_SPECS = [
  { key: "queue", rel: JSON_FAMILIES[0].rel, load: loadQueue, fallback: { items: [], budget: null } },
  { key: "dispatch", rel: JSON_FAMILIES[1].rel, load: loadDispatch, fallback: { txs: [] } },
  { key: "ledger", rel: JSON_FAMILIES[2].rel, load: loadLedger, fallback: { entries: [] } },
];

function fileSha256(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

// ── journal（.lazyzcode/migration/sqlite/journal/<runId>.jsonl；逐行 {at,runId,phase,...}）──
function migPaths(root) {
  const base = join(root, ".lazyzcode", "migration", "sqlite");
  return { base, journalDir: join(base, "journal") };
}
function appendJournal(journalDir, runId, entry) {
  mkdirSync(journalDir, { recursive: true });
  appendFileSync(join(journalDir, `${runId}.jsonl`), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}
function readJournal(journalDir, runId) {
  return readFileSync(join(journalDir, `${runId}.jsonl`), "utf8")
    .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
function lastIncompleteRun(journalDir) {
  if (!existsSync(journalDir)) return null;
  const runs = readdirSync(journalDir)
    .filter((n) => n.endsWith(".jsonl"))
    .map((n) => ({ n, m: statSync(join(journalDir, n)).mtimeMs }))
    .sort((a, b) => b.m - a.m); // 新→旧：只续最近一个未收尾 run（更旧的不静默接管）
  for (const { n } of runs) {
    const runId = n.replace(/\.jsonl$/, "");
    const lines = readJournal(journalDir, runId);
    const last = lines.at(-1);
    if (last && last.phase !== "done") return { runId, lastPhase: last.phase, lines };
  }
  return null;
}

// ── 前置活性检查（design §7.1「确认无活跃派发/评审/写入者」）──
function activeWriters(root) {
  const d = loadDispatch(root) ?? { txs: [] };
  const open = d.txs
    .filter((t) => t.phase === "open" || t.deliveringSinceMs != null)
    .map((t) => `tx:${t.txId}(${t.phase}${t.deliveringSinceMs != null ? "/delivering" : ""})`);
  const q = loadQueue(root) ?? { items: [] };
  const running = q.items.filter((it) => it.state === "running").map((it) => `item:${it.id}(running)`);
  const parts = [...open, ...running];
  return parts.length ? parts.join("、") : null;
}

// ── 备份（三族复制 + manifest 双读校验；缺席族记 absent）──
function backupFamilies(root, backupDir) {
  mkdirSync(backupDir, { recursive: true });
  const files = [];
  for (const f of FAMILY_SPECS) {
    const src = join(root, f.rel);
    if (!existsSync(src)) {
      files.push({ file: f.rel, absent: true });
      continue;
    }
    const dst = join(backupDir, basename(f.rel));
    copyFileSync(src, dst);
    const s1 = fileSha256(src);
    const s2 = fileSha256(dst);
    if (s1 !== s2) throw new QueueError(`迁移停：备份双读校验不符（源与副本 sha256 不同）：${src}——收敛环境后重迁`);
    files.push({ file: f.rel, sha256: s1, bytes: statSync(src).size });
  }
  const manifest = { version: 1, at: new Date().toISOString(), writerVersion: WRITER_VERSION, files };
  writeFileSync(join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function loadFamilies(root) {
  const source = {};
  for (const f of FAMILY_SPECS) {
    source[f.key] = f.load(root) ?? structuredClone(f.fallback);
  }
  return { source, frozen: currentFamilyFingerprints(root) };
}

// ── 导入 staged 库（显式 seq/id/dedup_key 保留；UNIQUE 冲突=停）──
function importToStaged(source, stagedPath) {
  rmSync(stagedPath, { force: true });
  for (const suf of ["-wal", "-shm"]) rmSync(`${stagedPath}${suf}`, { force: true });
  const db = openStore(stagedPath);
  ensureSchema(db);
  try {
    replaceQueueFamily(db, { items: source.queue.items, budget: source.queue.budget ?? null });
    // 预算缺席=无行（replaceQueueFamily 经 writeBudgetRow 无条件写 id=1 行，而 readSnapshot 对
    // 「行在但全空」回对象≠null——JSON 侧 budget 缺席/null 的语义=无行；不删则 reconcile 必停。
    // F5 取证探针发现（2026-10-23），补齐「空/部分族工作区迁移」路径（计划定案①）。
    if (source.queue.budget == null) db.prepare("DELETE FROM queue_budget WHERE id = 1").run();
    replaceDispatchTxs(db, source.dispatch.txs);
    replaceBudgetEvents(db, source.ledger.entries);
  } catch (e) {
    db.close();
    if (/UNIQUE constraint failed.*dedup_key/i.test(String(e?.message))) {
      throw new QueueError(`迁移停：预算事件唯一性冲突（dedup_key 重复）——design §7.4 不静默合并；核对源 ledger.json：${e.message}`);
    }
    throw e;
  }
  return db;
}

// ── 逐项语义对账（readSnapshot 回读 vs 源；canonical=键排序+null/缺席键对称折叠：
// 存储层写侧 undefined→null、读侧缺列→null，故 {a:null}≡{a:undefined}≡缺键——三形等价）──
function canonical(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map(canonical);
  if (typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      const x = canonical(v[k]);
      if (x !== null) out[k] = x;
    }
    return out;
  }
  return v;
}
const canonJson = (v) => JSON.stringify(canonical(v));
const omit = (o, keys) => {
  const out = { ...o };
  for (const k of keys) delete out[k];
  return out;
};
const restoreSeg = (s) => ({ sessionId: s.sessionId, durationMs: s.durationMs, ...(s.extra ?? {}) });

function reconcileCompare(source, snap) {
  const problems = [];
  const srcItems = new Map(source.queue.items.map((it) => [it.id, it]));
  const dbItems = new Map(snap.items.map((it) => [it.id, it]));
  if (srcItems.size !== dbItems.size) problems.push(`条目数 ${srcItems.size}→${dbItems.size}`);
  for (const [id, it] of srcItems) {
    const row = dbItems.get(id);
    if (!row) { problems.push(`条目缺行：${id}`); continue; }
    if (canonJson(it) !== canonJson(row)) problems.push(`条目字段不匹配：${id}`);
  }
  const dbTxs = new Map(snap.txs.map((t) => [t.txId, t]));
  const srcTxs = new Map(source.dispatch.txs.map((t) => [t.txId, t]));
  if (srcTxs.size !== dbTxs.size) problems.push(`事务数 ${srcTxs.size}→${dbTxs.size}`);
  for (const [txId, t] of srcTxs) {
    const row = dbTxs.get(txId);
    if (!row) { problems.push(`事务缺行：${txId}`); continue; }
    if (canonJson(omit(t, ["segments"])) !== canonJson(row)) problems.push(`事务字段不匹配：${txId}`);
    const srcSegs = t.segments ?? [];
    const dbSegs = snap.segments.filter((s) => s.txId === txId)
      .sort((a, b) => a.segIndex - b.segIndex).map(restoreSeg);
    if (canonJson(srcSegs) !== canonJson(dbSegs)) problems.push(`段不匹配：${txId}（${srcSegs.length}→${dbSegs.length}）`);
  }
  const dbEvents = new Map(snap.events.map((e) => [e.seq, e]));
  if (source.ledger.entries.length !== dbEvents.size) problems.push(`事件数 ${source.ledger.entries.length}→${dbEvents.size}`);
  for (const e of source.ledger.entries) {
    const row = dbEvents.get(e.seq);
    if (!row) { problems.push(`事件缺行：seq=${e.seq} dedup=${e.dedupKey}`); continue; }
    if (canonJson(e) !== canonJson(row)) problems.push(`事件字段不匹配：seq=${e.seq}`);
  }
  if (canonJson(source.queue.budget ?? null) !== canonJson(snap.budget)) problems.push("预算行不匹配");
  if (problems.length) {
    throw new QueueError(
      `迁移停：逐项语义对账不符（design §7.4 发现不可解释差额即停，不静默合并）：${problems.slice(0, 5).join("；")}` +
      `${problems.length > 5 ? `（等 ${problems.length} 项）` : ""}`,
    );
  }
}

function snapshotCounts(db) {
  const snap = readSnapshot(db);
  return {
    items: snap.items.length, txs: snap.txs.length, segments: snap.segments.length,
    events: snap.events.length, budget: snap.budget != null,
  };
}

// ── install 前源漂移双读校验（P3 定案④；ADR-0029 backup-mismatch 家法）──
function driftCheck(root, frozen) {
  if (!frozen) return;
  const now = currentFamilyFingerprints(root);
  for (const f of JSON_FAMILIES) {
    if (frozen[f.key] != null && now[f.key] !== frozen[f.key]) {
      throw new QueueError(
        `迁移停：源文件在迁移窗口内被改写（install 前双读校验）：${join(root, f.rel)}` +
        `——存在绕锁写入者或用户改动；收敛后重迁（备份在 .lazyzcode/migration/sqlite/<runId>/backup/）`,
      );
    }
  }
}

function assertNoSidecars(stagedPath) {
  for (const suf of ["-wal", "-shm"]) {
    if (existsSync(`${stagedPath}${suf}`)) {
      throw new StatedbError(`staged 库关闭后 ${suf} 侧车仍在场（WAL 未收敛）——拒安装；重迁可恢复`);
    }
  }
}

// ── 主入口 ──
export function migrateToSqlite(root, opts = {}) {
  const sup = runtimeSupport();
  if (!sup.supported) {
    throw new StatedbUnsupportedError(`迁移拒启：${sup.reason}——DB 面地板 Node ≥24.0.0（ADR-0039）`);
  }
  if (opts.stopAfterPhase != null && !STOPPABLE.has(opts.stopAfterPhase)) {
    throw new QueueError(`stopAfterPhase 不识别：${String(opts.stopAfterPhase)}（可用：${[...STOPPABLE].join("/")}）`);
  }
  const lazyDir = join(root, ".lazyzcode");
  if (!existsSync(lazyDir)) {
    throw new QueueError(`迁移拒：非工作区（.lazyzcode 缺席）：${root}——无可迁移状态`);
  }
  const dbPath = stateDbPath(root);
  const { base: runBase, journalDir } = migPaths(root);
  const resume = opts.stopAfterPhase ? null : lastIncompleteRun(journalDir);
  const runId = resume?.runId ?? `${Date.now()}-pid${process.pid}`;
  const runDir = join(runBase, runId);
  const backupDir = join(runDir, "backup");
  const stagedPath = join(runDir, "staged.sqlite");
  const journal = (phase, detail = {}) => appendJournal(journalDir, runId, { runId, phase, ...detail });
  const stopAfter = (phase) => {
    if (opts.stopAfterPhase === phase) {
      journal(`stop-${phase}`, { simulated: true });
      throw new QueueError(`stopAfterPhase:${phase} 中断模拟（测试专用钩子；journal 相位已落，重跑即续）`);
    }
  };
  // 注意：phasesDone 只由 resume 时的 journal 快照构成；fresh run 恒空集（全新七相）。
  const phasesDone = new Set(resume ? resume.lines.map((l) => l.phase) : []);
  const journalLine = (phase) => (resume?.lines ?? []).find((l) => l.phase === phase) ?? null;

  return withLock(root, () => {
    if (!resume) {
      // 已迁移/异物库永不覆盖（ADR-0039 前向单向；计划定案⑩）
      if (existsSync(dbPath)) {
        throw new QueueError(
          `迁移拒：state.sqlite 已在场（已迁移或异物库）：${dbPath}。已迁移工作区无需再迁；` +
          `若为异物库先人工核对——迁移永不覆盖既有库`,
        );
      }
      if (readBackendMarker(root)) {
        throw new QueueError(
          `迁移拒：读向标记已在场（.lazyzcode/state.backend.json）而库缺席——迁移完成态残缺；` +
          `先核对 journal（.lazyzcode/migration/sqlite/journal/）与备份再处置`,
        );
      }
      const active = activeWriters(root);
      if (active) {
        throw new QueueError(`迁移拒：存在活跃写入者，先收敛再迁移：${active}（design §7.1 冻结写入）`);
      }
      journal("start", { root, writerVersion: WRITER_VERSION, resume: false });
    } else {
      journal("start", { root, writerVersion: WRITER_VERSION, resume: true, fromPhase: resume.lastPhase });
    }

    // backup（resume 已过则复用既有 manifest）
    let manifest = phasesDone.has("backup")
      ? JSON.parse(readFileSync(join(backupDir, "manifest.json"), "utf8"))
      : null;
    if (!phasesDone.has("backup")) {
      manifest = backupFamilies(root, backupDir);
      journal("backup", { files: manifest.files.map((f) => ({ file: f.rel, sha256: f.sha256 ?? null })) });
      stopAfter("backup");
    }

    // import（resume 已过则 frozen 从 journal 恢复）
    let frozen;
    if (!phasesDone.has("import")) {
      const loaded = loadFamilies(root);
      frozen = loaded.frozen;
      const db = importToStaged(loaded.source, stagedPath);
      const counts = snapshotCounts(db);
      db.close();
      journal("import", { counts, frozen });
      stopAfter("import");
    } else {
      frozen = journalLine("import")?.frozen ?? null;
      if (!frozen) {
        throw new StatedbError(`续跑失败：journal 缺 import 相位的冻结指纹（journal 损坏）——人工核对 ${journalDir}`);
      }
    }

    // reconcile + install（staged 在场才有这两相；resume-from-install 起跳过）
    let counts = null;
    if (!phasesDone.has("install")) {
      const db = openStore(stagedPath);
      if (!phasesDone.has("reconcile")) {
        const snap = readSnapshot(db);
        reconcileCompare(loadFamilies(root).source, snap);
        const ic = integrityCheck(db);
        if (ic?.integrity_check !== "ok") {
          db.close();
          throw new StatedbError(`迁移停：staged 库 integrity_check=${JSON.stringify(ic?.integrity_check)}——拒安装`);
        }
        journal("reconcile", { ok: true });
        stopAfter("reconcile");
      }
      driftCheck(root, frozen);
      counts = snapshotCounts(db);
      db.close(); // 干净关闭：WAL checkpoint 入主文件、侧车删除（known-unknown #2 的核验在 assertNoSidecars）
      assertNoSidecars(stagedPath);
      renameSync(stagedPath, dbPath);
      journal("install", { counts });
      stopAfter("install");
    } else {
      counts = journalLine("install")?.counts ?? null;
    }

    // commit（提交点链尾：marker 先翻读向、meta.backend 最后写；P3 定案③）
    if (!phasesDone.has("commit")) {
      writeBackendMarker(root, {});
      const db2 = openStore(dbPath);
      try {
        db2.prepare("INSERT INTO meta (key, value) VALUES ('backend', 'sqlite') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
        db2.prepare("INSERT INTO meta (key, value) VALUES ('json_frozen', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(frozen));
      } finally {
        db2.close();
      }
      journal("commit", {});
    }

    journal("done", { counts });
    return { runId, phases: PHASES, counts, frozen };
  });
}

// N4 调用面再导出：dispatch/reconcile 入口误写检测一律经 statedb 原语（本文件不另立判据）。
export { assertNoJsonMiswrite } from "./statedb.js";
