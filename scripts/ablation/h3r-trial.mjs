#!/usr/bin/env node
// H3R 试跑驱动（0.2.2 棒2，ADR-0022）——`scripts/ablation/` 里第一条走 `lzy loop drive` 的
// 管线（b1/b2/b3 全是直发 headless，本文件是那次「基座必须新建」的实现）。
//
// 为什么非走 drive 不可：H3R 门按预注册只活在 drive 的**段循环**里（车道边界口径，§⑰ Q4），
// 直发 headless 的任务永远不会经过那道门，等于测了个寂寞。
//
// 单发流程：新 scratch + seed + 提交 → trial HOME → 变体装配（pkg/install/shim/身份断言）
//   → 认证 fail-fast（两枚 provider env 成对）→ 预置目标（register）→ 采纳固设计划
//   （`plan.md`，人权门按基线消融）→ `loop start` → spawn `lzy loop drive` → 收 stdout/exit
//   → 跑 verdict 与 risky 探针 → 归档 → 抽指标。
//
// env 承重件（**不得改成闭式**）：drive 与段内一切子进程 env = `{...process.env, HOME/USERPROFILE
// 双换, 基线消融, 变体开关, shim PATH}`。桌面注入的 `ZCODE_*_PROVIDER_CONFIG_FILE` 两枚必须
// 随 process.env 下传——隔离 HOME 下摘掉它们，引擎在启动门就拒（实测「无法定位 CLI ZCode
// Built-in Provider Config」EXIT=1），而**把凭据复制进 trial HOME 并不顶用**。`run-trial.mjs`
// 里 `runVerdict` 的闭式 env 是 verdict 脚本的先例，不适用于引擎/drive 子进程。
//
// CLI：node scripts/ablation/h3r-trial.mjs --variant H3R-A --task h1-credentials-scrub [--rep 1]
//        [--batch h3r] [--wall-ms 900000] [--max-segments 4] [--force]
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { argv, exit } from "node:process";
import { join } from "node:path";
import { BASE_ABLATE_ENV } from "./spawn-engine.mjs";
import {
  OUT_ROOT,
  TASKS_DIR,
  VARIANTS,
  computePayloadHash,
  ensureVariantPkg,
  trialPaths,
} from "./common.mjs";
import { assertVariantCliIdentity, createVariantCliShim, cleanupShim } from "./run-trial.mjs";
import { installVariant } from "./install-variant.mjs";
import { extractH3rMetrics } from "./extract-metrics.mjs";

export const H3R_WALL_MS_DEFAULT = 900_000; // = 15 min，整 run 的墙钟总顶（见计划详单 N3）
export const H3R_MAX_SEGMENTS_DEFAULT = 4;

function git(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8", shell: false, timeout: 30_000 });
}

// 认证 fail-fast 面：两枚 provider 配置 env **成对**在场且指向真文件。
// 只判一枚是不够的——builtin-only 会在**模型创建门**（而非启动门）拒，那样会先白跑掉好几发。
export function authEnvCheck(env = process.env) {
  const builtin = env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE;
  const personal = env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE;
  const present = (p) => {
    try {
      return Boolean(p) && statSync(p).isFile() && statSync(p).size > 0;
    } catch {
      return false;
    }
  };
  return {
    ok: present(builtin) && present(personal),
    builtin: builtin ?? null,
    personal: personal ?? null,
    builtinOk: present(builtin),
    personalOk: present(personal),
  };
}

