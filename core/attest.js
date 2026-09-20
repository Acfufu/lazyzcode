// 对照 attestation（v009 棒2，§⑪ N3/ADR-0014）：qa-executor 对照结论的机器入账面。
// 机器只记账不裁决：MATCH/MISMATCH 都如实入 DAG（comparator 节点 + attests 边→现行
// plan 节点），裁决在 finish 门（HEAVY 强制现行记录且 MATCH 且指纹未过期；LIGHT 可
// self-check 免录）。结论文件=主代理转抄 qa-executor 文本报告的最小 JSON——转抄错位
// （fid 拼写/verdict 词形/漏项）在 schema 校验处拦下，绝不静默入账。
// 依赖方向：attest.js → loop.js → dag.js 单向（dag.js 不反向 import，免循环）。
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  LoopError,
  fingerprintSubjects,
  requireActive,
  requireGoalPreLock,
  withLock,  guardFence,
} from "./loop.js";
import {
  addEdge,
  appendComparatorNode,
  findGreenByGeneration,
  findNodes,
  loadDag,
  saveDag,
} from "./dag.js";

// 入账：requireGoalPreLock+withLock（无 goal 目录 fail-fast 不留空壳，ADR-0006 家法；
// 不沿 recordEvidenceHalf 曾缺 pre-lock 的旧形）。
export function recordComparatorAttestation(cwd, file) {
  requireGoalPreLock(cwd);
  return withLock(cwd, () => doRecordComparatorAttestation(cwd, file));
}

// 结论原件体积上限（ADJ-48，0.2.1）：结论文件是「主代理转抄 qa-executor 报告的最小
// JSON」——正常量级 KB 级；1MiB 上限拦住「手滑塞整份报告」且读入不再无界。
const COMPARATOR_FILE_MAX_BYTES = 1024 * 1024;

function doRecordComparatorAttestation(cwd, file) {
  guardFence(cwd); // fence 写路径守卫（0.2.0 棒1 ADR-0020；done 态放行语义不变，本守卫在前）
  // done 态恢复白名单（ADJ-10 出口，0.0.10）：rebind 后需重对照再重 finish。
  const goal = requireActive(cwd, "executing", "done");
  if (!goal.planHash) {
    throw new LoopError(`活跃目标无 planHash（计划未快照）——对照 attestation 绑定现行计划，先重新采纳计划`);
  }
  if (!file) {
    throw new LoopError(
      `用法：lzy attest comparator --file <结论.json>（schema：{"slug","items":[{"fid","verdict":"MATCH|MISMATCH","evidenceNodeId"|"generation","basis?"}],"note"?}——每条对照必须绑定该 F 项已落账的绿半（节点 id 或取证代次））`,
    );
  }
  try {
    const st = statSync(file);
    if (st.isFile() && st.size > COMPARATOR_FILE_MAX_BYTES) {
      throw new LoopError(
        `对照结论文件超上限 ${COMPARATOR_FILE_MAX_BYTES} bytes（当前 ${st.size}）：${file}——结论是转抄后的最小 JSON（fid/verdict/绑定/basis/note），详述留在报告里`,
      );
    }
  } catch (e) {
    if (e instanceof LoopError) throw e;
    // stat 失败交给下面的 readFileSync 报「不可读」（保留原有恢复文案）
  }
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (e) {
    throw new LoopError(`对照结论文件不可读：${file}（${e?.message ?? e}）`);
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    throw new LoopError(
      `对照结论文件不是合法 JSON：${file}。schema：{"slug","items":[{"fid","verdict":"MATCH|MISMATCH","evidenceNodeId"|"generation","basis?"}],"note"?}`,
    );
  }
  validateAttestationDoc(doc, goal);
  const fingerprint = fingerprintSubjects(cwd, goal.subjects ?? []);
  if (!fingerprint) {
    throw new LoopError(`无可绑对照面（宿主非 git 仓，复合指纹不可算）——对照 attestation 依赖指纹新鲜性`);
  }
  const dag = loadDag(cwd);
  const resolved = doc.items.map((it) => resolveItemBinding(dag, goal, it));
  const planNode = findNodes(
    dag,
    (n) => n.kind === "plan" && n.slug === goal.slug && n.planHash === goal.planHash,
  ).at(-1);
  const node = appendComparatorNode(dag, {
    slug: goal.slug,
    planHash: goal.planHash,
    verdict: doc.items.every((it) => it.verdict === "MATCH") ? "MATCH" : "MISMATCH",
    fingerprint,
    fileSha256: createHash("sha256").update(raw).digest("hex"),
    itemsCount: doc.items.length,
    items: resolved,
    note: doc.note ?? null, // ADJ-42：schema 广告的 note 落节点（截断 ≤300），不再静默丢弃
    planNodeId: planNode?.id ?? null, // ADJ-48：对端缺席时记 null（机器可见），边不静默丢
  });
  // 结论原件归档（ADJ-48，0.2.1）：结论文件在 /tmp 会被清，fileSha256 只证「当时那份
  // 文件的字节」——按证据附件同款复制入 .lazyzcode/evidence/（命名带节点身份+slug），
  // 事后可复核。拷贝失败=整命令拒（账本未落盘，不留「有记录无原件」的半截）。
  const archivedRel = archiveConclusion(cwd, goal.slug, node.id, raw);
  node.filePath = archivedRel;
  // attests 边（ADR-0014 §N3）：plan 节点缺席=边无法建立——记录照落（机器只记账不裁决），
  // 但如实返回 warn 供调用方展示（旧实现静默跳过，审计面凭空少一条）。
  let warn = null;
  if (planNode) addEdge(dag, { type: "attests", from: node.id, to: planNode.id });
  else {
    warn =
      `attests 边缺席：本账本无 slug=${goal.slug} planHash=${String(goal.planHash).slice(0, 10)}… 的 plan 节点` +
      `（0.0.8 在途 goal 或被人工重建的账本）——记录已入账，但 lzy dag dependents <plan 节点> 查不到这条对照`;
  }
  saveDag(cwd, dag);
  return { node, fingerprint, verdict: node.verdict, warn };
}

