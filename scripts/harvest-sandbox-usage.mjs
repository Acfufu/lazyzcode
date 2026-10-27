#!/usr/bin/env node
// 沙盒用量收割（保全工具）：把 <项目>/.lazyzcode/**/home/.zcode/cli/db/db.sqlite 里
// 已烧但未入账的运行，追加进 ~/.zcode/cli/lzy-usage/YYYY-MM.jsonl。
//
// 用途（2026-10-08 commandcode/opencode 暗烧案"保全"面）：任何「清理工作区/删沙盒」动作
// 之前先跑本脚本——账先于删。默认只补 max 运行日 >= LZY_HARVEST_CUTOFF（默认 2026-10-03，
// 与 0.5.0 明烧账本起点一致）的运行；pre 段结构性不补（那一段 TT 侧已回灌过）。
//
// 幂等（N3＋a1.r2 F-1/F-2 修复）：事件身份=(project, runId, 实例 sid 集摘要, 来源水位 Σtokens|
// 最新完成时刻)——同实例同水位=重放（跳过）；水位前进=新差量（追加）。会话集扩展抵消旧子集，
// 完全不交的实例才视为重建同名 run（等额不吞）；谱系未知或部分交叉则具名拒绝。
// apply 锁内重算差量，append-only 不改旧行；缺 sid 的旧库仅兼容同缺实例历史，不能猜测身份。
//
// 用法： node scripts/harvest-sandbox-usage.mjs            # 干跑，只列将追加的行
//        node scripts/harvest-sandbox-usage.mjs --apply    # 实际追加
//        LZY_HARVEST_CUTOFF=2026-09-01 node ... --apply    # 放宽起点（可选）
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { queryHostDb } from "../core/hostdb.js";
import { aggregateUsageRows, computePoints, appendSandboxUsageSnapshot, sandboxUsageSnapshotDelta, readSandboxUsageWithDiag, sandboxUsageDir, spoolPendingAppend, instanceDigest } from "../core/cost.js";

const APPLY = process.argv.includes("--apply");
const CUTOFF = process.env.LZY_HARVEST_CUTOFF || "2026-10-03";
const MAX_DBS = 1024;
const MAX_DEPTH = 12;
const SEARCH_MAX_DEPTH = 12; // 从会话根向下找潜在 .lazyzcode 的界深（artifacts/v040/M5/eval/frozen/runs/<n>/task/repo 实测 10）
const SEARCH_MAX_VISITS = 20000;
const PRUNED = new Set(["node_modules", ".git", "dist", "out", "build", "coverage"]);

const localDay = (ms) => {
  const d = new Date(Number(ms));
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function hostSessionRoots() {
  const db = join(homedir(), ".zcode", "cli", "db", "db.sqlite");
  const rows = queryHostDb(db, "SELECT DISTINCT directory FROM session WHERE directory IS NOT NULL AND trim(directory) != ''") || [];
  return [...new Set(rows.map((r) => String(r.directory || "").trim()).filter((d) => d && existsSync(d)))];
}

function walkSandboxDbs(root) {
  const found = [];
  // collect: 在一个 .lazyzcode 根内找 `<...>/home/.zcode/cli/db/db.sqlite` 标记
  const collect = (dir, depth) => {
    if (found.length >= MAX_DBS || depth > MAX_DEPTH) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (found.length >= MAX_DBS) return;
      if (!e.isDirectory()) continue;
      const child = join(dir, e.name);
      if (e.name === "home") {
        const cand = join(child, ".zcode", "cli", "db", "db.sqlite");
        if (existsSync(cand)) found.push(cand);
        continue;
      }
      if (PRUNED.has(e.name)) continue;
      collect(child, depth + 1);
    }
  };
  // search: 从会话根有界下潜，凡遇 .lazyzcode 目录即 collect（嵌套 artifacts/**/scratch|repo 面，
  // 顶层 .lazyzcode 也被此搜索覆盖）；点目录只放行 .lazyzcode 本身（.git/.codegraph 等钝化）
  let visits = 0;
  const search = (dir, depth) => {
    if (found.length >= MAX_DBS || depth > SEARCH_MAX_DEPTH || visits > SEARCH_MAX_VISITS) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (found.length >= MAX_DBS || visits > SEARCH_MAX_VISITS) return;
      if (!e.isDirectory()) continue;
      if (e.name === ".lazyzcode") {
        collect(join(dir, e.name), 0);
        continue;
      }
      if (e.name.startsWith(".") || PRUNED.has(e.name)) continue;
      visits += 1;
      search(join(dir, e.name), depth + 1);
    }
  };
  search(root, 0);
  return found;
}

