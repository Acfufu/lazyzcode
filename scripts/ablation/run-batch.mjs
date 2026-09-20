#!/usr/bin/env node
// 批调度（ADR-0015，goal true-ablation-full-flow#N4）：pre-flight 认证探针（一发
// "reply with OK"，EXIT≠0 整批不跑——绝不假跑）→ 串行调度（并发上限 1，冻结决策）
// → 断点续跑（ledger.jsonl 已记 done 的 trial 跳过）→ 每 trial 一行 JSONL 账本，
// 429 脏窗 trial 分层标记（rateLimitedEvents>0 → dirty429=true，分析面不混入对比）。
// 账本行带 payloadHash（ADJ-74：这批量的是哪份载荷）；残目录自动重跑（ADJ-75②）。
//
// CLI：node scripts/ablation/run-batch.mjs --batch b1 [--variants A,B,C,D,E,F]
//        [--tasks t1-plain-fix,t3-alpha-fake-complete,t3-beta-cross-session,t3-delta-dirty-tree]
//        [--reps 1] [--preflight-only] [--force-trial]
// b2 单元格模式（非全网格）：--cells <v:task[:hint],…>（与 --variants/--tasks 互斥；
// hint=heavy|light 透传 run-trial tier-hint；账本行带 tierHint 字段供 tier 轴归因）。
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { argv, exit } from "node:process";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { OUT_ROOT, VARIANTS } from "./common.mjs";
import { spawnEngine } from "./spawn-engine.mjs";
import { runTrial, trialDirPresent } from "./run-trial.mjs";

export async function preflight({ timeoutMs = 120_000 } = {}) {
  const home = mkdtempSync(join(tmpdir(), "lzy-abl-pf-"));
  const r = await spawnEngine({
    home,
    cwd: home,
    prompt: "reply with exactly OK",
    timeoutMs,
  });
  const ok = r.ok && /OK/.test(r.stdout);
  rmSync(home, { recursive: true, force: true });
  return { ok, exit: r.code, stdoutTail: r.stdout.slice(-400), stderrTail: r.stderr.slice(-400) };
}

function readLedger(batch) {
  const p = join(OUT_ROOT, batch, "ledger.jsonl");
  const done = new Set();
  if (existsSync(p)) {
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        if (o.status === "done") done.add(o.trialId);
      } catch {
        // 损坏行不阻断续跑（下一行照读）
      }
    }
  }
  return { path: p, done };
}

export async function runBatch({
  batch = "b1",
  variants = ["A", "B", "C", "D", "E", "F"],
  tasks,
  cells = null,
  reps = 1,
  preflightOnly = false,
  forceTrial = false,
  timeoutMs = null,
}) {
  // reps 形态门（ADJ-75③）：`--reps abc`/`--reps 0` 旧行为是 Number()→NaN，`rep<=NaN` 恒假
  // 使调度循环一发不发、命令静默 exit 0——空跑被当成跑过。正整数以外一律用法错。
  if (!Number.isInteger(reps) || reps <= 0) {
    throw new Error(`runBatch：--reps 必须为正整数（收到 ${JSON.stringify(reps)}）`);
  }
  // cells 模式（b2）：非全网格的预注册单元格序列；grid 模式维持原语义。
  if (!cells && (!tasks || tasks.length === 0)) {
    throw new Error("runBatch：tasks 必填（N5 任务集 id）");
  }
  // 调度单元：cells 优先（v:task[:hint] 预注册序列），否则 variants×tasks×reps 全网格。
  // 两类都归一成同一 units 形状——grid 行的 hint 同样取「显式 ?? 变体表缺省」（ADJ-75④）：
  // 旧 grid 分支硬写 hint:null，J 臂在 grid 下的 ledger 行便丢了 tierHint，tier 轴失明。
  // 形态校验在 preflight 之前（坏 cell 不烧引擎调用）。
  const units = cells
    ? cells.map((c) => {
        const [variant, task, hint] = String(c).split(":");
        if (!variant || !task) throw new Error(`runBatch：cells 形态非法：${c}（<v:task[:hint]>）`);
        if (!VARIANTS[variant]) throw new Error(`runBatch：cells 未知变体：${c}`);
        if (hint && hint !== "heavy" && hint !== "light") throw new Error(`runBatch：cell hint 非法：${c}`);
        return { variant, task, hint: hint ?? VARIANTS[variant]?.tierHint ?? null };
      })
    : variants.flatMap((variant) => {
        if (!VARIANTS[variant]) throw new Error(`runBatch：未知变体：${variant}`);
        return tasks.map((task) => ({ variant, task, hint: VARIANTS[variant]?.tierHint ?? null }));
      });
  mkdirSync(join(OUT_ROOT, batch), { recursive: true });

  const pf = await preflight();
  if (!pf.ok) {
    return { ok: false, stage: "preflight", pf, ran: 0 };
  }
  if (preflightOnly) return { ok: true, stage: "preflight-only", pf, ran: 0 };

  const { path: ledgerPath, done } = readLedger(batch);
  let ran = 0;
  let reran = 0;
  const runOne = async ({ variant, task, hint }) => {
    for (let rep = 1; rep <= reps; rep++) {
      const trialId = `${batch}-${variant}-${task}-r${rep}`;
      if (done.has(trialId)) {
        console.log(`[run-batch] 跳过（账本已记）：${trialId}`);
        continue;
      }
      // 残目录自动 force（ADJ-75②）：ledger 无 done 行却有 trial 目录=上轮中途死；重跑幂等，
      // 残工件本是死样本（trialId 是主键，改名追加会让同格样本散键）——见 run-trial 注释。
      const stray = trialDirPresent(trialId);
      const force = forceTrial || stray;
      if (stray) reran++;
      console.log(`[run-batch] 开跑：${trialId}${hint ? ` [tier:${hint}]` : ""}${stray ? "（残目录：自动重跑）" : ""}`);
      const base = { trialId, variant, task, rep, ...(hint ? { tierHint: hint } : {}) };
      try {
        const r = await runTrial({ variant, task, rep, batch, timeoutMs, force, tierHint: hint });
        appendFileSync(
          ledgerPath,
          `${JSON.stringify({ ...base, status: "done", verdict: r.metrics.verdict, fakeComplete: r.metrics.fakeComplete, dirty429: (r.metrics.rateLimitedEvents ?? 0) > 0, payloadHash: r.payloadHash ?? null, at: new Date().toISOString() })}\n`,
        );
        ran++;
      } catch (e) {
        appendFileSync(
          ledgerPath,
          `${JSON.stringify({ ...base, status: "error", error: String(e?.message ?? e).slice(0, 300), at: new Date().toISOString() })}\n`,
        );
        console.error(`[run-batch] trial 失败已记账：${trialId} — ${e?.message ?? e}`);
      }
    }
  };
  for (const u of units) await runOne(u);
  return { ok: true, stage: "batch", pf, ran, reran, ledgerPath };
}

