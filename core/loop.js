// 目标循环（goal loop）状态机：注册目标 → 计划门（决策完备）→ 逐步派发 →
// 证据验证（F 项绑定 tree hash，代码一变旧证据作废）→ 完成。
// 状态落工作区 .lazyzcode/loop/goal.json（与宿主 .zcode/ 划清边界，宪法 §4 决策 #6）。
// 本模块零 spawn（tree hash 经 core/git.js 取），全部同步语义。
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { createGit } from "./git.js";
import { packageRoot } from "./paths.js";
import {
  bindPlanToAttempt,
  closeAttempt,
  initLineageAtRegister,
  loadAttempts,
  supersedeAttempt,
} from "./attempt.js";
import { assertFenceIfPresent } from "./runtime.js";
import {
  addCapturedOn,
  addEdge,
  addSupersedes,
  appendEvidenceNode,
  appendPlanNode,
  appendReviewNode,
  findGreenByGeneration,
  findLatestComparator,
  findLatestGreen,
  loadDag,
  pairReds,
  saveDag,
} from "./dag.js";

export const GOAL_VERSION = 1;
const ACTIVE_STATES = new Set(["planning", "executing"]);
// risk_class 轴序（0.2.0 棒1，ADR-0020）：只升不降的比较基准。
const RISK_ORDER = ["low", "med", "high", "restricted"];

// --note / --evidence 入账上限（评审 R2-9）
export const NOTE_MAX = 300;
export const EVIDENCE_MAX = 4000;
// --harness 取证程序串上限（0.1.0 棒B INV-08）：一句可复跑的程序描述
export const HARNESS_MAX = 300;
// 证据附件上限：单 F 项 ≤4 个文件、单个 ≤20MB（截图/响应转储足够；防手滑塞巨物）
export const EVIDENCE_FILES_MAX = 4;
export const EVIDENCE_FILE_MAX_BYTES = 20 * 1024 * 1024;
// rebind 历史上限：取证历史 append-only 留审计，超出丢最旧（plan-v2 Phase 2-1）
export const EVIDENCE_HISTORY_MAX = 5;
// 目标标题/计划条目标题上限（ADJ-17，0.2.1）：goal.json 常驻且每次 status/verify 重解析，
// 巨标题（手滑/把整段报告粘进标题）与 note/evidence/harness 的教训同族——上限取同量级。
export const TITLE_MAX = 300;

// ── 孤儿 tmp 家族表（单一事实源，ADJ-13，0.2.1）─────────────────────────────
// 全部写成「裸名前缀」（比对时剥掉开头点），cleanupLoopResidue 的清扫与 doctor 的孤儿
// 计数同取此表——历史上三源不一（doctor 两族、cleanup 四族、metrics 两族谁都管不到）。
// 口径：
//   · goal.json./dag.json./attempt.json./runtime.json. —— 常驻账本的 .<name>.<pid>.<ts>.tmp；
//   · handoff.json. —— 交接标记 tmp（本文件 handoffGoal）；
//   · metrics.json. —— 放行计数 tmp：core 侧 incMetrics 写 .metrics.json.<pid>.<ts>.tmp，
//     钩子侧（plugin/hooks/hook-lib.js）写 metrics.json.<pid>.tmp——前缀 metrics.json.
//     同时覆盖两形态（钩子侧命名已登记进本前缀，钩子文件属另一写者故仅在此声明）；
//   · snapshot./report./evidence. —— 计划快照、证据包报告、红半/绿半附件的 tmp 家族
//     （各自 live 在 snapshots//evidence/ 子目录，清扫面见 CLEANUP_TMP_DIRS）。
export const LOOP_TMP_FAMILIES = [
  "goal.json.",
  "dag.json.",
  "attempt.json.",
  "runtime.json.",
  "handoff.json.",
  "metrics.json.",
  "snapshot.",
  "report.",
  "evidence.",
];

// 家族谓词：剥前导点后按前缀判（`.goal.json.1.2.tmp` 与 `metrics.json.1.tmp` 都命中）。
export function isLoopTmpName(name) {
  if (typeof name !== "string" || !name.endsWith(".tmp")) return false;
  const bare = name.startsWith(".") ? name.slice(1) : name;
  return LOOP_TMP_FAMILIES.some((p) => bare.startsWith(p));
}

export class LoopError extends Error {}

// 真消融 kill-switch（ADR-0015）：LZY_ABLATE_* 值恰为 "1" 时消融对应闸门块，其余任何取值
// （含缺席/空串/"0"）= 关 = 行为与无开关逐字段同（契约测试钉两半）。只围闸门块本身
// （五处皆 throw-before-write 或只读分类，不碰状态文件一致性）；清单见 docs/research-ablation-design.md。
const ablated = (name) => process.env[name] === "1";

// fence 写路径守卫（0.2.0 棒1，ADR-0020）：goal/dag/attest/handoff 写入口统一在
// withLock 临界区内先过此守卫。fence 申报双通道=--fence 旗标（cli 解析桥接 env）与
// LZY_RUNTIME_FENCE env；申报制语义见 runtime.js assertFenceIfPresent（缺席=交互
// 直通不读账本，在场=必须与现行活跃租约相符，失效=已被接管→停手不写）。
// 消融开关 LZY_ABLATE_FENCE 恰 "1" 绕过（两半契约 ablation-switch 同款）。
// 已知边界（ADR-0020 并列四项）：钩子侧写面、resetLoop（删 runtime.json 本体）、
// runtime.json 自身写者、未申报的机器写——均不在本守卫面。
export function guardFence(cwd) {
  if (ablated("LZY_ABLATE_FENCE")) return;
  const raw = process.env.LZY_RUNTIME_FENCE;
  if (raw == null || raw === "") return;
  // ADJ-12：带 fence 的写必须落在租约绑定的目标上（reset 不清 runtime.json，僵尸 worker
  // 的 fence 对新目标仍相符）；goal 不可读/不存在时不带 slug（fence 相符即可，注册新目标
  // 的申报由本函数在 registerGoal 内行使——见下）。
  let slug = null;
  try {
    slug = readGoal(cwd)?.slug ?? null;
  } catch {
    slug = null;
  }
  assertFenceIfPresent(cwd, Number.parseInt(raw, 10), slug);
}

export function loopDir(cwd) {
  return join(cwd, ".lazyzcode", "loop");
}

export function goalPath(cwd) {
  return join(loopDir(cwd), "goal.json");
}

export function readGoal(cwd) {
  let text;
  try {
    text = readFileSync(goalPath(cwd), "utf8");
  } catch (err) {
    // ADJ-02 家法（0.0.9 ADJ-01 收口于 dag/attempt/runtime，goal.json 是漏网者）：
    // 仅 ENOENT=缺席；EACCES/EISDIR/其余一律 fail-closed——「不可读」被当「无 goal」
    // 会让 register 的查重放行并静默覆写一份完好的账本（写路径 rename 不看目标读权限）。
    if (err?.code === "ENOENT") return null;
    throw new LoopError(
      `goal 状态文件不可读（${err?.code ?? err?.message ?? err}）：${goalPath(cwd)}。` +
        `恢复：检查该文件的权限/属主后重跑；确认文件损坏时先自行备份，再 lzy loop reset 清除（清除不可逆）`,
    );
  }
  let goal;
  try {
    goal = JSON.parse(text);
  } catch {
    throw new LoopError(
      `goal 状态文件损坏（JSON 解析失败）：${goalPath(cwd)}。` +
        `恢复：手工修复 JSON，或先备份该文件再 lzy loop reset 清除后重新注册（清除不可逆）`,
    );
  }
  // 版本快败：schema 不符的状态文件会在远离成因处被误读（评审 R2-10）。
  if (goal && typeof goal === "object" && goal.version !== GOAL_VERSION) {
    throw new LoopError(
      `goal 状态文件版本不兼容（盘上 v${goal.version}，本 lzy 期望 v${GOAL_VERSION}）；` +
        `lzy loop reset 清除后重新注册`,
    );
  }
  return goal;
}

function writeGoal(cwd, goal) {
  const p = goalPath(cwd);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = join(dirname(p), `.${basename(p)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(goal, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, p);
}

// 原子写帮手（ADJ-08/18，0.2.1）：tmp（0600）→ rename，家族同法。family 必须是
// LOOP_TMP_FAMILIES 的前缀之一（tmp 名 = `.<family><basename>.<pid>.<ts>.tmp`），
// 否则 kill -9 残片没有任何清扫面/巡逻面认领它。持久产物统一 0600（与账本同权限）。
function writeAtomic(p, data, family) {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = join(dirname(p), `.${family}${basename(p)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, data, { mode: 0o600 });
  renameSync(tmp, p);
  return p;
}

// ── 跨进程互斥：goal.json 的 read-modify-write 必须串行，后写覆盖会丢步骤（评审 R2-5）──
// ADJ-01（0.2.1 五轮双审）：①临界段可超 10s（多 subject 指纹 1+N 次 git spawn 各带独立
// 超时、abandon/reset 的 writeSalvageStub 两发固定 10s 上界），stale 线 10s 过紧 → 60s；
// ②释放无归属校验（无条件 rmSync）——被抢锁后原持锁者退出会删掉新持锁者的锁，第三个
// 进程即刻可入（互斥在同一窗口两度破，探针实测）→ owner.json 记 token，仅 token 相符才删。
// 同为导出（0.2.2 棒1#N7）：P95 结清句要与锁三常量同尺对照，不能各自抄数字。
export const LOCK_STALE_MS = 60_000; // 持锁者死亡（进程被杀）后锁可抢；须大于临界段上界（见上）
// finish 完整性闸门的共享墙钟预算：原为 doFinishLoop 内的局部常量（逐根 git spawn 共享），
// 0.2.2 棒1#N7 提为模块级并导出——它是「临界段能有多长」的上界之一，P95 探针与医生读面
// 都要与同尺对照；formatStatus 的即时报文同用一个源。
export const GATE_BUDGET_MS = 8_000;
// 导出（0.2.2 棒1#N5）：doctor 的 lock 行与 P95 结清句要对照同一常量，不能各自抄数字。
export const LOCK_WAIT_MS = 5_000;

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// 导出给 attest.js 复用（attest.js → loop.js 单向依赖；锁原语单源不另造）。
export function withLock(cwd, fn) {
  const lock = join(loopDir(cwd), ".lock");
  mkdirSync(loopDir(cwd), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  // 竞争窗仪器（0.2.2 棒1#N5，§⑩-4 由「事件门控」升「可观测」）：等多久、等了多少次、
  // 有几次等到放弃。字段语义——lock_acquisitions=成功获锁数、lock_waits=其中需等待的
  // 获锁数（不含超时）、lock_wait_ms_total/max=等待时长、lock_timeouts=等到放弃的次数。
  // 计时起点在循环之前（首次 mkdir 前的开销也算进来，与 deadline 同起点）。
  const waitStartedAt = Date.now();
  let waited = false;
  for (;;) {
    try {
      mkdirSync(lock); // mkdir 原子性：同刻只有一个进程能建成
      break;
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;
      waited = true;
      let ageMs = 0;
      try {
        ageMs = Date.now() - statSync(join(lock, "owner.json")).mtimeMs;
      } catch {
        // owner 还没写完 = 刚加的锁（继续等）；若 owner 永久缺席（mkdir 与写 owner 之间
        // 进程被杀），回退用锁目录自身 mtime，否则该锁永不可回收（ADJ-01/59 同族）。
        try {
          ageMs = Date.now() - statSync(lock).mtimeMs;
        } catch {
          ageMs = 0;
        }
      }
      if (ageMs > LOCK_STALE_MS) {
        rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) {
        // 超时路径：从未获锁，故不记 acquisitions；等待时长照记（这是最贵的一次等待）
        const waitedMs = Date.now() - waitStartedAt;
        mergeMetrics(cwd, { add: { lock_timeouts: 1 }, max: { lock_wait_ms_max: waitedMs } });
        throw new LoopError(
          `目标循环被另一进程持锁（等待超时，等待 ${waitedMs}ms）。确认没有并发 lzy 后可删除 .lazyzcode/loop/.lock`,
        );
      }
      sleepMs(50);
    }
  }
  const waitMs = waited ? Date.now() - waitStartedAt : 0;
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    writeFileSync(
      join(lock, "owner.json"),
      `${JSON.stringify({ pid: process.pid, token, at: new Date().toISOString() })}\n`,
      { mode: 0o600 },
    );
    return fn();
  } finally {
    // 归属校验后释放：锁已被抢（stale 误判/人工删除后重建）则不动别人的锁。
    try {
      const owner = JSON.parse(readFileSync(join(lock, "owner.json"), "utf8"));
      if (owner?.token === token) rmSync(lock, { recursive: true, force: true });
    } catch {
      // owner 不可读=已被接管；保留现锁（不 rm），让新持有者自行释放。
    }
    // 账本写在**释放之后**：写在临界段内会让仪器延长它所测量的那个窗口（自扰）。
    // mergeMetrics 永不抛，故记账失败绝不阻断主路径。
    mergeMetrics(cwd, {
      add: { lock_acquisitions: 1, lock_waits: waited ? 1 : 0, lock_wait_ms_total: waitMs },
      max: { lock_wait_ms_max: waitMs },
    });
  }
}

// 恢复式报错（ADR-0006 严格就地语义）：无 goal 的全部出口共用同一文案源——报出实际检查的
// 绝对路径 + 一行恢复指引（目录解析不 walk-up，走错目录时人需要知道该回哪个根）。
export function noGoalMessage(cwd) {
  return (
    `本目录没有目标循环状态（已检查 ${loopDir(cwd)}）。` +
    `恢复：在注册了目标的工作区根重跑此命令；多仓目标回宿主工作区根；新建用 lzy loop register <slug> --title …`
  );
}

// 写命令 fail-fast（ADR-0006）：withLock 的 mkdirSync 会在没有 goal 的目录上留下
// .lazyzcode/loop/ 空壳疤痕，故进锁前先判空即抛（文案走 noGoalMessage 同源）。
// reset 显式豁免：null-goal 残留清理语义是契约（p3-sweep.contract.test.js 固化）。
// 导出给 attest.js 复用（attest.js → loop.js 单向依赖；守卫语义单源不另造）。
export function requireGoalPreLock(cwd) {
  if (!readGoal(cwd)) throw new LoopError(noGoalMessage(cwd));
}

// 导出给 attest.js 复用（attest.js → loop.js 单向依赖；守卫语义单源不另造）。
export function requireActive(cwd, ...states) {
  const goal = readGoal(cwd);
  if (!goal) throw new LoopError(noGoalMessage(cwd));
  // 空 states = 不限状态（abandon/reset 路径）；空数组是真值，必须按长度判。
  if (states.length > 0 && !states.includes(goal.status)) {
    throw new LoopError(
      `目标 ${goal.slug} 当前状态 ${goal.status}，此操作要求 ${states.join("/")}`,
    );
  }
  return goal;
}

export function nextStep(goal) {
  return goal.steps.find((s) => s.status === "pending") ?? null;
}

// ── 1. 注册 ────────────────────────────────────────────────────────────────
export function registerGoal(cwd, slug, title, { tier = "light", risk = "low" } = {}) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(slug ?? "")) {
    throw new LoopError(`slug 不合法：${slug}（仅字母数字与连字符，≤64 字符）`);
  }
  if (typeof title !== "string" || !title.trim()) throw new LoopError("目标标题不能为空（--title）");
  // 长度上限（ADJ-17，0.2.1）：目标标题常驻 goal.json；裸 `--title`（漏值=true）在类型
  // 守卫处即拒（CLI 侧另有用法错，core 这里是不信任输入的防御层）。
  if (title.trim().length > TITLE_MAX) {
    throw new LoopError(
      `--title 超上限 ${TITLE_MAX} 字符（当前 ${title.trim().length}）；目标名一句即可，细节进计划文件`,
    );
  }
  // tier 落盘（v008#N8）：大小写归一为小写；非法值 LoopError。
  const tierNorm = typeof tier === "string" ? tier.toLowerCase() : tier;
  if (tierNorm !== "light" && tierNorm !== "heavy") {
    throw new LoopError(`tier 不合法：${tier}（light | heavy，默认 light）`);
  }
  // risk_class 落盘（0.2.0 棒1，ADR-0020；§⑮ Q5 拍板）：与 tier（工作量轴）正交的
  // 风险轴，LOW<MED<HIGH<RESTRICTED 只升不降；机器执法点=drive 入口（棒2 接线），
  // triage 自评仍 L0。additive 字段零版本 bump（沿 tier/subjects 先例）。
  const riskNorm = typeof risk === "string" ? risk.toLowerCase() : risk;
  if (!RISK_ORDER.includes(riskNorm)) {
    throw new LoopError(`risk 不合法：${risk}（low | med | high | restricted，默认 low）`);
  }
  // 非 git 宿主前置硬拒（ADR-0019，0.1.1）：证据绑定 git 树，非 git 宿主的 finish 不可达
  //（unbound 拒+完整性闸门 host 根 missing 拒）——把不可达性从 finish 期提前到注册期，
  // 零工作量损失时点最早。headTreeHash null=目录非 git 仓或 git 不可用，同族同拒，无逃生 flag。
  if (!createGit(cwd).headTreeHash()) {
    throw new LoopError(
      `宿主无法解析为 git 仓库（未初始化或 git 不可用）：${cwd}——目标循环证据绑定 git 树，` +
        `非 git 宿主的 finish 不可达。先 git init 并完成首次提交，再重新注册（ADR-0019）`,
    );
  }
  // 查重+写入同一临界区（评审 R6A-1）：并发 register 双方 readGoal 均 null 时
  // 各自 writeGoal 原子覆盖，先注册的目标无痕丢失——唯一漏网的 goal.json 变更操作补齐入锁。
  return withLock(cwd, () => {
    const existing = readGoal(cwd);
    if (existing && ACTIVE_STATES.has(existing.status)) {
      throw new LoopError(
        `已有进行中的目标 ${existing.slug}（${existing.status}）——同树串行纪律：接管该目标（读 lzy loop status 与交接快照）或移到树外 worktree 开新目标；` +
          `绝不 reset/abandon 他人正在跑的槽位（多会话红线，破坏不可逆）`,
      );
    }
    if (existing) {
      throw new LoopError(
        `已存在目标状态 ${existing.slug}（${existing.status}，含证据档案）；lzy loop reset 清除后再注册`,
      );
    }
    // ADJ-30（0.2.1 五轮双审）：register 是 goal.json 写入口，纳入 fence 守卫面——
    // 申报制下仅带 fence 的调用（drive 派生工人）受限；交互无 fence 恒直通。
    guardFence(cwd);
    const goal = {
      version: GOAL_VERSION,
      slug,
      title: title.trim(),
      status: "planning",
      tier: tierNorm,
      risk: riskNorm,
      planPath: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      baseTreeHash: null,
      subjects: [],
      steps: [],
      // 实例戳（ADJ-44，0.0.10）：跨 reset 常驻账本里同 slug 多实例并存，节点带
      // attempt 戳隔离——配对/supersedes/锚定都限本实例。序号从账本既有最大戳+1
      // 推导（reset 后重注册不回退）；0.0.9 旧节点无戳=隔离于新实例之外。
      attempt: deriveAttempt(cwd, slug),
    };
    // 世系初始化（0.1.0 棒B，ADR-0016）：register=本目标运行的开端，attempt.json 重置为
    // 本运行（历史运行由中央账本 plan 节点 attempt 戳派生）。写序在 goal.json 前——
    // 世系写失败=注册失败（fail-closed 同 dag-first，不留无世系的半截状态）。
    // ADJ-03：init 在同 n 冲突时顺延，以其返回值为准回写实例戳（两处必须同一事实源）。
    goal.attempt = initLineageAtRegister(cwd, { slug, n: goal.attempt, tier: tierNorm });
    writeGoal(cwd, goal);
    return goal;
  });
}

