#!/usr/bin/env node
// lzy — LazyZCode CLI：install / sync / status / uninstall / loop / step。
// loop = 目标循环状态机（注册→计划门→逐步派发→证据验证→完成），状态在 .lazyzcode/。
import { resolve } from "node:path";
import { watch } from "node:fs";
import { install, sync, uninstall, readRepoManifest } from "../core/installer.js";
import { collectStatus } from "../core/status.js";
import { collectDoctor } from "../core/doctor.js";
import { createEngineCli } from "../core/engine.js";
import { createGit } from "../core/git.js";
import {
  LoopError,
  abandonLoop,
  adoptPlan,
  claimStep,
  completeStep,
  exportReport,
  finishLoop,
  formatClaimList,
  formatHistory,
  formatRepoList,
  formatStatus,
  handoffGoal,
  readGoal,
  registerGoal,
  resetLoop,
  startLoop,
  verifyEvidence,
} from "../core/loop.js";
import { findEngine, repoPluginDir, userCliLogDir } from "../core/paths.js";
import { collectRateLimitStats, bandAdvisory } from "../core/ratelimit.js";
import { auditAgentsMd, formatAgentsMd } from "../core/agentsmd.js";
import { formatCost } from "../core/cost.js";

const ICON = { ok: "✔", fail: "✖", warn: "⚠", skip: "➖" };

// `--key value` / `--key=value` / 裸旗标 → { _: 位置参数, f: 旗标表 }
// 只有值旗标白名单内的才吃下一个参数（评审 R2-8：--force plan.md 不再把路径吞成值）；
// `=` 形式的 true/false 归一为布尔（评审 R2-8：--force=true 不再被当成字符串判 false）；
// MULTI_FLAGS 可重复出现追加成数组（--evidence-file a --evidence-file b）。
const VALUE_FLAGS = new Set(["title", "review", "note", "evidence", "evidence-file", "root"]);
const MULTI_FLAGS = new Set(["evidence-file"]);

