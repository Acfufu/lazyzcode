// 对照 attestation（v009 棒2，§⑪ N3/ADR-0014）：qa-executor 对照结论的机器入账面。
// 机器只记账不裁决：MATCH/MISMATCH 都如实入 DAG（comparator 节点 + attests 边→现行
// plan 节点），裁决在 finish 门（HEAVY 强制现行记录且 MATCH 且指纹未过期；LIGHT 可
// self-check 免录）。结论文件=主代理转抄 qa-executor 文本报告的最小 JSON——转抄错位
// （fid 拼写/verdict 词形/漏项）在 schema 校验处拦下，绝不静默入账。
// 依赖方向：attest.js → loop.js → dag.js 单向（dag.js 不反向 import，免循环）。
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  LoopError,
  fingerprintSubjects,
  requireActive,
  requireGoalPreLock,
  withLock,
} from "./loop.js";
import {
  addEdge,
  appendComparatorNode,
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

function doRecordComparatorAttestation(cwd, file) {
  const goal = requireActive(cwd, "executing");
  if (!goal.planHash) {
    throw new LoopError(`活跃目标无 planHash（计划未快照）——对照 attestation 绑定现行计划，先重新采纳计划`);
  }
  if (!file) {
    throw new LoopError(
      `用法：lzy attest comparator --file <结论.json>（schema：{"slug","items":[{"fid","verdict":"MATCH|MISMATCH","basis"}],"note"?}）`,
    );
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
      `对照结论文件不是合法 JSON：${file}。schema：{"slug","items":[{"fid","verdict":"MATCH|MISMATCH","basis"}],"note"?}`,
    );
  }
  validateAttestationDoc(doc, goal);
  const fingerprint = fingerprintSubjects(cwd, goal.subjects ?? []);
  if (!fingerprint) {
    throw new LoopError(`无可绑对照面（宿主非 git 仓，复合指纹不可算）——对照 attestation 依赖指纹新鲜性`);
  }
  const dag = loadDag(cwd);
  const node = appendComparatorNode(dag, {
    slug: goal.slug,
    planHash: goal.planHash,
    verdict: doc.items.every((it) => it.verdict === "MATCH") ? "MATCH" : "MISMATCH",
    fingerprint,
    fileSha256: createHash("sha256").update(raw).digest("hex"),
    itemsCount: doc.items.length,
    items: doc.items.map((it) => ({ fid: it.fid, verdict: it.verdict, basis: String(it.basis ?? "").slice(0, 300) })),
  });
  const planNode = findNodes(
    dag,
    (n) => n.kind === "plan" && n.slug === goal.slug && n.planHash === goal.planHash,
  ).at(-1);
  if (planNode) addEdge(dag, { type: "attests", from: node.id, to: planNode.id });
  saveDag(cwd, dag);
  return { node, fingerprint, verdict: node.verdict };
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
      throw new LoopError(`items 元素须为对象 {fid, verdict, basis?}：${JSON.stringify(it)}`);
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
    seen.add(it.fid);
  }
  const missing = fIds.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new LoopError(`对照结论未覆盖全部 F 项：缺 ${missing.join(" ")}（逐项给 verdict；构造不出对照的面如实写明）`);
  }
}
