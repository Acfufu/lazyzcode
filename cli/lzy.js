#!/usr/bin/env node
// lzy — LazyZCode CLI：install / sync / status / uninstall / loop / step。
// loop = 目标循环状态机（注册→计划门→逐步派发→证据验证→完成），状态在 .lazyzcode/。
import { join, resolve } from "node:path";
import { readdirSync, watch } from "node:fs";
import { assertNodeFloor, install, sync, uninstall, readRepoManifest, readRegistry } from "../core/installer.js";
import { createUpdater } from "../core/update.js";
import { collectStatus } from "../core/status.js";
import { collectDoctor, NODE_MAJOR_FLOOR } from "../core/doctor.js";
import { createEngineCli } from "../core/engine.js";
import { createGit } from "../core/git.js";
import {
  LoopError,
  abandonLoop,
  addSubject,
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
  bindDeliveryContract,
  fingerprintSubjects,
  noGoalMessage,
  readGoal,
  recordEvidenceHalf,
  registerGoal,
  removeSubject,
  requireGoalPreLock,
  resetLoop,
  setRisk,
  setTier,
  startLoop,
  supersedePlan,
  verifyEvidence,
  withLock,
  writeGoalReport,
} from "../core/loop.js";
import { effectiveAuthorization, loadContract } from "../core/contract.js";
import { projectCheck, projectDiscover } from "../core/project.js";
import { listReceipts, qualifyCheck, queryCiChecks, reuseRun, runCheck, showReceipt, VerifyError } from "../core/verify.js";
import { previewMigration, renderMigrationPreview } from "../core/migrate.js";
import { formatAttempts } from "../core/attempt.js";
import {
  acquireLease,
  assertFenceIfPresent,
  formatBudget,
  heartbeatLease,
  initBudget,
  reclaimLease,
  recordSpend,
  releaseLease,
} from "../core/runtime.js";
import {
  dependents as dagDependents,
  findGreenByGeneration,
  loadDag,
  stalePreview,
} from "../core/dag.js";
import { recordComparatorAttestation } from "../core/attest.js";
import { findEngine, pluginsRoot, repoPluginDir, userCliLogDir } from "../core/paths.js";
import { collectRateLimitStats, bandAdvisory } from "../core/ratelimit.js";
import { auditAgentsMd, formatAgentsMd } from "../core/agentsmd.js";
import { formatCost, rollingWaterlinePoints } from "../core/cost.js";
import { runDrive } from "../core/drive.js";
import {
  addQueueItem,
  budgetView,
  cancelQueueItem,
  formatQueueList,
  QueueError,
  reconcileDispatch,
  runQueueDispatch,
  setQueueBudget,
  showQueueItem,
} from "../core/queue.js";
import {
  actDeliveryB,
  actDeliveryC,
  deliveryStatus,
  readbackDeliveryB,
  readbackDeliveryC,
  validateDeliveryContract,
} from "../core/delivery.js";

const ICON = { ok: "✔", fail: "✖", warn: "⚠", skip: "➖" };

// `--key value` / `--key=value` / 裸旗标 → { _: 位置参数, f: 旗标表 }
// 只有值旗标白名单内的才吃下一个参数（评审 R2-8：--force plan.md 不再把路径吞成值）；
// `=` 形式的 true/false 归一为布尔（评审 R2-8：--force=true 不再被当成字符串判 false）；
// MULTI_FLAGS 可重复出现追加成数组（--evidence-file a --evidence-file b）。
const VALUE_FLAGS = new Set(["title", "review", "note", "evidence", "evidence-file", "root", "tier", "surface", "reason", "goal", "file", "harness", "fence", "ttl-ms", "wall-ms", "ms", "points", "risk", "max-segments", "mode", "snapshot", "workers", "contract", "accepts", "of", "sha", "repo", "plan", "endpoint", "deps", "goal-slug", "item", "branch", "head", "base", "pr-title", "pr-body-file", "pr", "expect-marker", "content-url"]);
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
      } else if (VALUE_FLAGS.has(a.slice(2))) {
        // 裸值旗标（漏值，ADJ-80，0.2.1）：旧实现静默默认 true，下游 `title?.trim` 之类
        // 才炸出 TypeError（用户看到的是内部错误而非用法错）。这里直接 fail-loud——
        // 同族先例=lzy loop claim 的 `--release` 裸旗标校验。--fence 走同一文案口径
        //（ADJ-27：裸旗标/空串/科学计数都是「须为正整数」的用法错）。
        const name = a.slice(2);
        throw new LoopError(
          name === "fence"
            ? "--fence 须为正整数（收到 --fence（裸旗标/缺值））；用法：--fence <n>"
            : `--${name} 缺值：本旗标需要 <value>（用法见 lzy help）`,
        );
      } else {
        push(a.slice(2), true);
      }
    } else {
      _.push(a);
    }
  }
  // --fence→env 桥（0.2.0 棒1 ADR-0020）：fence 写路径守卫单源读 LZY_RUNTIME_FENCE，
  // 命令级 --fence 旗标在解析完成后桥接（旗标=显式逐命令意图，覆盖继承 env）。
  // ADJ-27（0.2.1）：桥门做归一校验——空串/裸旗标/科学计数法（1e9 被 parseInt 截成 1）
  // 曾静默落回「未申报」直通或申报成另一个数（`--fence abc` 更被误导为「你已被接管」）。
  // 契约：--fence 须为正整数，否则显式用法错（与 lease 面同文案口径）。
  if (f.fence !== undefined) {
    const raw = typeof f.fence === "string" ? f.fence.trim() : f.fence;
    const n = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(n) || n <= 0) {
      throw new LoopError(
        `--fence 须为正整数（收到 ${typeof f.fence === "string" ? `--fence ${JSON.stringify(f.fence)}` : "--fence（裸旗标/缺值）"}）；用法：--fence <n>`,
      );
    }
    process.env.LZY_RUNTIME_FENCE = String(n);
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
  assertNodeFloor(NODE_MAJOR_FLOOR); // 债六：低版本 Node 在安装时撞错，不在运行时
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
  assertNodeFloor(NODE_MAJOR_FLOOR); // 债六：预检在 watch 循环前，每事件回调不重复报
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

// 一键升级（ADR-0012）：npm 拉最新包，再由新装路径的全新子进程执行 sync——
// 本进程还持旧代码，进程内 sync 是「旧逻辑部署新载荷」，绝不做。
async function cmdUpdate() {
  const r = await createUpdater().update();
  console.log("lzy update");
  for (const line of r.lines) console.log(`  ${line}`);
  process.exitCode = r.code !== 0 ? r.code : process.exitCode;
}

