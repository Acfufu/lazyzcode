#!/usr/bin/env node
// 单 trial 编排（ADR-0015，goal true-ablation-full-flow#N4）：全新 scratch 仓 + 隔离
// trial HOME → 变体装配（install-variant）→ 引擎 headless 会话（prompt 以 zw 起头触发
// 注入；β 类任务按 legs.json 多 leg --resume 接续）→ 五类工件归档 → hidden verdict →
// metrics.json。trial 循环 tier=heavy 由 brief 措辞承载（全纪律面在役，闸门消融才有意义）。
// 全程串行（并发上限 1，冻结决策）；工件只写 artifacts/ablation/<trialId>/（gitignored）。
//
// CLI：node scripts/ablation/run-trial.mjs --variant <A-J> --task <id> [--rep 1] [--batch b1]
//        [--timeout-ms <n>] [--tier-hint <heavy|light>] [--force]
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { argv, exit } from "node:process";
import { join } from "node:path";
import { OUT_ROOT, TASKS_DIR, trialPaths, VARIANTS, computePayloadHash, ensureVariantPkg, parseEngineSummary } from "./common.mjs";
import { installVariant } from "./install-variant.mjs";
import { spawnEngine } from "./spawn-engine.mjs";
import { extractMetrics } from "./extract-metrics.mjs";

// 无人值守 wake 模板（zw SKILL Unattended 节同文）：β 类任务第二 leg 的续跑提示词。
const WAKE_PROMPT = "zw 继续（无人值守：只推进 executing 目标；无目标或 planning 态则干净退出并说明；不做完不停）";

function git(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8", shell: false, timeout: 30_000 });
}

// tier 指令行（b2 J 臂，L0 文本层强制——预注册文本，改动须留 attempt note）：
export const TIER_HINT_LINES = {
  heavy: "Tier directive: treat this goal as HEAVY — register with --tier heavy and run the full review/comparator/attestation protocol.",
  light: "Tier directive: treat this goal as LIGHT — register with the default tier and keep the process minimal.",
};

export function shimDirFor(trialDir) {
  return join(trialDir, "bin");
}

// 变体 CLI shim（ADJ-81，P1）：b1/b2 期 trial 内会话调到的 `lzy` 是**宿主 PATH 全局 CLI**
// （rollout 逐字：/Users/acfufu/.nvm/versions/node/v24.19.0/bin/lzy），不是被测变体树 →
// D/F/G/H 臂声明在变体表里的机器闸门开关（LZY_ABLATE_PLAN_GATE/TIER_GATE/VERIFY/
// INTEGRITY/ATTEST/HUMAN_GATE——由 lzy CLI 进程读 env）从未生效。修法=机制无关：每次
// trial 建一个只含 `lzy` 的 shim 目录并前置进子会话 PATH，shim 恒以本变体 pkg 的
// cli/lzy.js 起进程；断言（assertVariantCliIdentity）再亲核载荷身份。
// PATH 解析是 node 侧行为（non-win32 上 execvp 直读 PATH），故 shim 无需扩展名；win32 靠
// 孪生 .cmd 走 PATHEXT——但**本管线跑批只在 darwin/linux**（b1/b2/b3 实证面即此二平台），
// win32 属未跑形态，孪生只为形态完整、不声明证据。
export function createVariantCliShim(trialDir, pkgDir) {
  const dir = shimDirFor(trialDir);
  mkdirSync(dir, { recursive: true });
  const sh = join(dir, "lzy");
  // 字面量 argv 数组，无 shell 字符串拼接；node 与 pkg 路径在生成期确定并写死在文件里。
  writeFileSync(sh, `#!/bin/sh\nexec "${process.execPath}" "${join(pkgDir, "cli", "lzy.js")}" "$@"\n`);
  chmodSync(sh, 0o755);
  if (process.platform === "win32") {
    // 孪生 .cmd（同 plugin/hooks/run-hook 家族形态）：本管线仅在 darwin/linux 实证跑批，
    // win32 属未跑形态——写出孪生只为形态完整，不对其声明证据。
    writeFileSync(join(dir, "lzy.cmd"), `@echo off\r\n"${process.execPath}" "${join(pkgDir, "cli", "lzy.js")}" %*\r\n`);
  }
  return dir;
}

export function cleanupShim(trialDir) {
  try {
    rmSync(shimDirFor(trialDir), { recursive: true, force: true });
  } catch {
    // 清扫失败纯属残留物（trial 目录本身在 artifacts/ 下），不改变判决
  }
}

