#!/usr/bin/env node
// 双工人对照臂 runner（v024-fast-exp#N3；roadmap §⑭ `--fast` 门槛①写型双工人受控实测）。
//
// ★ 冻结决策偏离 attempt 注记（common.mjs 约定；预注册=.lazyzcode/plans/v024-fast-exp.md 判据预注册节）：
//   ① run-batch.mjs:3「并发上限 1，冻结决策」——本 runner 的 dual 臂**有意**并发两条
//      spawnEngine 链（同一 scratch goal、两棵兄弟 worktree、`lzy loop claim` 互斥）。
//      并行本身就是被测量对象，非疏忽；serial 臂仍是单链串行，两臂同变体同夹具同判据。
//   ② common.mjs:26-28「LZY_ABLATION_OUT_ROOT 仅供测试隔离、正式跑批永不设置」——不偏离：
//      本 runner 不设 OUT_ROOT；`_pkg/<variant>` 同变体重建互覆以「spawn 前串行预热一次」
//      规避（ensureVariantPkg 温印后直接复用；common.mjs import 期绑定使单进程无法按工人拆根）。
//
// 布局（trial 目录下）：repo/ =scratch goal 槽；wt-a/、wt-b/ =repo 的**兄弟** worktree
// （subject 校验拒包含关系根，core/loop.js validateSubjectRoot）；home-a/、home-b/ =工人
// 隔离 HOME（rollout/turns 互不混计）。变体=A 全载荷（纪律全开）、无 tier 指令=LIGHT 缺省。
//
// 终态组装（dual）：两工人各自提交 → runner 把 fast-a、fast-b 两路 merge 回 repo master
// （文件不相交零冲突；冲突=INFRA 记账不退役）→ verdict/run.sh 在 merge 后的 repo 根跑 →
// merge 屏障重取证（对每 F 项 `lzy loop step done <Fid>` 重锚指纹；core/loop.js
// verifyEvidence + finish_reject_stale 要求之）→ runner 代跑 `lzy loop finish`。
//
// CLI：node scripts/ablation/run-fast-pair.mjs --task <id> --arm dual|serial --rep <n>
//        [--batch fast] [--timeout-ms 900000] [--force] [--report]
// 自采指标（不调 extractMetrics——其 trialPaths 硬编码 scratch 落点）：逐行 append 到
// `${OUT_ROOT}/fast-ledger.jsonl`；--report 读全账打对照表（F1 的表面）。
import { existsSync, mkdirSync, readFileSync, readdirSync, cpSync, rmSync, appendFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { argv, exit } from "node:process";
import { join } from "node:path";
import { OUT_ROOT, TASKS_DIR, VARIANTS, computePayloadHash, ensureVariantPkg, parseEngineSummary } from "./common.mjs";
import { installVariant } from "./install-variant.mjs";
import { BASE_ABLATE_ENV, spawnEngine } from "./spawn-engine.mjs";
import { assertVariantCliIdentity, cleanupShim, createVariantCliShim } from "./run-trial.mjs";

function arg(name, dflt = null) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
}
function flag(name) {
  return argv.includes(`--${name}`);
}
function git(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8", shell: false, timeout: 30_000 });
}
// runner 侧的 lzy 调用：走变体 shim（与工人同一 CLI 身份）+ 基线消融 env（人权门在 trial
// 内被消融是 b1/b2/b3 家法——机器门才能自动化；变体表开关面不动）。
function lzy(repo, args, { pathEnv, timeout = 60_000 } = {}) {
  return spawnSync("lzy", args, {
    cwd: repo,
    encoding: "utf8",
    shell: false,
    timeout,
    env: { ...process.env, ...BASE_ABLATE_ENV, PATH: pathEnv },
  });
}
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
function median(xs) {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function buildWorkerPrompt({ repo, taskId, arm, role, steps, fAssertion }) {
  const lines = [
    `你是工人${role}，在一个 git worktree（当前目录）里工作；另一名工人${arm === "dual" ? "在另一棵 worktree 与你并行" : "不存在（你是唯一工人）"}。`,
    `目标槽在 ${repo}（.lazyzcode/ 已就绪：目标已注册、计划已采纳、循环已 start）。先读 ${repo}/.lazyzcode/plans/${taskId}.md 再动手。`,
    `纪律（逐条遵守）：`,
    `1. 一切 lzy 命令先 \`cd ${repo}\` 再执行（lzy 已在 PATH，指向被测变体）。`,
    `2. 你的全部代码改动只落在当前 worktree；每步完成先 git add+commit 再记账。`,
    arm === "dual" ? `3. 动手前先 \`lzy loop claim <步id>\` 认领本步；被拒（已被认领/依赖阻塞）就先做你的分工里其他可做步，稍后再试。` : `3. 无人与你竞争，可直接开工（claim 可省）。`,
    `4. 每步完成即 \`lzy step done <步id> --note "<一行>"\`。你的分工步：${steps.join("、")}。`,
    `5. 全部分工步完成后：运行本波断言（${fAssertion}），然后 \`lzy step done F1 --evidence "<断言实际输出摘要，逐字引用关键行>"\` 取证。`,
    arm === "dual" ? `6. F1 取证若与另一工人撞车：后做的人照常 step done F1（同 id 重取证=合法 rebind），不要跳过。` : null,
    `7. 不 reset、不 abandon、不改计划、不碰对方步。做完即收工退出。`,
  ].filter(Boolean);
  return lines.join("\n");
}

async function runWorker({ role, home, cwd, prompt, pathEnv, timeoutMs }) {
  const t0 = Date.now();
  const r = await spawnEngine({
    home,
    cwd,
    prompt,
    timeoutMs,
    pathEnv, // 变体 CLI 优先于宿主全局 lzy（ADJ-81 同款）
  });
  return { role, ...r, workerWallMs: r.durationMs ?? Date.now() - t0 };
}

export async function runFastPair({
  variant = "A",
  task,
  arm = "dual",
  rep = 1,
  batch = "fast",
  timeoutMs = 900_000,
  force = false,
} = {}) {
  if (arm !== "dual" && arm !== "serial") throw new Error(`--arm 须为 dual|serial，得到 ${arm}`);
  const taskId = task; // 计划槽位 slug=任务 id（worker prompt 与 register 共用）
  const def = VARIANTS[variant];
  const taskDir = join(TASKS_DIR, task);
  if (!def) throw new Error(`未知变体：${variant}`);
  if (!existsSync(taskDir)) throw new Error(`任务目录不存在：${taskDir}`);
  const trialId = `${batch}-${arm}-${task}-r${rep}`;
  const dir = join(OUT_ROOT, trialId);
  if (existsSync(dir) && !force) throw new Error(`trial 目录已存在：${dir}（重跑加 --force）`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const repo = join(dir, "repo");
  const pkg = ensureVariantPkg(variant); // 预热：温印后直接复用（见头注②）
  const payloadHash = computePayloadHash(pkg).hash;
  const shim = createVariantCliShim(dir, pkg);
  const childPath = `${shim}:${process.env.PATH ?? ""}`;

  // ── scratch 装配：全新仓 + 任务种子 + 首提交（run-trial 同款）。
  mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "ablation@trial"]);
  git(repo, ["config", "user.name", "ablation-trial"]);
  const seedDir = join(taskDir, "seed");
  if (existsSync(seedDir)) {
    for (const f of readdirSync(seedDir)) cpSync(join(seedDir, f), join(repo, f), { recursive: true });
  }
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "seed"]);

  // ── goal 槽预置（runner 代做，工人不竞注册）：register → plan（人权门已消融）→ start。
  for (const [args, label] of [
    [["loop", "register", taskId, "--title", `${task}（fast-exp ${arm} 臂 r${rep}）`], "register"],
    [["loop", "plan", join(taskDir, "plan.md"), "--review", "harness-seed（v024-fast-exp 实验夹具；人权门 trial 内消融）"], "plan"],
    [["loop", "start"], "start"],
  ]) {
    const r = lzy(repo, args, { pathEnv: childPath });
    if (r.status !== 0) throw new Error(`预置 ${label} 失败（exit=${r.status}）：${(r.stderr ?? r.stdout ?? "").trim().slice(0, 300)}`);
  }

  // ── dual：兄弟 worktree ×2 + subject 声明（worktree-as-subject）。
  const worktrees = [];
  if (arm === "dual") {
    for (const [name, branch] of [["wt-a", "fast-a"], ["wt-b", "fast-b"]]) {
      const w = join(dir, name);
      const g = git(repo, ["worktree", "add", "-b", branch, w]);
      if (g.status !== 0) throw new Error(`worktree add ${name} 失败：${(g.stderr ?? "").trim().slice(0, 200)}`);
      worktrees.push({ name, path: w, branch });
    }
    for (const w of worktrees) {
      const r = lzy(repo, ["loop", "subject", "add", w.path], { pathEnv: childPath });
      if (r.status !== 0) throw new Error(`subject add ${w.name} 失败：${(r.stderr ?? r.stdout ?? "").trim().slice(0, 300)}`);
    }
  }

  // 锁字段基线（③门槛的观测面之一：trial 内自然锁竞争）。
  const lockBefore = readJson(join(repo, ".lazyzcode", "loop", "metrics.json")) ?? {};

  // ── 工人装配（各自隔离 HOME + 各自 install + 同一 shim PATH）。
  const split = JSON.parse(readFileSync(join(taskDir, "split.json"), "utf8"));
  const workers =
    arm === "dual"
      ? [
          { role: "甲", suffix: "a", steps: split.a.steps },
          { role: "乙", suffix: "b", steps: split.b.steps },
        ]
      : [{ role: "甲", suffix: "a", steps: [...split.a.steps, ...split.b.steps] }];
  for (const w of workers) {
    w.home = join(dir, `home-${w.suffix}`);
    mkdirSync(w.home, { recursive: true });
    const inst = installVariant(variant, { home: w.home });
    if (def.install && inst.installed !== true) {
      throw new Error(`工人${w.role} 变体装载失败（installed=${inst.installed}）：不产样本。${(inst.out ?? "").trim().slice(0, 200)}`);
    }
  }

  // ── spawn：dual 双链并发（头注①的预注册偏离）；serial 单链。
  const t0 = Date.now();
  const results = await Promise.allSettled(
    workers.map((w) =>
      runWorker({
        role: w.role,
        home: w.home,
        cwd: arm === "dual" ? worktrees.find((x) => x.name === `wt-${w.suffix}`).path : repo,
        prompt: buildWorkerPrompt({ repo, taskId, arm, role: w.role, steps: w.steps, fAssertion: split.fAssertion }),
        pathEnv: childPath,
        timeoutMs,
      }),
    ),
  );
  const workerResults = results.map((r, i) => {
    const w = workers[i];
    if (r.status === "fulfilled") return r.value;
    return { role: w.role, code: null, workerWallMs: null, killed: false, stdout: `runner 层异常：${r.reason?.message ?? r.reason}`, stderr: "" };
  });

  // 工件归档：引擎 stdout 逐工人落盘。
  for (const w of workerResults) {
    writeFileSync(join(dir, `worker-${w.role}-stdout.txt`), `exit=${w.code} wallMs=${w.workerWallMs} killed=${w.killed}\n${w.stdout ?? ""}\n[stderr]\n${w.stderr ?? ""}\n`);
  }

  // ── 终态组装（dual）：merge ×2 → verdict → merge 屏障重取证 → finish。
  let conflicts = false;
  const mergeOps = [];
  if (arm === "dual") {
    for (const w of worktrees) {
      const m0 = Date.now();
      const g = git(repo, ["merge", "--no-ff", w.branch, "-m", `merge ${w.branch}（runner 终态组装）`]);
      mergeOps.push({ branch: w.branch, ok: g.status === 0, ms: Date.now() - m0 });
      if (g.status !== 0) conflicts = true;
    }
  }
  writeFileSync(join(dir, "merge-log.txt"), mergeOps.map((m) => JSON.stringify(m)).join("\n") || "serial 臂无 merge");

  // verdict（run-trial 同款闭式 env，cwd=repo）。
  let verdictExit = null;
  const verdictScript = join(taskDir, "verdict", "run.sh");
  if (existsSync(verdictScript)) {
    const v = spawnSync("bash", [verdictScript], {
      cwd: repo,
      encoding: "utf8",
      timeout: 120_000,
      shell: false,
      env: { PATH: process.env.PATH, HOME: workers[0].home, USERPROFILE: workers[0].home, LZY_ABLATE_HUMAN_GATE: "1", LZY_ABLATE_HOOK_HUMAN_GATE: "1" },
    });
    verdictExit = v.status;
    writeFileSync(join(dir, "verdict-stdout.txt"), `exit=${v.status ?? "?"} signal=${v.signal ?? "-"}\n${v.stdout ?? ""}${v.stderr ?? ""}`);
  }

  // merge 屏障重取证（dual 恒在；serial 无 merge 不需要）+ finish 代跑。
  const fIds = (JSON.parse(readFileSync(join(taskDir, "plan.json"), "utf8") ?? "{}").fIds) ?? ["F1"];
  let mergeBarrierRebinds = 0;
  if (arm === "dual" && !conflicts) {
    for (const fid of fIds) {
      const r = lzy(repo, ["step", "done", fid, "--evidence", "merge-barrier rebind：终态组装（两 worktree 合流）后复合指纹重锚——runner 代跑，非工人取证"], { pathEnv: childPath });
      if (r.status === 0) mergeBarrierRebinds++;
    }
    writeFileSync(join(dir, "rebind-log.txt"), `mergeBarrierRebinds=${mergeBarrierRebinds}/${fIds.length}`);
  }
  let finishOk = false;
  const fin = lzy(repo, ["loop", "finish"], { pathEnv: childPath, timeout: 120_000 });
  finishOk = fin.status === 0;
  writeFileSync(join(dir, "finish-stdout.txt"), `exit=${fin.status}\n${fin.stdout ?? ""}${fin.stderr ?? ""}`);

  // ── 指标自采。
  const lockAfter = readJson(join(repo, ".lazyzcode", "loop", "metrics.json")) ?? {};
  const goal = readJson(join(repo, ".lazyzcode", "loop", "goal.json"));
  const dag = readJson(join(repo, ".lazyzcode", "loop", "dag.json")) ?? { edges: [] };
  const totalSupersedes = (dag.edges ?? []).filter((e) => e.type === "supersedes").length;
  const stepsDone = (goal?.steps ?? []).filter((s) => s.status === "done").length;
  const workerTurns = {};
  for (const w of workerResults) {
    const s = parseEngineSummary(w.stdout ?? "");
    workerTurns[w.role] = s?.usage?.modelRequestCount ?? null;
  }
  const wallMs = Date.now() - t0;
  const row = {
    trialId,
    batch,
    arm,
    task,
    rep,
    variant,
    payloadHash,
    wallMs,
    workerWallMs: Object.fromEntries(workerResults.map((w) => [w.role, w.workerWallMs])),
    workerExits: Object.fromEntries(workerResults.map((w) => [w.role, w.code])),
    workerTurns,
    stepsDone,
    totalSupersedes,
    mergeBarrierRebinds,
    workerWindowSupersedes: totalSupersedes - mergeBarrierRebinds,
    lockDelta: {
      waits: (lockAfter.lock_waits ?? 0) - (lockBefore.lock_waits ?? 0),
      waitMsTotal: (lockAfter.lock_wait_ms_total ?? 0) - (lockBefore.lock_wait_ms_total ?? 0),
      waitMsMax: lockAfter.lock_wait_ms_max ?? 0,
      timeouts: (lockAfter.lock_timeouts ?? 0) - (lockBefore.lock_timeouts ?? 0),
    },
    mergeOps,
    conflicts,
    verdictExit,
    finishOk,
    at: new Date().toISOString(),
  };
  writeFileSync(join(dir, "trial-meta-fast.json"), `${JSON.stringify(row, null, 2)}\n`);
  appendFileSync(join(OUT_ROOT, "fast-ledger.jsonl"), `${JSON.stringify(row)}\n`);
  cleanupShim(dir);
  console.log(JSON.stringify(row));
  return row;
}