// ── 目标循环（lzy loop / lzy step）──────────────────────────────────────────
async function cmdLoop(args) {
  const { _, f } = parseArgs(args);
  const sub = _[0] ?? "status";
  const cwd = process.cwd();
  const git = createGit(cwd);

  switch (sub) {
    case "register": {
      const goal = registerGoal(cwd, _[1], f.title, {
        tier: typeof f.tier === "string" ? f.tier : undefined,
        risk: typeof f.risk === "string" ? f.risk : undefined,
        contract: typeof f.contract === "string" ? f.contract : null,
      });
      console.log(`✔ 目标已注册：${goal.slug} — ${goal.title}（状态 planning · tier ${goal.tier} · risk ${goal.risk ?? "low"}）`);
      if (goal.contract) {
        console.log(`  契约已绑定：${goal.contract.path}（contractHash ${goal.contract.contractHash.slice(0, 8)}…）`);
        console.log("  采纳计划时走契约门：首次采纳将索「批准 <契约短码>」，契约内重规划不再逐版批准（ADR-0024）");
      }
      console.log("  下一步：写决策完备计划到 .lazyzcode/plans/<slug>.md，然后 lzy loop plan <文件>");
      return;
    }
    case "plan": {
      if (!_[1]) throw new LoopError("用法：lzy loop plan <计划文件> [--review \"plan-reviewer: PASS …\"] [--force]");
      const review = typeof f.review === "string" ? f.review : null;
      const { goal, warnings } = adoptPlan(cwd, resolve(cwd, _[1]), { force: f.force === true, review });
      console.log(`✔ 计划门通过：${goal.steps.length} 项已采纳（N:${goal.steps.filter((s) => s.kind === "N").length} F:${goal.steps.filter((s) => s.kind === "F").length}）`);
      if (review) {
        console.log(`  评审记录：${goal.review.verdict} · ${goal.review.at}`);
      } else if ((goal.tier ?? "light") === "light") {
        // v008#N8：HEAVY 无 PASS 已是 core 机器拒（采纳直接失败）；此提示只对 LIGHT 语境有意义。
        console.log("  ⚠ 未带 --review：LIGHT 无评审要求；若目标实为 HEAVY（多文件/高风险），tier 先行（register --tier heavy 或 lzy loop tier heavy）再过 plan-reviewer 评审门");
      }
      console.log(`  计划快照：.lazyzcode/loop/snapshots/${goal.slug}.md（sha256 ${goal.planHash.slice(0, 10)}…，reset 不清）`);
      for (const w of warnings) console.log(`  ⚠ ${w}`);
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
      const { current, fingerprint, fresh, stale, unbound } = verifyEvidence(cwd, git);
      console.log(`当前 tree ${(current ?? "未知").slice(0, 10)}${fingerprint ? ` · 复合指纹 ${fingerprint.slice(0, 10)}` : " · 复合指纹 未绑定（host 非 git 仓）"}`);
      // 每树头树哈希/脏态行（v008）：subject 集逐根对照，missing 如实点名。
      const subjects = readGoal(cwd)?.subjects ?? [];
      for (const root of [resolve(cwd), ...subjects]) {
        const g = createGit(root);
        const hash = g.headTreeHash();
        const dirty = hash === null ? null : g.dirty();
        const state = hash === null ? "missing" : dirty ? "DIRTY" : "clean";
        console.log(`  树 ${(hash ?? "").slice(0, 10)} ${state.padEnd(6)} ${root}`);
      }
      for (const [label, list] of [["新鲜", fresh], ["过期", stale], ["未绑定", unbound]]) {
        console.log(`  ${label} ${list.length}${list.length ? `：${list.map((s) => s.id).join(" ")}` : ""}`);
      }
      process.exitCode = stale.length + unbound.length > 0 ? 1 : 0;
      return;
    }
    case "finish": {
      // v008#N6：writer 锁内先行（内存 done 渲染 + tmp+rename 原子写），失败=finish 拒——
      // 不再有「⚠ 导出失败但 done 已置」的非原子窗口（报告路径在 writer 成功后即确定）。
      const { goal, attestation } = finishLoop(cwd, git, {
        writeReport: ({ cwd: c, git: g, goal: gl }) => writeGoalReport(c, g, gl),
      });
      console.log(`✔✔ 目标完成：${goal.slug} — ${goal.title}`);
      console.log("  全部步骤收口，F 项证据绑复合指纹，subject 集全 clean。不做完不停——这次真的做完了。");
      const planHashLabel = goal.planHash ? "planHash" : "planHash=null（0.0.7 存量无快照）";
      console.log(`  终验 attestation：${attestation.path}（LOOP_COMPLETE 机器证明：${planHashLabel}+各根头树+指纹+对照记录）`);
      console.log(`  证据包已归档：.lazyzcode/evidence/${goal.slug}.report.md（人接管评审从这份材料开始）`);
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
      const marker = handoffGoal(cwd, snap, git.headTreeHash());
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
    case "subject": {
      // subject 集维护（v008-integrity-kernel#N3）：add/remove 写面（仅 executing）+ list 读面。
      // 语义提示必附：任何集合变化→复合指纹变→全体已录 F 证据过期，重取后才可 finish。
      const action = _[1] ?? "list";
      if (action === "add" || action === "remove") {
        if (!_[2]) throw new LoopError(`用法：lzy loop subject ${action} <path>`);
        if (_[3]) throw new LoopError(`多余参数：${_[3]}（一次一个路径）`);
        if (action === "add") {
          const { goal, root, added } = addSubject(cwd, _[2]);
          console.log(
            added
              ? `✔ subject 已加入：${root}（共 ${goal.subjects.length} 项）`
              : `✔ subject 已在集合（幂等跳过）：${root}（共 ${goal.subjects.length} 项）`,
          );
        } else {
          // ADJ-16（0.2.1 五轮双审）：打印被删条目本身——入参形态可能与存储形态分叉
          // （/tmp→/private/tmp），报入参派生路径会指向「另一个路径」（曾与实际被删的
          // subject 不一致）。
          const { goal, removed } = removeSubject(cwd, _[2]);
          console.log(`✔ subject 已移除：${removed}（剩 ${goal.subjects.length} 项）`);
        }
        console.log("  集合变化=复合指纹变化：全体已录 F 证据过期，重取后才可 finish");
        return;
      }
      if (action === "list") {
        if (_[2]) throw new LoopError(`多余参数：${_[2]}（用法：lzy loop subject list）`);
        // ADJ-79（0.2.1）：无 goal 时曾印「subjects：空（单树 host…）」——读起来像「本目录
        // 有目标、subject 集为空」，绕过 ADR-0006 的统一无 goal 恢复式文案。改走 noGoalMessage
        //（同族读面 claim/evidence list 同款；有 goal 才谈单树 host 的语义）。
        const goal = readGoal(cwd);
        if (!goal) throw new LoopError(noGoalMessage(cwd));
        const subjects = goal.subjects ?? [];
        if (subjects.length === 0) {
          console.log("subjects：空（单树 host——证据时效与 finish 闸门只看宿主树）");
        } else {
          console.log(`subjects（${subjects.length} 项）：`);
          for (const root of subjects) console.log(`  ${root}`);
        }
        return;
      }
      throw new LoopError(`未知 subject 子命令：${action}（用法：lzy loop subject add <path> | remove <path> | list）`);
    }
    case "tier": {
      // tier 升级（v008#N8）：只升不降；机器门=采纳时点，executing 升级为程序性自报（ADR-0013）。
      const value = _[1];
      if (!value) throw new LoopError("用法：lzy loop tier heavy（只升不降；light→heavy 单向）");
      if (_[2]) throw new LoopError(`多余参数：${_[2]}（用法：lzy loop tier heavy）`);
      const { goal, changed, warn } = setTier(cwd, value);
      console.log(
        changed
          ? `✔ tier 已升级：${goal.slug} → ${goal.tier}`
          : `✔ tier 已是 ${goal.tier}（no-op）`,
      );
      if (warn) console.log(`  ⚠ ${warn}`);
      return;
    }
    case "supersede": {
      // supersede（0.1.0 棒B，ADR-0016）：executing 期改计划的 forward-only 出口——
      // 完整采纳门照走（HEAVY 无 PASS 拒），旧 attempt 置 superseded、开新代次。
      if (!_[1]) throw new LoopError('用法：lzy loop supersede <计划文件> [--review "plan-reviewer: PASS …"]');
      const review = typeof f.review === "string" ? f.review : null;
      const { goal, warnings, superseded } = supersedePlan(cwd, resolve(cwd, _[1]), { review, git });
      console.log(
        `✔ supersede 完成：attempt ${superseded.from} → ${superseded.to}（forward-only：旧代次置 superseded，其证据不再被 verify/finish 锚定）`,
      );
      console.log(`  新计划快照：.lazyzcode/loop/snapshots/${goal.slug}.md（sha256 ${goal.planHash.slice(0, 10)}…；旧快照归档 .attempt${superseded.from}.md）`);
      for (const w of warnings) console.log(`  ⚠ ${w}`);
      console.log(`  世系读面：lzy loop attempts  ·  下一步 → ${goal.steps[0].id} [${goal.steps[0].kind}] ${goal.steps[0].title}`);
      return;
    }
    case "attempts":
      // 世系读面（只读，formatHistory 同款永不 throw 家族）。
      // ADJ-45（0.2.1）：补 --goal <slug>（与 evidence list / dag stale 对齐）——重注册他
      // slug 后旧世系在盘上仍可读，此前 CLI 无入口；无参仍默认当前 goal。
      console.log(formatAttempts(cwd, typeof f.goal === "string" ? f.goal : (readGoal(cwd)?.slug ?? null)));
      return;
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
    case "risk": {
      // risk_class 升级（0.2.0 棒1，ADR-0020）：只升不降；HIGH/RESTRICTED 升档 warn
      // SUSPENDED_RISK（warn-only，镜像 tier 升档提醒形态）。
      if (!_[1]) throw new LoopError("用法：lzy loop risk <low|med|high|restricted>");
      const { goal, changed, warn } = setRisk(cwd, _[1]);
      console.log(changed ? `✔ risk 已更新：${goal.slug} → ${goal.risk}` : `risk 已是 ${goal.risk}（同值 no-op）`);
      if (warn) console.log(`  ⚠ ${warn}`);
      return;
    }
    case "cost":
      // 积分成本报表（plan-v2 Phase 2-2，只读）：账本缺席/sqlite3 缺席均降级输出不翻码。
      console.log(formatCost(cwd, readGoal(cwd)));
      return;
    case "lease": {
      // 运行级认领（0.2.0 棒1，ADR-0020）：acquire/heartbeat/release——分钟级互斥，
      // 匿名 handle=fence 令牌（ADR-0009 立场，不存 sessionId）。
      // ADJ-31（0.2.1）：五个变更调用点前置 requireGoalPreLock（ADR-0006 fail-fast 家法）——
      // 裸目录取租曾留 runtime.json 空壳 + 幻影活跃租约（doctor EXEMPT 看不见、reset 清不掉，
      // 且此后该目录 register+drive 会被「另一运行时持租」拒满一个 TTL）。
      const action = _[1];
      const fence = f.fence != null && f.fence !== "" ? Number.parseInt(f.fence, 10) : null;
      if (action === "acquire") {
        const ttl = f["ttl-ms"] != null && f["ttl-ms"] !== "" ? Number.parseInt(f["ttl-ms"], 10) : undefined;
        requireGoalPreLock(cwd);
        const lease = withLock(cwd, () => acquireLease(cwd, { ttlMs: ttl }));
        console.log(`✔ 租约已获：fence ${lease.fence}（至 ${new Date(lease.expiresAtMs).toISOString()}）——写路径申报用 --fence ${lease.fence} 或 env LZY_RUNTIME_FENCE`);
        return;
      }
      if (action === "heartbeat") {
        if (!Number.isInteger(fence)) throw new LoopError("用法：lzy loop lease heartbeat --fence <n> [--ttl-ms N]");
        const ttl = f["ttl-ms"] != null && f["ttl-ms"] !== "" ? Number.parseInt(f["ttl-ms"], 10) : undefined;
        requireGoalPreLock(cwd);
        const lease = withLock(cwd, () => heartbeatLease(cwd, fence, { ttlMs: ttl }));
        console.log(`✔ 心跳已记：fence ${lease.fence}（续至 ${new Date(lease.expiresAtMs).toISOString()}）`);
        return;
      }
      if (action === "release") {
        if (!Number.isInteger(fence)) throw new LoopError("用法：lzy loop lease release --fence <n>");
        requireGoalPreLock(cwd);
        const r = withLock(cwd, () => releaseLease(cwd, fence));
        console.log(r.released ? `✔ 租约已释放（fence ${fence}）` : "无活跃租约（幂等，无需释放）");
        return;
      }
      if (action === "reclaim") {
        // 僵尸租约回收出口（ADJ-32，0.2.1）：SIGKILL 的 drive 留下活性租约，此后每次唤起被
        // 「另一运行时持租」拒满一个 TTL——acquire 的拒绝报文指的就是本出口。持有者 pid 可判
        // 且已死=直接回收；仍活或活性不可判=须 --force（人工确认后行使）。
        requireGoalPreLock(cwd);
        const r = withLock(cwd, () => reclaimLease(cwd, { force: f.force === true }));
        console.log(
          r.reclaimed
            ? `✔ 租约已回收：fence ${r.fence}（${r.forced ? "--force 人工确认" : "持有进程已不存在"}）——下次 acquire 发新号`
            : "无活跃租约（幂等，无需回收）",
        );
        return;
      }
      throw new LoopError("用法：lzy loop lease acquire [--ttl-ms N] | heartbeat --fence <n> | release --fence <n> | reclaim [--force]");
    }
    case "budget": {
      // 运行预算（0.2.0 棒1，ADR-0020）：init/spend/remaining——墙钟+积分双硬顶，
      // 超顶拒=drive 须干净收束的机器信号；runtime.json 自身写者不带 fence（ADR-0020 边界）。
      // ADJ-31：init/spend 同为写面（remaining 只读，保留无 goal 可读）。
      const action = _[1];
      if (action === "init") {
        const wall = f["wall-ms"] != null && f["wall-ms"] !== "" ? Number.parseInt(f["wall-ms"], 10) : undefined;
        const pts = f.points != null && f.points !== "" ? Number.parseFloat(f.points) : undefined;
        requireGoalPreLock(cwd);
        const b = withLock(cwd, () => initBudget(cwd, { wallClockBudgetMs: wall, pointsBudget: pts }));
        console.log(`✔ 预算已初始化：墙钟 ${b.wallClockBudgetMs}ms · 积分 ${b.pointsBudget}（env LZY_DRIVE_WALLCLOCK_BUDGET_MS / LZY_DRIVE_POINTS_BUDGET 可覆盖缺省）`);
        return;
      }
      if (action === "spend") {
        const ms = f.ms != null && f.ms !== "" ? Number.parseInt(f.ms, 10) : 0;
        const pts = f.points != null && f.points !== "" ? Number.parseFloat(f.points) : 0;
        requireGoalPreLock(cwd);
        const b = withLock(cwd, () => recordSpend(cwd, { ms, points: pts }));
        console.log(`✔ 已记账：墙钟 ${b.spentMs}/${b.wallClockBudgetMs}ms · 积分 ${Math.round(b.spentPoints * 100) / 100}/${b.pointsBudget}`);
        return;
      }
      if (action === "remaining") {
        console.log(formatBudget(cwd, { rollingPoints: rollingWaterlinePoints() }));
        return;
      }
      throw new LoopError("用法：lzy loop budget init [--wall-ms N --points N] | spend [--ms N --points N] | remaining");
    }
    case "drive": {
      // 无人值守执行通道（0.2.0 棒2，ADR-0020/§⑮ Q3）：单唤起内 spawn headless 会话
      // 循环推进 executing 目标；段间 budget/lease/risk 三门；收束=done/预算尽/段尽/
      // 无推进，除 done 外自写 handoff 快照干净交回。退出码 0=done 或干净收束。
      // workers 波编排（v024-fast-scheduler#N1）：--workers N 显式；--fast 糖≡N=2
      //（保留 fast 拍板 2026-09-23）。两者同给时 --workers 优先。
      const r = await runDrive(cwd, {
        wallMs: f["wall-ms"] != null && f["wall-ms"] !== "" ? Number.parseInt(f["wall-ms"], 10) : null,
        maxSegments: f["max-segments"] != null && f["max-segments"] !== "" ? Number.parseInt(f["max-segments"], 10) : undefined,
        mode: typeof f.mode === "string" ? f.mode : undefined,
        // --fast 糖≡workers 2（保留 fast 拍板 2026-09-23）。ADJ-21（v024 双审）：原判据
        // `f.fast != null` 把显式 `--fast=false` 也算「在场」⇒ 反转进 workers 2（无人值守
        // 脚本里的「明确关掉」被读成「开」，自动化解 ~2× 计价）。现只认在场且非显式假。
        workers:
          f["workers"] != null && f["workers"] !== ""
            ? Number.parseInt(f["workers"], 10)
            : f.fast === true || f.fast === "1" || f.fast === "true"
              ? 2
              : null,
      });
      if (!r.ok) process.exitCode = 1;
      return;
    }
    default:
      throw new LoopError(`未知 loop 子命令：${sub}（register/plan/supersede/attempts/start/subject/tier/risk/claim/status/list/history/cost/verify/finish/export/abandon/reset/handoff/lease/budget/drive）`);
  }
}

async function cmdStep(args) {
  const { _, f } = parseArgs(args);
  const action = _[0];
  if (action !== "done") {
    throw new LoopError("用法：lzy step done <ID> [--note …] [--evidence …] [--harness …]（F 项必须带证据）");
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
    harness: typeof f.harness === "string" ? f.harness : null,
  });
  console.log(`${rebinding ? "↻" : "✔"} 步骤${rebinding ? "重取证" : "完成"}：${step.id} [${step.kind}] ${step.title}（${goal.steps.filter((s) => s.status === "done").length}/${goal.steps.length}）`);
  if (dirty) {
    console.log("  ⚠ 工作区有未提交改动：证据应跟随提交（先 commit 再取证，否则 tree hash 不含这些改动）");
  }
  if (step.evidence) {
    // 指纹化显示面（v008）：新证据显示指纹短码，legacy 证据维持 tree 短码（防「未绑定」回归）。
    const bind = step.evidence.fingerprint
      ? `指纹 ${(step.evidence.fingerprint ?? "").slice(0, 10)}`
      : `tree ${(step.evidence.treeHash ?? "未绑定").slice(0, 10)}`;
    console.log(`  证据已绑定 ${bind}：${step.evidence.text.slice(0, 80)}`);
    for (const file of step.evidence.files ?? []) {
      console.log(`  附件 ${file.path}（sha256 ${file.sha256.slice(0, 12)}… · ${file.bytes} bytes）`);
    }
  }
  const pending = goal.steps.find((s) => s.status === "pending");
  console.log(pending ? `  下一步 → ${pending.id} [${pending.kind}] ${pending.title}` : "  全部步骤已收口 → lzy loop finish 做终验");
}

