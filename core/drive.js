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
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
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
// workers 波编排（v024-fast-scheduler#N1；保留 fast 拍板 2026-09-23）：
// N≥2 走 runDriveWorkers 独立编排路径（兄弟 worktree + 认领制波分派 + 波终组装重锚），
// N=1/缺省=本文件既有行为逐字段同（冻结契约，F1② 钉）。屏障重锚、一波=一段、
// 墙钟取本波 max（并发不 sum）等口径见 runDriveWorkers 内注记与
// docs/reviews/2026-fast-exp-report.md（实验底座）。
export const DRIVE_WORKERS_ROOT_DIRNAME = "-fast"; // 兄弟根后缀：<dirname(host)>/<basename(host)>-fast/
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

// 命中标记（N4）读取与消费：**rename 原子序**（ADJ-03，v023 双审）——先 rename 到消费
// 中间名再读清：钩子晚于消费点的写落在新文件（带它自己的段标），下段消费时因段标不符
// 被清，不再与 drive 的 rm 互相硬删；「段尾微秒竞窗」收窄为「消费点后的晚到写」（宽度
// ≤段间隙，fail-open 方向：丢的只是收束因分类，PreToolUse deny 本体已发生）。消费中间
// 名走既有 `h3r-hit.json.` tmp 家族（孤儿可见可清，观测/清扫两面同表）。相符=回摘要；
// 不符/损坏/目录形态/缺席=null。伪造面（ADJ-18）：段标相符的伪造标记**可以**改写收束
// 因分类——防伪边界=记账不裁决（ADR-0022），此处只保证「他 run 残留与无段标伪造不可消费」。
function takeH3rHit(cwd, segmentId) {
  const file = join(loopDir(cwd), "h3r-hit.json");
  const consumed = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    renameSync(file, consumed);
  } catch {
    return null; // 缺席=无标记（ENOENT 为主）
  }
  let raw = null;
  try {
    raw = JSON.parse(readFileSync(consumed, "utf8"));
  } catch {
    raw = null; // 损坏/目录形态（EISDIR）：静默当空（ADJ-02①的源级根治）
  }
  rmSync(consumed, { force: true, recursive: true });
  if (!raw || typeof raw !== "object") return null;
  if (raw.segmentId !== segmentId) return null;
  return {
    matched: Array.isArray(raw.matched) && raw.matched.length > 0 ? raw.matched : ["(未记)"],
    command: typeof raw.command === "string" ? raw.command : "(未记)",
  };
}

// 段界门拒的恢复指引分流（ADJ-32，v023 双审）：「确认后按计划推进」只对 HIGH 成立——
// RESTRICTED 的唯一出口=人工收窄范围+reset 重注册（risk 只升不降，无降档命令）；
// goal 不可读=状态修复/恢复出口 reset（doResetLoop 对损坏态容错）。误导性处方会把
// 无人值守收束后的接管者引去死路。
function riskGuidance(err) {
  const msg = String(err?.message ?? err);
  if (err?.code === "RISK_RESTRICTED" || msg.startsWith("RESTRICTED")) {
    return "RESTRICTED 硬禁无降档出口：请在人工会话收窄计划范围后 lzy loop reset 并重注册（风险轴随新目标重评，ADR-0020）";
  }
  if (err?.code === "RISK_HIGH" || msg.startsWith("HIGH")) {
    return "本目标因风险升级需人工确认：请在交互会话确认后按计划推进（交互会话天然免门，是恢复路径，ADR-0020/0022）";
  }
  return "目标状态不可读（损坏）——恢复：lzy doctor 诊断；先备份再 lzy loop reset 清除后重新注册（损坏态可被 reset 容错清除）";
}

