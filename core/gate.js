// 统一只读放行判定（0.4.0 M1，docs/plan-v040-engineering-policy.md §6；拍板 4/5）。
// 职责边界：读现有事实、产生统一裁决——不自行取证（不 spawn 配方/不跑评审/不查 gh）、
// 不写任何状态、不外发、不产生授权。各合取项事实源：
//   契约/授权四查 = core/loop.js evaluateContractGateFacts（assertContractGate 的只读判定版）
//   验收覆盖     = core/loop.js evaluateAcceptanceCoverage（查 c 只读版）
//   策略身份     = core/policy.js 记录家族（drift=阻塞，V02）
//   义务满足     = core/verify.js 三判定（适用/成功/身份）+ judgeRequiredCiChecks 严判
//   交付事实     = core/delivery.js loadIntents（done 意图的 mergeCiState 核对）
//   步骤/证据/comparator/净树/竞态 = finish 既有门执法——本门只引用不重复取证（单一事实源）
//   阻塞发现面   = M3 建账——本门如实声明「未建立」，不冒充已核
// 分域（拍板 5）：仅 v2（带策略身份）目标产出政策裁决；v1 旧目标 applicable=false 恒不
// 阻塞（「政策裁决不适用（v1 旧规则延续）」逐字裁决行由 CLI N7 出口）。评审义务在 M1
// 恒不可满足（runnerFace.available=false）——诚实阻塞是本阶段的正确形态，不伪造 PASS。
import { createHash } from "node:crypto";
import { readGoal, evaluateContractGateFacts, evaluateAcceptanceCoverage } from "./loop.js";
import {
  loadPolicyRecord,
  computePolicyIdentity,
  identityStableHash,
  policyRulesHash,
  BASELINE_REVIEW_ID,
} from "./policy.js";
import {
  candidateIdentity,
  listReceipts,
  judgeReceiptSuccess,
  judgeReceiptIdentity,
  judgeRequiredCiChecks,
} from "./verify.js";
import { loadIntents } from "./delivery.js";
import { stableStringify } from "./policy.js";

export const GATE_VERSION = 1;

export class GateError extends Error {}

function snapshotHashOf(body) {
  return createHash("sha256").update(stableStringify(body)).digest("hex");
}

function latestReceipt(receipts) {
  return [...receipts].sort((a, b) => String(b.endedAt ?? "").localeCompare(String(a.endedAt ?? "")))[0] ?? null;
}

// 交付事实核对（M1 面）：在途（acting/unknown）→阻塞「交付未收束」；done 意图逐个核对
// observed.mergeCiState（green=ok；failed/null/pending=如实阻塞「合并 CI 未证绿」）；
// refused/failed 终态=诚实历史不阻塞（重交付由 delivery 面意图身份闸执法）；无意图=满足
//（无可核对事实，首外发由 delivery 面既有门执法——零旁路：V02 的外发前置在 beginAct 接线）。
function auditDeliveryIntents(intents) {
  const list = intents?.intents ?? [];
  const inflight = list.filter((it) => it.status === "acting" || it.status === "unknown");
  if (inflight.length > 0) {
    return {
      ok: false,
      reasons: inflight.map((it) => `交付意图 ${it.id}（ep ${it.endpoint}）处于 ${it.status}——结果未定，先 lzy delivery readback 收束`),
    };
  }
  const badDone = list.filter(
    (it) => it.status === "done" && (it.observed?.mergeCiState ?? null) !== "green" && it.endpoint === "B",
  );
  if (badDone.length > 0) {
    return {
      ok: false,
      reasons: badDone.map(
        (it) =>
          `已合并意图 ${it.id} 的 merge CI 状态=${it.observed?.mergeCiState ?? "null（查询失败）"}——合并事实保留但未证绿（V10/V11 面）`,
      ),
    };
  }
  if (list.length === 0) return { ok: true, reasons: ["无在案交付意图——无可核对事实，首外发由 delivery 面既有门执法"] };
  return { ok: true, reasons: [`${list.length} 个已收束交付意图核对通过（${list.map((it) => `${it.id}:${it.status}`).join("、")}）`] };
}

