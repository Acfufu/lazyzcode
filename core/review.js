// 受控独立评审运行记录家族（0.4.0 M2，ADR-0031；docs/plan-v040-engineering-policy.md §4.1/§4.2）。
// 位阶同 policy/verify：loop/ 外、reset 不清；每次评审运行一档 <slug>.a<attempt>.r<seq>.json +
// 同茎运行目录（input.json/candidate/home/raw.txt，N2/N3 物化）。族容器走 queue.js
// loadFamilyFile/saveFamilyFile 家法（原子写 0600+校验和+版本+形状闸 fail-closed）。
// 记录携带 attempt/dutyTableVersion/templateHash 三字段=统一门代次锚与规则一致性谓词的数据面
//（拍板 6）；dutyTableVersion 不在此钉现行值——旧规则版本的记录须保持可读，一致性由 gate 判。
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFamilyFile, saveFamilyFile } from "./queue.js";

export const REVIEW_VERSION = 1;
export const REVIEW_FAMILY = "review";
export const BASELINE_DUTY_ID = "review.general-correctness";
// M2 职责集=底线一条（§3.1 必选）；三条专项职责列 M4 输入（须与范围资格面同批）。
export const DUTY_TABLE = [
  { id: BASELINE_DUTY_ID, baseline: true, template: "core/review-duties/general-correctness.md" },
];
export const SEVERITIES = ["P0", "P1", "P2", "P3"];
export const VERDICTS = ["pass", "blocked"];
export const METERING_STATUSES = ["metered", "absent", "unpriced"];
// 逐因失败分类（N3 唯一定义；gate 拍板 6 逐因阻塞的码面）。absent/unpriced 两计量因在此与
// 执行因并列——计量缺席也是「义务不可满足」的 invalid 因，运行本身照常落档（拍板 7）。
export const INVALID_REASONS = [
  "timeout",
  "exit-nonzero",
  "parse-fail",
  "candidate-moved",
  "contamination",
  "interrupted",
  "isolation-breach",
  "leak",
  "metering-absent",
  "unpriced-model",
];

export class ReviewError extends Error {}

// 职责模板：随核心载荷打包（package.json files 含 core/ 整目录），包相对路径解析、读后缓存。
// 模板 sha256 入运行记录（templateHash）与 policyRulesHash（N5）——内容即规则版本的一部分，
// 任何编辑=新规则版本（a2 落档后冻结，编辑须经 supersede 再采纳）。
function packageRelative(p) {
  return fileURLToPath(new URL(`../${p}`, import.meta.url));
}
let templateCache = null;
export function loadDutyTemplate(dutyId = BASELINE_DUTY_ID) {
  const entry = DUTY_TABLE.find((d) => d.id === dutyId);
  if (!entry) throw new ReviewError(`职责不在表：${dutyId}`);
  if (templateCache?.id === dutyId) return templateCache.text;
  const text = readFileSync(packageRelative(entry.template), "utf8");
  templateCache = { id: dutyId, text };
  return text;
}
export function dutyTemplateHash(dutyId = BASELINE_DUTY_ID) {
  return createHash("sha256").update(loadDutyTemplate(dutyId)).digest("hex");
}

// ── 路径与确定序 ──

export function reviewDir(cwd) {
  return join(cwd, ".lazyzcode", REVIEW_FAMILY);
}
export function reviewRunPath(cwd, slug, attempt, seq) {
  return join(reviewDir(cwd), `${slug}.a${attempt}.r${seq}.json`);
}
export function reviewRunStem(slug, attempt, seq) {
  return `${slug}.a${attempt}.r${seq}`;
}
// 序号分配（确定序）：计划写「在案档数+1」；以 max+1 实现同一确定序且对人工删除免疫碰撞
//（族内 json 只由 saveReviewRun 分配序号，正常时序两者恒等；人工清档后 count+1 会复用旧号
// 覆写幸存档，max+1 不会）。
export function nextRunSeq(cwd, slug, attempt) {
  let names;
  try {
    names = readdirSync(reviewDir(cwd));
  } catch {
    return 1;
  }
  const prefix = `${slug}.a${attempt}.r`;
  let max = 0;
  for (const n of names) {
    if (!n.startsWith(prefix) || !n.endsWith(".json")) continue;
    const k = Number(n.slice(prefix.length, -".json".length));
    if (Number.isInteger(k) && k > max) max = k;
  }
  return max + 1;
}

