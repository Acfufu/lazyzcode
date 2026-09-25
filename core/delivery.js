// 交付面（0.3.0 M4，ADR-0028）：B/C 外部动作的授权门、意图/读回账本与受控 gh 执行。
// 家族 .lazyzcode/delivery/（loop/ 外 reset 不清，位阶同 authorizations/、queue/、budget/）：
//   intents.json —— 交付意图账本（校验和家法同 queue.js loadFamilyFile/saveFamilyFile）。
// 授权模型：B 与 C 各立独立 delivery 契约（endpoint 入哈希，contract.js 解析复用）；批准
// 复用 contractPending UPS 通道（goal.json 写面归 loop.js bindDeliveryContract，钩子批准
// 分支零改动即生效）；撤回面=trigger.js 短码匹配集合扩展 [goal.contract, …goal.delivery]。
// 纪律（V09/V10/V11）：意图先于动作落账；动作后读回核对；done 恒拒再执行（防重复写入）；
// 超时/断连=unknown，读回分类后方可收束；合并前置=B∧C 双授权（main=Pages 发布源，主方案
// §6）+PR head/base 漂移复核+PR headSha CI 全绿。
// 外部面注入缝：gh=LZY_GH_BIN（verify.js:552 家法）· git/curl=deps 注入+LZY_CURL_BIN；
// 缝仅供测试与平台回落，绝不作生产逃生旗标——授权门唯一消融缝=LZY_ABLATE_HUMAN_GATE
// 家法（命中时意图记录 stamped=ablated，如实记账）。本模块全部同步（轮询用同步睡眠：
// CLI 进程独占事件循环，Atomics.wait 家法）。
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname, basename, relative } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { loadContract, effectiveAuthorization, ContractError } from "./contract.js";
import { readGoal, withLock, LoopError } from "./loop.js";

export const DELIVERY_VERSION = 1;
export const DELIVERY_ENDPOINTS = ["B", "C"];
export const INTENT_KINDS = ["merge-chain", "pages-verify"];
export const INTENT_STATUSES = ["intended", "acting", "unknown", "done", "failed", "refused"];
// act 允许的起点态：intended=首跑或读回 re-arm；failed/refused=同身份重试（门序全重走）。
// acting/unknown=在途或结果未定，一律先 readback 收束；done=终态恒拒（防重复执行，V10）。
export const ACTABLE_STATUSES = ["intended", "failed", "refused"];
// 轮询预算（拍板 5/7）：PR headSha 与 merge SHA 各 15s×≤12；Pages 构建 15s×≤10。
export const CI_POLL_INTERVAL_MS = 15_000;
export const CI_POLL_MAX = 12;
export const PAGES_POLL_INTERVAL_MS = 15_000;
export const PAGES_POLL_MAX = 10;
const MERGE_CI_STATE = ["green", "pending", "failed"];

export class DeliveryError extends Error {}

const RECOVERY =
  "恢复：本家族在 loop/ 外、reset 不触及；先备份再人工核对 .lazyzcode/delivery/intents.json" +
  "（丢失只损失意图记账，不影响 goal/授权权威面），确认后删除可用 lzy delivery act 重新声明";

function intentsPath(cwd) {
  return join(cwd, ".lazyzcode", "delivery", "intents.json");
}

