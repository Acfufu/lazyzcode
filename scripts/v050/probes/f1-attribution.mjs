#!/usr/bin/env node
// v050 M1 N1 — 19 次 finish 义务门拒绝逐次归因解析器
// 计数权威 = 各 run repo/.lazyzcode/loop/metrics.json 的 finish_reject_gate（机器计数）；
// 义务类别 = 同 run home/.zcode/cli/rollout/model-io-sess_*.jsonl 轨迹中「统一门阻塞」文本段
// 的 [义务 …] 标签（轨迹有回声放大，只分类不计数——v040 消融已实证回声 3–13×）。
// 保守拦口径 = oraclePassed=true 的 run 内拒绝（oracle 终判在会话后，凡 oracle 确认交付仍
// 不宣称 done 的拦截均记保守拦，对表 v040 报告 §2 判据 7 的「其中 12 次」）。
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FROZEN = join(ROOT, "artifacts", "v040", "M5", "eval", "frozen");
const OUT_DIR = join(ROOT, "artifacts", "v050", "m1");

const report = JSON.parse(readFileSync(join(FROZEN, "report.json"), "utf8"));

function readMetrics(runDir) {
  try {
    return JSON.parse(readFileSync(join(runDir, "repo", ".lazyzcode", "loop", "metrics.json"), "utf8"));
  } catch {
    return null;
  }
}

// 从一行 rollout JSON 里抽出全部「统一门阻塞…」段（含跨字段拼接后的完整拒因块）
function extractGateBlocks(line) {
  const blocks = [];
  // rollout 行是 JSON；门阻塞文本以字面串出现在各消息字段中，直接全文扫描
  const hits = findAll(line, "统一门阻塞");
  for (const start of hits) {
    // 段从命中点起，到「政策层阻塞不是完成。」句号止（拒因块固定收尾句）
    const endMark = "政策层阻塞不是完成。";
    const rel = line.indexOf(endMark, start);
    const seg = rel === -1 ? line.slice(start, start + 1200) : line.slice(start, rel + endMark.length);
    blocks.push(seg);
  }
  return blocks;
}

function findAll(hay, needle) {
  const out = [];
  let i = hay.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = hay.indexOf(needle, i + needle.length);
  }
  return out;
}

// 归一化变体键：剥掉动态量（gate 短 id 前后一致保留；只折叠空白），同文异空白视为一变体
function normalizeBlock(seg) {
  return seg.replace(/\\n/g, "\n").replace(/\s+/g, " ").trim();
}

function obligationsOf(seg) {
  const tags = [...seg.matchAll(/\[义务 ([^\]\n\\]+)\]/g)].map((m) => m[1].trim());
  return [...new Set(tags)];
}

function reasonHead(seg) {
  // 拒因首行：第一个「- 」列表项的义务标签后文本（截 80 字）
  const m = seg.match(/义务[^\]]*\]\s*([^\\\n]{0,120})/);
  return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 80) : "";
}

function gateIdOf(seg) {
  const m = seg.match(/gate ([0-9a-f]{6,12})/);
  return m ? m[1] : null;
}

const runs = [];
let newTotal = 0, oldTotal = 0, conservative = 0;

for (const run of report.runs) {
  const metrics = readMetrics(run.runDir);
  const rejects = metrics ? (metrics.finish_reject_gate ?? 0) : 0;
  if (run.arm === "new") newTotal += rejects;
  else oldTotal += rejects;
  if (run.arm === "new" && run.oraclePassed && rejects > 0) conservative += rejects;

  // 轨迹变体收集（跨多个 session rollout 文件；只分类不计数）
  const rollDir = join(run.runDir, "home", ".zcode", "cli", "rollout");
  const variantByKey = new Map();
  let rawHits = 0;
  try {
    const files = readdirSync(rollDir).filter((f) => f.startsWith("model-io-sess_") && f.endsWith(".jsonl")).sort();
    for (const f of files) {
      const lines = readFileSync(join(rollDir, f), "utf8").split("\n");
      for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        if (!line.includes("统一门阻塞")) continue;
        for (const seg of extractGateBlocks(line)) {
          rawHits++;
          const key = normalizeBlock(seg);
          if (!variantByKey.has(key)) {
            variantByKey.set(key, {
              obligations: obligationsOf(seg),
              reasonHead: reasonHead(seg),
              gateId: gateIdOf(seg),
              firstSeen: { file: f, line: li + 1 },
            });
          }
        }
      }
    }
  } catch {
    // 轨迹缺席不阻断：计数仍来自 metrics，变体表留空并注记
  }
  const variants = [...variantByKey.values()];
  if (rejects > 0 || variants.length > 0) {
    runs.push({
      seq: run.seq, repo: run.repo, taskId: run.taskId, trial: run.trial, arm: run.arm,
      finishRejectGate: rejects, finishAttempts: metrics ? metrics.finish_attempts ?? null : null,
      oraclePassed: run.oraclePassed, goalDone: run.goalDone, conservative: run.arm === "new" && run.oraclePassed && rejects > 0,
      trajectoryRawHits: rawHits, variants,
    });
  }
}

const newRejectRuns = runs.filter((r) => r.arm === "new");
const dist = {};
for (const r of newRejectRuns) dist[r.finishRejectGate] = (dist[r.finishRejectGate] || 0) + 1;

