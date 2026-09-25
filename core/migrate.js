// 迁移预览（0.3.0 M1，主方案 §8/M0 报告 §9）：对旧版本目标循环残档做**只读**预览——
// 枚举旧记录族（goal.json/attestations/snapshots/salvage/approvals/evidence report），
// 按 M0 §9 映射产出「待确认需求契约」草案（验收项草案自快照 F 断言、终点草案、
// authorization=NONE 与提权禁止点）。零写回、无锁（家法同 lzy dag stale「只展示不进门」）；
// 活跃 goal 在场=拒绝（§8 在途不接管——迁移不做旧状态的隐式授权升级）。
// 完整迁移机器（校验备份/暂存/原子切换）归 M5；本命令只回答「这里有什么、新语义下
// 是什么、哪些事它不构成」。旧记录损坏在预览里显式可见（⚠ 行），不静默跳过也不阻断
// 展示——预览是展示面，执法面（fail-closed）在闸不在读。
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export class MigrateError extends Error {}

const ACTIVE_GOAL_STATES = new Set(["planning", "executing"]);

function readJsonSafe(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function listDirSafe(dir) {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

// F 断言行（acceptance 草案素材源）：与计划解析同形（- [F1] 标题）。
const F_LINE_RE = /^-\s*\[F(\d+)\]\s*(.+)$/;

// 旧 approval 记录形状（version 1）：仅判定「像不像批准记录」，坏形状计入 ⚠。
function looksLikeApproval(rec) {
  return !!rec && typeof rec === "object" && rec.slug && typeof rec.planHash === "string";
}

function looksLikeAttestation(rec) {
  return !!rec && typeof rec === "object" && rec.slug && typeof rec.planHash === "string";
}

export function previewMigration(root) {
  const lz = join(root, ".lazyzcode");
  // 活跃 goal 在场=拒绝（§8：活跃 lease/进程在场时拒绝写迁移；预览同口径不接管在途）。
  const goalPath = join(lz, "loop", "goal.json");
  if (existsSync(goalPath)) {
    const goal = readJsonSafe(goalPath);
    if (!goal) {
      throw new MigrateError(
        `迁移预览拒绝：目标根 goal.json 在场但不可解析（未知状态）——${goalPath}。` +
          `先人工核对（在途目标不动；确属残档可移出 goal.json 后重跑）`,
      );
    }
    if (ACTIVE_GOAL_STATES.has(goal.status)) {
      throw new MigrateError(
        `迁移预览拒绝：目标根存在活跃目标 ${goal.slug ?? "?"}（${goal.status}）——在途目标不接管；` +
          `如需转换，先在原版本 lzy 下收口（finish/abandon）或按主方案 §8 走显式迁移（M5）`,
      );
    }
  }
  const warnings = [];
  const tasks = new Map();
  const taskOf = (slug) => {
    if (!tasks.has(slug)) {
      tasks.set(slug, {
        slug,
        goalState: null,
        attestations: [],
        snapshots: [],
        salvage: [],
        approvals: [],
        evidenceReports: [],
      });
    }
    return tasks.get(slug);
  };
  // goal.json（终态在场=历史归档，非活跃已在上一步排除）
  if (existsSync(goalPath)) {
    const goal = readJsonSafe(goalPath);
    const t = taskOf(goal.slug ?? "unknown");
    t.goalState = { status: goal.status, planHash: goal.planHash ?? null, tier: goal.tier ?? null };
  }
  // attestations
  for (const name of listDirSafe(join(lz, "attestations"))) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const p = join(lz, "attestations", name);
    const rec = readJsonSafe(p);
    if (!looksLikeAttestation(rec)) {
      warnings.push(`attestations/${name}：形状不像 attestation（缺 slug/planHash），按原样保留不计入草案`);
      continue;
    }
    taskOf(rec.slug).attestations.push({ file: name, attemptId: rec.attemptId ?? null, planHash: rec.planHash, at: rec.at ?? null });
  }
  // snapshots（含 supersede 归档 .attempt<n>.md——归档=旧代次，标注代次）
  for (const name of listDirSafe(join(lz, "loop", "snapshots"))) {
    if (!name.endsWith(".md") || name.startsWith(".")) continue;
    const p = join(lz, "loop", "snapshots", name);
    let text = "";
    try {
      text = readFileSync(p, "utf8");
    } catch {
      warnings.push(`loop/snapshots/${name}：不可读，跳过（原样保留）`);
      continue;
    }
    const slug = name.replace(/\.md$/, "").replace(/\.attempt\d+$/, "");
    const archived = /\.attempt\d+\.md$/.test(name);
    const acceptances = [...text.matchAll(new RegExp(F_LINE_RE.source, "gm"))].map((m) => `F${m[1]}: ${m[2].trim()}`);
    taskOf(slug).snapshots.push({ file: name, archived, acceptanceDrafts: acceptances });
  }
  // salvage 存根
  for (const name of listDirSafe(join(lz, "loop", "salvage"))) {
    if (!name.endsWith(".md") || name.startsWith(".")) continue;
    const slug = name.replace(/\.md$/, "");
    taskOf(slug).salvage.push(name);
  }
  // approvals
  for (const name of listDirSafe(join(lz, "loop", "approvals"))) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const rec = readJsonSafe(join(lz, "loop", "approvals", name));
    if (!looksLikeApproval(rec)) {
      warnings.push(`loop/approvals/${name}：形状不像批准记录，按原样保留不计入草案`);
      continue;
    }
    taskOf(rec.slug).approvals.push({ file: name, planHash: rec.planHash, at: rec.at ?? null });
  }
  // evidence 证据包报告
  for (const name of listDirSafe(join(lz, "evidence"))) {
    if (!name.endsWith(".report.md") || name.startsWith(".")) continue;
    taskOf(name.replace(/\.report\.md$/, "")).evidenceReports.push(name);
  }
  return {
    root,
    warnings,
    tasks: [...tasks.values()].map((t) => renderTaskDraft(t)),
  };
}