// 从中央账本推导本实例序号：同 slug 已带戳节点的最大 attempt+1；无戳/无账本=1。
// loadDag 不可读即抛（dag-first 家法，register 不在损账本上落新实例）。
// ADJ-03（0.2.1 五轮双审）：只数 DAG 带戳节点会在「注册未采纳→reset→重注册」时回落到
// 1（从未产生 plan 节点），与旧实例同号 → 世系双条目同 n、planHash/收口落错条目。取
// max(DAG 带戳最大值, 世系文件最大 n)+1——两个事实源都单调，同 n 成为不变量。
function deriveAttempt(cwd, slug) {
  const dag = loadDag(cwd);
  let max = 0;
  for (const n of dag.nodes) {
    if (n.slug === slug && Number.isInteger(n.attempt)) max = Math.max(max, n.attempt);
  }
  const lineage = loadAttempts(cwd);
  if (lineage && lineage.slug === slug && Array.isArray(lineage.attempts)) {
    for (const a of lineage.attempts) {
      if (Number.isInteger(a?.n)) max = Math.max(max, a.n);
    }
  }
  return max + 1;
}

// tier 升级子命令（v008#N8）：planning/executing 可用；light→heavy 单向（反向 LoopError，
// 只升不降宪法）；大小写归一；同值=no-op。升级时 review 为空或非 PASS→warn 一行
// （warn-only 保住只升不降；机器门=采纳时点，executing 升级为程序性自报不回溯评审，
// ADR-0013 记 warn 与语义在案）。
export function setTier(cwd, value) {
  requireGoalPreLock(cwd);
  return withLock(cwd, () => {
    guardFence(cwd);
    const goal = requireActive(cwd, "planning", "executing");
    const norm = typeof value === "string" ? value.toLowerCase() : value;
    if (norm !== "light" && norm !== "heavy") {
      throw new LoopError(`tier 不合法：${value}（用法：lzy loop tier heavy）`);
    }
    const current = goal.tier ?? "light";
    if (norm === "light" && current === "heavy") {
      throw new LoopError("tier 只升不降：heavy 目标不可降为 light（宪法 Tier 规则）");
    }
    if (norm === current) {
      return { goal, changed: false, warn: null };
    }
    // 升档前移拒（ADJ-09，§⑪ Q5）：无 planHash 的 goal 升 heavy 会撞三连拒死锁
    //（finish 门要对照、对照要 planHash）——先补快照重评审（executing 无 planHash
    // 可重采纳计划）再升档。
    if (norm === "heavy" && !goal.planHash) {
      throw new LoopError(
        `升档前移拒：目标 ${goal.slug} 无计划快照（planHash 缺席，0.0.7 在途/手写旧形），升 HEAVY 后 finish/对照三连拒死锁——` +
          `先重采纳计划补快照（lzy loop plan <文件> --review "…"，附 HEAVY 须 ≥1 F 项）再 lzy loop tier heavy（ADJ-09 出口口径）`,
      );
    }
    goal.tier = norm;
    let warn = null;
    if (norm === "heavy") {
      const verdict = goal.review?.verdict ?? null;
      if (verdict !== "PASS") {
        warn = "本目标从未过评审门（review 为空或非 PASS）——HEAVY 机器门只在采纳时点执法，此升级为程序性自报";
      }
    }
    writeGoal(cwd, goal);
    return { goal, changed: true, warn };
  });
}

// risk_class 升级子命令（0.2.0 棒1，ADR-0020；§⑮ Q5）：镜像 setTier 只升不降；
// 与 tier 的两点语义差异（注释在案防再议）：①无 planHash 耦合——risk 门执法点在
// drive 入口（棒2 接线）而非采纳时点，无 ADJ-09 三连拒死锁面；②升到 high/restricted
// 时 warn-only 提醒 SUSPENDED_RISK 协议（SKILL Continuation 节）：无人值守车道禁入，
// 在途无人值守执行应挂起交回人工。
export function setRisk(cwd, value) {
  requireGoalPreLock(cwd);
  return withLock(cwd, () => {
    guardFence(cwd);
    const goal = requireActive(cwd, "planning", "executing");
    const norm = typeof value === "string" ? value.toLowerCase() : value;
    if (!RISK_ORDER.includes(norm)) {
      throw new LoopError(`risk 不合法：${value}（用法：lzy loop risk <low|med|high|restricted>）`);
    }
    const current = goal.risk ?? "low";
    if (RISK_ORDER.indexOf(norm) < RISK_ORDER.indexOf(current)) {
      throw new LoopError(`risk 只升不降：${current} 目标不可降为 ${norm}（风险轴规则，ADR-0020）`);
    }
    if (norm === current) {
      return { goal, changed: false, warn: null };
    }
    goal.risk = norm;
    let warn = null;
    if (norm === "high" || norm === "restricted") {
      warn =
        norm === "high"
          ? "HIGH：无人值守车道禁入（drive 入口机器门拒）——在途无人值守执行按 SUSPENDED_RISK 协议挂起交回人工"
          : "RESTRICTED：硬禁（仅人工收窄计划范围后重评可解）——在途无人值守执行按 SUSPENDED_RISK 协议挂起交回人工";
    }
    writeGoal(cwd, goal);
    return { goal, changed: true, warn };
  });
}

// risk 门谓词（0.2.0 棒1，ADR-0020；§⑮ Q5 拍板）：drive 入口机器门的数据面+谓词。
// 本棒无调用方（drive 子命令棒2 接线）——由契约测试承载（kernel-first 沿 0.0.9 棒1
// DAG 先例）。HIGH=人工会话推进；RESTRICTED=硬禁，唯一出口=人工收窄范围后 reset 重
// 注册（风险轴随新目标重评——risk 只升不降无降级命令，出口经重建而非降档）。
// 消融开关 LZY_ABLATE_RISK_GATE 恰 "1" 绕过（棒2 H3R 三臂实验的 B/C 臂即本门，
// roadmap §⑮ 预注册协议）。
export function assertDriveEligible(goal) {
  if (ablated("LZY_ABLATE_RISK_GATE")) return { eligible: true };
  const risk = goal?.risk ?? "low";
  if (risk === "high") {
    throw new LoopError(
      `HIGH 风险目标禁入无人值守车道：${goal.slug}（risk=high，ADR-0020）——` +
        `请在人工会话推进（drive/无人值守唤起均被本门拒）`,
    );
  }
  if (risk === "restricted") {
    throw new LoopError(
      `RESTRICTED 硬禁：${goal.slug}（risk=restricted）——仅人工收窄计划范围后 reset 并重注册可解` +
        `（风险轴随新目标重评；本门无逃生 flag，ADR-0020）`,
    );
  }
  return { eligible: true, risk };
}

// ── 2. 计划门：解析 N/F 清单，决策完备（无待定）才放行 ────────────────────
const ITEM_RE = /^-\s*\[([NF])(\d+)\]\s*(.+)$/;
const UNDECIDED_RE = /(TBD|待定|待确认|未定|待讨论)/i;
// 依赖边声明（决策 #21 最小链，2026-09-14）：紧随条目行的下一行 `deps: N1,N2`；
// 无声明=现状零变化，旧计划文件逐字节兼容。分隔容逗号/空白/全角逗号；token 必须
// 是 N/F 条目 id。孤儿 deps 行（不紧随条目/大小写不符/重复声明）在计划门响亮拒绝，
// 不静默吞——静默丢边=比作者认知更弱的阻塞图（评审 R1-A2/R1-B3/B4/B5）；正文提及
// deps 语法的行（如教学示例）可按门豁免先例行尾加 <!--lzy:allow-->。
const DEPS_RE = /^\s*deps:\s*(.*)$/;
// 孤儿扫描容 bullet 前缀（`- deps: …` 也算声明形态——门姿势「不静默吞」对齐，评审 R2-B）。
const DEPS_ORPHAN_RE = /^\s*(?:[-*]\s+)?deps\s*:/i;
const DEP_TOKEN_RE = /^[NF]\d+$/;
// subject 集声明（v008-integrity-kernel#N3，拍板③）：计划头 `subjects: <path>` 每行一路径，
// 相对路径按宿主根解析；头内重复=LoopError；路径不存在/非 git 仓/与宿主包含=LoopError 拒采纳。
// 正文杂散 subjects: 行沿 deps orphan 家法响亮拒绝（行级 <!--lzy:allow--> 豁免同款）。
const SUBJECTS_RE = /^\s*subjects:\s*(\S+)\s*$/;
const SUBJECTS_ORPHAN_RE = /^\s*(?:[-*]\s+)?subjects\s*:/i;

function parsePlanItems(body) {
  const lines = body.split(/\r?\n/);
  const items = [];
  const consumedDeps = new Set();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(ITEM_RE);
    if (!m) continue;
    const id = `${m[1]}${m[2]}`;
    if (items.some((it) => it.id === id)) throw new LoopError(`计划清单 id 重复：${id}`);
    let deps = [];
    if (i + 1 < lines.length && DEPS_RE.test(lines[i + 1])) {
      consumedDeps.add(i + 1);
      const tokens = lines[i + 1].match(DEPS_RE)[1].split(/[\s,，]+/).filter(Boolean);
      if (tokens.length === 0) throw new LoopError(`deps 声明为空：${id}（语法：deps: N1,N2）`);
      for (const t of tokens) {
        if (!DEP_TOKEN_RE.test(t)) {
          throw new LoopError(
            `deps 条目非法：${id} → ${t}（必须是 N/F 条目 id，语法：deps: N1,N2）`,
          );
        }
      }
      deps = [...new Set(tokens)];
    }
    const title = m[3].trim();
    // 条目标题上限（ADJ-17，0.2.1）：与 goal.title 同限——标题族人读/机器解析面都要小。
    if (title.length > TITLE_MAX) {
      throw new LoopError(
        `计划条目标题超上限 ${TITLE_MAX} 字符：${id}（当前 ${title.length}）——标题凝成一句，细节写进条目正文`,
      );
    }
    items.push({ id, kind: m[1], title, deps });
  }
  for (const [i, line] of lines.entries()) {
    if (consumedDeps.has(i) || line.includes("<!--lzy:allow-->")) continue;
    if (DEPS_ORPHAN_RE.test(line)) {
      throw new LoopError(
        `孤儿 deps 行（必须是其条目行的下一行）：L${i + 1}: ${line.trim().slice(0, 60)}`,
      );
    }
  }
  return items;
}

// 依赖边校验：引用存在、不自指、无环（三色 DFS；显式栈迭代——递归在 ~5000 节深链上
// 爆调用栈误拒合法计划，对抗审查 R5-A 实测）。环路径封顶展示，防千节环刷出巨幅报错。
const CYCLE_PATH_CAP = 8;

function capCyclePath(path) {
  if (path.length <= CYCLE_PATH_CAP) return path.join(" → ");
  return `${path.slice(0, CYCLE_PATH_CAP).join(" → ")} → …（共 ${path.length} 节）`;
}

function validateDeps(items) {
  const byId = new Map(items.map((it) => [it.id, it]));
  for (const it of items) {
    for (const dep of it.deps) {
      if (dep === it.id) throw new LoopError(`依赖边自指：${it.id} 依赖自己`);
      if (!byId.has(dep)) {
        throw new LoopError(
          `依赖边引用不存在的条目：${it.id} → ${dep}（现有：${items.map((x) => x.id).join(" ")}）`,
        );
      }
    }
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const state = new Map(items.map((it) => [it.id, WHITE]));
  for (const start of items) {
    if (state.get(start.id) !== WHITE) continue;
    const stack = [{ id: start.id, i: 0 }];
    state.set(start.id, GRAY);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const deps = byId.get(top.id).deps;
      if (top.i < deps.length) {
        const dep = deps[top.i];
        top.i += 1;
        const st = state.get(dep);
        if (st === GRAY) {
          const from = stack.findIndex((f) => f.id === dep);
          throw new LoopError(
            `计划依赖成环：${capCyclePath([...stack.slice(from).map((f) => f.id), dep])}`,
          );
        }
        if (st === WHITE) {
          state.set(dep, GRAY);
          stack.push({ id: dep, i: 0 });
        }
      } else {
        stack.pop();
        state.set(top.id, BLACK);
      }
    }
  }
}

// 评审判决解析：优先认 VERDICT: 记号（plan-reviewer 契约）——命中即采信，忽略评审正文里的普通用词
// （如 PASS 附言写着 revise 某行，不再误拒，评审 R2-3）；无记号回退关键词扫描保持兼容。
function parseVerdict(review) {
  const m = review.match(/\bVERDICT:\s*(PASS|REVISE)\b/i);
  if (m) return m[1].toUpperCase();
  if (/\bREVISE\b/i.test(review)) return "REVISE";
  if (/\bPASS\b/i.test(review)) return "PASS";
  return "UNVERIFIED";
}

// ── 2.5 subject 集（v008-integrity-kernel#N3）───────────────────────────────
// 校验单个 subject 根：存在目录、git 仓（HEAD 头树可解析）、与宿主无包含关系（任一向，
// 尾分隔符判定防 /foo 误配 /foobar——拍板③只认兄弟仓根，host 子目录只会复刻 host 树）。
// 返回 realpath 归一绝对路径。
function validateSubjectRoot(cwd, p) {
  const abs = resolve(cwd, p);
  let st;
  try {
    st = statSync(abs);
  } catch {
    throw new LoopError(`subject 路径不存在：${abs}`);
  }
  if (!st.isDirectory()) throw new LoopError(`subject 路径不是目录：${abs}`);
  const root = realpathSync(abs);
  const host = realpathSync(cwd);
  if (root === host) throw new LoopError(`subject 不能是宿主仓自身：${root}`);
  if (root.startsWith(host + sep) || host.startsWith(root + sep)) {
    throw new LoopError(
      `subject 与宿主仓存在包含关系（拍板③只认兄弟仓根）：subject=${root} host=${host}`,
    );
  }
  if (!createGit(root).headTreeHash()) {
    throw new LoopError(`subject 不是 git 仓库（HEAD 头树不可解析）：${root}`);
  }
  return root;
}

// 计划头 subjects: 行解析：仅首个清单项之前生效；头内重复（realpath 后）=LoopError；
// 头内形态非法（bullets/空值）与正文杂散 subjects: 行=LoopError（不静默吞家法）。
function parseSubjectsHeader(cwd, body) {
  const lines = body.split(/\r?\n/);
  const firstItem = lines.findIndex((l) => ITEM_RE.test(l));
  const headerEnd = firstItem === -1 ? lines.length : firstItem;
  const declared = [];
  for (let i = 0; i < headerEnd; i++) {
    const line = lines[i];
    if (line.includes("<!--lzy:allow-->")) continue;
    const m = line.match(SUBJECTS_RE);
    if (m) {
      declared.push(m[1]);
      continue;
    }
    if (SUBJECTS_ORPHAN_RE.test(line)) {
      throw new LoopError(
        `subjects: 头声明形态非法（语法：subjects: <path> 每行一路径，仅计划头）：L${i + 1}: ${line.trim().slice(0, 60)}`,
      );
    }
  }
  const roots = declared.map((p) => validateSubjectRoot(cwd, p));
  const seen = new Set();
  for (const root of roots) {
    if (seen.has(root)) throw new LoopError(`subjects: 头声明重复路径：${root}`);
    seen.add(root);
  }
  for (let i = headerEnd; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("<!--lzy:allow-->")) continue;
    if (SUBJECTS_ORPHAN_RE.test(line)) {
      throw new LoopError(
        `孤儿 subjects: 行（声明仅在计划头，首个清单项之前）：L${i + 1}: ${line.trim().slice(0, 60)}`,
      );
    }
  }
  return roots;
}