const parseRun = (db) => {
  // a1.r5 F-5：取**最后一个** /.lazyzcode/（home 之前最深的那层）——路径上游含祖先 .lazyzcode
  // （嵌套仓/夹具布局）时首个匹配会把 root/runId 解析到上级。
  const pathForSplit = process.platform === "win32" ? db.replaceAll("\\", "/") : db;
  const i = pathForSplit.lastIndexOf("/.lazyzcode/");
  const root = db.slice(0, i);
  const seg = pathForSplit.slice(i + "/.lazyzcode/".length).split("/");
  const runId = seg[1] ?? seg[0]; // <kind>/<runId>/home/... ；home 在 <runId> 下、kind 可能嵌套
  const m = /^(.*)\.a(\d+)\.r(\d+)$/.exec(runId);
  return { root, runId, slug: m ? m[1] : runId, attempt: m ? Number(m[2]) : 1 };
};

// per-run 真源：跨多个 db 同 (project, runId) 求和（同 run 重建目录也不丢）。
// N3（F3）：键带 project——两个项目同名 run 不再串账（裸 runId 键曾把 100/200 tok 合并归一项目）。
const runMap = new Map();
const seenDbs = new Set(); // 会话根可互相嵌套（父根嵌套搜索会再次命中子根的 .lazyzcode）——全局去重
let scanned = 0;
let unreadable = 0; // a1.r5 F-6：db 在场但查询失败（sqlite3 缺席/库损坏）——不得与「无可补运行」静默归零
const roots = hostSessionRoots();
for (const root of roots) {
  for (const db of walkSandboxDbs(root)) {
    if (seenDbs.has(db)) continue;
    seenDbs.add(db);
    scanned += 1;
    const meta = parseRun(db);
    const rowsRaw = queryHostDb(db, [
      "SELECT provider_id AS provider, model_id AS model, started_at/3600000 AS h,",
      "SUM(input_tokens) AS it, SUM(cache_read_input_tokens) AS crt, SUM(output_tokens) AS ot",
      "FROM model_usage WHERE status = 'completed'",
      "GROUP BY provider, model, h",
    ].join(" "));
    if (rowsRaw === null && existsSync(db)) { unreadable += 1; continue; } // 查询失败≠空
    const rows = rowsRaw || [];
    const span = queryHostDb(db, "SELECT MAX(started_at) AS m, MAX(completed_at) AS c FROM model_usage") || [];
    if (rows.length === 0) continue;
    const sidRows = queryHostDb(db, "SELECT DISTINCT session_id AS sid FROM model_usage WHERE status = 'completed'") || []; // 真列名 session_id（a1.r5 P1）
    const mapKey = `${meta.root}\u0000${meta.runId}`;
    const e = runMap.get(mapKey) ?? { ...meta, rows: [], sids: [], maxStart: 0, maxDone: 0 };
    e.rows.push(...rows);
    e.sids.push(...sidRows.map((r) => r?.sid)); // F-1/F-2：实例身份=distinct sid 集（跨多库并集）
    e.maxStart = Math.max(e.maxStart, Number(span[0]?.m) || 0);
    e.maxDone = Math.max(e.maxDone, Number(span[0]?.c) || 0);
    runMap.set(mapKey, e);
  }
}

