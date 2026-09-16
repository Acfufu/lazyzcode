#!/usr/bin/env node
// lzy — LazyZCode CLI：install / sync / status / uninstall / loop / step。
// loop = 目标循环状态机（注册→计划门→逐步派发→证据验证→完成），状态在 .lazyzcode/。
import { resolve } from "node:path";
import { watch } from "node:fs";
import { install, sync, uninstall, readRepoManifest } from "../core/installer.js";
import { createUpdater } from "../core/update.js";
import { collectStatus } from "../core/status.js";
import { collectDoctor } from "../core/doctor.js";
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
  fingerprintSubjects,
  noGoalMessage,
  readGoal,
  recordEvidenceHalf,
  registerGoal,
  removeSubject,
  resetLoop,
  setTier,
  startLoop,
  verifyEvidence,
  writeGoalReport,
} from "../core/loop.js";
import {
  dependents as dagDependents,
  loadDag,
  stalePreview,
} from "../core/dag.js";
import { findEngine, repoPluginDir, userCliLogDir } from "../core/paths.js";
import { collectRateLimitStats, bandAdvisory } from "../core/ratelimit.js";
import { auditAgentsMd, formatAgentsMd } from "../core/agentsmd.js";
import { formatCost } from "../core/cost.js";

const ICON = { ok: "✔", fail: "✖", warn: "⚠", skip: "➖" };