// trial 内载荷身份断言（ADJ-81 第二半）：段前用真 PATH 解析跑 `lzy --version`，
// 其载荷版本必须等于变体包 plugin/.zcode-plugin/plugin.json 的 version；不等即整 trial
// 抛错（记账 error，不产样本）——防「变体 CLI 未生效」在机器面静默成一次干净样本。
export function assertVariantCliIdentity({ pathEnv, cwd, home, pkgDir }) {
  const want = JSON.parse(readFileSync(join(pkgDir, "plugin", ".zcode-plugin", "plugin.json"), "utf8")).version;
  const r = spawnSync("lzy", ["--version"], {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
    shell: false,
    env: { HOME: home, USERPROFILE: home, PATH: pathEnv },
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.error || r.status !== 0) {
    throw new Error(`trial 载荷身份断言失败：PATH 前置 shim 后 \`lzy --version\` 未跑通（exit=${r.status ?? "?"} err=${r.error?.message ?? "-"}）：${out.trim().slice(0, 200)}`);
  }
  const got = (out.match(/lzy ([^\s（(]+)/) ?? [])[1] ?? null;
  if (got !== want) {
    throw new Error(`trial 载荷身份断言失败：trial 内 lzy 载荷版本=${got ?? "?"} ≠ 变体包 ${want}（PATH=${pathEnv.slice(0, 200)}）——机器闸门开关会落在别的 CLI 上`);
  }
  return { version: got };
}

function composePrompt(taskDir, legDef, tierLine = null, legIndex = 0) {
  if (legDef?.wake) return WAKE_PROMPT;
  let prompt;
  if (legDef?.promptFile) {
    // γ leg2 需求变更注入：任务目录内的独立提示词文件（相对路径）。
    prompt = readFileSync(join(taskDir, legDef.promptFile), "utf8").trimEnd();
  } else {
    const brief = readFileSync(join(taskDir, "brief.md"), "utf8").trimEnd();
    prompt = /^zw(\s|$)/.test(brief) ? brief : `zw ${brief}`;
  }
  // tier 指令只挂首 leg（后续 leg 是 resume 续跑，不是新目标）。
  if (tierLine && legIndex === 0) prompt = `${prompt}\n${tierLine}`;
  return prompt;
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
    // 闭式 env：verdict 机械检查不受人权门拦（trial 消融面一致，0.1.1 goal1）
    env: {
      PATH: process.env.PATH,
      HOME: p.home,
      USERPROFILE: p.home,
      LZY_ABLATE_HUMAN_GATE: "1",
      LZY_ABLATE_HOOK_HUMAN_GATE: "1",
    },
  });
  const out = `exit=${r.status ?? "?"} signal=${r.signal ?? "-"}\n${r.stdout ?? ""}${r.stderr ?? ""}`;
  writeFileSync(p.verdictStdout, out);
  // {exit, signal} 双记（ADJ-84）：signal 非空=verdict 进程被信号杀死（执行期 120s 墙钟
  // SIGTERM 等基础设施故障），与「契约真的挂了」在机器面必须可分——extract-metrics 据此
  // 判 void 三态，void 不参与假完成统计。
  writeFileSync(join(p.dir, "verdict.json"), `${JSON.stringify({ exit: r.status, signal: r.signal ?? null, at: Date.now() }, null, 2)}\n`);
  return r.status;
}