export async function runDrive(cwd, opts = {}, deps = {}) {
  // workers 模式入口（v024-fast-scheduler#N1）：N≥2 走独立编排路径；N=1/缺省=现行行为
  // 逐字段同（主路径零触碰）；≤0/非整数=用法错误即拒（ADJ-26 前置校验家法）。
  // --fast 糖在入口直读（CLI 与 runDrive 直调两面同语义：fast≡workers 2）。
  const workersOpt = opts.workers != null ? opts.workers : opts.fast === true ? 2 : null;
  if (workersOpt != null) {
    const w = Number(workersOpt);
    if (!Number.isInteger(w) || w <= 0) {
      throw new LoopError(`--workers 非法：${JSON.stringify(workersOpt)}——须为正整数（N=1 等价缺省单工人；N≥2 进入 workers 波编排）`);
    }
    if (w > 1) return runDriveWorkers(cwd, opts, deps, w);
  }
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
      // 责）；只打印接管指示，非零退出。**唯一调用点=段界心跳失败（LEASE_TAKEN 族）**：
      // 风险门拒走正常收束通道（0.2.2 报告 §7 修——两类事不同轴，只有前者写盘会被
      // fencing 拒）。
      outcome = { ok, cause, handoff: null };
      console.log(`[drive] 收束：${cause}——已被接管/租约失效，不写交接（接管者负责续跑）`);
      return;
    }
    // ADJ-02（v023 双审）：收束通道自身不可抛——readGoal 护栏（goal 损坏=无快照可写，
    // 如实降级并注记）+ 快照写护栏（fencing 拒/盘面失败=降级为无快照 outcome）。此前
    // windDown 内部的二次抛穿会让异常穿出 runDrive：无快照、无 outcome、租约只剩
    // finally 释放——「除 done 外各因自写快照」不变量（core/progress.js）被击穿。
    let fresh = null;
    try {
      fresh = readGoal(cwd);
    } catch (err) {
      fresh = null;
      console.log(
        `[drive] 收束：${cause}——goal 状态不可读（${String(err?.message ?? err).slice(0, 160)}），无快照可写`,
      );
    }
    if (fresh && fresh.status === "executing") {
      try {
        const { snap, treeHash } = authorHandoffSnapshot(cwd, fresh, cause, riskNote, deps);
        handoffGoal(cwd, snap, treeHash);
        outcome = { ok, cause, handoff: snap };
        console.log(`[drive] 收束：${cause}——handoff 快照：${snap}（复归：zw 继续）`);
      } catch (err) {
        outcome = { ok, cause, handoff: null };
        console.log(
          `[drive] 收束：${cause}——交接快照写失败（${String(err?.message ?? err).slice(0, 160)}），无快照可留`,
        );
      }
    } else if (fresh) {
      outcome = { ok, cause, handoff: null };
      console.log(`[drive] 收束：${cause}（目标已非 executing，无需交接快照）`);
    } else {
      outcome = { ok, cause, handoff: null }; // readGoal 护栏已打印原因
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
        windDown(false, `段间门拒（${(err?.message ?? err).slice(0, 200)}）`, riskGuidance(err));
        break;
      }
      // 心跳失败两族分派（ADJ-19，v023 双审）：接管族（runtime.js 打 LEASE_TAKEN 码，
      // fencing 语义）=不写交接（写会被 fencing 拒，接管者自负责）；其余（存储 I/O 族
      // RUNTIME_IO、账本损坏、未知）=本 drive 大概率仍持租——走带快照的干净收束并给
      // 租约回收指引。此前一概按「已被接管」收束：定语违反事实+无快照+租约滞留 TTL
      // 无人知（deps.heartbeatLease 注入=契约测试 seam，headless.js deps.run 先例）。
      try {
        withLock(cwd, () =>
          (deps.heartbeatLease ?? heartbeatLease)(cwd, lease.fence, { ttlMs: LEASE_TTL_MS }),
        );
      } catch (err) {
        if (err?.code === "LEASE_TAKEN") {
          windDown(false, `段间门拒（${(err?.message ?? err).slice(0, 200)}）`, undefined, { skipHandoff: true });
        } else {
          windDown(
            false,
            `段间心跳失败（${String(err?.message ?? err).slice(0, 160)}）`,
            "非接管的运行时失败（存储 I/O 族或账本不可读）——租约可能滞留至 TTL：恢复=lzy loop lease reclaim --force（或等待过期）；排查盘面（盘满/只读/权限）后重试",
          );
        }
        break;
      }
      // H3R 高危步门（0.2.2 棒2 原型，ADR-0022）：唤醒态下下一步命中词表/升格标记即停摆。
      // 位置考究——**紧跟三门之后、墙钟判之前**：此时「下一步是谁」已可判，且**不 spawn 段**
      // （零引擎调用、零 token）。收束走 ok:true ⇒ 退出码 0 的干净通道（与 stuck/预算尽同族），
      // 快照经 windDown 自写 7 字段，恢复路径写进「风险与坑」。默认休眠时整块不执行，
      // 行为与 0.2.1 逐字段同（契约测试钉两半）。
      // ADJ-02②（v023 双审）：唤醒态词表不可判（损坏/缺席）曾是裸逃逸面——收口为 ok:true
      // 干净收束（未 spawn、未执行任何步骤），恢复指引指向词表修复或退回休眠。
      let h3r = null;
      try {
        h3r = h3rStopVerdict(readGoal(cwd));
      } catch (err) {
        windDown(
          true,
          `高危步停摆（H3R 门不可判）：${String(err?.message ?? err).slice(0, 200)}`,
          "词表不可判（损坏/缺席）——恢复：重跑 lzy sync 修复载荷词表，或 unset LZY_ABLATE_H3R_GATE 退回休眠；本段未 spawn、未执行任何步骤",
        );
        break;
      }
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
      // **读+消费只在这里发生一次、且必定清除**（在 done/换代判之前）；判定顺序在 done 与
      // 身份换代之后（目标已完成或已换代时无须人工介入）。休眠态不读，默认行为逐字段同。
      // ADJ-03（v023 双审）：消费=rename 原子序——与钩子写的真防线是「rename 原子+段标
      // 校验」，withLock 只对齐 lzy 侧写者（钩子写不持此锁，旧注释「避免与并发钩子写竞态」
      // 夸大锁面，订正）。ADJ-18：段标相符的伪造标记可以改写收束因分类（防伪边界=记账
      // 不裁决，ADR-0022）；此处只保证他 run 残留/无段标伪造不可消费。
      // ADJ-02①兜底（v023 双审）：消费面残余可抛（盘面异常）收口为带快照收束，不再穿出。
      let h3rHit = null;
      if (process.env.LZY_ABLATE_H3R_PRETOOL === "1") {
        try {
          h3rHit = withLock(cwd, () => takeH3rHit(cwd, `${lease.fence}:seg-${seg}`));
        } catch (err) {
          windDown(
            false,
            `段间内部错误（h3r-hit 消费）：${String(err?.message ?? err).slice(0, 160)}`,
            "标记消费失败（盘面异常）——排查 .lazyzcode/loop/ 权限后重试；本段已完成，无半途状态需善后",
          );
          break;
        }
      }
      // 终态判定 + 段间身份/进度检测（ADJ-24：原实现只看 done 与计数变化——目标被
      // abandon/reset 后仍继续 spawn，且 done 计数下降（换代）被当作「有推进」）。
      // ADJ-02③（v023 双审）：此处 readGoal 曾裸奔——段内 goal.json 损坏（或被并发破坏）
      // 会让异常穿出 runDrive；收口到与段界门拒同通道（windDown 的 readGoal 护栏负责
      // 「无快照可写」降级）。
      let fresh = null;
      try {
        fresh = readGoal(cwd);
      } catch (err) {
        windDown(false, `段间门拒（${String(err?.message ?? err).slice(0, 200)}）`, riskGuidance(err));
        break;
      }
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
          `工具调用被拒（PreToolUse 高危命令）：命中 ${h3rHit.matched.join("、")} · 命令 ${String(h3rHit.command).replace(/\s+/g, " ").slice(0, 80)}`,
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
      } catch (err) {
        // 已被接管时释放被拒（fencing 语义）属预期；存储失败则与心跳 I/O 族同源——
        // ADJ-19：租约滞留 TTL 无人知是本条发现的一半，不再全量静默，留一行可 grep 痕迹。
        console.log(
          `[drive] lease 释放未成（${String(err?.message ?? err).slice(0, 120)}）——接管场景属预期；否则回收：lzy loop lease reclaim`,
        );
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

// ══ workers 波编排（v024-fast-scheduler#N1/#N2；底座=v024-fast-exp 实验棒）════════
// N≥2：每波把可认领 pending 步均分给 N 个工人链（各自兄弟 worktree+独立 HOME+独立
// sessionId），波终 merge 回宿主+对全部已取证 F 项屏障重锚（复合指纹随 subject 集变化
// 全体过期——首波即全锚）。一波=一段（maxSegments 计波）；墙钟累计=本波 max（并发不
// sum）；预算/租约/风险门与单工人完全同源。收束因扩充 merge-conflict。N=1 永不进此径。

const WORKER_CLAIM_TTL_MS = 48 * 60 * 60 * 1000; // 镜像 core/loop.js 步级认领 48h

function claimFresh(step, now = Date.now()) {
  const at = step?.claim?.at ? Date.parse(step.claim.at) : NaN;
  return Number.isFinite(at) && now - at < WORKER_CLAIM_TTL_MS;
}

function blockedByLocal(step, goal) {
  const deps = Array.isArray(step.deps) ? step.deps : [];
  if (deps.length === 0) return [];
  const byId = new Map(goal.steps.map((s) => [s.id, s]));
  return deps.filter((d) => byId.get(d)?.status !== "done");
}

function waveSplit(goal, n) {
  // 可认领集（未 done/认领未新鲜/依赖已满足）轮转均分，余数给首工人。deps 阻塞的步
  // 不入本波分派（claim 门兜底双保险）。
  const pool = (goal.steps ?? []).filter(
    (s) => s.status !== "done" && !claimFresh(s) && blockedByLocal(s, goal).length === 0,
  );
  const groups = Array.from({ length: n }, () => []);
  pool.forEach((s, i) => groups[i % n].push(s.id));
  return groups;
}

function envAuthOk() {
  // 有意对齐 detectHeadlessAuth 的 env 半（core/headless.js either-or）：任一 provider
  // env 指向非空实文件即可（同带 workers 单 provider 足够；凭据文件不复制——见详单 §N2）。
  for (const key of ["ZCODE_BUILTIN_PROVIDER_CONFIG_FILE", "ZCODE_PERSONAL_PROVIDER_CONFIG_FILE"]) {
    const v = process.env[key];
    if (v && v.length > 0) {
      try {
        return statSync(v).isFile();
      } catch {
        /* 落下一个候选继续判 */
      }
    }
  }
  return false;
}

function h3rWakeConflict() {
  // workers 多链与 H3R 唤醒态的单链假设不兼容（段标/词表门按单链设计，ADR-0022）——
  // 唤醒态任一开关在场即拒入 workers（休眠默认态零影响）。
  for (const key of ["LZY_ABLATE_H3R_GATE", "LZY_ABLATE_H3R_ONESTEP", "LZY_ABLATE_H3R_PRETOOL"]) {
    if (process.env[key] === "1") return key;
  }
  return null;
}

function gitRun(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8", shell: false, timeout: 60_000 });
}

function lzySpawn(cwd, cliPath, args, fence) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    shell: false,
    timeout: 180_000,
    env: { ...process.env, LZY_RUNTIME_FENCE: String(fence) },
  });
}