// ── 对照表（F1 的表面：本 runner 自身输出，aggregate.mjs 不动）。--batch 过滤正式批
//（pilot 行留在账本里做证据，但不进表）。
function report(batch = null) {
  const ledgerPath = join(OUT_ROOT, "fast-ledger.jsonl");
  const rows = (readFileSync(ledgerPath, "utf8") || "")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => !batch || r.batch === batch);
  const byTask = new Map();
  for (const r of rows) {
    if (!byTask.has(r.task)) byTask.set(r.task, []);
    byTask.get(r.task).push(r);
  }
  const lines = ["== fast-exp 门槛①对照表（墙钟 ms；supersedes=工人窗口；rebind=merge 屏障恒在项）=="];
  for (const [task, rs] of byTask) {
    for (const arm of ["serial", "dual"]) {
      const cell = rs.filter((r) => r.arm === arm);
      if (cell.length === 0) continue;
      lines.push(
        `${task} | ${arm.padEnd(6)} | n=${cell.length} | wallMs med=${median(cell.map((r) => r.wallMs))} | verdict pass=${cell.filter((r) => r.verdictExit === 0).length}/${cell.length} | finish ok=${cell.filter((r) => r.finishOk).length}/${cell.length} | supersedes med=${median(cell.map((r) => r.workerWindowSupersedes))} | mergeRebind med=${median(cell.map((r) => r.mergeBarrierRebinds))} | lock timeouts=${cell.reduce((a, r) => a + r.lockDelta.timeouts, 0)}`,
      );
    }
  }
  console.log(lines.join("\n"));
  return lines;
}

import { pathToFileURL } from "node:url";
if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  try {
    if (flag("report")) {
      report(arg("batch", "fast"));
    } else {
      const task = arg("task");
      if (!task || !arg("arm")) {
        console.error("用法：--task <id> --arm dual|serial [--rep 1] [--batch fast] [--timeout-ms 900000] [--force] [--report]");
        exit(2);
      }
      await runFastPair({
        task,
        arm: arg("arm"),
        rep: Number(arg("rep", "1")),
        batch: arg("batch", "fast"),
        timeoutMs: Number(arg("timeout-ms", "900000")),
        force: flag("force"),
      });
    }
  } catch (e) {
    console.error(`[fast-pair] ${e.message}`);
    exit(1);
  }
}
