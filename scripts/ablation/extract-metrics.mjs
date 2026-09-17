#!/usr/bin/env node
// 指标抽取（ADR-0015，goal true-ablation-full-flow#N4）：对单 trial 目录归集 metrics.json
// ——hidden verdict 过/挂、假完成（finish 达成且 verdict 挂）、轮次与 token（usage.*）、
// Stop 续跑次数、finish_reject 计数（loop/metrics.json 现成字段）、attempt note 数、
// 限流脏窗事件计数（分层标记用）。只读归档工件，绝不伪造缺席字段（缺席=null 如实记账）。
//
// CLI：node scripts/ablation/extract-metrics.mjs --trial <trialId>
// 库：  import { extractMetrics } from "./extract-metrics.mjs"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";
import { OUT_ROOT, trialPaths } from "./common.mjs";

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function extractMetrics(trialId) {
  const p = trialPaths(trialId);
  const meta = readJson(join(p.dir, "trial-meta.json")) ?? {};
  const summary = readJson(p.engineSummary);
  const verdict = readJson(join(p.dir, "verdict.json"));
  const goal = readJson(join(p.scratch, ".lazyzcode", "loop", "goal.json"));

  // Stop 续跑次数：跨会话文件取 max（每会话各自 ≤2，上限口径=最重会话）。
  let stopContinues = null;
  try {
    for (const f of readdirSync(join(p.scratch, ".lazyzcode", "loop", "sessions"))) {
      if (!f.endsWith(".json")) continue;
      const s = readJson(join(p.scratch, ".lazyzcode", "loop", "sessions", f));
      if (s && Number.isFinite(s.continues)) {
        stopContinues = Math.max(stopContinues ?? 0, s.continues);
      }
    }
  } catch {
    // 目录缺席=null（B 变体没有插件面，属预期形态）
  }

  // finish_reject 计数：loop/metrics.json 现成字段（finish_attempts/finish_reject_*）。
  const loopMetrics = readJson(join(p.scratch, ".lazyzcode", "loop", "metrics.json"));
  const finishReject = loopMetrics
    ? Object.fromEntries(
        Object.entries(loopMetrics)
          .filter(([k]) => k.startsWith("finish_"))
          .map(([k, v]) => [k, v]),
      )
    : null;

  // attempt note 数：计划文件里换路注记行（语法见 zw SKILL §3）。
  let attemptNotes = null;
  try {
    for (const f of readdirSync(join(p.scratch, ".lazyzcode", "plans"))) {
      if (!f.endsWith(".md")) continue;
      const body = readFileSync(join(p.scratch, ".lazyzcode", "plans", f), "utf8");
      attemptNotes = (attemptNotes ?? 0) + (body.match(/^- \[!\] attempt /gm)?.length ?? 0);
    }
  } catch {
    attemptNotes = attemptNotes ?? 0;
  }

  // 限流脏窗事件：引擎 stdout 原文计数（429/rate_limited/1302 族；分层标记不混入对比）。
  let engineStdout = "";
  try {
    engineStdout = readFileSync(p.engineStdout, "utf8");
  } catch {
    // 缺席=0 计数照记
  }
  const rateLimitedEvents =
    (engineStdout.match(/rate_limited/g)?.length ?? 0) + (engineStdout.match(/\b1302\b/g)?.length ?? 0);

  const verdictPass = verdict ? verdict.exit === 0 : null;
  const finishAchieved = goal ? goal.status === "done" : false;

  const m = {
    trialId,
    variant: meta.variant ?? null,
    task: meta.task ?? null,
    rep: meta.rep ?? null,
    verdict: verdictPass === null ? null : verdictPass ? "pass" : "fail",
    finishAchieved,
    fakeComplete: finishAchieved && verdictPass === false,
    sessionId: summary?.sessionId ?? null,
    turns: summary?.projection?.turnCount ?? null,
    contextUsed: summary?.projection?.contextUsed ?? null,
    usage: summary?.usage ?? null,
    stopContinues,
    finishReject,
    attemptNotes,
    rateLimitedEvents,
    engineExit: meta.engineExit ?? null,
    engineKilled: meta.engineKilled ?? null,
  };
  mkdirSync(p.dir, { recursive: true });
  writeFileSync(p.metrics, `${JSON.stringify(m, null, 2)}\n`);
  return m;
}

// metrics.json 必填字段面（F4「metrics 零缺字段」的机器口径：verdict/finishAchieved/
// fakeComplete/sessionId/turns/usage/stopContinues/attemptNotes 均不得为 undefined）。
export const METRIC_REQUIRED_KEYS = [
  "trialId",
  "variant",
  "task",
  "rep",
  "verdict",
  "finishAchieved",
  "fakeComplete",
  "sessionId",
  "turns",
  "usage",
  "stopContinues",
  "finishReject",
  "attemptNotes",
  "rateLimitedEvents",
];

export function missingMetricKeys(m) {
  return METRIC_REQUIRED_KEYS.filter((k) => m[k] === undefined);
}

if (import.meta.url === `file://${argv[1]}`) {
  try {
    const i = argv.indexOf("--trial");
    if (i === -1 || !argv[i + 1]) {
      console.error("用法：--trial <trialId>");
      exit(2);
    }
    const m = extractMetrics(argv[i + 1]);
    console.log(JSON.stringify(m, null, 2));
    const missing = missingMetricKeys(m);
    console.log(`[extract-metrics] ${argv[i + 1]}：缺失字段 ${missing.length === 0 ? "无" : missing.join(",")}`);
    exit(0);
  } catch (e) {
    console.error(`[extract-metrics] ${e?.message ?? e}`);
    exit(2);
  }
}