// 统一判定。返回逐义务状态+逐合取项+快照哈希；只读——任何分支都不写盘、不 spawn。
// blocked=true 表示政策层不放行（finish/queue/delivery 接线据此拒绝）；applicable=false
// 表示分域外（v1/旧规则），本门对该目标恒不阻塞。
// goal 注入缝（{goal} 选项，!== undefined 哨兵家法）：仅供测试夹具/零会话矩阵注入合成
// 目标对象——CLI 面永不传，生产恒走 readGoal（注入面不写盘，无旁路语义）。
export function evaluateGate(cwd, { goal: goalOverride } = {}) {
  const goal = goalOverride !== undefined ? goalOverride : readGoal(cwd);
  if (!goal) {
    throw new GateError("本目录没有进行中的目标——统一门需要目标承载身份（先 lzy loop register）");
  }
  const head = {
    gateVersion: GATE_VERSION,
    slug: goal.slug,
    goalVersion: goal.version,
    tier: goal.tier ?? null,
    risk: goal.risk ?? null,
    status: goal.status,
    contractHash: goal.contract?.contractHash ?? null,
    candidate: candidateIdentity(cwd),
    at: new Date().toISOString(),
  };
  // ── 分域闸（拍板 5）：v1 旧目标=政策裁决不适用，恒不阻塞 ──
  if (goal.version !== 2) {
    const body = { ...head, applicable: false, verdict: "政策裁决不适用（v1 旧规则延续）", clauses: {}, obligations: [], blocked: false, blockedReasons: [] };
    return { ...body, snapshotHash: snapshotHashOf(body) };
  }

  const clauses = {};
  // ① 契约/授权四查（只读；无契约 v2 目标=n.a.——评审义务照常，拍板 7）
  const facts = evaluateContractGateFacts(cwd, goal);
  if (facts.applicable) {
    const failed = facts.checks.filter((c) => !c.ok);
    clauses.contractAndAuth = {
      ok: failed.length === 0,
      reasons: failed.map((c) => `[${c.id}] ${c.reason}`),
      checks: facts.checks,
    };
    // ② 验收覆盖（查 c 只读；有契约才判）
    const cov = evaluateAcceptanceCoverage(facts.contract, goal.steps);
    const covReasons = [
      ...cov.unknownIds.map((u) => `验收覆盖脱节：F 项引用契约不存在的验收项 ${u}`),
      ...cov.missingIds.map((m) => `验收覆盖缺口：契约验收项 ${m} 无任何 F 项 accepts 引用`),
    ];
    clauses.acceptanceCoverage = { ok: cov.unknownIds.length === 0 && cov.missingIds.length === 0, reasons: covReasons };
  } else {
    clauses.contractAndAuth = { ok: true, reasons: ["无契约 v2 目标——契约门不适用（评审义务照常生成，拍板 7）"] };
    clauses.acceptanceCoverage = { ok: true, reasons: ["无契约——验收映射由计划 F 面承载（n.a.）"] };
  }

  // ③ 策略身份有效（记录在案 ∧ inputsHash=现算 ∧ rulesHash=现行规则）
  let record = null;
  try {
    record = loadPolicyRecord(cwd, goal.slug, goal.attempt);
  } catch (e) {
    clauses.policyIdentity = { ok: false, reasons: [`策略记录不可读（fail-closed）——${e?.message?.slice(0, 140) ?? e}`] };
  }
  let identity = null;
  if (clauses.policyIdentity === undefined) {
    if (!record) {
      clauses.policyIdentity = {
        ok: false,
        reasons: ["策略记录缺席——v2 目标须有策略身份（先由接线面 ensurePolicyRecord 落档）"],
      };
    } else {
      try {
        identity = computePolicyIdentity(cwd, goal);
        const nowHash = identityStableHash(identity);
        if (record.inputsHash !== nowHash) {
          clauses.policyIdentity = {
            ok: false,
            reasons: [
              `策略输入身份漂移（在案 ${record.inputsHash.slice(0, 8)}…≠现算 ${nowHash.slice(0, 8)}…）——任务运行期间固定策略版本（V02）；合法扩大走显式 expand`,
            ],
          };
        } else if (record.rulesHash !== policyRulesHash()) {
          clauses.policyIdentity = {
            ok: false,
            reasons: [`策略规则版本漂移（在案 ${record.rulesHash.slice(0, 8)}…≠现行 ${policyRulesHash().slice(0, 8)}…）——新版本只能作为采纳提案，不自动替换在途（§3.1）`],
          };
        } else {
          clauses.policyIdentity = { ok: true, reasons: [`策略身份有效（${record.inputsHash.slice(0, 8)}… · dutyTable v${record.dutyTableVersion}）`] };
        }
      } catch (e) {
        clauses.policyIdentity = { ok: false, reasons: [`策略身份现算失败（fail-closed）——${e?.message?.slice(0, 140) ?? e}`] };
      }
    }
  }

  // ④ 逐义务判定（record 在案才有义务集；缺席时义务面如实空+阻塞已在③）
  const obligations = [];
  const receipts = record ? listReceipts(cwd, goal.slug) : [];
  if (record) {
    for (const ob of record.obligations) {
      const entry = { id: ob.id, type: ob.type, baseline: ob.baseline === true, state: "satisfied", reasons: [], basis: {} };
      if (ob.type === "review") {
        if (!record.runnerFace?.available) {
          entry.state = "unsatisfied";
          entry.reasons = [
            `受控评审运行器未接入（${record.runnerFace?.plannedPhase ?? "M2"}）——评审义务诚实阻塞，本阶段不伪造评审完成声明（§8 M1 出口）`,
          ];
          entry.basis = { runnerFace: record.runnerFace ?? { available: false } };
        } else {
          entry.state = "unsatisfied";
          entry.reasons = ["评审回执面未实现——评审运行记录家族缺席（M2 交付）"];
        }
      } else if (ob.type === "check") {
        const checkId = ob.id.slice("check.".length);
        const candidates = receipts.filter((r) => (r.kind === "run" || r.kind === "reuse") && r.checkId === checkId);
        const best = latestReceipt(candidates);
        if (!best) {
          entry.state = "unsatisfied";
          entry.reasons = [`检查「${checkId}」无在案回执——lzy verify run ${checkId} 取真实回执`];
        } else {
          const success = judgeReceiptSuccess(best);
          const identityOk = judgeReceiptIdentity(cwd, best);
          entry.basis = { runId: best.runId, kind: best.kind, endedAt: best.endedAt ?? null };
          if (!success.ok || !identityOk.ok) {
            entry.state = "unsatisfied";
            entry.reasons = [...success.reasons, ...identityOk.reasons];
          } else {
            entry.reasons = [`回执 ${best.runId}（${best.kind}）适用∧成功∧身份三轴满足`];
          }
        }
      } else if (ob.type === "ci") {
        const ciReceipts = receipts.filter((r) => r.kind === "ci");
        const best = latestReceipt(ciReceipts);
        if (!best) {
          entry.state = "unsatisfied";
          entry.reasons = ["CI 无在案回执——lzy verify ci 取真实读回"];
        } else {
          const identityOk = judgeReceiptIdentity(cwd, best);
          const required = judgeRequiredCiChecks(best.ci?.checks ?? null, ob.requiredChecks ?? []);
          entry.basis = { runId: best.runId, sha: best.ci?.sha ?? null, green: required.green };
          if (!identityOk.ok || !required.ok) {
            entry.state = "unsatisfied";
            entry.reasons = [...identityOk.reasons, ...required.reasons];
          } else {
            entry.reasons = [`必需集合 ${required.green.length} 项全绿且绑当前候选（${best.ci?.sha?.slice(0, 8) ?? "?"}）`];
          }
        }
      } else if (ob.type === "delivery-audit") {
        const audit = auditDeliveryIntents(loadIntents(cwd));
        entry.basis = { intents: loadIntents(cwd)?.intents?.length ?? 0 };
        if (!audit.ok) {
          entry.state = "unsatisfied";
          entry.reasons = audit.reasons;
        } else {
          entry.reasons = audit.reasons;
        }
      } else {
        entry.state = "unsatisfied";
        entry.reasons = [`义务类型不识别：${ob.type}（fail-closed）`];
      }
      obligations.push(entry);
    }
  } else {
    obligations.push({
      id: "(policy-record-absent)",
      type: "record",
      baseline: false,
      state: "unsatisfied",
      reasons: ["策略记录缺席——义务面无从判定（阻塞已在 policyIdentity 子句载明）"],
      basis: {},
    });
  }

  // ⑤ 发现面（M3 建账）——如实声明，不冒充已核
  clauses.findings = { ok: true, reasons: ["发现面未建立（M3 建账）——本子句无可判事实，不冒充已核"] };
  // ⑥ 既有门引用（单一事实源：步骤/证据/comparator/净树/竞态仍由 finish 执法）
  clauses.existingGates = {
    ok: true,
    reasons: ["步骤/F 证据/comparator/净树/竞态门由 finish 既有门执法——本门只引用不重复取证"],
  };

  const blockedReasons = [];
  for (const [name, c] of Object.entries(clauses)) {
    if (!c.ok) for (const r of c.reasons) blockedReasons.push(`[${name}] ${r}`);
  }
  for (const o of obligations) {
    if (o.state !== "satisfied") for (const r of o.reasons) blockedReasons.push(`[义务 ${o.id}] ${r}`);
  }
  const body = {
    ...head,
    applicable: true,
    verdict: blockedReasons.length === 0 ? "pass" : "blocked",
    clauses,
    obligations,
    blocked: blockedReasons.length > 0,
    blockedReasons,
  };
  return { ...body, snapshotHash: snapshotHashOf(body) };
}