// ── 形状闸（N1 冻结全字段；机器面不信任盘上字节——queue.js assertItem 同款纪律）──
// 只做机械自洽（类型/枚举/哈希格式/字段间等式），策略性判定（规则版本一致、metered 才放行、
// 候选现行）归统一门评审子句（N5）——形状闸不复制政策，政策闸不放宽形状。
const HEX64 = /^[0-9a-f]{64}$/;
export function assertRunShape(rec, p) {
  const bad = (m) => {
    throw new ReviewError(`评审运行记录形状非法：${m}：${p}`);
  };
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) bad("记录须为对象");
  if (typeof rec.runId !== "string" || !/^.+\.a[0-9]+\.r[0-9]+$/.test(rec.runId)) bad("runId 须为 <slug>.a<n>.r<n> 茎");
  if (typeof rec.slug !== "string" || !rec.slug) bad("slug 缺席或空");
  if (!Number.isInteger(rec.attempt) || rec.attempt < 1) bad("attempt 须为 ≥1 整数");
  if (!Number.isInteger(rec.seq) || rec.seq < 1) bad("seq 须为 ≥1 整数");
  if (rec.runId !== reviewRunStem(rec.slug, rec.attempt, rec.seq)) bad("runId 与 slug/attempt/seq 不自洽");
  // 职责与规则版本面（dutyTableVersion 不钉现行——旧规则记录须可读，一致性由 gate 判）
  if (!rec.duty || typeof rec.duty !== "object" || Array.isArray(rec.duty)) bad("duty 须为对象");
  if (typeof rec.duty.id !== "string" || !DUTY_TABLE.some((d) => d.id === rec.duty.id)) {
    bad(`duty.id 不在职责表：${JSON.stringify(rec.duty?.id ?? null)}`);
  }
  if (!Number.isInteger(rec.dutyTableVersion) || rec.dutyTableVersion < 1) bad("dutyTableVersion 须为 ≥1 整数");
  if (!HEX64.test(rec.templateHash)) bad("templateHash 须为 64 hex");
  if (!HEX64.test(rec.inputPackageHash)) bad("inputPackageHash 须为 64 hex");
  // 候选面：candidateIdentity 三字段（verify.js 同源）+ 运行前净树断言结果 + 快照树哈希
  if (!rec.candidate || typeof rec.candidate !== "object" || Array.isArray(rec.candidate)) bad("candidate 须为对象");
  for (const k of ["headSha", "compositeFingerprint", "cliVersion"]) {
    if (typeof rec.candidate[k] !== "string" || !rec.candidate[k]) bad(`candidate.${k} 缺席或空`);
  }
  if (typeof rec.candidate.clean !== "boolean") bad("candidate.clean 须为布尔（运行前净树断言；脏树不 spawn）");
  if (!rec.snapshot || typeof rec.snapshot !== "object" || Array.isArray(rec.snapshot)) bad("snapshot 须为对象");
  if (!HEX64.test(rec.snapshot.treeHash)) bad("snapshot.treeHash 须为 64 hex");
  // 执行面
  for (const k of ["startedAt", "endedAt"]) {
    if (typeof rec[k] !== "string" || Number.isNaN(Date.parse(rec[k]))) bad(`${k} 须为 ISO 时间串`);
  }
  if (!rec.exit || typeof rec.exit !== "object" || Array.isArray(rec.exit)) bad("exit 须为对象");
  if (rec.exit.code !== null && !Number.isInteger(rec.exit.code)) bad("exit.code 须为整数或 null");
  if (rec.exit.signal !== null && typeof rec.exit.signal !== "string") bad("exit.signal 须为字符串或 null");
  if (rec.sessionId !== null && (typeof rec.sessionId !== "string" || !rec.sessionId)) bad("sessionId 须为非空字符串或 null");
  if (rec.engine !== null && (typeof rec.engine !== "string" || !rec.engine)) bad("engine 须为非空字符串或 null");
  // 封存面：stdout+stderr 恒落 raw.txt（超时/非零退出也封存——失败运行照常落档，拍板 7）
  if (!rec.raw || typeof rec.raw !== "object" || Array.isArray(rec.raw)) bad("raw 须为对象");
  if (typeof rec.raw.path !== "string" || !rec.raw.path) bad("raw.path 缺席或空");
  if (!HEX64.test(rec.raw.sha256)) bad("raw.sha256 须为 64 hex");
  if (!Number.isInteger(rec.raw.bytes) || rec.raw.bytes < 0) bad("raw.bytes 须为 ≥0 整数");
  if (rec.transcript !== null) {
    if (typeof rec.transcript !== "object" || Array.isArray(rec.transcript)) bad("transcript 须为对象或 null");
    if (typeof rec.transcript.path !== "string" || !rec.transcript.path) bad("transcript.path 缺席或空");
    if (!HEX64.test(rec.transcript.sha256)) bad("transcript.sha256 须为 64 hex");
  }
  // 计量面（拍板 7：metered ⇒ points 数；absent/unpriced ⇒ points:null + 非空「不算零」注记）
  const m = rec.metering;
  if (!m || typeof m !== "object" || Array.isArray(m)) bad("metering 须为对象");
  if (!METERING_STATUSES.includes(m.status)) bad(`metering.status 不识别：${JSON.stringify(m.status ?? null)}`);
  if (m.note !== null && typeof m.note !== "string") bad("metering.note 须为字符串或 null");
  if (m.status === "metered") {
    if (!Number.isInteger(m.points) || m.points < 0) bad("metered 记录须 points 为 ≥0 整数");
  } else if (m.points !== null) {
    bad(`status=${m.status} 须 points:null（缺用量不算零——ADR-0027 修正节口径）`);
  } else if (typeof m.note !== "string" || !m.note) {
    bad(`status=${m.status} 须非空 note（不算零注记）`);
  }
  // 有效性面（INVALID_REASONS 具名失败分类；valid ⇔ reason:null 自洽）
  const v = rec.validity;
  if (!v || typeof v !== "object" || Array.isArray(v)) bad("validity 须为对象");
  if (!["valid", "invalid"].includes(v.status)) bad(`validity.status 不识别：${JSON.stringify(v.status ?? null)}`);
  if (v.detail !== null && typeof v.detail !== "string") bad("validity.detail 须为字符串或 null");
  if (v.status === "valid") {
    if (v.reason !== null) bad("valid 记录须 reason:null");
    if (rec.result === null) bad("valid 记录须有结构化 result（解析失败属 invalid——拍板 3）");
  } else if (!INVALID_REASONS.includes(v.reason)) {
    bad(`invalid 记录 reason 不识别：${JSON.stringify(v.reason ?? null)}（须具名失败分类）`);
  }
  // 结果面（拍板 3 schema；归一化不变量读侧即验：pass 与 blocking/P0/P1 并存=形状非法——
  // 归一化在写侧强制 blocked 并记 normalization 理由，绕过写侧的手改记录在此挡下）
  if (rec.result !== null) {
    const r = rec.result;
    if (typeof r !== "object" || Array.isArray(r)) bad("result 须为对象或 null");
    if (!VERDICTS.includes(r.verdict)) bad(`result.verdict 不识别：${JSON.stringify(r.verdict ?? null)}`);
    if (!Array.isArray(r.findings)) bad("result.findings 须为数组");
    for (const f of r.findings) {
      if (!f || typeof f !== "object" || Array.isArray(f)) bad("finding 须为对象");
      if (typeof f.id !== "string" || !f.id) bad("finding.id 缺席或空");
      if (typeof f.title !== "string" || !f.title) bad("finding.title 缺席或空");
      if (!SEVERITIES.includes(f.severity)) bad(`finding.severity 不识别：${JSON.stringify(f.severity ?? null)}`);
      if (typeof f.blocking !== "boolean") bad("finding.blocking 须为布尔");
      if (typeof f.location !== "string") bad("finding.location 须为字符串");
      if (typeof f.evidence !== "string" || !f.evidence) bad("finding.evidence 缺席或空");
      if (typeof f.summary !== "string" || !f.summary) bad("finding.summary 缺席或空");
    }
    if (typeof r.summary !== "string") bad("result.summary 须为字符串");
    if (r.normalization !== null && typeof r.normalization !== "string") bad("result.normalization 须为字符串或 null");
    if (r.verdict === "pass" && r.findings.some((f) => f.blocking === true || f.severity === "P0" || f.severity === "P1")) {
      bad("verdict=pass 与 blocking/P0/P1 发现并存（结构自相矛盾——归一化按 blocked 判并记理由，拍板 3）");
    }
  }
}

