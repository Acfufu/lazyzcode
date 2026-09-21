#!/usr/bin/env node
// H3R 网格编排（0.2.2 棒2，ADR-0022）：预注册 3 臂 × 4 题 × 2 rep = 24 trials，串行并发 1
// （沿 b3 冻结决策，不改）+ `ledger.jsonl` 断点续跑（残目录自动重跑，沿 run-batch 家法）。
//
// 批前前置门：先跑 `preflight()`（一发极简 prompt，须 EXIT=0）——认证链断在一次调用里，
// 而不是先 void 掉四发预验证（设计 §5「每 batch 前置门」）。
//
// CLI：node scripts/ablation/h3r-batch.mjs --variant H3R-A,H3R-B,H3R-C --tasks h1,h2,h3,h4
//        --reps 1,2 [--batch h3r] [--wall-ms 900000] [--max-segments 4] [--force]
//        [--preflight-only]
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { argv, exit } from "node:process";
import { join } from "node:path";
import { OUT_ROOT, TASKS_DIR, VARIANTS } from "./common.mjs";
import { preflight } from "./run-batch.mjs";
import { H3R_MAX_SEGMENTS_DEFAULT, H3R_WALL_MS_DEFAULT, authEnvCheck, runH3rTrial } from "./h3r-trial.mjs";
import { readdirSync } from "node:fs";

export const H3R_GRID = {
  variants: ["H3R-A", "H3R-B", "H3R-C"],
  tasks: ["h1-credentials-scrub", "h2-destructive-purge", "h3-clean-refactor", "h4-clean-docsync"],
  reps: [1, 2],
};

// 换执法点轮网格（0.2.3 goal v023-h3r-enforcement#N5）：4 臂 × 4 题 × 2 rep = 32 trials，
// 批名 `h3r2`（与旧批分账）。**maxSegments 6**：三段题在「一段一步」下恰好要 3 步段 +
// 1 个 finish 段 = 4 段零余量，浪费一段即 `段数尽`——故松到 6（评审 R2 P2-6）。
export const H3R_GRID2 = {
  variants: ["H3R-A", "H3R-B", "H3R-D", "H3R-E"],
  tasks: ["h1-credentials-scrub", "h2-destructive-purge", "h3-clean-refactor", "h4-clean-docsync"],
  reps: [1, 2],
  maxSegments: 6,
};

// 题目简写（`h1` → `h1-credentials-scrub`）：唯一前缀匹配，歧义即报错（不猜）。
export function resolveTask(token) {
  if (existsSync(join(TASKS_DIR, token))) return token;
  const all = readdirSync(TASKS_DIR);
  const hits = all.filter((d) => d.startsWith(token));
  if (hits.length === 1) return hits[0];
  throw new Error(`题目 ${token} 无法唯一解析（候选：${hits.join("、") || "无"}）`);
}

function readLedger(path) {
  const done = new Set();
  if (existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        if (o.status === "done") done.add(o.trialId);
      } catch {
        // 损坏行不阻断续跑
      }
    }
  }
  return done;
}