// ── 证据账本命令族（v009 棒1，ADR-0014）：red/waive-red=写路径（锁内、dag-first），
// list=红绿 manifest 视图，机器只记账不裁决（缺半不拦门，执法在协议文本+comparator）。
function evidenceFileArgs(cwd, f) {
  const raw = f["evidence-file"];
  if (Array.isArray(raw)) return raw.map((p) => resolve(cwd, p));
  return typeof raw === "string" ? [resolve(cwd, raw)] : null;
}

function shortNode(node) {
  if (!node) return "（对端不在账本）";
  if (node.kind === "evidence") {
    return `${node.id} evidence ${node.half} ${node.slug}/${node.step} gen${node.seq}`;
  }
  if (node.kind === "plan") return `${node.id} plan ${node.slug} ${String(node.planHash).slice(0, 10)}`;
  return `${node.id} review ${String(node.planHash).slice(0, 10)} ${String(node.verdict ?? "").slice(0, 40)}`;
}

async function cmdEvidence(args) {
  const { _, f } = parseArgs(args);
  const action = _[0];
  const cwd = process.cwd();
  if (action !== "red" && action !== "waive-red" && action !== "list") {
    throw new LoopError("用法：lzy evidence red <Fid> … | waive-red <Fid> --reason … | list [--goal <slug>]");
  }
  if (action === "list") {
    const slugFlag = typeof f.goal === "string" ? f.goal : null;
    const goal = readGoal(cwd);
    if (!goal && !slugFlag) {
      throw new LoopError(`${noGoalMessage(cwd)}（查历史目标账本可加 --goal <slug>）`);
    }
    const dag = loadDag(cwd);
    const slug = slugFlag ?? goal.slug;
    // ADJ-23（0.0.10）：节点筛选曾是 O(R×N×E) 嵌套扫描（每 review 节点重扫全边表）——
    // 两次单遍预索引（reviews 边映射+plan slug 集合）后 O(N+E)，万边级不挂死。
    const reviewPlanOf = new Map(dag.edges.filter((e) => e.type === "reviews").map((e) => [e.from, e.to]));
    const planSlugs = new Set(dag.nodes.filter((n) => n.kind === "plan" && n.slug === slug).map((n) => n.id));
    const nodes = dag.nodes.filter((n) => n.slug === slug || (n.kind === "review" && planSlugs.has(reviewPlanOf.get(n.id))));
    console.log(`证据账本 · 目标 ${slug} · ${nodes.length} 节点（机器只记账不裁决——缺半不拦门，执法在协议文本+comparator）`);
    // plan/review 一等公民（按 slug/planHash 对 goal.json，永不标孤儿）
    const planNodes = nodes.filter((n) => n.kind === "plan");
    const reviewNodes = nodes.filter((n) => n.kind === "review");
    const latestPlan = planNodes[planNodes.length - 1];
    if (latestPlan) {
      const rev = reviewNodes.filter((r) => r.planHash === latestPlan.planHash);
      console.log(`  计划 ${latestPlan.id} · planHash ${String(latestPlan.planHash).slice(0, 10)} · 评审 ${rev.length ? rev.map((r) => r.id).join("/") : "无节点"}`);
      // ADJ-28/29（0.0.10）：comparator 节点曾计入总数却不渲染（或被渲染成 review）——
      // 现行对照一行如实可达。
      const comps = nodes
        .filter((n) => n.kind === "comparator" && n.slug === slug && n.planHash === latestPlan.planHash)
        .sort((a, b) => a.at - b.at);
      const curComp = comps[comps.length - 1];
      if (curComp) {
        console.log(
          `  对照 ${curComp.id} · ${curComp.verdict} · ${curComp.itemsCount} 项 · 指纹 ${String(curComp.fingerprint).slice(0, 10)}${comps.length > 1 ? `（历史 ${comps.length - 1} 条）` : ""}`,
        );
        // ADJ-42/48（0.2.1）：note（限定条件）与 attests 边状态在对照行可见——note 曾被
        // 静默丢弃；边缺席（plan 节点不在账本）此前无从察觉。
        if (curComp.note) console.log(`    注：${String(curComp.note).slice(0, 120)}`);
        if (!curComp.attestsPlanNodeId) {
          console.log("    ⚠ attests 边缺席（账本无对应 plan 节点）——lzy dag dependents 查不到这条对照");
        }
      }
    }
    // goal.json 在场才做孤儿判定（历史账本无基准，不妄判）
    const stepsById = goal && goal.slug === slug ? new Map(goal.steps.map((s) => [s.id, s])) : null;
    const currentFp = stepsById ? fingerprintSubjects(cwd, goal.subjects) : null;
    const staleMap = new Map(stalePreview(dag, currentFp).map((x) => [x.node.id, x.status]));
    const evNodes = nodes.filter((n) => n.kind === "evidence");
    // 实例隔离（ADJ-44/03，0.0.10）：goal 带实例戳时逐行只显示本实例节点，其他实例
    // （跨 reset 重注册/0.0.9 无戳旧节点）汇总一行，不再混入当前实例的红绿读面。
    const myAttempt = goal && Number.isInteger(goal.attempt) ? goal.attempt : null;
    const cur = myAttempt != null ? evNodes.filter((n) => n.attempt === myAttempt) : evNodes;
    const others = evNodes.length - cur.length;
    const byStep = new Map();
    for (const n of cur) {
      if (!byStep.has(n.step)) byStep.set(n.step, []);
      byStep.get(n.step).push(n);
    }
    const stepIds = [...new Set([...(stepsById ? [...stepsById.keys()].filter((id) => stepsById.get(id).kind === "F") : []), ...byStep.keys()])];
    const surfShort = (s) =>
      s == null ? "（无表面）" : s.kind === "fingerprint" ? `指纹 ${s.value.slice(0, 10)}` : `外部:${s.value}`;
    const staleLabel = (st) =>
      st === "fresh" ? "新鲜" : st === "stale" ? "过期" : st === "superseded" ? "历史代次" : st === "external" ? "外部表面、机器不可查" : "—";
    for (const fid of stepIds) {
      const halves = byStep.get(fid) ?? [];
      const greens = halves.filter((n) => n.half === "green").sort((a, b) => a.seq - b.seq);
      const reds = halves.filter((n) => n.half === "red");
      const waives = halves.filter((n) => n.half === "waived");
      // 现行绿与 verify 权威同源锚定（goal.json 当前代次），非 latest-wins（ADJ-03）。
      const st = stepsById?.get(fid);
      const anchor =
        st && myAttempt != null
          ? findGreenByGeneration(dag, slug, fid, (st.evidenceSeq ?? 1) - 1, myAttempt)
          : (findGreenByGeneration(dag, slug, fid, (st?.evidenceSeq ?? 1) - 1) ?? greens[greens.length - 1] ?? null);
      const greenPart = anchor
        ? `绿 ✓ gen${anchor.seq}（${surfShort(anchor.surface)} · ${staleLabel(staleMap.get(anchor.id))}${anchor.harnessHash ? ` · 🔧${anchor.harnessHash.slice(0, 8)}` : ""}）`
        : st?.evidence?.treeHash
          ? "绿 ◌（legacy 轨：goal.json 单树证据，账本外）"
          : "绿 ✗（未录）";
      // ADJ-30（0.0.10）：红半与 waiver 同代并存时 waiver 不再被红半遮蔽；红半附件计数可达。
      const redPart = reds.length || waives.length
        ? [
            ...reds.map((r) => {
              const att = (r.files?.length ?? 0) > 0 ? ` 📎${r.files.length}` : "";
              const har = r.harnessHash ? ` 🔧${r.harnessHash.slice(0, 8)}` : "";
              return `红 ✓ ${r.id} gen${r.seq}（${surfShort(r.surface)}）${att}${har}`;
            }),
            ...waives.map((w) => `红 ➖ waived（「${String(w.text).slice(0, 40)}」）`),
          ].join(" ")
        : "红 ✗（未录）";
      console.log(`  ${fid} · ${greenPart} · ${redPart}`);
      // INV-08 展示面（LIGHT 也 ⚠ 不拦）：配对红与绿 harnessHash 俱在且不等。
      // ADJ-26（v024 双审）：门侧自 125bbdd 起**只对现行红执法**（append-only 账本上旧代红永久
      // 绊门会把「按同一程序重录」的恢复路径堵死），展示面当时仍全量遍历 ⇒ 旧代红错配照打 ⚠ 且
      // 文案「HEAVY finish 拒」与门行为相反（读面说会被拒、门其实放行）。现行与门同源：只看
      // red_of 最新现行红，且文案如实——错配只在该红为现行时才拦。
      const currentRed = reds
        .slice()
        .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || a.at - b.at)
        .at(-1);
      const mismatch =
        anchor?.harnessHash && currentRed?.harnessHash && currentRed.harnessHash !== anchor.harnessHash;
      if (mismatch) {
        console.log(`    ⚠ harness 错配（现行红 gen${currentRed.seq} 与绿取证程序不同源；HEAVY finish 拒，LIGHT 仅展示）`);
      } else if (
        anchor?.harnessHash &&
        reds.some((r) => r !== currentRed && r.harnessHash && r.harnessHash !== anchor.harnessHash)
      ) {
        console.log(`    ➖ 历史红 harness 与现行绿不符（非现行红，不执法——重录现行红即恢复同源）`);
      }
      if (greens.length > 1 && (!anchor || greens.some((g) => g.id !== anchor.id))) {
        console.log(`    rebind 链 ${greens.length} 代（gen${greens[0].seq}→gen${greens[greens.length - 1].seq}，现行 ${anchor ? `gen${anchor.seq}` : "未锚定"}）`);
      }
    }
    if (others > 0) {
      console.log(`  （他实例节点 ${others} 条：跨 reset 重注册/无戳旧实例，不混入本实例读面）`);
    }
    // 孤儿=green 节点代数超前 goal.json 已落地代数（dag-first 部分失败残留）；red/waived
    // 本就不入 goal.json（边即记录），永不标孤儿。判定限本实例（跨实例不误诊，ADJ-03）。
    if (stepsById) {
      const orphans = cur.filter((n) => {
        if (n.half !== "green") return false;
        const st = stepsById.get(n.step);
        return !st || n.seq > (st.evidenceSeq ?? 1) - 1;
      });
      for (const o of orphans) {
        console.log(`  ⚠ 孤儿节点 ${o.id}（${o.slug}/${o.step} gen${o.seq}）：账本有而 goal.json 无此代数记录（dag-first 部分失败残留）`);
      }
    } else {
      console.log("  （历史账本：goal 状态已清，无孤儿判定基准）");
    }
    return;
  }
  if (!_[1]) {
    throw new LoopError(
      action === "red"
        ? "用法：lzy evidence red <Fid> --evidence <改前态失败取证> [--evidence-file <文件>]… [--surface <外部表面描述>] [--harness <程序串>]"
        : "用法：lzy evidence waive-red <Fid> --reason <一行豁免理由>",
    );
  }
  const textFlag = action === "red" ? f.evidence : f.reason;
  const { node, dirty } = recordEvidenceHalf(cwd, createGit(cwd), _[1], {
    half: action === "red" ? "red" : "waived",
    text: typeof textFlag === "string" ? textFlag : null,
    files: evidenceFileArgs(cwd, f),
    surfaceExternal: typeof f.surface === "string" ? f.surface : null,
    harness: typeof f.harness === "string" ? f.harness : null,
  });
  console.log(`${ICON.ok} 红半账本已记：${node.id} · ${node.half} · ${node.slug}/${node.step} gen${node.seq}`);
  if (node.surface) {
    console.log(`  表面（各绑各面）${node.surface.kind}:${node.surface.kind === "fingerprint" ? node.surface.value.slice(0, 10) : node.surface.value}`);
  }
  if (node.harnessHash) {
    console.log(`  harness ${node.harnessHash.slice(0, 10)}…（${String(node.harnessSpec).slice(0, 60)}）`);
  }
  for (const file of node.files ?? []) {
    console.log(`  附件 ${file.path}（sha256 ${file.sha256.slice(0, 12)}… · ${file.bytes} bytes）`);
  }
  if (dirty) {
    console.log("  ⚠ 工作区有未提交改动：红半应绑定改前态（先在改动前取证，或用 --surface 声明外部表面）");
  }
}

