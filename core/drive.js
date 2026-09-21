// drive 编排器（0.2.0 棒2，ADR-0020/§⑮ Q3）：`lzy loop drive` 的实现——单唤起内循环
// spawn headless 会话推进一个 executing 目标，段间查 budget/lease/risk 三门，收束=
// 步完成/预算尽/门拒/需人工等，除 done 外各因都自写 7 字段 handoff 快照干净交回；
// 0.2.2 棒2 增 `h3r` 因（高危步停摆，原型默认休眠，ADR-0022）。
// 门序：executing 态 → risk（assertDriveEligible）→ 引擎 → 凭据 → lease（他租拒）→
// 预算（缺席 init / 在场 restart 重开每-run 预算——§⑮ Q4）。
// 段内 fence 注入（ADR-0020「drive 派生工人一律注入 fence」接线点）：段会话 env 带
// LZY_RUNTIME_FENCE，段内一切 lzy 写经 guardFence fail-closed；本进程同 env 申报自身
// handoff 写。
// 双硬顶口径（ADJ-21，0.2.1 五轮双审·成立——口径歧义此前无处写明）：**墙钟=每-run 记账**
//（spentMs 逐段累计，超顶拒=收束信号）；**积分=账号 5h 滚动水位阈值**（判据
// rollingWaterlinePoints ≥ pointsBudget，读数缺席即不执法）——不是本 run 的消费累计：
// 积分侧活体归因不可行（cost.js 按小时桶读 billing DB），故每段入账 points 恒 0。
// 缺省 400 相对水位 1600 取四分之一（相对账号水位、非相对本 run 消耗）。
// 退出码契约：0=done 或干净收束（run 契约正常完成）；1=门拒/段 infra 失败（尽力收束带
// 快照后非零）。deps 可注入（run/rollingPoints/now/git）供离线契约测试（headless.js 先例）。
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { progressSignature, signatureKey } from "./progress.js";
import {
  LoopError,
  assertDriveEligible,
  handoffDir,
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
import { h3rStopVerdict } from "./h3r.js";

export const DRIVE_MAX_SEGMENTS_DEFAULT = 6;
export const DRIVE_MODE_DEFAULT = "yolo";
// 段超时上限（单段墙钟）；spawnHeadless 显式 mode 立场不变——drive 缺省 yolo（无人值守
// 段必须免审批，build/edit 会在 PermissionRequest 上无人可批地停摆）。
export const DRIVE_SEGMENT_TIMEOUT_MS = HEADLESS_DEFAULT_TIMEOUT_MS;
// lease TTL：max(缺省 15min, 2×段超时)——段间心跳制下给单段留足缓冲（已知未知②）。
const LEASE_TTL_MS = Math.max(15 * 60_000, 2 * DRIVE_SEGMENT_TIMEOUT_MS);
const STUCK_STREAK_LIMIT = 2; // 镜像 Stop 振数纪律：连续两段零推进→stuck 收束
// 推进判据=进度信号状态集（0.2.2 棒1#N3，ADR-0020 之后；ADJ-34 的修法）：
// done 步数 ∪ subject 头树集（提交）∪ 证据账本绿节点数 ∪ handoff/salvage 登记数，
// 任一前进即清零振数；不含脏树（只写不提交不算推进）。实现见 core/progress.js。
// 背景（ADJ-34，2026-09-21 五轮双审·部分成立）：旧判据只认 done 步数跳变，于是
// 「重活/长步」——有提交、有证据入账、步未翻 done——被判零推进，连续两段即走
// `windDown(true, …)` **干净收束**；而 H3R 判据③要测的「干净挂起 + handoff」走的是
// **同一个输出通道**，故 0.2.2 先修仪器再跑实验（棒1 先于棒2 的全部理由）。

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
  const dir = handoffDir(cwd);
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snap = join(dir, `${goal?.slug ?? "goal"}-${stamp}.md`);
  writeFileSync(snap, content, { mode: 0o600 });
  return { snap, treeHash };
}

// 段会话 env（N2/N3）：fence 恒注入（派生工人申报制，ADR-0020）。身份段标**仅唤醒态**
// 注入（`LZY_ABLATE_H3R_ONESTEP === "1"`，反向语义同 H3R_GATE）——默认态逐字段同 0.2.2。
// 段标带 fence 前缀 `<fence>:seg-<n>` ⇒ 跨 run 唯一（纯 `seg-<n>` 会被上一 run 残留的
// `segment.json` 误伤，恰在最需要的无人值守续跑链上）。`LZY_LOOP_DIR` 供钩子定位标记落点。
function buildSegmentEnv(fence, seg, cwd) {
  const env = { LZY_RUNTIME_FENCE: String(fence) };
  if (process.env.LZY_ABLATE_H3R_ONESTEP === "1") {
    env.LZY_SEGMENT_ID = `${fence}:seg-${seg}`;
    env.LZY_LOOP_DIR = join(cwd, ".lazyzcode", "loop");
  }
  return env;
}

