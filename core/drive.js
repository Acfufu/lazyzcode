// drive 编排器（0.2.0 棒2，ADR-0020/§⑮ Q3）：`lzy loop drive` 的实现——单唤起内循环
// spawn headless 会话推进一个 executing 目标，段间查 budget/lease/risk 三门，收束=
// 步完成/预算尽/门拒/需人工，五因收束（除 done 外）自写 7 字段 handoff 快照干净交回。
// 门序：executing 态 → risk（assertDriveEligible）→ 引擎 → 凭据 → lease（他租拒）→
// 预算（缺席 init / 在场 restart 重开每-run 预算——「每次 drive 双硬顶」§⑮ Q4）。
// 段内 fence 注入（ADR-0020「drive 派生工人一律注入 fence」接线点）：段会话 env 带
// LZY_RUNTIME_FENCE，段内一切 lzy 写经 guardFence fail-closed；本进程同 env 申报自身
// handoff 写。points 侧活体归因不可行（cost.js 按小时桶读 billing DB），账本积分恒 0，
// 积分执法=水位联动（rollingWaterlinePoints ≥ pointsBudget → 收束；ADR-0020 已知边界）。
// 退出码契约：0=done 或干净收束（run 契约正常完成）；1=门拒/段 infra 失败（尽力收束带
// 快照后非零）。deps 可注入（run/rollingPoints/now/git）供离线契约测试（headless.js 先例）。
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  LoopError,
  assertDriveEligible,
  handoffGoal,
  lintHandoffSnapshot,
  loopDir,
  noGoalMessage,
  readGoal,
  withLock,
} from "./loop.js";
import {
  acquireLease,
  heartbeatLease,
  initBudget,
  loadRuntime,
  recordSpend,
  releaseLease,
} from "./runtime.js";
import {
  HEADLESS_DEFAULT_TIMEOUT_MS,
  HEADLESS_MODES,
  detectHeadlessAuth,
  spawnHeadless,
} from "./headless.js";
import { findEngine } from "./paths.js";
import { rollingWaterlinePoints } from "./cost.js";
import { createGit } from "./git.js";

export const DRIVE_MAX_SEGMENTS_DEFAULT = 6;
export const DRIVE_MODE_DEFAULT = "yolo";
// 段超时上限（单段墙钟）；spawnHeadless 显式 mode 立场不变——drive 缺省 yolo（无人值守
// 段必须免审批，build/edit 会在 PermissionRequest 上无人可批地停摆）。
export const DRIVE_SEGMENT_TIMEOUT_MS = HEADLESS_DEFAULT_TIMEOUT_MS;
// lease TTL：max(缺省 15min, 2×段超时)——段间心跳制下给单段留足缓冲（已知未知②）。
const LEASE_TTL_MS = Math.max(15 * 60_000, 2 * DRIVE_SEGMENT_TIMEOUT_MS);
const STUCK_STREAK_LIMIT = 2; // 镜像 Stop 振数纪律：连续两段零推进→stuck 收束

function doneCountOf(goal) {
  return (goal?.steps ?? []).filter((s) => s?.status === "done").length;
}

function pendingStepsOf(goal) {
  return (goal?.steps ?? []).filter((s) => s?.status !== "done");
}

function composeSegmentPrompt(cwd, cliPath) {
  // 「zw 继续」头触发 UPS 分层装载 zw 协议（headless UPS 活体先例=e2e-loop 人权门轮）；
  // 后接紧凑续跑契约（对话史在 headless 段不可依赖——交接状态全在盘面，offpeak-probe 教训）。
  return [
    "zw 继续",
    "",
    `（无人值守 drive 段）你在 ${resolve(cwd)} 工作区推进一个正在执行（executing）的目标循环。`,
    `lzy CLI 一律用仓内路径调用：node ${cliPath} <args>（全局 lzy 可能是旧版影子，勿用）。`,
    "本段任务：",
    `1. 运行 node ${cliPath} loop status 核实状态与下一步。`,
    "2. 有未完步骤：只推进一个步骤——按计划完成该步，先 commit 再取证，然后 node <CLI> step done <ID> --note …，随即结束本段（勿连续多步，段间由 drive 复核三门）。",
    "3. status 显示无未完步骤：按 zw 协议走收尾对照门（逐对核验证据后 node <CLI> attest comparator --file …）并 node <CLI> loop finish 收官。",
    "红线：绝不注册新目标；绝不运行 lzy loop drive；绝不 reset/abandon；写命令已带 fence 环境（勿摘）；全程用工具真实执行，不要问询；无新输入时立即收尾本段。",
  ].join("\n");
}