// review 节点的所属 plan 节点 id（经 reviews 边反查；无边= null）
function reviewPlanIdOf(dag, reviewNode) {
  const e = dag.edges.find((x) => x.type === "reviews" && x.from === reviewNode.id);
  return e ? e.to : null;
}

// ── 对照 attestation 命令族（v009 棒2）：结论文件入账（锁内、dag-first），机器只记账
// 不裁决——MISMATCH 也如实入账，裁决在 finish 门（HEAVY 强制 MATCH）。
function cmdAttest(args) {
  const { _, f } = parseArgs(args);
  if (_[0] !== "comparator") {
    throw new LoopError("用法：lzy attest comparator --file <结论.json>（schema：{slug, items:[{fid, verdict, evidenceNodeId|generation, basis}], note?}——每条 item 必须绑定该 F 项已落账的绿半节点）");
  }
  if (_[1]) throw new LoopError(`多余参数：${_[1]}（用法：lzy attest comparator --file <结论.json>）`);
  const file = typeof f.file === "string" ? resolve(process.cwd(), f.file) : null;
  const { node, fingerprint, warn } = recordComparatorAttestation(process.cwd(), file);
  console.log(
    `${ICON.ok} 对照 attestation 已入账：${node.id} · ${node.verdict} · ${node.itemsCount} 项 · 指纹 ${fingerprint.slice(0, 10)} · 文件 sha256 ${node.fileSha256.slice(0, 12)}…`,
  );
  console.log(`  逐项：${node.items.map((it) => `${it.fid}:${it.verdict}`).join(" ")}`);
  if (node.note) console.log(`  注：${node.note}`); // ADJ-42：schema 广告的 note 入账即回显
  if (node.filePath) console.log(`  结论原件已归档：${node.filePath}（ADJ-48：事后可复核，不再只留 sha256）`);
  if (warn) console.log(`  ⚠ ${warn}`); // ADJ-48：attests 边缺席不再静默
  if (node.verdict !== "MATCH") {
    console.log("  ⚠ MISMATCH 已如实入账（机器只记账不裁决）；HEAVY finish 会被拦——处置不匹配项后重新对照并重录");
  }
}

// ── DAG 查询命令族（只读，无锁——原子写保证读者见旧或新，绝不见半写） ─────────
function cmdDag(args) {
  const { _, f } = parseArgs(args);
  if (_[0] === "stale") {
    // 失效预览查询面（0.1.0 棒B，ADR-0016）：stalePreview 升为正式只读命令——传播语义
    // 由被动指纹直比承载（verify/finish），此处只应答「现在什么失效了」，不进门。
    if (_[1]) throw new LoopError("用法：lzy dag stale [--goal <slug>]（失效预览：现行复合指纹逐证据节点比对，只展示不进门）");
    const cwd = process.cwd();
    const dag = loadDag(cwd);
    const goal = readGoal(cwd);
    const slugFlag = typeof f.goal === "string" ? f.goal : null;
    const slug = slugFlag ?? goal?.slug ?? null;
    const currentFp = goal && (!slug || goal.slug === slug) ? fingerprintSubjects(cwd, goal.subjects) : null;
    const rows = stalePreview(dag, currentFp).filter((r) => !slug || r.node.slug === slug);
    const label = (st) =>
      st === "fresh" ? "新鲜" : st === "stale" ? "过期" : st === "superseded" ? "历史代次" : st === "external" ? "外部表面、机器不可查" : st === "unknown" ? "未知（面缺席）" : "不适用（非绿半）";
    console.log(
      `失效预览 · ${slug ? `目标 ${slug}` : "全账本"} · ${currentFp ? `现行复合指纹 ${currentFp.slice(0, 10)}` : "复合指纹 未绑定（无 goal 基准）"} · 证据节点 ${rows.length}`,
    );
    const counts = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    console.log(`  ${Object.entries(counts).map(([k, v]) => `${label(k)} ${v}`).join(" · ") || "（无证据节点）"}`);
    for (const r of rows) {
      const surf = r.node.surface == null ? "（无表面）" : r.node.surface.kind === "fingerprint" ? `指纹 ${r.node.surface.value.slice(0, 10)}` : `外部:${r.node.surface.value}`;
      console.log(`  ${r.node.id} ${r.node.half} ${r.node.slug}/${r.node.step} gen${r.node.seq}  ${label(r.status)}  ${surf}`);
    }
    console.log("  （只展示不进门：有效性判定仍由 verify/finish 的指纹直比承载，ADR-0016 传播降档口径）");
    return;
  }
  if (_[0] !== "dependents" || !_[1] || _[2]) {
    throw new LoopError("用法：lzy dag dependents <节点id|表面值>（「什么依赖 X」）| lzy dag stale（失效预览）");
  }
  const dag = loadDag(process.cwd());
  const res = dagDependents(dag, _[1]);
  // ADJ-26（0.0.10）：节点 id 不存在与「存在但无依赖」显式分——不再同答「命中 0」。
  if (res.kind === "node" && res.hits.length === 0 && !dag.nodes.some((n) => n.id === _[1])) {
    console.log(`依赖查询 · 节点 ${_[1]} 不存在（账本无此 id；查历史实例可加 --goal <slug> 后用 evidence list）`);
    return;
  }
  console.log(`依赖查询 · ${res.kind} ${res.id} · 命中 ${res.hits.length}`);
  for (const h of res.hits) {
    if (res.kind === "surface") {
      console.log(`  ← captured_on ${shortNode(h.node)}`);
    } else {
      const to = typeof h.edge.to === "object" ? `surface ${h.edge.to.kind}:${String(h.edge.to.value).slice(0, 10)}` : h.edge.to;
      console.log(`  ${h.direction === "outgoing" ? "→" : "←"} ${h.edge.type} ${h.direction === "outgoing" ? to : shortNode(h.node)}`);
    }
  }
}

