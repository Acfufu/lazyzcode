// 迁移预览（0.3.0 M1，主方案 §8/M0 报告 §9）：对旧版本目标循环残档做**只读**预览——
// 枚举旧记录族（goal.json/attestations/snapshots/salvage/approvals/evidence report），
// 按 M0 §9 映射产出「待确认需求契约」草案（验收项草案自快照 F 断言、终点草案、
// authorization=NONE 与提权禁止点）。零写回、无锁（家法同 lzy dag stale「只展示不进门」）；
// 活跃 goal 在场=拒绝（§8 在途不接管——迁移不做旧状态的隐式授权升级）。
// 完整迁移机器（校验备份/暂存/原子切换）归 M5；本命令只回答「这里有什么、新语义下
// 是什么、哪些事它不构成」。旧记录损坏在预览里显式可见（⚠ 行），不静默跳过也不阻断
// 展示——预览是展示面，执法面（fail-closed）在闸不在读。
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, basename, dirname } from "node:path";
import { createHash } from "node:crypto";
import { loadRuntime, holderPidAlive } from "./runtime.js";

export class MigrateError extends Error {}

// ── 0.3.0 M5 完整迁移机器（主方案 §8）────────────────────────────
// preview（M1）只读展示；apply 走「校验备份→暂存→校验→原子切换」四阶段：
//   · journal/<runId>.jsonl 相位记账（start/backup/stage/validate/switch/done），
//     崩溃后重跑探测未收尾 run 并按任务身份幂等续跑（不重复不覆盖）；
//   · .lazyzcode/state.json=版本入口（最后写=提交点）：schemaVersion+stateVersion+
//     逐任务迁移记录；未知 schema/state 版本=写前 fail-closed 停止；
//   · 备份=六记录族整树复制（复制非移动，源字节不动）+manifest 逐文件 sha256 双读校验；
//   · 在途转换=旧 goal（planning/executing 且无活体 lease/持有进程已死）→drafts/
//     契约草案（authorization=NONE+提权禁止，沿 preview 草案形状；草案无 scope 不可
//     直接 register——天然 fail-closed）；已完成目标与全部 preserve 族原样字节保留；
//   · 执法分界（与 A2 对照声明同构）：goal.json 损坏/未知版本=任何写入前停止；
//     preserve 族损坏=⚠记录并原样保留不阻断（执法面在闸不在读，同 M1 先例）。
// runtime 活性面：活跃 lease（未过期）且持有进程存活=拒；executing 但持有进程
// 已死（ESRCH）=在途可转换（僵尸租约同 lzy loop lease reclaim 语义）。

export const MIGRATION_STATE_SCHEMA_VERSION = 1;
export const STATE_VERSION = "0.3.0";

const MIG_DIR = (root) => join(root, ".lazyzcode", "migration");
const STATE_PATH = (root) => join(root, ".lazyzcode", "state.json");
const DRAFTS_DIR = (root) => join(root, ".lazyzcode", "drafts");

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

// ── apply 机器内部件 ──────────────────────────────────────────────