// 结论原件归档：`.lazyzcode/evidence/<slug>.comparator.<nodeId>.json`（0600，与证据家族
// 同权限）。节点身份在文件名里=重录落新节点新文件，永不覆写（ADJ-24 家法）。
function archiveConclusion(cwd, slug, nodeId, raw) {
  const dir = join(cwd, ".lazyzcode", "evidence");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${slug}.comparator.${nodeId}.json`);
  const tmp = join(dir, `.evidence.${slug}.comparator.${nodeId}.json.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, raw, { mode: 0o600 });
  renameSync(tmp, p);
  return `.lazyzcode/evidence/${slug}.comparator.${nodeId}.json`;
}

// 对照绑证据（ADJ-02，0.0.10）：把 item 的 evidenceNodeId|generation 解析成账本绿半
// 节点——解析失败=对照先于证据/绑错目标，入账处即拒（不留给 finish 门放行的口子）。
function resolveItemBinding(dag, goal, it) {
  if (typeof it.evidenceNodeId === "string" && it.evidenceNodeId) {
    const node =
      dag.nodes.find(
        (n) =>
          n.id === it.evidenceNodeId &&
          n.kind === "evidence" &&
          n.half === "green" &&
          n.slug === goal.slug &&
          n.step === it.fid,
      ) ?? null;
    if (!node) {
      throw new LoopError(
        `item ${it.fid} 绑定的 evidenceNodeId 不可解析（${it.evidenceNodeId} 须为本目标 ${it.fid} 的绿半节点）——先 lzy step done ${it.fid} --evidence … 取证，再对照`,
      );
    }
    if (Number.isInteger(it.generation) && it.generation !== node.seq) {
      throw new LoopError(`item ${it.fid} 的 generation ${it.generation} 与节点 ${node.id} 实际代次 ${node.seq} 不符`);
    }
    return { fid: it.fid, verdict: it.verdict, evidenceNodeId: node.id, generation: node.seq, basis: String(it.basis ?? "").slice(0, 300) };
  }
  if (Number.isInteger(it.generation)) {
    const node = findGreenByGeneration(dag, goal.slug, it.fid, it.generation, goal.attempt);
    if (!node) {
      throw new LoopError(
        `item ${it.fid} 的 generation ${it.generation} 无对应绿半节点——先 lzy step done ${it.fid} --evidence … 取证，再对照（对照先于证据不可入账）`,
      );
    }
    return { fid: it.fid, verdict: it.verdict, evidenceNodeId: node.id, generation: node.seq, basis: String(it.basis ?? "").slice(0, 300) };
  }
  throw new LoopError(
    `item ${it.fid} 缺证据绑定（evidenceNodeId 或 generation 二选一）——对照必须锚到已落账的绿半节点（ADJ-02）`,
  );
}

function validateAttestationDoc(doc, goal) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new LoopError(`对照结论须为对象：{"slug","items":[…],"note"?}`);
  }
  if (doc.slug !== goal.slug) {
    throw new LoopError(`对照结论 slug 不符：文件 ${doc.slug ?? "（缺失）"} ≠ 活跃目标 ${goal.slug}`);
  }
  const fIds = goal.steps.filter((s) => s.kind === "F").map((s) => s.id);
  if (fIds.length === 0) {
    throw new LoopError(`本目标无 F 项——对照 attestation 无对象可记（无终验项的目标无需对照）`);
  }
  const items = doc.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new LoopError(`对照结论缺 items（非空数组，逐 F 项一条 {fid, verdict, basis?}；计划的 F 项：${fIds.join(" ")}）`);
  }
  const seen = new Set();
  for (const it of items) {
    if (!it || typeof it !== "object") {
      throw new LoopError(`items 元素须为对象 {fid, verdict, evidenceNodeId|generation, basis?}：${JSON.stringify(it)}`);
    }
    if (!fIds.includes(it.fid)) {
      throw new LoopError(`对照结论含未知/非 F 项 fid：${it.fid}（计划的 F 项：${fIds.join(" ")}）`);
    }
    if (it.verdict !== "MATCH" && it.verdict !== "MISMATCH") {
      throw new LoopError(`verdict 非法：${it.fid} 的「${it.verdict}」（只认 MATCH|MISMATCH）`);
    }
    if (seen.has(it.fid)) {
      throw new LoopError(`对照结论重复 fid：${it.fid}（每项一条；更正请重录新记录，最新为现行）`);
    }
    const hasBinding = (typeof it.evidenceNodeId === "string" && it.evidenceNodeId) || Number.isInteger(it.generation);
    if (!hasBinding) {
      throw new LoopError(
        `item ${it.fid} 缺证据绑定（evidenceNodeId 或 generation 二选一）——对照必须锚到该 F 项已落账的绿半节点（先取证再对照）`,
      );
    }
    seen.add(it.fid);
  }
  const missing = fIds.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new LoopError(`对照结论未覆盖全部 F 项：缺 ${missing.join(" ")}（逐项给 verdict；构造不出对照的面如实写明）`);
  }
}
