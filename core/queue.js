// 有界队列与累计预算（0.3.0 M3，主方案 §5；#32 近似限制语义 2026-09-24 拍板）。
// 职责边界：本模块=已授权待办状态机（proposed→authorized→ready→running→completed，
// 分支 blocked/failed/cancelled）、派发事务（锁内 pre-spawn 写=占用登记，post-run 结算
// 核销）、崩溃恢复判定表（先核对后动作：绝不重复派发、绝不 reset 另一目标）、累计预算
// 账本（独立于可 reset 的当前 goal，绑定 (slug, contractHash)，跨重启/换任务/重试不刷新）
// 与积分近似限制执法（逐请求完成检测=按 sessionId 查宿主 model_usage；达限停止下一次
// 派发；计量缺席/未知价/未决占用不算零——停受积分限额约束的自动派发并显式记录；
// SIGKILL 在途假零显式申报）。
// 三家族（全在 loop/ 外，reset 不清，位阶同 authorizations/——主方案 §5.2 直读+M2 verify/
// 先例；登记仅 ANY_TMP_SCAN_DIRS 增补）：`.lazyzcode/queue/queue.json`（状态+批次预算）、
// `.lazyzcode/queue/dispatch.json`（派发事务事件账）、`.lazyzcode/budget/ledger.json`
//（消耗事实账，dedupKey 防相同回执重复扣账）。校验和/原子写/errno 判别家法照 core/runtime.js。
// 首版边界（契约 non-goals 如实）：单工串行派发（workers 不入队列）、无自动重试（失败即
// failed 阻塞依赖；重试不变量〔仅暂时性错误、≤2 次、计入原预算〕为未来启用时硬约束——0.3.1
// 棒1 申报：前半仍不兑现，见 ADR-0030 §〇.3）；0.3.1 棒1 起 endpoint 支持 A|B|C（矩阵见
// addQueueItem；B/C 须声明交付契约）、队列项 tier 由契约/入队参数定（HEAVY 凭入队前评审
// PASS + planHash 入队）。依赖方向 queue.js → loop/drive/contract/delivery/project/
// cost/hostdb/runtime/git 单向（delivery 边=0.3.1 棒1 桥接新增，免循环）。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { LoopError, readGoal, registerGoal, adoptPlan, startLoop, finishLoop, resetLoop, withLock, bindDeliveryContract } from "./loop.js";
import { runDrive } from "./drive.js";
import { effectiveAuthorization, loadContract } from "./contract.js";
import { actDeliveryB, actDeliveryC, readbackDeliveryB, readbackDeliveryC, loadIntents, validateDeliveryContract, deliveryResultVerdict, DELIVERY_CHAIN_MAX_MS } from "./delivery.js";
import { loadProjectManifest } from "./project.js";
import { computePoints, querySessionPoints } from "./cost.js";
import { loadRuntime, holderPidAlive, reclaimLease } from "./runtime.js";
import { createGit } from "./git.js";

export const QUEUE_VERSION = 1;
export const ITEM_STATES = ["proposed", "authorized", "ready", "running", "completed", "blocked", "failed", "cancelled"];
export const TERMINAL_STATES = ["completed", "failed", "cancelled"];
export const TX_PHASES = ["open", "settled", "killed", "reconciled-orphan"];
export const LEDGER_KINDS = ["wall", "points", "metering-absent", "killed-inflight", "overrun"];
// 停受积分限额约束的自动派发的显式记录族（#32：不算零、如实申报；--resume-points 人工恢复）。
export const POINTS_STOP_KINDS = ["metering-absent", "killed-inflight"];

export class QueueError extends Error {}

const RECOVERY =
  `恢复：本家族在 loop/ 外、reset 不触及；先备份再人工核对该文件（丢失只损失队列/预算记账，` +
  `不影响 goal/dag 权威面），删除后可用 lzy queue add/list 重建队列状态`;

function queueRoot(cwd) {
  return join(cwd, ".lazyzcode", "queue");
}
function budgetRoot(cwd) {
  return join(cwd, ".lazyzcode", "budget");
}
function familyPath(cwd, file) {
  return file === "ledger.json" ? join(budgetRoot(cwd), file) : join(queueRoot(cwd), file);
}