// 7 字段交接快照自写（lint 家法：先 lint 后登记，契约字面量与 SKILL 模板逐字节一致）。
// ADJ-23（0.2.1 五轮双审）：快照落工作区 `.lazyzcode/loop/handoff/`（reset 不清家族）——
// 原实现落 OS 临时目录：唯一指针被下个 Stop 消费、/tmp 会被系统清理、每次收束留垃圾
// 目录，「下一唤起从盘上恢复」的承诺落空（无人值守后继会话读不到精确续跑状态）。
function authorHandoffSnapshot(cwd, goal, cause, extraRisk, deps) {
  const git = deps.git ? deps.git(cwd) : createGit(cwd);
  const porcelain = git.porcelainPaths();
  const treeHash = git.headTreeHash();
  const pending = pendingStepsOf(goal);
  const lines = [
    "# 交接快照",
    "## 剩余步骤",
    pending.length > 0
      ? pending.map((s) => `${s.id} [${s.kind}] ${s.title}`).join("\n")
      : "（无未完步骤）",
    "## 下一步动作",
    `接手会话按计划推下一未完步骤（先 commit 再取证；收束因「${cause}」，非目标失败）`,
    "## 目标与进度",
    `${goal?.slug ?? "—"} · ${doneCountOf(goal)}/${(goal?.steps ?? []).length} 步 · drive 收束因=${cause}`,
    "## 脏树清单",
    Array.isArray(porcelain) && porcelain.length > 0 ? porcelain.join("\n") : "（无）",
    "## tree hash",
    treeHash ?? "（不可解析）",
    "## 风险与坑",
    extraRisk ||
      `drive 于 ${new Date().toISOString()} 因「${cause}」干净收束；段内 lzy 写已带 fence；lease 已释放`,
    "## 复归指令",
    "zw 继续",
  ];
  const content = `${lines.join("\n")}\n`;
  const missing = lintHandoffSnapshot(content);
  if (missing.length > 0) {
    throw new LoopError(`drive 自写交接快照未过 7 字段 lint：${missing.join("、")}`);
  }
  const dir = join(loopDir(cwd), "handoff");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snap = join(dir, `${goal?.slug ?? "goal"}-${stamp}.md`);
  writeFileSync(snap, content, { mode: 0o600 });
  return { snap, treeHash };
}