function composeWorkerPrompt({ hostRoot, cliPath, worktree, branch, idx, total, stepIds }) {
  return [
    "zw 继续",
    "",
    `（无人值守 drive 工人段，workers=${total} 模式）你是工人 w${idx}（共 ${total}），在兄弟 worktree 工作：`,
    `  worktree=${worktree}（分支 ${branch}，你的一切文件改动只落在这里并在此 git 提交）`,
    `  目标槽在宿主根 ${hostRoot}（.lazyzcode/ 已就绪，目标 executing）。`,
    "一切循环命令：先 `cd " + hostRoot + "`，再 `node " + cliPath + " <args>`（同版载荷；勿用全局 lzy）。",
    "任务：",
    `1. node ${cliPath} loop status 核对状态。`,
    `2. 只做你被分派的步：${stepIds.join("、")}。动手前先 cd 宿主根 && node ${cliPath} loop claim <ID> 认领；被拒（已被认领/依赖阻塞）就先做你清单里其他步，稍后再试。`,
    "3. 每步：在当前 worktree 完成并 git add+commit，然后 cd 宿主根 && node <CLI> step done <ID> --note …。",
    `4. 你的分派步全部 done 后：若某 F 项的断言面在你的 worktree 内可核（如本波产出物），cd 宿主根 && node <CLI> step done <FID> --evidence "worker-w${idx} re-verify: <断言实际输出摘要>" 取证（同 id 重取证=合法 rebind）；核不了的 F 项跳过——波终由 drive 屏障重锚。`,
    "红线：绝不注册新目标；绝不运行 lzy loop drive；绝不 reset/abandon；绝不改动宿主根的已跟踪文件；写命令已带 fence 环境（勿摘）；全程工具真实执行，不要问询；做完即收工退出。",
  ].join("\n");
}

