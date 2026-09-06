#!/usr/bin/env node
// lzy — LazyZCode CLI：install / sync / status / uninstall / loop / step。
// loop = 目标循环状态机（注册→计划门→逐步派发→证据验证→完成），状态在 .lazyzcode/。
import { resolve } from "node:path";
import { watch } from "node:fs";
import { install, sync, uninstall, readRepoManifest } from "../core/installer.js";
import { collectStatus } from "../core/status.js";
import { createEngineCli } from "../core/engine.js";
import { createGit } from "../core/git.js";
import {
  LoopError,
  abandonLoop,
  adoptPlan,
  completeStep,
  finishLoop,
  formatStatus,
  readGoal,
  registerGoal,
  resetLoop,
  startLoop,
  verifyEvidence,
} from "../core/loop.js";
import { findEngine, repoPluginDir } from "../core/paths.js";

const ICON = { ok: "✔", fail: "✖", warn: "⚠", skip: "➖" };

// `--key value` / `--key=value` / 裸旗标 → { _: 位置参数, f: 旗标表 }
function parseArgs(args) {
  const _ = [];
  const f = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) {
        f[a.slice(2, eq)] = a.slice(eq + 1);
      } else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        f[a.slice(2)] = args[++i];
      } else {
        f[a.slice(2)] = true;
      }
    } else {
      _.push(a);
    }
  }
  return { _, f };
}

async function cmdStatus() {
  const { checks, ok } = await collectStatus();
  console.log("lzy status");
  for (const c of checks) {
    console.log(`  ${ICON[c.state]} ${c.name.padEnd(12)} ${c.detail}`);
  }
  process.exitCode = ok ? 0 : 1;
}

async function cmdInstall() {
  const r = await install();
  console.log("lzy install");
  console.log(`  ✔ 载荷已部署   ${r.installPath}`);
  console.log(`  ✔ 注册表已更新 ${r.id} @ ${r.version}`);
  if (r.enabled) {
    console.log("  ✔ 已启用（引擎官方 plugins enable）");
    console.log("\n新开的 ZCode 会话自动装载。用 `lzy status` 复核。");
  } else {
    console.log("  ⚠ 启用未完成 —— 安装已就绪，还差一步：");
    console.log(r.note);
  }
}

async function cmdSyncOnce() {
  const r = await sync();
  console.log(`[lzy] 已同步 ${r.id}@${r.version} → ${r.installPath}`);
  console.log("[lzy] 已开启的会话不受影响；新会话生效。");
}

async function cmdSync(args) {
  if (args.includes("--watch")) {
    await cmdSyncOnce();
    console.log(`[lzy] watching ${repoPluginDir()} (--watch，Ctrl-C 退出)`);
    let timer = null;
    watch(repoPluginDir(), { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        cmdSyncOnce().catch((e) => console.error(`[lzy] 同步失败: ${e.message}`));
      }, 400);
    });
  } else {
    await cmdSyncOnce();
  }
}

async function cmdUninstall() {
  const r = await uninstall();
  console.log("lzy uninstall");
  console.log(`  ✔ ${r.id} 已卸载`);
  for (const s of r.steps) console.log(`  · ${s}`);
}

// ── 目标循环（lzy loop / lzy step）──────────────────────────────────────────
async function cmdLoop(args) {
  const { _, f } = parseArgs(args);
  const sub = _[0] ?? "status";
  const cwd = process.cwd();
  const git = createGit(cwd);

  switch (sub) {
    case "register": {
      const goal = registerGoal(cwd, _[1], f.title);
      console.log(`✔ 目标已注册：${goal.slug} — ${goal.title}（状态 planning）`);
      console.log("  下一步：写决策完备计划到 .lazyzcode/plans/<slug>.md，然后 lzy loop plan <文件>");
      return;
    }
    case "plan": {
      if (!_[1]) throw new LoopError("用法：lzy loop plan <计划文件> [--force]");
      const goal = adoptPlan(cwd, resolve(cwd, _[1]), { force: f.force === true });
      console.log(`✔ 计划门通过：${goal.steps.length} 项已采纳（N:${goal.steps.filter((s) => s.kind === "N").length} F:${goal.steps.filter((s) => s.kind === "F").length}）`);
      console.log("  下一步：lzy loop start 开跑");
      return;
    }
    case "start": {
      const goal = startLoop(cwd, git);
      console.log(`✔ 目标循环开跑：${goal.slug}（基线 tree ${(goal.baseTreeHash ?? "未知").slice(0, 10)}）`);
      const next = goal.steps[0];
      console.log(`  下一步 → ${next.id} [${next.kind}] ${next.title}`);
      return;
    }
    case "verify": {
      const { current, fresh, stale, unbound } = verifyEvidence(cwd, git);
      console.log(`当前 tree ${(current ?? "未知").slice(0, 10)}`);
      for (const [label, list] of [["新鲜", fresh], ["过期", stale], ["未绑定", unbound]]) {
        console.log(`  ${label} ${list.length}${list.length ? `：${list.map((s) => s.id).join(" ")}` : ""}`);
      }
      return;
    }
    case "finish": {
      const goal = finishLoop(cwd, git);
      console.log(`✔✔ 目标完成：${goal.slug} — ${goal.title}`);
      console.log("  全部步骤收口，F 项证据绑定当前 tree hash。不做完不停——这次真的做完了。");
      return;
    }
    case "abandon": {
      const goal = abandonLoop(cwd);
      console.log(`⚠ 目标已放弃：${goal.slug}（证据与计划保留在 .lazyzcode/）`);
      return;
    }
    case "reset": {
      const goal = resetLoop(cwd);
      console.log(`✔ 已清除目标状态：${goal.slug}`);
      return;
    }
    case "status":
      console.log(formatStatus(cwd, git));
      return;
    default:
      throw new LoopError(`未知 loop 子命令：${sub}（register/plan/start/status/verify/finish/abandon/reset）`);
  }
}

