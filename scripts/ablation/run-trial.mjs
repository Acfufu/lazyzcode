#!/usr/bin/env node
// 单 trial 编排（ADR-0015，goal true-ablation-full-flow#N4）：全新 scratch 仓 + 隔离
// trial HOME → 变体装配（install-variant）→ 引擎 headless 会话（prompt 以 zw 起头触发
// 注入；β 类任务按 legs.json 多 leg --resume 接续）→ 五类工件归档 → hidden verdict →
// metrics.json。trial 循环 tier=heavy 由 brief 措辞承载（全纪律面在役，闸门消融才有意义）。
// 全程串行（并发上限 1，冻结决策）；工件只写 artifacts/ablation/<trialId>/（gitignored）。
//
// CLI：node scripts/ablation/run-trial.mjs --variant <A-F> --task <id> [--rep 1] [--batch b1]
//        [--timeout-ms <n>] [--force]
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { argv, exit } from "node:process";
import { join } from "node:path";
import { OUT_ROOT, TASKS_DIR, trialPaths, VARIANTS, parseEngineSummary } from "./common.mjs";
import { installVariant } from "./install-variant.mjs";
import { spawnEngine } from "./spawn-engine.mjs";
import { extractMetrics } from "./extract-metrics.mjs";

// 无人值守 wake 模板（zw SKILL Unattended 节同文）：β 类任务第二 leg 的续跑提示词。
const WAKE_PROMPT = "zw 继续（无人值守：只推进 executing 目标；无目标或 planning 态则干净退出并说明；不做完不停）";

function git(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8", shell: false, timeout: 30_000 });
}

function composePrompt(taskDir, legDef) {
  if (legDef?.wake) return WAKE_PROMPT;
  const brief = readFileSync(join(taskDir, "brief.md"), "utf8").trimEnd();
  return /^zw(\s|$)/.test(brief) ? brief : `zw ${brief}`;
}

// 五类工件归档：缺席面留显式标记（B 变体无 .lazyzcode 属预期形态，标记而非静默缺席）。
function archiveArtifacts(p, summaries) {
  // ① 引擎 stdout 全量（多 leg 带 leg 分隔标记）+ ② 摘要 JSON（多 leg 汇总 usage/turns）。
  const last = summaries.at(-1);
  const usageTotals = {};
  for (const s of summaries) {
    for (const [k, v] of Object.entries(s?.usage ?? {})) {
      if (Number.isFinite(v)) usageTotals[k] = (usageTotals[k] ?? 0) + v;
    }
  }
  const summaryDoc = summaries.length === 1
    ? summaries[0]
    : {
        sessionId: last?.sessionId ?? null,
        projection: last?.projection ?? null,
        usage: usageTotals,
        legs: summaries,
      };
  writeFileSync(p.engineSummary, `${JSON.stringify(summaryDoc, null, 2)}\n`);

  // ③ .lazyzcode 树拷贝（trial 会话的循环态/账本/证据全貌）。
  rmSync(p.lazyzcodeTree, { recursive: true, force: true });
  if (existsSync(join(p.scratch, ".lazyzcode"))) {
    cpSync(join(p.scratch, ".lazyzcode"), p.lazyzcodeTree, { recursive: true });
  } else {
    mkdirSync(p.lazyzcodeTree, { recursive: true });
    writeFileSync(join(p.lazyzcodeTree, ".absent"), "无 .lazyzcode（B 变体未装插件，预期形态）\n");
  }

  // ④ scratch git log（含 status 面：未提交残留也是行为观测面）。
  const log = git(p.scratch, ["log", "--oneline", "--stat", "-50"]);
  const st = git(p.scratch, ["status", "--porcelain"]);
  writeFileSync(p.gitLog, `$ git log --oneline --stat -50\n${log.stdout ?? ""}\n$ git status --porcelain\n${st.stdout ?? ""}\n`);

  // ⑤ rollout jsonl（trial HOME 下该会话的逐轮模型 IO；缺席=显式 absent 行不伪造）。
  let copied = false;
  for (const sid of [last?.sessionId].filter(Boolean)) {
    const src = join(p.home, ".zcode", "cli", "rollout", `model-io-${sid}.jsonl`);
    if (existsSync(src)) {
      cpSync(src, p.rollout);
      copied = true;
    }
  }
  if (!copied) writeFileSync(p.rollout, `{"absent":true}\n`);
}

function runVerdict(p, taskDir) {
  const script = join(taskDir, "verdict", "run.sh");
  const r = spawnSync("bash", [script], {
    cwd: p.scratch,
    encoding: "utf8",
    timeout: 120_000,
    shell: false,
    env: { PATH: process.env.PATH, HOME: p.home, USERPROFILE: p.home },
  });
  const out = `exit=${r.status ?? "?"}\n${r.stdout ?? ""}${r.stderr ?? ""}`;
  writeFileSync(p.verdictStdout, out);
  writeFileSync(join(p.dir, "verdict.json"), `${JSON.stringify({ exit: r.status, at: Date.now() }, null, 2)}\n`);
  return r.status;
}