async function runDriveWorkers(cwd, opts, deps, workers) {
  const maxSegments = Number.isInteger(opts.maxSegments) && opts.maxSegments > 0
    ? opts.maxSegments
    : DRIVE_MAX_SEGMENTS_DEFAULT;
  const mode = opts.mode ?? DRIVE_MODE_DEFAULT;
  const wallMs = Number.isFinite(opts.wallMs) && opts.wallMs > 0 ? opts.wallMs : null;
  if (!HEADLESS_MODES.has(mode)) {
    throw new LoopError(`--mode 非法：${JSON.stringify(mode)}——合法 ${[...HEADLESS_MODES].join("|")}`);
  }
  // ── workers 入口前提（详单 §N1：fail-closed，先于取租/建预算——ADJ-26 家法）。
  const wakeKey = h3rWakeConflict();
  if (wakeKey) {
    throw new LoopError(
      `workers 模式与 H3R 唤醒态互斥（${wakeKey}=1，ADR-0022 单链假设）：unset ${wakeKey} 后重试，或在休眠态使用 workers`,
    );
  }
  if (!envAuthOk()) {
    throw new LoopError(
      "workers 模式要求 env-auth（ZCODE_*_PROVIDER_CONFIG_FILE 任一指向实文件）——凭据文件不复制到工人 HOME；恢复：桌面会话内跑 drive，或导出 provider 配置 env 后重试",
    );
  }

  const goal = readGoal(cwd);
  if (!goal) throw new LoopError(noGoalMessage(cwd));
  if (goal.status !== "executing") {
    throw new LoopError(`drive 只推进 executing 目标（现状 ${goal.status}）——无人值守边界不变`);
  }
  assertDriveEligible(goal);
  if (!deps.enginePath && !findEngine()) {
    throw new LoopError("引擎未找到——drive 段需 ZCode 桌面端引擎（装桌面端或设 LZY_ZCODE_ENGINE）");
  }

  const hostRoot = resolve(cwd);
  const wtRoot = join(dirname(hostRoot), basename(hostRoot) + DRIVE_WORKERS_ROOT_DIRNAME);
  const runId = `fast-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
  const runDir = join(wtRoot, runId);
  // CLI 路径可注入（deps.cliPath——契约测试 seam，deps.run 家法）：生产=本进程 CLI
  //（argv[1]）；node --test 下 argv[1] 是测试文件自身，直接用会把测试当 CLI spawn。
  const cliPath = deps.cliPath ?? resolve(process.argv[1] ?? "lzy");

  // 启动回收：runId↔lease 关联（详单 §N2）——取租成功后，兄弟根下不属于本 runId 的
  // 目录=无活跃租约的残留 → 整体删除+worktree prune；**只删已合并分支**（未合并残留
  // 分支=salvage 族资产 ADR-0009，保留并在回收日志列清单）。
  const reclaim = () => {
    if (!existsSync(wtRoot)) return;
    for (const name of readdirSync(wtRoot)) {
      if (name === runId) continue;
      const stale = join(wtRoot, name);
      rmSync(stale, { recursive: true, force: true });
      gitRun(cwd, ["worktree", "prune"]);
      const merged = gitRun(cwd, ["branch", "--merged", "HEAD", "--format", "%(refname:short)"]);
      for (const b of (merged.stdout ?? "").split("\n").map((x) => x.trim()).filter(Boolean)) {
        if (b.startsWith("fast-")) gitRun(cwd, ["branch", "-d", b]);
      }
      const unmerged = gitRun(cwd, ["branch", "--no-merged", "HEAD", "--format", "%(refname:short)"]);
      const left = (unmerged.stdout ?? "").split("\n").map((x) => x.trim()).filter((b) => b.startsWith("fast-"));
      if (left.length > 0) console.log(`[drive] 回收：未合并工人分支保留（salvage 族，ADR-0009）：${left.join("、")}`);
      console.log(`[drive] 启动回收：残留 run 目录 ${name} 已清（无活跃租约关联）`);
    }
  };

  let lease = null;
  let budget = null;
  let spentMsLocal = 0;
  let noProgressStreak = 0;
  let outcome = null;
  const workers_ = []; // {i, worktree, branch, home, subjectAdded, resume}

  const windDownW = (ok, cause, riskNote) => {
    let fresh = null;
    try {
      fresh = readGoal(cwd);
    } catch {
      fresh = null;
    }
    if (fresh && fresh.status === "executing") {
      try {
        const { snap, treeHash } = authorHandoffSnapshot(cwd, fresh, cause, riskNote, deps);
        handoffGoal(cwd, snap, treeHash);
        outcome = { ok, cause, handoff: snap };
        console.log(`[drive] 收束：${cause}——handoff 快照：${snap}（复归：zw 继续）`);
      } catch (err) {
        outcome = { ok, cause, handoff: null };
        console.log(`[drive] 收束：${cause}——快照写失败（${String(err?.message ?? err).slice(0, 160)}）`);
      }
    } else {
      outcome = { ok, cause, handoff: null };
      console.log(`[drive] 收束：${cause}`);
    }
    if (riskNote) console.log(`[drive] 原因：${String(riskNote).slice(0, 300)}`);
  };

  // 清理相（只发生在 finish+attestation 之后的 done，或 ok:true 干净收束；merge-conflict
  // 与 !ok 一律不清理——分支/worktree 留人工）。**subject 不移除**：removeSubject 是
  // executing-only 门（core/loop.js），done 后不可调——subject 条目留在 done goal 里惰性
  // 存在（reset 清槽时随槽消失）；计划 §N2 的「subject remove」在实现期据此订正，证据
  // 不依赖被移除 subject 的意图以「从不移除」更强形式成立。
  const cleanupPhase = () => {
    for (const w of workers_) {
      gitRun(cwd, ["worktree", "remove", w.worktree]);
      const del = gitRun(cwd, ["branch", "-d", w.branch]); // 已合并才删得动（-d 语义兜底）
      if (del.status !== 0) console.log(`[drive] 清理：分支 ${w.branch} 保留（未合并，salvage 族）`);
      rmSync(w.home, { recursive: true, force: true });
    }
    try {
      rmSync(runDir, { recursive: true, force: true });
    } catch {
      /* runDir 残留无害（宿主外，下轮启动回收兜底） */
    }
  };

  try {
    lease = withLock(cwd, () => {
      const l = acquireLease(cwd, { ttlMs: LEASE_TTL_MS, slug: goal.slug });
      process.env.LZY_RUNTIME_FENCE = String(l.fence);
      try {
        if (loadRuntime(cwd)?.budget) initBudget(cwd, { restart: true, fence: l.fence });
        else initBudget(cwd);
      } catch (err) {
        releaseLease(cwd, l.fence);
        delete process.env.LZY_RUNTIME_FENCE;
        throw err;
      }
      return l;
    });
    budget = loadRuntime(cwd).budget;
    const effectiveWallMs = wallMs != null ? Math.min(budget.wallClockBudgetMs, wallMs) : budget.wallClockBudgetMs;
    reclaim();

    console.log(
      `[drive] 启动（workers=${workers}）：${goal.slug} · 波上限 ${maxSegments} · 有效墙钟 ${effectiveWallMs}ms · mode=${mode} · fence=${lease.fence} · runId=${runId}`,
    );
    console.log(
      `[drive] workers 模式实验读数：turns≈2×（计价轴），小任务可能反慢（docs/reviews/2026-fast-exp-report.md §1.3）// workers-mode measured: turns ≈2×, small tasks may slow down`,
    );

    // worktree+subject 装配（subject add 使证据集合变 ⇒ 首波屏障对全部现行 F 项重锚）。
    mkdirSync(runDir, { recursive: true });
    for (let i = 1; i <= workers; i++) {
      const w = {
        i,
        worktree: join(runDir, `w${i}`),
        branch: `${runId}-w${i}`,
        home: join(runDir, `home-w${i}`),
        subjectAdded: false,
        resume: null,
      };
      const g = gitRun(cwd, ["worktree", "add", "-b", w.branch, w.worktree]);
      if (g.status !== 0) throw new LoopError(`workers worktree 创建失败（w${i}）：${(g.stderr ?? "").trim().slice(0, 200)}`);
      const s = lzySpawn(cwd, cliPath, ["loop", "subject", "add", w.worktree], lease.fence);
      if (s.status !== 0) throw new LoopError(`workers subject add 失败（w${i}）：${(s.stderr ?? s.stdout ?? "").trim().slice(0, 200) || s.error?.message || `status=${s.status}`}`);
      w.subjectAdded = true;
      mkdirSync(w.home, { recursive: true });
      workers_.push(w);
    }

    let prevProgress = progressSignature(cwd, goal, null);

    for (let seg = 1; seg <= maxSegments; seg++) {
      // 波间门（risk/心跳）——与单工人同源（ADJ-20/ADJ-19 语义不变）。
      try {
        const freshGoal = readGoal(cwd);
        if (freshGoal) assertDriveEligible(freshGoal);
      } catch (err) {
        windDownW(false, `波间门拒（${(err?.message ?? err).slice(0, 200)}）`, riskGuidance(err));
        break;
      }
      try {
        withLock(cwd, () => (deps.heartbeatLease ?? heartbeatLease)(cwd, lease.fence, { ttlMs: LEASE_TTL_MS }));
      } catch (err) {
        if (err?.code === "LEASE_TAKEN") {
          // 接管族：不写交接（fencing 拒）、不清理（接管者自负）——同单工人 skipHandoff 语义。
          outcome = { ok: false, cause: `波间门拒（${(err?.message ?? err).slice(0, 200)}）`, handoff: null };
          console.log(`[drive] 收束：${(err?.message ?? err).slice(0, 200)}——已被接管/租约失效，不写交接不清理`);
        } else {
          windDownW(
            false,
            `波间心跳失败（${String(err?.message ?? err).slice(0, 160)}）`,
            "非接管的运行时失败——恢复=lzy loop lease reclaim --force（或等待过期）",
          );
        }
        break;
      }
      const remainingWall = effectiveWallMs - spentMsLocal;
      if (remainingWall <= 0) {
        windDownW(true, "墙钟预算尽");
        break;
      }

      let fresh = null;
      try {
        fresh = readGoal(cwd);
      } catch (err) {
        windDownW(false, `波间门拒（${String(err?.message ?? err).slice(0, 200)}）`, riskGuidance(err));
        break;
      }
      if (!fresh || fresh.slug !== goal.slug || fresh.status !== "executing") {
        if (fresh && fresh.status === "done" && fresh.slug === goal.slug) {
          outcome = { ok: true, cause: "done", handoff: null };
          console.log(`[drive] ✔ goal done（${fresh.slug}）`);
          break;
        }
        windDownW(false, `目标已非本 drive 的 executing 目标（slug/状态换代）`);
        break;
      }
      const groups = waveSplit(fresh, workers);
      const pendingCount = (fresh.steps ?? []).filter((s) => s.status !== "done").length;
      if (pendingCount === 0) {
        // 终局：drive 自身走既有 finish 链（屏障重锚已在本波末做过——见波尾）。
        const fin = lzySpawn(cwd, cliPath, ["loop", "finish"], lease.fence);
        if (fin.status === 0) {
          outcome = { ok: true, cause: "done", handoff: null };
          console.log(`[drive] ✔ goal done（${fresh.slug}）——finish 过，进入清理相`);
          break;
        }
        windDownW(
          false,
          `finish 失败（exit=${fin.status}）`,
          (fin.stdout ?? fin.stderr ?? "").trim().slice(0, 300) ||
            "finish 闸门拒（常=某 subject 脏：工人 worktree 留了未提交物）——人工清理该 worktree 或走 ADR-0013 remove+re-anchor 出口后重试",
        );
        break;
      }
      const segTimeout = Math.min(remainingWall, DRIVE_SEGMENT_TIMEOUT_MS);
      console.log(`[drive] 波 ${seg}/${maxSegments}：分派 ${groups.map((g, i) => `w${i + 1}[${g.join(",") || "—"}]`).join(" ")}`);

      const settled = await Promise.allSettled(
        workers_.map((w, idx) => {
          const stepIds = groups[idx] ?? [];
          if (stepIds.length === 0) return Promise.resolve({ ok: true, durationMs: 0, sessionId: null, exitCode: null, stdout: "", stderr: "", skip: true });
          return spawnHeadless({
            prompt: composeWorkerPrompt({
              hostRoot,
              cliPath,
              worktree: w.worktree,
              branch: w.branch,
              idx: w.i,
              total: workers,
              stepIds,
            }),
            resume: w.resume,
            mode,
            timeoutMs: segTimeout,
            cwd: w.worktree,
            home: w.home,
            extraEnv: { LZY_RUNTIME_FENCE: String(lease.fence) },
            enginePath: deps.enginePath ?? null,
            deps: deps.run ? { run: deps.run } : null,
          }).then((r) => {
            w.resume = r.sessionId ?? w.resume;
            return r;
          });
        }),
      );
      const results = settled.map((s) =>
        s.status === "fulfilled"
          ? s.value
          : { ok: false, durationMs: 0, exitCode: null, error: String(s.reason?.message ?? s.reason) },
      );
      for (const [idx, r] of results.entries()) {
        // 工人 stdout 归档在 runDir 兄弟日志目录（清理相不吞，下轮启动回收——done 路径
        // 也留痕，供事后读工人段原文）。
        mkdirSync(join(wtRoot, `${runId}.logs`), { recursive: true });
        writeFileSync(join(wtRoot, `${runId}.logs`, `worker-w${workers_[idx].i}.txt`), `exit=${r.exitCode ?? "?"} 耗时=${r.durationMs ?? "—"}ms\n${r.stdout ?? ""}\n[stderr]\n${r.stderr ?? ""}\n`);
      }
      const maxMs = Math.max(...results.map((r) => r.durationMs ?? 0));
      console.log(`[drive] 波 ${seg}/${maxSegments} 完成：各工人耗时=${results.map((r) => r.durationMs ?? "—").join("/")}ms（墙钟取 max=${maxMs}ms）`);
      const bad = results.find((r) => !r.ok && !r.skip);
      if (bad) {
        windDownW(
          false,
          `工人段失败（exit=${bad.exitCode ?? "—"}${bad.timedOut ? " · 墙钟 SIGKILL" : ""}）`,
          `workers 波内一名工人 headless 调用失败：${(bad.error ?? "未知").slice(0, 300)}——其余工人产出已按 merge 相保留`,
        );
        break;
      }
      // 波账：墙钟取 max（并发不 sum，详单 §N1）；recordSpend 超顶拒=干净收束。
      spentMsLocal += maxMs;
      try {
        withLock(cwd, () => recordSpend(cwd, { ms: maxMs, points: 0 }));
      } catch (err) {
        if (err?.code === "BUDGET_OVER") {
          windDownW(true, `预算尽（${String(err.message).split("：")[0]}）`);
          break;
        }
        throw err;
      }

      // 组装：逐工人分支 merge 回宿主（--no-ff）。冲突=新增收束因 merge-conflict：
      // 快照+handoff 照写，分支与 worktree 留人工（不清理）。
      let conflict = null;
      for (const w of workers_) {
        if ((groups[w.i - 1] ?? []).length === 0) continue; // 空波工人无分支推进
        const m = gitRun(cwd, ["merge", "--no-ff", w.branch, "-m", `merge ${w.branch}（drive workers 波 ${seg} 组装）`]);
        if (m.status !== 0) {
          conflict = w;
          break;
        }
      }
      if (conflict) {
        gitRun(cwd, ["merge", "--abort"]);
        // 收束因=枚举字面量（消融仪器/读面按因分类）；细节走 riskNote 行。
        windDownW(
          true,
          "merge-conflict",
          `工人分支与宿主合并冲突（${conflict.branch}）——分支 ${workers_.map((w) => w.branch).join("、")} 与 worktree 已保留；请在人工会话解冲突后按计划推进（该批改动未丢失）`,
        );
        break;
      }

      // 屏障重锚：全部现行 F 项各一次（subject 集本 run 已变；首波即全锚既有绿）。
      const freshAfter = readGoal(cwd);
      for (const s of freshAfter?.steps ?? []) {
        if (s.kind === "F" && s.evidence) {
          const rb = lzySpawn(cwd, cliPath, ["step", "done", s.id, "--evidence", `wave-barrier rebind：workers 波 ${seg} 组装后复合指纹重锚（drive 代跑）`], lease.fence);
          if (rb.status !== 0) {
            windDownW(
              false,
              `屏障重锚失败（${s.id}，exit=${rb.status}）`,
              (rb.stdout ?? rb.stderr ?? "").trim().slice(0, 300),
            );
          }
        }
      }
      if (outcome) break; // 重锚通道内的收束

      // 终态判定 + 进度/水位（与单工人同源）。
      let after = null;
      try {
        after = readGoal(cwd);
      } catch (err) {
        windDownW(false, `波间门拒（${String(err?.message ?? err).slice(0, 200)}）`, riskGuidance(err));
        break;
      }
      if (after && after.status === "done" && after.slug === goal.slug) {
        outcome = { ok: true, cause: "done", handoff: null };
        console.log(`[drive] ✔ goal done（${after.slug}）`);
        break;
      }
      const cur = progressSignature(cwd, after, prevProgress);
      if (signatureKey(cur) === signatureKey(prevProgress)) noProgressStreak += 1;
      else noProgressStreak = 0;
      prevProgress = cur;
      if (noProgressStreak >= STUCK_STREAK_LIMIT) {
        windDownW(true, `无推进（stuck，连续 ${STUCK_STREAK_LIMIT} 波零推进）`);
        break;
      }
      const rp = deps.rollingPoints !== undefined ? deps.rollingPoints : rollingWaterlinePoints();
      if (rp != null && rp >= budget.pointsBudget) {
        windDownW(true, `积分预算尽（近 5h 滚动水位 ${rp} ≥ 积分硬顶 ${budget.pointsBudget}）`);
        break;
      }
      if (seg === maxSegments) {
        windDownW(true, `波数尽（${maxSegments} 波）`);
      }
    }
  } finally {
    if (lease) {
      try {
        withLock(cwd, () => releaseLease(cwd, lease.fence));
      } catch (err) {
        console.log(`[drive] lease 释放未成（${String(err?.message ?? err).slice(0, 120)}）——回收：lzy loop lease reclaim`);
      }
    }
    delete process.env.LZY_RUNTIME_FENCE;
  }

  if (!outcome) {
    windDownW(false, "内部错误：循环无显式收束因退出");
    if (!outcome) outcome = { ok: false, cause: "内部错误：循环无显式收束因退出", handoff: null };
  }
  // 清理相：done 或 ok:true 干净收束（merge-conflict 除外）→ subject remove+worktree
  // remove+分支 -d+home 删除（finish+attestation 已在前——证据不依赖被移除 subject）。
  if (outcome.ok && outcome.cause !== "merge-conflict") cleanupPhase();
  return outcome;
}
