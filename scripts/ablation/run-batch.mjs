#!/usr/bin/env node
// 批调度（ADR-0015，goal true-ablation-full-flow#N4）：pre-flight 认证探针（一发
// "reply with OK"，EXIT≠0 整批不跑——绝不假跑）→ 串行调度（并发上限 1，冻结决策）
// → 断点续跑（ledger.jsonl 已记 done 的 trial 跳过）→ 每 trial 一行 JSONL 账本，
// 429 脏窗 trial 分层标记（rateLimitedEvents>0 → dirty429=true，分析面不混入对比）。
//
// CLI：node scripts/ablation/run-batch.mjs --batch b1 [--variants A,B,C,D,E,F]
//        [--tasks t1-plain-fix,t3-alpha-fake-complete,t3-beta-cross-session,t3-delta-dirty-tree]
//        [--reps 1] [--preflight-only] [--force-trial]
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { argv, exit } from "node:process";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { OUT_ROOT } from "./common.mjs";
import { spawnEngine } from "./spawn-engine.mjs";
import { runTrial } from "./run-trial.mjs";

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
  reps = 1,
  preflightOnly = false,
  forceTrial = false,
  timeoutMs = null,
}) {
  if (!tasks || tasks.length === 0) throw new Error("runBatch：tasks 必填（N5 任务集 id）");
  mkdirSync(join(OUT_ROOT, batch), { recursive: true });

  const pf = await preflight();
  if (!pf.ok) {
    return { ok: false, stage: "preflight", pf, ran: 0 };
  }
  if (preflightOnly) return { ok: true, stage: "preflight-only", pf, ran: 0 };

  const { path: ledgerPath, done } = readLedger(batch);
  let ran = 0;
  for (const variant of variants) {
    for (const task of tasks) {
      for (let rep = 1; rep <= reps; rep++) {
        const trialId = `${batch}-${variant}-${task}-r${rep}`;
        if (done.has(trialId)) {
          console.log(`[run-batch] 跳过（账本已记）：${trialId}`);
          continue;
        }
        console.log(`[run-batch] 开跑：${trialId}`);
        try {
          const r = await runTrial({ variant, task, rep, batch, timeoutMs, force: forceTrial });
          appendFileSync(
            ledgerPath,
            `${JSON.stringify({ trialId, variant, task, rep, status: "done", verdict: r.metrics.verdict, fakeComplete: r.metrics.fakeComplete, dirty429: (r.metrics.rateLimitedEvents ?? 0) > 0, at: new Date().toISOString() })}\n`,
          );
          ran++;
        } catch (e) {
          appendFileSync(
            ledgerPath,
            `${JSON.stringify({ trialId, variant, task, rep, status: "error", error: String(e?.message ?? e).slice(0, 300), at: new Date().toISOString() })}\n`,
          );
          console.error(`[run-batch] trial 失败已记账：${trialId} — ${e?.message ?? e}`);
        }
      }
    }
  }
  return { ok: true, stage: "batch", pf, ran, ledgerPath };
}

if (import.meta.url === `file://${argv[1]}`) {
  try {
    const a = { batch: "b1", variants: "A,B,C,D,E,F", reps: 1 };
    for (let i = 2; i < argv.length; i++) {
      if (argv[i] === "--batch") a.batch = argv[++i];
      else if (argv[i] === "--variants") a.variants = argv[++i];
      else if (argv[i] === "--tasks") a.tasks = argv[++i];
      else if (argv[i] === "--reps") a.reps = Number(argv[++i]);
      else if (argv[i] === "--preflight-only") a.preflightOnly = true;
      else if (argv[i] === "--force-trial") a.forceTrial = true;
      else if (argv[i] === "--timeout-ms") a.timeoutMs = Number(argv[++i]);
      else throw new Error(`未知参数：${argv[i]}`);
    }
    if (!a.tasks) {
      console.error("用法：--tasks <id,id,…> [--batch b1] [--variants A,B,…] [--reps n] [--preflight-only] [--force-trial]");
      exit(2);
    }
    const r = await runBatch({
      batch: a.batch,
      variants: a.variants.split(","),
      tasks: a.tasks.split(","),
      reps: a.reps,
      preflightOnly: a.preflightOnly,
      forceTrial: a.forceTrial,
      timeoutMs: a.timeoutMs,
    });
    console.log(`[run-batch] stage=${r.stage} ok=${r.ok} ran=${r.ran ?? 0}`);
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