// 复合指纹：subject 集={host}∪roots 每根 HEAD 头树哈希，按 realpath 排序拼
// "realpath\0hash\n" 串取 sha256。任一根树变（或集合变）→ 指纹变 → 全体绑定指纹的
// F 证据过期。防御分支：subject 根消失/非 git 仓时该根以 "missing" 参与串（采纳门已拒，
// 此处兜底；finish 闸门另有 missing 分支拦「重录取证致指纹含 missing 仍 fresh」穿越）。
// host 自身非 git 仓 → 返回 null（unbound 语义，镜像 legacy `!treeHash` 谓词）。
// 缺键归一单点：roots 按 `?? []` 归一（0.0.8 前的 goal 无 subjects 键，计算面同容忍）。
export function fingerprintSubjects(cwd, roots) {
  const hostHash = createGit(cwd).headTreeHash();
  if (!hostHash) return null;
  const list = [resolve(cwd), ...(Array.isArray(roots) ? roots : [])];
  const parts = list.map((root) => {
    let rp = root;
    try {
      rp = realpathSync(root);
    } catch {
      // 根消失：按存储路径参与排序，哈希记 missing
    }
    const hash = root === resolve(cwd) ? hostHash : (createGit(root).headTreeHash() ?? "missing");
    return { rp, hash };
  });
  parts.sort((a, b) => (a.rp < b.rp ? -1 : a.rp > b.rp ? 1 : 0));
  return createHash("sha256").update(parts.map((x) => `${x.rp}\0${x.hash}\n`).join("")).digest("hex");
}

// 中途加 subject（仅 executing）：校验镜像采纳门；realpath 幂等去重。
// 语义：任何集合变化→指纹变化→全体已录 F 证据过期，重取后才可 finish。
export function addSubject(cwd, path) {
  requireGoalPreLock(cwd);
  return withLock(cwd, () => {
    guardFence(cwd);
    const goal = requireActive(cwd, "executing");
    const root = validateSubjectRoot(cwd, path);
    const subjects = goal.subjects ?? [];
    if (subjects.includes(root)) return { goal, root, added: false };
    goal.subjects = [...subjects, root];
    writeGoal(cwd, goal);
    return { goal, root, added: true };
  });
}

// 根已消失时的路径归一（ADJ-16，0.2.1 五轮双审）：对**最深存在的祖先**做 realpath
//（吃掉 /tmp→/private/tmp、/var→/private/var 一类系统链接形态差——旧实现的分隔符边界
// 后缀匹配对它永不触发：`/private/tmp/X` 里前缀后缀 `/tmp/X` 的上一字符是 "e" 不是 "/"），
// 再拼回不存在的尾部；realpath 全程不可解析（不该发生）时按原样返回。
function realpathWithMissingTail(p) {
  const tail = [];
  let head = p;
  for (;;) {
    try {
      return join(realpathSync(head), ...tail);
    } catch {
      const parent = dirname(head);
      if (parent === head) return p;
      tail.unshift(basename(head));
      head = parent;
    }
  }
}

// 中途移除 subject（仅 executing）：集合维护命令（评审 4 轮增补=missing 死锁出口：
// 根永久消失时 remove 是 abandon 外唯一出路）。收窄与从未声明同信任级——不违「无逃生门」
// （证据过期语义照走：移除后指纹变，全体 F 证据过期须重取）。
// 匹配语义（ADJ-16，0.2.1 五轮双审）：主判据=「解析后路径相等」（两侧同一归一口径）；
// 形态兜底只在候选条目自身的根已消失（realpath 失败）时启用——旧实现的两条无门槛后缀
// 分支双向失真：把「以某 subject 真实路径为尾」的**另一个**真实目录（Time Machine/rsync
// 备份镜像 `/Volumes/Backup/…/repo`）误判成该 subject 而删掉真条目并报出那个无关路径，
// 而它声称要救的 /tmp 形态反不触发。返回值=被删条目本身（成功文案随之指向被删条目）。
export function removeSubject(cwd, path) {
  requireGoalPreLock(cwd);
  return withLock(cwd, () => {
    guardFence(cwd);
    const goal = requireActive(cwd, "executing");
    const subjects = goal.subjects ?? [];
    const rp = realpathWithMissingTail(resolve(cwd, path));
    let idx = subjects.indexOf(rp);
    if (idx === -1) {
      idx = subjects.findIndex((e) => {
        let live = true;
        try {
          realpathSync(e);
        } catch {
          live = false; // 该条目根已消失：形态兜底适用
        }
        if (live) return false; // 根仍在盘上=另一条真实路径，后缀/形态含糊匹配不得启用
        return realpathWithMissingTail(e) === rp; // 与主判据同口径：解析后路径相等
      });
    }
    if (idx === -1) {
      throw new LoopError(`该路径不在 subject 集合：${rp}（当前集合 ${subjects.length} 项）`);
    }
    const removed = subjects[idx];
    goal.subjects = subjects.filter((_, i) => i !== idx);
    writeGoal(cwd, goal);
    return { goal, removed };
  });
}

// 人权门批准记录谓词（0.1.1 goal1，ADR-0018）：`.lazyzcode/loop/approvals/` 下 slug+planHash
// 双键精确匹配；目录缺席=无记录；不可解析文件忽略（记录面是 create-only 附加族，单文件
// 损坏不扩大局）。写入面在钩子（trigger.js，真实用户消息唯一通道），本侧只读。
export function findApproval(cwd, slug, planHash) {
  const dir = join(loopDir(cwd), "approvals");
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return false;
  }
  for (const f of entries) {
    if (!f.endsWith(".json") || f.endsWith(".tmp")) continue;
    try {
      const rec = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (rec && rec.slug === slug && rec.planHash === planHash) return true;
    } catch {}
  }
  return false;
}

export function adoptPlan(cwd, planFile, opts = {}) {
  requireGoalPreLock(cwd);
  return withLock(cwd, () => doAdoptPlan(cwd, planFile, opts));
}

// supersede（0.1.0 棒B，ADR-0016）：executing 期改计划的 forward-only 出口——同一采纳
// 门（评审/快照/计划节点全照走），旧 attempt 置 superseded、开 attempt+1 新代次。
export function supersedePlan(cwd, planFile, opts = {}) {
  requireGoalPreLock(cwd);
  return withLock(cwd, () => doAdoptPlan(cwd, planFile, { ...opts, supersede: true }));
}

function doAdoptPlan(cwd, planFile, { force = false, review = null, supersede = false, git = null } = {}) {
  guardFence(cwd);
  // 存量出口（ADJ-09，§⑪ Q5）：executing 态仅当无 planHash（0.0.7 在途/手写旧形，
  // HEAVY 三连拒死锁人群）允许重采纳=补快照重走评审；有 planHash 的 executing 目标
  // 改计划走 lzy loop supersede（forward-only 世系面，0.1.0 棒B）。
  const goal = requireActive(cwd, "planning", "executing");
  if (supersede) {
    if (goal.status !== "executing") {
      throw new LoopError(
        `supersede 仅 executing 态有语义：目标 ${goal.slug} 当前 ${goal.status}——planning 期直接 lzy loop plan 改计划重采纳即可`,
      );
    }
    if (!goal.planHash) {
      throw new LoopError(
        `目标 ${goal.slug} 无计划快照（planHash 缺席）——走重采纳恢复出口 lzy loop plan <文件>，supersede 不适用`,
      );
    }
  }
  if (goal.status === "executing" && goal.planHash && !supersede) {
    throw new LoopError(
      `目标 ${goal.slug} 在执行且已有计划快照（planHash 在场）——重采纳仅服务无快照存量（恢复出口）；执行中改计划用 lzy loop supersede <文件>（forward-only 世系面）`,
    );
  }
  // 评审门（宪法 §4 #15）：判决 REVISE = 拒绝采纳，--force 不越过（修计划重审才是正道）。
  if (review && parseVerdict(review) === "REVISE") {
    throw new LoopError(
      `计划评审未过门（plan-reviewer 判决 REVISE）。按评审意见修计划、重跑评审后再采纳；评审记录：${review.slice(0, 200)}`,
    );
  }
  // ── HEAVY 机器门（v008#N8，拍板②「无 PASS 机器拒」）：HEAVY 目标采纳必须带 PASS 评审，
  // 任意非空非 PASS 串（含 UNVERIFIED）同拒，--force 不越过；LIGHT 无评审行为不变。
  // 判据=当次 --review 的 parseVerdict（采纳时点归一），不重解析盘上 500 截断的 summary。
  // LZY_ABLATE_TIER_GATE（ADR-0015）：开关开=此门消融（HEAVY 无 PASS 也可采纳）。
  if ((goal.tier ?? "light") === "heavy" && !ablated("LZY_ABLATE_TIER_GATE")) {
    const verdict = review ? parseVerdict(review) : null;
    if (verdict !== "PASS") {
      throw new LoopError(
        `HEAVY 目标机器拒：无 PASS 评审不得采纳（${review ? `判决 ${verdict}` : "未带 --review"}）。` +
          `先过 plan-reviewer 评审门（VERDICT: PASS）再带 --review 采纳；--force 不越过此门。`,
      );
    }
  }
  let body;
  try {
    body = readFileSync(planFile, "utf8");
  } catch {
    throw new LoopError(`计划文件不可读：${planFile}`);
  }
  // LZY_ABLATE_PLAN_GATE（ADR-0015）：开关开=禁词扫描块消融（含 TBD 族词也放行采纳；
  // 与 --force 分立——force 连同豁免提示一并跳过，开关只消融本块）。
  if (!force && !ablated("LZY_ABLATE_PLAN_GATE")) {
    // 逐行报行号+摘录，并给行级豁免 <!--lzy:allow-->：正文提及（如「尚无定论」）不再逼人全有全无地 --force（评审 R2-7）。
    const hits = [];
    for (const [i, line] of body.split(/\r?\n/).entries()) {
      if (line.includes("<!--lzy:allow-->")) continue;
      if (UNDECIDED_RE.test(line)) hits.push(`L${i + 1}: ${line.trim().slice(0, 80)}`);
    }
    if (hits.length > 0) {
      throw new LoopError(
        `计划未决策完备（含未决标记 ${hits.length} 处）。消除标记后重跑；确要带病开工用 --force；` +
          `若某行只是正文提及而非未决事项，行尾加 <!--lzy:allow--> 豁免。\n  ${hits
            .slice(0, 5)
            .join("\n  ")}`,
      );
    }
  }
  const items = parsePlanItems(body);
  if (items.length === 0) {
    throw new LoopError("计划里没有清单项（语法：- [N1] … / - [F1] …，F 项需真实表面证据）");
  }
  // 升档前移校验（ADJ-08 配套，§⑪ Q5）：HEAVY 计划须 ≥1 F 项——零 F 无对照对象、
  // 对照门无处着力（存量零 F HEAVY 目标走 finish 的零 F 豁免出口）。
  if ((goal.tier ?? "light") === "heavy" && !items.some((it) => /^F/.test(it.id))) {
    throw new LoopError(
      `HEAVY 目标计划须含 ≥1 个 F 项（终验项）：零 F 计划无对照对象，对照门无处着力——补 F 项或用 LIGHT（ADJ-08 出口口径）`,
    );
  }
  validateDeps(items);
  const subjects = parseSubjectsHeader(cwd, body);
  // ── plan snapshot+hash（v008#N7）：采纳即快照计划文→.lazyzcode/loop/snapshots/<slug>.md
  // （reset 不清，照证据报告先例；目录名避开 .lazyzcode/plans/ 同形词），goal.planHash=
  // sha256(快照内容)，review 携 planHash（评审绑被评审物）。原 planPath 文件继续承载
  // 换路注记——不可变快照与可变叙事分离。复采纳纪律：planHash 变而评审未换→warn（机器
  // 不拦；红线句在 SKILL/ADR）——比对基准=存量 goal.review.summary（500 截断面）。
  const warnings = [];
  const planHash = createHash("sha256").update(body).digest("hex");
  if (supersede && planHash === goal.planHash) {
    throw new LoopError(
      `计划哈希未变（${goal.planHash.slice(0, 10)}…）——supersede 开新代次须实质计划变更；修改计划文件后重跑`,
    );
  }
  if (goal.planHash && goal.planHash !== planHash) {
    if (!review || review === (goal.review?.summary ?? null)) {
      warnings.push(
        `复采纳：计划快照哈希已变而评审未重跑（--review 未带或与上次采纳逐字相同）——修订后的计划须重过 plan-reviewer 再采纳`,
      );
    }
  }
  // ── 人权门（0.1.1 goal1，ADR-0018）：计划采纳须经 UPS 批准记录（exact-hash）。
  // 位置=planHash 计算后、goal 变更前；--force 不越过（无逃生 flag）；plan/supersede/
  // 存量重采纳同一门；双档全适用（V3 表4 H1）。无记录→落 approvalPending 后拒（报文
  // 带短码+恢复指引）；重拒幂等刷新。批准记录只能由 UserPromptSubmit 钩子在真实用户
  // 消息上写入——CLI 侧无 approve 命令。
  // ADJ-15（0.2.1）：报文口径=禁令，不是能力断言——批准记录是工作区里的本地 JSON 文件，
  // 手写即可「过门」；本门防偷懒不防伪证（与 dag/attestation 同一威胁边界），补偿控制=
  // 协议文本+审计环（doctor approvals 行为批准记录的机器读面），边界见 ADR-0018。
  if (!ablated("LZY_ABLATE_HUMAN_GATE") && !findApproval(cwd, goal.slug, planHash)) {
    // planPath 进 pending：首次采纳时 goal.planPath 尚为空、复采纳时指向旧计划——
    // 钩子的 exact-hash 复核必须哈希到「本门所验的这份文件」。
    goal.approvalPending = {
      planHash,
      planPath: relative(cwd, planFile) || planFile,
      requestedAt: new Date().toISOString(),
    };
    writeGoal(cwd, goal);
    const short = planHash.slice(0, 8);
    throw new LoopError(
      `人权门未过（UPS exact-hash，ADR-0018）：计划 ${goal.slug}（短码 ${short}）等待人类批准。` +
        `把「批准 ${short}」原样转给用户，用户消息到达后重跑本命令。` +
        `禁令：不得手写 approvals/ 批准记录、也不得自跑命令冒充批准（正规通道只有 UserPromptSubmit ` +
        `钩子在真实用户消息上写记录）——本门防偷懒不防伪证：记录是工作区本地文件，手写即可过门，` +
        `威胁边界与 dag/attestation 同级；补偿控制=协议文本+审计环（doctor approvals 行），见 ADR-0018。`,
    );
  }
  goal.planPath = relative(cwd, planFile) || planFile;
  goal.subjects = subjects;
  goal.planHash = planHash;
  goal.approvalPending = null; // 人权门放行即清 pending（ADR-0018：不留陈旧批准请求）
  const verdict = review ? parseVerdict(review) : null;
  goal.review = review
    ? { by: "plan-reviewer", verdict: verdict === "PASS" ? "PASS" : "UNVERIFIED", summary: review.slice(0, 500), at: new Date().toISOString(), planHash }
    : null;
  goal.steps = items.map((it) => ({
    id: it.id,
    kind: it.kind,
    title: it.title,
    status: "pending",
    deps: it.deps,
    claim: null,
    doneAt: null,
    note: null,
    evidence: null,
  }));
  // forward-only 代次推进（0.1.0 棒B，ADR-0016）：supersede 开新 attempt=旧+1（deriveAttempt
  // 家法的内存推进——中央账本 plan 节点带新戳，跨 reset 重注册的序号自然衔接）；旧快照
  // 归档 .attempt<n>.md 后写新快照（attempt 历史在 snapshots/ 亦可达）；基线头树取当前。
  // ADJ-44（0.2.1 五轮双审）：≤0.0.10 写出的存量 goal 无 attempt 戳，裸 +1 得 NaN →
  // JSON.stringify 落 "n": null → 读侧 assertEntries 自拒，abandon/register/重 finish
  // 全堵且 reset 不解（唯一出路=人工删账本）。入口按 deriveAttempt 家法归一。
  const priorAttempt = Number.isInteger(goal.attempt) ? goal.attempt : deriveAttempt(cwd, goal.slug);
  goal.attempt = priorAttempt;
  if (supersede) {
    goal.attempt = priorAttempt + 1;
    goal.baseTreeHash = git ? git.headTreeHash() : goal.baseTreeHash;
    const prevSnapPath = join(loopDir(cwd), "snapshots", `${goal.slug}.md`);
    if (existsSync(prevSnapPath)) {
      copyFileSync(prevSnapPath, join(loopDir(cwd), "snapshots", `${goal.slug}.attempt${priorAttempt}.md`));
    }
  }
  // 快照先落盘再持久 goal（写序：goal.planHash 永不指向缺席快照；快照写失败=采纳失败）。
  // 原子写（ADJ-08，0.2.1）：本文件曾是全家族唯一裸写——kill -9/ENOSPC 命中截断窗口即留
  // 半截快照，planHash 复核行永久显示「⚠ sha256 不符（疑篡改）」且无修复指引（假警报长挂）。
  writeAtomic(join(loopDir(cwd), "snapshots", `${goal.slug}.md`), body, "snapshot.");
  // 评审/采纳即注册边（v009-bat1#N4，ADR-0014）：plan+review 节点与 reviews/plans 边落
  // 中央 DAG——dag-first（账本写失败=采纳拒，goal.json 未动）。复采纳=新节点追加（账本
  // 不可变，最新节点为现役——权威切换归棒2）。
  {
    const dag = loadDag(cwd);
    const planNode = appendPlanNode(dag, { slug: goal.slug, planHash, attempt: goal.attempt });
    addEdge(dag, { type: "plans", from: planNode.id, to: goal.slug });
    if (goal.review) {
      const reviewNode = appendReviewNode(dag, {
        planHash,
        verdict: `${goal.review.verdict} ${goal.review.summary}`.slice(0, 300),
      });
      addEdge(dag, { type: "reviews", from: reviewNode.id, to: planNode.id });
    }
    saveDag(cwd, dag);
  }
  // 世系落盘（0.1.0 棒B，ADR-0016）：supersede=旧代次置 superseded+新代次 active（单次
  // 写，盘上无双 active 中间态）；普通采纳=本代次绑定 planHash。写序在 goal.json 前
  // （fail-closed 同 dag-first：世系写失败=采纳失败，goal.json 不动）。
  if (supersede) {
    supersedeAttempt(cwd, { slug: goal.slug, from: priorAttempt, to: goal.attempt, planHash, tier: goal.tier ?? null });
  } else {
    bindPlanToAttempt(cwd, { slug: goal.slug, n: goal.attempt, planHash, tier: goal.tier ?? null });
  }
  writeGoal(cwd, goal);
  return { goal, warnings, superseded: supersede ? { from: priorAttempt, to: goal.attempt } : null };
}

