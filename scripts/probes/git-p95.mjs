#!/usr/bin/env node
// 锁阈值运营结论探针（0.2.2 棒1#N7 / R5-OPEN-1）。
//
// 问题：R5 五轮双审留下的开放问题是「`LOCK_STALE_MS` 的触发面需运营结论——真实包络里
// 到底能不能出现 >10s 的临界段？」。要回答它，得知道 finish 闸门真正的成本项（逐根
// `git status --porcelain`，共享 8s 预算）与 salvage 盘点用的 `git log --all --grep`
// 在真实仓上的耗时分布。
//
// 做法：**只读**逐仓重复跑两条命令，取 P50/P95，与锁三常量同尺对照。不写任何仓，
// 不声明 subject（这是观测，不是取证）。
//
// 用法：node scripts/probes/git-p95.mjs [--n 15] [--json]
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { GATE_BUDGET_MS, LOCK_STALE_MS, LOCK_WAIT_MS } from "../../core/loop.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

const argv = process.argv.slice(2);
const N = Number(argv[argv.indexOf("--n") + 1]) || 15;
const AS_JSON = argv.includes("--json");

// 包络=本仓 + 三个最大狗粮仓（按 tracked files 排序；均带 .lazyzcode/，即被真实使用过）。
// 狗粮仓缺席时如实标注，绝不静默降级为单仓结论。
const HOME = homedir();
const ENVELOPE = [
  { label: "lazyzcode（本仓）", path: repoRoot },
  { label: "openchamber", path: join(HOME, "Codehub", "openchamber") },
  { label: "reversed", path: join(HOME, "Codehub", "reversed") },
  { label: "Samsung", path: join(HOME, "Codehub", "Samsung") },
];

// 两条命令都是 finish/salvage 路径上的真实成本项。marker 口径沿 core/git.js 的
// commitSubjects（`--grep=<marker>` 单 argv 元素，安全形态相同）。
const COMMANDS = [
  { label: "git status --porcelain", args: ["status", "--porcelain"] },
  { label: "git log --all --grep", args: ["log", "--all", "--grep=Goal: ", "--format=%h %s"] },
];

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function timeCommand(cwd, args, n) {
  const samples = [];
  for (let i = 0; i < n; i++) {
    const t0 = process.hrtime.bigint();
    const r = spawnSync("git", args, { cwd, shell: false, timeout: 30_000, encoding: "utf8" });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (r.error || r.status !== 0) return { failed: r.error?.message ?? `exit ${r.status}` };
    samples.push(ms);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: Number(percentile(sorted, 50).toFixed(1)),
    p95: Number(percentile(sorted, 95).toFixed(1)),
    max: Number(sorted[sorted.length - 1].toFixed(1)),
  };
}

const results = [];
for (const repo of ENVELOPE) {
  const present = existsSync(join(repo.path, ".git"));
  if (!present) {
    results.push({ ...repo, present: false });
    continue;
  }
  const perCommand = {};
  for (const cmd of COMMANDS) {
    perCommand[cmd.label] = timeCommand(repo.path, cmd.args, N);
  }
  results.push({ ...repo, present: true, perCommand });
}

const sampled = results.filter((r) => r.present);
const allP95 = sampled.flatMap((r) =>
  Object.values(r.perCommand).map((v) => v.p95).filter((v) => typeof v === "number"),
);
const worstP95 = allP95.length > 0 ? Math.max(...allP95) : null;

const report = {
  probe: "git-p95",
  iterationsPerCommand: N,
  envelope: results,
  sampledRepos: sampled.length,
  declinedRepos: results.filter((r) => !r.present).map((r) => r.label),
  worstP95Ms: worstP95,
  constants: {
    LOCK_WAIT_MS,
    GATE_BUDGET_MS,
    LOCK_STALE_MS,
  },
  ratios: worstP95 == null
    ? null
    : {
        vsLockWait: Number((worstP95 / LOCK_WAIT_MS).toFixed(4)),
        vsGateBudget: Number((worstP95 / GATE_BUDGET_MS).toFixed(4)),
        vsLockStale: Number((worstP95 / LOCK_STALE_MS).toFixed(4)),
      },
  singleSampleCaveat: sampled.length < ENVELOPE.length,
};

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`[git-p95] 包络 ${ENVELOPE.length} 仓 · 每命令 ${N} 次取样`);
  for (const r of results) {
    if (!r.present) {
      console.log(`  ${r.label}: 缺席（不参与结论，需在结清句标注）`);
      continue;
    }
    const parts = Object.entries(r.perCommand).map(
      ([k, v]) =>
        v.failed ? `${k}=失败(${v.failed})` : `${k} P50=${v.p50}ms P95=${v.p95}ms max=${v.max}ms`,
    );
    console.log(`  ${r.label}: ${parts.join(" | ")}`);
  }
  console.log(
    `[git-p95] 最坏 P95=${worstP95}ms · 对照 LOCK_WAIT_MS=${LOCK_WAIT_MS}ms（${report.ratios?.vsLockWait}×）` +
      ` / GATE_BUDGET_MS=${GATE_BUDGET_MS}ms（${report.ratios?.vsGateBudget}×）` +
      ` / LOCK_STALE_MS=${LOCK_STALE_MS}ms（${report.ratios?.vsLockStale}×）`,
  );
  if (report.singleSampleCaveat) {
    console.log(`[git-p95] ⚠ 仅 ${sampled.length}/${ENVELOPE.length} 仓可采——结论必须带「样本偏小」字样`);
  }
}