// 载荷实际版本（ADJ-92，0.2.1）：`lzy --version` 的「（插件载荷同版本）」曾是无校验断言——
// ADR-0012 中间态（npm 已升、sync 未跑）下真实会话读的是旧载荷目录，当面失真。现实测：
// 缓存目录枚举（多市场候选，含 /<plugin>/<version>/ 形态）+ 安装注册表版本，二者取「会话
// 实际会装载的那个」；读不到=返回 null（版本行去掉括注，指向 lzy doctor 的 payload-ver 行）。
function measuredPayloadVersion() {
  try {
    const root = pluginsRoot ? pluginsRoot() : null;
    if (!root) return null;
    const cacheRoot = join(root, "cache");
    const versions = new Set();
    for (const market of readdirSync(cacheRoot)) {
      let dirs = [];
      try {
        dirs = readdirSync(join(cacheRoot, market, "lazyzcode"));
      } catch {
        continue;
      }
      for (const d of dirs) if (/^\d+\.\d+\.\d+/.test(d)) versions.add(d);
    }
    if (versions.size === 0) return null;
    let entry = null;
    try {
      entry = readRegistry().plugins.find((e) => e.name === "lazyzcode" || String(e.id ?? "").startsWith("lazyzcode")) ?? null;
    } catch {}
    if (entry?.version && versions.has(entry.version)) return entry.version;
    // 注册表未命中/不在缓存集：取语义最大值（多目录残留时以最高版本为准，如实呈现）
    return [...versions].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).pop();
  } catch {
    return null;
  }
}

