#!/usr/bin/env node
// N 工人写命令锁排队窗微基准（v024-fast-exp#N5；roadmap §⑭ 门槛③）。
//
// 写面钉死为 `lzy loop budget spend`（ADR-0020 预算面：全程 withLock、不碰步状态——
// 反复对同一 goal 重取证或改步会污染 trial 语义）。K∈{2,4,8} 工人进程各自循环 M 次
// spend；读数=前后 `.lazyzcode/loop/metrics.json` 差值（lock_waits / lock_wait_ms_total /
// lock_wait_ms_max / lock_timeouts，core/loop.js withLock 五字段）+ doctor lock 行原文。
// 判据③（预注册）：K=8 时 lock_wait_ms_max <1000ms 且 lock_timeouts=0 → 锁窗不构成形态约束。
//
// CLI：node scripts/ablation/lock-queue-bench.mjs [--k-list 2,4,8] [--m 20] [--force]
// 输出：stdout K×4 表 + `${OUT_ROOT}/lockbench/bench-result.json`。
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { argv, exit } from "node:process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { OUT_ROOT, REPO_ROOT } from "./common.mjs";

const CLI = join(REPO_ROOT, "cli", "lzy.js");
const ABLATE = { LZY_ABLATE_HUMAN_GATE: "1", LZY_ABLATE_HOOK_HUMAN_GATE: "1" };

function arg(name, dflt = null) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
}
function lzy(repo, args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: repo,
    encoding: "utf8",
    shell: false,
    timeout: 60_000,
    env: { ...process.env, ...ABLATE },
  });
}
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// 工人进程体：循环 M 次 budget spend（每次一个全新 CLI 进程=一次 withLock 竞争）。
const WORKER_CODE = `
import { spawnSync } from "node:child_process";
const repo = process.env.BENCH_REPO, cli = process.env.BENCH_CLI, m = Number(process.env.BENCH_M);
let ok = 0, fail = 0;
for (let i = 0; i < m; i++) {
  const r = spawnSync(process.execPath, [cli, "loop", "budget", "spend", "--ms", "10", "--points", "1"], {
    cwd: repo, encoding: "utf8", shell: false, timeout: 60_000,
    env: { ...process.env, LZY_ABLATE_HUMAN_GATE: "1", LZY_ABLATE_HOOK_HUMAN_GATE: "1" },
  });
  if (r.status === 0) ok++; else { fail++; console.error(r.stderr ?? r.stdout ?? ""); }
}
console.log(JSON.stringify({ ok, fail }));
`;