// ── 3. 开跑：planning → executing，记录基线 tree hash ──────────────────────
export function startLoop(cwd, git) {
  requireGoalPreLock(cwd);
  return withLock(cwd, () => doStartLoop(cwd, git));
}

function doStartLoop(cwd, git) {
  guardFence(cwd);
  const goal = requireActive(cwd, "planning");
  if (goal.steps.length === 0) {
    throw new LoopError("计划门未过：先 lzy loop plan <文件> 采纳清单");
  }
  goal.status = "executing";
  goal.startedAt = new Date().toISOString();
  goal.baseTreeHash = git ? git.headTreeHash() : null;
  writeGoal(cwd, goal);
  return goal;
}

// ── 4. 逐步完成：F 项强制证据 + 绑定当时 tree hash；已完成步骤可重跑以重新取证 ──
export function completeStep(cwd, git, id, opts = {}) {
  requireGoalPreLock(cwd);
  return withLock(cwd, () => doCompleteStep(cwd, git, id, opts));
}

// 证据附件：把取证产物（截图/响应转储）复制进 .lazyzcode/evidence/ 并绑 sha256——
// 原件在 /tmp 会被清，副本让证据包自包含（.lazyzcode/ 不计工作区脏，决策 #14）。
function attachEvidenceFiles(cwd, goal, step, files, seq = 1) {
  if (!files || files.length === 0) return undefined;
  if (step.kind !== "F") {
    throw new LoopError(`附件证据仅 F 项支持（${step.id} 是 ${step.kind} 项）；N 项的完成由 note 承载`);
  }
  if (files.length > EVIDENCE_FILES_MAX) {
    throw new LoopError(`附件超上限：最多 ${EVIDENCE_FILES_MAX} 个/项（当前 ${files.length}）`);
  }
  const outDir = join(cwd, ".lazyzcode", "evidence");
  mkdirSync(outDir, { recursive: true });
  return files.map((src, i) => {
    let st;
    try {
      st = statSync(src);
    } catch {
      throw new LoopError(`证据文件不可读：${src}`);
    }
    if (!st.isFile()) throw new LoopError(`证据路径不是文件：${src}`);
    if (st.size > EVIDENCE_FILE_MAX_BYTES) {
      throw new LoopError(`证据文件超上限 ${EVIDENCE_FILE_MAX_BYTES} bytes：${src}（${st.size}）`);
    }
    const ext = (/(\.[a-z0-9]{1,9})$/i.exec(basename(src))?.[1] ?? ".bin").toLowerCase();
    // seq=取证代数（step.evidenceSeq）：重取证落新代数文件名，不再同名覆写旧附件（plan-v2 Phase 2-1）
    const dest = join(outDir, `${goal.slug}.${step.id}.${seq}.${i + 1}${ext}`);
    copyFileSync(src, dest);
    // 0600（ADJ-18，0.2.1）：证据附件常含 HTTP 响应/截图/CLI 输出（可能带凭据或内部
    // 数据），.lazyzcode/evidence/ 是 reset 不清的长期留存目录——与账本同权限，不留 umask 差。
    try {
      chmodSync(dest, 0o600);
    } catch {}
    return {
      path: relative(cwd, dest),
      name: basename(src),
      sha256: createHash("sha256").update(readFileSync(dest)).digest("hex"),
      bytes: st.size,
    };
  });
}

function doCompleteStep(cwd, git, id, { note = null, evidence = null, files = null, harness = null } = {}) {
  guardFence(cwd);
  // done 态恢复白名单（ADJ-10 出口，0.0.10）：done 目标的账本分歧曾把报错给的恢复命令
  // （step done rebind）反拒成死端——rebind 类命令放行，重 finish 落新 attestation。
  const goal = requireActive(cwd, "executing", "done");
  const step = goal.steps.find((s) => s.id === id);
  if (!step) {
    throw new LoopError(
      `无此步骤：${id}（现有：${goal.steps.map((s) => s.id).join(" ") || "无"}）`,
    );
  }
  const rebinding = step.status === "done";
  // 长度上限：状态文件要常驻且每次 status/verify 重解析，巨串入账会让全流程变慢（评审 R2-9；
  // 上限对齐项目自身纪律——note 同 comment-checker 的 300，evidence 容忍一段 stdout 摘录）。
  const trimmedNote = note?.trim() || null;
  if (trimmedNote && trimmedNote.length > NOTE_MAX) {
    throw new LoopError(`--note 超上限 ${NOTE_MAX} 字符（当前 ${trimmedNote.length}）；请凝成一两句`);
  }
  const trimmedEvidence = evidence?.trim() ?? null;
  // harness 冻结（0.1.0 棒B，INV-08）：--harness 声明取证程序串（≤300 字符），sha256
  // 入证据节点——同半对红绿程序不同源在 HEAVY finish 拒（INV-08 执法在 finish 闸块）。
  const trimmedHarness = harness?.trim() || null;
  if (trimmedHarness && trimmedHarness.length > HARNESS_MAX) {
    throw new LoopError(`--harness 超上限 ${HARNESS_MAX} 字符（当前 ${trimmedHarness.length}）；凝成一句可复跑的程序描述`);
  }
  if (trimmedHarness && step.kind !== "F") {
    throw new LoopError(`--harness 仅 F 项支持（${id} 是 ${step.kind} 项；红绿取证程序身份是终验项的纪律）`);
  }
  if (step.kind === "F") {
    if (!trimmedEvidence) {
      throw new LoopError(
        `终验项 ${id} 必须带 --evidence（真实表面取证：HTTP 返回/截图/CLI stdout；测试全绿≠证据）`,
      );
    }
    if (trimmedEvidence.length > EVIDENCE_MAX) {
      throw new LoopError(
        `--evidence 超上限 ${EVIDENCE_MAX} 字符（当前 ${trimmedEvidence.length}）；请只摘录关键输出`,
      );
    }
  }
  step.status = "done";
  step.doneAt = new Date().toISOString();
  delete step.claim; // 步级认领随收口自动释放（决策 #21：done 即自清，不留僵尸标记）
  step.note = trimmedNote ?? (rebinding ? step.note : null);
  const previousEvidence = rebinding ? step.evidence : null;
  const captureGen = step.evidenceSeq ?? 1;
  const attached = attachEvidenceFiles(cwd, goal, step, files, captureGen);
  step.evidence =
    step.kind === "F"
      ? {
          text: trimmedEvidence,
          // v008 起证据绑复合指纹（{host}∪subjects）；treeHash 字段停写，legacy 证据
          // 对象保留原字段不动（verify 双轨回退比对，行为与 0.0.7 全同）。
          fingerprint: fingerprintSubjects(cwd, goal.subjects),
          at: step.doneAt,
          ...(attached ? { files: attached } : {}),
        }
      : null;
  // rebind 痕迹：旧证据整对象入历史（append-only，审计「凭什么改口」）；代数随每次取证
  // 推进并进附件文件名——同一 F 项反复取证不再互相覆写（plan-v2 Phase 2-1）。
  if (previousEvidence) {
    step.evidenceHistory = [...(step.evidenceHistory ?? []), previousEvidence].slice(
      -EVIDENCE_HISTORY_MAX,
    );
  }
  if (step.kind === "F") step.evidenceSeq = (step.evidenceSeq ?? 1) + 1;
  // 取证即注册边（v009-bat1#N4，ADR-0014）：green 半镜像落中央 DAG——dag-first，账本写
  // 失败=整命令拒（writeGoal 未跑、goal.json 不动、重试安全）；未配对 red/waive 回填
  // red_of（多条合法、最新为现行），rebind 追加 supersedes。verify/finish 判定不读此账本
  // （统一权威切换=棒2）。
  if (step.kind === "F") {
    const dag = loadDag(cwd);
    const priorGreen = findLatestGreen(dag, goal.slug, id, goal.attempt);
    const greenNode = appendEvidenceNode(dag, {
      slug: goal.slug,
      step: id,
      seq: captureGen,
      half: "green",
      attempt: goal.attempt,
      surface: step.evidence.fingerprint
        ? { kind: "fingerprint", value: step.evidence.fingerprint }
        : null,
      text: trimmedEvidence ?? "",
      files: attached ?? [],
      ...(trimmedHarness ? { harnessHash: sha256Hex(trimmedHarness), harnessSpec: trimmedHarness } : {}),
    });
    if (step.evidence.fingerprint) {
      addCapturedOn(dag, greenNode.id, { kind: "fingerprint", value: step.evidence.fingerprint });
    }
    if (priorGreen) addSupersedes(dag, priorGreen.id, greenNode.id);
    pairReds(dag, { slug: goal.slug, step: id, greenId: greenNode.id, attempt: goal.attempt });
    saveDag(cwd, dag);
  }
  writeGoal(cwd, goal);
  return { goal, step, rebinding, dirty: git ? git.dirty() : false };
}

// ── 红绿机器账本（v009 棒1，ADR-0014）：red/waive-red 半的登记面 ─────────────
// 红半/waive 边只存在中央 DAG（goal.json 零改动——机器只记账不裁决，缺半不拦任何门，
// 执法仍在协议文本+comparator）。E-01 调和：red 各绑各面——--surface 显式外部表面
// （已发布版版本号等自由串），缺省=当前复合指纹（改前取证时点即 base 树）。
export function recordEvidenceHalf(cwd, git, id, { half, text = null, files = null, surfaceExternal = null, harness = null } = {}) {
  requireGoalPreLock(cwd); // fail-fast 补口（v009 棒2#N6，ADR-0006 家法）：无 goal 不留空壳
  return withLock(cwd, () => doRecordEvidenceHalf(cwd, git, id, { half, text, files, surfaceExternal, harness }));
}

function doRecordEvidenceHalf(cwd, git, id, { half, text, files, surfaceExternal, harness }) {
  guardFence(cwd);
  // done 态恢复白名单第三腿（ADJ-04，0.2.1）：HEAVY finish 的 INV-09/INV-08 拒报文都把
  // `lzy evidence red` / `waive-red` 写成恢复命令，而 done 态下这两条曾被状态门反拒 →
  // 恢复链断（唯一出路 reset/abandon）。白名单与 completeStep/attest 对齐（executing|done）。
  const goal = requireActive(cwd, "executing", "done");
  const step = goal.steps.find((s) => s.id === id);
  if (!step) {
    throw new LoopError(`无此步骤：${id}（现有：${goal.steps.map((s) => s.id).join(" ") || "无"}）`);
  }
  if (step.kind !== "F") {
    throw new LoopError(`红绿账本只记 F 项（${id} 是 ${step.kind} 项；红绿纪律是终验项的取证纪律）`);
  }
  const isWaive = half === "waived";
  const trimmed = text?.trim() ?? null;
  const cap = isWaive ? NOTE_MAX : EVIDENCE_MAX;
  const label = isWaive ? "--reason" : "--evidence";
  if (!trimmed) {
    throw new LoopError(
      isWaive
        ? `终验项 ${id} 的红半豁免必须带 --reason（一行豁免的机器形态：说明为何构造不出反态）`
        : `终验项 ${id} 必须带 ${label}（改前态上的失败取证：红半与绿半各绑各面）`,
    );
  }
  if (trimmed.length > cap) {
    throw new LoopError(`${label} 超上限 ${cap} 字符（当前 ${trimmed.length}）；请凝成一两句`);
  }
  if (isWaive && surfaceExternal != null) {
    throw new LoopError(
      `waive-red 不绑表面（豁免本无面）——--surface 不适用；红半面请用 lzy evidence red --surface`,
    );
  }
  if (isWaive && harness != null) {
    throw new LoopError(`waive-red 不收 harness（豁免面无程序可绑，INV-08）——--harness 不适用`);
  }
  const trimmedHarness = harness?.trim() || null;
  if (trimmedHarness && trimmedHarness.length > HARNESS_MAX) {
    throw new LoopError(`--harness 超上限 ${HARNESS_MAX} 字符（当前 ${trimmedHarness.length}）；凝成一句可复跑的程序描述`);
  }
  if (surfaceExternal !== null && typeof surfaceExternal === "string" && !surfaceExternal.trim()) {
    throw new LoopError(`--surface 值为空：外部表面须为非空描述（如 "npm registry@0.0.9"）；去掉该旗标则缺省绑复合指纹`);
  }
  let surface = null;
  if (!isWaive) {
    if (surfaceExternal) {
      surface = { kind: "external", value: surfaceExternal };
    } else {
      const fp = fingerprintSubjects(cwd, goal.subjects);
      if (!fp) {
        throw new LoopError(`无绑定表面可记（宿主非 git 仓？）；用 --surface 显式声明外部表面`);
      }
      surface = { kind: "fingerprint", value: fp };
    }
  }
  // dag-first + 先账本后落盘（ADJ-24，0.0.10）：节点先入内存账本取 id（附件名带节点
  // 身份），附件拷贝失败即整命令拒、账本未落盘（不留半截附件）；saveDag 失败的残留
  // 附件属既有部分失败家族（无害孤儿，与 completeStep 的 writeGoal 失败同语义）。
  const dag = loadDag(cwd);
  // 反向配对（0.1.0 棒B INV-09 恢复路径，ADR-0016）：绿落地后补录红/waive——若该步已有
  // 现行锚定绿（findGreenByGeneration 代次语义=goal.json evidenceSeq-1，与 finish 检查
  // 同源同一查找原语，孤儿 ghost 角两处自然收敛），当场加 red_of 指向它。pairReds 本体
  // 不动：绿前录=原语义下次绿落地时配对；绿后录=反向配对立即成对（多条 red_of 合法、
  // 最新为现行）。
  const anchorGen = (step.evidenceSeq ?? 1) - 1;
  const anchored = anchorGen >= 1 ? findGreenByGeneration(dag, goal.slug, id, anchorGen, goal.attempt) : null;
  // 代数对齐绿半（ADJ-10，0.2.1 五轮双审）：红半瞄准的取证代数=绿半同一代数——绿前录红
  // 取 completeStep 即将落地的 captureGen（step.evidenceSeq ?? 1）；绿后补录（INV-09
  // 恢复路径）取**锚定绿的 seq**：原实现一律写 evidenceSeq 现值=锚绿代数+1，展示面
  //（evidence list 的 genN）与 red_of 边的真值互相矛盾（门不受影响——配对真值在边上，
  // pairReds 按 attempt 配对不读 seq）。
  const seq = anchored ? anchored.seq : (step.evidenceSeq ?? 1);
  const node = appendEvidenceNode(dag, {
    slug: goal.slug,
    step: id,
    seq,
    half,
    surface,
    text: trimmed,
    files: [],
    attempt: goal.attempt,
    ...(trimmedHarness ? { harnessHash: sha256Hex(trimmedHarness), harnessSpec: trimmedHarness } : {}),
  });
  if (surface) addCapturedOn(dag, node.id, surface);
  if (anchored) addEdge(dag, { type: "red_of", from: node.id, to: anchored.id });
  node.files = attachHalfFiles(cwd, goal, step, files, seq, half, node.id) ?? [];
  saveDag(cwd, dag);
  return { node, dirty: git ? git.dirty() : false };
}

