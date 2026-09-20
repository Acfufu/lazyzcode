// attempt 世系账本（0.1.0 棒B，ADR-0016）：forward-only attempt 序列。执行中改计划
// 不回卷当前 attempt——旧代次置 superseded、开新代次（完整采纳门照走；INV-06 在
// supersede 模型下自然成立：新代次必须重过 H1 采纳门）。账本落
// `.lazyzcode/loop/attempt.json` 跨 reset 常驻（与 dag.json 同语义：reset 只清 goal.json
// 与孤儿 tmp，本文件存活）。纪律沿 dag.json 全套：原子写 tmp+rename、载荷 sha256 校验和、
// 读损坏 fail-closed 带 errno 判别（仅 ENOENT=缺席）、形状校验+恢复指路。
// 缺席≠空账本：本版本前注册的在途 goal 无世系文件——首次读从中央账本 plan 节点的
// attempt 戳派生内存视图（不回填），首次写（采纳绑定/supersede/finish/abandon）才落盘。
// 本模块零 spawn、全部同步；错误用 AttemptError（渲染口径与 LoopError/DagError 同：cli
// 顶层 catch 只取 message）；attempt.js → dag.js 单向依赖（免循环，同 loop.js→dag.js）。
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { loadDag } from "./dag.js";

export const ATTEMPT_VERSION = 1;
export const ATTEMPT_FILE = "attempt.json";
export const ATTEMPT_STATUSES = new Set(["active", "superseded", "completed", "abandoned"]);

export class AttemptError extends Error {}

function attemptPath(cwd) {
  return join(cwd, ".lazyzcode", "loop", ATTEMPT_FILE);
}