// ── 家族 IO（queue.js 家法：校验和+版本+形状三层 fail-closed；写前形状校验）──

const FAMILY_GATE = {
  versionKey: "schemaVersion",
  version: REVIEW_VERSION,
  label: "评审运行记录",
  shapeFn: assertRunShape,
};

// 落档唯一入口：seq/runId/schemaVersion 只由本函数分配（调用方自造序号=拒，防撞车覆写）。
// 返回完整记录；写失败即抛（原子写家法，无中间态）。
export function saveReviewRun(cwd, rec) {
  if (!rec || typeof rec !== "object") throw new ReviewError("saveReviewRun 须传记录对象");
  if (rec.seq != null || rec.runId != null || rec.schemaVersion != null) {
    throw new ReviewError("seq/runId/schemaVersion 由 saveReviewRun 分配，调用方不得自带");
  }
  if (typeof rec.slug !== "string" || !rec.slug) throw new ReviewError("saveReviewRun 须 rec.slug");
  if (!Number.isInteger(rec.attempt) || rec.attempt < 1) throw new ReviewError("saveReviewRun 须 rec.attempt ≥1");
  const seq = nextRunSeq(cwd, rec.slug, rec.attempt);
  const full = {
    ...rec,
    seq,
    runId: reviewRunStem(rec.slug, rec.attempt, seq),
    schemaVersion: REVIEW_VERSION,
  };
  const p = reviewRunPath(cwd, rec.slug, rec.attempt, seq);
  saveFamilyFile(p, full, FAMILY_GATE);
  return full;
}

export function loadReviewRun(cwd, slug, attempt, seq) {
  return loadFamilyFile(reviewRunPath(cwd, slug, attempt, seq), FAMILY_GATE);
}

// 按路径读（doctor/list 巡逻面用）：给定文件直接过家族闸，不推导 slug。
export function loadReviewFile(p) {
  return loadFamilyFile(p, FAMILY_GATE);
}

// 在案枚举：fail-closed 整族读——任一档损坏即抛（F1 活体判据：list 碰损坏族非 0）。
// 可按 slug/attempt 过滤；排序=slug/attempt/seq 数值序（文件名字典序 r10<r2 陷阱）。
export function listReviewRuns(cwd, { slug, attempt } = {}) {
  let names;
  try {
    names = readdirSync(reviewDir(cwd)).filter((f) => f.endsWith(".json") && !f.startsWith("."));
  } catch {
    return [];
  }
  names.sort();
  const runs = names.map((f) => loadReviewFile(join(reviewDir(cwd), f)));
  return runs
    .filter((r) => (slug == null || r.slug === slug) && (attempt == null || r.attempt === attempt))
    .sort((a, b) => a.slug.localeCompare(b.slug) || a.attempt - b.attempt || a.seq - b.seq);
}
