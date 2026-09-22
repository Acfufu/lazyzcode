// runtime 运行时账本（0.2.0 棒1，ADR-0020）：无人值守运行时的机器地基——运行级认领
// （lease，分钟级+心跳+结束即释放，区别于步级 claim 的 48h 匿名互斥）、防伪令牌
// （fencing，单调递增计数器+写路径校验，失效=已被接管→停手不写）、运行预算（budget，
// 墙钟+waterline 积分双硬顶，超顶拒=drive 须干净收束）。账本落
// `.lazyzcode/loop/runtime.json` 跨 reset 常驻（同 dag.json/attempt.json 语义），纪律沿
// attempt.js 全套：原子写 tmp+rename 0o600、载荷 sha256 校验和、读 fail-closed 仅
// ENOENT=缺席、写护栏拒单调性回退。匿名立场（ADR-0009）：lease 只有不透明 handle=
// fence 令牌，绝不存 sessionId。本模块零 spawn、全部同步；调用方写路径须持 withLock。
// fence 执法边界（ADR-0020 已知边界四项之一）：opt-in 申报制——不带 fence 的调用
// （交互人类）恒放行；带 fence 的调用（drive 派生工人）必须与现行租约相符。钩子侧写面、
// resetLoop、runtime.json 自身写者（budget init/spend）不在本守卫面——边界逐项入 ADR。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { WATERLINE_POINTS } from "./cost.js";

export const RUNTIME_VERSION = 1;
export const RUNTIME_FILE = "runtime.json";
// lease TTL 缺省 15min（分钟级；heartbeat 续期；--ttl-ms 可覆盖）。
export const DEFAULT_LEASE_TTL_MS = 15 * 60_000;
// drive 预算缺省（定标+env 覆盖沿 waterline 先例）：**墙钟=每-run 记账** 30min（低于闲时
// 车道外生上限 180min）；**积分=账号 5h 滚动水位阈值**（ADJ-21，0.2.1 五轮双审·成立：
// 该轴判据是 rollingWaterlinePoints ≥ 本值、读数缺席即不执法，不是本 run 消费累计）缺省
// 400 = 水位 1600 的四分之一（相对账号水位而非相对本 run 消耗）保守缺省，实测后调。
export const DEFAULT_DRIVE_WALLCLOCK_MS = 30 * 60_000;
export const DEFAULT_DRIVE_POINTS = 400;

export class RuntimeError extends Error {}

function runtimePath(cwd) {
  return join(cwd, ".lazyzcode", "loop", RUNTIME_FILE);
}

export function runtimeFilePath(cwd) {
  return runtimePath(cwd);
}