// `--key value` / `--key=value` / 裸旗标 → { _: 位置参数, f: 旗标表 }
// 只有值旗标白名单内的才吃下一个参数（评审 R2-8：--force plan.md 不再把路径吞成值）；
// `=` 形式的 true/false 归一为布尔（评审 R2-8：--force=true 不再被当成字符串判 false）；
// MULTI_FLAGS 可重复出现追加成数组（--evidence-file a --evidence-file b）。
const VALUE_FLAGS = new Set(["title", "review", "note", "evidence", "evidence-file", "root", "tier", "surface", "reason", "goal"]);
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
      });
      console.log(`✔ 目标已注册：${goal.slug} — ${goal.title}（状态 planning · tier ${goal.tier}）`);
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
      const goal = finishLoop(cwd, git, {
        writeReport: ({ cwd: c, git: g, goal: gl }) => writeGoalReport(c, g, gl),
      });
      console.log(`✔✔ 目标完成：${goal.slug} — ${goal.title}`);
      console.log("  全部步骤收口，F 项证据绑复合指纹，subject 集全 clean。不做完不停——这次真的做完了。");
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
          const { goal, root } = removeSubject(cwd, _[2]);
          console.log(`✔ subject 已移除：${root}（剩 ${goal.subjects.length} 项）`);
        }
        console.log("  集合变化=复合指纹变化：全体已录 F 证据过期，重取后才可 finish");
        return;
      }
      if (action === "list") {
        if (_[2]) throw new LoopError(`多余参数：${_[2]}（用法：lzy loop subject list）`);
        const goal = readGoal(cwd);
        const subjects = goal?.subjects ?? [];
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
      throw new LoopError(`未知 loop 子命令：${sub}（register/plan/start/subject/tier/claim/status/list/history/cost/verify/finish/export/abandon/reset/handoff）`);
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
    const nodes = dag.nodes.filter((n) => n.slug === slug || (n.kind === "review" && dag.nodes.some((p) => p.id === reviewPlanIdOf(dag, n) && p.slug === slug)));
    console.log(`证据账本 · 目标 ${slug} · ${nodes.length} 节点（机器只记账不裁决——缺半不拦门，执法在协议文本+comparator）`);
    // plan/review 一等公民（按 slug/planHash 对 goal.json，永不标孤儿）
    const planNodes = nodes.filter((n) => n.kind === "plan");
    const reviewNodes = nodes.filter((n) => n.kind === "review");
    const latestPlan = planNodes[planNodes.length - 1];
    if (latestPlan) {
      const rev = reviewNodes.filter((r) => r.planHash === latestPlan.planHash);
      console.log(`  计划 ${latestPlan.id} · planHash ${String(latestPlan.planHash).slice(0, 10)} · 评审 ${rev.length ? rev.map((r) => r.id).join("/") : "无节点"}`);
    }
    // goal.json 在场才做孤儿判定（历史账本无基准，不妄判）
    const stepsById = goal && goal.slug === slug ? new Map(goal.steps.map((s) => [s.id, s])) : null;
    const currentFp = stepsById ? fingerprintSubjects(cwd, goal.subjects) : null;
    const staleMap = new Map(stalePreview(dag, currentFp).map((x) => [x.node.id, x.status]));
    const evNodes = nodes.filter((n) => n.kind === "evidence");
    const byStep = new Map();
    for (const n of evNodes) {
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
      const cur = greens[greens.length - 1];
      const greenPart = cur
        ? `绿 ✓ gen${cur.seq}（${surfShort(cur.surface)} · ${staleLabel(staleMap.get(cur.id))}）`
        : "绿 ✗（未录）";
      const redPart = reds.length
        ? `红 ✓ ${reds.map((r) => `${r.id} gen${r.seq}（${surfShort(r.surface)}）`).join(" ")}`
        : waives.length
          ? `红 ➖ waived（${waives.map((w) => `「${String(w.text).slice(0, 40)}」`).join(" ")}）`
          : "红 ✗（未录）";
      console.log(`  ${fid} · ${greenPart} · ${redPart}`);
      if (greens.length > 1) {
        console.log(`    rebind 链 ${greens.length} 代（gen${greens[0].seq}→gen${cur.seq}，现行 gen${cur.seq}）`);
      }
    }
    // 孤儿=green 节点代数超前 goal.json 已落地代数（dag-first 部分失败残留）；red/waived
    // 本就不入 goal.json（边即记录），永不标孤儿。如实标注不静默隐藏。
    if (stepsById) {
      const orphans = evNodes.filter((n) => {
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
        ? "用法：lzy evidence red <Fid> --evidence <改前态失败取证> [--evidence-file <文件>]… [--surface <外部表面描述>]"
        : "用法：lzy evidence waive-red <Fid> --reason <一行豁免理由>",
    );
  }
  const textFlag = action === "red" ? f.evidence : f.reason;
  const { node, dirty } = recordEvidenceHalf(cwd, createGit(cwd), _[1], {
    half: action === "red" ? "red" : "waived",
    text: typeof textFlag === "string" ? textFlag : null,
    files: evidenceFileArgs(cwd, f),
    surfaceExternal: typeof f.surface === "string" ? f.surface : null,
  });
  console.log(`${ICON.ok} 红半账本已记：${node.id} · ${node.half} · ${node.slug}/${node.step} gen${node.seq}`);
  if (node.surface) {
    console.log(`  表面（各绑各面）${node.surface.kind}:${node.surface.kind === "fingerprint" ? node.surface.value.slice(0, 10) : node.surface.value}`);
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

// ── DAG 查询命令族（只读，无锁——原子写保证读者见旧或新，绝不见半写） ─────────
function cmdDag(args) {
  const { _ } = parseArgs(args);
  if (_[0] !== "dependents" || !_[1] || _[2]) {
    throw new LoopError("用法：lzy dag dependents <节点id|表面值>（「什么依赖 X」）");
  }
  const dag = loadDag(process.cwd());
  const res = dagDependents(dag, _[1]);
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
  lzy loop start                            开跑（planning → executing，打印实测并发纪律行）
  lzy loop tier heavy                       tier 升级（只升不降；机器门=采纳时点，ADR-0013）
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
  lzy step done <ID> [--note …] [--evidence …] [--evidence-file <文件>]…
                                            收口一步（F 项必须带真实表面证据；附件复制入
                                            .lazyzcode/evidence/ 并绑 sha256，≤4 个/项）
  lzy loop verify                           证据时效核对（退出码 0=全部新鲜，1=有过期/未绑定）
  lzy loop finish                           终验完成（全部 done + F 证据新鲜才放行；自动归档证据包）
  lzy loop export                           重导出证据包到 .lazyzcode/evidence/<slug>.report.md
  lzy loop abandon / reset                  放弃 / 清除状态

证据账本（中央失效 DAG，跨目标常驻——机器只记账不裁决，ADR-0014）：
  lzy evidence red <Fid> --evidence <text> [--evidence-file <文件>]… [--surface <描述>]
                                            登记红半（改前态失败取证；缺省绑当前复合指纹，
                                            --surface 声明外部表面如已发布版版本号）
  lzy evidence waive-red <Fid> --reason <理由>
                                            登记红半豁免（真构造不出反态的面；一行豁免的
                                            机器形态）
  lzy evidence list [--goal <slug>]         红绿 manifest 视图（halves 配对/表面短码/rebind 链）
  lzy dag dependents <节点id|表面值>        「什么依赖 X」查询（只读）

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
    case "dag":
      return cmdDag(args.slice(1));
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