const { lines: existingAll, diag } = readSandboxUsageWithDiag();
if (diag.dirState === "unreadable" || diag.corruptLines > 0) {
  throw new Error(`全局账本完整性失败：${diag.dirState} / 损坏行 ${diag.corruptLines}；保留原账，拒绝把缺口当零`);
}

const plan = [];
let skippedPre = 0;
let skippedDup = 0;
for (const [, e] of runMap) {
  if (!e.maxStart) continue;
  const day = localDay(e.maxStart);
  if (day < CUTOFF) { skippedPre += 1; continue; }
  const agg = computePoints(e.rows);
  const truth = aggregateUsageRows(e.rows);
  const truthTok = truth.reduce((sum, u) => sum + u.inputTokens + u.cacheReadTokens + u.outputTokens, 0);
  const watermark = `${truthTok}|${e.maxDone}`;
  const instance = instanceDigest(e.sids);
  const record = {
    runId: e.runId, slug: e.slug, attempt: e.attempt, validity: null,
    metering: { usage: truth, points: agg.points },
    harvest: { instance, watermark, sessionIds: [...new Set(e.sids.filter(s => typeof s === "string" && s))].sort() },
  };
  const preview = sandboxUsageSnapshotDelta(e.root, record, existingAll);
  if (!preview) { skippedDup += 1; continue; }
  const deltaTok = preview.metering.usage.reduce((sum, u) => sum + u.inputTokens + u.cacheReadTokens + u.outputTokens, 0);
  plan.push({ ...e, day, record, deltaTok, deltaPoints: preview.metering.points,
    priorRows: existingAll.filter(l => l.project === e.root && l.runId === e.runId).length });
}

plan.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : b.deltaTok - a.deltaTok));
console.log(`扫描 db ${scanned} | 运行 ${runMap.size} | 跳过 pre-${CUTOFF} ${skippedPre} | 已入账 ${skippedDup} | 待追加 ${plan.length}${unreadable ? ` | ⚠ 不可读 db ${unreadable}（完整性存疑，勿当全量）` : ""}`);
let sumTok = 0;
let sumPts = 0;
for (const p of plan) {
  sumTok += p.deltaTok;
  sumPts += p.deltaPoints;
  console.log(
    `  ${p.day}  ${p.root.split("/").pop().padEnd(14)} ${p.runId.padEnd(46)} ` +
    `${p.deltaTok.toLocaleString().padStart(12)} tok  ${p.deltaPoints.toFixed(1).padStart(7)} pts` +
    (p.priorRows ? `  (+ 差量,已有 ${p.priorRows} 行)` : ""),
  );
}
console.log(`合计待追加 ${sumTok.toLocaleString()} tok / ${sumPts.toFixed(1)} pts`);

if (!APPLY) {
  console.log("干跑模式（未写入）。确认无误后加 --apply 执行。");
  process.exit(0);
}
let appended = 0;
let failed = 0;
for (const p of plan) {
  const now = new Date(p.maxDone || p.maxStart || Date.now());
  try {
    // The preview can be stale. Re-read and recompute under the shared writer lock.
    if (appendSandboxUsageSnapshot(p.root, p.record, { now })) appended += 1;
    else console.log(`  跳过（提交时已覆盖）: ${p.runId}`);
  } catch (e) {
    failed += 1;
    const spooled = spoolPendingAppend(p.root, p.record, e, now);
    console.error(`  追加失败: ${p.runId}: ${e.message}${spooled ? "（待补账回执已保留）" : "（回执也未写入，须保留来源库）"}`);
  }
}
console.log(`已追加 ${appended}/${plan.length} 行 → ${sandboxUsageDir()}${failed ? `；失败 ${failed}` : ""}`);
if (failed || unreadable) process.exitCode = 1;