// 校验和覆盖 {attemptVersion, slug, attempts} 载荷（键序即写入序，round-trip 稳定）。
function checksumOf(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

const RECOVERY =
  `恢复：先备份并人工抢救需要保留的世系记录（supersede 链只存在于此文件；丢失后可由中央账本 ` +
  `plan 节点的 attempt 戳重派生只读视图），然后删除该文件重建（下次写将按派生视图重建落盘）`;

export function attemptFilePath(cwd) {
  return attemptPath(cwd);
}

function assertEntries(attempts, p) {
  if (!Array.isArray(attempts)) {
    throw new AttemptError(`attempt 世系形状畸形（attempts 须为数组）：${p}。${RECOVERY}`);
  }
  for (const a of attempts) {
    if (
      !a ||
      typeof a !== "object" ||
      !Number.isInteger(a.n) ||
      a.n < 1 ||
      typeof a.status !== "string" ||
      !ATTEMPT_STATUSES.has(a.status)
    ) {
      throw new AttemptError(
        `attempt 世系形状畸形（条目须 {n: 正整数, status: active|superseded|completed|abandoned}）：${p}。${RECOVERY}`,
      );
    }
  }
}

// 读账本：缺席（仅 ENOENT）=null（派生视图语义，非空账本）；其余读失败/解析失败/
// 校验和不符/版本不识别/形状畸形一律 AttemptError 拒（0.0.9 双审 ADJ-01 家法：不可读
// 被静默当缺席时，下一写命令会整文件覆写）。
export function loadAttempts(cwd) {
  const p = attemptPath(cwd);
  let text;
  try {
    text = readFileSync(p, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw new AttemptError(`attempt 世系账本不可读（${err?.code ?? err?.message ?? err}）：${p}。${RECOVERY}`);
  }
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new AttemptError(`attempt 世系账本损坏（JSON 解析失败）：${p}。${RECOVERY}`);
  }
  const { checksum, ...rest } = obj ?? {};
  const payload = { attemptVersion: rest.attemptVersion, slug: rest.slug, attempts: rest.attempts };
  if (checksum !== checksumOf(payload)) {
    throw new AttemptError(`attempt 世系账本校验和不符（内容与落盘时态不一致）：${p}。${RECOVERY}`);
  }
  if (payload.attemptVersion !== ATTEMPT_VERSION) {
    throw new AttemptError(
      `attempt 世系账本版本不兼容（盘上 v${payload.attemptVersion}，本 lzy 期望 v${ATTEMPT_VERSION}）：${p}。${RECOVERY}`,
    );
  }
  if (typeof payload.slug !== "string" || !payload.slug) {
    throw new AttemptError(`attempt 世系形状畸形（slug 缺席）：${p}。${RECOVERY}`);
  }
  assertEntries(payload.attempts, p);
  return payload;
}

// 写账本：原子写家法同 saveDag（tmp→rename，0o600）；tmp 命名在 cleanupLoopResidue 的
// .attempt.json.*.tmp 家族内。写护栏：盘上有载荷而本次写入空 attempts=误传，拒绝覆写。
// 调用方须持 withLock（goal.json 同一临界段）。
export function saveAttempts(cwd, lineage) {
  const p = attemptPath(cwd);
  let diskText = null;
  try {
    diskText = readFileSync(p, "utf8");
  } catch (err) {
    if (!err || err.code !== "ENOENT") {
      throw new AttemptError(`attempt 世系账本不可读（${err?.code ?? err?.message ?? err}），写护栏拒绝落盘：${p}。${RECOVERY}`);
    }
  }
  const emptyIncoming = Array.isArray(lineage?.attempts) && lineage.attempts.length === 0;
  if (diskText != null && diskText.trim() !== "" && emptyIncoming) {
    throw new AttemptError(
      `attempt 世系写护栏：盘上账本有载荷而本次写入为空序列，拒绝覆写：${p}。重跑当前命令以重新加载；确系废弃残留先人工删除该文件。${RECOVERY}`,
    );
  }
  // 写侧形状校验（ADJ-44，0.2.1 五轮双审）：NaN/null 的 n 经 JSON.stringify 落盘即毒化
  // 账本（读侧 assertEntries 自拒 → abandon/register/重 finish 全堵且 reset 不解）。
  assertEntries(lineage?.attempts, p);
  mkdirSync(dirname(p), { recursive: true });
  const payload = { attemptVersion: lineage.attemptVersion, slug: lineage.slug, attempts: lineage.attempts };
  const out = { ...payload, checksum: checksumOf(payload) };
  const tmp = join(dirname(p), `.${basename(p)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, p);
}

// 从中央账本派生世系视图（只读，不落盘）：plan 节点的 attempt 戳按代次分组——同代次
// 取最大 at 的 planHash 为现行、最早 at 为采纳时点；最大代次=active（现役推断）。
// 0.0.9 及更早的无戳节点不参与（与 ADJ-44 隔离语义一致）。
export function deriveLineage(cwd, slug) {
  const dag = loadDag(cwd);
  const byAttempt = new Map();
  for (const n of dag.nodes) {
    if (n.kind !== "plan" || n.slug !== slug || !Number.isInteger(n.attempt)) continue;
    const cur = byAttempt.get(n.attempt);
    if (!cur) {
      byAttempt.set(n.attempt, { planHash: n.planHash, adoptedAt: n.at, latestAt: n.at });
    } else {
      cur.latestAt = Math.max(cur.latestAt, n.at);
      if (n.at >= cur.latestAt) cur.planHash = n.planHash;
      cur.adoptedAt = Math.min(cur.adoptedAt, n.at);
    }
  }
  const nums = [...byAttempt.keys()].sort((a, b) => a - b);
  const max = nums[nums.length - 1] ?? 0;
  return nums.map((n) => ({
    n,
    planHash: byAttempt.get(n).planHash ?? null,
    tier: null,
    adoptedAt: byAttempt.get(n).adoptedAt != null ? new Date(byAttempt.get(n).adoptedAt).toISOString() : null,
    status: n === max ? "active" : "superseded",
    derived: true,
  }));
}

// 写路径基准：世系文件在场且同 slug=以文件为基准；否则（缺席/他 slug）按派生视图重建。
function baseForWrite(cwd, slug) {
  const file = loadAttempts(cwd);
  if (file && file.slug === slug) return file;
  return { attemptVersion: ATTEMPT_VERSION, slug, attempts: deriveLineage(cwd, slug).map(({ derived, ...a }) => a) };
}

// register（新目标运行的开端）：同 slug 重注册（跨 reset）=追加新代次条目并把遗留
// active 降级 superseded → 新 n（supersede 链跨 reset 保真）；他 slug/首注册=重置为本
// 运行单条 active（他 slug 历史由中央账本派生）。账本损坏在此 fail-closed（写命令不在
// 损账本上落新运行，同 dag-first 家法）。
export function initLineageAtRegister(cwd, { slug, n, tier }) {
  const prev = loadAttempts(cwd);
  if (prev && prev.slug === slug && prev.attempts.length > 0) {
    const now = new Date().toISOString();
    // 同 n 兜底（ADJ-03）：调用方序号与账本冲突时顺延，保证 (n, status) 唯一——同号
    // 会让 bind/close 的 find 命中被降级条目（planHash/终态落在隐藏条目上）。
    const maxN = prev.attempts.reduce((m, a) => (Number.isInteger(a?.n) ? Math.max(m, a.n) : m), 0);
    const useN = Number.isInteger(n) && n > maxN ? n : maxN + 1;
    const attempts = prev.attempts.map((a) =>
      a.status === "active" ? { ...a, status: "superseded", supersededAt: now, supersededBy: useN } : a,
    );
    attempts.push({ n: useN, planHash: null, tier: tier ?? null, adoptedAt: null, status: "active" });
    saveAttempts(cwd, { ...prev, attempts });
    return useN;
  }
  const useN = Number.isInteger(n) && n > 0 ? n : 1;
  saveAttempts(cwd, {
    attemptVersion: ATTEMPT_VERSION,
    slug,
    attempts: [{ n: useN, planHash: null, tier: tier ?? null, adoptedAt: null, status: "active" }],
  });
  return useN;
}

// 采纳绑定：本代次条目记 planHash+采纳时点（条目缺席=派生基准上补建）。
// n 命中多条（历史畸形）时优先 active 条目（ADJ-03：旧 superseded 同号条目不夺绑）。
function findEntry(lineage, n) {
  return lineage.attempts.find((a) => a.n === n && a.status === "active") ?? lineage.attempts.find((a) => a.n === n);
}

export function bindPlanToAttempt(cwd, { slug, n, planHash, tier }) {
  const lineage = baseForWrite(cwd, slug);
  let entry = findEntry(lineage, n);
  if (!entry) {
    entry = { n, planHash: null, tier: tier ?? null, adoptedAt: null, status: "active" };
    lineage.attempts.push(entry);
  }
  entry.planHash = planHash;
  entry.adoptedAt = entry.adoptedAt ?? new Date().toISOString();
  if (tier && !entry.tier) entry.tier = tier;
  saveAttempts(cwd, lineage);
}

// supersede（forward-only 核心）：旧代次置 superseded（记 supersededAt/supersededBy）、
// 新代次开 active 条目，单次落盘（盘上永不出现新旧两代同为 active 的中间态）。
export function supersedeAttempt(cwd, { slug, from, to, planHash, tier }) {
  const lineage = baseForWrite(cwd, slug);
  const now = new Date().toISOString();
  const prev = findEntry(lineage, from);
  if (prev) {
    prev.status = "superseded";
    prev.supersededAt = now;
    prev.supersededBy = to;
  } else {
    lineage.attempts.push({ n: from, planHash: null, tier: null, adoptedAt: null, status: "superseded", supersededAt: now, supersededBy: to });
  }
  const next = findEntry(lineage, to);
  if (next) {
    next.status = "active";
    next.planHash = planHash;
    next.adoptedAt = next.adoptedAt ?? now;
  } else {
    lineage.attempts.push({ n: to, planHash, tier: tier ?? null, adoptedAt: now, status: "active" });
  }
  saveAttempts(cwd, lineage);
}

// 终态收口：finish=completed、abandon=abandoned（幂等：重 finish/重复置同状态无害）。
export function closeAttempt(cwd, { slug, n, status }) {
  if (status !== "completed" && status !== "abandoned") {
    throw new AttemptError(`closeAttempt 终态非法：${status}（completed|abandoned）`);
  }
  const lineage = baseForWrite(cwd, slug);
  const entry = findEntry(lineage, n);
  if (entry) entry.status = status;
  else lineage.attempts.push({ n, planHash: null, tier: null, adoptedAt: null, status });
  saveAttempts(cwd, lineage);
}

// 只读世系清单（formatHistory 同款永不 throw 家族）：文件∪派生并集，文件条目优先、
// 派生补缺并标「账本派生」；任何读失败降级为一行 warn，不阻断渲染。
export function formatAttempts(cwd, slugHint = null) {
  const head = "attempt 世系（attempt.json ∪ 中央账本派生 · 只读；forward-only——执行中改计划=开新代次，ADR-0016）";
  let file = null;
  try {
    file = loadAttempts(cwd);
  } catch (e) {
    return `${head}\n  ⚠ 世系账本不可读（读面降级）：${e?.message ?? e}`;
  }
  const slug = slugHint ?? file?.slug ?? null;
  if (!slug) return `${head}\n  （无：本目录无目标且无世系文件）`;
  let derived = [];
  try {
    derived = deriveLineage(cwd, slug);
  } catch (e) {
    return `${head}\n  ⚠ 中央账本派生失败（读面降级）：${e?.message ?? e}`;
  }
  const base = file && file.slug === slug ? file.attempts : [];
  const fileMaxN = base.length > 0 ? Math.max(...base.map((a) => a.n)) : 0;
  const byN = new Map(base.map((a) => [a.n, { ...a, derived: false }]));
  for (const d of derived) {
    if (byN.has(d.n)) continue;
    // 派生条目落在文件覆盖范围之前=上一运行的历史代次——状态诚实化为 superseded
    //（派生视图区分不了 completed/abandoned，superseded 是保守真值：该代次确已非现役）。
    byN.set(d.n, d.n < fileMaxN ? { ...d, status: "superseded" } : d);
  }
  const rows = [...byN.values()].sort((a, b) => a.n - b.n);
  if (rows.length === 0) return `${head}\n  目标 ${slug}：无 attempt 记录（未采纳过计划）`;
  const lines = rows.map((a) => {
    const status = a.status === "superseded" && a.supersededBy ? `superseded → #${a.supersededBy}` : a.status;
    const mark = a.n === Math.max(...rows.map((r) => r.n)) && a.status === "active" ? " ←现役" : "";
    return (
      `  #${a.n} ${status}  planHash ${a.planHash ? `${String(a.planHash).slice(0, 10)}…` : "—"}  ` +
      `tier ${a.tier ?? "—"}  采纳 ${a.adoptedAt ?? "—"}${a.supersededAt ? `  置换于 ${a.supersededAt}` : ""}` +
      `${a.derived ? "（账本派生）" : ""}${mark}`
    );
  });
  return `${head}\n  目标 ${slug} · ${rows.length} 代\n${lines.join("\n")}`;
}