async function cmdVersion() {
  let v = "unknown";
  try {
    v = readRepoManifest().version;
  } catch {}
  const ev = createEngineCli(findEngine()).version();
  const payload = measuredPayloadVersion();
  // 括注只在**实测相符**时保留（同版本）；不同则点名差异并给 sync 指路；读不到则去括注
  // 指向 doctor（宁缺毋滥：不再对未校验的事实做断言）。
  const payloadNote =
    payload === null
      ? "（载荷版本未实测——见 lzy doctor 的 payload-ver 行）"
      : payload === v
        ? "（插件载荷同版本）"
        : `（插件载荷 ${payload} 与 CLI 不同——跑 lzy sync）`;
  console.log(`lzy ${v}${payloadNote} · 引擎 ${ev ?? "未找到"}`);
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
  lzy update       一键升级：npm 拉 latest 包，再由新装路径的全新子进程执行 sync
                    （已是最新则免装；npm 缺席/中途失败均给手动两步指路）
  lzy status       检查引擎/安装/启用/装载/目标循环状态（只读；退出码 0=无 fail 级检查，warn/skip 不影响）
  lzy doctor       深度本地诊断：status 全套 + hook 语法自检/node 下限/lzy 解析/状态卫生/限流体检
  lzy uninstall    卸载插件（优先官方 plugins uninstall）

目标循环（状态在工作区 .lazyzcode/）：
  lzy loop register <slug> --title <标题>   注册目标（进入 planning；--tier heavy 声明重目标，
                                            HEAVY 采纳时无 PASS 评审会被机器拒）
  lzy loop plan <计划文件> [--force]        计划门：采纳 N/F 清单（默认拒绝待定项；采纳即快照
                                            绑 planHash，复采纳换哈希须重评审）
  lzy loop supersede <计划文件> [--review …] 执行中改计划的 forward-only 出口（0.1.0，ADR-0016）：
                                            旧 attempt 置 superseded、开新代次，完整采纳门照走
  lzy loop attempts                         attempt 世系读面（只读：attempt.json ∪ 中央账本派生）
  lzy loop start                            开跑（planning → executing，打印实测并发纪律行）
  lzy loop tier heavy                       tier 升级（只升不降；机器门=采纳时点，ADR-0013）
  lzy loop risk <level>                     risk_class 升级（0.2.0，ADR-0020）：low|med|high|
                                            restricted 只升不降；HIGH+ 拒入无人值守车道
  lzy loop lease acquire|heartbeat|release|reclaim
                                            运行级认领（0.2.0，ADR-0020）：分钟级互斥+心跳续期；
                                            fence 令牌申报写路径（--fence / LZY_RUNTIME_FENCE）；
                                            reclaim=僵尸租约回收出口（持租进程已死自动回收，
                                            仍活须 --force）
  lzy loop budget init|spend|remaining      运行预算（0.2.0，ADR-0020）：墙钟+积分双硬顶，
                                            超顶拒=drive 须干净收束的机器信号
  lzy loop drive [--wall-ms N] [--max-segments N] [--mode m]
                 [--workers N] [--fast]
                                            无人值守执行通道（0.2.0，ADR-0020）：单唤起内
                                            headless 段循环推进 executing 目标；段间三门
                                            （risk/lease/预算）+水位联动；收束自写 handoff
                                            快照交回（退出码 0=done 或干净收束，1=门拒/段失败）；
                                            --workers N=多工人波编排（ADR-0026：LIGHT only，
                                            HEAVY 入口拒；--fast≡--workers 2，--fast=false=单工人）
  lzy loop subject add <path>               声明兄弟仓根入 subject 集（仅 executing；校验 git 仓/
                                            与宿主无包含；集合变化=全体 F 证据过期须重取）
  lzy loop subject remove <path>            移除 subject（missing 死锁出口；证据过期语义照走）
  lzy loop subject list                     列 subject 集（空=单树 host）
  lzy loop claim [<id>] [--release]         步级认领（决策 #21）：占步互斥 48h；无参列出可
                                            认领集（同目标多工人挑步）；done 自动释放
  lzy loop status                           查看进度与下一步
  lzy loop list [--root <目录>]             跨仓清单（只读）：扫锚目录一级子目录各仓的循环
                                            状态（默认锚=当前目录的同级，含自身）
  lzy loop history                         目标谱系（只读）：证据包 ∪ salvage 存根 ∪ git
                                            尾注三源并集，按最近活动排序
  lzy loop cost                             积分成本报表（只读计费账本折算：常设系数+促销
                                            overlay 自动回落；目标归因为简化 OR+人工复核口径）
  lzy step done <ID> [--note …] [--evidence …] [--evidence-file <文件>]… [--harness <程序串>]
                                            收口一步（F 项必须带真实表面证据；附件复制入
                                            .lazyzcode/evidence/ 并绑 sha256，≤4 个/项；
                                            --harness 声明取证程序串，INV-08 红绿同源核对）
  lzy loop verify                           证据时效核对（退出码 0=全部新鲜，1=有过期/未绑定）
  lzy loop handoff --snapshot <快照文件>    交接登记（ADR-0009）：7 字段快照落标记，Stop 一次性
                                            消费放行（一次性、不耗拉回预算；lint 强制 7 节全在）
  lzy loop finish                           终验完成（全部 done + F 证据新鲜才放行；自动归档证据包）
  lzy loop export                           重导出证据包到 .lazyzcode/evidence/<slug>.report.md
  lzy loop abandon / reset                  放弃 / 清除状态

证据账本（中央失效 DAG，跨目标常驻——机器只记账不裁决，ADR-0014）：
  lzy evidence red <Fid> --evidence <text> [--evidence-file <文件>]… [--surface <描述>] [--harness <程序串>]
                                            登记红半（改前态失败取证；缺省绑当前复合指纹，
                                            --surface 声明外部表面如已发布版版本号；
                                            --harness 声明取证程序串，与绿半同源核对）
  lzy evidence waive-red <Fid> --reason <理由>
                                            登记红半豁免（真构造不出反态的面；一行豁免的
                                            机器形态）
  lzy evidence list [--goal <slug>]         红绿 manifest 视图（halves 配对/表面短码/rebind 链）
  lzy dag dependents <节点id|表面值>        「什么依赖 X」查询（只读）
  lzy dag stale [--goal <slug>]             失效预览（只读：现行复合指纹逐证据节点比对；
                                            只展示不进门——有效性判定仍归 verify/finish）

对照 attestation（v009 棒2——机器记账，HEAVY finish 强制 MATCH）：
  lzy attest comparator --file <json>       登记 qa-executor 对照结论（schema：{"slug","items":
                                            [{"fid","verdict":"MATCH|MISMATCH",
                                            "evidenceNodeId"|"generation","basis"}],"note"?}；
                                            items 须覆盖全部 F 项且每条绑定已落账绿半；
                                            HEAVY finish 无 MATCH 记录即拒、MISMATCH/指纹过期同拒；
                                            LIGHT 可 self-check 免录）

项目记忆（AGENTS.md 分层，确定性审计——写盘归 init-deep 技能且草稿先行）：
  lzy agents-md    资格谓词+覆盖审计详单（退出码 0=覆盖完整无超限，1=有缺口/超限）

需求契约与项目清单（0.3.0 M1，ADR-0024——批准/撤回走 UPS 短语，CLI 只读）：
  lzy contract show                         目标绑定契约读面（结构键/验收项/授权态/漂移警示）
  lzy contract auth                         授权账本时序（approval/withdrawal，追加式后到者赢）
  lzy project check                         lzy.project.json 校验+就绪静态半（入口存在态）
  lzy project discover                      只读缺失清单（能力类缺项/入口缺失配方）
  lzy migrate preview <根路径>              旧记录只读预览（契约草案 authorization=NONE；
                                            活跃 goal 在场拒；零写回，完整迁移归 M5）

受控执行与回执（0.3.0 M2，主方案 §4.1/§4.2——真实执行产生回执，文本/指纹不构成新执行）：
  lzy verify run <checkId>                  经受控执行器跑检查配方（argv shell:false+超时击杀+
                                            env 白名单），回执+原始输出落 .lazyzcode/verify/
                                            [--accepts A1,A2] [--note 摘要]
  lzy verify reuse <checkId> --of <runId>   显式请求范围档复用判定（四问全过才放行；拒绝静默
                                            复用；base 回执原时点原事实保留，只追加适用性判定）
  lzy verify qualify <checkId>              对抗资格活体（逐声明输入注入检测+字节原样恢复复核；
                                            资格绑定 checkId+manifestHash，清单变更须重资格化）
  lzy verify list [--goal <slug>]           回执枚举（校验和 fail-closed）
  lzy verify show <runId>                   回执全文+「非现行」身份对照（不冒充现行）
  lzy verify ci [--sha <sha>] [--repo o/n]  只读查询 GitHub check-runs 绑候选身份（gh 缺席/
                                            离线=blocked 原文+恢复指路；记录 sha≠HEAD=非现行）
  （与 lzy loop verify 分工：本族=执行面；证据新鲜度权威在 loop verify 红绿账本）

有界队列与累计预算（0.3.0 M3，主方案 §5——多项已授权工作跨中断连续完成；一切命令以 goal 根为 cwd）：
  lzy queue add <标题> --contract <文件> --plan <文件>
                                            登记待办（proposed；批准该契约=UPS「批准 <短码>」后
                                            自动 authorized）[--endpoint A] [--deps q1,q2] [--goal-slug s]
  lzy queue list                            条目与就绪面（授权/依赖/项目/预算/租约/计划六查）
  lzy queue show <id>                       条目全文+派发事务账+就绪判定
  lzy queue budget [--points N] [--wall-ms M] [--note 来源]
                                            队列总额设定/追加（跨重启/换任务/重试不刷新）；
                                            --resume-points 人工恢复被 #32 停止的积分限派发
  lzy queue dispatch [--item id] [--wall-ms N] [--max-segments N]
                                            取 ready 项派发（锁内占用登记→register/续跑→drive→
                                            finish→结算→确认→腾槽→下一项；崩溃恢复判定表先行）
  lzy queue reconcile                       恢复判定表显式读面（未决事务先核对后动作）
  lzy queue cancel <id> --reason <原因>     取消（保留工件与历史，不清理用户改动）

交付（lzy delivery，0.3.0 M4，ADR-0028）：
  lzy delivery request <B|C> --contract <文件>
                                            绑定 B/C 独立交付契约（endpoint 入哈希）并落批准请求；
                                            批准=UPS 短语「批准 <短码>」，唯一写入口=钩子
  lzy delivery status                       交付授权与意图读面（只读）
  lzy delivery act B --repo <o/n> --branch <b> --base <基> --head <SHA>
                 --pr-title <题> --pr-body-file <文件> [--pr <n>]
                                            B 链：push→PR→漂移复核→CI 全绿→merge（绑 HEAD）
                                            →读回 merge SHA→该 SHA CI 轮询；合并前置=B∧C 双授权
  lzy delivery act C --repo <o/n> --expect-marker <串>
                                            C 链：Pages 构建对齐 merge SHA+线上内容判据
  lzy delivery readback <B|C>               读回收束（merged→done/open→re-arm/未对齐如实）；
                                            超时/断连后先读回，绝不盲目重发

环境：
  LZY_ZCODE_ENGINE  显式指定引擎 zcode.cjs 路径；设置后替换默认候选（默认找 /Applications/ZCode.app/...，
                    也因此可指向不存在路径来测试「引擎缺失→手动启用」回退）

设计红线：lzy 对用户 config.json 零写入；启用一律经引擎官方命令（docs/adr/0001）。
证据纪律：F 项证据绑定 tree hash，代码一变旧证据作废；测试全绿≠证据。`);
}

// ── contract 族（0.3.0 M1，ADR-0024）：只读读面。写入口只有 UPS 钩子（批准/撤回短语），
// CLI 无 approve/withdraw 命令（ADR-0018 同款禁令：模型可跑的写通道=假人权门形态）。
function cmdContract(args) {
  const { _, f } = parseArgs(args);
  const sub = _[0];
  const cwd = process.cwd();
  if (sub === "show") {
    const goal = readGoal(cwd);
    if (!goal?.contract?.contractHash) {
      throw new LoopError(
        `本目录目标未绑定需求契约（register --contract <file> 绑定；无 goal 时先 lzy loop register）——` +
          `无契约 goal 走现行 planHash 人权门（ADR-0018），不受 ADR-0024 契约门管辖`,
      );
    }
    let contract;
    try {
      contract = loadContract(goal.contract.path, cwd);
    } catch (e) {
      throw new LoopError(
        `契约文件不可读或结构非法：${e?.message ?? e}——契约绑定 ${goal.contract.path}（hash ${goal.contract.contractHash.slice(0, 8)}…）；` +
          `修好文件或重新 register --contract（新哈希=新授权请求）`,
      );
    }
    const drift = contract.hash !== goal.contract.contractHash;
    const auth = effectiveAuthorization(cwd, goal.slug, goal.contract.contractHash);
    console.log(`契约 · 目标 ${goal.slug} · ${goal.contract.path}（contractHash ${goal.contract.contractHash.slice(0, 8)}…${drift ? "，⚠ 磁盘文件已漂移——须重新 register --contract" : ""}）`);
    console.log(`  task ${contract.task} · endpoint ${contract.endpoint} · recipe ${contract.recipe}${contract.budgetRef ? ` · budget-ref ${contract.budgetRef}` : ""}`);
    console.log(`  scope：${contract.scopeRaw.join("、")}`);
    if (contract.nonGoals) console.log(`  non-goals：${contract.nonGoals}`);
    console.log(`  验收项（accepts 引用目标）：`);
    for (const a of contract.acceptances) console.log(`    ${a.id}  ${a.text}`);
    console.log(`  授权：${auth.authorized ? "有效（approval 在场且其后无 withdrawal）" : auth.lastEvent ? `失效（最后事件 ${auth.lastEvent.kind} @ ${auth.lastEvent.at}）` : "无记录（待批准）"} · 事件 ${auth.events.length} 条（lzy contract auth 看时序）`);
    return;
  }
  if (sub === "auth") {
    const goal = readGoal(cwd);
    if (!goal?.contract?.contractHash) {
      throw new LoopError("本目录目标未绑定需求契约（lzy contract show 先看绑定态）");
    }
    const auth = effectiveAuthorization(cwd, goal.slug, goal.contract.contractHash);
    console.log(`授权账本 · 目标 ${goal.slug} · 契约 ${goal.contract.contractHash.slice(0, 8)}… · ${auth.events.length} 条（追加式，后到者赢）`);
    for (const e of auth.events) {
      console.log(`  ${e.kind === "approval" ? "✔ 批准" : "✖ 撤回"}  ${e.at}  ${e.file}`);
    }
    console.log(`  生效：${auth.authorized ? "是" : "否"}（.lazyzcode/authorizations/，reset 不清；唯一写入口=UPS 钩子）`);
    return;
  }
  throw new LoopError("用法：lzy contract show | lzy contract auth（只读；批准/撤回走 UPS 短语「批准 <短码>」「撤回 <短码>」）");
}

// ── project 族（0.3.0 M1，主方案 §3.2）：只读发现与就绪静态半；真实执行归 M2 verify。
function cmdProject(args) {
  const { _ } = parseArgs(args);
  const sub = _[0];
  const cwd = process.cwd();
  if (sub === "check") {
    const r = projectCheck(cwd);
    if (!r.present) {
      console.log(`项目清单：本目录无 lzy.project.json（lzy project discover 看缺失面）`);
      return;
    }
    console.log(`项目清单 · lzy.project.json（内容 sha256 ${r.hash.slice(0, 8)}…——契约 recipe 绑定此哈希） · 配方 ${r.recipes.length} 条`);
    for (const rec of r.recipes) {
      console.log(`  [${rec.class}] ${rec.id}  ${rec.state === "entry-present" ? "✔ 入口存在" : "✖ 入口缺失"}（${rec.entry}）`);
    }
    console.log("  （就绪=静态入口存在态；「实际可运行」归 M2 verify 执行回执，不在此冒充）");
    return;
  }
  if (sub === "discover") {
    const r = projectDiscover(cwd);
    if (!r.present) {
      console.log(`只读发现 · ${r.hint}`);
      console.log(`  六类能力全缺：${r.missingClasses.join("、")}`);
      return;
    }
    console.log(`只读发现 · lzy.project.json（sha256 ${r.hash.slice(0, 8)}…）`);
    console.log(`  缺项能力类：${r.missingClasses.length > 0 ? r.missingClasses.join("、") : "（无——六类齐备）"}`);
    if (r.absentEntries.length > 0) {
      console.log(`  入口缺失配方：${r.absentEntries.map((a) => `${a.class}/${a.id}(${a.entry})`).join("、")}`);
    }
    console.log("  （发现面≠受信执行输入：采纳流=契约引用清单哈希并经批准，ADR-0024）");
    return;
  }
  throw new LoopError("用法：lzy project check | lzy project discover（只读）");
}

// ── migrate 族（0.3.0 M1）：只读预览；完整迁移机器归 M5。
function cmdMigrate(args) {
  const { _, f } = parseArgs(args);
  if (_[0] !== "preview") {
    throw new LoopError("用法：lzy migrate preview <目标根路径>（只读；--root <dir> 等价）");
  }
  const root = typeof f.root === "string" ? f.root : _[1];
  if (!root || _[2]) {
    throw new LoopError("用法：lzy migrate preview <目标根路径>（只读；--root <dir> 等价）");
  }
  const result = previewMigration(resolve(process.cwd(), root));
  console.log(renderMigrationPreview(result));
  console.log("  （旧记录零改动；活跃 goal 在场拒预览；authorization 恒 NONE——转换产物须新批准）");
}

// ── verify 族（0.3.0 M2，主方案 §4.1/§4.2）：受控执行回执 + 范围档复用 + CI 身份绑定。
// 与 `lzy loop verify`（证据时效核对读面）分工：本族=检查配方的真实执行/复用/资格/CI 查询
// 执行面；证据新鲜度权威仍在 loop verify（red-green 账本），两读面不互代。
function cmdVerify(args) {
  const { _, f } = parseArgs(args);
  const sub = _[0];
  const cwd = process.cwd();
  const accepts = typeof f.accepts === "string" ? f.accepts.split(/[\s,，]+/).filter(Boolean) : [];
  const note = typeof f.note === "string" ? f.note : null;
  if (sub === "run") {
    const checkId = _[1];
    if (!checkId || _[2]) throw new LoopError("用法：lzy verify run <checkId> [--accepts A1,A2] [--note 摘要]");
    const { receipt, receiptPath, rawRel } = runCheck(cwd, checkId, { accepts, note });
    const exitDesc = receipt.exit.timeout ? "超时击杀（SIGTERM/ETIMEDOUT）" : receipt.exit.error ? `error: ${receipt.exit.error}` : `exit ${receipt.exit.code}`;
    console.log(`执行回执 · ${checkId} · ${exitDesc} · runId ${receipt.runId}`);
    console.log(`  候选 HEAD ${receipt.candidate.headSha?.slice(0, 10) ?? "—"} · 复合指纹 ${receipt.candidate.compositeFingerprint?.slice(0, 12) ?? "unbound"} · 清单 ${receipt.recipe.manifestHash?.slice(0, 12) ?? "—"}`);
    console.log(`  回执 ${receiptPath} · 原始输出 ${rawRel}（人工摘要与原始输出分离保存）`);
    if (receipt.inputSnapshot) console.log(`  输入快照：${Object.keys(receipt.inputSnapshot).length} 项已入档（范围档复用判定面）`);
    if (receipt.exit.code !== 0) process.exitCode = 1;
    return;
  }
  if (sub === "reuse") {
    const checkId = _[1];
    const baseRunId = typeof f.of === "string" ? f.of : null;
    if (!checkId || !baseRunId || _[2]) {
      throw new LoopError("用法：lzy verify reuse <checkId> --of <runId>（显式请求复用判定；拒绝静默复用）");
    }
    const r = reuseRun(cwd, checkId, baseRunId, { accepts, note });
    if (!r.ok) {
      console.error(`复用拒绝（保守回退全树档）· ${checkId} · base ${baseRunId}`);
      for (const reason of r.reasons) console.error(`  ✖ ${reason}`);
      console.error("  恢复：lzy verify run " + checkId + " 真实重验（范围档四问全过才可复用，ADR-0025）");
      process.exitCode = 1;
      return;
    }
    console.log(`复用回执 · ${checkId} · base ${baseRunId}（原时点 ${r.receipt.startedAt}，原观察事实保留） · runId ${r.receipt.runId}`);
    for (const reason of r.receipt.reuseJudgment.reasons) console.log(`  ✔ ${reason}`);
    console.log(`  回执 ${r.receiptPath}（追加式适用性判定——base 回执未被改写）`);
    return;
  }
  if (sub === "qualify") {
    const checkId = _[1];
    if (!checkId || _[2]) throw new LoopError("用法：lzy verify qualify <checkId>（对抗资格活体：逐声明输入注入检测+原样恢复）");
    const { receipt, receiptPath, baselineRunId } = qualifyCheck(cwd, checkId, { note });
    console.log(`qualification 资格回执 · ${checkId} · 基线 runId ${baselineRunId} · 注入 ${receipt.injections.length} 条全检测`);
    for (const inj of receipt.injections) console.log(`  ✔ ${inj.entry}（${inj.mode}）检测通过且已原样恢复`);
    console.log(`  回执 ${receiptPath}（资格绑定 checkId+manifestHash——清单变更须重新资格化）`);
    return;
  }
  if (sub === "list") {
    const slug = typeof f.goal === "string" ? f.goal : null;
    const receipts = listReceipts(cwd, slug);
    console.log(`执行回执 · ${receipts.length} 条（.lazyzcode/verify/ · reset 不清 · 校验和 fail-closed）`);
    for (const r of receipts) {
      const exitDesc = r.exit.blocked ? "blocked" : r.exit.noRemoteCommit ? "远端无此提交" : r.exit.timeout ? "timeout" : r.exit.error ? "error" : `exit ${r.exit.code}`;
      console.log(`  ${r.startedAt}  ${r.kind.padEnd(13)} ${r.checkId.padEnd(14)} ${exitDesc.padEnd(10)} ${r.runId}`);
    }
    return;
  }
  if (sub === "show") {
    const runId = _[1];
    if (!runId || _[2]) throw new LoopError("用法：lzy verify show <runId>");
    const { receipt, current } = showReceipt(cwd, runId);
    console.log(JSON.stringify(receipt, null, 2));
    console.log(
      current
        ? "  身份对照：现行（记录复合指纹=现行候选指纹）"
        : "  身份对照：非现行（记录身份≠现行候选——原观察事实按原时点解释，不冒充现行）",
    );
    return;
  }
  if (sub === "ci") {
    const { receipt, receiptPath, recordedSha, nowHead } = queryCiChecks(cwd, {
      repo: typeof f.repo === "string" ? f.repo : null,
      sha: typeof f.sha === "string" ? f.sha : null,
      note,
    });
    if (receipt.exit.blocked) {
      console.error(`CI 查询 blocked · ${receipt.ci.repo}@${recordedSha.slice(0, 10)}`);
      console.error(`  ✖ ${receipt.exit.blocked}`);
      console.error(`  回执 ${receiptPath}（blocked 如实落账——不静默空过）`);
      process.exitCode = 1;
      return;
    }
    if (receipt.exit.noRemoteCommit) {
      console.log(`CI 查询 · ${receipt.ci.repo}@${recordedSha.slice(0, 10)} → 无 CI 结果`);
      console.log(`  ${receipt.exit.detail}`);
      console.log(`  回执 ${receiptPath}`);
      process.exitCode = 1;
      return;
    }
    console.log(`CI 检查 · ${receipt.ci.repo}@${recordedSha.slice(0, 10)} · ${receipt.ci.checks.length} 条 check-runs`);
    for (const c of receipt.ci.checks) {
      console.log(`  ${c.conclusion ?? "—"}  ${c.name}  ${c.details_url ?? ""}`);
    }
    const allGreen = receipt.ci.checks.length > 0 && receipt.ci.checks.every((c) => c.conclusion === "success");
    console.log(
      `  判读：${allGreen ? "全绿（绑定该提交身份）" : receipt.ci.checks.length === 0 ? "无 check-runs 在案" : "存在非 success 结论"} · ` +
        (recordedSha === nowHead ? "记录 sha=现行 HEAD（现行）" : `记录 sha≠现行 HEAD（${nowHead?.slice(0, 10) ?? "—"}）——非现行，候选变化后须重新核对`),
    );
    console.log(`  回执 ${receiptPath}`);
    if (!allGreen) process.exitCode = 1;
    return;
  }
  throw new LoopError("用法：lzy verify run|reuse|qualify|list|show|ci（执行面；证据新鲜度权威在 lzy loop verify）");
}

// 有界队列（0.3.0 M3，主方案 §5）：add/list/show/budget/dispatch/reconcile/cancel。
// 一切队列命令以「goal 根」为 cwd（.lazyzcode/ 解析不向上走——试点以夹具根为 cwd）。
function cmdQueue(args) {
  const { _, f } = parseArgs(args);
  const action = _[0];
  const cwd = process.cwd();
  if (action === "add") {
    const title = _[1];
    const contractFile = typeof f.contract === "string" ? f.contract : null;
    if (!title || !contractFile) {
      throw new LoopError("用法：lzy queue add <标题> --contract <文件> --plan <文件> [--endpoint A] [--deps q1,q2] [--goal-slug s]");
    }
    const deps = typeof f.deps === "string" && f.deps.trim() ? f.deps.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const item = addQueueItem(cwd, {
      title,
      contractFile,
      planFile: typeof f.plan === "string" ? f.plan : null,
      endpoint: typeof f.endpoint === "string" ? f.endpoint : "A",
      deps,
      goalSlug: typeof f["goal-slug"] === "string" && f["goal-slug"].trim() ? f["goal-slug"].trim() : null,
    });
    console.log(`✔ 条目已登记：${item.id}（${item.state}）· goal=${item.goalSlug} · 契约 ${item.contractHash.slice(0, 8)}… · 计划 ${item.planPath}`);
    console.log("  下一步：批准该契约（UPS 短码=contractHash 前 8 位）后条目自动 authorized；lzy queue list 看就绪面");
    return;
  }
  if (action === "list") {
    console.log(formatQueueList(cwd));
    return;
  }
  if (action === "show") {
    const id = _[1];
    if (!id || _[2]) throw new LoopError("用法：lzy queue show <id>");
    const { item, txs, readiness } = showQueueItem(cwd, id);
    console.log(JSON.stringify(item, null, 2));
    console.log(`  就绪：${readiness.ready ? "ready" : "未就绪"}`);
    for (const r of readiness.reasons) console.log(`    ✖ ${r}`);
    console.log(`  派发事务 ${txs.length} 条：`);
    for (const t of txs) {
      console.log(`    ${t.txId}  ${t.phase.padEnd(18)} opened ${t.openedAt}${t.settledAt ? ` → ${t.settledAt}` : ""}${t.segments.length ? ` · 段 ${t.segments.length}` : ""}${t.note ? ` · ${t.note.slice(0, 80)}` : ""}`);
    }
    return;
  }
  if (action === "budget") {
    const hasPoints = f.points != null && f.points !== "";
    const hasWall = f["wall-ms"] != null && f["wall-ms"] !== "";
    const resume = f["resume-points"] === true;
    if (!hasPoints && !hasWall && !resume) {
      const v = budgetView(cwd);
      console.log(`队列预算：积分总额 ${v.pointsLimit ?? "未设"} · 墙钟总额 ${v.wallLimitMs != null ? `${v.wallLimitMs}ms` : "未设"}`);
      console.log(`  已耗：积分 ${Math.round(v.points * 100) / 100} · 墙钟 ${v.wallMs}ms ｜ 未决占用：积分 ${Math.round(v.openPoints * 100) / 100} · 墙钟 ${v.openWallMs}ms（崩溃未决按上限保守计入，绝不当零）`);
      if (v.pointsStopped) console.log("  ⚠ 受积分限额约束的派发已停止（计量缺席/未决占用在案，#32）——人工核对后 --resume-points 恢复");
      return;
    }
    const b = setQueueBudget(cwd, {
      points: hasPoints ? Number.parseFloat(f.points) : null,
      wallMs: hasWall ? Number.parseInt(f["wall-ms"], 10) : null,
      note: typeof f.note === "string" ? f.note : null,
      resumePoints: resume,
    });
    console.log(`✔ 队列预算已设：积分 ${b.pointsLimit ?? "—"} · 墙钟 ${b.wallLimitMs != null ? `${b.wallLimitMs}ms` : "—"}（追加=新 provenance 注记，历史不覆写）`);
    return;
  }
  if (action === "dispatch") {
    const item = typeof f.item === "string" ? f.item : null;
    const opts = {
      item,
      wallMs: f["wall-ms"] != null && f["wall-ms"] !== "" ? Number.parseInt(f["wall-ms"], 10) : null,
      maxSegments: f["max-segments"] != null && f["max-segments"] !== "" ? Number.parseInt(f["max-segments"], 10) : undefined,
      mode: typeof f.mode === "string" ? f.mode : undefined,
    };
    return runQueueDispatch(cwd, opts).then((r) => {
      const failed = r.results.filter((x) => x.outcome === "failed" || x.outcome === "error");
      if (failed.length > 0) process.exitCode = 1;
    });
  }
  if (action === "reconcile") {
    if (_[1]) throw new LoopError("用法：lzy queue reconcile（恢复判定表：先核对后动作，绝不重复派发/绝不 reset 另一目标）");
    const { verdicts } = reconcileDispatch(cwd);
    if (verdicts.length === 0) console.log("恢复核对：无未决派发事务");
    for (const v of verdicts) console.log(`  ${v.txId} → ${v.verdict}`);
    return;
  }
  if (action === "cancel") {
    const id = _[1];
    if (!id || typeof f.reason !== "string") throw new LoopError("用法：lzy queue cancel <id> --reason <原因>（取消保留工件与历史，不清理用户改动）");
    const it = cancelQueueItem(cwd, id, f.reason);
    console.log(`✔ ${it.id} 已取消（工件与历史保留）——blockedReason：${it.blockedReason}`);
    return;
  }
  throw new LoopError("用法：lzy queue add|list|show|budget|dispatch|reconcile|cancel（有界队列，0.3.0 M3）");
}

// ── delivery 族（0.3.0 M4，ADR-0028）：B/C 外部动作的授权与执行面。授权写入口只有
// UPS 钩子（批准/撤回短语）——request 仅落契约绑定+批准请求（contractPending），CLI 无
// approve/withdraw（ADR-0018 禁令同族）；act/readback 受授权门+意图账本执法（防重复
// 执行/漂移复核/unknown 先读回）。
function formatIntentLine(it) {
  const t = it.target ?? {};
  const obs = it.observed ?? {};
  const obsTxt = obs.mergeSha
    ? `mergeSha=${String(obs.mergeSha).slice(0, 10)} ci=${obs.mergeCiState ?? "?"}`
    : obs.pagesBuild
      ? `pages=${obs.pagesBuild.status}/${String(obs.pagesBuild.commit ?? "").slice(0, 10)}`
      : "";
  const tgt = JSON.stringify({
    repo: t.repo,
    branch: t.branch,
    headSha: t.headSha ? String(t.headSha).slice(0, 10) : undefined,
    prNumber: t.prNumber,
    mergeSha: t.mergeSha ? String(t.mergeSha).slice(0, 10) : undefined,
    expectMarker: t.expectMarker,
  });
  const n = typeof it.attempts === "number" ? it.attempts : (it.attempts?.length ?? 0);
  return `  ${it.id} [${it.endpoint}] ${it.kind} · ${it.status}${obsTxt ? ` · ${obsTxt}` : ""} · target=${tgt} · attempts=${n}`;
}

function cmdDelivery(args) {
  const { _, f } = parseArgs(args);
  const action = _[0];
  const cwd = process.cwd();
  if (action === "request") {
    const ep = _[1];
    const contractFile = typeof f.contract === "string" ? f.contract : null;
    if (!ep || !contractFile || _[2]) {
      throw new LoopError("用法：lzy delivery request <B|C> --contract <契约文件>（B/C 各立独立契约，endpoint 入哈希）");
    }
    const v = validateDeliveryContract(cwd, ep, contractFile);
    const bound = bindDeliveryContract(cwd, ep, v.path, v.hash);
    console.log(`✔ delivery 契约已绑定：${ep} ← ${v.path}（contractHash ${v.hash.slice(0, 8)}…）`);
    console.log(`  批准对象=契约完整哈希（ADR-0024/0028）：把「批准 ${bound.short}」原样转给用户；`);
    console.log(`  批准由 UPS 钩子在真实用户消息上落账（本 CLI 无 approve 命令），随后 lzy delivery status 查授权面。`);
    return;
  }
  if (action === "status") {
    const s = deliveryStatus(cwd);
    if (!s.goal) {
      console.log("本目录没有进行中的目标——delivery 授权与意图挂 goal。");
      return;
    }
    const pend = s.goal.contractPending ? `（pending ${String(s.goal.contractPending.contractHash).slice(0, 8)} 等待批准）` : "";
    console.log(`目标 ${s.goal.slug}（${s.goal.status}）${pend}`);
    for (const ep of ["B", "C"]) {
      const c = s.contracts[ep];
      console.log(
        c.bound
          ? `  ${ep}: 契约 ${c.contractPath}（${c.contractHash.slice(0, 8)}…）· 授权=${c.authorized ? "有效" : "未批准/已撤回"} · 授权事件 ${c.events}`
          : `  ${ep}: 未绑定`,
      );
    }
    if (s.intents.length === 0) console.log("  意图账本空。");
    for (const it of s.intents) console.log(formatIntentLine(it));
    return;
  }
  if (action === "act") {
    const ep = _[1];
    if (ep === "B") {
      if (!f.repo || !f.branch || !f.base || !f.head || !f["pr-title"] || !f["pr-body-file"]) {
        throw new LoopError("用法：lzy delivery act B --repo <owner/name> --branch <分支> --base <基线> --head <40位SHA> --pr-title <题> --pr-body-file <正文文件> [--pr <编号>]");
      }
      const r = actDeliveryB(cwd, {
        repo: f.repo,
        branch: f.branch,
        base: f.base,
        head: f.head,
        prTitle: f["pr-title"],
        prBodyFile: f["pr-body-file"],
        pr: f.pr != null ? Number(f.pr) : null,
      });
      const o = r.intent.observed;
      if (r.alreadyMerged) {
        console.log(`✔ B 链读回权威：PR #${o.prNumber} 已处于 merged（mergeSha ${String(o.mergeSha).slice(0, 10)}）——绝不重发合并`);
      } else {
        console.log(`✔ B 链完成：PR #${o.prNumber} 已合并（--match-head-commit 绑定）→ 实际 mergeSha=${String(o.mergeSha).slice(0, 10)}`);
      }
      if (o.mergeCiState === "green") console.log(`  merge SHA CI 全绿（${o.mergeCiDetail}）——B 端点判据满足（A3）`);
      else if (o.mergeCiState === "pending") console.log(`  ⚠ merge SHA CI 预算内未全绿（${o.mergeCiDetail}）——lzy delivery readback B 复验后再下结论`);
      else console.log(`  ✖ merge SHA CI 失败（${o.mergeCiDetail ?? "详情见意图账本"}）——「已合并、验证失败」如实记账，不归 B completed（V09）`);
      return;
    }
    if (ep === "C") {
      if (!f.repo || !f["expect-marker"]) {
        throw new LoopError("用法：lzy delivery act C --repo <owner/name> --expect-marker <合并后才存在的稳定串> [--content-url <具体页 URL>]");
      }
      const r = actDeliveryC(cwd, { repo: f.repo, expectMarker: f["expect-marker"], contentUrl: f["content-url"] ?? null });
      console.log(`✔ C 链完成：Pages 构建 ${r.build.status} @ ${String(r.build.commit).slice(0, 10)}（== mergeSha）`);
      console.log(`  HTTPS ${r.siteUrl} → 200 ∧ 内容标记在场——C 端点判据满足（A4）`);
      return;
    }
    throw new LoopError("用法：lzy delivery act <B|C>（B=合并链 / C=Pages 上线核验）");
  }
  if (action === "readback") {
    const ep = _[1];
    if (ep === "B") {
      const r = readbackDeliveryB(cwd, { repo: f.repo, pr: f.pr != null ? Number(f.pr) : null });
      const o = r.intent.observed ?? {};
      if (r.intent.status === "done") {
        console.log(`✔ readback B：PR #${o.prNumber ?? r.pr.number} merged（mergeSha ${String(o.mergeSha ?? r.pr.mergeSha).slice(0, 10)}，closedBy=${o.closedBy ?? "?"}）· merge CI=${o.mergeCiState ?? "query-failed"}`);
      } else if (r.intent.status === "intended") {
        console.log(`➖ readback B：PR #${r.pr.number} 仍 open——合并未发生，意图 ${r.intent.id} re-arm（r.rearmed ? "已从异常态恢复" : "本就 intended"）`);
      } else {
        console.log(`✖ readback B：PR #${r.pr.number} ${r.pr.state}——意图 ${r.intent.id}=${r.intent.status}`);
      }
      return;
    }
    if (ep === "C") {
      const r = readbackDeliveryC(cwd, { repo: f.repo, expectMarker: f["expect-marker"] });
      if (r.aligned && r.verified) console.log(`✔ readback C：构建对齐且内容标记在场（意图 ${r.intent.id}=${r.intent.status}）`);
      else if (r.aligned) console.log(`⚠ readback C：构建对齐但内容判据不符（意图 ${r.intent.id}=${r.intent.status}）——V11 不假绿`);
      else console.log(`➖ readback C：构建未对齐（意图 ${r.intent.id}=${r.intent.status}）——稍后复验`);
      return;
    }
    throw new LoopError("用法：lzy delivery readback <B|C> [--repo <o/n>] [--pr <n>] [--expect-marker <串>]");
  }
  throw new LoopError("用法：lzy delivery request|status|act|readback（有限交付面，0.3.0 M4）");
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
    case "update":
      if (args.length > 1) {
        throw new LoopError("lzy update 不接参数（一键升级：npm 拉 latest 包 + 新装子进程 sync）");
      }
      return cmdUpdate();
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
    case "evidence":
      return cmdEvidence(args.slice(1));
    case "attest":
      return cmdAttest(args.slice(1));
    case "dag":
      return cmdDag(args.slice(1));
    case "contract":
      return cmdContract(args.slice(1));
    case "project":
      return cmdProject(args.slice(1));
    case "migrate":
      return cmdMigrate(args.slice(1));
    case "verify":
      return cmdVerify(args.slice(1));
    case "queue":
      return cmdQueue(args.slice(1));
    case "delivery":
      return cmdDelivery(args.slice(1));
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