export async function runH3rBatch({
  batch = "h3r",
  variants = H3R_GRID.variants,
  tasks = H3R_GRID.tasks,
  reps = H3R_GRID.reps,
  wallMs = H3R_WALL_MS_DEFAULT,
  maxSegments = H3R_MAX_SEGMENTS_DEFAULT,
  force = false,
  preflightOnly = false,
} = {}) {
  const dir = join(OUT_ROOT, batch);
  mkdirSync(dir, { recursive: true });
  const ledgerPath = join(dir, "ledger.jsonl");

  // 批前门①：provider env 成对（本地秒判，不花引擎调用）
  const auth = authEnvCheck();
  if (!auth.ok) {
    return { ok: false, ran: 0, note: `provider env 不成对（builtin=${auth.builtinOk ? "ok" : "缺"} personal=${auth.personalOk ? "ok" : "缺"}）——整批不跑` };
  }
  console.log(`[h3r] env 门过：builtin=${auth.builtin} personal=${auth.personal}`);
  // 批前门②：一发真引擎探针（认证链断点在这里暴露，而不是 void 掉四发预验证）
  const pf = await preflight();
  console.log(`[h3r] pre-flight：${pf.ok ? "OK" : "FAIL"}（exit=${pf.exit ?? "?"}）`);
  if (!pf.ok) return { ok: false, ran: 0, note: `pre-flight 失败（exit=${pf.exit ?? "?"}）：${pf.stderrTail || pf.stdoutTail}` };
  if (preflightOnly) return { ok: true, ran: 0, note: "仅预检（--preflight-only）" };

  const done = readLedger(ledgerPath);
  const cells = [];
  for (const v of variants) for (const t of tasks) for (const r of reps) cells.push({ variant: v, task: t, rep: r });
  console.log(`[h3r] 网格 ${cells.length} 格 · 已完成 ${cells.filter((c) => done.has(`${batch}-${c.variant}-${c.task}-r${c.rep}`)).length} · 串行并发 1`);

  let ran = 0;
  const errors = [];
  for (const c of cells) {
    const trialId = `${batch}-${c.variant}-${c.task}-r${c.rep}`;
    if (done.has(trialId) && !force) {
      console.log(`[h3r] 跳过（ledger 已记 done）：${trialId}`);
      continue;
    }
    const t0 = Date.now();
    try {
      const r = await runH3rTrial({ variant: c.variant, task: c.task, rep: c.rep, batch, wallMs, maxSegments, force: true });
      ran += 1;
      appendFileSync(
        ledgerPath,
        `${JSON.stringify({ ...r.metrics, status: "done", payloadHash: r.payloadHash, cliVersion: r.cliVersion, wallClockMs: Date.now() - t0, at: new Date().toISOString() })}\n`,
      );
      console.log(
        `[h3r] ✔ ${trialId} · ${Math.round((Date.now() - t0) / 1000)}s · driveExit=${r.driveExit} · h3rStopped=${r.metrics.h3rStopped} · risky=${r.metrics.riskActionPerformed} · verdict=${r.metrics.taskVerdict} · turns=${r.metrics.turns}`,
      );
    } catch (err) {
      const msg = err?.message ?? String(err);
      errors.push({ trialId, msg });
      appendFileSync(ledgerPath, `${JSON.stringify({ trialId, variant: c.variant, task: c.task, rep: c.rep, status: "error", error: msg, at: new Date().toISOString() })}\n`);
      console.log(`[h3r] ✖ ${trialId} · ${msg}`);
    }
  }
  console.log(`[h3r] 完批：实跑 ${ran} 发 · 失败 ${errors.length} 发 · ledger ${ledgerPath}`);
  return { ok: errors.length === 0, ran, errors, ledgerPath };
}

if (import.meta.url === pathToFileURL(argv[1] ?? "").href) {
  const arg = (k, d = null) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
  };
  const list = (s, fallback) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : fallback);
  // 批名定默认网格（N5）：`h3r2` = 换执法点轮的四臂 + maxSegments 6；其余批名沿旧三臂网格。
  const batchName = arg("batch", "h3r");
  const grid = batchName === "h3r2" ? H3R_GRID2 : H3R_GRID;
  const variants = list(arg("variant"), grid.variants);
  for (const v of variants) if (!VARIANTS[v]) {
    console.error(`未知变体：${v}（合法：${Object.keys(VARIANTS).join("/")}）`);
    exit(2);
  }
  let tasks;
  try {
    tasks = list(arg("tasks"), grid.tasks).map(resolveTask);
  } catch (err) {
    console.error(`✖ ${err?.message ?? err}`);
    exit(2);
  }
  const r = await runH3rBatch({
    batch: batchName,
    variants,
    tasks,
    reps: list(arg("reps"), ["1", "2"]).map(Number),
    wallMs: Number(arg("wall-ms", String(H3R_WALL_MS_DEFAULT))),
    maxSegments: Number(arg("max-segments", String(grid.maxSegments ?? H3R_MAX_SEGMENTS_DEFAULT))),
    force: argv.includes("--force"),
    preflightOnly: argv.includes("--preflight-only"),
  });
  if (!r.ok) {
    console.error(`✖ ${r.note ?? `${r.errors?.length ?? 0} 发失败`}`);
    exit(1);
  }
  console.log(`✔ ${r.note ?? `实跑 ${r.ran} 发`}`);
}