// 命中标记（N4）读取与消费：相符=消费并回摘要；不符/损坏=删除并回 null（他 run 残留与
// 伪造标记都不得改收束因）。调用方须已持锁（与段账同址）。
function takeH3rHit(cwd, segmentId) {
  const file = join(loopDir(cwd), "h3r-hit.json");
  let raw = null;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== "object") {
    rmSync(file, { force: true }); // 坏/缺席：静默清（force 对不存在路径无害）
    return null;
  }
  rmSync(file, { force: true });
  if (raw.segmentId !== segmentId) return null;
  return {
    matched: Array.isArray(raw.matched) && raw.matched.length > 0 ? raw.matched : ["(未记)"],
    command: typeof raw.command === "string" ? raw.command : "(未记)",
  };
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
      // 责）；只打印接管指示，非零退出。**唯一调用点=段界心跳失败**：风险门拒走正常收束
      // 通道（0.2.2 报告 §7 修——两类事不同轴，只有前者写盘会被 fencing 拒）。
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
    // ADJ-22（0.2.1 五轮双审·部分成立）：段败的可操作报文（headless.js 失败族恢复式文案）
    // 原只落快照的「风险与坑」——无人值守链上没人去读工作区里的快照文件，stdout 只剩
    //「段失败（exit=1）」。riskNote 在场即连带打印一行（同款 300 字符截断；快照路径照打）。
    if (riskNote) console.log(`[drive] 原因：${String(riskNote).slice(0, 300)}`);
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
    // 段间持有上一段签名：既是「有无推进」的比较基，也是信号源瞬时故障时的沿用值
    // （never-throw 契约的 prev——见 core/progress.js）。
    let prevProgress = progressSignature(cwd, goal, null);

    for (let seg = 1; seg <= maxSegments; seg++) {
      // 段首段间三门（ADJ-20：risk 门原只查入口一次，7 处文档/prompt 承诺段间复核）。
      // 两轴分开收束（0.2.2 报告 §7 / goal v023-followup#N2）：risk 门拒与租约失效不是
      // 同一件事——前者本 drive 仍持租，写交接合法且是 ADR-0022 停摆契约要求的形态；
      // 后者写盘会被 fencing 拒，只能不写。收束因串保持「段间门拒（<轴原文>）」不变
      // （消融仪器的分类判据读它，scripts/ablation/extract-metrics.mjs）。
      try {
        const freshGoal = readGoal(cwd);
        if (freshGoal) assertDriveEligible(freshGoal);
      } catch (err) {
        windDown(
          false,
          `段间门拒（${(err?.message ?? err).slice(0, 200)}）`,
          "本目标因风险升级需人工确认：请在交互会话确认后按计划推进（交互会话天然免门，是恢复路径，ADR-0020/0022）",
        );
        break;
      }
      // 心跳失败=租约失效/被接管——ADJ-25：必须走收束通道（原实现异常穿出 runDrive：
      // 无快照、无 marker、租约残留、段账不入账），且这条轴只能走 skipHandoff。
      try {
        withLock(cwd, () => heartbeatLease(cwd, lease.fence, { ttlMs: LEASE_TTL_MS }));
      } catch (err) {
        windDown(false, `段间门拒（${(err?.message ?? err).slice(0, 200)}）`, undefined, { skipHandoff: true });
        break;
      }
      // H3R 高危步门（0.2.2 棒2 原型，ADR-0022）：唤醒态下下一步命中词表/升格标记即停摆。
      // 位置考究——**紧跟三门之后、墙钟判之前**：此时「下一步是谁」已可判，且**不 spawn 段**
      // （零引擎调用、零 token）。收束走 ok:true ⇒ 退出码 0 的干净通道（与 stuck/预算尽同族），
      // 快照经 windDown 自写 7 字段，恢复路径写进「风险与坑」。默认休眠时整块不执行，
      // 行为与 0.2.1 逐字段同（契约测试钉两半）。
      const h3r = h3rStopVerdict(readGoal(cwd));
      if (h3r) {
        windDown(
          true,
          `高危步停摆（H3R）：${h3r.step.id} 命中 ${h3r.matches.join("、")}`,
          `下一步 ${h3r.step.id}「${h3r.step.title}」命中高危面（${h3r.matches.join("、")}）。` +
            `本门只作用于无人值守 drive 段循环（ADR-0022）——请在人工交互会话确认后按计划推进` +
            `（交互会话天然免门，是恢复路径）；未执行任何步骤，无脏改动需善后`,
        );
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
        extraEnv: buildSegmentEnv(lease.fence, seg, cwd),
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
      // H3R 命令层命中标记（N4）：钩子在段内拦下高危命令时写 `loop/h3r-hit.json`（带段标）。
      // **读+消费只在这里发生一次、且必定清除**（在 done/换代判之前）——他段残留与伪造标记
      // 不留残骸；但**判定顺序**在 done 与身份换代之后（目标已完成或已换代时无须人工介入）。
      // 读写在 withLock 内（与段账同址，避免与并发钩子写竞态）。休眠态不读，默认行为逐字段同。
      const h3rHit =
        process.env.LZY_ABLATE_H3R_PRETOOL === "1" ? withLock(cwd, () => takeH3rHit(cwd, `${lease.fence}:seg-${seg}`)) : null;
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
      // segmentId 相符=本段命中 ⇒ 干净收束（ok:true，与 stuck/预算尽同族：exit 0 + 7 字段
      // 快照）；不符（他 run 残留 / 伪造）在上面已被清且 h3rHit 为 null——它不是「一行即停」
      // 的匿名杠杆。
      if (h3rHit) {
        windDown(
          true,
          `工具调用被拒（PreToolUse 高危命令）：命中 ${h3rHit.matched.join("、")} · 命令 ${String(h3rHit.command).slice(0, 80)}`,
          "本段已拦下高危命令（未执行）：请在交互会话读快照确认后按计划推进（交互会话天然免门，是恢复路径，ADR-0022）",
        );
        break;
      }
      // 状态集判据：签名不变才算零推进（提交/证据入账/交接登记任一前进即清零振数）
      const cur = progressSignature(cwd, fresh, prevProgress);
      if (signatureKey(cur) === signatureKey(prevProgress)) {
        noProgressStreak += 1;
      } else {
        noProgressStreak = 0;
      }
      prevProgress = cur;
      if (noProgressStreak >= STUCK_STREAK_LIMIT) {
        windDown(true, `无推进（stuck，连续 ${STUCK_STREAK_LIMIT} 段零推进）`);
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