function parseArgs(args) {
  const _ = [];
  const f = {};
  const push = (k, v) => {
    if (MULTI_FLAGS.has(k)) {
      if (!Array.isArray(f[k])) f[k] = typeof f[k] === "string" ? [f[k]] : [];
      f[k].push(v);
    } else {
      f[k] = v;
    }
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) {
        const k = a.slice(2, eq);
        const v = a.slice(eq + 1);
        push(k, v === "true" ? true : v === "false" ? false : v);
      } else if (
        VALUE_FLAGS.has(a.slice(2)) &&
        i + 1 < args.length &&
        !args[i + 1].startsWith("--")
      ) {
        push(a.slice(2), args[++i]);
      } else {
        push(a.slice(2), true);
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

async function cmdDoctor() {
  const { checks, ok } = await collectDoctor();
  console.log("lzy doctor（本地诊断，零遥测）");
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
  const watchArg = args.find((a) => a === "--watch" || a.startsWith("--watch="));
  if (watchArg && watchArg !== "--watch") {
    // 不再静默退化（评审 R3-13a）：显式告知按一次性执行。
    console.error(`[lzy] ⚠ ${watchArg} 形式不支持（--watch 不接值）；本次按一次性 sync 执行`);
  }
  if (watchArg) {
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
  console.log(
    r.installed
      ? `  ✔ ${r.id} 已卸载`
      : `  ➖ 未发现 ${r.id} 的安装物（注册表与缓存均无记录，无改动）`,
  );
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
      if (!_[1]) throw new LoopError("用法：lzy loop plan <计划文件> [--review \"plan-reviewer: PASS …\"] [--force]");
      const review = typeof f.review === "string" ? f.review : null;
      const goal = adoptPlan(cwd, resolve(cwd, _[1]), { force: f.force === true, review });
      console.log(`✔ 计划门通过：${goal.steps.length} 项已采纳（N:${goal.steps.filter((s) => s.kind === "N").length} F:${goal.steps.filter((s) => s.kind === "F").length}）`);
      if (review) {
        console.log(`  评审记录：${goal.review.verdict} · ${goal.review.at}`);
      } else {
        console.log("  ⚠ 未带 --review：HEAVY tier 须先过 plan-reviewer 评审门（判决 PASS 后带 --review 采纳）");
      }
      console.log("  下一步：lzy loop start 开跑");
      return;
    }
    case "start": {
      const goal = startLoop(cwd, git);
      console.log(`✔ 目标循环开跑：${goal.slug}（基线 tree ${(goal.baseTreeHash ?? "未知").slice(0, 10)}）`);
      const next = goal.steps[0];
      console.log(`  下一步 → ${next.id} [${next.kind}] ${next.title}`);
      // 带内调度建议（tier-2）：实测限流数据 → 子代理并行上限。尽力而为（fail-open），
      // 扫描失败/无日志都不阻断开跑。
      try {
        const stats = await collectRateLimitStats(userCliLogDir());
        if (stats.available) {
          const adv = bandAdvisory(stats, new Date());
          console.log(`  并发纪律：子代理并行上限 ${adv.cap} —— ${adv.reason}`);
          const t = stats.truncation;
          if (t && (t.truncatedFiles > 0 || t.timeExceeded)) {
            const mb = Math.round(t.bytesSkipped / 1048576);
            console.log(
              `  ⚠ 限流样本截断（带估算基于不全样本：略头部 ${mb}MB${t.timeExceeded ? " + 扫描超时" : ""}）`,
            );
          }
        }
      } catch {}
      return;
    }
    case "verify": {
      const { current, fresh, stale, unbound } = verifyEvidence(cwd, git);
      console.log(`当前 tree ${(current ?? "未知").slice(0, 10)}`);
      for (const [label, list] of [["新鲜", fresh], ["过期", stale], ["未绑定", unbound]]) {
        console.log(`  ${label} ${list.length}${list.length ? `：${list.map((s) => s.id).join(" ")}` : ""}`);
      }
      process.exitCode = stale.length + unbound.length > 0 ? 1 : 0;
      return;
    }
    case "finish": {
      const goal = finishLoop(cwd, git);
      console.log(`✔✔ 目标完成：${goal.slug} — ${goal.title}`);
      console.log("  全部步骤收口，F 项证据绑定当前 tree hash。不做完不停——这次真的做完了。");
      try {
        const r = exportReport(cwd, git);
        console.log(`  证据包已归档：${r.path}（人接管评审从这份材料开始）`);
      } catch (e) {
        console.log(`  ⚠ 证据包导出失败：${e.message}`);
      }
      console.log("  收尾：把本目标 2–3 条可复用教训写进宿主项目 memory，下个会话自动可用。");
      console.log("  提醒：若本工作区挂过 wake automation（无人值守唤起），到 App 自动化管理停用（空槽唤起=纯空转）。");
      return;
    }
    case "export": {
      const r = exportReport(cwd, git);
      console.log(`✔ 证据包已导出：${r.path}`);
      return;
    }
    case "abandon": {
      const goal = abandonLoop(cwd, git);
      console.log(`⚠ 目标已放弃：${goal.slug}（证据与计划保留在 .lazyzcode/）`);
      if (goal.salvage) {
        console.log(`  可回收工件已盘点：${goal.salvage.path}（未提交 ${goal.salvage.dirty} · 尾注提交 ${goal.salvage.commits}）`);
      }
      console.log("  提醒：若本工作区挂过 wake automation（无人值守唤起），到 App 自动化管理停用（空槽唤起=纯空转）。");
      return;
    }
    case "reset": {
      const goal = resetLoop(cwd, git);
      console.log(`✔ 已清除目标状态：${goal.slug}`);
      if (goal.salvage) {
        console.log(`  可回收工件已盘点：${goal.salvage.path}（未提交 ${goal.salvage.dirty} · 尾注提交 ${goal.salvage.commits}）`);
      }
      return;
    }
    case "handoff": {
      const snap = typeof f.snapshot === "string" ? f.snapshot : _[1];
      if (!snap) {
        throw new LoopError(
          "用法：lzy loop handoff --snapshot <快照文件>（先把交接状态写入快照，再登记交接）",
        );
      }
      const marker = handoffGoal(cwd, snap, git.treeHash());
      console.log("✔ 交接已登记：下一次 Stop 钩子将消费标记并放行（目标保持 executing，状态在盘）");
      console.log(`  快照：${marker.snapshot}`);
      console.log("  下一步：结束本会话；用户开新上下文后以「zw 继续」续跑");
      return;
    }
    case "claim": {
      // 步级认领（决策 #21 最小链）：带 id=认领/释放，无参=可认领集列表（多工人挑步面）。
      const id = _[1];
      if (f.release !== undefined && f.release !== true && f.release !== false) {
        throw new LoopError(`--release 是裸旗标不吃值（收到 --release=${f.release}）；强制释放用 --release`);
      }
      if (!id) {
        if (f.release === true) {
          throw new LoopError("用法：lzy loop claim <id> --release（无参形式列出可认领集，不接 --release）");
        }
        console.log(formatClaimList(cwd));
        return;
      }
      if (_[2]) throw new LoopError(`多余参数：${_[2]}（用法：lzy loop claim [<id>] [--release]）`);
      const r = claimStep(cwd, id, { release: f.release === true });
      if (r.released) {
        console.log(`✔ 认领已释放：${r.step.id} [${r.step.kind}] ${r.step.title}`);
      } else {
        console.log(
          `✔ 步骤已认领：${r.step.id} [${r.step.kind}] ${r.step.title}（匿名互斥 48h；step done 自动释放；提前释放 lzy loop claim ${r.step.id} --release）`,
        );
      }
      return;
    }
    case "status":
      console.log(formatStatus(cwd, git));
      return;
    case "list":
      // 只读跨仓诊断（never-throw 读面）：扫锚目录一级子目录的循环状态。
      console.log(formatRepoList(cwd, typeof f.root === "string" ? f.root : null));
      return;
    case "history":
      // 目标谱系读面（pisper-absorption#N4，只读）：证据包 ∪ salvage 存根 ∪ git 尾注三源并集。
      console.log(formatHistory(cwd, git));
      return;
    case "cost":
      // 积分成本报表（plan-v2 Phase 2-2，只读）：账本缺席/sqlite3 缺席均降级输出不翻码。
      console.log(formatCost(cwd, readGoal(cwd)));
      return;
    default:
      throw new LoopError(`未知 loop 子命令：${sub}（register/plan/start/claim/status/list/history/cost/verify/finish/export/abandon/reset/handoff）`);
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
  const rawFiles = f["evidence-file"];
  const files = Array.isArray(rawFiles)
    ? rawFiles.map((p) => resolve(cwd, p))
    : typeof rawFiles === "string"
      ? [resolve(cwd, rawFiles)]
      : null;
  const { step, goal, rebinding, dirty } = completeStep(cwd, createGit(cwd), _[1], {
    note: typeof f.note === "string" ? f.note : null,
    evidence: typeof f.evidence === "string" ? f.evidence : null,
    files,
  });
  console.log(`${rebinding ? "↻" : "✔"} 步骤${rebinding ? "重取证" : "完成"}：${step.id} [${step.kind}] ${step.title}（${goal.steps.filter((s) => s.status === "done").length}/${goal.steps.length}）`);
  if (dirty) {
    console.log("  ⚠ 工作区有未提交改动：证据应跟随提交（先 commit 再取证，否则 tree hash 不含这些改动）");
  }
  if (step.evidence) {
    console.log(`  证据已绑定 tree ${(step.evidence.treeHash ?? "未绑定").slice(0, 10)}：${step.evidence.text.slice(0, 80)}`);
    for (const file of step.evidence.files ?? []) {
      console.log(`  附件 ${file.path}（sha256 ${file.sha256.slice(0, 12)}… · ${file.bytes} bytes）`);
    }
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

// ── 项目记忆（AGENTS.md 分层审计，tier-1 init-deep）────────────────────────
async function cmdAgentsMd() {
  const cwd = process.cwd();
  console.log("lzy agents-md（AGENTS.md 分层审计——只读，写盘归 init-deep 技能且草稿先行）");
  const a = auditAgentsMd(cwd);
  for (const line of formatAgentsMd(a).split("\n")) {
    console.log(`  ${line}`);
  }
  process.exitCode = a.missing.length + a.over.length > 0 ? 1 : 0;
}

function printHelp() {
  console.log(`lzy — LazyZCode 纪律层 CLI

安装管理：
  lzy install      安装并启用插件（落位引擎缓存 + 注册表 + 官方 plugins enable）
  lzy sync         重新部署仓库 plugin/ 载荷（热重载；新会话生效）；--watch 持续监听
  lzy status       检查引擎/安装/启用/装载/目标循环状态（只读；退出码 0=无 fail 级检查，warn/skip 不影响）
  lzy doctor       深度本地诊断：status 全套 + hook 语法自检/node 下限/lzy 解析/状态卫生/限流体检
  lzy uninstall    卸载插件（优先官方 plugins uninstall）

目标循环（状态在工作区 .lazyzcode/）：
  lzy loop register <slug> --title <标题>   注册目标（进入 planning）
  lzy loop plan <计划文件> [--force]        计划门：采纳 N/F 清单（默认拒绝待定项）
  lzy loop start                            开跑（planning → executing，打印实测并发纪律行）
  lzy loop claim [<id>] [--release]         步级认领（决策 #21）：占步互斥 48h；无参列出可
                                            认领集（同目标多工人挑步）；done 自动释放
  lzy loop status                           查看进度与下一步
  lzy loop list [--root <目录>]             跨仓清单（只读）：扫锚目录一级子目录各仓的循环
                                            状态（默认锚=当前目录的同级，含自身）
  lzy loop history                         目标谱系（只读）：证据包 ∪ salvage 存根 ∪ git
                                            尾注三源并集，按最近活动排序
  lzy loop cost                             积分成本报表（只读计费账本折算：常设系数+促销
                                            overlay 自动回落；目标归因为简化 OR+人工复核口径）
  lzy step done <ID> [--note …] [--evidence …] [--evidence-file <文件>]…
                                            收口一步（F 项必须带真实表面证据；附件复制入
                                            .lazyzcode/evidence/ 并绑 sha256，≤4 个/项）
  lzy loop verify                           证据时效核对（退出码 0=全部新鲜，1=有过期/未绑定）
  lzy loop finish                           终验完成（全部 done + F 证据新鲜才放行；自动归档证据包）
  lzy loop export                           重导出证据包到 .lazyzcode/evidence/<slug>.report.md
  lzy loop abandon / reset                  放弃 / 清除状态

项目记忆（AGENTS.md 分层，确定性审计——写盘归 init-deep 技能且草稿先行）：
  lzy agents-md    资格谓词+覆盖审计详单（退出码 0=覆盖完整无超限，1=有缺口/超限）

环境：
  LZY_ZCODE_ENGINE  显式指定引擎 zcode.cjs 路径；设置后替换默认候选（默认找 /Applications/ZCode.app/...，
                    也因此可指向不存在路径来测试「引擎缺失→手动启用」回退）

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
    case "doctor":
      return cmdDoctor();
    case "uninstall":
      return cmdUninstall();
    case "loop":
      return cmdLoop(args.slice(1));
    case "step":
      return cmdStep(args.slice(1));
    case "agents-md":
      return cmdAgentsMd();
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