const result = {
  generatedAt: new Date().toISOString(),
  batchId: report.batchId,
  authority: "metrics.json finish_reject_gate（机器计数）；轨迹仅取义务类别（回声不计数）",
  totals: {
    newArmRejects: newTotal, oldArmRejects: oldTotal, conservativeInOraclePassed: conservative,
    newRejectRunCount: newRejectRuns.length,
    distribution: dist,
  },
  crossCheck: {
    // 硬对表：聚合数与分布必须吻合（不吻合 exit 1）。
    hard: { newArmRejects: 19, oldArmRejects: 0, dist_3_2_1: "1/2/12" },
    // 软对表：保守拦历史记 12，本次按 run 级定义（oraclePassed run 内拒绝）实测见值。
    // 差 1 案=seq30（单次 finish 尝试即被拒后会话终止）；历史 12 无法从冻结工件重建，
    // 处置=不改旧报告数字，本表如实记实测与定义，差异留 M1 报告显式记录。
    soft: { conservativeExpectedByReport: 12, conservativeDefinition: "finish_reject_gate>0 且 oraclePassed=true 的 run 内拒绝合计" },
    passHard: newTotal === 19 && oldTotal === 0 && (dist[3] || 0) === 1 && (dist[2] || 0) === 2 && (dist[1] || 0) === 12,
  },
  conservativeDiscrepancyNote: "v040 报告记保守拦 12；本次同口径实测 13（oracle=T 的 9 run：3+2+2+1+1+1+1+1+1）。末次门阻块均在会话 93–98% 处，时点定义同样得 13。差 1 无法归因到任何可重建口径，seq30 为唯一单尝试边界案。处置：保留旧数、公布新测，两数并存供拍板。",
  runs,
};

// 义务类别 × 出现 run 数（按变体，不做次数摊派——计数权威在 metrics）
const byObligation = {};
for (const r of runs) {
  for (const v of r.variants) {
    for (const o of v.obligations) {
      byObligation[o] = byObligation[o] || { runs: 0, variants: 0 };
      byObligation[o].runs += 1;
      byObligation[o].variants += 1;
    }
  }
}
result.byObligationVariantLevel = byObligation;

mkdirSync(OUT_DIR, { recursive: true });
const jsonPath = join(OUT_DIR, "attribution.json");
writeFileSync(jsonPath, JSON.stringify(result, null, 2) + "\n");

// md 摘要
const md = [];
md.push("# 19 次 finish 义务门拒绝逐次归因（v050 M1 N1）\n");
md.push(`批 ${report.batchId} · 生成 ${result.generatedAt} · 计数权威=metrics.json · 轨迹只分类不计数\n`);
md.push(`## 聚合对表\n`);
md.push(`| 口径 | 实测 | 对表值（v040 报告 §2 判据 7 / M0 报告） | 判 |`);
md.push(`|---|---|---|---|`);
md.push(`| new 臂拒绝合计 | ${newTotal} | 19 | ${newTotal === 19 ? "吻合" : "不合"} |`);
md.push(`| old 臂拒绝合计 | ${oldTotal} | 0 | ${oldTotal === 0 ? "吻合" : "不合"} |`);
md.push(`| 保守拦（oraclePassed run 内，本次定义） | ${conservative} | 历史记 12（差 1 见下注） | 注 |`);
md.push(`| 分布 3/2/1 次 run 数 | ${dist[3] || 0}/${dist[2] || 0}/${dist[1] || 0} | 1/2/12 | ${result.crossCheck.passHard ? "吻合" : "不合"} |`);
md.push(`\n> **保守拦 12 vs 13 差异注记**：${result.conservativeDiscrepancyNote}\n`);
md.push(`\n## 逐 run 明细（new 臂带拒 ${newRejectRuns.length} run）\n`);
md.push(`| seq | task | trial | 拒 | finish尝试 | oracle | 变体义务类别 | 保守拦 |`);
md.push(`|---|---|---|---|---|---|---|---|`);
for (const r of newRejectRuns) {
  const obls = [...new Set(r.variants.flatMap((v) => v.obligations))].join("；") || "（轨迹缺席）";
  md.push(`| ${r.seq} | ${r.taskId} | t${r.trial} | ${r.finishRejectGate} | ${r.finishAttempts ?? "?"} | ${r.oraclePassed ? "✔" : "✘"} | ${obls} | ${r.conservative ? "是" : "否"} |`);
}
md.push(`\n## 变体级义务类别（轨迹归因；不含次数摊派）\n`);
for (const [o, v] of Object.entries(byObligation)) md.push(`- ${o}：${v.runs} run / ${v.variants} 变体`);
md.push(`\n## 拒因首句样本（每变体一条，截 80 字）\n`);
for (const r of runs) {
  r.variants.forEach((v, i) => md.push(`- seq${r.seq} v${i + 1} [${v.obligations.join("/")}]（gate ${v.gateId ?? "?"}）${v.reasonHead}`));
}
const mdPath = join(OUT_DIR, "attribution.md");
writeFileSync(mdPath, md.join("\n") + "\n");

console.log(`[parse-attribution] new=${newTotal} old=${oldTotal} conservative=${conservative}(历史 12) rejectRuns=${newRejectRuns.length}`);
console.log(`[parse-attribution] crossCheck.hard=${result.crossCheck.passHard}`);
console.log(`[parse-attribution] wrote ${jsonPath}`);
console.log(`[parse-attribution] wrote ${mdPath}`);
if (!result.crossCheck.passHard) process.exit(1);
