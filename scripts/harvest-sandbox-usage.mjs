#!/usr/bin/env node
// 沙盒用量收割（保全工具）：把 <项目>/.lazyzcode/**/home/.zcode/cli/db/db.sqlite 里
// 已烧但未入账的运行，追加进 ~/.zcode/cli/lzy-usage/YYYY-MM.jsonl。
//
// 用途（2026-10-08 commandcode/opencode 暗烧案"保全"面）：任何「清理工作区/删沙盒」动作
// 之前先跑本脚本——账先于删。默认只补 max 运行日 >= LZY_HARVEST_CUTOFF（默认 2026-10-03，
// 与 0.5.0 明烧账本起点一致）的运行；pre 段结构性不补（那一段 TT 侧已回灌过）。
//
// 幂等：复用 core/cost.js appendSandboxUsage 内建去重（(project, runId, points|tokens) 指纹），
// 重复跑安全；已入账但被截断的「半截账」运行追加差量行（求和口径正确，append-only 不改旧行）。
//
// 用法： node scripts/harvest-sandbox-usage.mjs            # 干跑，只列将追加的行
//        node scripts/harvest-sandbox-usage.mjs --apply    # 实际追加
//        LZY_HARVEST_CUTOFF=2026-09-01 node ... --apply    # 放宽起点（可选）
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { queryHostDb } from "../core/hostdb.js";
import { aggregateUsageRows, computePoints, appendSandboxUsage, readSandboxUsageLines } from "../core/cost.js";

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
  const i = db.indexOf("/.lazyzcode/");
  const root = db.slice(0, i);
  const seg = db.slice(i + "/.lazyzcode/".length).split("/");
  const runId = seg[1] ?? seg[0]; // <kind>/<runId>/home/... ；home 在 <runId> 下、kind 可能嵌套
  const m = /^(.*)\.a(\d+)\.r(\d+)$/.exec(runId);
  return { root, runId, slug: m ? m[1] : runId, attempt: m ? Number(m[2]) : 1 };
};

// fp 与 appendSandboxUsage 内部去重键同构（points|Σ(input+cacheRead+output)）
const fp = (points, usage) =>
  `${Number(points) || 0}|${(usage ?? []).reduce(
    (s, u) => s + (Number(u.inputTokens) || 0) + (Number(u.cacheReadTokens) || 0) + (Number(u.outputTokens) || 0),
    0,
  )}`;

// per-run 真源：跨多个 db 同 runId 求和（同 run 重建目录也不丢）
const runMap = new Map();
const seenDbs = new Set(); // 会话根可互相嵌套（父根嵌套搜索会再次命中子根的 .lazyzcode）——全局去重
let scanned = 0;
const roots = hostSessionRoots();
for (const root of roots) {
  for (const db of walkSandboxDbs(root)) {
    if (seenDbs.has(db)) continue;
    seenDbs.add(db);
    scanned += 1;
    const meta = parseRun(db);
    const rows = queryHostDb(db, [
      "SELECT provider_id AS provider, model_id AS model, started_at/3600000 AS h,",
      "SUM(input_tokens) AS it, SUM(cache_read_input_tokens) AS crt, SUM(output_tokens) AS ot",
      "FROM model_usage WHERE status = 'completed'",
      "GROUP BY provider, model, h",
    ].join(" ")) || [];
    const span = queryHostDb(db, "SELECT MAX(started_at) AS m, MAX(completed_at) AS c FROM model_usage") || [];
    if (rows.length === 0) continue;
    const e = runMap.get(meta.runId) ?? { ...meta, rows: [], maxStart: 0, maxDone: 0 };
    e.rows.push(...rows);
    e.maxStart = Math.max(e.maxStart, Number(span[0]?.m) || 0);
    e.maxDone = Math.max(e.maxDone, Number(span[0]?.c) || 0);
    runMap.set(meta.runId, e);
  }
}

const existingAll = readSandboxUsageLines();
const byRun = new Map();
for (const l of existingAll) {
  if (!l?.runId) continue;
  const arr = byRun.get(l.runId) ?? [];
  arr.push(l);
  byRun.set(l.runId, arr);
}

const plan = [];
let skippedPre = 0;
let skippedDup = 0;
for (const [runId, e] of runMap) {
  if (!e.maxStart) continue;
  const day = localDay(e.maxStart);
  if (day < CUTOFF) { skippedPre += 1; continue; }
  const agg = computePoints(e.rows);
  const truth = aggregateUsageRows(e.rows);
  const existing = byRun.get(runId) ?? [];
  const truthFp = fp(agg.points, truth);
  if (existing.some((l) => fp(l.points, l.usage) === truthFp)) { skippedDup += 1; continue; }
  // 差量：truth − Σexisting（逐组逐字段，夹 0）
  const exGroups = new Map();
  let exPoints = 0;
  for (const l of existing) {
    exPoints += Number(l.points) || 0;
    for (const u of l.usage ?? []) {
      const k = `${u.provider ?? ""}|${u.model ?? ""}`;
      const g = exGroups.get(k) ?? { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, points: 0 };
      g.inputTokens += Number(u.inputTokens) || 0;
      g.cacheReadTokens += Number(u.cacheReadTokens) || 0;
      g.outputTokens += Number(u.outputTokens) || 0;
      g.points += Number(u.points) || 0;
      exGroups.set(k, g);
    }
  }
  const delta = [];
  let deltaTok = 0;
  for (const u of truth) {
    const k = `${u.provider ?? ""}|${u.model ?? ""}`;
    const ex = exGroups.get(k) ?? { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, points: 0 };
    const it = Math.max(0, u.inputTokens - ex.inputTokens);
    const crt = Math.max(0, u.cacheReadTokens - ex.cacheReadTokens);
    const ot = Math.max(0, u.outputTokens - ex.outputTokens);
    const pts = Math.max(0, u.points - ex.points);
    if (it + crt + ot <= 0 && pts <= 0) continue;
    delta.push({ provider: u.provider, model: u.model, inputTokens: it, cacheReadTokens: crt, outputTokens: ot, points: pts });
    deltaTok += it + ot;
  }
  const deltaPoints = Math.max(0, agg.points - exPoints);
  if (delta.length === 0 && deltaPoints <= 0) { skippedDup += 1; continue; }
  plan.push({ ...e, day, delta, deltaTok, deltaPoints, priorRows: existing.length });
}

plan.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : b.deltaTok - a.deltaTok));
console.log(`扫描 db ${scanned} | 运行 ${runMap.size} | 跳过 pre-${CUTOFF} ${skippedPre} | 已入账 ${skippedDup} | 待追加 ${plan.length}`);
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
for (const p of plan) {
  const record = {
    runId: p.runId,
    slug: p.slug,
    attempt: p.attempt,
    validity: null,
    metering: { usage: p.delta, points: p.deltaPoints },
  };
  const now = new Date(p.maxDone || p.maxStart || Date.now());
  if (appendSandboxUsage(p.root, record, { now })) appended += 1;
  else console.log(`  跳过（appendSandboxUsage 判重）: ${p.runId}`);
}
console.log(`已追加 ${appended}/${plan.length} 行 → ${join(homedir(), ".zcode", "cli", "lzy-usage")}`);