async function cmdStep(args) {
  const { _, f } = parseArgs(args);
  const action = _[0];
  if (action !== "done") {
    throw new LoopError("用法：lzy step done <ID> [--note …] [--evidence …]（F 项必须带证据）");
  }
  if (!_[1]) throw new LoopError("缺少步骤 ID：lzy step done <ID> …");
  const cwd = process.cwd();
  const { step, goal, rebinding, dirty } = completeStep(cwd, createGit(cwd), _[1], {
    note: typeof f.note === "string" ? f.note : null,
    evidence: typeof f.evidence === "string" ? f.evidence : null,
  });
  console.log(`${rebinding ? "↻" : "✔"} 步骤${rebinding ? "重取证" : "完成"}：${step.id} [${step.kind}] ${step.title}（${goal.steps.filter((s) => s.status === "done").length}/${goal.steps.length}）`);
  if (dirty) {
    console.log("  ⚠ 工作区有未提交改动：证据应跟随提交（先 commit 再取证，否则 tree hash 不含这些改动）");
  }
  if (step.evidence) {
    console.log(`  证据已绑定 tree ${(step.evidence.treeHash ?? "未绑定").slice(0, 10)}：${step.evidence.text.slice(0, 80)}`);
  }
  const pending = goal.steps.find((s) => s.status === "pending");
  console.log(pending ? `  下一步 → ${pending.id} [${pending.kind}] ${pending.title}` : "  全部步骤已收口 → lzy loop finish 做终验");
}

async function cmdVersion() {
  let v = "unknown";
  try {
    v = readRepoManifest().version;
  } catch {}
  const ev = createEngineCli(findEngine()).version();
  console.log(`lzy ${v}（插件载荷同版本）· 引擎 ${ev ?? "未找到"}`);
}

function printHelp() {
  console.log(`lzy — LazyZCode 纪律层 CLI

安装管理：
  lzy install      安装并启用插件（落位引擎缓存 + 注册表 + 官方 plugins enable）
  lzy sync         重新部署仓库 plugin/ 载荷（热重载；新会话生效）；--watch 持续监听
  lzy status       检查引擎/安装/启用/装载/目标循环状态（只读，退出码 0=健康）
  lzy uninstall    卸载插件（优先官方 plugins uninstall）

目标循环（状态在工作区 .lazyzcode/）：
  lzy loop register <slug> --title <标题>   注册目标（进入 planning）
  lzy loop plan <计划文件> [--force]        计划门：采纳 N/F 清单（默认拒绝待定项）
  lzy loop start                            开跑（planning → executing，记基线 tree hash）
  lzy loop status                           查看进度与下一步
  lzy step done <ID> [--note …] [--evidence …]  收口一步（F 项必须带真实表面证据）
  lzy loop verify                           证据时效核对（tree hash 绑定）
  lzy loop finish                           终验完成（全部 done + F 证据新鲜才放行）
  lzy loop abandon / reset                  放弃 / 清除状态

环境：
  LZY_ZCODE_ENGINE  显式指定引擎 zcode.cjs 路径（默认找 /Applications/ZCode.app/...）

设计红线：lzy 对用户 config.json 零写入；启用一律经引擎官方命令（docs/adr/0001）。
证据纪律：F 项证据绑定 tree hash，代码一变旧证据作废；测试全绿≠证据。`);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === undefined || cmd === "help" || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }
  switch (cmd) {
    case "install":
      return cmdInstall();
    case "sync":
      return cmdSync(args);
    case "status":
      return cmdStatus();
    case "uninstall":
      return cmdUninstall();
    case "loop":
      return cmdLoop(args.slice(1));
    case "step":
      return cmdStep(args.slice(1));
    case "version":
    case "--version":
    case "-v":
      return cmdVersion();
    default:
      console.error(`未知命令：${cmd}\n`);
      printHelp();
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`[lzy] ${err?.message ?? err}`);
  process.exitCode = 1;
});