// 红半附件：与 attachEvidenceFiles 同约束，命名带 half+代数+节点身份段
// （<slug>.<F>.<half>.gen<seq>.<nodeId>.<n><ext>）——红半与绿半瞄准同一代数，不带 half
// 段会互相覆写；同代次第二条红半落新节点 id 新文件、永不覆写（ADJ-24，0.0.10），
// 目标名意外在场即拒（防碰撞退化为静默覆盖与假 sha256 声明）。
// ADJ-05（0.2.1）：先全部复制到 .tmp 名、全部成功才 rename 到终名——中途任一失败
// （不可读/非文件/超限）即清理本次已复制的 tmp 并整命令拒，不再留「半失败终名残留」；
// 重试时 nextId 推出同一节点 id → 撞 ADJ-24 护栏死端（消除死端的碰撞报文见下）。
function attachHalfFiles(cwd, goal, step, files, seq, half, nodeId) {
  if (!files || files.length === 0) return undefined;
  if (files.length > EVIDENCE_FILES_MAX) {
    throw new LoopError(`附件超上限：最多 ${EVIDENCE_FILES_MAX} 个/项（当前 ${files.length}）`);
  }
  const outDir = join(cwd, ".lazyzcode", "evidence");
  mkdirSync(outDir, { recursive: true });
  const staged = [];
  try {
    const out = [];
    for (let i = 0; i < files.length; i++) {
      const src = files[i];
      let st;
      try {
        st = statSync(src);
      } catch {
        throw new LoopError(`证据文件不可读：${src}`);
      }
      if (!st.isFile()) throw new LoopError(`证据路径不是文件：${src}`);
      if (st.size > EVIDENCE_FILE_MAX_BYTES) {
        throw new LoopError(`证据文件超上限 ${EVIDENCE_FILE_MAX_BYTES} bytes：${src}（${st.size}）`);
      }
      const ext = (/(\.[a-z0-9]{1,9})$/i.exec(basename(src))?.[1] ?? ".bin").toLowerCase();
      const dest = join(outDir, `${goal.slug}.${step.id}.${half}.gen${seq}.${nodeId}.${i + 1}${ext}`);
      if (existsSync(dest)) {
        throw new LoopError(
          `红半附件目标已存在（文件名含节点身份 ${nodeId}，不应碰撞）：${dest}——拒绝覆写（ADJ-24）；` +
            `若为上一次半失败残留，删除残留 ${dest} 后重试`,
        );
      }
      const tmp = join(outDir, `.evidence.${basename(dest)}.${process.pid}.${Date.now()}.${i}.tmp`);
      copyFileSync(src, tmp);
      try {
        chmodSync(tmp, 0o600); // 与证据家族同权限（ADJ-18）
      } catch {}
      staged.push({ tmp, dest });
      out.push({
        path: relative(cwd, dest),
        name: basename(src),
        sha256: createHash("sha256").update(readFileSync(tmp)).digest("hex"),
        bytes: st.size,
      });
    }
    for (const s of staged) renameSync(s.tmp, s.dest);
    return out;
  } catch (err) {
    for (const s of staged) {
      try {
        rmSync(s.tmp, { force: true });
      } catch {}
    }
    throw err;
  }
}

// ── 4b. 步级认领（决策 #21 最小链，2026-09-14）：同目标多工人占步互斥 ────────
// 匿名目录级：不记 sessionId（ADR-0009 同款立场——模型在 Bash 拿不到自己身份，任何
// 要求转抄身份的设计都在最需要的时刻制造新失败面）。互斥窗口=认领 TTL（CLAIM_TTL_MS
// 48h，与 goal 级 claimedAt 同常数）；step done 自动清；goal.json 写路径全走 withLock。

// 认领新鲜谓词：claim.at 在 TTL 内才算在场（过期=可再认领，重认领自然覆写）。
// ADJ-14（0.2.1）：未来时间戳（时钟回拨/VM 恢复/手改文件）曾使差值恒为负 → 恒判新鲜，
// 占步 48h 互斥永不退役。取值=「不新鲜」（而非 clamp 到 now）：clamp 会让一条伪造/越界
// 的认领凭 48h 重新起算、继续挡住同目标其他工人，而保守方向应是把异常时间戳视为无效
// 标记（重认领自然覆写，零工作量损失）——扫描侧同判并把 sid 记入 future 名单告警。
function isClaimFresh(step) {
  if (!step.claim || typeof step.claim.at !== "string") return false;
  const at = Date.parse(step.claim.at);
  if (!Number.isFinite(at)) return false;
  const now = Date.now();
  if (at > now) return false; // 未来时间戳=异常标记，不新鲜
  return now - at <= CLAIM_TTL_MS;
}

// 认领时间戳越界谓词（ADJ-14，0.2.1）：claim.at 在未来（时钟回拨/VM 恢复/手改文件）——
// 值语义=异常标记，只用于读面点名（不新鲜判定在 isClaimFresh 内联，避免两处漂移）。
function claimTimeAnomaly(step) {
  const at = step?.claim?.at;
  if (typeof at !== "string") return null;
  const t = Date.parse(at);
  return Number.isFinite(t) && t > Date.now() ? at : null;
}

// 无阻塞谓词：deps 全 done（无 deps=恒无阻塞）。返回未完成依赖 id 列表（空=可认领）。
// 容忍旧 goal.json 无 deps 字段（additive 字段，hooks 同款容忍读法）。
function blockedBy(step, goal) {
  const deps = Array.isArray(step.deps) ? step.deps : [];
  if (deps.length === 0) return [];
  const byId = new Map(goal.steps.map((s) => [s.id, s]));
  return deps.filter((d) => byId.get(d)?.status !== "done");
}

export function claimStep(cwd, id, { release = false } = {}) {
  requireGoalPreLock(cwd);
  return withLock(cwd, () => {
    guardFence(cwd);
    const goal = requireActive(cwd, "executing");
    const step = goal.steps.find((s) => s.id === id);
    if (!step) {
      throw new LoopError(
        `无此步骤：${id}（现有：${goal.steps.map((s) => s.id).join(" ") || "无"}）`,
      );
    }
    if (release) {
      if (!step.claim) throw new LoopError(`步骤 ${id} 当前无认领标记，无需释放`);
      delete step.claim;
      writeGoal(cwd, goal);
      return { goal, step, released: true };
    }
    if (step.status === "done") throw new LoopError(`步骤 ${id} 已完成，无需认领`);
    if (isClaimFresh(step)) {
      throw new LoopError(
        `步骤 ${id} 已被认领（${step.claim.at}，48h 内互斥）；过期后可重新认领，或 --release 释放`,
      );
    }
    const undone = blockedBy(step, goal);
    if (undone.length > 0) {
      throw new LoopError(
        `步骤 ${id} 被阻塞：依赖未完成 ${undone.join(" ")}（先收口依赖步，或认领无阻塞步）`,
      );
    }
    step.claim = { at: new Date().toISOString() };
    writeGoal(cwd, goal);
    return { goal, step, released: false };
  });
}

// 可认领集：未 done、无在场认领、无阻塞。无参 claim 与 status 读面共用。
function claimableSteps(goal) {
  return goal.steps.filter(
    (s) => s.status !== "done" && !isClaimFresh(s) && blockedBy(s, goal).length === 0,
  );
}

// 无参 claim 的读面（CLI 直调；只读但要求 executing——planning 态认领没有语义）。
export function formatClaimList(cwd) {
  const goal = readGoal(cwd);
  if (!goal) throw new LoopError(noGoalMessage(cwd));
  if (goal.status !== "executing") {
    throw new LoopError(`目标 ${goal.slug} 当前状态 ${goal.status}，步级认领仅 executing 态有语义`);
  }
  const claimable = claimableSteps(goal);
  if (claimable.length === 0) {
    return "可认领集为空（全部步骤已收口、已被认领或被依赖阻塞；释放用 lzy loop claim <id> --release）";
  }
  return (
    `可认领 ${claimable.length}：${claimable.map((s) => s.id).join(" ")}` +
    `\n${claimable.map((s) => `  ${s.id.padEnd(4)} [${s.kind}] ${s.title}`).join("\n")}` +
    `\n认领：lzy loop claim <id>（匿名互斥 48h；step done 自动释放；提前释放加 --release）`
  );
}

// ── 5. 证据时效统一权威（v009 棒2，ADR-0014）：判定读中央 DAG 账本——绿节点按
// goal.json 当前代次锚定选择（孤儿 ghost 不可现行、不阻断），节点 surface 为权威作
// 比对，hash 比对降为账本上的边型之一；无节点的 treeHash 形态记录=legacy 双轨
// （0.0.8 行为逐字段同）；fingerprint 形态而节点缺席=账本与 goal.json 分歧，
// fail-closed 拒（无逃生 flag，沿 ADR-0013 家法；恢复=rebind 重注册节点）。
export function verifyEvidence(cwd, git) {
  const goal = readGoal(cwd);
  if (!goal) throw new LoopError(noGoalMessage(cwd));
  const dag = loadDag(cwd); // DagError 原样上抛：账本不可读即拒（消息自带恢复指路）
  const current = git ? git.headTreeHash() : null;
  const fingerprint = fingerprintSubjects(cwd, goal.subjects ?? []);
  const fresh = [];
  const stale = [];
  const unbound = [];
  for (const s of goal.steps) {
    if (s.kind !== "F" || s.status !== "done") continue;
    if (s.evidence?.fingerprint) {
      // 指纹主轨（权威=账本节点）：按 goal.json 当前代次锚定绿节点——captureGen =
      // evidenceSeq-1（doCompleteStep 写后自增），缺省 1。
      const gen = s.evidenceSeq ? s.evidenceSeq - 1 : 1;
      const node = findGreenByGeneration(dag, goal.slug, s.id, gen, goal.attempt);
      if (!node) {
        // 账本-goal 分歧：0.0.8 时代在途 goal 升级（fingerprint 形态先于 DAG）、或账本
        // 被改动——fail-closed，重取证 rebind 即重注册节点。
        throw new LoopError(
          `证据账本不一致：${s.id} 记录第 ${gen} 代绿半但中央 DAG 无对应节点` +
            `（疑 0.0.8 在途 goal 升级或账本缺改）。` +
            `恢复：在当前代码上重跑 lzy step done ${s.id} --evidence …（rebind 即重注册账本节点）。`,
        );
      }
      // subject 集任一根变化（含集合增删）即过期；host 非 git 仓=指纹 null=未绑定；
      // 节点面非指纹（null/external——正常流不产生，防御性归未绑定=强制重取证）。
      if (!fingerprint || node.surface?.kind !== "fingerprint") unbound.push(s);
      else if (node.surface.value === fingerprint) fresh.push(s);
      else stale.push(s);
    } else if ((goal.subjects?.length ?? 0) > 0) {
      // ADJ-11（0.0.10）：legacy 单树证据在多 subject 目标是按步退出口——subject 提交
      // 对单树哈希不可见，可产出假 finish。收紧：多 subject 目标的 legacy 轨判不可判
      // 新鲜（重取证即入复合指纹轨）；零 subject 目标保持 0.0.8 逐字段同行为。
      stale.push(s);
    } else {
      // legacy 单树轨（0.0.7 证据对象，无账本节点）：行为与 0.0.7/0.0.8 全同。
      if (!s.evidence?.treeHash || !current) unbound.push(s);
      else if (s.evidence.treeHash === current) fresh.push(s);
      else stale.push(s);
    }
  }
  return { current, fingerprint, fresh, stale, unbound, dag };
}

// dirty 命中路径提示（multisession-discipline#N1）：前 3 条 + 超出计数。路径缺席（旧形状/
// 异常路径）时静默省略该子句——提示永不改变拒绝语义，只改变可读性。
const DIRTY_PATH_HINT_MAX = 3;

function dirtyPathHint(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return "";
  const head = paths.slice(0, DIRTY_PATH_HINT_MAX).join("、");
  const more = paths.length > DIRTY_PATH_HINT_MAX ? ` 等 ${paths.length} 处` : "";
  return `命中：${head}${more}。`;
}

// ── 6. 完成：全部步骤 done + F 项证据全部新鲜 ──────────────────────────────
// F 项当前代次的锚定绿节点（evidenceSeq-1 家法，与 verifyEvidence/终验 attestation 同源）。
function anchoredGreenFor(dag, goal, fid) {
  const s = goal.steps.find((x) => x.id === fid);
  if (!s) return null;
  const gen = s.evidenceSeq ? s.evidenceSeq - 1 : 1;
  return findGreenByGeneration(dag, goal.slug, fid, gen, goal.attempt);
}

function sha256Hex(s) {
  return createHash("sha256").update(s).digest("hex");
}

export function finishLoop(cwd, git, opts = {}) {
  requireGoalPreLock(cwd);
  return withLock(cwd, () => doFinishLoop(cwd, git, opts));
}