// 单任务草案：按 M0 §9 映射标注新语义解释与提权禁止点。authorization 恒 NONE——
// 旧 planHash 批准不升级为契约授权；旧 attestation 不构成新终点证据（M0 映射表）。
function renderTaskDraft(t) {
  const current = t.snapshots.filter((s) => !s.archived);
  const acceptanceDrafts = (current[0] ?? t.snapshots[0])?.acceptanceDrafts ?? [];
  const note = {
    task: `${t.slug}（${t.goalState ? `goal.json 终态在场：${t.goalState.status}` : "goal.json 缺席（reset 残档）"}）`,
    acceptanceDraft: acceptanceDrafts.length > 0 ? acceptanceDrafts : ["（草案素材缺席：无现行计划快照可解析 F 断言——按原记录人工起草）"],
    endpoint: "A（草案缺省：旧记录的历史 attestation 只证 LOOP_COMPLETE，不构成 A/B/C 任一终点的完成证据）",
    authorization: "NONE——旧 planHash 批准是对执行计划的批准（ADR-0018 语义），不得重放为契约授权（ADR-0024）；转换产物须新批准",
    counts: {
      attestations: t.attestations.length,
      snapshots: t.snapshots.length,
      salvage: t.salvage.length,
      approvals: t.approvals.length,
      evidenceReports: t.evidenceReports.length,
    },
    privilegeEscalationProhibitions: [
      "旧 approval 不得重放为契约授权；新契约须全新 UPS 批准",
      "旧 attestation ≠ 新 A/B/C 交付终点的完成证据；不伪造新回执",
      "旧全树证据按原绑定（复合指纹）原义解释；范围档资格须重新建立（ADR-0025）",
      "salvage 盘点 ≠ 授权；接手仍走契约批准",
    ],
  };
  return note;
}

export function renderMigrationPreview(result) {
  const lines = [];
  lines.push(`迁移预览（只读，零写回——旧记录按原样保留；完整迁移机器归 M5）：${result.root}`);
  lines.push(`任务 ${result.tasks.length} 个 · ⚠ ${result.warnings.length} 条`);
  for (const t of result.tasks) {
    lines.push(`\n── task: ${t.task}`);
    lines.push(`  记录族计数：attestations ${t.counts.attestations} · snapshots ${t.counts.snapshots} · salvage ${t.counts.salvage} · approvals ${t.counts.approvals} · evidence ${t.counts.evidenceReports}`);
    lines.push(`  endpoint 草案：${t.endpoint}`);
    lines.push(`  authorization：${t.authorization}`);
    lines.push(`  验收项草案：`);
    for (const a of t.acceptanceDraft) lines.push(`    - ${a}`);
    lines.push(`  提权禁止点：`);
    for (const p of t.privilegeEscalationProhibitions) lines.push(`    · ${p}`);
  }
  for (const w of result.warnings) lines.push(`\n⚠ ${w}`);
  return lines.join("\n");
}
