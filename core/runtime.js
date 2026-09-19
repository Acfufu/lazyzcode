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
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createHash } from "node:crypto";

export const RUNTIME_VERSION = 1;
export const RUNTIME_FILE = "runtime.json";
// lease TTL 缺省 15min（分钟级；heartbeat 续期；--ttl-ms 可覆盖）。
export const DEFAULT_LEASE_TTL_MS = 15 * 60_000;
// drive 预算缺省（定标+env 覆盖沿 waterline 先例）：墙钟 30min（低于闲时车道外生上限
// 180min）、积分 400（警戒线 WATERLINE_POINTS=1600 的四分之一保守缺省，实测后调）。
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
    throw new RuntimeError(`runtime 账本不可读（${err?.code ?? err?.message ?? err}）：${p}。${RECOVERY}`);
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

// 运行级认领：活跃未过期租约在场=拒（单运行时互斥）；否则发号新 fence（单调 +1）
// 并落租约。ttlMs ≤0 视为缺省。
export function acquireLease(cwd, { ttlMs } = {}) {
  const ttl = Number.isInteger(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_LEASE_TTL_MS;
  const state = loadRuntime(cwd) ?? freshState();
  if (leaseActive(state.activeLease)) {
    const until = new Date(state.activeLease.expiresAtMs).toISOString();
    throw new RuntimeError(
      `另一运行时持租（fence ${state.activeLease.fence}，至 ${until}）——单运行时互斥；` +
        `等待其 release/过期，或确认为僵尸残留后由人工删除 ${runtimeFilePath(cwd)}`,
    );
  }
  const now = Date.now();
  state.fenceCounter += 1;
  state.activeLease = {
    fence: state.fenceCounter,
    acquiredAt: new Date(now).toISOString(),
    heartbeatAt: new Date(now).toISOString(),
    expiresAtMs: now + ttl,
  };
  saveRuntime(cwd, state);
  return state.activeLease;
}

// 心跳续期：fence 不符/租约已过期= fail-closed 拒（已被接管或死租——工人须停手）。
export function heartbeatLease(cwd, fence, { ttlMs } = {}) {
  const ttl = Number.isInteger(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_LEASE_TTL_MS;
  const state = loadRuntime(cwd) ?? freshState();
  if (!leaseActive(state.activeLease)) {
    throw new RuntimeError(
      "心跳拒：无活跃租约（已释放或过期）——你已被接管或租约已死，立即停手不写（fencing 语义）",
    );
  }
  if (state.activeLease.fence !== fence) {
    throw new RuntimeError(
      `心跳拒：fence ${fence} 非现行（现行 ${state.activeLease.fence}）——你已被接管，立即停手不写（fencing 语义）`,
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
export function assertFenceIfPresent(cwd, fence) {
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
  return { checked: true, lease: state.activeLease };
}

// ── 运行预算（墙钟+积分双硬顶）───────────────────────────────────────────
// 积分面联动：remaining 读近 5h 滚动水位作参照行（rollingWaterlinePoints null=账本/
// sqlite3 缺席，如实降级显示）；drive 预算硬顶本身=配置值，水位线联动执法归棒2 drive。
export function initBudget(cwd, { wallClockBudgetMs, pointsBudget } = {}) {
  const state = loadRuntime(cwd) ?? freshState();
  if (state.budget) {
    throw new RuntimeError(
      `预算已初始化（spent 记录在场，cap 墙钟 ${state.budget.wallClockBudgetMs}ms/积分 ${state.budget.pointsBudget}）——` +
        `重算须人工编辑 ${runtimeFilePath(cwd)}（防误清 spent 审计）`,
    );
  }
  const envWall = Number.parseInt(process.env.LZY_DRIVE_WALLCLOCK_BUDGET_MS ?? "", 10);
  const envPoints = Number.parseInt(process.env.LZY_DRIVE_POINTS_BUDGET ?? "", 10);
  const wall = Number.isInteger(wallClockBudgetMs) && wallClockBudgetMs > 0
    ? wallClockBudgetMs
    : Number.isInteger(envWall) && envWall > 0
      ? envWall
      : DEFAULT_DRIVE_WALLCLOCK_MS;
  const pts = Number.isFinite(pointsBudget) && pointsBudget > 0
    ? pointsBudget
    : Number.isInteger(envPoints) && envPoints > 0
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
  const b = state.budget;
  const newMs = b.spentMs + (Number.isFinite(ms) && ms > 0 ? ms : 0);
  const newPoints = b.spentPoints + (Number.isFinite(points) && points > 0 ? points : 0);
  if (newMs > b.wallClockBudgetMs) {
    throw new RuntimeError(
      `墙钟预算超顶：累计 ${newMs}ms > cap ${b.wallClockBudgetMs}ms——drive 须干净收束（handoff 快照+放行，ADR-0020）`,
    );
  }
  if (newPoints > b.pointsBudget) {
    throw new RuntimeError(
      `积分预算超顶：累计 ${newPoints} > cap ${b.pointsBudget}——drive 须干净收束（handoff 快照+放行，ADR-0020）`,
    );
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
  const lines = [
    head,
    `  墙钟：${b.spentMs}/${b.wallClockBudgetMs}ms（余 ${Math.max(0, b.wallClockBudgetMs - b.spentMs)}ms）`,
    `  积分：${Math.round(b.spentPoints * 100) / 100}/${b.pointsBudget}（余 ${Math.round(Math.max(0, b.pointsBudget - b.spentPoints) * 100) / 100}）`,
    `  账号近 5h 滚动水位：${rollingPoints == null ? "不可读（fail-soft 降级）" : `${rollingPoints} / 警戒线 1600`}（联动执法归棒2 drive）`,
  ];
  if (state.activeLease && leaseActive(state.activeLease)) {
    lines.push(
      `  活跃租约：fence ${state.activeLease.fence}（至 ${new Date(state.activeLease.expiresAtMs).toISOString()}）`,
    );
  }
  return lines.join("\n");
}