// 假引擎兜底不用——本管线必须真引擎（H3R 量的是真段循环行为）。引擎路径经 core/paths.js。
function probe(taskDir, p, name) {
  const script = join(taskDir, name, "run.sh");
  if (!existsSync(script)) return { exit: null, signal: null, out: `（无 ${name}/run.sh）` };
  const r = spawnSync("bash", [script], {
    cwd: p.scratch,
    encoding: "utf8",
    timeout: 120_000,
    shell: false,
    // 闭式 env（沿 run-trial 的 runVerdict 先例）：探针是纯机械检查，不该被人权门等开关左右
    env: {
      PATH: process.env.PATH,
      HOME: p.home,
      USERPROFILE: p.home,
      ...BASE_ABLATE_ENV,
    },
  });
  return { exit: r.status, signal: r.signal ?? null, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

export async function runH3rTrial({
  variant,
  task,
  rep = 1,
  batch = "h3r",
  wallMs = H3R_WALL_MS_DEFAULT,
  maxSegments = H3R_MAX_SEGMENTS_DEFAULT,
  force = false,
}) {
  const def = VARIANTS[variant];
  if (!def) throw new Error(`未知变体：${variant}（H3R 网格合法：H3R-A / H3R-B / H3R-C / H3R-D / H3R-E）`);
  const taskDir = join(TASKS_DIR, task);
  if (!existsSync(taskDir)) throw new Error(`任务目录不存在：${taskDir}（N2 落任务集）`);
  if (!existsSync(join(taskDir, "plan.md"))) throw new Error(`固设计划缺席：${join(taskDir, "plan.md")}`);
  if (!existsSync(join(taskDir, "risky", "run.sh"))) throw new Error(`高危探针缺席：${join(taskDir, "risky", "run.sh")}`);

  const trialId = `${batch}-${variant}-${task}-r${rep}`;
  const p = trialPaths(trialId);
  if (existsSync(p.dir) && !force) throw new Error(`trial 目录已存在：${p.dir}（重跑加 --force）`);
  rmSync(p.dir, { recursive: true, force: true });
  mkdirSync(p.scratch, { recursive: true });
  mkdirSync(p.home, { recursive: true });

  // 认证门（批前 preflight 之外的第二道）：缺任一枚则**不产样本**，如实记账。
  const auth = authEnvCheck();
  if (!auth.ok) {
    throw new Error(
      `provider env 不成对（builtin=${auth.builtinOk ? "ok" : "缺"} personal=${auth.personalOk ? "ok" : "缺"}）：` +
        `隔离 HOME 下摘掉它们引擎会在启动门拒，复制凭据进 trial HOME 不顶用（已实测）——本发不产样本`,
    );
  }

  // 装配 scratch：全新仓 + 任务种子（verdict/risky 只活在任务目录，模型不可见）。
  git(p.scratch, ["init", "-q"]);
  git(p.scratch, ["config", "user.email", "ablation@trial"]);
  git(p.scratch, ["config", "user.name", "ablation-trial"]);
  const seedDir = join(taskDir, "seed");
  if (existsSync(seedDir)) {
    for (const f of readdirSync(seedDir)) cpSync(join(seedDir, f), join(p.scratch, f), { recursive: true });
  }
  git(p.scratch, ["add", "-A"]);
  git(p.scratch, ["commit", "-qm", "seed"]);

  const pkg = ensureVariantPkg(variant);
  const install = installVariant(variant, { home: p.home });
  if (def.install && install.installed !== true) {
    throw new Error(`变体 ${variant} 装载失败（installed=${install.installed}，exit=${install.exit ?? "?"}）：不产样本`);
  }
  const shim = createVariantCliShim(p.dir, pkg);
  const childPath = `${shim}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`;
  const cliPath = join(pkg, "cli", "lzy.js");

  // 子进程 env 契约（承重件）：继承 process.env（含两枚 provider env）→ 双换 HOME → 基线消融
  // → 变体开关 → shim PATH。显式摘掉 LZY_ZCODE_ENGINE（父 shell 可能为测试而抑制引擎）。
  const baseEnv = { ...process.env, ...BASE_ABLATE_ENV, ...def.switches };
  delete baseEnv.LZY_ZCODE_ENGINE;
  const childEnv = { ...baseEnv, HOME: p.home, USERPROFILE: p.home, PATH: childPath };

  const lzy = (args, extraEnv = {}) =>
    spawnSync(process.execPath, [cliPath, ...args], {
      cwd: p.scratch,
      encoding: "utf8",
      timeout: 120_000,
      shell: false,
      env: { ...childEnv, ...extraEnv },
    });

  let driveStdout = "";
  let driveExit = null;
  let driveDurationMs = null;
  let cliVersion = null;
  try {
    cliVersion = assertVariantCliIdentity({ pathEnv: childPath, cwd: p.scratch, home: p.home, pkgDir: pkg }).version;

    const slug = task;
    const reg = lzy(["loop", "register", slug, "--title", `H3R ${task}`, "--risk", "med"]);
    if (reg.status !== 0) throw new Error(`register 失败：${(reg.stdout ?? "") + (reg.stderr ?? "")}`);
    const plan = lzy(["loop", "plan", join(taskDir, "plan.md")]);
    if (plan.status !== 0) throw new Error(`计划采纳失败：${(plan.stdout ?? "") + (plan.stderr ?? "")}`);
    const start = lzy(["loop", "start"]);
    if (start.status !== 0) throw new Error(`loop start 失败：${(start.stdout ?? "") + (start.stderr ?? "")}`);

    const started = Date.now();
    const dr = spawnSync(
      process.execPath,
      [cliPath, "loop", "drive", "--mode", "yolo", "--max-segments", String(maxSegments), "--wall-ms", String(wallMs)],
      { cwd: p.scratch, encoding: "utf8", timeout: wallMs + 180_000, shell: false, env: childEnv },
    );
    driveDurationMs = Date.now() - started;
    driveExit = dr.status;
    driveStdout = `exit=${dr.status ?? "?"} signal=${dr.signal ?? "-"} durationMs=${driveDurationMs}\n${dr.stdout ?? ""}\n[stderr]\n${dr.stderr ?? ""}\n`;
    writeFileSync(join(p.dir, "drive-stdout.txt"), driveStdout);

    const v = probe(taskDir, p, "verdict");
    const rk = probe(taskDir, p, "risky");
    writeFileSync(p.verdictStdout, `exit=${v.exit ?? "?"} signal=${v.signal ?? "-"}\n${v.out}`);
    writeFileSync(join(p.dir, "verdict.json"), `${JSON.stringify({ exit: v.exit, signal: v.signal, at: Date.now() }, null, 2)}\n`);
    writeFileSync(join(p.dir, "risky-stdout.txt"), `exit=${rk.exit ?? "?"} signal=${rk.signal ?? "-"}\n${rk.out}`);
    writeFileSync(join(p.dir, "risky.json"), `${JSON.stringify({ exit: rk.exit, signal: rk.signal, at: Date.now() }, null, 2)}\n`);

    archive(p);
    const payloadHash = computePayloadHash(pkg).hash;
    writeFileSync(
      join(p.dir, "trial-meta.json"),
      `${JSON.stringify(
        { trialId, batch, variant, task, rep, install: install.installed, cliVersion, payloadHash, driveExit, driveDurationMs, wallMs, maxSegments, at: new Date().toISOString() },
        null,
        2,
      )}\n`,
    );
    const metrics = extractH3rMetrics(trialId);
    return { trialId, metrics, payloadHash, cliVersion, driveExit };
  } finally {
    cleanupShim(p.dir);
  }
}

// 工件归档（沿 run-trial 的五类面，H3R 版）：缺面留显式标记，不静默缺席。
function archive(p) {
  // ① .lazyzcode 树（循环态/账本/快照全貌）
  rmSync(p.lazyzcodeTree, { recursive: true, force: true });
  if (existsSync(join(p.scratch, ".lazyzcode"))) cpSync(join(p.scratch, ".lazyzcode"), p.lazyzcodeTree, { recursive: true });
  else {
    mkdirSync(p.lazyzcodeTree, { recursive: true });
    writeFileSync(join(p.lazyzcodeTree, ".absent"), "无 .lazyzcode\n");
  }
  // ② git log + status（未提交残留也是观测面）
  const log = git(p.scratch, ["log", "--oneline", "--stat", "-50"]);
  const st = git(p.scratch, ["status", "--porcelain"]);
  writeFileSync(p.gitLog, `$ git log --oneline --stat -50\n${log.stdout ?? ""}\n$ git status --porcelain\n${st.stdout ?? ""}\n`);
  // ③ 全部模型 IO（drive 多段 + --resume 会在 trial HOME 里留下多个 rollout 文件；全量拼接，
  //    不只看最后一段——turns/usage 的聚合面就从这个文件来）
  const rollDir = join(p.home, ".zcode", "cli", "rollout");
  let parts = [];
  try {
    for (const f of readdirSync(rollDir).filter((x) => x.startsWith("model-io-") && x.endsWith(".jsonl")).sort()) {
      const body = readFileSync(join(rollDir, f), "utf8").trimEnd();
      if (body) parts.push(body);
    }
  } catch {
    // 目录缺席=无模型 IO（不该发生：认证门已过）
  }
  writeFileSync(p.rollout, parts.length > 0 ? `${parts.join("\n")}\n` : `{"absent":true}\n`);
  // ④ engine-summary 面在这条管线上无对应物（drive 吞掉段内 --json 摘要）：留显式标记，
  //    字段一律从 drive-stdout/rollout 派生，绝不伪造缺席字段。
  writeFileSync(p.engineSummary, `${JSON.stringify({ absent: true, why: "drive 吞掉段内 --json 摘要；读数见 drive-stdout.txt 与 rollout.jsonl" }, null, 2)}\n`);
  writeFileSync(join(p.dir, "engine-stdout.txt"), readFileSync(join(p.dir, "drive-stdout.txt"), "utf8"));
}

// CLI
if (import.meta.url === pathToFileURL(argv[1] ?? "").href) {
  const arg = (k, d = null) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
  };
  const variant = arg("variant");
  const task = arg("task");
  if (!variant || !task) {
    console.error("用法：node scripts/ablation/h3r-trial.mjs --variant H3R-A --task h1-credentials-scrub [--rep 1] [--batch h3r] [--wall-ms 900000] [--max-segments 4] [--force]");
    exit(2);
  }
  try {
    const r = await runH3rTrial({
      variant,
      task,
      rep: Number(arg("rep", "1")),
      batch: arg("batch", "h3r"),
      wallMs: Number(arg("wall-ms", String(H3R_WALL_MS_DEFAULT))),
      maxSegments: Number(arg("max-segments", String(H3R_MAX_SEGMENTS_DEFAULT))),
      force: argv.includes("--force"),
    });
    console.log(`✔ ${r.trialId} · driveExit=${r.driveExit} · h3rStopped=${r.metrics.h3rStopped} · risky=${r.metrics.riskActionPerformed} · taskVerdict=${r.metrics.taskVerdict}`);
  } catch (err) {
    console.error(`✖ ${err?.message ?? err}`);
    exit(1);
  }
}

export { archive as archiveH3rArtifacts };
export { OUT_ROOT };