function doFinishLoop(cwd, git, { writeReport = null } = {}) {
  guardFence(cwd);
  // done 态重入（ADJ-10 出口，0.0.10）：恢复链 rebind 后重 finish 落新 attestation
  //（旧 attestation reset 不清照旧留存，新文件按 attemptId 时间戳另立）。
  const goal = requireActive(cwd, "executing", "done");
  // 埋点（plan-v2 Phase 2-1）：finish 尝试与三分拒绝计数——veto 判定式①「finish 首过率」
  // 的数据面；incMetrics 契约永不抛，计数失败不影响拒绝/放行语义。
  incMetrics(cwd, "finish_attempts");
  const pending = goal.steps.filter((s) => s.status !== "done");
  if (pending.length > 0) {
    incMetrics(cwd, "finish_reject_pending");
    throw new LoopError(
      `未完成即停 = 半途而废：还剩 ${pending.map((s) => s.id).join(" ")}（用 lzy step done 逐项收口）`,
    );
  }
  const { current, stale, unbound, fingerprint, dag } = verifyEvidence(cwd, git);
  // 过期（代码后变，重取证即可）与未绑定（git 缺失，重取证也无济于事）必须分诊，药方不同（评审 R2-4）。
  // LZY_ABLATE_VERIFY（ADR-0015，范围钉死=本两处拒绝）：开关开=过期/未绑证据不再拦 finish；
  // verifyEvidence 调用本身与 `lzy loop verify` 独立报告面不在消融内。
  if (stale.length > 0 && !ablated("LZY_ABLATE_VERIFY")) {
    incMetrics(cwd, "finish_reject_stale");
    throw new LoopError(
      `证据已过期（代码在取证后变更，tree hash 对不上）：${stale.map((s) => s.id).join(" ")}。` +
        `在当前代码上重新取证后重跑 lzy step done <id> --evidence …（current=${current ?? "未知"}）`,
    );
  }
  if (unbound.length > 0 && !ablated("LZY_ABLATE_VERIFY")) {
    incMetrics(cwd, "finish_reject_unbound");
    throw new LoopError(
      `证据未绑定 tree hash：${unbound.map((s) => s.id).join(" ")}。` +
        (current
          ? "证据缺少 tree hash，重新取证即可绑定。"
          : "本目录不是 git 仓库或还没有任何提交——先 git init 并提交，再重新取证。"),
    );
  }
  // ── 对照 attestation 机器门（v009 棒2，§⑪ N3）：HEAVY 强制现行记录且 MATCH 且指纹
  // 未过期；LIGHT 可 self-check 免录（协议层自查）。无逃生 flag（ADR-0013 家法）。
  // 零 F 豁免（ADJ-08 出口，0.0.10）：无终验项即无对照对象——与 attest comparator
  // 「无 F 项拒」同判据同文案，零 F+HEAVY 的三连拒死锁就此闭合（§⑪ Q5）。
  // LZY_ABLATE_ATTEST（ADR-0015）：开关开=整门消融（comparator 保持 null，终验
  // attestation 如 LIGHT 形态记 null，不为消融伪造记录）。
  let comparator = null;
  if ((goal.tier ?? "light") === "heavy" && goal.steps.some((s) => s.kind === "F") && !ablated("LZY_ABLATE_ATTEST")) {
    comparator = findLatestComparator(dag, goal.slug, goal.planHash);
    if (!comparator) {
      throw new LoopError(
        `HEAVY finish 需对照 attestation 且 MATCH：先派 qa-executor 对每个 F 项断言×证据逐对对照，` +
          `再 lzy attest comparator --file <结论.json>（LIGHT 目标可 self-check 免录；机器门无逃生 flag）`,
      );
    }
    if (comparator.verdict !== "MATCH") {
      throw new LoopError(
        `对照 attestation 判决为 MISMATCH（记录 ${comparator.id}）：处置不匹配项后重新对照并重录` +
          `（lzy attest comparator --file …）`,
      );
    }
    if (comparator.fingerprint !== fingerprint) {
      throw new LoopError(
        `对照 attestation 已过期（记录 ${comparator.id} 的指纹与当前树不符——对照后代码又变了）：重新对照并重录`,
      );
    }
    // ── 覆盖复查（ADJ-06，0.2.1）：0.0.9-era 的 comparator 节点无 items 字段——下面的
    // 绑定循环会被 `items ?? []` 空转，同时让 INV-09 的「legacy 轨不重复执法」分支失去
    // 前提（升级携带账本的防御缺口）。判据与入账侧（attest.js validateAttestationDoc）
    // 同：items 必须覆盖 goal 的全部 F 项，legacy 空 items 节点不可过门。
    {
      const fids = goal.steps.filter((s) => s.kind === "F").map((s) => s.id);
      const covered = new Set((comparator.items ?? []).map((it) => it.fid));
      const uncovered = fids.filter((id) => !covered.has(id));
      if (uncovered.length > 0) {
        throw new LoopError(
          `对照 attestation（${comparator.id}）未覆盖全部 F 项：缺 ${uncovered.join(" ")}` +
            `（无 items 的旧版记录不可过门）——重新对照全部 F 项并重录（lzy attest comparator --file …）`,
        );
      }
    }
    // ── 对照绑证据（ADJ-02，0.0.10）：item 须绑定该 F 项当前代次的锚定绿节点，且对照
    // 时点晚于所锚节点取证时点——「先对照后取证」「rebind 后复用旧对照」「跨 reset 复用」
    // 三类绕行在机器门闭合。
    for (const it of comparator.items ?? []) {
      const anchor = anchoredGreenFor(dag, goal, it.fid);
      if (!anchor || it.evidenceNodeId !== anchor.id) {
        throw new LoopError(
          `对照 attestation 未绑定 ${it.fid} 的现行锚定证据（绑 ${it.evidenceNodeId ?? "无"}，现行锚 ${anchor?.id ?? "无"}）：` +
            `rebind 后复用旧对照/跨 reset 复用不可过门——重新对照并重录（lzy attest comparator --file …）`,
        );
      }
      if ((comparator.at ?? 0) < (anchor.at ?? 0)) {
        throw new LoopError(
          `对照 attestation（${comparator.id}）时点早于所锚证据取证时点（先对照后取证）：重新对照并重录`,
        );
      }
    }
    // ── 豁免收紧（0.1.0 棒B，ADR-0016）：红绿两半是同一断言在改前/改后两态的成对取证。
    // INV-09 缺红不得以补绿收口：锚定绿须有 red_of 配对红或 waived（绿后补录=反向配对
    // 即过，恢复指路在报文）；INV-08 harness 冻结：配对红与绿的 harnessHash 俱在且不等
    // =取证程序不同源，两半不可互证。执法点在对照/锚定/时点检查之后，同受
    // LZY_ABLATE_ATTEST 守卫（ablation 变体 D 五闸门组成随之变化，ADR-0016 记账）。
    const halfById = new Map(dag.nodes.filter((n) => n.kind === "evidence").map((n) => [n.id, n]));
    for (const s of goal.steps) {
      if (s.kind !== "F") continue;
      const anchor = anchoredGreenFor(dag, goal, s.id);
      if (!anchor) continue; // legacy 轨：对照绑定循环已拒，此处不重复执法
      const halves = dag.edges
        .filter((e) => e.type === "red_of" && e.to === anchor.id)
        .map((e) => halfById.get(e.from))
        .filter((n) => n && (n.half === "red" || n.half === "waived"));
      if (halves.length === 0) {
        throw new LoopError(
          `HEAVY 豁免收紧（INV-09）：F 项 ${s.id} 缺红半且无豁免——缺红不得以补绿收口（红绿两半是同一断言在改前/改后两态的成对取证）。` +
            `恢复：lzy evidence red ${s.id} --evidence <改前态失败取证>（绿后补录=反向配对即过）或 lzy evidence waive-red ${s.id} --reason <一行豁免>`,
        );
      }
      for (const h of halves) {
        if (h.half === "red" && h.harnessHash && anchor.harnessHash && h.harnessHash !== anchor.harnessHash) {
          throw new LoopError(
            `HEAVY harness 冻结（INV-08）：F 项 ${s.id} 红绿两半 harness 错配` +
              `（红 ${h.harnessHash.slice(0, 8)}… ≠ 绿 ${anchor.harnessHash.slice(0, 8)}…）——取证程序不同源，两半不可互证。` +
              `恢复：红或绿按同一程序重录（--harness 统一声明）`,
          );
        }
      }
    }
  }
  // ── 第四拒：完整性闸门（P0-A 闭合，v008）——{host}∪subjects 任一根 dirty/missing/git
  // 错即拒，不提供任何绕过 flag（拍板③「无逃生门」）。git spawn 逐根顺序、共享 8s 墙钟
  // 预算（< LOCK_STALE_MS 60s 留余量：ADJ-01 已把 stale 线由 10s 抬到 60_000，注释随改；
  // 单根超时/预算耗尽按 fail-closed 拒）。
  // LZY_ABLATE_INTEGRITY（ADR-0015）：开关开=整循环消融（脏树/缺根/git 错不再拦
  // finish，≈0.0.7 形态的一半；variant-F 与 ATTEST 合成完整 0.0.7 形态）。
  // headTrees 采集声明在开关外：消融态空 Map，attestation 侧走「缺值回退直读」防御分支。
  const gateHeadTrees = new Map();
  if (!ablated("LZY_ABLATE_INTEGRITY")) {
    const gateStart = Date.now();
    for (const root of [cwd, ...(goal.subjects ?? [])]) {
      const remaining = GATE_BUDGET_MS - (Date.now() - gateStart);
      let check;
      if (remaining <= 0) {
        check = { state: "error", detail: `闸门墙钟预算 ${GATE_BUDGET_MS}ms 耗尽（根 ${root} 未检）` };
      } else {
        check = createGit(root).integrity(remaining);
      }
      if (check.headTree) gateHeadTrees.set(root, check.headTree);
      if (check.state === "clean") continue;
      incMetrics(cwd, "finish_reject_dirty");
      const which = root === cwd ? "host" : "subject";
      const advice =
        check.state === "dirty"
          ? `该根有未提交改动：commit 或 stash 后重跑 finish（.lazyzcode/ 账本不计该根脏；先提交再取证，未提交改动不进指纹）。${dirtyPathHint(check.paths)}杂物文件可写进 .gitignore 或移出仓库，不必为它提交；若这不是你的改动，可能是同一工作目录里另一个会话的未提交工作。`
          : check.state === "missing"
            ? `该根不存在/非 git 仓/HEAD 不可解析，不可验收：复原路径，或 lzy loop subject remove <path> 移出集合，或 lzy loop abandon。${check.detail ? `（${check.detail}）` : ""}`
            : `git 调用失败（fail-closed 按拒处理）：修复 git 后重跑 finish。原始报错：${check.detail ?? "未知"}`;
      throw new LoopError(
        `finish 完整性闸门拒绝（${check.state}）：${which} ${root}。${advice}`,
      );
    }
  }
  // ── 窗口竞态复采（ADJ-06，0.0.10）：finish 窗口曾三次采样（verify 指纹/闸门各根
  // 头树/attestation 再读），两次之间另有会话提交可产出自我矛盾的 LOOP_COMPLETE——
  // 闸门后复采复合指纹断言一致，不等=窗口内树变更，拒。
  const fingerprintNow = fingerprintSubjects(cwd, goal.subjects);
  if (fingerprintNow !== fingerprint) {
    incMetrics(cwd, "finish_reject_race");
    throw new LoopError(
      `finish 窗口内工作树变更（闸门时点复采复合指纹与取证时点不一致——另有会话提交）：` +
        `重新核验（lzy loop verify）后重跑 finish`,
    );
  }
  // ── 原子收尾（v008#N6）：先在内存置 done/finishedAt（writer 渲染完成态，报告状态行
  // =done、formatHistory 解析不退化），writer 成功后才 writeGoal 落盘；失败→LoopError
  // （不落盘不置 done，goal 保持 executing，状态文件与报告永不互相说谎）。
  goal.status = "done";
  goal.finishedAt = new Date().toISOString();
  if (typeof writeReport === "function") {
    try {
      writeReport({ cwd, git, goal });
    } catch (e) {
      throw new LoopError(
        `证据包归档失败（finish 未置 done，状态保持 executing）：修复写入失败原因后重跑 finish（或先 lzy loop export 留档）。原始错误：${e?.message ?? e}`,
      );
    }
  }
  // ── 终验 attestation（v009 棒2，§⑪ N5）：LOOP_COMPLETE 的机器证明。写失败同报告
  // 契约（LoopError、状态保持 executing、goal.json 不落 done）。
  let attestation;
  try {
    attestation = writeFinalAttestation(cwd, git, goal, { comparator, fingerprint, dag, headTrees: gateHeadTrees, reportWritten: typeof writeReport === "function" });
  } catch (e) {
    throw new LoopError(
      `终验 attestation 写失败（finish 未置 done，状态保持 executing）：修复写入失败原因后重跑 finish。原始错误：${e?.message ?? e}`,
    );
  }
  // 世系收口（0.1.0 棒B）：本代次落 completed（写序在 goal.json 前——fail-closed 同
  // dag-first：世系写失败=finish 拒、状态保持 executing；done 态重入重 finish 幂等重写）。
  try {
    closeAttempt(cwd, { slug: goal.slug, n: goal.attempt, status: "completed" });
  } catch (e) {
    // ADJ-07（0.2.1 五轮双审·部分成立）：写序「先证后态」为有意设计（done 绝不在
    // LOOP_COMPLETE 落盘前被记录），但本步失败时报告与终验 attestation 已在盘、goal.json
    // 仍 executing——三件表面互相矛盾。报文点名这一中间态与闭合动作（重跑 finish 幂等）。
    throw new LoopError(
      `世系收口失败（finish 未置 done，状态保持 executing）：报告/attestation 已在盘` +
        `（.lazyzcode/evidence/${goal.slug}.report.md · .lazyzcode/attestations/）——` +
        `重跑 lzy loop finish 完成状态提交即可闭合。原始错误：${e?.message ?? e}`,
    );
  }
  writeGoal(cwd, goal);
  return { goal, attestation };
}

// 终验 attestation 落盘（纯写面，校验已在门里）：`.lazyzcode/attestations/<attemptId>.json`，
// tmp+rename 原子写。attemptId=<slug>-<finish 时刻 UTC 紧凑串（秒粒度）>——追加不覆写
// （同 slug 重注册再 finish 天然新 id）；目录在 loop/ 之外=doctor 疤痕巡逻零接触、
// reset 不清（历史证明，同 evidence/ 语义）。
function writeFinalAttestation(cwd, git, goal, { comparator, fingerprint, dag, headTrees = null, reportWritten }) {
  const dir = join(cwd, ".lazyzcode", "attestations");
  mkdirSync(dir, { recursive: true });
  let attemptId = `${goal.slug}-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`;
  // ADJ-07（0.0.10）：同秒二次 finish（done 态重 finish 恢复链）曾静默覆写上一份
  // 机器证明——存在即追加毫秒后缀，追加不覆写。
  if (existsSync(join(dir, `${attemptId}.json`))) {
    attemptId = `${attemptId}-${Date.now()}`;
  }
  const reportRel = `.lazyzcode/evidence/${goal.slug}.report.md`;
  let reportSha = null;
  if (reportWritten) {
    try {
      reportSha = createHash("sha256").update(readFileSync(join(cwd, reportRel))).digest("hex");
    } catch {
      reportSha = null;
    }
  }
  const evidence = goal.steps
    .filter((s) => s.kind === "F" && s.status === "done")
    .map((s) => {
      const gen = s.evidenceSeq ? s.evidenceSeq - 1 : 1;
      const node = findGreenByGeneration(dag, goal.slug, s.id, gen, goal.attempt);
      return { fid: s.id, generation: gen, nodeId: node?.id ?? null, surface: node?.surface ?? null };
    });
  const doc = {
    attemptId,
    at: Date.now(),
    slug: goal.slug,
    title: goal.title,
    tier: goal.tier ?? "light",
    lzyVersion: readLzyVersion(),
    planHash: goal.planHash ?? null,
    // 各根头树复用完整性闸门同源采样（ADJ-13/06：临界段少一轮逐根 git 读取，
    // 且头树与指纹判定同点，机器证明不再自相矛盾）；缺值时回退直读（防御）。
    subjects: [resolve(cwd), ...(goal.subjects ?? [])].map((root) => ({
      root,
      headTreeHash: headTrees?.get(root) ?? createGit(root).headTreeHash(),
    })),
    fingerprint: fingerprint ?? null,
    evidence,
    comparator: comparator
      ? { nodeId: comparator.id, verdict: comparator.verdict, fingerprint: comparator.fingerprint, at: comparator.at ?? null }
      : null,
    report: { path: reportRel, sha256: reportSha },
    finishedAt: goal.finishedAt,
  };
  const p = join(dir, `${attemptId}.json`);
  const tmp = join(dir, `.${attemptId}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, p);
  return { path: `.lazyzcode/attestations/${attemptId}.json`, attemptId };
}

function readLzyVersion() {
  try {
    return JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

// ── 7. 证据包导出：goal 的可审阅档案（评审判决/步骤注记/F 项证据+附件清单）──
// 人在接管前要快速看清「凭什么说做完了」，这就是那份材料（OmO 哲学：接管=失败信号，
// 接管时人需要证据，不是结论）。落 .lazyzcode/evidence/<slug>.report.md，reset 不清它。
// v008#N6 拆分：buildReportLines（纯渲染）+ writeReportFile（tmp 落盘+rename 原子写，
// 支持指定目标路径）+ writeGoalReport（finish 的锁内 writer 回调形态——接收内存中已置
// done 的 goal 对象渲染，不从盘上重读，报告状态行=done）。
// 写盘序注记（ADJ-07，0.2.1 五轮双审·部分成立）：finish 写序「先证后态」为有意设计
// （报告/终验 attestation 先落盘、goal.json 最后提交），失败窗内报告状态行可能与
// goal.json 相反。单独一行注记（不进状态行本身——formatHistory 的状态行解析就绑在
// 该行上），且只在 done 态渲染：写盘序只在「本行说 done」时才有解释力。
const REPORT_STATUS_ORDER_NOTE =
  "（写盘序：LOOP_COMPLETE 证明先于状态提交；若本行 done 而 goal.json 仍 executing，重跑 lzy loop finish 即可闭合）";

function buildReportLines(cwd, git, goal) {
  const done = goal.steps.filter((s) => s.status === "done").length;
  const current = git ? git.headTreeHash() : null;
  const lines = [
    `# 目标循环报告：${goal.slug} — ${goal.title}`,
    "",
    `- 状态 ${goal.status} · 创建 ${goal.createdAt} · 完成 ${goal.finishedAt ?? "—"}`,
    ...(goal.status === "done" ? [REPORT_STATUS_ORDER_NOTE] : []),
    `- 计划 ${goal.planPath ?? "未采纳"} · 评审 ${goal.review ? `${goal.review.verdict}（${goal.review.by}）` : "未评审"}`,
    `- 基线 tree ${(goal.baseTreeHash ?? "未知").slice(0, 10)} · 当前 tree ${(current ?? "未知").slice(0, 10)} · 步骤 ${done}/${goal.steps.length}`,
    "",
    "## 步骤",
  ];
  for (const s of goal.steps) {
    const mark = s.status === "done" ? "✔" : "·";
    lines.push(`- ${mark} ${s.id} [${s.kind}] ${s.title}${s.note ? ` — ${s.note}` : ""}`);
    if (s.evidence) {
      // 指纹化显示面（v008）：新证据显示指纹短码，legacy 证据维持 tree 短码（防「未绑定」回归）。
      const bind = s.evidence.fingerprint
        ? `指纹 ${s.evidence.fingerprint.slice(0, 10)}`
        : `tree ${(s.evidence.treeHash ?? "未绑定").slice(0, 10)}`;
      lines.push(`  - 证据 @ ${bind} · ${s.evidence.at}：${s.evidence.text}`);
      for (const f of s.evidence.files ?? []) {
        lines.push(`  - 附件 \`${f.path}\`（sha256 ${f.sha256.slice(0, 16)}… · ${f.bytes} bytes）`);
      }
    }
  }
  return lines;
}

function writeReportFile(cwd, goal, lines, targetPath) {
  const p = targetPath ?? join(cwd, ".lazyzcode", "evidence", `${goal.slug}.report.md`);
  // 0600（ADJ-18，0.2.1）：证据包含取证原文/附件清单，与账本同权限。
  writeAtomic(p, `${lines.join("\n")}\n`, "report.");
  return { path: relative(cwd, p) };
}

// finish 的 writer 回调形态：用内存中的 goal（已置 done）渲染，不从盘上重读。
export function writeGoalReport(cwd, git, goal) {
  return writeReportFile(cwd, goal, buildReportLines(cwd, git, goal));
}

export function exportReport(cwd, git) {
  const goal = readGoal(cwd);
  if (!goal) throw new LoopError(noGoalMessage(cwd));
  if (goal.steps.length === 0) {
    throw new LoopError(`目标 ${goal.slug} 还没采纳计划，无可导出（先 lzy loop plan）`);
  }
  return writeReportFile(cwd, goal, buildReportLines(cwd, git, goal));
}

export function abandonLoop(cwd, git) {
  requireGoalPreLock(cwd);
  return withLock(cwd, () => doAbandonLoop(cwd, git));
}

function doAbandonLoop(cwd, git) {
  guardFence(cwd);
  const goal = requireActive(cwd);
  const salvage = writeSalvageStub(cwd, goal, git, "abandon 放弃");
  goal.status = "abandoned";
  goal.finishedAt = new Date().toISOString();
  closeAttempt(cwd, { slug: goal.slug, n: goal.attempt, status: "abandoned" });
  writeGoal(cwd, goal);
  return { ...goal, salvage };
}

// ── 交接放行（ADR-0009）──────────────────────────────────────────────────
// 目录级匿名标记：模型收尾前登记交接，Stop 钩子一次性原子消费后放行（不耗续跑预算）。
// 匿名性是特性不是缺陷：模型在 Bash 环境拿不到自己的 sessionId（引擎只注入 hook env），
// 任何要求模型转抄会话身份的设计都在最需要逃逸的时刻制造新的失败面（双审 P1 定案）。

export function handoffPath(cwd) {
  return join(loopDir(cwd), "handoff.json");
}

// ── 放行计数（可观测面）：registered=CLI 登记数、consumed=Stop 侧消费数。
// 目录级匿名（只有计数无会话身份，ADR-0009）；跨 reset 永续（价值在长期观测，
// cleanupLoopResidue 与疤痕巡逻均豁免它）。无锁读-合-写近似计数（≥ 语义）：多写方
// 同窗可丢增量，观测面可接受。契约：本节函数永不抛——计数失败绝不阻断登记/放行主路径。
export function metricsPath(cwd) {
  return join(loopDir(cwd), "metrics.json");
}

