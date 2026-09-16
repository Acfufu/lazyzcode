// 中央失效 DAG（v009 棒1，ADR-0014）：证据/评审/计划的依赖边账本，跨 reset 常驻
// `.lazyzcode/loop/dag.json`。取证与评审时注册边（「取证即注册边」），变更时图上
// 查询传播失效——hash 比对降为边型之一，统一权威的判定切换留棒2（本模块不进任何门）。
// 本模块零 spawn、全部同步语义；错误用 DagError（渲染口径与 LoopError 同：cli 顶层
// catch 只取 message），不反向 import loop.js（loop.js→dag.js 单向，免循环依赖）。
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createHash } from "node:crypto";

export const DAG_VERSION = 1;
export const DAG_FILE = "dag.json";

// 节点/边型（v1 钉死语义）：节点不可变、追加式；边追加不删，修正=新边（最新为现行）。
// evidence.half ∈ red|green|waived；surface.kind ∈ fingerprint|external（红绿各绑各面）。
export const EVIDENCE_HALVES = new Set(["red", "green", "waived"]);
export const SURFACE_KINDS = new Set(["fingerprint", "external"]);
export const EDGE_TYPES = new Set(["captured_on", "red_of", "supersedes", "reviews", "plans"]);

export class DagError extends Error {}

function dagPath(cwd) {
  return join(cwd, ".lazyzcode", "loop", DAG_FILE);
}

// 校验和覆盖 {dagVersion, nodes, edges} 载荷（键序即写入序，round-trip 稳定）。
// 半写/篡改在 loadDag 处 fail-closed（ADR-0014：账本不可读一律拒，绝不静默当空库）。
function checksumOf(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

const RECOVERY = `恢复：先备份并人工抢救需要保留的红/waive 记录（红半边只存在于此文件、丢失不可重算），然后删除该文件重建账本（绿半 hash 边可由后续取证重录）`;

export function dagFilePath(cwd) {
  return dagPath(cwd);
}

// 读账本：缺席=空账本（首次使用）；在册但解析失败/校验和不符/版本不识别=拒绝。
export function loadDag(cwd) {
  let text;
  try {
    text = readFileSync(dagPath(cwd), "utf8");
  } catch {
    return { dagVersion: DAG_VERSION, nodes: [], edges: [] };
  }
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new DagError(`中央 DAG 账本损坏（JSON 解析失败）：${dagPath(cwd)}。${RECOVERY}`);
  }
  const { checksum, ...rest } = obj ?? {};
  const payload = { dagVersion: rest.dagVersion, nodes: rest.nodes, edges: rest.edges };
  if (checksum !== checksumOf(payload)) {
    throw new DagError(`中央 DAG 账本校验和不符（内容与落盘时态不一致）：${dagPath(cwd)}。${RECOVERY}`);
  }
  if (payload.dagVersion !== DAG_VERSION) {
    throw new DagError(
      `中央 DAG 账本版本不兼容（盘上 v${payload.dagVersion}，本 lzy 期望 v${DAG_VERSION}）：${dagPath(cwd)}。${RECOVERY}`,
    );
  }
  return payload;
}