function checksumOf(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

// 通用校验和单文件读：errno 判别（仅 ENOENT 视缺席）+ JSON/校验和/版本三层 fail-closed
//（runtime.js:104-134 家法：不可读被静默当缺席时，下一写命令会整文件覆写）。
function loadFamilyFile(p, { versionKey, version, label, shapeFn }) {
  let text;
  try {
    text = readFileSync(p, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw new QueueError(`${label}不可读（${err?.code ?? err?.message ?? err}）：${p}。${RECOVERY}`);
  }
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new QueueError(`${label}损坏（JSON 解析失败）：${p}。${RECOVERY}`);
  }
  const { checksum, ...rest } = obj ?? {};
  if (checksum !== checksumOf(rest)) {
    throw new QueueError(`${label}校验和不符（内容与落盘时态不一致）：${p}。${RECOVERY}`);
  }
  if (rest[versionKey] !== version) {
    throw new QueueError(`${label}版本不兼容（盘上 v${rest[versionKey]}，本 lzy 期望 v${version}）：${p}。${RECOVERY}`);
  }
  shapeFn(rest, p);
  return rest;
}

// 通用原子写：tmp 0600+rename（runtime.js:139-159 家法）；tmp 落家族根顶层
//（ANY_TMP_SCAN_DIRS 只扫顶层——verify.js:151-153 同款注释纪律）；写前形状校验（写侧毒化防护）。
function saveFamilyFile(p, payload, { versionKey, version, label, shapeFn }) {
  const normalized = { ...payload, [versionKey]: version };
  shapeFn(normalized, "memory(写入前)");
  mkdirSync(dirname(p), { recursive: true });
  const out = { ...normalized, checksum: checksumOf(normalized) };
  const tmp = join(dirname(p), `.${basename(p)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, p);
}

// ── 形状断言（schemaVersion 形状断言家法：机器面不信任盘上字节）──

function assertItem(it, p) {
  const bad = (msg) => {
    throw new QueueError(`队列条目形状畸形（${msg}）：${p}。${RECOVERY}`);
  };
  if (!it || typeof it !== "object") bad("条目须为对象");
  for (const k of ["id", "title", "goalSlug", "contractHash", "contractPath", "planPath", "endpoint", "state", "createdAt", "updatedAt"]) {
    if (typeof it[k] !== "string" || !it[k]) bad(`${k} 缺席或非字符串`);
  }
  if (!/^[0-9a-f]{64}$/.test(it.contractHash)) bad("contractHash 须为 64 hex");
  if (!["A", "B", "C"].includes(it.endpoint)) bad(`endpoint 不识别：${JSON.stringify(it.endpoint)}（A|B|C——0.3.1 棒1 起 B/C 为队列目标终点，ADR-0030）`);
  if (!ITEM_STATES.includes(it.state)) bad(`state 不识别：${it.state}`);
  if (!Array.isArray(it.deps) || it.deps.some((d) => typeof d !== "string")) bad("deps 须为字符串数组");
  if (it.blockedReason != null && typeof it.blockedReason !== "string") bad("blockedReason 须为字符串或 null");
  if (it.completedEndpoint != null && typeof it.completedEndpoint !== "string") bad("completedEndpoint 须为字符串或 null");
  if (it.state === "completed" && typeof it.completedEndpoint !== "string") bad("completed 须注 completedEndpoint（达到 A/B/C 哪个终点）");
  // 交付编排面可选字段（0.3.1 棒1；旧 item 无这些键=逐字兼容）
  if (it.tier != null && !["light", "heavy"].includes(it.tier)) bad(`tier 不识别：${it.tier}（light|heavy）`);
  if (it.risk != null && !["low", "med", "high", "restricted"].includes(it.risk)) bad(`risk 不识别：${it.risk}`);
  if (it.planReview != null && (typeof it.planReview !== "string" || !it.planReview.trim())) bad("planReview 须为非空字符串或 null");
  if (it.planHash != null && !/^[0-9a-f]{64}$/.test(it.planHash)) bad("planHash 须为 64 hex 或 null");
  if (it.delivery != null) {
    if (typeof it.delivery !== "object" || Array.isArray(it.delivery)) bad("delivery 须为对象或 null");
    for (const [ep, d] of Object.entries(it.delivery)) {
      if (ep !== "B" && ep !== "C") bad(`delivery 端点不识别：${ep}（B|C）`);
      if (!d || typeof d.path !== "string" || !d.path) bad(`delivery.${ep}.path 缺席或非字符串`);
      if (typeof d.hash !== "string" || !/^[0-9a-f]{64}$/.test(d.hash)) bad(`delivery.${ep}.hash 须为 64 hex`);
    }
  }
  // 端点-交付矩阵（读侧同判，防绕过 API 的写入；delivery=null 也不得逃逸）：
  // A 禁声明；B 须 B；C 须 B∧C（C 核验对象=最新 done B 意图的 mergeSha）。
  if (it.endpoint === "A" && it.delivery != null) bad("endpoint A 不得声明 delivery（A 无外部动作）");
  if (it.endpoint !== "A" && !it.delivery?.B) bad(`endpoint ${it.endpoint} 缺 delivery.B（端点矩阵：B⇒B 契约）`);
  if (it.endpoint === "C" && !it.delivery?.C) bad("endpoint C 须 delivery.B∧C 两契约（C 核验对象=最新 done B 意图的 mergeSha）");
}

function assertQueueShape(q, p) {
  if (!Array.isArray(q.items)) throw new QueueError(`队列状态形状畸形（items 须为数组）：${p}。${RECOVERY}`);
  const ids = new Set();
  for (const it of q.items) {
    assertItem(it, p);
    if (ids.has(it.id)) throw new QueueError(`队列状态形状畸形（id 重复：${it.id}）：${p}。${RECOVERY}`);
    ids.add(it.id);
  }
  for (const it of q.items) {
    for (const d of it.deps) {
      if (!ids.has(d)) throw new QueueError(`队列状态形状畸形（deps 引用未知 id：${it.id}→${d}）：${p}。${RECOVERY}`);
    }
  }
  if (q.budget != null) {
    const b = q.budget;
    if (typeof b !== "object") throw new QueueError(`队列状态形状畸形（budget 须为对象）：${p}。${RECOVERY}`);
    if (b.pointsLimit != null && (!Number.isFinite(b.pointsLimit) || b.pointsLimit <= 0)) {
      throw new QueueError(`队列状态形状畸形（budget.pointsLimit 须为正数或 null）：${p}。${RECOVERY}`);
    }
    if (b.wallLimitMs != null && (!Number.isInteger(b.wallLimitMs) || b.wallLimitMs <= 0)) {
      throw new QueueError(`队列状态形状畸形（budget.wallLimitMs 须为正整数或 null）：${p}。${RECOVERY}`);
    }
  }
}

function assertDispatchShape(d, p) {
  if (!Array.isArray(d.txs)) throw new QueueError(`派发事件账形状畸形（txs 须为数组）：${p}。${RECOVERY}`);
  for (const t of d.txs) {
    if (!t || typeof t !== "object") throw new QueueError(`派发事件账形状畸形（tx 须为对象）：${p}。${RECOVERY}`);
    if (typeof t.txId !== "string" || !t.txId) throw new QueueError(`派发事件账形状畸形（txId 缺席）：${p}。${RECOVERY}`);
    if (!TX_PHASES.includes(t.phase)) throw new QueueError(`派发事件账形状畸形（phase 不识别：${t.phase}）：${p}。${RECOVERY}`);
    if (!Array.isArray(t.segments)) throw new QueueError(`派发事件账形状畸形（segments 须为数组）：${p}。${RECOVERY}`);
  }
}

function assertLedgerShape(l, p) {
  if (!Array.isArray(l.entries)) throw new QueueError(`预算账本形状畸形（entries 须为数组）：${p}。${RECOVERY}`);
  const seen = new Set();
  for (const e of l.entries) {
    if (!e || typeof e !== "object") throw new QueueError(`预算账本形状畸形（条目须为对象）：${p}。${RECOVERY}`);
    if (!LEDGER_KINDS.includes(e.kind)) throw new QueueError(`预算账本形状畸形（kind 不识别：${e.kind}）：${p}。${RECOVERY}`);
    if (typeof e.dedupKey !== "string" || !e.dedupKey) throw new QueueError(`预算账本形状畸形（dedupKey 缺席）：${p}。${RECOVERY}`);
    if (seen.has(e.dedupKey)) throw new QueueError(`预算账本形状畸形（dedupKey 重复：${e.dedupKey}）——相同回执不得重复扣账：${p}。${RECOVERY}`);
    seen.add(e.dedupKey);
    if (!e.authorization || typeof e.authorization.slug !== "string" || !/^[0-9a-f]{64}$/.test(e.authorization.contractHash ?? "")) {
      throw new QueueError(`预算账本形状畸形（authorization 须 {slug, contractHash}）：${p}。${RECOVERY}`);
    }
  }
}

export function loadQueue(cwd) {
  return loadFamilyFile(familyPath(cwd, "queue.json"), {
    versionKey: "queueVersion", version: QUEUE_VERSION, label: "队列状态", shapeFn: assertQueueShape,
  });
}
export function saveQueue(cwd, q) {
  saveFamilyFile(familyPath(cwd, "queue.json"), q, {
    versionKey: "queueVersion", version: QUEUE_VERSION, label: "队列状态", shapeFn: assertQueueShape,
  });
}
export function loadDispatch(cwd) {
  return loadFamilyFile(familyPath(cwd, "dispatch.json"), {
    versionKey: "dispatchVersion", version: 1, label: "派发事件账", shapeFn: assertDispatchShape,
  });
}
export function saveDispatch(cwd, d) {
  saveFamilyFile(familyPath(cwd, "dispatch.json"), d, {
    versionKey: "dispatchVersion", version: 1, label: "派发事件账", shapeFn: assertDispatchShape,
  });
}
export function loadLedger(cwd) {
  return loadFamilyFile(familyPath(cwd, "ledger.json"), {
    versionKey: "ledgerVersion", version: 1, label: "预算账本", shapeFn: assertLedgerShape,
  });
}
export function saveLedger(cwd, l) {
  saveFamilyFile(familyPath(cwd, "ledger.json"), l, {
    versionKey: "ledgerVersion", version: 1, label: "预算账本", shapeFn: assertLedgerShape,
  });
}

function newId(prefix, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${stamp}-${process.pid.toString(36)}${rand}`;
}

// ── 授权与就绪判定（proposed→authorized→ready 的机器执法）──

function isAuthorized(cwd, it) {
  // effectiveAuthorization：approval 后无 withdrawal（末事件胜）→{authorized: bool}。
  // 账本缺席=false——未授权提案永不 ready、永不自动执行（契约 A1）。
  // 0.3.1 棒1 折叠（ADR-0030 §一.D）：声明的每个交付端点亦须各自有效授权——「已授权待办」
  // 口径=全部授权面齐备（主契约 ∧ delivery 面），未批准交付契约的条目不可 ready。
  try {
    if (effectiveAuthorization(cwd, it.goalSlug, it.contractHash).authorized !== true) return false;
    for (const ep of deliveryEpsOf(it)) {
      if (effectiveAuthorization(cwd, it.goalSlug, it.delivery[ep].hash).authorized !== true) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// 条目声明的交付端点集合（B|C；形状门已保证 A 无 delivery）。
function deliveryEpsOf(it) {
  return it.delivery ? Object.keys(it.delivery).filter((ep) => ep === "B" || ep === "C") : [];
}

// 目标终点要求的交付动作序列：B 止于合并（act B）；C 续 Pages 核验（act B→C）。
// 与「声明集合」不同：B 终点同样声明两契约（双授权门要求），但不执行 act C。
function requiredActsFor(it) {
  if (it.endpoint === "C") return ["B", "C"];
  if (it.endpoint === "B") return ["B"];
  return [];
}

// 授权缺席原因列（读面文案；交付面含短码指路——「批准 <短8>」）。
function authorizationReasons(cwd, it) {
  const reasons = [];
  try {
    if (effectiveAuthorization(cwd, it.goalSlug, it.contractHash).authorized !== true) {
      reasons.push("契约授权无效（approval 缺席或已撤回）");
    }
    for (const ep of deliveryEpsOf(it)) {
      if (effectiveAuthorization(cwd, it.goalSlug, it.delivery[ep].hash).authorized !== true) {
        const short = it.delivery[ep].hash.slice(0, 8);
        reasons.push(`交付授权缺席：${ep}（${short}）——批准 ${short}`);
      }
    }
  } catch {
    reasons.push("授权账本不可读（fail-closed）");
  }
  return reasons;
}

function leaseAvailable(cwd) {
  try {
    const rt = loadRuntime(cwd);
    return rt?.activeLease == null || rt.activeLease.expiresAtMs <= Date.now();
  } catch {
    return false; // runtime 不可读=保守侧（租约状态不明不派发）
  }
}

function projectReady(cwd) {
  // 项目就绪=goal 根 lzy.project.json 在场（校验过的读面；损坏会抛=not ready 保守侧）
  try {
    return loadProjectManifest(cwd) != null;
  } catch {
    return false;
  }
}

// 预算门（联合判定）：已耗实值（ledger）∪ 未决占用（open tx 登记上限，保守计入——
// 绝不当零）对队列总额；metering 停派旗单独判（#32：停「受积分限额约束」的派发）。
export function budgetView(cwd) {
  const q = loadQueue(cwd);
  const ledger = loadLedger(cwd);
  const dispatch = loadDispatch(cwd);
  const limit = q?.budget ?? {};
  let wallMs = 0;
  let points = 0;
  let openWallMs = 0;
  let openPoints = 0;
  const stopKinds = [];
  for (const e of ledger?.entries ?? []) {
    wallMs += Number(e.ms) || 0;
    points += Number(e.points) || 0;
    if (POINTS_STOP_KINDS.includes(e.kind)) stopKinds.push(e);
  }
  for (const t of dispatch?.txs ?? []) {
    if (t.phase !== "open") continue;
    openWallMs += Number(t.limits?.wallMs) || 0;
    openPoints += Number(t.limits?.points) || 0;
  }
  const pointsLimited = limit.pointsLimit != null;
  // 人工确认（--resume-points）只豁免确认时账本 seq 之前的在案记录；其后新增计量缺席/
  // 未决占用重新停止（#32 的停派语义不因一次确认永久熄火）。
  const ack = limit.pointsStoppedAck ?? null;
  const ackSeq = Number(ack?.ackSeq) || 0;
  const unacked = stopKinds.filter((e) => (Number(e.seq) || 0) > ackSeq);
  return {
    pointsLimit: limit.pointsLimit ?? null,
    wallLimitMs: limit.wallLimitMs ?? null,
    wallMs, points, openWallMs, openPoints,
    wallRemainingMs: limit.wallLimitMs != null ? limit.wallLimitMs - wallMs - openWallMs : null,
    pointsRemaining: limit.pointsLimit != null ? limit.pointsLimit - points - openPoints : null,
    wallExhausted: limit.wallLimitMs != null && wallMs + openWallMs >= limit.wallLimitMs,
    pointsExhausted: pointsLimited && points + openPoints >= limit.pointsLimit,
    pointsStopped: pointsLimited && unacked.length > 0,
    stopKinds: unacked,
  };
}

// 就绪判定读面（不落盘）：返回 {ready, reasons[]}——ready 须同时满足契约授权有效、
// 依赖完成、项目就绪、预算可用、工作区可取得租约、计划在位（主方案 §5.1 五条件+计划输入）。
export function describeReadiness(cwd, it, view = null) {
  const reasons = [];
  reasons.push(...authorizationReasons(cwd, it));
  if (!it.planPath) reasons.push("计划缺位（add 时未带 --plan）");
  const q = loadQueue(cwd);
  const byId = new Map((q?.items ?? []).map((x) => [x.id, x]));
  for (const d of it.deps) {
    const dep = byId.get(d);
    if (!dep || dep.state !== "completed") reasons.push(`依赖 ${d} 未完成（${dep?.state ?? "缺失"}）`);
  }
  if (!projectReady(cwd)) reasons.push("项目未就绪（goal 根 lzy.project.json 缺席或损坏）");
  const v = view ?? budgetView(cwd);
  if (v.wallExhausted) reasons.push("墙钟总额已尽（含未决占用）");
  if (v.pointsExhausted) reasons.push("积分总额已尽（含未决占用）");
  if (v.pointsStopped) reasons.push("计量缺席/未决占用在案——受积分限额约束的派发停止（#32）");
  if (!leaseAvailable(cwd)) reasons.push("工作区租约被占用（drive 运行中或未回收）");
  return { ready: reasons.length === 0, reasons };
}

// 刷新派生状态（authorized/ready/blocked(authorization) 重估；终态不可逆）。写入须持锁
//（调用方 withLock）。deps 失败的阻塞是终局性的（failed 依赖不可逆）；撤回批次在重新
// 批准（fresh approval record）后回到 authorized——恢复路径诚实。
function refreshStates(cwd, q) {
  const byId = new Map(q.items.map((x) => [x.id, x]));
  for (const it of q.items) {
    if (TERMINAL_STATES.includes(it.state)) continue;
    const auth = isAuthorized(cwd, it);
    const depFailed = it.deps.some((d) => byId.get(d)?.state === "failed");
    if (depFailed) {
      it.state = "blocked";
      it.blockedReason = `依赖失败阻塞（${it.deps.filter((d) => byId.get(d)?.state === "failed").join(",")}）`;
      it.updatedAt = new Date().toISOString();
      continue;
    }
    if (it.state === "blocked" && it.blockedReason?.startsWith("依赖失败")) continue; // 依赖失败阻塞不可逆
    if (!auth) {
      if (it.state === "authorized" || it.state === "ready") {
        it.state = "blocked";
        // 文案泛化（0.3.1 棒1）：覆盖「缺席/撤回/交付面未批准」三态，前缀 authorization 保持
        //（refreshStates 的自动恢复谓词按前缀判，:311 家法不改）。
        it.blockedReason = `authorization（${authorizationReasons(cwd, it).join("；")}——批准后自动回 authorized）`;
        it.updatedAt = new Date().toISOString();
      }
      continue;
    }
    if (it.state === "blocked" && it.blockedReason?.startsWith("authorization")) {
      it.state = "authorized";
      it.blockedReason = null;
      it.updatedAt = new Date().toISOString();
    }
    if (it.state === "proposed") {
      it.state = "authorized";
      it.updatedAt = new Date().toISOString();
    }
    if (it.state === "authorized") {
      const { ready } = describeReadiness(cwd, it);
      if (ready) {
        it.state = "ready";
        it.updatedAt = new Date().toISOString();
      }
    }
    if (it.state === "ready") {
      const { ready } = describeReadiness(cwd, it);
      if (!ready) {
        it.state = "authorized"; // 就绪条件失而复得可逆（租约/预算动态轴），降回 authorized 等待
        it.updatedAt = new Date().toISOString();
      }
    }
  }
  return q;
}

// ── 条目生命周期 ──

export function addQueueItem(cwd, { title, contractFile, planFile, endpoint = "A", deps = [], goalSlug = null, tier = "light", risk = "low", planReview = null, planHash = null, delivery = null }) {
  if (typeof title !== "string" || !title.trim()) throw new QueueError("条目标题不能为空");
  if (title.trim().length > 300) throw new QueueError(`条目标题超上限 300 字符（当前 ${title.trim().length}）`);
  // endpoint 矩阵（0.3.1 棒1，ADR-0030 §〇.4）：A 可合并候选 | B 合并主干 | C 上线验证。
  if (!["A", "B", "C"].includes(endpoint)) {
    throw new QueueError(`endpoint 不识别：${JSON.stringify(endpoint)}（A 可合并候选 | B 合并主干 | C 上线验证——B/C 须声明交付契约）`);
  }
  if (!["light", "heavy"].includes(tier)) throw new QueueError(`tier 不识别：${JSON.stringify(tier)}（light|heavy）`);
  // risk 门：HIGH+ 不入无人值守车道（ADR-0020——drive 入口 assertDriveEligible 机器拒 HIGH+，入队即拒早暴露）。
  if (!["low", "med"].includes(risk)) {
    throw new QueueError(`risk 仅支持 low|med（当前 ${JSON.stringify(risk)}）——HIGH+ 不入无人值守车道（ADR-0020）；高风险工作请交互会话内推进`);
  }
  const loaded = (() => {
    try {
      return loadContract(contractFile, cwd);
    } catch (e) {
      throw new QueueError(`契约无效：${e?.message ?? e}`);
    }
  })();
  // endpoint 交叉校验：item.endpoint 与主契约 endpoint 字段一致（同一终点两处声明必须一致）。
  if (loaded.endpoint !== endpoint) {
    throw new QueueError(`endpoint 与主契约不一致：条目=${endpoint}，契约=${loaded.endpoint}（契约 endpoint 字段=任务目标终点；改终点=新契约）`);
  }
  // HEAVY 门（ADR-0030 §一.G）：评审发生在入队前——PASS 记录 + 计划哈希双件，缺一即拒。
  if (tier === "heavy") {
    if (typeof planReview !== "string" || !planReview.trim()) {
      throw new QueueError('HEAVY 条目须带计划评审 PASS（--plan-review "plan-reviewer: PASS — …"）——评审发生在入队前；缺位=机器拒');
    }
    if (!/PASS/.test(planReview) || /REVISE/.test(planReview)) {
      throw new QueueError(`--plan-review 判决非 PASS 形态：${planReview.slice(0, 120)}——HEAVY 采纳门机器拒非 PASS（core/loop.js:1058 家法）`);
    }
    if (typeof planHash !== "string" || !/^[0-9a-f]{64}$/.test(planHash)) {
      throw new QueueError("HEAVY 条目须带计划哈希（--plan 现算 sha256）——派发前比对：计划已改=评审作废");
    }
  }
  // 交付契约（delivery{B,C}）：validateDeliveryContract（endpoint 匹配+哈希）+ 队列承载必填键矩阵
  // （对齐动作面硬要求，无人值守无法交互补参）。
  const deliveryNorm = {};
  if (delivery != null) {
    if (typeof delivery !== "object" || Array.isArray(delivery)) throw new QueueError("delivery 须为 {B: <文件>, C: <文件>} 对象");
    for (const ep of ["B", "C"]) {
      const file = delivery[ep];
      if (file == null) continue;
      let v;
      try {
        v = validateDeliveryContract(cwd, ep, file);
      } catch (e) {
        throw new QueueError(`${ep} 交付契约无效：${e?.message ?? e}`);
      }
      const c = loadContract(v.path, cwd);
      const need = ep === "B"
        ? [["repo", c.repo], ["base", c.base], ["branch", c.branch], ["pr-title", c.prTitle]]
        : [["repo", c.repo], ["expect-marker", c.expectMarker]];
      const missing = need.filter(([, val]) => !val).map(([k]) => k);
      if (missing.length > 0) {
        throw new QueueError(`${ep} 交付契约缺队列承载必填键：${missing.join("/")}（无人值守无法交互补参——契约补声明后重新入队）`);
      }
      deliveryNorm[ep] = { path: v.path, hash: v.hash }; // v.path 已是相对 cwd 的路径（树外契约=绝对档，loadContract 两态皆认）
    }
  }
  if (endpoint === "A" && Object.keys(deliveryNorm).length > 0) {
    throw new QueueError("endpoint A 不得声明交付契约（A 无外部动作——交付链只在 B/C 终点存在）");
  }
  if ((endpoint === "B" || endpoint === "C") && !(deliveryNorm.B && deliveryNorm.C)) {
    // act B 门恒要求 B∧C 双授权（main 为 Pages 发布源，合并即触发部署——ADR-0028）：
    // B 与 C 终点都须声明两契约；差别只在交付链走到哪一步（B 止于合并、C 续 Pages 核验）。
    throw new QueueError(
      `endpoint ${endpoint} 须同时声明 --delivery-b ∧ --delivery-c（缺 ${deliveryNorm.B ? "C" : "B"}；` +
        `act B 门恒要求 B∧C 双授权——合并即触发 Pages 部署，ADR-0028）`,
    );
  }
  if (!planFile) throw new QueueError("计划缺位：add 须带 --plan <文件>（该项 goal 的执行计划；缺位不得 ready）");
  const planAbs = resolve(cwd, planFile);
  if (!existsSync(planAbs)) throw new QueueError(`计划文件不存在：${planAbs}`);
  return withLock(cwd, () => {
    const q = loadQueue(cwd) ?? { items: [], budget: { pointsLimit: null, wallLimitMs: null, notes: [] } };
    const seq = q.items.length + 1;
    const id = `q${seq}`;
    let slug = goalSlug ?? `q${seq}-${loaded.hash.slice(0, 6)}`;
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(slug)) {
      throw new QueueError(`goalSlug 不合法：${slug}（仅字母数字与连字符，≤64 字符）`);
    }
    if (q.items.some((x) => x.goalSlug === slug)) throw new QueueError(`goalSlug 已被其他条目占用：${slug}`);
    for (const d of deps) {
      if (d === id) throw new QueueError("deps 不得自指");
      if (!q.items.some((x) => x.id === d)) throw new QueueError(`deps 引用未知条目：${d}`);
    }
    if (hasCycle(q.items.concat([{ id, deps: [...deps] }]))) throw new QueueError("deps 构成环（拒绝）");
    const now = new Date().toISOString();
    const item = {
      id, seq, title: title.trim(), goalSlug: slug,
      contractHash: loaded.hash,
      contractPath: relative(cwd, loaded.path) || loaded.path,
      planPath: relative(cwd, planAbs) || planAbs,
      endpoint, deps: [...deps], state: "proposed",
      blockedReason: null, completedEndpoint: null,
      tier, risk,
      planReview: tier === "heavy" ? planReview.trim() : null,
      planHash: tier === "heavy" ? planHash : null,
      delivery: Object.keys(deliveryNorm).length > 0 ? deliveryNorm : null,
      createdAt: now, updatedAt: now,
    };
    q.items.push(item);
    saveQueue(cwd, q);
    return item;
  });
}

function hasCycle(items) {
  const byId = new Map(items.map((x) => [x.id, x.deps ?? []]));
  const seen = new Set();
  const done = new Set();
  const visit = (id) => {
    if (done.has(id)) return false;
    if (seen.has(id)) return true;
    seen.add(id);
    for (const d of byId.get(id) ?? []) if (visit(d)) return true;
    seen.delete(id);
    done.add(id);
    return false;
  };
  for (const id of byId.keys()) if (visit(id)) return true;
  return false;
}

export function setQueueBudget(cwd, { points, wallMs, note = null, resumePoints = false }) {
  return withLock(cwd, () => {
    const q = loadQueue(cwd);
    if (!q) throw new QueueError("队列为空：先 lzy queue add 建条目再设预算");
    q.budget = q.budget ?? { pointsLimit: null, wallLimitMs: null, notes: [] };
    q.budget.notes = q.budget.notes ?? [];
    if (points != null) {
      if (!(Number.isFinite(points) && points > 0)) throw new QueueError(`--points 须为正数（当前 ${JSON.stringify(points)}）`);
      q.budget.pointsLimit = points; // 追加额度=新值+新 provenance 注记行（不覆写历史注记）
    }
    if (wallMs != null) {
      if (!(Number.isInteger(wallMs) && wallMs > 0)) throw new QueueError(`--wall-ms 须为正整数（当前 ${JSON.stringify(wallMs)}）`);
      q.budget.wallLimitMs = wallMs;
    }
    if (note) q.budget.notes.push({ at: new Date().toISOString(), note });
    if (resumePoints) {
      // ack 以账本 seq 为单调判定基（时戳同毫秒碰撞不可靠）——确认只豁免 seq≤ack 的在案记录
      const ledger = loadLedger(cwd);
      const maxSeq = (ledger?.entries ?? []).reduce((m, e) => Math.max(m, Number(e.seq) || 0), 0);
      q.budget.pointsStoppedAck = { at: new Date().toISOString(), ackSeq: maxSeq, note: note ?? "人工恢复受积分限额约束的派发" };
    }
    saveQueue(cwd, q);
    return q.budget;
  });
}

export function cancelQueueItem(cwd, id, reason) {
  if (typeof reason !== "string" || !reason.trim()) throw new QueueError("cancel 须带 --reason（取消原因入账）");
  return withLock(cwd, () => {
    const q = loadQueue(cwd);
    const it = q?.items.find((x) => x.id === id);
    if (!it) throw new QueueError(`未知条目：${id}`);
    if (TERMINAL_STATES.includes(it.state)) throw new QueueError(`条目已终态（${it.state}）不可取消——终态不可逆`);
    // 取消保留工件与历史：goal/worktree/回执一概不动（主方案 §5.1），只收束队列状态。
    it.state = "cancelled";
    it.blockedReason = reason.trim();
    it.updatedAt = new Date().toISOString();
    saveQueue(cwd, refreshStates(cwd, q));
    return it;
  });
}

// ── 派发事务与结算 ──

function openTx(cwd, item, limits) {
  const d = loadDispatch(cwd) ?? { txs: [] };
  const tx = {
    txId: newId("t"),
    itemId: item.id, goalSlug: item.goalSlug,
    phase: "open",
    openedAt: new Date().toISOString(), settledAt: null,
    limits, // {wallMs, points} 占用登记上限——崩溃未决按此保守计入，绝不当零
    segments: [], note: null,
  };
  d.txs.push(tx);
  saveDispatch(cwd, d);
  return tx;
}

function patchTx(cwd, txId, patch) {
  const d = loadDispatch(cwd);
  const tx = d.txs.find((t) => t.txId === txId);
  if (!tx) throw new QueueError(`派发事务缺失：${txId}（事件账与内存态不一致，拒绝写）`);
  Object.assign(tx, patch);
  saveDispatch(cwd, d);
  return tx;
}

export function appendLedgerEntry(cwd, entry) {
  const l = loadLedger(cwd) ?? { entries: [] };
  const dedupKey = entry.dedupKey;
  if (l.entries.some((e) => e.dedupKey === dedupKey)) {
    return { duplicate: true, entry: null }; // 相同运行回执不重复扣账（契约 A2）
  }
  const seq = l.entries.length + 1;
  const full = {
    seq, at: new Date().toISOString(),
    authorization: entry.authorization, provenance: entry.provenance ?? null,
    itemId: entry.itemId ?? null, txId: entry.txId ?? null,
    sessionId: entry.sessionId ?? null, ms: entry.ms ?? null, points: entry.points ?? null,
    note: entry.note ?? null,
    kind: entry.kind, dedupKey,
  };
  l.entries.push(full);
  saveLedger(cwd, l);
  return { duplicate: false, entry: full };
}

// 逐会话计量（#32 逐请求完成检测）：**0.3.1 棒2 起实体迁 core/cost.js**（计量原语单源，
// queue 结算面与 drive 段界归因共用同一查询面——ADR-0027 修正节）；本处保留 re-export，
// 既有导入面（test/queue-metering.contract.test.js 等）逐字不变。语义（缺席/未计价/净化）
// 与注释随迁至 cost.js。
export { querySessionPoints };

// 结算：tx 的 segments 逐段入账（wall 恒入；points 按 session 查询或缺席申报）。
// dedupKey 保证重复 settle 幂等（第二遍全 duplicate=no-op）。queryPoints 可注入
//（deps.querySessionPoints——契约测试假计量面，零触宿主 db）。
function settleTxLedger(cwd, { tx, item, provenance, queryPoints = querySessionPoints }) {
  const authorization = { slug: item.goalSlug, contractHash: item.contractHash };
  const out = { wallEntries: 0, pointsEntries: 0, absentEntries: 0, points: 0, duplicates: 0 };
  tx.segments.forEach((seg, i) => {
    const sid = seg.sessionId ?? `seg-${i}`;
    const wall = appendLedgerEntry(cwd, {
      kind: "wall", dedupKey: `wall:${tx.txId}:${sid}`,
      authorization, provenance, itemId: item.id, txId: tx.txId, sessionId: seg.sessionId ?? null,
      ms: seg.durationMs ?? 0,
    });
    if (wall.duplicate) out.duplicates += 1; else out.wallEntries += 1;
    const m = queryPoints(seg.sessionId);
    if (m.absent) {
      const e = appendLedgerEntry(cwd, {
        kind: "metering-absent", dedupKey: `metering-absent:${tx.txId}:${sid}`,
        authorization, provenance, itemId: item.id, txId: tx.txId, sessionId: seg.sessionId ?? null,
        note: "该会话零完成用量行——计量缺席不算零，受积分限额约束的派发停止（#32）",
      });
      if (e.duplicate) out.duplicates += 1; else out.absentEntries += 1;
    } else {
      if (m.unpriced.length > 0) {
        const e = appendLedgerEntry(cwd, {
          kind: "metering-absent", dedupKey: `metering-absent:${tx.txId}:${sid}:unpriced`,
          authorization, provenance, itemId: item.id, txId: tx.txId, sessionId: seg.sessionId ?? null,
          note: `未计价模型：${m.unpriced.join(",")}——未知价格不算零，受积分限额约束的派发停止（#32）`,
        });
        if (e.duplicate) out.duplicates += 1; else out.absentEntries += 1;
      }
      if (m.points > 0) {
        const e = appendLedgerEntry(cwd, {
          kind: "points", dedupKey: `points:${tx.txId}:${sid}`,
          authorization, provenance, itemId: item.id, txId: tx.txId, sessionId: seg.sessionId ?? null,
          points: m.points,
        });
        if (e.duplicate) out.duplicates += 1; else { out.pointsEntries += 1; out.points += m.points; }
        // 在途超额如实入账：本段入账后越过总额=overrun 条目（实际值，不为保阈值拒写）
        const v = budgetView(cwd);
        if (v.pointsLimit != null && v.points > v.pointsLimit) {
          appendLedgerEntry(cwd, {
            kind: "overrun", dedupKey: `overrun:${tx.txId}:${sid}`,
            authorization, provenance, itemId: item.id, txId: tx.txId, sessionId: seg.sessionId ?? null,
            points: v.points - v.pointsLimit,
            note: `在途超额 ${Math.round((v.points - v.pointsLimit) * 100) / 100}（总额 ${v.pointsLimit}）——实际消耗如实记账，停止下一次派发`,
          });
        }
      }
    }
  });
  return out;
}

// ── 恢复判定表（先核对后动作：绝不重复派发、绝不 reset 另一目标）──
// (a) 同 slug 且 executing → tx=killed，killed-inflight 显式申报，item 回 ready（重驱同
//     goal 续跑，不重新 register）
// (b) 同 slug 且 done → tx 补 settle（诚实归账），item completed
// (c) goal 缺失或异 slug → tx=reconciled-orphan，item=failed（人工核查指路）——不静默重注册
// 交付账本判定（0.3.1 棒1 §一.F.5；0.3.1 收口 R0.3 改判据单源）：item 声明的交付端点是否
// **结果达成**（不只看意图 done）——谓词在 core/delivery.js（deliveryResultVerdict）：
// B 须 merge 身份在场 ∧ merge CI green；C 须全页核过。意图 done 但未验证 ⇒ allDone:false
// 且 missing 具名（队列不得 completed，恢复走 readback/验证，绝不重发 merge）。
function deliveryAllDone(cwd, item) {
  let intents = null;
  try {
    intents = loadIntents(cwd)?.intents ?? [];
  } catch {
    return { allDone: false, unreadable: true, missing: requiredActsFor(item) };
  }
  const v = deliveryResultVerdict(intents, item);
  return { allDone: v.ok, unreadable: false, missing: v.unmet, unmet: v.unmet };
}

// 交付墙钟条目（观测上界；死亡路径与收束路径共用，dedupKey 幂等）。
function appendDeliveryWall(cwd, { tx, item, ms, note }) {
  return appendLedgerEntry(cwd, {
    kind: "wall", dedupKey: `wall:${tx.txId}:delivery`,
    authorization: { slug: item.goalSlug, contractHash: item.contractHash },
    provenance: `tx:${tx.txId}:delivery`, itemId: item.id, txId: tx.txId, sessionId: null,
    ms: Math.max(0, ms ?? 0), note,
  });
}

// 交付追认（0.3.1 棒1，§一.F.5）：failed 且声明 delivery 的条目重读桥来源意图——全声明
// 端点 done ⇒ 翻 completed（幂等，沿 :643 补账家法）。人工 lzy delivery readback/act 修复
// 交付后，queue reconcile 即追认；deps 链不再永久 blocked。返回追认条数。
function acknowledgeDeliveries(cwd, q, verdicts) {
  let acked = 0;
  for (const it of q.items) {
    if (it.state !== "failed" || deliveryEpsOf(it).length === 0) continue;
    if (!/^交付未竟|^基建中止/.test(it.blockedReason ?? "")) continue; // 只追认交付面 failed（不动其它 failed 语义）
    const v = deliveryAllDone(cwd, it);
    if (!v.allDone) continue;
    it.state = "completed";
    it.completedEndpoint = it.completedEndpoint ?? it.endpoint;
    it.updatedAt = new Date().toISOString();
    verdicts.push({ txId: null, verdict: `交付追认（${it.id}：全端点 done ⇒ completed）`, goalSlug: it.goalSlug });
    acked += 1;
  }
  return acked;
}

export function reconcileDispatch(cwd, deps = {}) {
  return withLock(cwd, () => {
    const d = loadDispatch(cwd);
    const open = (d?.txs ?? []).filter((t) => t.phase === "open");
    const verdicts = [];
    if (open.length === 0) {
      // 快速路径也跑交付追认（0.3.1 棒1）：未竟收束后 tx 已 settle，若无此遍则 failed 条目
      // 永远不能被人工修复后的 reconcile 追认（有候选才写盘）。
      const qFast = loadQueue(cwd);
      if (qFast && acknowledgeDeliveries(cwd, qFast, verdicts) > 0) saveQueue(cwd, refreshStates(cwd, qFast));
      return { verdicts, reconciled: verdicts.length };
    }
    const q = loadQueue(cwd);
    const goal = (() => {
      try {
        return readGoal(cwd);
      } catch {
        return null;
      }
    })();
    const queryPoints = deps.querySessionPoints ?? querySessionPoints;
    for (const tx of open) {
      const item = q?.items.find((x) => x.id === tx.itemId) ?? null;
      if (goal && goal.slug === tx.goalSlug && goal.status === "executing") {
        // 先核对后动作的活性半：租约仍在握（未过期）=派发可能仍活跃（他进程/他会话）——
        // 不核销、不重驱、不申报假零，留待租约消亡后的下一次核对。
        const rt = (() => {
          try {
            return loadRuntime(cwd);
          } catch {
            return null;
          }
        })();
        const lease = rt?.activeLease ?? null;
        const leaseLive = lease != null && lease.expiresAtMs > Date.now()
          && holderPidAlive(lease.hostPid) !== false; // 持租进程已死（ESRCH）=僵尸租约不算活跃
        if (leaseLive) {
          verdicts.push({ txId: tx.txId, verdict: "busy-live（租约在握且持租进程存活——派发可能仍活跃，不核销）", goalSlug: tx.goalSlug });
          continue;
        }
        patchTx(cwd, tx.txId, {
          phase: "killed", settledAt: new Date().toISOString(),
          note: "驱动进程死于段中（crash/SIGKILL，租约已消亡）——goal 仍 executing，item 回 ready 重驱续跑",
        });
        if (item && !TERMINAL_STATES.includes(item.state) && item.state !== "running") {
          // running 条目回 ready（重驱同 goal）
        } else if (item && item.state === "running") {
          item.state = "ready";
          item.updatedAt = new Date().toISOString();
        }
        // killed-inflight 显式申报（未决消耗不能假零——#32）
        if (item) {
          appendLedgerEntry(cwd, {
            kind: "killed-inflight", dedupKey: `killed-inflight:${tx.txId}`,
            authorization: { slug: item.goalSlug, contractHash: item.contractHash },
            itemId: item.id, txId: tx.txId,
            note: "派发事务未决终止——在途消耗不可知，不得当作零消耗释放（#32 假零申报）",
          });
        }
        // 僵尸租约回收（best-effort）：持租进程死于 SIGKILL 时租约未过期会挡住重驱——
        // holderPidAlive 已判死，此处按同判据回收（判不准时 reclaimLease 自身仍会拒）。
        try {
          const rc = reclaimLease(cwd, {});
          if (rc.reclaimed) console.log(`[queue] 僵尸租约已回收（fence ${rc.fence}）`);
        } catch {}
        verdicts.push({ txId: tx.txId, verdict: "killed（item 回 ready）", goalSlug: tx.goalSlug });
      } else if (goal && goal.slug === tx.goalSlug && goal.status === "done") {
        // 交付感知（0.3.1 棒1，§一.F.5）：声明 delivery 的 item 不得凭 goal.status 直接 completed。
        const declaredEps = item ? deliveryEpsOf(item) : [];
        const inFlight = tx.note === "delivery-in-flight";
        if (inFlight && declaredEps.length > 0) {
          const since = Number.isFinite(tx.deliveringSinceMs) ? tx.deliveringSinceMs : null;
          const withinBound = since != null && Date.now() - since <= DELIVERY_CHAIN_MAX_MS;
          const holderAlive = holderPidAlive(tx.deliveringPid) !== false;
          if (withinBound && holderAlive) {
            verdicts.push({ txId: tx.txId, verdict: "delivering（交付链在途——不核销，留待其自然收束）", goalSlug: tx.goalSlug });
            continue;
          }
          // 超界或持有进程已死（ESRCH）⇒ 视同死亡：落回账本判定 + 诚实收束（不死锁）
          const v = deliveryAllDone(cwd, item);
          let settled = null;
          if (item) {
            settled = settleTxLedger(cwd, { tx, item, provenance: `reconcile:${tx.txId}`, queryPoints });
            if (v.allDone) {
              item.state = "completed";
              item.completedEndpoint = item.completedEndpoint ?? item.endpoint;
            } else {
              item.state = "failed";
              item.blockedReason = `交付未竟：交付链进程死亡（${since != null ? `${Math.round((Date.now() - since) / 1000)}s 前在途，超上界或持有进程已死` : "在途标记缺时间"}），未收束端点 ${v.missing.join("/")}——goal 已 done 且 attestation 在案；恢复=lzy delivery act <ep> --origin-item ${item.id}（或 readback 复验）后 lzy queue reconcile 追认`;
            }
            item.updatedAt = new Date().toISOString();
          }
          appendDeliveryWall(cwd, {
            tx, item, ms: since != null ? Date.now() - since : null,
            note: `交付链墙钟（观测上界）；死亡收束：${v.allDone ? "账本全 done 追认 completed" : `未收束 ${v.missing.join("/")}`}`,
          });
          patchTx(cwd, tx.txId, {
            phase: "settled", settledAt: new Date().toISOString(),
            note: `交付链进程死亡（超 ${DELIVERY_CHAIN_MAX_MS}ms 上界或持有进程已死）——按账本判定收束（${v.allDone ? "completed" : "failed"}），不死锁`,
          });
          verdicts.push({ txId: tx.txId, verdict: `delivery-dead（${v.allDone ? "追认 completed" : "failed+指路"}：wall ${settled?.wallEntries ?? 0} 条）`, goalSlug: tx.goalSlug });
          continue;
        }
        if (item && declaredEps.length > 0) {
          const v = deliveryAllDone(cwd, item);
          let settled = null;
          if (v.allDone) {
            settled = settleTxLedger(cwd, { tx, item, provenance: `reconcile:${tx.txId}`, queryPoints });
            item.state = "completed";
            item.completedEndpoint = item.completedEndpoint ?? item.endpoint;
            item.updatedAt = new Date().toISOString();
          } else {
            settled = settleTxLedger(cwd, { tx, item, provenance: `reconcile:${tx.txId}`, queryPoints });
            item.state = "failed";
            item.blockedReason = `交付未竟：goal 已 done 而交付链未收束（缺 ${v.missing.join("/")}${v.unreadable ? "；账本不可读" : ""}）——恢复=lzy delivery act <ep> --origin-item ${item.id}（或 readback 复验）后 lzy queue reconcile 追认`;
            item.updatedAt = new Date().toISOString();
          }
          patchTx(cwd, tx.txId, {
            phase: "settled", settledAt: new Date().toISOString(),
            note: `goal 已 done 而事务未决——交付感知收束（${v.allDone ? "账本全 done ⇒ completed" : "未全 done ⇒ failed+指路"}）`,
          });
          verdicts.push({ txId: tx.txId, verdict: `settled（交付感知：${v.allDone ? "completed" : "failed+指路"}，wall ${settled?.wallEntries ?? 0} 条）`, goalSlug: tx.goalSlug });
          continue;
        }
        let settled = null;
        if (item) {
          settled = settleTxLedger(cwd, { tx, item, provenance: `reconcile:${tx.txId}`, queryPoints });
          item.state = "completed";
          item.completedEndpoint = item.completedEndpoint ?? item.endpoint;
          item.updatedAt = new Date().toISOString();
        }
        patchTx(cwd, tx.txId, {
          phase: "settled", settledAt: new Date().toISOString(),
          note: "goal 已 done 而事务未决——补结算诚实归账（崩溃发生于完成归档与队列确认之间）",
        });
        verdicts.push({ txId: tx.txId, verdict: `settled（补结算：wall ${settled?.wallEntries ?? 0} 条）`, goalSlug: tx.goalSlug });
      } else {
        patchTx(cwd, tx.txId, {
          phase: "reconciled-orphan", settledAt: new Date().toISOString(),
          note: goal
            ? `现行 goal=${goal.slug}（${goal.status}）与事务 goal=${tx.goalSlug} 不符——不 reset 另一目标，条目转 failed 待人工核查`
            : "goal 缺失（被 reset/从未注册）——不静默重注册，条目转 failed 待人工核查",
        });
        if (item && !TERMINAL_STATES.includes(item.state)) {
          item.state = "failed";
          item.blockedReason = "派发事务成孤儿（goal 缺失或不符）——人工核对夹具/槽位后处置；绝不静默重注册";
          item.updatedAt = new Date().toISOString();
        }
        verdicts.push({ txId: tx.txId, verdict: "reconciled-orphan（item failed）", goalSlug: tx.goalSlug });
      }
    }
    if (q) {
      acknowledgeDeliveries(cwd, q, verdicts);
      saveQueue(cwd, refreshStates(cwd, q));
    }
    return { verdicts, reconciled: verdicts.length };
  });
}

// ── 派发循环（拍板 5）：锁内门序→逐项串行→结算→腾槽→下一项 ──
// deps 注入（测试家法）：deps.run→spawnHeadless、deps.drive→runDrive 替身、deps.enginePath。

// 派发前拒绝检查（0.3.1 棒1，§一.F.1；非抛——返回 reason 字符串或 null）：在锁内门序、
// openTx **之前**判，拒绝即 item failed+指路 + {stop}（不 openTx ⇒ 零 killed-inflight、
// 无未决占用、不误触 pointsStopped；且不以 throw 表达——throw 会落进大 catch 把 item 回 ready）。
function preDispatchCheck(cwd, item) {
  for (const ep of deliveryEpsOf(item)) {
    const { path, hash } = item.delivery[ep];
    let cur = null;
    try {
      cur = loadContract(path, cwd).hash;
    } catch (e) {
      return `交付契约不可读/无效（${ep}）：${String(e?.message ?? e).slice(0, 120)}——修复后重新入队`;
    }
    if (cur !== hash) {
      return `交付契约已改=新哈希（${ep}）：入队 ${hash.slice(0, 8)}… vs 现值 ${String(cur).slice(0, 8)}…——重新入队并重新批准`;
    }
  }
  if (item.tier === "heavy" && item.planHash) {
    let curPlan = null;
    try {
      curPlan = createHash("sha256").update(readFileSync(resolve(cwd, item.planPath))).digest("hex");
    } catch {
      return `计划不可读：${item.planPath}——修复后重新派发`;
    }
    if (curPlan !== item.planHash) {
      return `计划已改=评审作废（入队 ${item.planHash.slice(0, 8)}… vs 现值 ${curPlan.slice(0, 8)}…）——重新评审后重入队`;
    }
  }
  return null;
}

// 交付链基建中止（0.3.1 棒1，§一.F.3②；R3 评审实证：回 ready 是死环——交付链仅在 finishOk
// 后开跑 ⇒ goal 已 done ⇒ 下轮 bindDeliveryContract 状态闸必抛，残留 open tx 又被判交付未竟）。
// 捕获点即落：item failed+「基建中止」+ tx 锁内诚实收束（killed）+ 交付墙钟条目 + drive 段结算。
function abortDelivery(cwd, txId, item, cause, queryPoints) {
  withLock(cwd, () => {
    const q = loadQueue(cwd);
    const it = q.items.find((x) => x.id === item.id);
    if (it && !TERMINAL_STATES.includes(it.state)) {
      it.state = "failed";
      it.blockedReason = `基建中止：${String(cause).slice(0, 160)}——非交付失败；处置根因后重新入队`;
      it.updatedAt = new Date().toISOString();
      saveQueue(cwd, q);
    }
    const txNow = patchTx(cwd, txId, {});
    if (Array.isArray(txNow.segments) && txNow.segments.length > 0) {
      settleTxLedger(cwd, { tx: txNow, item, provenance: `tx:${txId}`, queryPoints });
    }
    appendLedgerEntry(cwd, {
      kind: "wall", dedupKey: `wall:${txId}:delivery`,
      authorization: { slug: item.goalSlug, contractHash: item.contractHash },
      provenance: `tx:${txId}:delivery`, itemId: item.id, txId, sessionId: null,
      ms: Math.max(0, Date.now() - (txNow.deliveringSinceMs ?? Date.now())),
      note: `交付链墙钟（观测上界）；基建中止：${String(cause).slice(0, 100)}`,
    });
    patchTx(cwd, txId, { phase: "killed", settledAt: new Date().toISOString(), note: `交付链基建中止（${String(cause).slice(0, 120)}）——终局稳定；不回 ready（回 ready 是死环）` });
  });
  return { ok: false, abort: true, note: `基建中止：${String(cause).slice(0, 160)}` };
}

// 交付链（0.3.1 棒1，§一.F.3）：逐 ep（B→C）——先查意图账本（本 item 来源 origin ∧ endpoint
// ∧ done 即跳过 act：幂等重派/崩溃续跑）；act→readback；per-ep 异常二分（有本轮意图=确定性
// 失败⇒分类取账本最新 attempt，不取异常文案；无意图=基建类⇒abortDelivery）。绝不外抛。
function runDeliveryChain(cwd, { item, txId, queryPoints, deps = {} }) {
  const readIntents = () => {
    try {
      return loadIntents(cwd)?.intents ?? [];
    } catch {
      return null;
    }
  };
  for (const ep of requiredActsFor(item)) {
    let list = readIntents();
    if (list === null) return abortDelivery(cwd, txId, item, "意图账本不可读（fail-closed）", queryPoints);
    const mine = () => (readIntents() ?? []).filter((x) => x.origin?.itemId === item.id && x.endpoint === ep);
    // 幂等跳过：意图 done ⇒ 不重发动作（不可逆外发绝不重复）；是否**达成**由下方结果谓词判
    const origin = { kind: "queue", itemId: item.id, slug: item.goalSlug };
    try {
      if (ep === "B") {
        const opts = { origin };
        const c = (() => {
          try {
            return loadContract(item.delivery.B.path, cwd);
          } catch {
            return null;
          }
        })();
        if (!c?.prBody) {
          // pr-body 缺省=桥生成（item 标题+契约 task+attestation 指针）
          const rel = join(".lazyzcode", "delivery", `pr-body-${item.id}.md`);
          mkdirSync(dirname(join(cwd, rel)), { recursive: true });
          writeFileSync(join(cwd, rel), `# ${item.title}\n\n队列条目 ${item.id} · goal ${item.goalSlug} · 契约 ${item.contractHash.slice(0, 8)}…\n\n交付契约：${c?.task ?? "(不可读)"}\n`);
          opts.prBodyFile = rel;
        }
        actDeliveryB(cwd, opts, deps);
        try {
          readbackDeliveryB(cwd, {}, deps);
        } catch {
          /* 读回失败=保持账本现状，分类由下方账本判决给出 */
        }
      } else {
        actDeliveryC(cwd, { origin }, deps);
        try {
          readbackDeliveryC(cwd, {}, deps);
        } catch {
          /* 同上 */
        }
      }
    } catch (err) {
      const msg = String(err?.message ?? err);
      const after = readIntents();
      if (after !== null && after.filter((x) => x.origin?.itemId === item.id && x.endpoint === ep).length === 0) {
        // 无本轮意图的两类分流（0.3.1 棒1 细化，试点实证）：
        // ①确定性前置拒绝（授权门/未绑定/非 executing 族——beginAct 门序先于意图落账）⇒ 交付前置
        //   拒绝，走正常完成写入（failed+「交付未竟：交付前置拒绝」），绝不标「基建中止」；
        // ②其余（withLock 5s 死线/意图账本损坏等基建类）⇒ abortDelivery（不回 ready，死环有实证）。
        if (/授权门拒绝|未绑定|非 executing|交付授权/.test(msg)) {
          return { ok: false, note: `交付前置拒绝：${msg.slice(0, 160)}` };
        }
        return abortDelivery(cwd, txId, item, msg.slice(0, 160), queryPoints);
      }
      try {
        if (ep === "B") readbackDeliveryB(cwd, {}, deps);
        else readbackDeliveryC(cwd, {}, deps);
      } catch {
        /* 读回失败=分类取账本现状 */
      }
    }
    const finals = mine();
    const latest = finals.length > 0 ? finals[finals.length - 1] : null;
    // 端点达成判据=结果谓词（0.3.1 收口 R0.3）：done 且判据满足才 continue；
    // done 但未验证（merge CI 非绿/页面未全过）⇒ 不重发动作，如实报未达成（恢复走 readback）。
    const epVerdict = deliveryResultVerdict(finals, item, { endpoints: [ep] });
    if (epVerdict.ok) continue;
    const lastAttempt = latest?.attempts?.[latest.attempts.length - 1];
    const detail = lastAttempt?.detail ? `（${String(lastAttempt.detail).slice(0, 120)}）` : "";
    const tail = latest?.status === "done" ? "已合并未验证——恢复=lzy delivery readback " + ep + " 复验，绝不重发" : `${lastAttempt?.method ?? "?"}/${lastAttempt?.outcome ?? "?"}`;
    return { ok: false, note: `${ep} ${epVerdict.unmet.join("、")}：${tail}${detail}` };
  }
  return { ok: true, note: null };
}

export async function runQueueDispatch(cwd, opts = {}, deps = {}) {
  const onlyItem = typeof opts.item === "string" ? opts.item : null;
  const results = [];
  let stopMsg = null;
  const queryPoints = deps.querySessionPoints ?? querySessionPoints;
  // 1) 恢复判定表先行（先核对后动作）
  const rec = reconcileDispatch(cwd, deps);
  for (const v of rec.verdicts) console.log(`[queue] 恢复核对：${v.txId} → ${v.verdict}`);
  for (;;) {
    // 2) 锁内门序：取项+占用登记
    const plan = withLock(cwd, () => {
      let q = loadQueue(cwd);
      if (!q) return { stop: "队列为空" };
      q = refreshStates(cwd, q);
      saveQueue(cwd, q);
      const v = budgetView(cwd);
      const candidates = q.items.filter((x) => (onlyItem ? x.id === onlyItem : true));
      const ready = candidates.filter((x) => x.state === "ready");
      const running = candidates.find((x) => x.state === "running");
      if (running) {
        return { stop: `条目 ${running.id} 已在运行（未决派发事务在案）——不重复派发`, kind: "busy" };
      }
      const nonReady = candidates.filter((x) => ["proposed", "authorized", "blocked"].includes(x.state));
      if (ready.length === 0) {
        const pending = nonReady.filter((x) => x.state !== "cancelled");
        if (pending.length > 0 && v.pointsStopped) {
          return { stop: "无 ready 项且受积分限额约束的派发已停止（计量缺席/未决占用在案，#32）——lzy queue budget --resume-points 人工恢复", kind: "points-stopped" };
        }
        // 止步原因带 readiness 明细（CI 偶发「无 ready」的自诊断面——2026-09-25 首链试点）。
        const reasons = pending.slice(0, 3).flatMap((x) => describeReadiness(cwd, x, v).reasons.map((r) => `${x.id}:${r}`));
        const why = reasons.length > 0 ? `——原因：${reasons.join("；")}` : "";
        return { stop: onlyItem ? `条目 ${onlyItem} 非 ready${why}` : `无 ready 项（全部终态或未就绪）${why}`, kind: "idle" };
      }
      const item = ready.sort((a, b) => a.seq - b.seq)[0];
      // 派发前拒绝（0.3.1 棒1，§一.F.1）：非 throw——锁内落 item failed+指路 + {stop}（不 openTx）。
      const rejectReason = preDispatchCheck(cwd, item);
      if (rejectReason) {
        const it = q.items.find((x) => x.id === item.id);
        it.state = "failed";
        it.blockedReason = rejectReason;
        it.updatedAt = new Date().toISOString();
        saveQueue(cwd, q);
        return { stop: `条目 ${item.id} 派发前拒绝：${rejectReason}`, kind: "rejected" };
      }
      // 占用登记=锁内 pre-spawn 写 tx（未决时按上限保守计入——崩溃不假零）
      const remainWall = v.wallRemainingMs;
      const wallMs = Number.isInteger(opts.wallMs) && opts.wallMs > 0
        ? (remainWall != null ? Math.min(opts.wallMs, remainWall) : opts.wallMs)
        : (remainWall != null && remainWall > 0 ? remainWall : opts.wallMs ?? null);
      if (v.wallLimitMs != null && (remainWall == null || remainWall <= 0)) {
        return { stop: "墙钟总额已尽（含未决占用）——停止该授权批次派发", kind: "budget" };
      }
      if (v.pointsExhausted || v.pointsStopped) {
        return { stop: "积分总额已尽或计量在案（#32）——停止下一次派发", kind: "budget" };
      }
      const tx = openTx(cwd, item, { wallMs, points: v.pointsLimit });
      item.state = "running";
      item.updatedAt = new Date().toISOString();
      saveQueue(cwd, q);
      return { item: { ...item }, tx };
    });
    if (plan.stop) {
      console.log(`[queue] ${plan.stop}`);
      stopMsg = plan.stop; // 止步原因独立出参（results 只装逐项结局）
      break;
    }
    const { item, tx } = plan;
    console.log(`[queue] 派发 ${item.id}（${item.title}）tx=${tx.txId} goal=${item.goalSlug}`);
    // 3) goal 生命周期：核对现行 goal——同 slug executing=续跑；无槽位=注册；异 slug 活跃=停
    const slot = (() => {
      try {
        return readGoal(cwd);
      } catch {
        return null;
      }
    })();
    if (slot && slot.slug !== item.goalSlug && slot.status === "executing") {
      patchTx(cwd, tx.txId, { phase: "reconciled-orphan", settledAt: new Date().toISOString(), note: "现行 goal 为另一活跃目标——队列绝不越权处置" });
      withLock(cwd, () => {
        const q = loadQueue(cwd);
        const it = q.items.find((x) => x.id === item.id);
        it.state = "failed";
        it.blockedReason = `槽位被另一活跃目标占用（${slot.slug}）——人工核对后处置`;
        it.updatedAt = new Date().toISOString();
        saveQueue(cwd, q);
      });
      results.push({ item: item.id, outcome: "failed", cause: "槽位被他目标占用" });
      break;
    }
    try {
      if (!slot || slot.slug !== item.goalSlug) {
        // 腾槽（仅 done/缺失态可达此处——executing 异 slug 已在上面的分支挡住）：
        // 完成归档+队列确认之后才 reset 腾槽（契约 A4；done 槽位由前一确认路径清理）
        if (slot) {
          resetLoop(cwd, createGit(cwd));
          console.log(`[queue] 槽位已腾（前目标 ${slot.slug} 已归档确认）`);
        }
        const contractAbs = resolve(cwd, item.contractPath);
        const itemTier = item.tier ?? "light";
        const itemRisk = item.risk ?? "low";
        registerGoal(cwd, item.goalSlug, item.title, { tier: itemTier, risk: itemRisk, contract: contractAbs });
        const planAbs = resolve(cwd, item.planPath);
        // HEAVY 透传入队前评审 PASS（ADR-0030 §一.G；采纳门机器校 PASS 形态）；light 走现行合成串（逐字不变）
        const review = itemTier === "heavy"
          ? item.planReview
          : `queue-dispatch: 契约内采纳（批准绑 contractHash=${item.contractHash.slice(0, 8)}）`;
        adoptPlan(cwd, planAbs, { review });
        startLoop(cwd, createGit(cwd));
        console.log(`[queue] goal ${item.goalSlug} 已注册采纳并开跑（${itemTier.toUpperCase()}）`);
      } else {
        console.log(`[queue] goal ${item.goalSlug} 仍 executing——同 goal 续跑（不重复注册）`);
      }
      // 3.5) 交付契约绑定（0.3.1 棒1，§一.F.2）：goal 此刻 executing（register+start 后）；
      // 门序已验现字节哈希（preDispatchCheck），此处四参齐 bind（幂等=同哈希重绑覆写同值）。
      const declaredEps = deliveryEpsOf(item);
      for (const ep of declaredEps) {
        bindDeliveryContract(cwd, ep, item.delivery[ep].path, item.delivery[ep].hash);
      }
      if (declaredEps.length > 0) console.log(`[queue] 交付契约已绑定：${declaredEps.join("/")}（goal ${item.goalSlug}）`);
      // 4) 执行（单工 drive；段记录入 tx——结算输入）
      const segmentRecords = [];
      const driveRes = await (deps.drive
        ? deps.drive(cwd, { wallMs: tx.limits.wallMs ?? undefined, maxSegments: opts.maxSegments, mode: opts.mode, segmentRecords }, deps)
        : runDrive(cwd, { wallMs: tx.limits.wallMs ?? undefined, maxSegments: opts.maxSegments, mode: opts.mode, segmentRecords }, deps));
      patchTx(cwd, tx.txId, { segments: segmentRecords });
      const git = createGit(cwd);
      // 5) 收束：windDown(false)=item failed；ok→finish；finish 拒=未竟（回 ready 不假完成）
      if (!driveRes.ok) {
        withLock(cwd, () => {
          const q = loadQueue(cwd);
          const it = q.items.find((x) => x.id === item.id);
          it.state = "failed";
          it.blockedReason = `drive 失败：${String(driveRes.cause ?? "未知").slice(0, 200)}`;
          it.updatedAt = new Date().toISOString();
          saveQueue(cwd, refreshStates(cwd, q));
        });
        patchTx(cwd, tx.txId, { phase: "settled", settledAt: new Date().toISOString(), note: `drive 失败收束（${String(driveRes.cause ?? "").slice(0, 120)}）——消耗如实结算` });
        settleTxLedger(cwd, { tx: patchTx(cwd, tx.txId, {}), item, provenance: `tx:${tx.txId}`, queryPoints });
        results.push({ item: item.id, outcome: "failed", cause: String(driveRes.cause ?? "") });
        // 队列自有 goal 随失败项终态而成死工作——腾槽（queue-owned 家务，非「另一目标」；
        // A4 红线保护的是队列不拥有的 goal，⑧ 分支已挡）
        resetLoop(cwd, createGit(cwd));
        console.log(`[queue] ${item.id} 失败收束：槽位已腾（失败项 goal 归档清理）`);
        break; // 失败依赖阻塞：止步本批（独立 ready 项待下次 dispatch）
      }
      let finishOk = true;
      let finishCause = null;
      try {
        const g = readGoal(cwd);
        if (g && g.status === "executing") finishLoop(cwd, git, {});
        else if (g && g.status === "done") finishOk = true;
      } catch (err) {
        finishOk = false;
        finishCause = String(err?.message ?? err).slice(0, 200);
      }
      // 5.5) 交付链（0.3.1 棒1，§一.F.3）：仅 finishOk=true 时执行；在下方 withLock 之外
      //（delivery 写面各自 withLock——嵌套会 5s 死线）。进链前打 tx 在途标记（活性判据用）。
      let deliveryOk = true;
      let deliveryNote = null;
      let deliveryAborted = false;
      if (finishOk && declaredEps.length > 0) {
        patchTx(cwd, tx.txId, { note: "delivery-in-flight", deliveringSinceMs: Date.now(), deliveringPid: process.pid });
        const outcome = runDeliveryChain(cwd, { item, txId: tx.txId, queryPoints, deps });
        if (outcome.abort) {
          // 基建中止：捕获点已落（failed+「基建中止」+tx killed+墙钟条目+drive 段结算）——跳过完成写入
          results.push({ item: item.id, outcome: "failed", cause: outcome.note });
          console.log(`[queue] ${item.id} ${outcome.note}`);
          break;
        }
        deliveryOk = outcome.ok;
        deliveryNote = outcome.note;
        deliveryAborted = outcome.abort === true;
      }
      withLock(cwd, () => {
        const q = loadQueue(cwd);
        const it = q.items.find((x) => x.id === item.id);
        // 结算（消耗事实账，幂等）
        const txNow = patchTx(cwd, tx.txId, {});
        const settled = settleTxLedger(cwd, { tx: txNow, item: it, provenance: `tx:${tx.txId}`, queryPoints });
        if (declaredEps.length > 0) {
          // 交付段墙钟入账（ADR-0030 §4「不计积分、计入墙钟」；路径覆盖=成功/未竟/基建中止
          //（后者在 abortDelivery 内已入账，dedupKey 幂等兜底）；死亡路径在 reconcile 侧入账）。
          appendLedgerEntry(cwd, {
            kind: "wall", dedupKey: `wall:${tx.txId}:delivery`,
            authorization: { slug: item.goalSlug, contractHash: item.contractHash },
            provenance: `tx:${tx.txId}:delivery`, itemId: item.id, txId: tx.txId, sessionId: null,
            ms: Math.max(0, Date.now() - (txNow.deliveringSinceMs ?? Date.now())),
            note: deliveryOk ? "交付链墙钟（观测；成功）" : "交付链墙钟（观测；交付未竟）",
          });
        }
        if (finishOk && deliveryOk) {
          it.state = "completed";
          it.completedEndpoint = item.endpoint;
          it.updatedAt = new Date().toISOString();
          patchTx(cwd, tx.txId, { phase: "settled", settledAt: new Date().toISOString(), note: `完成（endpoint ${item.endpoint}）：wall ${settled.wallEntries} 段/积分 ${Math.round(settled.points * 100) / 100}` });
          console.log(`[queue] ${item.id} 完成（endpoint ${item.endpoint}）：墙钟 ${settled.wallEntries} 段 · 积分 ${Math.round(settled.points * 100) / 100}`);
        } else if (finishOk && !deliveryOk) {
          // 交付未竟：goal 已 done 且 attestation 在案——终态 failed + 人工恢复指路（含轻路线）
          it.state = "failed";
          it.blockedReason = `交付未竟：${deliveryNote ?? "未知"}——goal 已 done 且 attestation 在案；恢复=lzy delivery act <ep> --origin-item ${item.id}（或 readback 复验）后 lzy queue reconcile 追认，勿重跑目标`;
          it.updatedAt = new Date().toISOString();
          patchTx(cwd, tx.txId, { phase: "settled", settledAt: new Date().toISOString(), note: `交付未竟（${String(deliveryNote ?? "").slice(0, 120)}）——消耗如实结算` });
          console.log(`[queue] ${item.id} 交付未竟（${String(deliveryNote ?? "").slice(0, 120)}）——failed+指路，勿重跑目标`);
        } else {
          it.state = "ready"; // 未竟：回 ready 待续（重驱同 goal 续跑）——不以假完成收场
          it.updatedAt = new Date().toISOString();
          patchTx(cwd, tx.txId, { phase: "killed", settledAt: new Date().toISOString(), note: `未竟（finish 未过：${finishCause ?? "未知"}）——消耗如实结算，item 回 ready` });
          console.log(`[queue] ${item.id} 未竟（${finishCause ?? "finish 未过"}）——消耗已结算，item 回 ready 待续`);
        }
        saveQueue(cwd, refreshStates(cwd, q));
      });
      const finalItem = withLock(cwd, () => loadQueue(cwd).items.find((x) => x.id === item.id));
      results.push({ item: item.id, outcome: finalItem.state, cause: finishCause });
      if (finalItem.state !== "completed") break;
      // 6) 腾槽：完成归档+队列确认之后才 reset（契约 A4）
      resetLoop(cwd, createGit(cwd));
      console.log(`[queue] ${item.id} 队列确认完毕，槽位已腾`);
    } catch (err) {
      // 基建/门异常：tx 保持 open（未决占用不假零），item 回 ready，止步并如实上报
      withLock(cwd, () => {
        const q = loadQueue(cwd);
        const it = q?.items.find((x) => x.id === item.id);
        if (it && it.state === "running" && !TERMINAL_STATES.includes(it.state)) {
          it.state = "ready";
          it.updatedAt = new Date().toISOString();
          saveQueue(cwd, q);
        }
      });
      results.push({ item: item.id, outcome: "error", cause: String(err?.message ?? err).slice(0, 300) });
      console.log(`[queue] 派发异常（tx ${tx.txId} 保持未决——未决占用不作零消耗）：${String(err?.message ?? err).slice(0, 300)}`);
      break;
    }
    if (onlyItem) break; // --item 单项派发
  }
  return { results, stop: stopMsg };
}

// ── 读面 ──

// 派生状态刷新（authorized/ready/blocked 重估）的显式出口：list/show/捕获面调用，
// 让「批准→authorized→ready」的状态机转移在读写面上可见（而非只在 dispatch 内部发生）。
export function refreshQueue(cwd) {
  return withLock(cwd, () => {
    const q = loadQueue(cwd);
    if (!q) return null;
    saveQueue(cwd, refreshStates(cwd, q));
    return q;
  });
}

export function formatQueueList(cwd) {
  refreshQueue(cwd);
  const q = loadQueue(cwd);
  if (!q || q.items.length === 0) return "队列空（lzy queue add 建条目）";
  const v = budgetView(cwd);
  const lines = [];
  lines.push(
    `队列 ${q.items.length} 项 · 预算：积分 ${v.pointsLimit ?? "∞"}${v.pointsLimit != null ? `（已耗 ${Math.round(v.points * 100) / 100} + 未决占用 ${Math.round(v.openPoints * 100) / 100}）` : ""}` +
      ` · 墙钟 ${v.wallLimitMs != null ? `${v.wallLimitMs}ms` : "∞"}${v.wallLimitMs != null ? `（已耗 ${v.wallMs}ms + 未决 ${v.openWallMs}ms）` : ""}` +
      `${v.pointsStopped ? " · ⚠ 受积分限额约束的派发已停止（#32 计量在案）" : ""}`,
  );
  for (const it of q.items) {
    let tail = "";
    if (it.state === "completed") tail = `（endpoint ${it.completedEndpoint}）`;
    else if (it.blockedReason) tail = `（${it.blockedReason.slice(0, 80)}）`;
    else if (it.state === "proposed" || it.state === "authorized") {
      const { reasons } = describeReadiness(cwd, it, v);
      if (reasons.length > 0) tail = `（未就绪：${reasons[0].slice(0, 80)}）`;
    }
    lines.push(`  ${it.id}  ${it.state.padEnd(9)} ${it.title.slice(0, 60)}${tail}`);
  }
  return lines.join("\n");
}

export function showQueueItem(cwd, id) {
  refreshQueue(cwd);
  const q = loadQueue(cwd);
  const it = q?.items.find((x) => x.id === id);
  if (!it) throw new QueueError(`未知条目：${id}`);
  const d = loadDispatch(cwd);
  const txs = (d?.txs ?? []).filter((t) => t.itemId === id);
  const readiness = TERMINAL_STATES.includes(it.state) ? { ready: false, reasons: [] } : describeReadiness(cwd, it);
  return { item: it, txs, readiness };
}