export async function runDrive(cwd, opts = {}, deps = {}) {
  const maxSegments = Number.isInteger(opts.maxSegments) && opts.maxSegments > 0
    ? opts.maxSegments
    : DRIVE_MAX_SEGMENTS_DEFAULT;
  const mode = opts.mode ?? DRIVE_MODE_DEFAULT;
  const wallMs = Number.isFinite(opts.wallMs) && opts.wallMs > 0 ? opts.wallMs : null;
  // ADJ-26（0.2.1 五轮双审）：参数校验前置——原实现 mode 校验在 spawnHeadless 内（取租/
  // 建预算之后），一次纯用法错误已落 runtime.json 且不留交接快照。
  if (!HEADLESS_MODES.has(mode)) {
    throw new LoopError(
      `--mode 非法：${JSON.stringify(mode)}——合法 ${[...HEADLESS_MODES].join("|")}（drive 缺省 yolo）`,
    );
  }

  // ── 门序（任一拒即 LoopError → CLI exit1）─────────────────────────────────
  const goal = readGoal(cwd);
  if (!goal) throw new LoopError(noGoalMessage(cwd));
  if (goal.status !== "executing") {
    throw new LoopError(
      `drive 只推进 executing 目标（现状 ${goal.status}）——无人值守边界：绝不立新计划（人权门+决策完备门不可代）`,
    );
  }
  assertDriveEligible(goal); // risk 门（HIGH/RESTRICTED 拒；LZY_ABLATE_RISK_GATE 自带）
  if (!deps.enginePath && !findEngine()) {
    throw new LoopError(
      "引擎未找到——drive 段需 ZCode 桌面端引擎（装桌面端或设 LZY_ZCODE_ENGINE 指向 zcode.cjs）",
    );
  }
  const auth = deps.detectAuth ? deps.detectAuth() : detectHeadlessAuth();
  if (!auth.ok) {
    throw new LoopError(
      "headless 凭据缺席（无 ~/.zcode/v2/credentials.json 且无 ZCODE_*_PROVIDER_CONFIG_FILE env）——" +
        "恢复：桌面端 login 一次，或设置 provider 配置 env 后重试",
    );
  }

  let lease = null;
  let budget = null;
  let resumeSession = null;
  let noProgressStreak = 0;
  let spentMsLocal = 0;
  let outcome = null; // {ok, cause, handoff}

  const windDown = (ok, cause, riskNote, { skipHandoff = false } = {}) => {
    if (skipHandoff) {
      // ADJ-25：租约失效/被接管的收束——不写交接（写会被 fencing 守卫拒，且接管者自负
      // 责）；只打印接管指示，非零退出。
      outcome = { ok, cause, handoff: null };
      console.log(`[drive] 收束：${cause}——已被接管/租约失效，不写交接（接管者负责续跑）`);
      return;
    }
    const fresh = readGoal(cwd);
    if (fresh && fresh.status === "executing") {
      const { snap, treeHash } = authorHandoffSnapshot(cwd, fresh, cause, riskNote, deps);
      handoffGoal(cwd, snap, treeHash);
      outcome = { ok, cause, handoff: snap };
      console.log(`[drive] 收束：${cause}——handoff 快照：${snap}（复归：zw 继续）`);
    } else {
      outcome = { ok, cause, handoff: null };
      console.log(`[drive] 收束：${cause}（目标已非 executing，无需交接快照）`);
    }
  };

  try {
    // lease + 每-run 预算重开（同一 withLock 临界区；runtime 写须持锁）。
    // ADJ-26：取租→释放整段进 try/finally（原 loadRuntime 在 try 外，抛错即租约泄漏窗口）。
    lease = withLock(cwd, () => {
      const l = acquireLease(cwd, { ttlMs: LEASE_TTL_MS, slug: goal.slug }); // ADJ-12：租约绑目标
      process.env.LZY_RUNTIME_FENCE = String(l.fence); // 本进程写面申报（handoff 经 guardFence）
      try {
        if (loadRuntime(cwd)?.budget) {
          initBudget(cwd, { restart: true, fence: l.fence });
        } else {
          initBudget(cwd);
        }
      } catch (err) {
        releaseLease(cwd, l.fence); // 已在本临界区内，直接释放（嵌套 withLock 会自撞锁）
        delete process.env.LZY_RUNTIME_FENCE;
        throw err;
      }
      return l;
    });
    budget = loadRuntime(cwd).budget;
    const effectiveWallMs = wallMs != null ? Math.min(budget.wallClockBudgetMs, wallMs) : budget.wallClockBudgetMs;

    console.log(
      `[drive] 启动：${goal.slug} · 段上限 ${maxSegments} · 有效墙钟 ${effectiveWallMs}ms · mode=${mode} · fence=${lease.fence}`,
    );

    const cliPath = resolve(process.argv[1] ?? "lzy");
    let lastDoneCount = doneCountOf(goal);

    for (let seg = 1; seg <= maxSegments; seg++) {
      // 段首段间三门（ADJ-20：risk 门原只查入口一次，7 处文档/prompt 承诺段间复核）；
      // 心跳失败=租约失效/被接管——ADJ-25：必须走收束通道（原实现异常穿出 runDrive：
      // 无快照、无 marker、租约残留、段账不入账）。
      try {
        const freshGoal = readGoal(cwd);
        if (freshGoal) assertDriveEligible(freshGoal);
        withLock(cwd, () => heartbeatLease(cwd, lease.fence, { ttlMs: LEASE_TTL_MS }));
      } catch (err) {
        windDown(false, `段间门拒（${(err?.message ?? err).slice(0, 200)}）`, undefined, { skipHandoff: true });
        break;
      }
      const remainingWall = effectiveWallMs - spentMsLocal;
      if (remainingWall <= 0) {
        windDown(true, "墙钟预算尽");
        break;
      }
      const segTimeout = Math.min(remainingWall, DRIVE_SEGMENT_TIMEOUT_MS);
      const result = await spawnHeadless({
        prompt: composeSegmentPrompt(cwd, cliPath),
        resume: resumeSession,
        mode,
        timeoutMs: segTimeout,
        cwd,
        extraEnv: { LZY_RUNTIME_FENCE: String(lease.fence) },
        enginePath: deps.enginePath ?? null,
        deps: deps.run ? { run: deps.run } : null,
      });
      resumeSession = result.sessionId ?? resumeSession;
      console.log(
        `[drive] 段 ${seg}/${maxSegments} sessionId=${result.sessionId ?? "—"} 耗时=${result.durationMs ?? "—"}ms 退出=${result.exitCode ?? "—"}`,
      );
      if (!result.ok) {
        windDown(
          false,
          `段失败（exit=${result.exitCode ?? "—"}${result.timedOut ? " · 墙钟 SIGKILL" : ""}）`,
          `第 ${seg} 段 headless 调用失败：${(result.error ?? "未知").slice(0, 300)}`,
        );
        break;
      }
      // 段账：超顶拒（墙钟/积分整笔拒）是常态路径（末段毫秒级越顶），路由到干净收束。
      spentMsLocal += result.durationMs ?? 0;
      try {
        withLock(cwd, () => recordSpend(cwd, { ms: result.durationMs ?? 0, points: 0 }));
      } catch (err) {
        if (err?.code === "BUDGET_OVER") { // ADJ-26：错误码路由，不靠文案匹配
          windDown(true, `预算尽（${String(err.message).split("：")[0]}）`);
          break;
        }
        throw err;
      }
      // 终态判定 + 段间身份/进度检测（ADJ-24：原实现只看 done 与计数变化——目标被
      // abandon/reset 后仍继续 spawn，且 done 计数下降（换代）被当作「有推进」）。
      const fresh = readGoal(cwd);
      if (fresh && fresh.status === "done" && fresh.slug === goal.slug) {
        outcome = { ok: true, cause: "done", handoff: null };
        console.log(`[drive] ✔ goal done（${fresh.slug}）——终验 attestation：.lazyzcode/attestations/`);
        break;
      }
      if (!fresh || fresh.slug !== goal.slug || fresh.status !== "executing") {
        windDown(false, `目标已非本 drive 的 executing 目标（slug/状态换代：${fresh ? `${fresh.slug}/${fresh.status}` : "状态不可读"}）`);
        break;
      }
      const dc = doneCountOf(fresh);
      if (dc > lastDoneCount) {
        noProgressStreak = 0;
        lastDoneCount = dc;
      } else {
        noProgressStreak += 1;
      }
      if (noProgressStreak >= STUCK_STREAK_LIMIT) {
        windDown(true, `无推进（stuck，连续 ${STUCK_STREAK_LIMIT} 段零步进）`);
        break;
      }
      // 水位联动执法（积分侧；billing DB 滞后=已知边界，null=跳过并注记）。
      // 哨兵判据=!== undefined（显式注入 null=「读数缺席」测试形态，与未注入区分）。
      const rp = deps.rollingPoints !== undefined ? deps.rollingPoints : rollingWaterlinePoints();
      if (rp != null && rp >= budget.pointsBudget) {
        windDown(true, `积分预算尽（近 5h 滚动水位 ${rp} ≥ 积分硬顶 ${budget.pointsBudget}）`);
        break;
      } else if (rp == null) {
        console.log("[drive] 水位读数不可读（fail-soft）——本段跳过积分联动执法");
      }
      if (seg === maxSegments) {
        windDown(true, `段数尽（${maxSegments} 段）`);
      }
    }
  } finally {
    if (lease) {
      try {
        withLock(cwd, () => releaseLease(cwd, lease.fence));
      } catch {
        // 已被接管时释放被拒（fencing 语义）——静默容忍，收束语义已完成。
      }
    }
    delete process.env.LZY_RUNTIME_FENCE;
  }

  if (!outcome) {
    // ADJ-36：循环无显式收束因退出=内部错误——原兜底判 ok:true（fail-open，破坏
    // 「退出码 0 ⟺ 枚举因」闭式契约）；改为非零退出并尽力交接。
    windDown(false, "内部错误：循环无显式收束因退出");
    if (!outcome) outcome = { ok: false, cause: "内部错误：循环无显式收束因退出", handoff: null };
  }
  return outcome;
}