// 写账本：原子写家法同 writeGoal（tmp→rename，0o600）；tmp 命名在 loop/ 清扫与
// doctor 孤儿 tmp 计数的 .dag.json.*.tmp 家族内（v009#N2 接线）。调用方须持 withLock。
export function saveDag(cwd, dag) {
  const p = dagPath(cwd);
  mkdirSync(dirname(p), { recursive: true });
  const payload = { dagVersion: dag.dagVersion, nodes: dag.nodes, edges: dag.edges };
  const out = { ...payload, checksum: checksumOf(payload) };
  const tmp = join(dirname(p), `.${basename(p)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, p);
}

export function emptyDag() {
  return { dagVersion: DAG_VERSION, nodes: [], edges: [] };
}

// id=n<序号> 单调：现有最大序号 +1（追加式账本只增不减，序号不回收）。
export function nextId(dag) {
  let max = 0;
  for (const n of dag.nodes) {
    const m = /^n(\d+)$/.exec(n.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `n${max + 1}`;
}

function assertSurface(surface) {
  if (!surface || !SURFACE_KINDS.has(surface.kind) || typeof surface.value !== "string" || !surface.value) {
    throw new DagError(`表面引用非法（须 {kind: fingerprint|external, value: 非空串}）：${JSON.stringify(surface)}`);
  }
}

export function appendEvidenceNode(dag, { slug, step, seq, half, surface, text = "", files = [] }) {
  if (!slug || !step) throw new DagError("evidence 节点缺 slug/step");
  if (!EVIDENCE_HALVES.has(half)) throw new DagError(`evidence half 非法：${half}（red|green|waived）`);
  assertSurface(surface);
  const node = {
    id: nextId(dag),
    kind: "evidence",
    slug,
    step,
    seq,
    half,
    surface: { kind: surface.kind, value: surface.value },
    text,
    files,
    at: Date.now(),
  };
  dag.nodes.push(node);
  return node;
}

export function appendPlanNode(dag, { slug, planHash }) {
  if (!slug || !planHash) throw new DagError("plan 节点缺 slug/planHash");
  const node = { id: nextId(dag), kind: "plan", slug, planHash, at: Date.now() };
  dag.nodes.push(node);
  return node;
}

export function appendReviewNode(dag, { planHash, verdict }) {
  if (!planHash) throw new DagError("review 节点缺 planHash");
  const node = { id: nextId(dag), kind: "review", planHash, verdict: verdict ?? "", at: Date.now() };
  dag.nodes.push(node);
  return node;
}

export function addEdge(dag, { type, from, to }) {
  if (!EDGE_TYPES.has(type)) throw new DagError(`边型非法：${type}`);
  if (!from || !to) throw new DagError("边缺 from/to");
  dag.edges.push({ type, from, to, at: Date.now() });
}

export function addCapturedOn(dag, evidenceNodeId, surface) {
  assertSurface(surface);
  addEdge(dag, { type: "captured_on", from: evidenceNodeId, to: { kind: surface.kind, value: surface.value } });
}

// green 落地时回填配对：对同 slug+step 尚无 red_of 边的 red/waive 节点追加 red_of 边。
// 同一 red 节点多条 red_of 合法（rebind 后新配对），查询取最新为现行、全部留作历史。
export function pairReds(dag, { slug, step, greenId }) {
  const paired = new Set(dag.edges.filter((e) => e.type === "red_of").map((e) => e.from));
  let n = 0;
  for (const node of dag.nodes) {
    if (node.kind !== "evidence" || node.slug !== slug || node.step !== step) continue;
    if (node.half !== "red" && node.half !== "waived") continue;
    if (paired.has(node.id)) continue;
    addEdge(dag, { type: "red_of", from: node.id, to: greenId });
    n += 1;
  }
  return n;
}

// rebind 痕迹：新 green 代次 → 旧 green 代次（追加，不改旧节点）。
export function addSupersedes(dag, priorGreenId, newGreenId) {
  addEdge(dag, { type: "supersedes", from: newGreenId, to: priorGreenId });
}

export function findNodes(dag, pred) {
  return dag.nodes.filter(pred);
}

// 同 goal+步骤的最新 green 代次（rebind 判定 supersede 链用）。
export function findLatestGreen(dag, slug, step) {
  const greens = dag.nodes.filter(
    (n) => n.kind === "evidence" && n.half === "green" && n.slug === slug && n.step === step,
  );
  if (greens.length === 0) return null;
  greens.sort((a, b) => a.seq - b.seq || a.at - b.at);
  return greens[greens.length - 1];
}

function nodeById(dag, id) {
  return dag.nodes.find((n) => n.id === id) ?? null;
}

// 「什么依赖 X」：ref 为节点 id（n<数字>）→ 返回与之相连的全部边+对端节点；
// 否则视为表面值 → 返回 captured_on 命中该表面的证据节点。
export function dependents(dag, ref) {
  if (/^n\d+$/.test(ref)) {
    const out = [];
    for (const e of dag.edges) {
      if (e.from === ref) out.push({ edge: e, direction: "outgoing", node: typeof e.to === "string" ? nodeById(dag, e.to) : null });
      else if (e.to === ref) out.push({ edge: e, direction: "incoming", node: nodeById(dag, e.from) });
    }
    return { kind: "node", id: ref, hits: out };
  }
  const hits = [];
  for (const e of dag.edges) {
    if (e.type === "captured_on" && e.to && typeof e.to === "object" && e.to.value === ref) {
      hits.push({ edge: e, node: nodeById(dag, e.from) });
    }
  }
  return { kind: "surface", id: ref, hits };
}

// 过期预览（棒1 仅展示用，不进任何门）：fingerprint 面=与当前复合指纹字符串比对；
// external 面=机器不可查（E-01：机器只记账不裁决）；被 supersedes 指向的代次=历史代次。
// 输入 currentFingerprint=fingerprintSubjects(cwd, subjects) 的现值（null=不比对，全部标未知）。
export function stalePreview(dag, currentFingerprint) {
  const superseded = new Set(dag.edges.filter((e) => e.type === "supersedes").map((e) => e.to));
  return dag.nodes
    .filter((n) => n.kind === "evidence")
    .map((n) => {
      if (n.half !== "green") return { node: n, status: "n/a" };
      if (superseded.has(n.id)) return { node: n, status: "superseded" };
      if (n.surface.kind === "external") return { node: n, status: "external" };
      if (currentFingerprint == null) return { node: n, status: "unknown" };
      return { node: n, status: n.surface.value === currentFingerprint ? "fresh" : "stale" };
    });
}