if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  try {
    const a = { batch: "b1", variants: "A,B,C,D,E,F", reps: 1 };
    for (let i = 2; i < argv.length; i++) {
      if (argv[i] === "--batch") a.batch = argv[++i];
      else if (argv[i] === "--variants") a.variants = argv[++i];
      else if (argv[i] === "--tasks") a.tasks = argv[++i];
      else if (argv[i] === "--cells") a.cells = argv[++i];
      else if (argv[i] === "--reps") a.reps = Number(argv[++i]);
      else if (argv[i] === "--preflight-only") a.preflightOnly = true;
      else if (argv[i] === "--force-trial") a.forceTrial = true;
      else if (argv[i] === "--timeout-ms") a.timeoutMs = Number(argv[++i]);
      else throw new Error(`未知参数：${argv[i]}`);
    }
    if (a.cells && a.tasks) {
      console.error("用法冲突：--cells 与 --tasks 互斥（cells=非全网格单元格模式）");
      exit(2);
    }
    if (!a.tasks && !a.cells) {
      console.error("用法：--tasks <id,id,…> | --cells <v:task[:hint],…> [--batch b1] [--variants A,B,…] [--reps n] [--preflight-only] [--force-trial]");
      exit(2);
    }
    // --reps 前置形态门（ADJ-75③）：NaN/0/小数在此拦下并打用法（runBatch 内还有同一道门，
    // 覆盖程序化调用）——绝不静默空跑。回显用户原字面量（Number() 后 NaN 会打印成 null）。
    if (!Number.isInteger(a.reps) || a.reps <= 0) {
      const raw = argv.includes("--reps") ? argv[argv.indexOf("--reps") + 1] : a.reps;
      console.error(`用法：--reps 必须为正整数（收到 ${JSON.stringify(raw)}）`);
      exit(2);
    }
    const r = await runBatch({
      batch: a.batch,
      variants: a.variants.split(","),
      tasks: a.tasks ? a.tasks.split(",") : undefined,
      cells: a.cells ? a.cells.split(",") : null,
      reps: a.reps,
      preflightOnly: a.preflightOnly,
      forceTrial: a.forceTrial,
      timeoutMs: a.timeoutMs,
    });
    console.log(`[run-batch] stage=${r.stage} ok=${r.ok} ran=${r.ran ?? 0}${r.reran ? `（残目录自动重跑 ${r.reran}）` : ""}`);
    if (!r.ok) {
      console.error(`[run-batch] pre-flight 失败——整批不跑（绝不假跑）。stdout 尾：${r.pf.stdoutTail}`);
      console.error(`[run-batch] stderr 尾：${r.pf.stderrTail}`);
    }
    exit(r.ok ? 0 : 1);
  } catch (e) {
    console.error(`[run-batch] ${e?.message ?? e}`);
    exit(2);
  }
}