function runRound({ repo, k, m }) {
  const before = readJson(join(repo, ".lazyzcode", "loop", "metrics.json")) ?? {};
  const t0 = Date.now();
  const kids = [];
  for (let i = 0; i < k; i++) {
    kids.push(
      spawn(process.execPath, ["--input-type=module", "-e", WORKER_CODE], {
        cwd: repo,
        env: { ...process.env, ...ABLATE, BENCH_REPO: repo, BENCH_CLI: CLI, BENCH_M: String(m) },
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  }
  const outs = [];
  return new Promise((resolve) => {
    let settled = 0;
    for (const kid of kids) {
      let buf = "";
      kid.stdout.on("data", (d) => (buf += d));
      kid.on("close", () => {
        outs.push(buf.trim() ? JSON.parse(buf.trim().split("\n").at(-1)) : { ok: 0, fail: -1 });
        if (++settled === kids.length) finish();
      });
    }
    function finish() {
      const after = readJson(join(repo, ".lazyzcode", "loop", "metrics.json")) ?? {};
      resolve({
        k,
        m,
        wallMs: Date.now() - t0,
        waits: (after.lock_waits ?? 0) - (before.lock_waits ?? 0),
        waitMsTotal: (after.lock_wait_ms_total ?? 0) - (before.lock_wait_ms_total ?? 0),
        // ADJ-32（v024 双审）：`lock_wait_ms_max` 是**运行终身最大值**（mergeMetrics 取 max 语义）
        // ——K=8 的读数里含 K=2/K=4 轮的历史峰，归因失真（方向保守：报大不报小）。现按轮取差：
        // 本轮 max 只能由「本轮记录的等待」产生；历史峰 ≥ 本轮真值，故若历史峰不大于跑前值，
        // 说明本轮没刷新过峰 ⇒ 本轮 max 记 0（保守）与「跑前值未变」两读数一并留存。
        waitMsMaxLifetime: after.lock_wait_ms_max ?? 0,
        waitMsMaxStalePeak: (after.lock_wait_ms_max ?? 0) === (before.lock_wait_ms_max ?? 0),
        waitMsMax: (after.lock_wait_ms_max ?? 0) === (before.lock_wait_ms_max ?? 0) ? 0 : (after.lock_wait_ms_max ?? 0),
        timeouts: (after.lock_timeouts ?? 0) - (before.lock_timeouts ?? 0),
        spendOk: outs.reduce((a, o) => a + (o?.ok ?? 0), 0),
        spendFail: outs.reduce((a, o) => a + Math.max(o?.fail ?? 0, 0), 0),
        // ADJ-32 第二半：工人进程崩溃（close 时无 JSON 输出 ⇒ 上面记 {ok:0, fail:-1}）此前被
        // `Math.max(fail,0)` 抹成 0，看板上完全隐形。现行单列崩溃计数与名单（谁的输出不可解析）。
        crashed: outs.filter((o) => (o?.fail ?? 0) < 0).length,
        crashIdx: outs.map((o, i) => ((o?.fail ?? 0) < 0 ? i : -1)).filter((i) => i >= 0),
      });
    }
  });
}

if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  const kList = (arg("k-list", "2,4,8") ?? "2,4,8").split(",").map(Number);
  const m = Number(arg("m", "20"));
  const dir = join(OUT_ROOT, "lockbench");
  mkdirSync(dir, { recursive: true });
  const repo = join(dir, "repo");
  if (existsSync(repo) && argv.includes("--force")) rmSync(repo, { recursive: true, force: true });
  if (!existsSync(repo)) {
    mkdirSync(repo, { recursive: true });
    spawnSync("git", ["init", "-q"], { cwd: repo });
    spawnSync("git", ["config", "user.email", "bench@trial"], { cwd: repo });
    spawnSync("git", ["config", "user.name", "lock-bench"], { cwd: repo });
    writeFileSync(join(repo, "README.md"), "# lock-bench\n");
    spawnSync("git", ["add", "-A"], { cwd: repo });
    spawnSync("git", ["commit", "-qm", "seed"], { cwd: repo });
    const plan = join(repo, "bench-plan.md");
    writeFileSync(plan, "- [N1] bench dummy step\n");
    for (const args of [
      ["loop", "register", "lockbench", "--title", "锁排队窗微基准槽位"],
      ["loop", "plan", plan, "--review", "harness-seed（v024-fast-exp#N5 仪器夹具）"],
      ["loop", "start"],
      ["loop", "budget", "init", "--wall-ms", "600000", "--points", "1000"],
    ]) {
      const r = lzy(repo, args);
      if (r.status !== 0) {
        console.error(`[lock-bench] 预置失败 ${args[1]}：${(r.stderr ?? r.stdout ?? "").trim().slice(0, 300)}`);
        exit(1);
      }
    }
  }

  const rows = [];
  for (const k of kList) {
    const row = await runRound({ repo, k, m });
    rows.push(row);
    console.log(
      `K=${row.k} M=${row.m} | waits=${row.waits} waitMsTotal=${row.waitMsTotal} waitMsMax=${row.waitMsMax}` +
        `${row.waitMsMaxStalePeak ? "（未刷新峰：本轮真值≤历史峰）" : ""} timeouts=${row.timeouts} | wallMs=${row.wallMs} spend ok=${row.spendOk} fail=${row.spendFail} crashed=${row.crashed}${row.crashed ? `［${row.crashIdx.join(",")}］` : ""}`,
    );
  }
  const doc = spawnSync(process.execPath, [CLI, "doctor"], {
    cwd: repo,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, ...ABLATE },
  });
  const lockLine = (doc.stdout ?? "").split("\n").find((l) => l.includes("获锁") || l.includes("锁竞争")) ?? "(doctor 锁行缺席)";
  console.log(`doctor: ${lockLine.trim()}`);
  writeFileSync(join(dir, "bench-result.json"), `${JSON.stringify({ rows, doctorLockLine: lockLine.trim(), at: new Date().toISOString() }, null, 2)}\n`);
}