function checksumOf(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

// ── 形状断言（schemaVersion 家法：机器面不信任盘上字节）──

function assertIntent(it, p) {
  const bad = (msg) => {
    throw new DeliveryError(`交付意图形状畸形（${msg}）：${p ?? "memory(写入前)"}。${RECOVERY}`);
  };
  if (!it || typeof it !== "object") bad("非对象");
  if (!/^\bd\d+$/.test(String(it.id))) bad(`id=${it.id}`);
  if (!DELIVERY_ENDPOINTS.includes(it.endpoint)) bad(`endpoint=${it.endpoint}`);
  if (!INTENT_KINDS.includes(it.kind)) bad(`kind=${it.kind}`);
  if (!INTENT_STATUSES.includes(it.status)) bad(`status=${it.status}`);
  if (!it.target || typeof it.target !== "object") bad("target 缺席");
  if (it.target.repo !== undefined && typeof it.target.repo !== "string") bad("target.repo 类型");
  if (!Array.isArray(it.attempts)) bad("attempts 非数组");
  for (const a of it.attempts) {
    if (!a || typeof a !== "object" || typeof a.at !== "string" || typeof a.method !== "string" || typeof a.outcome !== "string") {
      bad("attempts 条目缺 at/method/outcome");
    }
  }
  if (it.observed !== null && it.observed !== undefined && typeof it.observed !== "object") bad("observed 类型");
  if (it.observed?.mergeCiState != null && !MERGE_CI_STATE.includes(it.observed.mergeCiState)) bad(`mergeCiState=${it.observed.mergeCiState}`);
}

function assertIntents(state, p) {
  if (!state || typeof state !== "object") throw new DeliveryError(`交付意图账本形状畸形（非对象）：${p}。${RECOVERY}`);
  if (!Number.isInteger(state.lastSeq) || state.lastSeq < 0) throw new DeliveryError(`交付意图账本形状畸形（lastSeq=${state.lastSeq}）：${p}。${RECOVERY}`);
  if (!Array.isArray(state.intents)) throw new DeliveryError(`交付意图账本形状畸形（intents 非数组）：${p}。${RECOVERY}`);
  for (const it of state.intents) assertIntent(it, p);
}

// 读意图账本：仅 ENOENT 视缺席；JSON/校验和/版本/形状四层 fail-closed（queue.js 家法：
// 不可读被静默当缺席时，下一写命令会整文件覆写）。
export function loadIntents(cwd) {
  const p = intentsPath(cwd);
  let text;
  try {
    text = readFileSync(p, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw new DeliveryError(`交付意图账本不可读（${err?.code ?? err?.message ?? err}）：${p}。${RECOVERY}`);
  }
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new DeliveryError(`交付意图账本损坏（JSON 解析失败）：${p}。${RECOVERY}`);
  }
  const { checksum, ...rest } = obj ?? {};
  if (checksum !== checksumOf(rest)) {
    throw new DeliveryError(`交付意图账本校验和不符（内容与落盘时态不一致）：${p}。${RECOVERY}`);
  }
  if (rest.schemaVersion !== DELIVERY_VERSION) {
    throw new DeliveryError(`交付意图账本版本不兼容（盘上 v${rest.schemaVersion}，本 lzy 期望 v${DELIVERY_VERSION}）：${p}。${RECOVERY}`);
  }
  assertIntents(rest, p);
  return rest;
}

// 原子写：tmp 0600+rename（runtime.js:139-159 家法）；tmp 落家族根顶层（ANY_TMP_SCAN_DIRS
// 只扫顶层）；写前形状校验+单调护栏（lastSeq 不可回退，防旧态整文件覆写）。
export function saveIntents(cwd, state) {
  const p = intentsPath(cwd);
  const normalized = { ...state, schemaVersion: DELIVERY_VERSION };
  assertIntents(normalized, "memory(写入前)");
  let disk = null;
  try {
    disk = loadIntents(cwd);
  } catch (err) {
    throw new DeliveryError(`${err.message}\n写护栏拒绝落盘（不覆写不可读账本）`);
  }
  if (disk && normalized.lastSeq < disk.lastSeq) {
    throw new DeliveryError(`交付意图账本写护栏：本次 lastSeq（${normalized.lastSeq}）低于盘上（${disk.lastSeq}），单调序不可回退：${p}。重跑当前命令以重新加载现值`);
  }
  mkdirSync(dirname(p), { recursive: true });
  const out = { ...normalized, checksum: checksumOf(normalized) };
  const tmp = join(dirname(p), `.${basename(p)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, p);
}

// 状态机（拍板 4）：intended→acting→done|failed|refused|unknown；acting/unknown 经 readback
// 收束（merged→done(observed)、open→intended re-arm）；failed/refused→acting=同身份重试
//（门序全重走）；done 恒终——任何进入 done 的迁移不可逆（防重复执行）。
const TRANSITIONS = {
  intended: ["acting"],
  acting: ["done", "failed", "refused", "unknown", "intended"], // intended 仅经 readback（open：合并未发生）
  unknown: ["done", "intended", "failed"], // readback 分类：merged→done / open→intended / 失败确证→failed
  failed: ["acting", "intended"], // 同身份重试（act）或 readback 复核
  refused: ["acting", "intended"], // 同上（拒绝后修复门序条件可重试）
  done: [],
};

export function assertTransition(from, to) {
  if (!(TRANSITIONS[from] ?? []).includes(to)) {
    throw new DeliveryError(`交付意图状态机非法转移：${from}→${to}（done 恒终；acting/unknown 先 readback 收束）`);
  }
}

// ── 外部面原语（注入缝见文件头）──

export function syncSleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// gh 面：LZY_GH_BIN 缝（verify.js:552 家法）。timedOut=超时/被信号杀——调用方按 unknown
// 语义处理（结果未定≠失败）。
export function ghApi(deps, args, { timeoutMs = 30_000 } = {}) {
  const ghBin = process.env.LZY_GH_BIN || "gh";
  const run = deps?.ghApi ?? ((a, o) => {
    const r = spawnSync(ghBin, a, { shell: false, timeout: o?.timeoutMs ?? 30_000, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error ?? null, signal: r.signal ?? null };
  });
  const r = run(args, { timeoutMs });
  const timedOut = r.signal != null || r.error?.code === "ETIMEDOUT";
  return { ...r, timedOut };
}

// git push（可逆外部动作，但网络超时=结果未定→unknown 语义）。
function gitPushDefault(cwd, branch, { timeoutMs = 120_000 } = {}) {
  const r = spawnSync("git", ["push", "origin", branch], { cwd, shell: false, timeout: timeoutMs, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error ?? null, signal: r.signal ?? null, timedOut: r.signal != null || r.error?.code === "ETIMEDOUT" };
}

// HTTPS 只读抓取（Pages 内容核验）：curl 同步面（macOS/win10+ 原生 curl；prlctl VM 家法）。
export function curlGet(deps, url, { timeoutMs = 15_000 } = {}) {
  const curlBin = process.env.LZY_CURL_BIN || "curl";
  const run = deps?.curlGet ?? ((u, o) => {
    const r = spawnSync(curlBin, ["-sS", "-L", "--max-time", String(Math.ceil((o?.timeoutMs ?? 15_000) / 1000)), u], {
      shell: false, timeout: o?.timeoutMs ?? 15_000, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    });
    return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error ?? null, signal: r.signal ?? null };
  });
  const r = run(url, { timeoutMs });
  return { ...r, timedOut: r.signal != null || r.error?.code === "ETIMEDOUT" };
}

// gh pr view 归一：mergeCommit 在 gh 的 JSON 里是 {oid,…} 对象（旧版可能为串）。
export function prView(deps, repo, ref) {
  const r = ghApi(deps, ["pr", "view", String(ref), "--repo", repo, "--json", "state,headRefOid,baseRefName,number,url,mergeCommit"]);
  if (r.code !== 0) return { ok: false, ...r };
  let pr;
  try {
    pr = JSON.parse(r.stdout);
  } catch {
    return { ok: false, ...r, parseError: true };
  }
  return {
    ok: true,
    state: pr.state,
    headRefOid: pr.headRefOid ?? null,
    baseRefName: pr.baseRefName ?? null,
    number: pr.number ?? null,
    url: pr.url ?? null,
    mergeSha: pr.mergeCommit?.oid ?? pr.mergeCommit ?? null,
    raw: r,
  };
}

// check-runs 裁决：全 COMPLETED 且 conclusion ∈ {SUCCESS,NEUTRAL,SKIPPED}=绿；零 run=尚未开始。
export function checkRunsVerdict(runs) {
  if (!Array.isArray(runs) || runs.length === 0) return { present: false, completed: false, ok: false, bad: [], pending: 0 };
  const bad = runs.filter((c) => c.status === "COMPLETED" && !["SUCCESS", "NEUTRAL", "SKIPPED"].includes(c.conclusion)).map((c) => `${c.name}:${c.conclusion}`);
  const pending = runs.filter((c) => c.status !== "COMPLETED").length;
  return { present: true, completed: pending === 0, ok: bad.length === 0 && pending === 0, bad, pending };
}

export function listCheckRuns(deps, repo, sha) {
  const r = ghApi(deps, ["api", `repos/${repo}/commits/${sha}/check-runs`, "--jq", "[.check_runs[] | {name, status, conclusion}]"]);
  if (r.code !== 0) return { ok: false, ...r };
  try {
    const runs = JSON.parse(r.stdout);
    if (!Array.isArray(runs)) return { ok: false, ...r, parseError: true };
    return { ok: true, runs };
  } catch {
    return { ok: false, ...r, parseError: true };
  }
}

// ── 授权与意图公共面 ──

// delivery 契约校验（request 面）：contract.js 解析复用；endpoint 须与请求面一致
//（B/C 各立独立契约，endpoint 入哈希——授权账本 record 形状零扩展，ADR-0028）。
export function validateDeliveryContract(cwd, ep, contractPath) {
  if (!DELIVERY_ENDPOINTS.includes(ep)) {
    throw new DeliveryError(`delivery 契约请求面非法：${ep}（合法：B|C——B 合并主干 / C 上线验证）`);
  }
  let loaded;
  try {
    loaded = loadContract(contractPath, cwd);
  } catch (e) {
    throw new DeliveryError(`delivery 契约无效：${e?.message ?? e}`);
  }
  if (loaded.endpoint !== ep) {
    throw new ContractError(`delivery 契约 endpoint 不匹配：文件=${loaded.endpoint}，请求=${ep}（B/C 各立独立契约——endpoint 入哈希，混绑=授权面失真）`);
  }
  return { hash: loaded.hash, path: relative(cwd, loaded.path) || loaded.path, task: loaded.task };
}

function requireDeliveryContext(cwd, ep) {
  if (!DELIVERY_ENDPOINTS.includes(ep)) {
    throw new DeliveryError(`delivery 端点非法：${ep}（合法：B|C）`);
  }
  const goal = readGoal(cwd);
  if (!goal) throw new DeliveryError("本目录没有进行中的目标——delivery 授权与意图挂 goal（先 lzy loop register）");
  if (goal.status !== "executing") {
    throw new DeliveryError(`目标 ${goal.slug} 非 executing（${goal.status}）——delivery 面在执行期运作`);
  }
  const bound = goal.delivery?.[ep];
  if (!bound?.hash) {
    throw new DeliveryError(`目标 ${goal.slug} 未绑定 ${ep} delivery 契约——先 lzy delivery request ${ep} --contract <file>（批准对象=契约哈希，UPS 短语「批准 <短码>」）`);
  }
  return { goal, bound };
}

// 授权门（拍板 3）：act B 须 B∧C 双授权（main=Pages 发布源，合并即触发部署）；act C 须 C。
// LZY_ABLATE_HUMAN_GATE=1 消融缝：跳过核对、意图记录 stamped=ablated（如实记账，ADR-0015 家法）。
function authorizationGate(cwd, goal, ep, { needB, needC }) {
  const ablated = process.env.LZY_ABLATE_HUMAN_GATE === "1";
  if (ablated) return { ablated };
  const missing = [];
  if (needB) {
    const b = effectiveAuthorization(cwd, goal.slug, goal.delivery.B.hash);
    if (!b.authorized) missing.push(`B（${goal.delivery.B.hash.slice(0, 8)}）`);
  }
  if (needC) {
    if (!goal.delivery?.C?.hash) missing.push("C（未绑定 delivery 契约）");
    else {
      const c = effectiveAuthorization(cwd, goal.slug, goal.delivery.C.hash);
      if (!c.authorized) missing.push(`C（${goal.delivery.C.hash.slice(0, 8)}）`);
    }
  }
  if (missing.length > 0) {
    throw new DeliveryError(
      `交付授权门拒绝（ADR-0024/0028）：${ep} 面缺有效授权——缺 ${missing.join("、")}。` +
        `恢复：lzy delivery request <ep> --contract <file> 落契约后把「批准 <短码>」原样转给用户；` +
        `授权唯一写入口=UPS 钩子在真实用户消息上的记录，本门无任何绕过参数。` +
        `（合并前置=B∧C 双授权：main 为 Pages 发布源，合并即触发部署——只有 B 授权时本门拒绝合并）`,
    );
  }
  return { ablated: false };
}

// 意图门（拍板 4）：done 恒拒；acting/unknown 先 readback；failed/refused 同身份可重试；
// 身份漂移（repo/branch/head/base/marker 不符）=拒绝（新候选=新契约=新授权，V09）。
function intentGate(state, ep, target) {
  const it = state.intents.find((x) => x.endpoint === ep);
  if (it && it.status === "done") {
    throw new DeliveryError(`交付意图 ${it.id} 已 done（${it.observed ? JSON.stringify(it.observed).slice(0, 120) : "无 observed"}）——已成功动作绝不重复执行（V10）。读面：lzy delivery readback ${ep}`);
  }
  if (it && (it.status === "acting" || it.status === "unknown")) {
    throw new DeliveryError(`交付意图 ${it.id} 处于 ${it.status}——结果未定先读回收束，绝不盲目重发（V10）：lzy delivery readback ${ep}`);
  }
  if (it) {
    const drift = Object.entries(target).filter(([k, v]) => v !== undefined && JSON.stringify(it.target[k]) !== JSON.stringify(v));
    if (drift.length > 0) {
      throw new DeliveryError(
        `交付意图 ${it.id} 身份漂移：${drift.map(([k]) => k).join("、")} 与已声明意图不符` +
          `（意图=${JSON.stringify(it.target)}）。新候选=新契约=新授权请求（V09）——` +
          `若确需交付新 HEAD，重新出契约并走 lzy delivery request 批准后以新意图交付`,
      );
    }
    return { intent: it, created: false };
  }
  return { intent: null, created: true };
}

function newIntent(state, ep, kind, target, plannedArgv, ablated) {
  const id = `d${state.lastSeq + 1}`;
  return {
    id,
    endpoint: ep,
    kind,
    target,
    plannedArgv,
    status: "intended",
    attempts: [{ at: new Date().toISOString(), method: "declare", outcome: "ok", detail: ablated ? "declared (ablated auth gate)" : "declared" }],
    observed: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ablated: ablated || undefined,
  };
}

// act 开场（锁内）：全部门序走完、意图落账（intended→acting 前置于任何外部调用）——
// 意图先于动作（主方案 §6）。返回 {goal, intent, state}；外部链随后锁外执行，终态经
// settleAct 落账（crash 留 acting → readback 收束路径恒在）。
export function beginAct(cwd, ep, { kind, target, plannedArgv }) {
  return withLock(cwd, () => {
    const { goal, bound } = requireDeliveryContext(cwd, ep);
    const gate = authorizationGate(cwd, goal, ep, { needB: ep === "B", needC: true });
    const state = loadIntents(cwd) ?? { lastSeq: 0, intents: [] };
    const { intent, created } = intentGate(state, ep, target);
    let it = intent;
    if (created) {
      it = newIntent(state, ep, kind, target, plannedArgv, gate.ablated);
      state.intents.push(it);
      state.lastSeq += 1;
    }
    // 落 acting：状态机 intended/failed/refused→acting；attempt 记录本轮 act 开场。
    assertTransition(it.status, "acting");
    it.status = "acting";
    it.attempts.push({ at: new Date().toISOString(), method: "act-begin", outcome: "ok", detail: `endpoint=${ep} kind=${kind}${gate.ablated ? " ablated=1" : ""}` });
    it.updatedAt = new Date().toISOString();
    saveIntents(cwd, state);
    return { goal, bound, state, intent: it, created, ablated: gate.ablated };
  });
}

// act 收束（锁内）：终态转移+attempt 追加+observed 落账（追加不覆写历史 attempt）。
export function settleAct(cwd, ep, intentId, toStatus, { attempt, observed } = {}) {
  return withLock(cwd, () => {
    const state = loadIntents(cwd);
    const it = state.intents.find((x) => x.id === intentId && x.endpoint === ep);
    if (!it) throw new DeliveryError(`交付意图 ${intentId} 不在场（ep=${ep}）——账本被并发改动？${RECOVERY}`);
    assertTransition(it.status, toStatus);
    it.status = toStatus;
    if (attempt) it.attempts.push({ at: new Date().toISOString(), ...attempt });
    if (observed) it.observed = { ...(it.observed ?? {}), ...observed };
    it.updatedAt = new Date().toISOString();
    if (toStatus === "done") it.closedAt = new Date().toISOString();
    saveIntents(cwd, state);
    return it;
  });
}

// act 中途失败落账（锁内）：保持 acting 语义破损最小——failed/refused/unknown 各带 attempt。
export function failAct(cwd, ep, intentId, toStatus, attempt) {
  return withLock(cwd, () => {
    const state = loadIntents(cwd);
    const it = state.intents.find((x) => x.id === intentId && x.endpoint === ep);
    if (!it) throw new DeliveryError(`交付意图 ${intentId} 不在场（ep=${ep}）。${RECOVERY}`);
    if (it.status === "done") return it; // 并发窗口内已被读回收束为 done——以 done 为准
    assertTransition(it.status, toStatus);
    it.status = toStatus;
    it.attempts.push({ at: new Date().toISOString(), ...attempt });
    it.updatedAt = new Date().toISOString();
    saveIntents(cwd, state);
    return it;
  });
}

// 状态读面（lzy delivery status）：契约绑定×授权生效×意图账本×pending，全只读。
export function deliveryStatus(cwd) {
  const goal = readGoal(cwd);
  if (!goal) return { goal: null };
  const eps = {};
  for (const ep of DELIVERY_ENDPOINTS) {
    const bound = goal.delivery?.[ep];
    if (!bound?.hash) {
      eps[ep] = { bound: false };
      continue;
    }
    const auth = effectiveAuthorization(cwd, goal.slug, bound.hash);
    eps[ep] = {
      bound: true,
      contractPath: bound.path,
      contractHash: bound.hash,
      authorized: auth.authorized,
      lastEvent: auth.lastEvent,
      events: auth.events.length,
    };
  }
  const state = loadIntents(cwd);
  return {
    goal: { slug: goal.slug, status: goal.status, contractPending: goal.contractPending },
    contracts: eps,
    intents: (state?.intents ?? []).map((it) => ({
      id: it.id, endpoint: it.endpoint, kind: it.kind, status: it.status,
      target: it.target, attempts: it.attempts.length, observed: it.observed, updatedAt: it.updatedAt,
    })),
  };
}