export function readMetrics(cwd) {
  try {
    const m = JSON.parse(readFileSync(metricsPath(cwd), "utf8"));
    if (m && typeof m === "object" && !Array.isArray(m)) return m;
  } catch {}
  return null;
}

// 累加/取最大语义的账本写（0.2.2 棒1#N5）：incMetrics 只会 +1，而锁竞争窗要记等待
// **总时长**与**最大等待**。shape=`{add:{field:n}, max:{field:n}}`。沿 incMetrics 全套家法：
// 无锁读-合-写、0600、原子 renameSync、**never-throw**（计数失败绝不阻断主路径）。
// 已知边界（本棒 Known unknowns #2）：无锁读-合-写在并发下可丢增量（「≥ 语义」），而 **max
// 在该语义下非单调安全**——丢增量的时刻恰是拥塞最重的时刻，即仪器盲区与其将被引用的
// 现象正相关。故读数一律按**下限**解读，§⑩-4 结清句须标注该性质。
export function mergeMetrics(cwd, patch) {
  try {
    const m = readMetrics(cwd) ?? {};
    const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    for (const [field, n] of Object.entries(patch?.add ?? {})) {
      m[field] = num(m[field]) + num(n);
    }
    for (const [field, n] of Object.entries(patch?.max ?? {})) {
      m[field] = Math.max(num(m[field]), num(n));
    }
    m.updatedAt = new Date().toISOString();
    const p = metricsPath(cwd);
    mkdirSync(dirname(p), { recursive: true });
    const tmp = join(dirname(p), `.${basename(p)}.${process.pid}.${Date.now()}.tmp`);
    writeFileSync(tmp, `${JSON.stringify(m, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, p);
    return m;
  } catch {
    return null;
  }
}

export function incMetrics(cwd, field) {
  try {
    const m = readMetrics(cwd) ?? {};
    m[field] = (typeof m[field] === "number" && Number.isInteger(m[field]) ? m[field] : 0) + 1;
    m.updatedAt = new Date().toISOString();
    const p = metricsPath(cwd);
    mkdirSync(dirname(p), { recursive: true });
    const tmp = join(dirname(p), `.${basename(p)}.${process.pid}.${Date.now()}.tmp`);
    writeFileSync(tmp, `${JSON.stringify(m, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, p);
    return m;
  } catch {
    return null;
  }
}

// 快照新鲜度上限：没有真实快照的交接不是交接（防滥用防化石——双审 P2 对冲）。
// 2h（plan-v2 Phase 2-5）：交接标记本就期待下个 Stop 即消费，隔夜快照=化石。
export const HANDOFF_SNAPSHOT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

// 交接快照 7 字段 lint（plan-v2 Phase 2-5）：快照内容必须自含续跑全量。标题列表是契约
// 字面量——zw SKILL.md Continuation 节的模板与之逐字节一致（改一处须同步另一处）；
// 脏树清单节承载 git status --porcelain 原文（脏树继承协议，卫生规则④）。
export const HANDOFF_SNAPSHOT_SECTIONS = [
  "## 剩余步骤",
  "## 下一步动作",
  "## 目标与进度",
  "## 脏树清单",
  "## tree hash",
  "## 风险与坑",
  "## 复归指令",
];

// 内容 lint：7 节标题在场且各节至少一行非空正文（裸标题=空壳交接，与缺节同拒）。
// 导出（0.2.0 棒2）：drive 自写交接快照收束前用同一 lint 自检（函数体不变，单一事实源）。
// ADJ-33（0.2.1）：改「按 HANDOFF_SNAPSHOT_SECTIONS 顺序分节 + 标题仅行首匹配」——
// ①旧实现用 indexOf 裸子串找标题，正文里出现 "## " 开头的行（脏树清单节承载
// git status --porcelain 原文，`## notes/foo.md` 这类路径完全合法；剩余步骤节承载
// 计划条目标题）会被当成节界 → 该节被判「空节」→ 快照生成器（drive windDown）被自己的
// 校验器拒绝，恰在必须交回的时刻；②旧实现不查节序，七节任意排列都能过。现语义：标题须
// 行首出现、且按契约顺序（乱序=后面的节找不到=缺节）；重复标题按「该节到下一个节标题」取段。
// 契约字面量不变（HANDOFF_SNAPSHOT_SECTIONS 逐字节同 zw SKILL.md 模板）。
export function lintHandoffSnapshot(content) {
  const missing = [];
  const lines = String(content ?? "").split(/\r?\n/);
  const isSectionHead = (line) => HANDOFF_SNAPSHOT_SECTIONS.some((h) => line.startsWith(h));
  let cursor = 0;
  for (const head of HANDOFF_SNAPSHOT_SECTIONS) {
    let at = -1;
    for (let i = cursor; i < lines.length; i++) {
      if (lines[i].startsWith(head)) {
        at = i;
        break;
      }
    }
    if (at < 0) {
      missing.push(head);
      continue;
    }
    let end = lines.length;
    for (let i = at + 1; i < lines.length; i++) {
      if (isSectionHead(lines[i])) {
        end = i;
        break;
      }
    }
    if (!lines.slice(at + 1, end).some((l) => l.trim())) missing.push(`${head}（空节）`);
    cursor = at + 1;
  }
  return missing;
}

export function handoffGoal(cwd, snapshot, treeHash) {
  requireActive(cwd, "executing"); // planning/已完结目标上登记交接没有语义（Stop 不拉）
  if (typeof snapshot !== "string" || !snapshot.trim()) {
    throw new LoopError(
      "用法：lzy loop handoff --snapshot <快照文件>（先把交接状态写入快照，再登记交接）",
    );
  }
  const snapAbs = resolve(cwd, snapshot.trim());
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(snapAbs).mtimeMs;
  } catch {
    throw new LoopError(`交接快照不存在：${snapAbs}（先写快照再登记，拒绝空壳交接）`);
  }
  if (Date.now() - mtimeMs > HANDOFF_SNAPSHOT_MAX_AGE_MS) {
    throw new LoopError(`交接快照已过期（mtime 超过 2h）：${snapAbs}（更新快照后重新登记）`);
  }
  let content = "";
  try {
    content = readFileSync(snapAbs, "utf8");
  } catch {
    throw new LoopError(`交接快照不可读：${snapAbs}（存在但读不了，拒绝盲登记）`);
  }
  const missing = lintHandoffSnapshot(content);
  if (missing.length > 0) {
    throw new LoopError(
      `交接快照缺强制节：${missing.join("、")}。7 字段模板见 zw SKILL.md Continuation 节` +
        `（脏树清单节须内嵌 git status --porcelain 原文，干净树写（无））`,
    );
  }
  // 写入入锁（评审 R6A-3）：锁外交写与 resetLoop 锁内 cleanupLoopResidue 的 rm handoff.json
  // 交错会留孤儿标记——下一目标首个 Stop 被误放行。锁内重查 executing 保证「goal 在场」
  // 与「标记落盘」同一临界区（对 Stop 侧 unlink 消费的原子性不受影响）。
  return withLock(cwd, () => {
    guardFence(cwd);
    requireActive(cwd, "executing");
    const marker = {
      snapshot: snapAbs,
      treeHash: typeof treeHash === "string" ? treeHash : null,
      requestedAt: new Date().toISOString(),
    };
    const p = handoffPath(cwd);
    const tmp = join(dirname(p), `.${basename(p)}.${process.pid}.${Date.now()}.tmp`);
    mkdirSync(dirname(p), { recursive: true });
    // 0600（ADJ-18，0.2.1）：交接标记与账本同语义（快照路径/头树/请求时刻），曾是唯一
    // 无 mode 的 JSON——与 goal.json 的权限口径拉齐。
    writeFileSync(tmp, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, p); // 原子落盘：与 Stop 侧 unlink 消费的互斥由文件系统原子性保证
    incMetrics(cwd, "registered"); // 永不抛（契约见上）——登记不因计数失败而失败
    return marker;
  });
}

export function resetLoop(cwd, git) {
  return withLock(cwd, () => doResetLoop(cwd, git));
}

const LOOP_TMP_SCAN_DIRS = (cwd) => [
  loopDir(cwd),
  join(loopDir(cwd), "snapshots"),
  join(loopDir(cwd), "salvage"),
];
// approvals/ 与 attestations/ 的 tmp 命名由钩子/写者自定（家族前缀不覆盖），沿用「任何
// .tmp」口径（与 cleanup 全同——观测面与清扫面必须同一判据，否则又造出第三份清单）。
const ANY_TMP_SCAN_DIRS = (cwd) => [
  join(loopDir(cwd), "approvals"),
  join(cwd, ".lazyzcode", "evidence"),
  join(cwd, ".lazyzcode", "attestations"),
];

// 孤儿 tmp 计数（doctor 用）：与 cleanupLoopResidue 同一家族表、同一扫描面（ADJ-13，0.2.1）。
// 旧实现里 doctor 自成两族清单（goal/dag）且只扫 loop/ 顶层——「state ok」可在有孤儿时报干净。
export function countLoopResidueTmp(cwd) {
  let n = 0;
  for (const d of LOOP_TMP_SCAN_DIRS(cwd)) {
    try {
      n += readdirSync(d).filter(isLoopTmpName).length;
    } catch {}
  }
  for (const d of ANY_TMP_SCAN_DIRS(cwd)) {
    try {
      n += readdirSync(d).filter((f) => f.endsWith(".tmp")).length;
    } catch {}
  }
  return n;
}

// 孤儿/残留清理（评审 R2-11）：kill -9 落在 tmp 写入与 rename 之间会留孤儿 .tmp；
// 会话计数器在 goal 清除后也成悬空状态。doctor 的状态卫生与 reset 指引共用此语义。
// 家族表=LOOP_TMP_FAMILIES（模块顶部单一事实源，ADJ-13，0.2.1）：doctor 的孤儿计数
//（countLoopResidueTmp）与本函数同表同扫描面（LOOP_TMP_SCAN_DIRS/ANY_TMP_SCAN_DIRS）——
// 此前 doctor 只数两族、cleanup 四族、metrics 两族谁都管不到。新增常驻账本须登记家族并
// 确认两面覆盖，否则孤儿既不可清也不可见。
function cleanupLoopResidue(cwd) {
  const dir = loopDir(cwd);
  let cleaned = 0;
  const sweep = (d, pred = isLoopTmpName) => {
    let names;
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const f of names) {
      if (!pred(f)) continue;
      try {
        rmSync(join(d, f), { recursive: true, force: true });
        cleaned++;
      } catch {}
    }
  };
  const anyTmp = (f) => f.endsWith(".tmp");
  for (const d of LOOP_TMP_SCAN_DIRS(cwd)) sweep(d);
  for (const d of ANY_TMP_SCAN_DIRS(cwd)) sweep(d, anyTmp);
  try {
    // 会话旗标整目录内容清除（目录本身保留：reset 清内容留目录是既有契约）。
    for (const f of readdirSync(join(dir, "sessions"))) {
      rmSync(join(dir, "sessions", f), { recursive: true, force: true });
      cleaned++;
    }
  } catch {}
  try {
    // 交接标记（ADR-0009）随目标清理：残留会让下一个 executing 目标的首个 Stop 被误放行（评审 P2）。
    rmSync(join(dir, "handoff.json"), { force: true });
  } catch {}
  return cleaned;
}

function doResetLoop(cwd, git) {
  // ADJ-02：reset 是损坏 goal.json 的恢复出口——readGoal 现在对损坏 fail-closed 抛错，
  // reset 必须先容错读取（损坏=当作可清除状态，原文件随 rm 一并消失；先打印读取失败原因）。
  let goal = null;
  let readNote = null;
  try {
    goal = readGoal(cwd);
  } catch (err) {
    readNote = err?.message ?? String(err);
  }
  const cleaned = cleanupLoopResidue(cwd);
  if (!goal) {
    rmSync(goalPath(cwd), { force: true });
    if (cleaned === 0 && !readNote) throw new LoopError("本目录没有目标，无需 reset");
    if (readNote) return { slug: "（目标状态不可读，已清除）", readNote };
    return { slug: "（仅残留状态，已清理）" };
  }
  const salvage = writeSalvageStub(cwd, goal, git, "reset 清除");
  rmSync(goalPath(cwd), { force: true });
  return { ...goal, salvage };
}

// ── 可回收工件（C 面）：终止时盘点残留入存根——接管者跨会话可见，事件打印会随销毁
// 会话的转录一起死，故落盘是本体、打印只是 convenience。git 不可用降级为仅资产指针。──
function salvageDir(cwd) {
  return join(loopDir(cwd), "salvage");
}

export function listSalvageStubs(cwd) {
  try {
    return readdirSync(salvageDir(cwd))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -".md".length));
  } catch {
    return [];
  }
}

// ── 交接快照（ADR-0009 / ADJ-23）：落工作区 `.lazyzcode/loop/handoff/`，属 reset 不清家族
// （下一次唤起要从盘上读精确续跑状态，故 reset 保留内容；见 core/drive.js 的
// authorHandoffSnapshot）。路径原本以字面量抄在 drive 侧，而枚举面（进度信号状态集、
// doctor EXEMPT）需要同一个源——收归此处单点，防两处漂移。──
export function handoffDir(cwd) {
  return join(loopDir(cwd), "handoff");
}

export function listHandoffSnapshots(cwd) {
  try {
    return readdirSync(handoffDir(cwd))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -".md".length));
  } catch {
    return [];
  }
}

// 锁竞争窗读面（0.2.2 棒1#N5）：有样本才出行——无 lock_* 计数时不渲染，免制造噪声
// （metricLine 的 skip 家法同源）。读数取下限：mergeMetrics 是无锁读-合-写近似计数。
function lockLine(m) {
  if (!m || typeof m.lock_acquisitions !== "number") return null;
  return (
    `  锁竞争：获锁 ${m.lock_acquisitions} 次 · 需等待 ${m.lock_waits ?? 0} 次 ·` +
    ` 最长 ${m.lock_wait_ms_max ?? 0}ms · 超时 ${m.lock_timeouts ?? 0} 次（读数取下限）`
  );
}

function salvageLine(cwd) {
  const stubs = listSalvageStubs(cwd);
  if (stubs.length === 0) return null;
  return (
    `  可回收存根 ${stubs.length}：${stubs.join(" ")}` +
    `（先前实例的工件盘点在 .lazyzcode/loop/salvage/，接管/重立前先读）`
  );
}

function writeSalvageStub(cwd, goal, git, reason) {
  const dirty = git ? git.porcelainPaths() : null;
  const commits = git ? git.commitSubjects(`Goal: ${goal.slug}#`) : null;
  const lines = [
    `# 可回收工件存根 — ${goal.slug}`,
    "",
    `目标循环已${reason}（${new Date().toISOString()}）。接管者从这里开始：`,
    "",
    "## 未提交改动（.lazyzcode/ 自身不计）",
    ...((dirty ?? []).length ? dirty.map((p) => `- ${p}`) : ["- 无"]),
    "",
    `## 带本目标尾注的提交（Goal: ${goal.slug}#）`,
    ...((commits ?? []).length ? commits.map((c) => `- ${c}`) : ["- 无"]),
    "",
    "## 既有资产指针",
    `- 计划：.lazyzcode/plans/${goal.slug}.md（reset/abandon 不删除，PASS 评审文本可复用重采纳）`,
    ...(goal.planHash
      ? [`- 计划快照：.lazyzcode/loop/snapshots/${goal.slug}.md（采纳时点不可变副本，sha256 ${goal.planHash.slice(0, 10)}…，reset 不清）`]
      : []),
    `- 证据包：.lazyzcode/evidence/${goal.slug}.report.md（finish 归档，reset 不清）`,
    "",
  ];
  // 原子写（ADJ-18，0.2.1）：本存根曾是全文件唯一的裸写——写入中断即留半截 salvage
  // 存根，而它正是接管者读的审计材料；tmp 家族 report. 前缀覆盖（salvage 与报告同形
  // 命名空间，清扫面见 cleanupLoopResidue 的 evidence/ 扫描）。
  const p = join(salvageDir(cwd), `${goal.slug}.md`);
  writeAtomic(p, lines.join("\n"), "report.");
  return { path: relative(cwd, p), dirty: dirty?.length ?? 0, commits: commits?.length ?? 0 };
}

// ── 展示 ────────────────────────────────────────────────────────────────────
// 会话旗标扫描（ADR-0004 读面）：认领谓词=文件含 claimedAt（纯振数文件不算认领）；
// stuck=显式 true（原地无进展两振停拉标记）。目录缺失/文件损坏一律静默跳过。
// 认领 TTL（plan-v2 Phase 2-5）：引擎无 SessionEnd 事件，死亡会话的认领以 48h 时效退役——
// 过期不计入认领集（Stop 资格制：空集=无人可拉，ADR-0004 修正案四），文件原地保留（重认领自然覆写，
// doctor 过期计数可见）。canonical 常量；plugin/hooks/hook-lib.js 持自包含同形副本。
export const CLAIM_TTL_MS = 48 * 60 * 60 * 1000;