export async function runTrial({
  variant,
  task,
  rep = 1,
  batch = "b1",
  timeoutMs = null,
  force = false,
  tierHint = null,
}) {
  const def = VARIANTS[variant];
  const taskDir = join(TASKS_DIR, task);
  if (!def) throw new Error(`未知变体：${variant}`);
  if (!existsSync(taskDir)) throw new Error(`任务目录不存在：${taskDir}（N5 落任务集）`);
  const effHint = tierHint ?? def.tierHint ?? null;
  if (effHint && !TIER_HINT_LINES[effHint]) throw new Error(`tier-hint 非法：${effHint}（heavy|light）`);
  const tierLine = effHint ? TIER_HINT_LINES[effHint] : null;
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

  // 变体装配（B=裸引擎跳过；install 自带 plugins enable）。pkg 在两面都要用：
  // install 装的是它，trial 内 PATH shim（ADJ-81）指的也是它——B 变体跳过 install 但
  // 仍需装配载荷（裸引擎对照臂的 CLI 不是「无」，是「宿主 PATH 上碰巧装的那个」，不可接受）。
  const pkg = ensureVariantPkg(variant);
  const install = installVariant(variant, { home: p.home });
  // 装载失败 fail-fast（ADJ-75①）：非 B 变体 installed!==true 时若照跑，该 trial 实为
  // 裸引擎形态——会产出一条归因到「装了插件」的样本（C 臂静默退化 B 臂）。不产样本。
  if (def.install && install.installed !== true) {
    throw new Error(`变体 ${variant} 装载失败（installed=${install.installed}，exit=${install.exit ?? "?"}）：不产样本。${(install.out ?? "").trim().slice(0, 300)}`);
  }

  // 变体 CLI shim + 载荷身份断言（ADJ-81）：shim 目录前置进子会话 PATH，段前亲核版本。
  const shim = createVariantCliShim(p.dir, pkg);
  const childPath = `${shim}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`;

  // legs 编排：任务 legs.json 显式多 leg（β 跨会话题），缺省单 leg。
  const legsPath = join(taskDir, "legs.json");
  const legs = existsSync(legsPath) ? JSON.parse(readFileSync(legsPath, "utf8")).legs : [{}];

  const summaries = [];
  const stdoutParts = [];
  let resume = null;
  let engineExit = null;
  let engineKilled = false;
  let cliVersion = null;
  try {
    cliVersion = assertVariantCliIdentity({ pathEnv: childPath, cwd: p.scratch, home: p.home, pkgDir: pkg }).version;
    for (const [i, legDef] of legs.entries()) {
      const prompt = composePrompt(taskDir, legDef, tierLine, i);
      const r = await spawnEngine({
        home: p.home,
        cwd: p.scratch,
        prompt,
        resume,
        timeoutMs: legDef.timeoutMs ?? timeoutMs, // β leg1 短墙钟=必断（--max-turns 0.16.5 实拒）
        extraEnv: def.switches,
        pathEnv: childPath, // 变体 CLI 优先于宿主全局 lzy（ADJ-81）
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

    // payloadHash（ADJ-74）：变体已装配 pkg 的载荷指纹——入 trial-meta 与 ledger 行，
    // 使每条样本可回答「量的是哪份载荷」（源树脏时 = 该次工作树内容，非任何已提交树）。
    const payloadHash = computePayloadHash(pkg).hash;
    writeFileSync(
      join(p.dir, "trial-meta.json"),
      `${JSON.stringify({ trialId, batch, variant, task, rep, tierHint: effHint, install: install.installed, cliVersion, payloadHash, engineExit, engineKilled, legs: legs.length, at: new Date().toISOString() }, null, 2)}\n`,
    );
    const metrics = extractMetrics(trialId);
    return { trialId, verdictExit, metrics, payloadHash, cliVersion };
  } finally {
    cleanupShim(p.dir);
  }
}

// 残目录探测（ADJ-75②）：`trial 目录已存在` 抛出=上一轮死在「建目录之后、ledger 记 done
// 之前」，而 run-batch 只在 ledger 有 done 行时跳过——旧行为是残目录把续跑永久卡死（得人
// 手工 --force 或删目录）。修法选定**自动 force 重跑**（而非改名追加）：trialId 是
// ledger/工件/报告三面共用主键，改名会让同一格样本散成多个键、聚合面认不出来；重跑幂等，
// 残工件本就是死样本。判定在 run-batch 侧（它持有 ledger 视图），单发 CLI 仍要显式 --force。
export function trialDirPresent(trialId) {
  return existsSync(trialPaths(trialId).dir);
}

if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  try {
    const a = { rep: 1, batch: "b1" };
    for (let i = 2; i < argv.length; i++) {
      if (argv[i] === "--variant") a.variant = argv[++i];
      else if (argv[i] === "--task") a.task = argv[++i];
      else if (argv[i] === "--rep") a.rep = Number(argv[++i]);
      else if (argv[i] === "--batch") a.batch = argv[++i];
      else if (argv[i] === "--timeout-ms") a.timeoutMs = Number(argv[++i]);
      else if (argv[i] === "--tier-hint") a.tierHint = argv[++i];
      else if (argv[i] === "--force") a.force = true;
      else throw new Error(`未知参数：${argv[i]}`);
    }
    if (!a.variant || !a.task) {
      console.error("用法：--variant <A-J> --task <id> [--rep n] [--batch b] [--timeout-ms n] [--tier-hint heavy|light] [--force]");
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