// 校验和覆盖业务载荷（键序即写入序，round-trip 稳定）。
function checksumOf(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

const RECOVERY =
  `恢复：先备份并人工抢救需要保留的租约/预算记录（丢失只损失运行时记账，不影响 goal/dag/attempt ` +
  `权威面），然后删除该文件重建（下次 lease acquire 将按新账本重建落盘）`;

function freshState() {
  return {
    runtimeVersion: RUNTIME_VERSION,
    fenceCounter: 0,
    activeLease: null,
    budget: null,
  };
}

function assertShape(state, p) {
  if (!Number.isInteger(state.fenceCounter) || state.fenceCounter < 0) {
    throw new RuntimeError(`runtime 账本形状畸形（fenceCounter 须为非负整数）：${p}。${RECOVERY}`);
  }
  if (state.activeLease != null) {
    const l = state.activeLease;
    if (
      !Number.isInteger(l.fence) ||
      typeof l.acquiredAt !== "string" ||
      typeof l.heartbeatAt !== "string" ||
      !Number.isInteger(l.expiresAtMs)
    ) {
      throw new RuntimeError(
        `runtime 账本形状畸形（activeLease 须 {fence: 整数, acquiredAt, heartbeatAt, expiresAtMs}）：${p}。${RECOVERY}`,
      );
    }
  }
  if (state.budget != null) {
    const b = state.budget;
    if (
      !Number.isInteger(b.wallClockBudgetMs) ||
      b.wallClockBudgetMs <= 0 ||
      !Number.isFinite(b.pointsBudget) ||
      b.pointsBudget <= 0 ||
      !Number.isFinite(b.spentMs) ||
      b.spentMs < 0 ||
      !Number.isFinite(b.spentPoints) ||
      b.spentPoints < 0
    ) {
      throw new RuntimeError(
        `runtime 账本形状畸形（budget 须 {wallClockBudgetMs>0, pointsBudget>0, spentMs>=0, spentPoints>=0}）：${p}。${RECOVERY}`,
      );
    }
  }
}

function normalize(state) {
  return {
    runtimeVersion: state.runtimeVersion,
    fenceCounter: state.fenceCounter,
    activeLease: state.activeLease ?? null,
    budget: state.budget ?? null,
  };
}

// 读账本：缺席（仅 ENOENT）=null（尚无运行时活动≠空账本）；其余读失败/解析失败/
// 校验和不符/版本不识别/形状畸形一律 RuntimeError 拒（ADJ-01 家法：不可读被静默当
// 缺席时，下一写命令会整文件覆写）。
export function loadRuntime(cwd) {
  const p = runtimePath(cwd);
  let text;
  try {
    text = readFileSync(p, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw Object.assign(
      new RuntimeError(`runtime 账本不可读（${err?.code ?? err?.message ?? err}）：${p}。${RECOVERY}`),
      { code: "RUNTIME_IO" }, // ADJ-19（v023 双审）：drive 段界心跳的 I/O 族分派判据
    );
  }
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new RuntimeError(`runtime 账本损坏（JSON 解析失败）：${p}。${RECOVERY}`);
  }
  const { checksum, ...rest } = obj ?? {};
  const payload = normalize(rest);
  if (checksum !== checksumOf(payload)) {
    throw new RuntimeError(`runtime 账本校验和不符（内容与落盘时态不一致）：${p}。${RECOVERY}`);
  }
  if (payload.runtimeVersion !== RUNTIME_VERSION) {
    throw new RuntimeError(
      `runtime 账本版本不兼容（盘上 v${payload.runtimeVersion}，本 lzy 期望 v${RUNTIME_VERSION}）：${p}。${RECOVERY}`,
    );
  }
  assertShape(payload, p);
  return payload;
}

// 写账本：原子写家法同 saveDag/saveAttempts（tmp→rename，0o600）；tmp 命名须登记进
// cleanupLoopResidue 的 .runtime.json.*.tmp 家族。写护栏：盘上 fenceCounter 高于本次
// 写入=单调性回退（防误传旧态整文件覆写发号器），拒绝落盘。调用方须持 withLock。
export function saveRuntime(cwd, state) {
  const p = runtimePath(cwd);
  let disk = null;
  try {
    disk = loadRuntime(cwd);
  } catch (err) {
    throw new RuntimeError(`${err.message}\n写护栏拒绝落盘（不覆写不可读账本）`);
  }
  const incoming = normalize(state);
  if (disk && incoming.fenceCounter < disk.fenceCounter) {
    throw new RuntimeError(
      `runtime 写护栏：本次写入 fenceCounter（${incoming.fenceCounter}）低于盘上（${disk.fenceCounter}），` +
        `单调发号器不可回退：${p}。重跑当前命令以重新加载现值`,
    );
  }
  mkdirSync(dirname(p), { recursive: true });
  const out = { ...incoming, checksum: checksumOf(incoming) };
  const tmp = join(dirname(p), `.${basename(p)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, p);
}

function leaseActive(lease, now = Date.now()) {
  return lease != null && lease.expiresAtMs > now;
}

// 持租者活性探测（ADJ-32，0.2.1 五轮双审）：SIGKILL 的 drive 留下活性租约，后续每次
// 唤起被拒且不给 handoff，恢复=人工删文件。同机 pid 存活可判（ESRCH=已死）；容器/pid 复用
// 等不确定情形按「存活」处理（保守侧=继续拒，TTL 兜底），故只用于报错文案与 reclaim 出口。
function holderPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null; // 旧格式无 pid=不可判
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "ESRCH" ? false : true;
  }
}

// 运行级认领：活跃未过期租约在场=拒（单运行时互斥）；否则发号新 fence（单调 +1）
// 并落租约。ttlMs ≤0 视为缺省。slug=本租约绑定的目标（ADJ-12：跨 reset 僵尸写收窄）。
export function acquireLease(cwd, { ttlMs, slug = null } = {}) {
  const ttl = Number.isInteger(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_LEASE_TTL_MS;
  const state = loadRuntime(cwd) ?? freshState();
  if (leaseActive(state.activeLease)) {
    const until = new Date(state.activeLease.expiresAtMs).toISOString();
    const alive = holderPidAlive(state.activeLease.hostPid);
    const zombieNote = alive === false
      ? `持租进程 pid ${state.activeLease.hostPid} 已不存在（僵尸租约）——回收：lzy loop lease reclaim`
      : `等待其 release/过期，或确认为僵尸残留后 lzy loop lease reclaim（或人工删除 ${runtimeFilePath(cwd)}）`;
    throw new RuntimeError(
      `另一运行时持租（fence ${state.activeLease.fence}，至 ${until}）——单运行时互斥；${zombieNote}`,
    );
  }
  const now = Date.now();
  // ADJ-35（v023 双审）：fenceCounter 归零（人工删 runtime.json 的文档化恢复路径）会让
  // 新 run 重发已用过的 fence——同 `<fence>:seg-<n>` 段标撞上盘面残留的 segment.json /
  // h3r-hit.json，一段一步门误拒首步（fail-safe 方向、下段自愈，但白耗一段）。凡盘面
  // 还有段标残留而 counter 已归零，即以时间派生高位重基（只向上，单调性保持）；无残留
  // 的常规路径不触发（fence 从 1 起的既有语义与全部契约钉不变）。标记名与 loop.js/
  // drive.js 保持一致，勿单方改。
  if (!(state.fenceCounter > 0)) {
    const ld = dirname(runtimePath(cwd));
    if (existsSync(join(ld, "segment.json")) || existsSync(join(ld, "h3r-hit.json"))) {
      state.fenceCounter = Math.floor(now / 60_000);
    }
  }
  state.fenceCounter += 1;
  state.activeLease = {
    fence: state.fenceCounter,
    slug: typeof slug === "string" && slug !== "" ? slug : null,
    hostPid: process.pid,
    acquiredAt: new Date(now).toISOString(),
    heartbeatAt: new Date(now).toISOString(),
    expiresAtMs: now + ttl,
  };
  saveRuntime(cwd, state);
  return state.activeLease;
}

// 僵尸租约回收出口（ADJ-32）：持有者 pid 可判且已死=直接回收；不可判或仍活=须 --force
// （人工确认为僵尸后行使）；无活跃租约=幂等 no-op。fenceCounter 不回退（单调性保持）。
export function reclaimLease(cwd, { force = false } = {}) {
  const state = loadRuntime(cwd) ?? freshState();
  if (!leaseActive(state.activeLease)) return { reclaimed: false, reason: "无活跃租约" };
  const alive = holderPidAlive(state.activeLease.hostPid);
  if (alive !== false && !force) {
    throw new RuntimeError(
      `回收拒：持租进程 ${alive === true ? `pid ${state.activeLease.hostPid} 仍存活` : "活性不可判（旧格式租约）"}——` +
        `确认对方真的停手后用 lzy loop lease reclaim --force，或等待 TTL 过期`,
    );
  }
  const fence = state.activeLease.fence;
  state.activeLease = null;
  saveRuntime(cwd, state);
  return { reclaimed: true, fence, forced: alive !== false };
}

// 心跳续期：fence 不符/租约已过期= fail-closed 拒（已被接管或死租——工人须停手）。
// 两拒均打 LEASE_TAKEN 码（ADJ-19，v023 双审）：drive 段界心跳据此与存储 I/O 族分派
// （接管=不写交接 skipHandoff；I/O=带快照收束+回收指引）。loadRuntime 的不可读侧打
// RUNTIME_IO 码（下同）。
export function heartbeatLease(cwd, fence, { ttlMs } = {}) {
  const ttl = Number.isInteger(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_LEASE_TTL_MS;
  const state = loadRuntime(cwd) ?? freshState();
  if (!leaseActive(state.activeLease)) {
    throw Object.assign(
      new RuntimeError(
        "心跳拒：无活跃租约（已释放或过期）——你已被接管或租约已死，立即停手不写（fencing 语义）",
      ),
      { code: "LEASE_TAKEN" },
    );
  }
  if (state.activeLease.fence !== fence) {
    throw Object.assign(
      new RuntimeError(
        `心跳拒：fence ${fence} 非现行（现行 ${state.activeLease.fence}）——你已被接管，立即停手不写（fencing 语义）`,
      ),
      { code: "LEASE_TAKEN" },
    );
  }
  state.activeLease.heartbeatAt = new Date().toISOString();
  state.activeLease.expiresAtMs = Date.now() + ttl;
  saveRuntime(cwd, state);
  return state.activeLease;
}

// 释放：fence 不符=拒（防误释他人租约）；无活跃租约=幂等 no-op。
export function releaseLease(cwd, fence) {
  const state = loadRuntime(cwd) ?? freshState();
  if (!leaseActive(state.activeLease)) return { released: false };
  if (state.activeLease.fence !== fence) {
    throw new RuntimeError(
      `释放拒：fence ${fence} 非现行（现行 ${state.activeLease.fence}）——不可释放他人的租约`,
    );
  }
  state.activeLease = null;
  saveRuntime(cwd, state);
  return { released: true };
}

// fence 写路径守卫的共享谓词（core/loop.js 各写入口在 withLock 临界区内调用）：
// fence 缺席=未申报（交互人类）→放行；fence 在场（drive 派生工人）→必须与现行活跃
// 租约相符，否则=已被接管/租约已死，拒（停手不写，fencing 语义）。runtime.json 缺席
// 时带 fence 的调用同样拒（无租约在册=申报失真，不静默放行）。
// ADJ-12（0.2.1 五轮双审）：租约绑目标——reset 不清 runtime.json，僵尸 worker 的 fence
// 对 reset 后的新目标仍会相符；slug 在场且不符即拒（旧格式租约无 slug=跳过该维）。
export function assertFenceIfPresent(cwd, fence, slug = null) {
  if (fence == null) return { checked: false };
  const state = loadRuntime(cwd);
  if (!state || !leaseActive(state.activeLease)) {
    throw new RuntimeError(
      `写拒：无活跃租约在册（fence ${fence} 申报失真）——你已被接管或租约已死，立即停手不写（fencing 语义）`,
    );
  }
  if (state.activeLease.fence !== fence) {
    throw new RuntimeError(
      `写拒：fence ${fence} 非现行（现行 ${state.activeLease.fence}）——你已被接管，立即停手不写（fencing 语义）`,
    );
  }
  const leaseSlug = state.activeLease.slug;
  if (typeof leaseSlug === "string" && leaseSlug !== "" && typeof slug === "string" && slug !== "" && leaseSlug !== slug) {
    throw new RuntimeError(
      `写拒：现行租约绑定目标 ${leaseSlug}（本写面目标 ${slug}）——租约与目标不符，立即停手不写（fencing 语义，ADJ-12）`,
    );
  }
  return { checked: true, lease: state.activeLease };
}

// 预算 env 解析（ADJ-28，0.2.1 五轮双审）：原 parseInt 静默吞错值——"abc"/"0"/"-5"
// 静默回落缺省（想要 0 预算的人拿到 30min）、"1e3" 截成 1ms。改为 Number() + fail-loud：
// 在场即必须为有限正数，否则 RuntimeError（配置错误导向响亮失败，不是静默换档）。
function parseBudgetEnv(name) {
  const raw = process.env[name];
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new RuntimeError(
      `${name} 非法：${JSON.stringify(raw)}（须为有限正数；-1/0/abc 一律拒）——修正后重试，或取消该 env 用缺省`,
    );
  }
  return n;
}

// ── 运行预算（墙钟+积分双硬顶）───────────────────────────────────────────
// 积分面联动：remaining 读近 5h 滚动水位作参照行（rollingWaterlinePoints null=账本/
// sqlite3 缺席，如实降级显示）；drive 预算硬顶本身=配置值，水位线联动执法归棒2 drive。
// restart（0.2.0 棒2）：drive 每-run 重开预算（「每次 drive 双硬顶」语义，§⑮ Q4；
// runtime.json 跨 reset 常驻，不重开则二轮 drive 即刻假超顶）——只 drive 内部路径使用，
// 须持活跃租约且 fence 相符（僵尸无租重置被拒）；交互 CLI budget init 维持拒重置不变。
export function initBudget(cwd, { wallClockBudgetMs, pointsBudget, restart = false, fence = null } = {}) {
  const state = loadRuntime(cwd) ?? freshState();
  if (state.budget) {
    if (!restart) {
      throw new RuntimeError(
        `预算已初始化（spent 记录在场，cap 墙钟 ${state.budget.wallClockBudgetMs}ms/积分 ${state.budget.pointsBudget}）——` +
          `重算须人工编辑 ${runtimeFilePath(cwd)}（防误清 spent 审计）`,
      );
    }
    if (!leaseActive(state.activeLease) || state.activeLease.fence !== fence) {
      throw new RuntimeError(
        `预算重开拒：无活跃租约或 fence ${fence} 非现行——每-run 预算重开仅限持租的 drive（fencing 语义）`,
      );
    }
  }
  const envWall = parseBudgetEnv("LZY_DRIVE_WALLCLOCK_BUDGET_MS");
  const envPoints = parseBudgetEnv("LZY_DRIVE_POINTS_BUDGET");
  const wall = Number.isInteger(wallClockBudgetMs) && wallClockBudgetMs > 0
    ? wallClockBudgetMs
    : envWall !== null
      ? envWall
      : DEFAULT_DRIVE_WALLCLOCK_MS;
  const pts = Number.isFinite(pointsBudget) && pointsBudget > 0
    ? pointsBudget
    : envPoints !== null
      ? envPoints
      : DEFAULT_DRIVE_POINTS;
  state.budget = { wallClockBudgetMs: wall, pointsBudget: pts, spentMs: 0, spentPoints: 0 };
  saveRuntime(cwd, state);
  return state.budget;
}

// 记账+执法一体：新累计超过任一硬顶即拒（drive 每段开工前申报预计/实际段耗——超顶
// 拒=该收束的机器信号）。只超一维时另一维照常入账？不——超顶即整笔拒，语义=「此段
// 不该开工」，避免半入账误读。
export function recordSpend(cwd, { ms = 0, points = 0 } = {}) {
  const state = loadRuntime(cwd) ?? freshState();
  if (!state.budget) {
    throw new RuntimeError("预算未初始化：先 lzy loop budget init（或由 drive 自动初始化，棒2）");
  }
  // ADJ-28（0.2.1 五轮双审）：原实现把非法/负数静默归零（调用方以为记账成功）；超顶
  // 整笔拒又使账本低于实耗（差一整段）。改为：非法值响亮拒；超顶时**先如实入账**
  // （附 overrun 标记）再抛——账本与现实对账，信号语义（超顶拒=收束）不变。
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RuntimeError(`记账拒：ms 须为有限非负数，收到 ${JSON.stringify(ms)}`);
  }
  if (!Number.isFinite(points) || points < 0) {
    throw new RuntimeError(`记账拒：points 须为有限非负数，收到 ${JSON.stringify(points)}`);
  }
  const b = state.budget;
  const newMs = b.spentMs + ms;
  const newPoints = b.spentPoints + points;
  const overWall = newMs > b.wallClockBudgetMs;
  const overPoints = newPoints > b.pointsBudget;
  if (overWall || overPoints) {
    b.spentMs = newMs;
    b.spentPoints = newPoints;
    b.lastOverrun = { at: new Date().toISOString(), ms, points };
    saveRuntime(cwd, state);
    const err = new RuntimeError(
      overWall
        ? `墙钟预算超顶：累计 ${newMs}ms > cap ${b.wallClockBudgetMs}ms——drive 须干净收束（handoff 快照+放行，ADR-0020；本笔已如实入账并标 lastOverrun）`
        : `积分预算超顶：累计 ${newPoints} > cap ${b.pointsBudget}——drive 须干净收束（handoff 快照+放行，ADR-0020；本笔已如实入账并标 lastOverrun）`,
    );
    err.code = "BUDGET_OVER"; // ADJ-26：超顶路由用错误码而非文案匹配（文案可改，路由不破）
    throw err;
  }
  b.spentMs = newMs;
  b.spentPoints = newPoints;
  saveRuntime(cwd, state);
  return b;
}

// 只读余量视图（never-throw 家族）：账本/预算缺席=一行说明；水位联动行如实降级。
export function formatBudget(cwd, { rollingPoints } = {}) {
  const head = "runtime 预算（墙钟+积分双硬顶，超顶拒=drive 收束信号，ADR-0020）";
  let state;
  try {
    state = loadRuntime(cwd);
  } catch (e) {
    return `${head}\n  ⚠ runtime 账本不可读（读面降级）：${e?.message ?? e}`;
  }
  if (!state?.budget) return `${head}\n  （未初始化：lzy loop budget init）`;
  const b = state.budget;
  // ADJ-29（0.2.1 五轮双审）：警戒线硬编码 1600 曾忽略 env 覆盖（同仓 doctor/stop 两面
  // 均读 LZY_WATERLINE_POINTS）——读面与执法面必须同源；drive 实际执法用 pointsBudget。
  const envWl = Number(process.env.LZY_WATERLINE_POINTS) || WATERLINE_POINTS;
  const lines = [
    head,
    `  墙钟：${b.spentMs}/${b.wallClockBudgetMs}ms（余 ${Math.max(0, b.wallClockBudgetMs - b.spentMs)}ms）`,
    `  积分：${Math.round(b.spentPoints * 100) / 100}/${b.pointsBudget}（余 ${Math.round(Math.max(0, b.pointsBudget - b.spentPoints) * 100) / 100}）`,
    `  账号近 5h 滚动水位：${rollingPoints == null ? "不可读（fail-soft 降级）" : `${rollingPoints} / 警戒线 ${envWl}`}（drive 执法用积分硬顶 ${b.pointsBudget}）`,
  ];
  if (state.activeLease && leaseActive(state.activeLease)) {
    lines.push(
      `  活跃租约：fence ${state.activeLease.fence}${state.activeLease.slug ? `（目标 ${state.activeLease.slug}）` : ""}（至 ${new Date(state.activeLease.expiresAtMs).toISOString()}）`,
    );
  }
  return lines.join("\n");
}