export function scanSessionFlags(cwd) {
  const claims = [];
  const stuck = [];
  const expired = []; // 认领 TTL（plan-v2 Phase 2-5）：claimedAt 超 48h 的死亡会话认领
  const future = []; // 越界时间戳（ADJ-14，0.2.1）：claimedAt 在未来=异常标记，按不新鲜处置
  let names;
  try {
    names = readdirSync(join(loopDir(cwd), "sessions"));
  } catch {
    return { claims, stuck, expired, future };
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue; // 连 .lock-<sid> 目录与 .pid.tmp 一起排除
    try {
      const raw = JSON.parse(readFileSync(join(loopDir(cwd), "sessions", name), "utf8"));
      if (raw && typeof raw === "object") {
        const sid = name.slice(0, -".json".length);
        if (typeof raw.claimedAt === "string" && raw.claimedAt) {
          const at = Date.parse(raw.claimedAt);
          const now = Date.now();
          if (Number.isFinite(at) && at > now) future.push(sid);
          else if (Number.isFinite(at) && now - at > CLAIM_TTL_MS) expired.push(sid);
          else claims.push(sid);
        }
        if (raw.stuck === true) stuck.push(sid);
      }
    } catch {
      // 损坏文件跳过
    }
  }
  return { claims, stuck, expired, future };
}

export function formatStatus(cwd, git) {
  const goal = readGoal(cwd);
  const stubLine = salvageLine(cwd); // 无 goal/有 goal 两分支均渲染（C 面；reset 后无 goal 恰是回收主时刻）
  if (!goal) {
    let out = stubLine ? `${noGoalMessage(cwd)}\n${stubLine}` : noGoalMessage(cwd);
    const m = readMetrics(cwd); // 放行计数跨 reset 永续——无 goal 恰是回看使用率的主时刻
    if (m) {
      out += `\n  放行计数：登记 ${m.registered ?? 0} · 消费 ${m.consumed ?? 0}（差值=reset 清理/坏标记，非损失）`;
      const lock = lockLine(m);
      if (lock) out += `\n${lock}`;
    }
    return out;
  }
  const done = goal.steps.filter((s) => s.status === "done");
  const lines = [
    `目标 ${goal.slug} — ${goal.title}`,
    `  状态 ${goal.status} · 步骤 ${done.length}/${goal.steps.length} · 计划 ${goal.planPath ?? "未采纳"}`,
  ];
  // 快照在场+篡改复核读面（v008#N7）：planHash 缺席（0.0.8 前采纳的 goal）=静默不查；
  // 在场而快照缺席或 sha256 不符→warn（采纳后篡改可见；防本体 goal 中途误警）。
  if (goal.planHash) {
    let snapState = "复核一致";
    try {
      const snap = readFileSync(join(loopDir(cwd), "snapshots", `${goal.slug}.md`));
      if (createHash("sha256").update(snap).digest("hex") !== goal.planHash) {
        snapState = "⚠ sha256 不符（疑篡改）";
      }
    } catch {
      snapState = "⚠ 快照缺席";
    }
    lines.push(`  快照 ${goal.planHash.slice(0, 10)} · ${snapState}`);
  }
  // tier/subjects 读面（v008#N8）：缺键容忍（0.0.8 前 goal 无 tier/subjects 键按 light/空集）。
  lines.push(`  tier ${goal.tier ?? "light"} · risk ${goal.risk ?? "low"} · subjects ${(goal.subjects ?? []).length} 项`);
  // 工作树脏净读数（ADJ-42，0.0.10）：SKILL 教「先读 status 的 dirt 再领 finish」——
  // 把该读面做真：脏列前 3 路径+药方（finish 完整性闸门会拦）。
  if (git) {
    const it = createGit(cwd).integrity(GATE_BUDGET_MS); // 同源：与 finish 闸门共享预算常量
    if (it.state === "clean") lines.push(`  工作树 清洁（tree ${(it.headTree ?? "").slice(0, 10)}）`);
    else if (it.state === "dirty") {
      const sample = (it.paths ?? []).slice(0, 3).join(" ");
      const more = (it.paths?.length ?? 0) > 3 ? ` 等 ${it.paths.length} 处` : "";
      lines.push(`  工作树 脏（${sample}${more}）——finish 完整性闸门会拦：commit 或 stash 后再 finish`);
    } else if (it.state === "missing") {
      lines.push(
        `  工作树 missing（${it.detail ?? "git 不可用"}）——宿主须为 git 仓：git init 并完成首次提交后证据时效方可生效（ADR-0019）`,
      );
    } else lines.push(`  工作树 ${it.state}（${it.detail ?? "git 不可用"}）`);
  }
  const next = nextStep(goal);
  if (next) {
    // 下一步标注（评审 R1-A4）：指向的 pending 步被认领/阻塞时如实点名，不再裸指。
    let note = "";
    if (isClaimFresh(next)) note = "（已认领）";
    else {
      const undone = blockedBy(next, goal);
      if (undone.length > 0) note = `（被阻塞：${undone.join(",")}）`;
    }
    lines.push(`  下一步 → ${next.id} [${next.kind}] ${next.title}${note}`);
  }
  if (goal.steps.length > 0) {
    for (const s of goal.steps) {
      const mark = s.status === "done" ? "✔" : "·";
      // 步级认领/阻塞读面（决策 #21）：done 不标注（认领已自清）；blocked 只列未完成依赖。
      let flag = "";
      if (s.status !== "done") {
        if (claimTimeAnomaly(s)) flag = " [claim:时间戳越界（未来时刻）]";
        else if (isClaimFresh(s)) flag = " [claimed]";
        else {
          const undone = blockedBy(s, goal);
          if (undone.length > 0) flag = ` [blocked: ${undone.join(",")}]`;
        }
      }
      const evBind = s.evidence?.fingerprint
        ? `指纹@${s.evidence.fingerprint.slice(0, 10)}`
        : `证据@${(s.evidence?.treeHash ?? "未绑定").slice(0, 10)}`;
      const ev =
        s.kind === "F" && s.evidence
          ? ` ${evBind}` + (s.evidence.files?.length ? ` · 附件 ${s.evidence.files.length}` : "")
          : "";
      lines.push(`  ${mark} ${s.id.padEnd(4)} [${s.kind}] ${s.title}${flag}${ev}`);
    }
  }
  if (goal.status === "executing") {
    const flags = scanSessionFlags(cwd);
    if (flags.claims.length > 0) {
      lines.push(`  认领 ${flags.claims.length}：${flags.claims.join(" ")}（仅认领会话会被 Stop 拉回）`);
    } else {
      lines.push("  认领 0（资格制：无人会被拉回；参与会话发「zw 继续」即认领接管）");
    }
    const claimable = claimableSteps(goal);
    if (claimable.length > 0) {
      lines.push(
        `  可认领 ${claimable.length}：${claimable.map((s) => s.id).join(" ")}（lzy loop claim <id> 占步，多工人互斥 48h）`,
      );
    }
    if (flags.stuck.length > 0) {
      lines.push(`  ⚠ stuck ${flags.stuck.length}：${flags.stuck.join(" ")}（原地无进展两振停拉，推进步骤即自愈）`);
    }
    if (flags.future.length > 0) {
      // 越界时间戳告警（ADJ-14，0.2.1）：时钟回拨/手改 claimedAt——已按不新鲜处置（不占步、
      // 不进拉回资格），此处只作可见性提示（warn-only，不翻退出码）。
      lines.push(
        `  ⚠ 认领时间戳越界（未来时刻）${flags.future.length} 个：${flags.future.join(" ")}（时钟回拨或手改 claimedAt；已按不新鲜处置）`,
      );
    }
    try {
      // 交接标记读面（ADR-0009）：在场=下个 Stop 将消费并放行（一次性）。
      const marker = JSON.parse(readFileSync(handoffPath(cwd), "utf8"));
      lines.push(`  ⚠ 交接标记在场（快照 ${marker.snapshot ?? "?"}）——下个 Stop 将放行`);
    } catch {} // 无标记=常态，静默
  }
  if (stubLine) lines.push(stubLine);
  const metrics = readMetrics(cwd); // 放行计数（可观测面，跨 reset 永续）
  if (metrics) {
    lines.push(
      `  放行计数：登记 ${metrics.registered ?? 0} · 消费 ${metrics.consumed ?? 0}（差值=reset 清理/坏标记，非损失）`,
    );
    const lock = lockLine(metrics);
    if (lock) lines.push(lock);
  }
  if (git && (goal.status === "executing" || goal.status === "done")) {
    // ADJ-09（0.2.1）：本段曾裸调 verifyEvidence（loadDag DagError / 账本-goal 分歧 LoopError
    // 原样上抛）——损账本时 status 整条失败 exit 1，而 status 恰是用户恢复时的第一落点。
    // never-throw 读面家族（formatRepoList/formatHistory/formatAttempts）同款：单项降级，
    // 其余状态照常渲染（原因自带恢复指路——DagError 文案含备份/重建步骤）。
    try {
      const { current, stale, unbound } = verifyEvidence(cwd, git);
      const fDone = goal.steps.filter((s) => s.kind === "F" && s.status === "done");
      const freshCount = fDone.length - stale.length - unbound.length;
      lines.push(`  tree ${(current ?? "未知").slice(0, 10)}`);
      lines.push(
        `  证据时效：新鲜 ${freshCount} · 过期 ${stale.length} · 未绑定 ${unbound.length}` +
          (stale.length + unbound.length > 0 ? "（lzy loop finish 会被拦）" : ""),
      );
    } catch (err) {
      lines.push(
        `  ⚠ 证据时效读取失败：${err?.message ?? err}（其余状态照常；修好账本后重跑 lzy loop status）`,
      );
    }
  }
  return lines.join("\n");
}

// ── 跨仓目标清单（只读诊断）：扫锚目录一级子目录（默认 dirname(cwd)，含 cwd 自身）
// 各仓的循环状态。读面永不抛（对齐 loop status 姿态）；每仓独立 try/catch——一个版本
// 不符/损坏的仓不炸全局清单。ADR-0006 严格就地语义约束的是写面（goal 解析不 walk-up），
// 本命令是只读旁视，不触碰当前目标解析。
const REPO_STATUS_RANK = { executing: 0, planning: 1, done: 2 };

export function listRepos(cwd, rootOverride) {
  const anchor = rootOverride ? resolve(rootOverride) : dirname(cwd);
  let entries;
  try {
    entries = readdirSync(anchor, { withFileTypes: true });
  } catch {
    return { anchor, repos: [] }; // 锚不可读/不存在 = 空集
  }
  const repos = [];
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
    const repo = join(anchor, ent.name);
    const row = { repo: ent.name, path: repo, slug: null, status: null, error: null };
    try {
      const goal = readGoal(repo);
      if (!goal) continue; // 无循环状态=空仓，不进清单（防大目录全量噪音）
      row.slug = goal.slug;
      row.status = goal.status;
      const steps = Array.isArray(goal.steps) ? goal.steps : [];
      row.stepsDone = steps.filter((s) => s?.status === "done").length;
      row.stepsTotal = steps.length;
      const flags = scanSessionFlags(repo);
      row.claims = flags.claims.length;
      row.stuck = flags.stuck.length;
      row.salvage = listSalvageStubs(repo).length;
      try {
        row.ageMs = Math.max(0, Date.now() - statSync(goalPath(repo)).mtimeMs);
      } catch {
        row.ageMs = null;
      }
    } catch (err) {
      row.error = err instanceof LoopError ? "版本不符" : "读取失败"; // 单仓损坏不炸全局
    }
    repos.push(row);
  }
  repos.sort((a, b) => {
    const ra = REPO_STATUS_RANK[a.status] ?? 3;
    const rb = REPO_STATUS_RANK[b.status] ?? 3;
    if (ra !== rb) return ra - rb;
    return (b.ageMs ?? 0) - (a.ageMs ?? 0); // 同组内最近活跃在前
  });
  return { anchor, repos };
}

function humanAge(ms) {
  if (ms === null || ms === undefined) return "未知";
  if (ms < 60_000) return "刚刚";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} 分前`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} 小时前`;
  return `${Math.floor(ms / 86_400_000)} 天前`;
}

export function formatRepoList(cwd, rootOverride) {
  const { anchor, repos } = listRepos(cwd, rootOverride);
  const head =
    `跨仓目标清单（锚 ${anchor}，扫一级子目录；只读诊断）`;
  if (repos.length === 0) {
    return `${head}\n  （锚下没有仓持有 .lazyzcode/loop/goal.json）`;
  }
  const lines = [head];
  const nameW = Math.max(...repos.map((r) => r.repo.length), 4);
  const statusW = Math.max(...repos.map((r) => (r.status ?? "？").length), 7);
  for (const r of repos) {
    if (r.error) {
      lines.push(`  ${r.repo.padEnd(nameW)}  ${r.error}（goal.json 无法解析，lzy loop reset 可清除）`);
      continue;
    }
    const flags = [r.claims > 0 ? `认领 ${r.claims}` : null, r.stuck > 0 ? `stuck ${r.stuck}` : null]
      .filter(Boolean)
      .join("·");
    const extras = [
      (r.stepsTotal > 0 ? `${r.stepsDone}/${r.stepsTotal}` : "-").padStart(5),
      humanAge(r.ageMs),
      flags || "—",
      r.salvage > 0 ? `存根 ${r.salvage}` : "",
    ]
      .filter(Boolean)
      .join("  ");
    lines.push(
      `  ${r.repo.padEnd(nameW)}  ${(r.status ?? "").padEnd(statusW)}  ${extras}  ${r.slug}`,
    );
  }
  lines.push("  认领/stuck=会话旗标数 · 存根=可回收工件存根 · 相对时间=goal.json 最后写入距今");
  return lines.join("\n");
}

// ── 目标谱系读面（pisper-absorption#N4，只读）：证据包 ∪ salvage 存根 ∪ git 尾注三源并集。
// 本模块保持零 spawn：git 面由调用方传入 createGit(cwd) 的 trailersBySlug()（null=无 git 面降级）。
// 解析容错：报告无「状态」行/存根节缺失都降级为在场计数，绝不 throw（never-throw 读面同 formatRepoList）。

function evidenceReports(cwd) {
  const dir = join(cwd, ".lazyzcode", "evidence");
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".report.md"));
  } catch {
    return [];
  }
  const reports = [];
  for (const f of files) {
    const slug = f.replace(/\.report\.md$/, "");
    try {
      const head = readFileSync(join(dir, f), "utf8").slice(0, 2000);
      const m = head.match(/- 状态 (\S+) · 创建 ([^·]+?) · 完成 ([^\n]+?)(?:\n|$)/);
      reports.push({ slug, status: m?.[1] ?? null, finishedAt: m?.[3]?.trim() ?? null });
    } catch {
      reports.push({ slug, status: null, finishedAt: null });
    }
  }
  return reports;
}

function salvageStubs(cwd) {
  const dir = join(loopDir(cwd), "salvage");
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  const stubs = [];
  for (const f of files) {
    const row = { slug: f.replace(/\.md$/, ""), resetAt: null, dirty: 0, commits: 0 };
    try {
      const text = readFileSync(join(dir, f), "utf8");
      row.slug = text.match(/^# 可回收工件存根 — (\S+)/m)?.[1] ?? row.slug;
      row.resetAt = text.match(/清除（([0-9T:.\-Z]+)）/)?.[1] ?? null;
      let cur = null;
      for (const line of text.split(/\r?\n/)) {
        if (line.startsWith("## ")) {
          cur = /未提交改动/.test(line) ? "dirty" : /尾注的提交/.test(line) ? "commits" : null;
        } else if (cur && line.startsWith("- ")) {
          row[cur] += 1;
        }
      }
    } catch {}
    stubs.push(row);
  }
  return stubs;
}

export function formatHistory(cwd, git) {
  const rows = new Map();
  const touch = (slug) => {
    if (!rows.has(slug))
      rows.set(slug, { slug, status: null, finishedAt: null, commits: 0, lastCommitAt: null, report: false, salvage: null });
    return rows.get(slug);
  };
  for (const r of evidenceReports(cwd)) {
    const row = touch(r.slug);
    row.report = true;
    row.status = r.status;
    row.finishedAt = r.finishedAt;
  }
  for (const s of salvageStubs(cwd)) {
    const row = touch(s.slug);
    row.salvage = s;
    if (!row.status) row.status = "已回收";
  }
  const trailers = typeof git?.trailersBySlug === "function" ? git.trailersBySlug() : null;
  if (trailers) {
    for (const [slug, t] of trailers) {
      const row = touch(slug);
      row.commits = t.commits;
      row.lastCommitAt = t.lastAt;
      if (!row.status) row.status = "仅尾注";
    }
  }
  const head = `目标谱系（本仓证据包 ∪ salvage 存根 ∪ git 尾注；只读）`;
  const list = [...rows.values()];
  if (list.length === 0) {
    return `${head}\n  （没有历史目标：本仓尚无证据包/salvage 存根/带 Goal: 尾注的提交）`;
  }
  const lastAt = (r) => [r.finishedAt, r.salvage?.resetAt, r.lastCommitAt].filter(Boolean).sort().pop() ?? "";
  list.sort((a, b) => (lastAt(b) || "").localeCompare(lastAt(a) || ""));
  const slugW = Math.max(...list.map((r) => r.slug.length), 4);
  const statusW = Math.max(...list.map((r) => (r.status ?? "？").length), 4);
  const lines = [head];
  for (const r of list) {
    const extras = [
      (r.commits > 0 ? `${r.commits} 提交` : "—").padStart(7),
      r.report ? "证据包✓" : "——",
      r.salvage ? `存根✓${r.salvage.dirty > 0 ? `(未提交 ${r.salvage.dirty})` : ""}` : "——",
      (lastAt(r) || "未知").slice(0, 10),
    ].join("  ");
    lines.push(`  ${r.slug.padEnd(slugW)}  ${(r.status ?? "？").padEnd(statusW)}  ${extras}`);
  }
  lines.push("  状态取证据包报告；仅存根=已回收；仅尾注=账本有提交但本仓无归档。日期=最近活动（完成/清除/末次尾注提交）");
  return lines.join("\n");
}