export async function runTrial({
  variant,
  task,
  rep = 1,
  batch = "b1",
  timeoutMs = null,
  force = false,
}) {
  const def = VARIANTS[variant];
  const taskDir = join(TASKS_DIR, task);
  if (!def) throw new Error(`未知变体：${variant}`);
  if (!existsSync(taskDir)) throw new Error(`任务目录不存在：${taskDir}（N5 落任务集）`);
  const trialId = `${batch}-${variant}-${task}-r${rep}`;
  const p = trialPaths(trialId);
  if (existsSync(p.dir) && !force) throw new Error(`trial 目录已存在：${p.dir}（重跑加 --force）`);
  rmSync(p.dir, { recursive: true, force: true });
  mkdirSync(p.scratch, { recursive: true });
  mkdirSync(p.home, { recursive: true });

  // 装配 scratch：全新仓 + 任务种子（不进 verdict 面——verdict 只活在任务目录）。
  git(p.scratch, ["init", "-q"]);
  git(p.scratch, ["config", "user.email", "ablation@trial"]);
  git(p.scratch, ["config", "user.name", "ablation-trial"]);
  const seedDir = join(taskDir, "seed");
  if (existsSync(seedDir)) {
    for (const f of readdirSync(seedDir)) cpSync(join(seedDir, f), join(p.scratch, f), { recursive: true });
  }
  git(p.scratch, ["add", "-A"]);
  git(p.scratch, ["commit", "-qm", "seed"]);

  // 变体装配（B=裸引擎跳过；install 自带 plugins enable）。
  const install = installVariant(variant, { home: p.home });

  // legs 编排：任务 legs.json 显式多 leg（β 跨会话题），缺省单 leg。
  const legsPath = join(taskDir, "legs.json");
  const legs = existsSync(legsPath) ? JSON.parse(readFileSync(legsPath, "utf8")).legs : [{}];

  const summaries = [];
  const stdoutParts = [];
  let resume = null;
  let engineExit = null;
  let engineKilled = false;
  for (const [i, legDef] of legs.entries()) {
    const prompt = composePrompt(taskDir, legDef);
    const r = await spawnEngine({
      home: p.home,
      cwd: p.scratch,
      prompt,
      resume,
      timeoutMs: legDef.timeoutMs ?? timeoutMs, // β leg1 短墙钟=必断（--max-turns 0.16.5 实拒）
      extraEnv: def.switches,
    });
    stdoutParts.push(`===== leg ${i + 1}${resume ? ` (resume ${resume})` : ""} exit=${r.code ?? "?"} signal=${r.signal ?? "-"} =====\n${r.stdout}\n[stderr]\n${r.stderr}\n`);
    engineExit = r.code;
    engineKilled = engineKilled || r.killed;
    const s = parseEngineSummary(r.stdout);
    if (s) summaries.push(s);
    resume = s?.sessionId ?? null;
    if (!r.ok && !s) break; // 引擎炸且无摘要：后续 leg 无从续起，如实截断
  }
  writeFileSync(p.engineStdout, stdoutParts.join("\n"));

  archiveArtifacts(p, summaries);

  const verdictExit = existsSync(join(taskDir, "verdict", "run.sh")) ? runVerdict(p, taskDir) : null;

  writeFileSync(
    join(p.dir, "trial-meta.json"),
    `${JSON.stringify({ trialId, batch, variant, task, rep, install: install.installed, engineExit, engineKilled, legs: legs.length, at: new Date().toISOString() }, null, 2)}\n`,
  );
  const metrics = extractMetrics(trialId);
  return { trialId, verdictExit, metrics };
}

if (import.meta.url === `file://${argv[1]}`) {
  try {
    const a = { rep: 1, batch: "b1" };
    for (let i = 2; i < argv.length; i++) {
      if (argv[i] === "--variant") a.variant = argv[++i];
      else if (argv[i] === "--task") a.task = argv[++i];
      else if (argv[i] === "--rep") a.rep = Number(argv[++i]);
      else if (argv[i] === "--batch") a.batch = argv[++i];
      else if (argv[i] === "--timeout-ms") a.timeoutMs = Number(argv[++i]);
      else if (argv[i] === "--force") a.force = true;
      else throw new Error(`未知参数：${argv[i]}`);
    }
    if (!a.variant || !a.task) {
      console.error("用法：--variant <A-F> --task <id> [--rep n] [--batch b] [--timeout-ms n] [--force]");
      exit(2);
    }
    const r = await runTrial(a);
    console.log(`[run-trial] ${r.trialId} verdict=${r.verdictExit ?? "n/a"} fakeComplete=${r.metrics.fakeComplete}`);
    exit(0);
  } catch (e) {
    console.error(`[run-trial] ${e?.message ?? e}`);
    exit(2);
  }
}