function sha256File(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

// 备份六记录族（相对 .lazyzcode/ 的路径；存在才拷，整树复制字节保真）。
const BACKUP_FAMILIES = [
  "loop/goal.json",
  "loop/approvals",
  "loop/snapshots",
  "loop/salvage",
  "attestations",
  "evidence",
  "plans",
];

function listFilesRecursive(dir) {
  const out = [];
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names.sort()) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...listFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

function appendJournal(root, runId, entry) {
  const dir = join(MIG_DIR(root), "journal");
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `${runId}.jsonl`), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

function listRuns(root) {
  return listDirSafe(join(MIG_DIR(root), "journal")).filter((f) => f.endsWith(".jsonl"));
}

function lastPhaseOf(root, runId) {
  try {
    const lines = readFileSync(join(MIG_DIR(root), "journal", runId), "utf8").trim().split("\n");
    const last = lines[lines.length - 1];
    return last ? (JSON.parse(last).phase ?? "?") : "空";
  } catch {
    return "不可读";
  }
}

// state.json 版本入口读面（fail-closed）：损坏/未知 schema=拒（apply 写前停；status 照实示）。
export function loadMigrationState(root) {
  const p = STATE_PATH(root);
  if (!existsSync(p)) return null;
  let rec;
  try {
    rec = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    throw new MigrateError(`state.json 在场但不可解析（版本入口损坏）——${p}。迁移停止，源状态未动；先人工核对或移除该文件后重跑`);
  }
  if (rec.schemaVersion !== MIGRATION_STATE_SCHEMA_VERSION) {
    throw new MigrateError(
      `state.json schemaVersion 不识别：${JSON.stringify(rec.schemaVersion)}（本版认 ${MIGRATION_STATE_SCHEMA_VERSION}）——停止切换，不覆盖源`,
    );
  }
  if (typeof rec.stateVersion !== "string") {
    throw new MigrateError(`state.json 缺 stateVersion 字符串字段——停止切换，不覆盖源（${p}）`);
  }
  return rec;
}

// 在途/活跃/终态分类（执法面）：
//   corrupt=goal.json 损坏或未知版本（写前停）；live=活跃 goal 且活体 lease/进程在场（拒）；
//   inflight=planning/executing 但无活体持有（可转换）；finished/none=原样保留。
export function classifyGoal(root, now = Date.now()) {
  const goalPath = join(LZ_ROOT(root), "loop", "goal.json");
  if (!existsSync(goalPath)) return { kind: "none" };
  const goal = readJsonSafe(goalPath);
  if (!goal) return { kind: "corrupt", goalPath };
  if (goal.version != null && goal.version !== 1) {
    return { kind: "corrupt", goalPath, reason: `未知 goal schemaVersion ${JSON.stringify(goal.version)}` };
  }
  if (!ACTIVE_GOAL_STATES.has(goal.status)) return { kind: "finished", goal };
  let lease = null;
  let runtimeUnreadable = false;
  try {
    lease = loadRuntime(root)?.activeLease ?? null;
  } catch {
    runtimeUnreadable = true; // 保守侧：活体判别不可定=按在场处理（同 holderPidAlive 不确定情形教义）
  }
  if (lease != null && typeof lease.expiresAtMs === "number" && lease.expiresAtMs > now && holderPidAlive(lease.hostPid) !== false) {
    return { kind: "live", goal, lease };
  }
  if (runtimeUnreadable) {
    return { kind: "live", goal, lease: null, reason: "runtime.json 不可读（活体判别不可定，保守侧拒绝）" };
  }
  return { kind: "inflight", goal, leaseZombie: lease != null && typeof lease.expiresAtMs === "number" && lease.expiresAtMs > now };
}

// previewMigration 用相对路径取 .lazyzcode（保持其公开签名 root=项目根不变）。
function LZ_ROOT(root) {
  return join(root, ".lazyzcode");
}

function draftContractDoc(root, goal, runId, acceptanceDrafts) {
  const slug = goal.slug ?? "unknown";
  const lines = [];
  lines.push("# 迁移草案契约：" + slug);
  lines.push("<!-- lzy migrate apply 机械转换产物（主方案 §8）。人工核对后须另立正式契约文件（补 scope/验收项定稿）走 lzy loop register --contract + UPS 批准；本草案不构成任何授权。 -->");
  lines.push("");
  lines.push(`task: ${slug}（迁移草案，源自旧目标残档 status=${goal.status}）`);
  lines.push(`endpoint: A（草案缺省：旧 attestation 只证 LOOP_COMPLETE，不构成 A/B/C 任一终点的完成证据）`);
  lines.push(`authorization: NONE——旧 planHash 批准是对执行计划的批准（ADR-0018 语义），不得重放为契约授权（ADR-0024）；转换产物须全新 UPS 批准`);
  lines.push(`provenance: planHash=${goal.planHash ?? "无"} · source=.lazyzcode/loop/goal.json · runId=${runId} · convertedAt=${new Date().toISOString()}`);
  lines.push("");
  lines.push("## 验收项草案（自计划快照 F 断言机械提取）");
  if (acceptanceDrafts.length > 0) for (const a of acceptanceDrafts) lines.push(`- ${a}`);
  else lines.push("- （草案素材缺席：无现行计划快照可解析 F 断言——按原记录人工起草）");
  lines.push("");
  lines.push("## 提权禁止点");
  lines.push("· 旧 approval 不得重放为契约授权；新契约须全新 UPS 批准");
  lines.push("· 旧 attestation ≠ 新 A/B/C 交付终点的完成证据；不伪造新回执");
  lines.push("· 旧全树证据按原绑定（复合指纹）原义解释；范围档资格须重新建立（ADR-0025）");
  lines.push("· salvage 盘点 ≠ 授权；接手仍走契约批准");
  lines.push("");
  return lines.join("\n");
}

// 从现行计划快照机械提取 F 断言（同 preview 的素材源）。
function acceptanceDraftsFor(root, slug) {
  for (const name of listDirSafe(join(LZ_ROOT(root), "loop", "snapshots"))) {
    if (!name.endsWith(".md") || name.startsWith(".")) continue;
    if (name.replace(/\.md$/, "").replace(/\.attempt\d+$/, "") !== slug) continue;
    if (/\.attempt\d+\.md$/.test(name)) continue; // 只取现行代次
    try {
      const text = readFileSync(join(LZ_ROOT(root), "loop", "snapshots", name), "utf8");
      return [...text.matchAll(new RegExp(F_LINE_RE.source, "gm"))].map((m) => `F${m[1]}: ${m[2].trim()}`);
    } catch {
      return []; // 快照不可读=素材缺席，草案自带缺席说明（preserve 族 ⚠ 由 backup 阶段记）
    }
  }
  return [];
}

function writeAtomic(p, data) {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = join(dirname(p), `.${basename(p)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, data);
  renameSync(tmp, p);
}

// ── apply：四阶段显式迁移（§8：预览→备份→暂存→校验→原子切换）────────
export function applyMigration(root) {
  const lz = LZ_ROOT(root);
  if (!existsSync(lz)) {
    return { root, mode: "noop", reason: "无 .lazyzcode/（无旧记录族）——无需迁移", warnings: [], runId: null };
  }
  // 前置分类（fail-closed 面：corrupt/live 在任何写入前停止）
  const cls = classifyGoal(root);
  if (cls.kind === "corrupt") {
    throw new MigrateError(
      `迁移拒绝：goal.json 损坏${cls.reason ? `（${cls.reason}）` : "（不可解析）"}——${cls.goalPath}。写前停止，源状态未动；先人工核对`,
    );
  }
  if (cls.kind === "live") {
    throw new MigrateError(
      `迁移拒绝：活跃目标 ${cls.goal.slug ?? "?"}（${cls.goal.status}）${cls.reason ?? `持活体租约（fence ${cls.lease?.fence ?? "?"}，pid ${cls.lease?.hostPid ?? "?"} 存活）`}——§8 活跃 lease/进程在场拒写迁移；先收口或人工核对后重跑`,
    );
  }
  const state = loadMigrationState(root); // 损坏/未知 schema=此处抛（写前）
  const warnings = [];
  const slug = cls.goal?.slug ?? "?";
  const converted = cls.kind === "inflight" && state?.tasks?.[slug]?.planHash === (cls.goal.planHash ?? null);
  const unfinished = listRuns(root).filter((r) => lastPhaseOf(root, r) !== "done");
  if (cls.kind !== "inflight" || converted) {
    return {
      root,
      mode: "noop",
      reason: converted
        ? `在途目标 ${slug} 已按任务身份（slug+planHash）迁移（run ${state.tasks[slug].runId}）——幂等 no-op，不重复转换`
        : state
          ? `版本入口 stateVersion=${state.stateVersion} · 已迁移任务 ${Object.keys(state.tasks ?? {}).length} 个 · 目标终态=${cls.kind}——原样保留，幂等 no-op`
          : `无在途目标（goal 判定=${cls.kind}，终态归档原样保留）——无可转换任务，幂等 no-op`,
      warnings,
      runId: null,
      unfinishedRuns: unfinished,
    };
  }
  return runPhases(root, cls, state, warnings, unfinished);
}

function runPhases(root, cls, state, warnings, unfinished) {
  const runId = `${Date.now()}-pid${process.pid}`;
  const notes = [];
  if (unfinished.length > 0) {
    notes.push(`检测到未收尾 run ${unfinished.join(", ")}（最后相位 ${lastPhaseOf(root, unfinished[unfinished.length - 1])}）——按任务身份幂等续跑，不覆盖源`);
  }
  appendJournal(root, runId, { phase: "start", root, goalKind: cls.kind });
  // 阶段 1：校验备份（复制非移动；manifest 逐文件 sha256 双读校验）
  const backupDir = join(MIG_DIR(root), "backup", runId);
  mkdirSync(backupDir, { recursive: true });
  const manifest = [];
  for (const rel of BACKUP_FAMILIES) {
    const src = join(LZ_ROOT(root), rel);
    if (!existsSync(src)) continue;
    const dst = join(backupDir, rel);
    mkdirSync(join(dst, ".."), { recursive: true });
    cpSync(src, dst, { recursive: true });
    for (const f of (existsSync(dst) && statSync(dst).isDirectory() ? listFilesRecursive(dst) : [dst])) {
      manifest.push({ rel: f.slice(backupDir.length + 1), sha256: sha256File(f), bytes: statSync(f).size });
    }
  }
  // 双读校验：备份副本逐文件重哈希与首读一致
  for (const m of manifest) {
    const again = sha256File(join(backupDir, m.rel));
    if (again !== m.sha256) {
      appendJournal(root, runId, { phase: "backup-mismatch", rel: m.rel });
      throw new MigrateError(`备份校验失败：${m.rel} 双读 sha256 不一致——迁移中止（源未动；备份在 ${backupDir}）`);
    }
  }
  appendJournal(root, runId, { phase: "backup", files: manifest.length, manifest: "manifest.json" });
  writeFileSync(join(backupDir, "manifest.json"), `${JSON.stringify({ runId, createdAt: new Date().toISOString(), files: manifest }, null, 2)}\n`);
  // preserve 族损坏盘点（⚠ 记账不阻断——原样字节保留）
  for (const rel of ["attestations", "loop/approvals", "loop/snapshots", "evidence", "loop/salvage", "plans"]) {
    const dir = join(LZ_ROOT(root), rel);
    for (const f of listFilesRecursive(dir)) {
      if (f.endsWith(".json")) {
        if (readJsonSafe(f) === null) warnings.push(`${rel}/${f.split("/").pop()}：JSON 不可解析——⚠ 原样保留（备份含该字节）`);
      }
    }
  }
  // 阶段 2：暂存（在途→drafts 草案；到达此函数者必为 inflight 且未迁移）
  const stageDir = join(MIG_DIR(root), "stage", runId);
  const staged = [];
  if (cls.kind === "inflight") {
    const slug = cls.goal.slug ?? "unknown";
    const doc = draftContractDoc(root, cls.goal, runId, acceptanceDraftsFor(root, slug));
    mkdirSync(join(stageDir, "drafts"), { recursive: true });
    const sp = join(stageDir, "drafts", `${slug}.draft-contract.md`);
    writeFileSync(sp, doc);
    if (!existsSync(sp) || !readFileSync(sp, "utf8").includes("authorization: NONE")) {
      appendJournal(root, runId, { phase: "stage-invalid", slug });
      throw new MigrateError(`暂存校验失败：草案缺 authorization: NONE——迁移中止（源未动）`);
    }
    staged.push({ slug, planHash: cls.goal.planHash ?? null, sourceStatus: cls.goal.status, stagedFile: sp });
  }
  appendJournal(root, runId, { phase: "stage", drafts: staged.length });
  // 阶段 3：校验（备份清单重读+草案非空）
  const reread = JSON.parse(readFileSync(join(backupDir, "manifest.json"), "utf8"));
  if (reread.files.length !== manifest.length) {
    appendJournal(root, runId, { phase: "validate-failed" });
    throw new MigrateError(`校验失败：manifest 重读条数 ${reread.files.length}≠首读 ${manifest.length}——迁移中止（源未动）`);
  }
  appendJournal(root, runId, { phase: "validate", ok: true });
  // 阶段 4：原子切换（草案逐文件 tmp+rename 落 drafts/；state.json 最后写=提交点）
  const draftsDir = DRAFTS_DIR(root);
  mkdirSync(draftsDir, { recursive: true });
  const draftsWritten = [];
  const draftsSkipped = [];
  for (const s of staged) {
    const target = join(draftsDir, `${s.slug}.draft-contract.md`);
    if (existsSync(target)) {
      draftsSkipped.push(target); // 幂等：既有草案（含人工修订）绝不覆盖
      continue;
    }
    const tmp = join(draftsDir, `.${s.slug}.draft-contract.md.${process.pid}.${Date.now()}.tmp`);
    writeFileSync(tmp, readFileSync(s.stagedFile));
    renameSync(tmp, target);
    draftsWritten.push(target);
  }
  // state.json 合并写（最后写=提交点）
  const next = {
    schemaVersion: MIGRATION_STATE_SCHEMA_VERSION,
    stateVersion: STATE_VERSION,
    updatedAt: new Date().toISOString(),
    lastRunId: runId,
    tasks: { ...(state?.tasks ?? {}) },
  };
  for (const s of staged) {
    next.tasks[s.slug] = { planHash: s.planHash, sourceStatus: s.sourceStatus, convertedAt: next.updatedAt, runId, draftFile: `.lazyzcode/drafts/${s.slug}.draft-contract.md` };
  }
  writeAtomic(STATE_PATH(root), `${JSON.stringify(next, null, 2)}\n`);
  appendJournal(root, runId, { phase: "switch", draftsWritten: draftsWritten.length, draftsSkipped: draftsSkipped.length, stateUpdated: true });
  appendJournal(root, runId, { phase: "done", warnings: warnings.length });
  return {
    root,
    mode: "applied",
    runId,
    notes,
    warnings,
    backupDir,
    backupFiles: manifest.length,
    draftsWritten,
    draftsSkipped,
    stateVersion: STATE_VERSION,
    unfinishedRuns: unfinished,
  };
}

// ── status：迁移状态读面（只读）───────────────────────────────────
export function migrationStatus(root) {
  const cls = classifyGoal(root);
  let state = null;
  let stateProblem = null;
  try {
    state = loadMigrationState(root);
  } catch (err) {
    stateProblem = err.message;
  }
  const runs = listRuns(root).map((f) => ({ run: f.replace(/\.jsonl$/, ""), lastPhase: lastPhaseOf(root, f) }));
  return {
    root,
    goalKind: cls.kind,
    goalSlug: cls.goal?.slug ?? null,
    state: state
      ? { stateVersion: state.stateVersion, updatedAt: state.updatedAt ?? null, lastRunId: state.lastRunId ?? null, tasks: Object.entries(state.tasks ?? {}).map(([slug, t]) => ({ slug, planHash: t.planHash, convertedAt: t.convertedAt, draftFile: t.draftFile })) }
      : null,
    stateProblem,
    runs,
    unfinishedRuns: runs.filter((r) => r.lastPhase !== "done").map((r) => r.run),
  };
}

export function renderMigrationApply(result) {
  const lines = [];
  if (result.mode === "noop") {
    lines.push(`迁移 apply：${result.reason}`);
    for (const n of result.unfinishedRuns ?? []) lines.push(`⚠ 未收尾 run（只记录不阻断）：${n}`);
    for (const w of result.warnings) lines.push(`⚠ ${w}`);
    return lines.join("\n");
  }
  lines.push(`迁移 apply 完成（run ${result.runId}）：备份 ${result.backupFiles} 文件 → ${result.backupDir}`);
  for (const n of result.notes) lines.push(`· ${n}`);
  lines.push(`drafts 草案：写入 ${result.draftsWritten.length} · 跳过（幂等不覆盖）${result.draftsSkipped.length}`);
  for (const d of result.draftsWritten) lines.push(`  + ${d}`);
  for (const d of result.draftsSkipped) lines.push(`  = ${d}（已在场，不覆盖）`);
  lines.push(`版本入口：.lazyzcode/state.json stateVersion=${result.stateVersion}`);
  for (const w of result.warnings) lines.push(`⚠ ${w}`);
  return lines.join("\n");
}

export function renderMigrationStatus(s) {
  const lines = [];
  lines.push(`迁移状态（只读）：${s.root}`);
  lines.push(`goal 判定：${s.goalKind}${s.goalSlug ? `（${s.goalSlug}）` : ""}`);
  if (s.stateProblem) lines.push(`⚠ state.json：${s.stateProblem}`);
  else if (s.state) {
    lines.push(`版本入口：stateVersion=${s.state.stateVersion} · updatedAt=${s.state.updatedAt ?? "?"} · lastRunId=${s.state.lastRunId ?? "?"} · 已迁移任务 ${s.state.tasks.length}`);
    for (const t of s.state.tasks) lines.push(`  · ${t.slug} planHash=${t.planHash ?? "无"} → ${t.draftFile}`);
  } else lines.push("版本入口：无 state.json（未迁移）");
  lines.push(`journal runs：${s.runs.length}${s.unfinishedRuns.length ? `（未收尾 ${s.unfinishedRuns.length}）` : ""}`);
  for (const r of s.runs.slice(-5)) lines.push(`  · ${r.run} 相位=${r.lastPhase}`);
  return lines.join("\n");
}
