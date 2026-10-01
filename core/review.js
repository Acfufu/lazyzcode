// 受控独立评审运行记录家族（0.4.0 M2，ADR-0031；docs/plan-v040-engineering-policy.md §4.1/§4.2）。
// 位阶同 policy/verify：loop/ 外、reset 不清；每次评审运行一档 <slug>.a<attempt>.r<seq>.json +
// 同茎运行目录（input.json/candidate/home/raw.txt，N2/N3 物化）。族容器走 queue.js
// loadFamilyFile/saveFamilyFile 家法（原子写 0600+校验和+版本+形状闸 fail-closed）。
// 记录携带 attempt/dutyTableVersion/templateHash 三字段=统一门代次锚与规则一致性谓词的数据面
//（拍板 6）；dutyTableVersion 不在此钉现行值——旧规则版本的记录须保持可读，一致性由 gate 判。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, cpSync, rmSync, statSync, writeFileSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep, dirname, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawnSync } from "node:child_process";
import { loadFamilyFile, saveFamilyFile, budgetView, appendLedgerEntry, reviewLedgerPoints } from "./queue.js";
import { recordFindingSightings, openBlockingFindings, listFindings, CLOSED_FINDING_STATUSES, findingFingerprint } from "./findings.js"; // 0.4.0 M3：运行落账接线（findings.js 不反向依赖本模块，无环）；M-orch contestedOf 复判读账
import { candidateIdentity, listReceipts } from "./verify.js";
import { loadPolicyRecord, computePolicyIdentity, DUTY_TABLE_VERSION, policyRulesHash, stableStringify } from "./policy.js";
import { withLock, LoopError, readGoal } from "./loop.js"; // N3 #11：写前缀单写者锁（call-time 用，ESM 环安全——loop→gate→review 已有环先例）
import { createGit } from "./git.js";
import { findEngine } from "./paths.js";
import { HEADLESS_DEFAULT_TIMEOUT_MS, spawnHeadless, detectHeadlessAuth } from "./headless.js";
import { effectiveAuthorization, loadContract } from "./contract.js";
import { querySessionPoints } from "./cost.js";

export const REVIEW_VERSION = 1;
export const REVIEW_FAMILY = "review";
export const BASELINE_DUTY_ID = "review.general-correctness";
// M2 职责集=底线一条（§3.1 必选）；M4（ADR-0032 同批）扩三条专项职责并带 scopeMode：
// whole-candidate=不可局部化恒重评（不参与 qualify/reuse）；declarable=可声明依赖范围经
// 资格挑战后复用（拍板 5）。
export const DUTY_TABLE = [
  { id: BASELINE_DUTY_ID, baseline: true, scopeMode: "whole-candidate", template: "core/review-duties/general-correctness.md" },
  { id: "review.external-side-effects", scopeMode: "declarable", template: "core/review-duties/external-side-effects.md" },
  { id: "review.state-recovery", scopeMode: "declarable", template: "core/review-duties/state-recovery.md" },
  { id: "review.verification-deps", scopeMode: "declarable", template: "core/review-duties/verification-deps.md" },
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
// 序号分配（确定序）：计划写「在案档数+1」；以 max+1 实现同一确定序且对人工删除免疫碰撞。
// 计数面=档文件**与同茎运行目录**两者——runner 中途死（SIGKILL）会留无档孤儿目录，只数档会
// 让下次 reserve 撞同序号被孤儿闸卡死，违背「恢复=重跑新 runId」（拍板 8）；孤儿目录跳过留观。
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
    if (!n.startsWith(prefix)) continue;
    const tail = n.slice(prefix.length);
    const m = tail.endsWith(".json") ? tail.slice(0, -".json".length) : tail;
    const k = Number(m);
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
  if (rec.inputPackageHash !== null && !HEX64.test(rec.inputPackageHash)) bad("inputPackageHash 须为 64 hex 或 null");
  // 候选面：candidateIdentity 三字段（verify.js 同源）+ 运行前净树断言结果 + 快照树哈希
  if (!rec.candidate || typeof rec.candidate !== "object" || Array.isArray(rec.candidate)) bad("candidate 须为对象");
  for (const k of ["headSha", "compositeFingerprint"]) {
    if (typeof rec.candidate[k] !== "string" || !rec.candidate[k]) bad(`candidate.${k} 缺席或空`);
  }
  // cliVersion=候选仓 package.json 版本（verify.js 同源）：非 node 仓合法 null
  if (rec.candidate.cliVersion !== null && (typeof rec.candidate.cliVersion !== "string" || !rec.candidate.cliVersion)) {
    bad("candidate.cliVersion 须为非空字符串或 null");
  }
  if (typeof rec.candidate.clean !== "boolean") bad("candidate.clean 须为布尔（运行前净树断言；脏树不 spawn）");
  if (!rec.snapshot || typeof rec.snapshot !== "object" || Array.isArray(rec.snapshot)) bad("snapshot 须为对象");
  if (rec.snapshot.treeHash !== null && !HEX64.test(rec.snapshot.treeHash)) bad("snapshot.treeHash 须为 64 hex 或 null");
  // 执行面
  for (const k of ["startedAt", "endedAt"]) {
    if (typeof rec[k] !== "string" || Number.isNaN(Date.parse(rec[k]))) bad(`${k} 须为 ISO 时间串`);
  }
  if (!rec.exit || typeof rec.exit !== "object" || Array.isArray(rec.exit)) bad("exit 须为对象");
  if (rec.exit.code !== null && !Number.isInteger(rec.exit.code)) bad("exit.code 须为整数或 null");
  if (rec.exit.signal !== null && typeof rec.exit.signal !== "string") bad("exit.signal 须为字符串或 null");
  if (rec.sessionId !== null && (typeof rec.sessionId !== "string" || !rec.sessionId)) bad("sessionId 须为非空字符串或 null");
  if (rec.engine !== null && (typeof rec.engine !== "string" || !rec.engine)) bad("engine 须为非空字符串或 null");
  // 封存面：spawn 过的运行 stdout+stderr 恒落 raw.txt（超时/非零退出也封存——失败运行照常
  // 落档，拍板 7）；未 spawn 的 invalid 运行（leak 等）无输出可封存，raw=null。
  if (rec.raw !== null) {
    if (!rec.raw || typeof rec.raw !== "object" || Array.isArray(rec.raw)) bad("raw 须为对象或 null");
    if (typeof rec.raw.path !== "string" || !rec.raw.path) bad("raw.path 缺席或空");
    if (!HEX64.test(rec.raw.sha256)) bad("raw.sha256 须为 64 hex");
    if (!Number.isInteger(rec.raw.bytes) || rec.raw.bytes < 0) bad("raw.bytes 须为 ≥0 整数");
  }
  if (rec.transcript !== null) {
    if (typeof rec.transcript !== "object" || Array.isArray(rec.transcript)) bad("transcript 须为对象或 null");
    if (typeof rec.transcript.path !== "string" || !rec.transcript.path) bad("transcript.path 缺席或空");
    if (!HEX64.test(rec.transcript.sha256)) bad("transcript.sha256 须为 64 hex");
  }
  // 预算面（拍板 7③；N9 翻执法：points:N 绑定 → enforced=true + capPoints/usedPoints 读数；
  // none/非 points 形=enforced false 只记事实）
  if (rec.budget !== null) {
    if (!rec.budget || typeof rec.budget !== "object" || Array.isArray(rec.budget)) bad("budget 须为对象或 null");
    if (rec.budget.ref !== null && typeof rec.budget.ref !== "string") bad("budget.ref 须为字符串或 null");
    if (typeof rec.budget.note !== "string" || !rec.budget.note) bad("budget.note 缺席或空（如实注记义务）");
    if (typeof rec.budget.enforced !== "boolean") bad("budget.enforced 须为布尔");
    if (rec.budget.enforced === true) {
      if (!Number.isFinite(rec.budget.capPoints) || rec.budget.capPoints < 0) bad("budget.capPoints 须为 ≥0 数（enforced 面）");
      if (!Number.isFinite(rec.budget.usedPoints) || rec.budget.usedPoints < 0) bad("budget.usedPoints 须为 ≥0 数（enforced 面）");
    }
  }
  // 计量面（拍板 7：metered ⇒ points 数；absent/unpriced ⇒ points:null + 非空「不算零」注记）
  const m = rec.metering;
  if (!m || typeof m !== "object" || Array.isArray(m)) bad("metering 须为对象");
  if (!METERING_STATUSES.includes(m.status)) bad(`metering.status 不识别：${JSON.stringify(m.status ?? null)}`);
  if (m.note !== null && typeof m.note !== "string") bad("metering.note 须为字符串或 null");
  if (m.status === "metered") {
    // points=积分折算值（computePoints 小数，非整数——0.00155 级），有限非负数即可
    if (!Number.isFinite(m.points) || m.points < 0) bad("metered 记录须 points 为 ≥0 有限数");
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
    if (rec.sessionId === null) bad("valid 记录须有 sessionId（无会话身份=中断，拍板 3）");
    if (rec.raw === null) bad("valid 记录须封存 raw（gate 放行子句核在场+哈希）");
    if (rec.transcript === null) bad("valid 记录须有转录（缺席=隔离未证，M0 口径）");
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
  // M3 面两字段（N2）：recheck 标记位与落账读数——旧档（M2）缺字段可读（undefined 放行，
  // 旧档可读走漂移判家法）；新档恒写。findingsLedger 由 finishRun 落账接线产出。
  if (rec.recheck !== undefined && rec.recheck !== null) {
    if (typeof rec.recheck !== "object" || Array.isArray(rec.recheck)) bad("recheck 须为对象或 null");
    if (rec.recheck.requested !== true) bad("recheck.requested 须为 true");
    if (rec.recheck.targets !== null && !Array.isArray(rec.recheck.targets)) bad("recheck.targets 须为数组或 null");
    if (Array.isArray(rec.recheck.targets)) {
      for (const t of rec.recheck.targets) if (!HEX64.test(t)) bad("recheck.targets 须为 64 hex 指纹");
    }
    // 异议复判标记（决策 #44，2026-10-01）：contestedOf=被复判发现指纹（64 hex）或 null；
    // 旧档缺键=undefined 放行（requested 同款读侧兼容）。
    if (rec.recheck.contestedOf !== undefined && rec.recheck.contestedOf !== null && !HEX64.test(rec.recheck.contestedOf)) {
      bad("recheck.contestedOf 须为 64 hex 或 null");
    }
  }
  if (rec.findingsLedger !== undefined && rec.findingsLedger !== null) {
    if (typeof rec.findingsLedger !== "object" || Array.isArray(rec.findingsLedger)) bad("findingsLedger 须为对象或 null");
    if (!Number.isInteger(rec.findingsLedger.upserted) || rec.findingsLedger.upserted < 0) bad("findingsLedger.upserted 须为 ≥0 整数");
    if (!Array.isArray(rec.findingsLedger.disposition)) bad("findingsLedger.disposition 须为数组");
    if (rec.findingsLedger.closureCandidates !== null && !Array.isArray(rec.findingsLedger.closureCandidates)) {
      bad("findingsLedger.closureCandidates 须为数组或 null");
    }
  }
  if (rec.containment !== undefined && rec.containment !== null) {
    if (typeof rec.containment !== "object" || Array.isArray(rec.containment)) bad("containment 须为对象或 null");
    if (!Number.isInteger(rec.containment.phantomCount) || rec.containment.phantomCount < 0) bad("containment.phantomCount 须为 ≥0 整数");
    if (!Array.isArray(rec.containment.phantoms)) bad("containment.phantoms 须为数组");
  }
}

// ── 家族 IO（queue.js 家法：校验和+版本+形状三层 fail-closed；写前形状校验）──

const FAMILY_GATE = {
  versionKey: "schemaVersion",
  version: REVIEW_VERSION,
  label: "评审运行记录",
  shapeFn: assertRunShape,
};

// 运行预留（N2 物化面入口）：分配确定序号并建同茎运行目录，返回三件套供 input.json/
// candidate/home/raw 物化与最终落档同茎配对。单写者假设=loop 锁（同一 (slug,attempt) 的
// 评审运行串行）；残留非空同名目录=孤儿（json 已失而目录在）→ fail-closed 拒，人工回收。
export function reserveRun(cwd, slug, attempt) {
  const seq = nextRunSeq(cwd, slug, attempt);
  const runId = reviewRunStem(slug, attempt, seq);
  const runDir = join(reviewDir(cwd), runId);
  if (existsSync(runDir) && readdirSync(runDir).length > 0) {
    throw new ReviewError(`运行目录已存在且非空（孤儿残留，先人工回收）：${runDir}`);
  }
  mkdirSync(runDir, { recursive: true });
  return { seq, runId, runDir };
}

// 落档唯一入口：rec 须携带 reserveRun 分配的 seq/runId/schemaVersion（同茎配对由形状闸
// 自洽等式钉死）；目标档已存在=拒（防覆写幸存档）。写失败即抛（原子写家法，无中间态）。
export function saveReviewRun(cwd, rec) {
  if (!rec || typeof rec !== "object") throw new ReviewError("saveReviewRun 须传记录对象");
  if (typeof rec.slug !== "string" || !rec.slug) throw new ReviewError("saveReviewRun 须 rec.slug");
  if (!Number.isInteger(rec.attempt) || rec.attempt < 1) throw new ReviewError("saveReviewRun 须 rec.attempt ≥1");
  if (!Number.isInteger(rec.seq) || rec.seq < 1) throw new ReviewError("seq 须由 reserveRun 分配（≥1 整数）");
  if (typeof rec.runId !== "string" || rec.runId !== reviewRunStem(rec.slug, rec.attempt, rec.seq)) {
    throw new ReviewError("runId 须与 slug/attempt/seq 自洽（reserveRun 分配）");
  }
  if (rec.schemaVersion !== REVIEW_VERSION) throw new ReviewError(`schemaVersion 须为 ${REVIEW_VERSION}`);
  const p = reviewRunPath(cwd, rec.slug, rec.attempt, rec.seq);
  if (existsSync(p)) throw new ReviewError(`运行档已存在，拒绝覆写：${p}`);
  saveFamilyFile(p, rec, FAMILY_GATE);
  return rec;
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

// ── N2：输入包与隔离（拍板 4：facts-only——不含任何他轮评审结论）──

// 注入上限：AGENTS.md=100KB（引擎自身注入截断同口径，宪法 §3.4）；证据单件 64KB。
// 截断须如实标注（评审依据的完整性边界是评审结论可信度的一部分）。
const AGENTS_CAP = 100 * 1024;
const EVIDENCE_CAP = 64 * 1024;
const RECEIPTS_CAP = 200;
// N4 #10：子账本落库延迟有界重试（M0 实测落库有滞后）——最坏 3 次读、间隔 750ms（≈1.5s 预算）。
const METERING_READ_RETRIES = 2;
const METERING_RETRY_DELAY_MS = 750;

function cappedFromBuffer(buf, cap) {
  if (buf.length <= cap) return { text: buf.toString("utf8"), bytes: buf.length, truncated: false };
  // N3 #13（M2 自审 F-7）：字节精确截断——按 UTF-8 码点边界回退（不落续字节），注记报真实
  // 注入字节数。此前按 UTF-16 码元切片而注记称字节，中文内容实际注入可达标称约 3 倍。
  // （N4 #9 起证据面共用本函数。）
  let end = cap;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
  const text = `${buf.subarray(0, end).toString("utf8")}\n…[输入包截断：原文 ${buf.length} 字节，只注入前 ${end} 字节（UTF-8 码点边界安全）]`;
  return { text, bytes: buf.length, truncated: true, injectedBytes: end };
}

function readCappedText(p, cap) {
  return cappedFromBuffer(readFileSync(p), cap);
}

// facts-only 输入包（拍板 4 唯一定义）：契约文本、项目清单、AGENTS.md 项目规则、目标步骤与
// F 证据文本、回执摘要、策略义务集、候选身份。写 <runDir>/input.json（0600）并算
// inputPackageHash。多 subject 拒已前移至 runReview 前置（N3 #7——在预留前以 preflight 型拒）。
export function buildInputPackage(cwd, goal, runDir, { dutyId = BASELINE_DUTY_ID, now = new Date(), contested = null } = {}) {
  if (!goal || goal.version !== 2) throw new ReviewError(`评审输入包须 v2 目标（得到 version=${goal?.version ?? null}）`);
  const readOptional = (p, cap) => {
    try {
      return readCappedText(p, cap);
    } catch (err) {
      if (err && err.code === "ENOENT") return null;
      throw err;
    }
  };
  let evidence = [];
  let evidenceDirAbsent = false;
  try {
    // N4 #9（M2 自审 F-3）：证据面三修——(a) 不再只收 .txt（非文本附件以引用+披露入包，
    // 内容不注入：隔离面不读宿主路径，评审如需该证据须在报告如实声明）；文本件内容照旧
    // 封顶注入（cappedFromBuffer 字节精确）。
    evidence = readdirSync(join(cwd, ".lazyzcode", "evidence"))
      .filter((f) => f.startsWith(`${goal.slug}.`))
      .sort()
      .map((f) => {
        const p = join(cwd, ".lazyzcode", "evidence", f);
        const buf = readFileSync(p);
        const looksText = !buf.subarray(0, 8192).includes(0) && !buf.toString("utf8").includes("\ufffd");
        if (!looksText) {
          return { file: f, sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length, included: false, note: "非文本附件——以引用入包（sha256/字节数），内容不注入（隔离面不读宿主路径）" };
        }
        const capped = cappedFromBuffer(buf, EVIDENCE_CAP);
        return { file: f, sha256: createHash("sha256").update(capped.text).digest("hex"), ...capped, included: true };
      });
  } catch {
    evidenceDirAbsent = true;
  }
  let receipts = [];
  try {
    receipts = listReceipts(cwd, goal.slug).slice(0, RECEIPTS_CAP).map((r) => ({
      runId: r.runId ?? null,
      kind: r.kind ?? null,
      checkId: r.checkId ?? null,
      startedAt: r.startedAt ?? null,
      contractHash: r.contractHash ?? null,
    }));
  } catch (e) {
    receipts = [{ summaryError: String(e?.message ?? e).slice(0, 120) }];
  }
  let policy = null;
  const rec = loadPolicyRecord(cwd, goal.slug, goal.attempt);
  if (rec) {
    policy = {
      dutyTableVersion: rec.dutyTableVersion,
      rulesHash: rec.rulesHash,
      obligations: rec.obligations.map((o) => ({ id: o.id, baseline: o.baseline === true, satisfaction: o.satisfaction ?? null, dependsOn: o.dependsOn ?? null })),
    };
  } // 记录未落档=null（如实缺项；损坏由 loadFamilyFile 家族闸抛）
  // N4 #9(c)：缺项披露块——输入包如实声明哪些预期源缺席/未注入，评审结论可信度的边界面。
  const agentsRules = readOptional(join(cwd, "AGENTS.md"), AGENTS_CAP);
  const disclosure = [];
  if (evidenceDirAbsent) disclosure.push("证据目录不可读（.lazyzcode/evidence 缺席）——证据面未注入");
  else if (evidence.length === 0) disclosure.push("无在档证据文件——F 项证据对本次评审不可见");
  for (const e of evidence) {
    if (e.included === false) disclosure.push(`非文本附件未注入内容：${e.file}（引用面在场）`);
  }
  if (!agentsRules) disclosure.push("AGENTS.md 缺席——项目规则面未注入");
  // 异议复判输入（决策 #44）：被复判发现摘要+异议书全文注入（复判者须看到它在判什么）；
  // 其余评审结论仍不注入——facts-only 不破（异议书是实现者文书非他轮评审结论）。
  let contestedReview = null;
  if (contested && typeof contested.groundsPath === "string") {
    const grounds = readOptional(resolve(cwd, contested.groundsPath), AGENTS_CAP);
    if (!grounds) disclosure.push(`异议书不可读：${contested.groundsPath}——复判输入缺异议书（如实披露）`);
    contestedReview = { ...contested, groundsIncluded: grounds !== null, ...(grounds ? { grounds } : {}) };
  }
  const facts = {
    duty: { id: dutyId, templateHash: dutyTemplateHash(dutyId) },
    goal: {
      slug: goal.slug,
      title: goal.title ?? null,
      attempt: goal.attempt ?? null,
      tier: goal.tier ?? null,
      risk: goal.risk ?? null,
      status: goal.status ?? null,
      contractHash: goal.contract?.contractHash ?? null,
      baseTreeHash: goal.baseTreeHash ?? null,
    },
    contract: goal.contract?.path
      ? { path: goal.contract.path, ...readCappedText(resolve(cwd, goal.contract.path), AGENTS_CAP) }
      : null,
    projectManifest: readOptional(join(cwd, "lzy.project.json"), AGENTS_CAP),
    agentsRules,
    steps: (goal.steps ?? []).map((s) => ({
      id: s.id,
      kind: s.kind ?? null,
      title: s.title,
      status: s.status,
      note: s.note ?? null,
      doneAt: s.doneAt ?? null,
      evidence: s.evidence ?? null, // N4 #9(b)：步骤证据指针入包（此前映射漏该字段）
      acceptsRefs: s.acceptsRefs ?? [],
    })),
    evidence,
    receipts,
    policy,
    contestedReview,
    disclosure,
    candidate: candidateIdentity(cwd),
    generatedAt: now.toISOString(),
  };
  const json = `${JSON.stringify(facts, null, 2)}\n`;
  const inputPath = join(runDir, "input.json");
  writeFileSync(inputPath, json, { mode: 0o600 });
  return {
    inputPath,
    inputPackageHash: createHash("sha256").update(json).digest("hex"),
    bytes: Buffer.byteLength(json),
  };
}

// 候选快照：git archive HEAD 解到 <runDir>/candidate/（.lazyzcode/artifacts gitignored 天然
// 不在树内），并采快照树哈希（逐文件路径+内容 sha256 有序复合——污染判据的锚，N3 运行后复查）。
// git archive 展开只产普通文件/目录/符号链接；其余类型出现=fail-closed。
export function materializeCandidate(cwd, runDir) {
  const candidateDir = join(runDir, "candidate");
  mkdirSync(candidateDir, { recursive: true });
  const tarPath = join(runDir, ".candidate.tar");
  const fd = openSync(tarPath, "w");
  let proc = spawnSync("git", ["archive", "--format=tar", "HEAD"], { cwd, stdio: ["ignore", fd, "pipe"] });
  closeSync(fd);
  if (proc.status !== 0) {
    rmSync(tarPath, { force: true });
    throw new ReviewError(`候选快照失败（git archive 退出 ${proc.status}）：${String(proc.stderr ?? "").slice(0, 200)}`);
  }
  proc = spawnSync("tar", ["-x", "-f", tarPath, "-C", candidateDir], { stdio: ["ignore", "ignore", "pipe"] });
  rmSync(tarPath, { force: true });
  if (proc.status !== 0) {
    throw new ReviewError(`候选快照失败（tar 解包退出 ${proc.status}）：${String(proc.stderr ?? "").slice(0, 200)}`);
  }
  return { candidateDir, treeHash: hashTree(candidateDir) };
}

function hashTree(root) {
  const h = createHash("sha256");
  const walk = (dir, rel) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of entries) {
      const p = join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        walk(p, r);
      } else if (e.isFile()) {
        h.update(`${r}\0${createHash("sha256").update(readFileSync(p)).digest("hex")}\n`);
      } else if (e.isSymbolicLink()) {
        h.update(`${r}\0symlink:${readlinkSync(p)}\n`);
      } else {
        throw new ReviewError(`快照含非常规项（git archive 不产）：${r}`);
      }
    }
  };
  walk(root, "");
  return h.digest("hex");
}

// 隔离 HOME：每运行独立 <runDir>/home（引擎 rollout 转录与子账本都落这里——计量缝收口面）。
export function prepareIsolation(runDir) {
  const home = join(runDir, "home");
  mkdirSync(home, { recursive: true });
  return { home };
}

// 泄漏断言（拍板 4 机械面）：input 字节不得含同 (slug,attempt) 任一在先运行的 runId／结论
// 摘要哈希／raw 哈希串。命中即 invalid（理由 leak）——facts-only 是独立性的物证面。
export function assertNoLeak(inputText, priorRuns) {
  const hits = [];
  for (const run of priorRuns) {
    const needles = [run.runId];
    if (run.result?.summary) needles.push(createHash("sha256").update(run.result.summary).digest("hex"));
    if (run.raw?.sha256) needles.push(run.raw.sha256);
    for (const needle of needles) {
      if (needle && inputText.includes(needle)) {
        hits.push({ runId: run.runId, kind: needle === run.runId ? "runId" : needle === run.raw?.sha256 ? "raw-hash" : "summary-hash", needle: `${needle.slice(0, 12)}…` });
      }
    }
  }
  return { ok: hits.length === 0, hits };
}

// 读取轨迹断言（拍板 4）：解析引擎转录（jsonl 逐行），键名含 path/file/dir/cwd 的以 / 开头
// 字符串值=读取面候选；realpath 归一（/var→/private/var）后须落在任一允许前缀内（含边界 sep）。
// **不存在路径=幻影尝试不计 breach**（light 探针实锤：模型拼错路径的失败读取也入转录——
// 读失败无数据流动，隔离语义管的是事实流入不管尝试意图；幻影单独计数如实透出）。
// 命中前缀外且路径存在=breach；转录缺席由调用方按 isolation-breach 判（隔离未证——M0 口径）。
export function assertReadsContained(transcriptText, allowedPrefixes) {
  const norm = (p) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  const prefixes = allowedPrefixes.map(norm);
  const contained = (p) => {
    const q = norm(p);
    return prefixes.some((pre) => q === pre || q.startsWith(pre.endsWith(sep) ? pre : `${pre}${sep}`));
  };
  const breaches = [];
  const phantoms = [];
  const visit = (v, key, line) => {
    if (typeof v === "string") {
      // 绝对路径双形态（发布 CI win32 实锤）：unix / 前缀 + windows 盘符前缀——只认 / 前缀
      // 时盘符路径整体逃离读取轨迹面（win 宿主上隔离断言失效）。
      if (key && /path|file|dir|cwd/i.test(key) && (v.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(v))) {
        if (!existsSync(v)) {
          phantoms.push({ path: v.slice(0, 200), line });
        } else if (!contained(v)) {
          breaches.push({ path: v.slice(0, 200), line });
        }
      }
    } else if (Array.isArray(v)) {
      for (const x of v) visit(x, key, line);
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) visit(x, k, line);
    }
  };
  transcriptText.split("\n").forEach((l, i) => {
    if (!l.trim()) return;
    let obj;
    try {
      obj = JSON.parse(l);
    } catch {
      return; // 非法行跳过（转录语义由 M0 观测锚定：引擎自写 model-io jsonl）
    }
    visit(obj, null, i + 1);
  });
  return { ok: breaches.length === 0, breaches, phantoms };
}

// ── N3：运行执行与结构化结果（拍板 3/5/11）──

// 前置不具备型拒绝（拍板 8 退出码 3 的核内形态）：不 spawn、不消耗、不落档，报文带恢复指路。
export class ReviewPreflightError extends Error {
  constructor(message, { reason = "preflight" } = {}) {
    super(message);
    this.name = "ReviewPreflightError";
    this.reason = reason;
  }
}

// 启动前置核对（拍板 7 四查；spawn 前，任一不过=拒且不 spawn、不消耗）：
// ① 引擎认证（隔离 HOME 会话创建门）②契约授权（撤回/无效=拒，报文带撤回短码与恢复指路）
// ③预算视图（budget-ref 非 none 读预算视图如实记占位——M2 不执法；none=只记事实）
// ④计量能力（sqlite3 在场可执行——不过=拒，避免烧掉预注册预算后才落 invalid）。
export function preflightReview(cwd, goal, { deps = {} } = {}) {
  // N4 #8（M2 自审 F-2）：认证腿按隔离 HOME 会话创建门判——评审会话跑在隔离 HOME（宿主
  // 凭据文件不可继承），可用腿唯 provider env（引擎前缀文件经 extraEnv 透传）。宿主 OAuth
  // 在场不再构成「认证 ok」：OAuth-only 机器此前白烧一次会话后才误分类为隔离失败。
  const auth = (deps.detectAuth ?? detectHeadlessAuth)();
  if (!auth?.envAuth) {
    throw new ReviewPreflightError(
      "无 provider env 认证（隔离 HOME 会话创建门：ZCODE_*_PROVIDER_CONFIG_FILE 须在场且非空文件）" +
        "——评审会话跑在隔离 HOME，宿主 OAuth 凭据不进入隔离面；" +
        (auth?.oauth ? "宿主 OAuth 在场但对隔离会话不可用。" : "") +
        "恢复：注入 provider env 后重跑（lzy doctor 看 headless 行）",
      { reason: "no-auth" },
    );
  }
  let budget = null;
  if (goal?.contract?.contractHash) {
    const az = effectiveAuthorization(cwd, goal.slug, goal.contract.contractHash);
    if (!az.authorized) {
      const short = String(goal.contract.contractHash).slice(0, 8);
      const last = az.lastEvent;
      throw new ReviewPreflightError(
        `契约 ${short} 授权${last?.kind === "withdrawal" ? `已撤回（${last.at}）` : "无效（无在案批准）"}——` +
          `恢复：用户重发「批准 ${short}」原话后重跑（批准记录只由真实用户消息经 UPS 钩子写入）`,
        { reason: "unauthorized" },
      );
    }
  }
  if (goal?.contract?.path) {
    let budgetRef = null;
    try {
      budgetRef = loadContract(goal.contract.path, cwd).budgetRef ?? null;
    } catch (e) {
      throw new ReviewPreflightError(`契约文件不可读（${String(e?.message ?? e).slice(0, 120)}）——评审输入包无法组装；恢复：核对 goal 绑定契约路径`, { reason: "contract-unreadable" });
    }
    if (budgetRef && budgetRef !== "none") {
      let view = null;
      try {
        const v = budgetView(cwd);
        view = { wallMs: v?.wallMs ?? null, points: v?.points ?? null, reviewPoints: v?.reviewPoints ?? null };
      } catch {}
      // N9 执法面（决策 #32 近似限制语义）：budget-ref points:N 绑定 → 该 slug 累计评审消耗
      // ≥上限=拒绝下一次启动（在途超额如实记账，运行中不中途杀）；非 points 形=只记不执法。
      const capMatch = /^points:([0-9]+(?:\.[0-9]+)?)$/.exec(String(budgetRef));
      if (capMatch) {
        const capPoints = Number(capMatch[1]);
        const used = reviewLedgerPoints(cwd, goal.slug);
        budget = {
          ref: budgetRef,
          enforced: true,
          capPoints,
          usedPoints: used,
          view,
          note: "budget-ref points 绑定——评审消耗执法面（近似限制：超限拒下一次启动，在途超额如实记账，决策 #32）",
        };
        if (used >= capPoints) {
          throw new ReviewPreflightError(
            `评审预算已耗尽（累计 ${Math.round(used * 100) / 100}/${capPoints} 分，budget-ref ${budgetRef}）——拒绝启动新评审会话。` +
              `恢复：调高契约 budget-ref 并重采纳，或按 ADR-0033 走义务复判`,
            { reason: "budget-exhausted" },
          );
        }
      } else {
        budget = { ref: budgetRef, enforced: false, view, note: "budget-ref 非 points:N 形——预算视图如实记录（不执法）" };
      }
    } else {
      budget = { ref: budgetRef ?? null, enforced: false, view: null, note: "budget-ref=none——只记事实不执法（如实注记）" };
    }
  }
  const probe = (deps.sqliteProbe ?? defaultSqliteProbe)();
  if (!probe?.ok) {
    throw new ReviewPreflightError(
      "计量能力缺席（sqlite3 不可执行）——评审后无法读隔离子账本用量，义务将不可满足；拒绝先行避免烧掉预注册预算（原因 metering-capability）",
      { reason: "metering-capability" },
    );
  }
  return { auth: { oauth: auth.oauth === true, envAuth: auth.envAuth === true }, budget };
}

function defaultSqliteProbe() {
  const r = spawnSync("sqlite3", ["--version"], { shell: false, timeout: 5_000, encoding: "utf8" });
  return r.error || r.status !== 0 ? { ok: false } : { ok: true, version: String(r.stdout ?? "").trim() };
}

function readGoalJson(cwd) {
  try {
    return JSON.parse(readFileSync(join(cwd, ".lazyzcode", "loop", "goal.json"), "utf8"));
  } catch {
    return null;
  }
}

// 失败面 sessionId 自解（spawnHeadless 契约：失败不 surface sessionId，调用方自解 stdout）。
// 引擎 --json 摘要=stdout 尾部单对象：先整段 parse，退化为逐行倒扫。
function extractSessionId(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return null;
  const candidates = [text, ...text.split("\n").reverse()];
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      if (obj && typeof obj === "object" && typeof obj.sessionId === "string" && obj.sessionId) return obj.sessionId;
    } catch {}
  }
  return null;
}

function findTranscript(home, sessionId) {
  const dir = join(home, ".zcode", "cli", "rollout");
  let names;
  try {
    names = readdirSync(dir).filter((f) => f.startsWith("model-io-") && f.endsWith(".jsonl"));
  } catch {
    return null;
  }
  if (sessionId) {
    const hit = names.find((f) => f === `model-io-${sessionId}.jsonl`);
    if (hit) return join(dir, hit);
  }
  return names.length === 1 ? join(dir, names[0]) : null;
}

// 结果围栏解析（拍板 3 唯一定义）：恰一个 ```json 围栏；JSON.parse；duty 回显一致；逐字段
// 类型/枚举闸。返回 { ok, result?, reason? }——reason 供 parse-fail invalid 的 detail。
export function parseReviewResult(responseText, { dutyId } = {}) {
  const text = String(responseText ?? "");
  const fences = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].map((m) => m[1]);
  if (fences.length === 0) return { ok: false, reason: "无 ```json 围栏块（输出契约要求恰一个）" };
  if (fences.length > 1) return { ok: false, reason: `json 围栏块 ${fences.length} 个（要求恰一个）` };
  let obj;
  try {
    obj = JSON.parse(fences[0]);
  } catch (e) {
    return { ok: false, reason: `围栏内非合法 JSON：${String(e?.message ?? e).slice(0, 120)}` };
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { ok: false, reason: "围栏内非对象" };
  if (dutyId && obj.duty !== dutyId) return { ok: false, reason: `duty 回显不符（期望 ${dutyId}，得到 ${JSON.stringify(obj.duty ?? null)}）` };
  if (!VERDICTS.includes(obj.verdict)) return { ok: false, reason: `verdict 不识别：${JSON.stringify(obj.verdict ?? null)}` };
  if (!Array.isArray(obj.findings)) return { ok: false, reason: "findings 须为数组" };
  for (const f of obj.findings) {
    if (!f || typeof f !== "object" || Array.isArray(f)) return { ok: false, reason: "finding 须为对象" };
    for (const k of ["id", "title", "severity", "blocking", "location", "evidence", "summary"]) {
      if (!(k in f)) return { ok: false, reason: `finding 缺字段：${k}` };
    }
    if (typeof f.id !== "string" || !f.id) return { ok: false, reason: "finding.id 须非空字符串" };
    if (typeof f.title !== "string" || !f.title) return { ok: false, reason: "finding.title 须非空字符串" };
    if (!SEVERITIES.includes(f.severity)) return { ok: false, reason: `finding.severity 不识别：${JSON.stringify(f.severity ?? null)}` };
    if (typeof f.blocking !== "boolean") return { ok: false, reason: "finding.blocking 须为布尔" };
    if (typeof f.location !== "string") return { ok: false, reason: "finding.location 须为字符串" };
    if (typeof f.evidence !== "string" || !f.evidence) return { ok: false, reason: "finding.evidence 须非空字符串" };
    if (typeof f.summary !== "string" || !f.summary) return { ok: false, reason: "finding.summary 须非空字符串" };
  }
  if (typeof obj.summary !== "string") return { ok: false, reason: "summary 须为字符串" };
  const ids = new Set();
  for (const f of obj.findings) {
    if (ids.has(f.id)) return { ok: false, reason: `finding.id 重复：${f.id}` };
    ids.add(f.id);
  }
  return { ok: true, result: { verdict: obj.verdict, findings: obj.findings, summary: obj.summary, normalization: null } };
}

// 归一化（拍板 3 fail-closed）：pass 与 blocking/P0/P1 并存 ⇒ 按 blocked 判并记理由。
export function normalizeVerdict(result) {
  if (result.verdict === "pass" && result.findings.some((f) => f.blocking === true || f.severity === "P0" || f.severity === "P1")) {
    return {
      ...result,
      verdict: "blocked",
      normalization: `pass 与 blocking/P0/P1 发现并存——结构自相矛盾按 blocked 判（拍板 3 归一化；原 verdict=pass，${result.findings.filter((f) => f.blocking || f.severity === "P0" || f.severity === "P1").length} 条触发）`,
    };
  }
  return result;
}

function composePrompt(dutyText, inputPath) {
  return [
    dutyText.trim(),
    "",
    "── 本次评审输入（机器注）──",
    `1. 先读输入包（facts-only）：${inputPath}`,
    "2. 评审对象=你的当前工作目录（候选树快照）。",
    "3. 全程只读，不得修改任何文件。",
    "4. 读取范围硬约束：只许读「输入包 + 当前工作目录（候选树快照）+ 你的隔离主目录」——" +
      "宿主工作区的 .git、.lazyzcode 及其余任何绝对路径一律不读（越界即评审无效）。",
    "5. 最终答复的末尾必须是**恰一个** ```json 围栏块：不要输出示例回显、修正版或「严格版补充」的第二围栏；" +
      "围栏内字段以职责文件「输出契约」为准，禁止附加字段；输出前自查一遍再作答。",
  ].join("\n");
}

// 重跑指令（拍板 3 收窄模板路径：更强格式约束 + 恰一次重跑——上一轮解析失败时附本段再spawn）
const RETRY_SUFFIX_REASON = (reason) =>
  `\n\n── 重跑指令（上一轮结构解析失败：${reason}）──\n` +
  "上一轮已作废。最终答复必须包含且仅包含一个 ```json 围栏块；不得回显示例、不得输出修正版或补充版第二围栏；" +
  "字段恰为 duty/verdict/findings/summary（finding 七字段），无附加字段。";

// 评审运行主入口（拍板 11：deps 注入面=spawnHeadless/detectAuth/querySessionPoints/preflight——
// CI 无凭据零真引擎可跑）。返回 { record, exitHint }；前置不具备抛 ReviewPreflightError
//（不 spawn 不落档）；运行后任何失败分类照常落档（失败运行不可改判，F2 判据）。
export async function runReview(cwd, { duty = BASELINE_DUTY_ID, timeoutMs, recheckOf = null, contestedOf = null, deps = {} } = {}) {
  // recheck 标记（N2/V06）：recheckOf=null=常规运行；true=复核在案全部未关闭发现；
  // 指纹数组=定向复核。仅作运行档标记与闭候选对账开关，不改变运行本身（同职责新独立会话）。
  // contestedOf（决策 #44，2026-10-01）：异议复判标记——非 null 时隐含对该指纹的定向复核
  // （recheckOf 缺省时自动收敛为 [contestedOf]），运行档 recheck.contestedOf 落标，输入包
  // 附加 contestedReview 块（发现摘要+异议书全文——复判者须看到它在判什么；其余评审结论
  // 仍不注入，facts-only 不破）。
  if (recheckOf !== null && recheckOf !== true && !(Array.isArray(recheckOf) && recheckOf.every((x) => typeof x === "string" && /^[0-9a-f]{64}$/.test(x)))) {
    throw new ReviewPreflightError("recheckOf 非法：须为 null | true | 64hex 指纹数组", { reason: "duty-unknown" });
  }
  if (contestedOf !== null && !/^[0-9a-f]{64}$/.test(contestedOf)) {
    throw new ReviewPreflightError("contestedOf 非法：须为 null | 64 hex 指纹", { reason: "duty-unknown" });
  }
  if (contestedOf !== null && recheckOf === null) recheckOf = [contestedOf];
  if (!DUTY_TABLE.some((d) => d.id === duty)) {
    throw new ReviewPreflightError(`职责不在表：${duty}（现行职责表：${DUTY_TABLE.map((d) => d.id).join("、")}）`, { reason: "duty-unknown" });
  }
  const goal = readGoalJson(cwd);
  if (!goal || goal.version !== 2) {
    throw new ReviewPreflightError("无 v2 活跃目标（.lazyzcode/loop/goal.json 缺席或 v1）——评审运行针对当前目标", { reason: "no-goal" });
  }
  // N3 #7（M2 自审 F-1）：多 subject 检查前移至前置——此前在 buildInputPackage（序号已预留后）
  // 抛 ReviewError 落 interrupted 档 exit 1，与 CLI 自述「多 subject=exit 3 不落档」不符。
  if (Array.isArray(goal.subjects) && goal.subjects.length > 0) {
    throw new ReviewPreflightError(
      `多 subject 目标的评审候选跨仓，M3 不支持（跨仓输入打包列 M5）：${goal.subjects.join("、")}`,
      { reason: "multi-subject" },
    );
  }
  // 前置四查（拍板 7）：默认真前置；deps.preflight 可注入（CI 无凭据面替换）
  const pre = await (deps.preflight ?? preflightReview)(cwd, goal, { deps });
  const startedAt = new Date();
  // 候选固定（拍板 5）：三字段 + 净树断言——脏树=前置拒（评审候选须提交态，先提交再评审）
  const identity = candidateIdentity(cwd);
  const integ = createGit(cwd).integrity();
  if (integ.state !== "clean") {
    throw new ReviewPreflightError(
      `评审候选须提交态（git ${integ.state}${integ.paths?.length ? `：${integ.paths.slice(0, 3).join("、")}${integ.paths.length > 3 ? "…" : ""}` : integ.detail ? `——${integ.detail}` : ""}）——先提交后重跑`,
      { reason: "candidate-dirty" },
    );
  }
  // 异议复判输入面（决策 #44）：被复判发现摘要+异议书定位入包——锁外前置核读（发现须在账
  // 且 contested 态；抛 preflight 型拒 exit 3 不消耗 reserve），contestedFacts 传入锁内打包。
  let contestedFacts = null;
  if (contestedOf !== null) {
    // 别名闭包读（阻塞发现 55c34e6b，r8 复核）：发现账可能挂旧 slug（relink 改名后）——
    // 精确 loadFindingsFile 会把改名前账本的 contested 判「不在账」=永久无法裁决。
    // listFindings 走 findingsSlugFamily 闭包并集，originSlug 随行。
    const fe = listFindings(cwd, goal.slug, { includeClosed: true }).find(
      (x) => x.fingerprint === contestedOf,
    );
    if (!fe || fe.status !== "contested" || !fe.contest) {
      throw new ReviewPreflightError(
        `contestedOf ${contestedOf.slice(0, 8)} 不是该目标在账 contested 发现（现 ${fe ? fe.status : "不在账"}）——复判针对异议在案态`,
        { reason: "duty-unknown" },
      );
    }
    contestedFacts = {
      fingerprint: contestedOf,
      originSlug: fe.originSlug,
      severity: fe.severity,
      title: fe.title,
      location: fe.location,
      contestAt: fe.contest.at,
      groundsPath: fe.contest.groundsPath,
      groundsSha256: fe.contest.groundsSha256,
      ...(fe.contest.note ? { contestNote: fe.contest.note } : {}),
    };
  }
  const failures = []; // [reason, detail] 按优先序；validity.reason=首因、detail=全列
  let pkgHash = null;
  let snapHash = null;
  let reserve = null; // N3 #11：锁内分配——预留成功前失败（锁忙/孤儿目录拒）无运行可落档
  // 收口自审 r4（a4.r2 P1）作用域上提：spawned/sessionId/result 等被 catch 引用（锁忙判
  // `!spawned`、interrupted 档取值），原声明在 try 块内 ⇒ catch 路径 ReferenceError——
  // 锁忙前置拒（exit 3）与 F-7 落档语义整条不可达。声明上提到函数作用域（catch 可见）。
  let spawned = false;
  let run = null;
  let sessionId = null;
  let rawInfo = null;
  let transcriptInfo = null;
  let result = null;
  try {
    // N3 #11（M2 自审 F-5）写前缀单写者锁：reserve→输入包→候选快照→隔离→泄漏断言整段进
    // withLock——并发 review run 此前可交错序号/输入包（注释称单写者=loop 锁但代码未取）。
    // spawn 本体不进锁（引擎时长超 LOCK_WAIT 预算）；锁忙=LoopError→preflight 型拒（exit 3 不落档）。
    const prepared = await withLock(cwd, () => {
      const rs = reserveRun(cwd, goal.slug, goal.attempt);
      const pkg = buildInputPackage(cwd, goal, rs.runDir, { dutyId: duty, now: startedAt, contested: contestedFacts });
      const snap = materializeCandidate(cwd, rs.runDir);
      const iso = prepareIsolation(rs.runDir);
      const priors = listReviewRuns(cwd, { slug: goal.slug, attempt: goal.attempt }).filter((r) => r.seq < rs.seq);
      const leak = assertNoLeak(readFileSync(pkg.inputPath, "utf8"), priors);
      return { reserve: rs, pkg, snap, iso, priors, leak };
    });
    reserve = prepared.reserve;
    const { pkg, snap, iso, priors, leak } = prepared;
    pkgHash = pkg.inputPackageHash;
    snapHash = snap.treeHash;
    if (!leak.ok) {
      failures.push(["leak", `输入包含在先运行标记：${leak.hits.map((h) => `${h.runId}/${h.kind}`).join("、")}（facts-only 违反，拍板 4）`]);
    }

    const sessionMeta = []; // 逐会话（单次重跑=两会话）：{attempt, sessionId, transcript, rawText}
    if (failures.length === 0) {
      spawned = true;
      const basePrompt = composePrompt(loadDutyTemplate(duty), pkg.inputPath);
      // 会话循环（拍板 3 收窄模板路径：恰一次重跑——首轮 parse-fail 时附更强格式约束重spawn；
      // timeout/非零退出/矛盾体等非解析失败不重跑）。逐会话封存+转录，计量按会话求和。
      let prevReason = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const prompt = attempt === 1 ? basePrompt : `${basePrompt}${RETRY_SUFFIX_REASON(prevReason ?? "解析失败")}`;
        run = await (deps.spawnHeadless ?? spawnHeadless)({
          prompt,
          mode: "plan",
          cwd: snap.candidateDir,
          home: iso.home,
          timeoutMs: timeoutMs ?? HEADLESS_DEFAULT_TIMEOUT_MS,
          deps: typeof deps.run === "function" ? { run: deps.run } : null,
        });
        const sid = run.sessionId ?? extractSessionId(run.stdout);
        let tinfo = null;
        const tp = sid ? findTranscript(iso.home, sid) : null;
        if (tp) {
          const t = readFileSync(tp);
          tinfo = { path: tp.slice(reserve.runDir.length + 1), sha256: createHash("sha256").update(t).digest("hex") };
        }
        sessionMeta.push({ attempt, sessionId: sid, transcript: tinfo, stdout: run.stdout, stderr: run.stderr });
        if (attempt === 1) {
          sessionId = sid; // 记录主 sessionId=首轮（gate basis 可读；重跑会话入 metering 注记）
          transcriptInfo = tinfo;
        } else {
          sessionId = sid ?? sessionId;
          transcriptInfo = tinfo ?? transcriptInfo; // 终轮会话=判决面（转录取终轮）
        }
        if (run.timedOut) {
          failures.push(["timeout", `墙钟预算耗尽（SIGKILL，${Math.round((timeoutMs ?? HEADLESS_DEFAULT_TIMEOUT_MS) / 1000)}s，attempt ${attempt}）`]);
          break;
        }
        if (run.spawnError) {
          failures.push(["interrupted", `引擎进程启动失败：${run.spawnError}`]);
          break;
        }
        if (run.exitCode !== 0) {
          failures.push(["exit-nonzero", `引擎非零退出（exit ${run.exitCode}${run.signal ? ` · signal ${run.signal}` : ""}，attempt ${attempt}）`]);
          break;
        }
        if (!sid) {
          failures.push(["interrupted", "引擎退出 0 但无 sessionId（会话身份缺席）"]);
          break;
        }
        const parsed = parseReviewResult(run.response, { dutyId: duty });
        if (parsed.ok) {
          result = normalizeVerdict(parsed.result);
          break;
        }
        if (attempt === 1) {
          prevReason = parsed.reason; // 单次重跑（收窄模板路径，拍板 3）
          continue;
        }
        failures.push(["parse-fail", `${parsed.reason}（含单次重跑）`]);
      }
      // 封存（拍板 3）：全部会话 stdout+stderr 逐字落 raw.txt（分节标注；sha256/字节数入记录）
      const rawText = sessionMeta
        .map((m) => `── attempt ${m.attempt} stdout ──\n${m.stdout}\n── attempt ${m.attempt} stderr ──\n${m.stderr}`)
        .join("\n");
      const rawPath = join(reserve.runDir, "raw.txt");
      writeFileSync(rawPath, rawText, { mode: 0o600 });
      rawInfo = { path: "raw.txt", sha256: createHash("sha256").update(rawText).digest("hex"), bytes: Buffer.byteLength(rawText) };
    }
    // 隔离证词（拍板 4）：每会话转录缺席=invalid（隔离未证）；读取越界=invalid；
    // 幻影尝试单独计数落运行档 containment（N3 #12——此前 assertReadsContained 返回后被丢弃，
    // 报文措辞「如实透出」强于实现）。
    const containmentPhantoms = [];
    if (spawned) {
      if (sessionMeta.length === 0 || sessionMeta.some((m) => !m.transcript)) {
        failures.push(["isolation-breach", "转录缺席（隔离 HOME 内未找到 model-io 转录——隔离未证，M0 口径）"]);
      } else {
        // 允许前缀（拍板 4）：候选快照/运行目录/隔离 home/**引擎自身前缀**（provider 配置目录+
        // 引擎安装目录+node 可执行目录——引擎自身运行所需读取不构成隔离破口）。
        // 引擎缺席守卫（发布 CI 修复）：dirname("/nonexistent")="/" 会把允许前缀坍缩成文件
        // 系统根 ⇒ 隔离读取轨迹断言整体中和（CI 实锤 /etc/passwd 判内）——引擎缺席即不注入该前缀。
        const eng = findEngine();
        const enginePrefixes = eng ? [dirname(eng)] : [];
        enginePrefixes.push(dirname(process.execPath));
        for (const key of ["ZCODE_BUILTIN_PROVIDER_CONFIG_FILE", "ZCODE_PERSONAL_PROVIDER_CONFIG_FILE"]) {
          if (process.env[key]) enginePrefixes.push(dirname(process.env[key]));
        }
        for (const m of sessionMeta) {
          const contained = assertReadsContained(readFileSync(join(reserve.runDir, m.transcript.path), "utf8"), [
            snap.candidateDir,
            reserve.runDir,
            iso.home,
            ...enginePrefixes,
          ]);
          containmentPhantoms.push(...contained.phantoms);
          if (!contained.ok) {
            failures.push(["isolation-breach", `读取轨迹越界（attempt ${m.attempt}）：${contained.breaches.slice(0, 3).map((b) => b.path).join("、")}`]);
          }
        }
      }
    }
    // 运行后候选复查（拍板 5：四者=三字段+净树）与快照污染（拍板 4：快照树哈希变化）
    if (spawned) {
      const after = candidateIdentity(cwd);
      const afterInteg = createGit(cwd).integrity();
      if (after.headSha !== identity.headSha || after.compositeFingerprint !== identity.compositeFingerprint || after.cliVersion !== identity.cliVersion || afterInteg.state !== "clean") {
        failures.push(["candidate-moved", `运行后候选身份变化（head ${String(identity.headSha).slice(0, 8)}→${String(after.headSha).slice(0, 8)} · 净树 ${integ.state}→${afterInteg.state}）`]);
      }
      const nowTree = hashTree(snap.candidateDir);
      if (nowTree !== snap.treeHash) {
        failures.push(["contamination", "快照树哈希变化（运行期间候选快照被改动）"]);
      }
    }
    // 计量（拍板 7）：读数唯一走 querySessionPoints（默认=真读数，恒传隔离 HOME 子账本路径；
    // deps 注入供 CI）。N4 #10（M2 自审 F-4）三修：distinct sessionId 去重（引擎复用 sid 不双计）、
    // 缺席会话「不算零」逐条入读数（不再静默 continue）、子账本落库延迟有界重试并记尝试数
    //（M0 实测落库有滞后——末轮行未落库即被压低点数）；注记改逐会话分解（去「两会话合计」断言）。
    let metering;
    if (!spawned) {
      metering = { status: "absent", points: null, note: "未 spawn——无计量可读（未消耗；不算零口径不适用）" };
    } else {
      const reads = [];
      const seenSids = new Set();
      for (const m of sessionMeta) {
        if (!m.sessionId) {
          reads.push({ sessionId: null, r: null, err: null, attempts: 0, detail: "会话身份缺席" });
          continue;
        }
        if (seenSids.has(m.sessionId)) continue;
        seenSids.add(m.sessionId);
        let last = null;
        let lastErr = null;
        let attempts = 0;
        for (let i = 0; i <= METERING_READ_RETRIES; i += 1) {
          attempts = i + 1;
          try {
            last = await (deps.querySessionPoints ?? querySessionPoints)(m.sessionId, {
              dbPath: join(iso.home, ".zcode", "cli", "db", "db.sqlite"),
            });
            lastErr = null;
          } catch (e) {
            lastErr = String(e?.message ?? e).slice(0, 80);
          }
          if (last && last.absent === false) break;
          if (i < METERING_READ_RETRIES) await new Promise((res) => setTimeout(res, METERING_RETRY_DELAY_MS));
        }
        reads.push({ sessionId: m.sessionId, r: last, err: lastErr, attempts });
      }
      const withRows = reads.filter((x) => x.r && x.r.absent === false);
      const totalPoints = withRows.reduce((acc, x) => acc + (Number(x.r.points) || 0), 0);
      const anyUnpriced = withRows.some((x) => x.r.points === 0 && Array.isArray(x.r.unpriced) && x.r.unpriced.length > 0);
      const allAbsent = reads.length > 0 && withRows.length === 0;
      const breakdown = reads
        .map((x) => {
          const label = x.sessionId ?? "无会话身份";
          const val = x.err ? `读数失败(${x.err})` : x.r && x.r.absent === false ? `${Number(x.r.points) || 0} 分` : "缺席（不算零）";
          return `${label}=${val}${x.attempts > 1 ? `（读 ${x.attempts} 次）` : ""}`;
        })
        .join("、");
      if (reads.some((x) => x.err && !(x.r && x.r.absent === false))) {
        metering = { status: "absent", points: null, note: `计量读数失败（逐会话：${breakdown}）——缺用量不算零（ADR-0027 修正节）` };
      } else if (allAbsent) {
        metering = { status: "absent", points: null, note: `逐会话读数：${breakdown}——缺用量不算零（ADR-0027 修正节）` };
      } else if (totalPoints === 0 && anyUnpriced) {
        metering = {
          status: "unpriced",
          points: null,
          note: `模型未计价（表外行；逐会话：${breakdown}）——unpriced 不算零（ADR-0027 修正节）；扩价：lzy loop cost 看未计价行，价表 core/cost.js MODEL_ALIASES（N4 #5）`,
        };
      } else {
        const hasUnpriced = reads.some((x) => x.r && Array.isArray(x.r.unpriced) && x.r.unpriced.length > 0);
        metering = {
          status: "metered",
          points: totalPoints,
          note: `逐会话（distinct sessionId 去重）：${breakdown}${hasUnpriced ? "；表外模型行计 0——读数为下界（计价子集口径）" : ""}`,
        };
      }
    }
    // 计量三分类耦合（拍板 7）：absent/unpriced ⇒ invalid（义务不可满足），运行照常落档
    if (spawned && metering.status === "absent") {
      failures.push(["metering-absent", "子账本无用量行——义务不可满足（§8.1），但运行照常落档"]);
    } else if (spawned && metering.status === "unpriced") {
      failures.push(["unpriced-model", "模型未计价——义务不可满足（§8.1），但运行照常落档"]);
    }
    // 无 spawn 但 flag 面已按 leak 落 failures；spawn 面各分类已落——validity 取首因
    const validity = failures.length === 0 ? { status: "valid", reason: null, detail: null } : { status: "invalid", reason: failures[0][0], detail: failures.map(([r, d]) => `${r}: ${d}`).join("；") };
    const record = {
      slug: goal.slug,
      attempt: goal.attempt,
      seq: reserve.seq,
      runId: reserve.runId,
      schemaVersion: REVIEW_VERSION,
      duty: { id: duty },
      dutyTableVersion: null, // finishRun 回填（现行策略记录优先，回退现行职责表版本）
      templateHash: dutyTemplateHash(duty),
      inputPackageHash: pkg.inputPackageHash,
      candidate: { ...identity, clean: true },
      snapshot: { treeHash: snap.treeHash },
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      exit: { code: spawned ? run.exitCode : null, signal: spawned ? run.signal ?? null : null },
      sessionId: spawned ? sessionId : null,
      engine: spawned ? (findEngine() ?? "unknown") : null,
      raw: rawInfo,
      transcript: transcriptInfo,
      budget: pre?.budget ?? null,
      metering,
      validity,
      result,
      recheck: recheckOf ? { requested: true, targets: Array.isArray(recheckOf) ? recheckOf : null, contestedOf } : null,
      containment: spawned ? { phantomCount: containmentPhantoms.length, phantoms: containmentPhantoms.slice(0, 50) } : null,
    };
    const out = await finishRun(cwd, reserve, record);
    // N9：评审消耗入账（LEDGER review 类）——契约绑定才写（authorization 形状须 64hex
    // contractHash；无契约 goal 保持运行档 durable 面）；metered 才写（absent/unpriced
    // 不算零口径由运行档计量面承载）；dedup=runId（天然唯一，重放幂等）。
    // F-7（M4 N6）：入账=load-modify-save，纳入写前缀短临界（与 prepare 锁时序分离不嵌套）。
    if (goal.contract?.contractHash && out.record.metering?.status === "metered") {
      await withLock(cwd, () =>
        appendLedgerEntry(cwd, {
          kind: "review",
          dedupKey: `review:${out.record.runId}`,
          authorization: { slug: out.record.slug, contractHash: goal.contract.contractHash },
          points: out.record.metering.points ?? 0,
          sessionId: out.record.sessionId ?? null,
          provenance: { runId: out.record.runId, duty: out.record.duty.id, source: "review-runner" },
          note: `评审运行计量入账（budget ${out.record.budget?.ref ?? "none"}）`,
        }),
      );
    }
    return out;
  } catch (err) {
    if (err instanceof ReviewPreflightError) throw err; // 前置型拒绝不落档（N3 #11 锁忙走此通道）
    if (err instanceof LoopError && !spawned) {
      // N3 #11：锁忙（等待超时）→ preflight 型拒——不 spawn 不消耗不落档，exit 3 面。
      // F-7（M4 N6）：spawn 后（落账相位）的锁忙不再误标前置拒——运行已消耗，走下方
      // interrupted 落档路径（重试仍忙则如实抛原错，孤儿目录由 nextRunSeq 计数兜底）。
      throw new ReviewPreflightError(`评审运行写前缀锁忙（并发评审或循环操作持锁）：${String(err?.message ?? err).slice(0, 140)}`, { reason: "review-busy" });
    }
    if (!reserve) throw err; // 预留前失败（获锁失败/孤儿目录拒）——无运行可落档，原样上抛
    // 意外异常（fs/编程错）：运行已预留——落 interrupted 档（不静默丢运行），再上抛供 CLI 报错。
    // input/snapshot 两字段可 null=如实「未达该阶段」（形状闸允许 null；零串占位是谎报）。
    const record = {
      slug: goal.slug,
      attempt: goal.attempt,
      seq: reserve.seq,
      runId: reserve.runId,
      schemaVersion: REVIEW_VERSION,
      duty: { id: duty },
      dutyTableVersion: null,
      templateHash: dutyTemplateHash(duty),
      inputPackageHash: typeof pkgHash === "string" ? pkgHash : null,
      candidate: { ...identity, clean: true },
      snapshot: { treeHash: typeof snapHash === "string" ? snapHash : null },
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      exit: { code: null, signal: null },
      sessionId: null,
      engine: null,
      raw: null,
      transcript: null,
      budget: null,
      metering: { status: "absent", points: null, note: "运行器异常——无计量可读（不算零）" },
      validity: { status: "invalid", reason: "interrupted", detail: `运行器异常：${String(err?.message ?? err).slice(0, 200)}` },
      result: null,
      recheck: recheckOf ? { requested: true, targets: Array.isArray(recheckOf) ? recheckOf : null, contestedOf } : null,
      containment: null,
    };
    try {
      return { ...(await finishRun(cwd, reserve, record)), thrown: err };
    } catch {
      throw err; // 落档也失败（如磁盘满）——原异常上抛
    }
  }
}

// 记录组装收尾：dutyTableVersion 从现行策略记录取（记录缺/不可读=回退现行职责表版本——
// runner 恒在现行规则下运行，不冒充他版）；随后落账接线（N2/V06）。
// F-7（M4 N6）：落账段（发现 upsert+运行档写入）原在 prepare 写前缀锁外——并发下可丢更新；
// 此处与入账段同样取写前缀锁短临界（prepare 锁已释放，时序分离**不嵌套**——loop.js 锁家法）。
async function finishRun(cwd, reserve, record) {
  let v = null;
  try {
    const rec = loadPolicyRecord(cwd, record.slug, record.attempt);
    if (rec && Number.isInteger(rec.dutyTableVersion)) v = rec.dutyTableVersion;
  } catch {}
  record.dutyTableVersion = v ?? DUTY_TABLE_VERSION;
  const saved = await withLock(cwd, () => {
    record.findingsLedger = wireFindingsLedger(cwd, record);
    return saveReviewRun(cwd, record);
  });
  return { record: saved, exitHint: saved.validity.status === "valid" && saved.result?.verdict === "pass" ? 0 : 1 };
}

// 落账接线（N2，V06/V12）：valid 运行的 blocking 发现 upsert 进发现账本（invalid 运行的发现
// 不入账——不可信面，不充当阻塞依据）；recheck 运行另产闭候选读数=upsert 前未关闭开集快照中
// 本 run 不再报的指纹（对账面，close 的 recheck 引用校验由 cli 层做）。disposition 里 invalid-fix
// 翻面（含 diagnosis-required）由账本状态机自判——这里只透传读数入运行档。
function wireFindingsLedger(cwd, record) {
  const isRecheck = record.recheck?.requested === true;
  if (record.validity?.status !== "valid" || !record.result || !Array.isArray(record.result.findings)) {
    return {
      upserted: 0,
      disposition: [],
      closureCandidates: isRecheck ? [] : null,
      ...(record.validity?.status !== "valid" ? { note: "invalid 运行发现不入账（不可信面）" } : {}),
    };
  }
  const fpOf = (f) => findingFingerprint({ severity: f.severity, title: f.title, location: f.location });
  const openBefore = isRecheck ? openBlockingFindings(cwd, record.slug).map((x) => x.fingerprint) : null;
  // 入账口径与统一门判 blocking 同源（自审 F-5 收口）：blocking===true 或 P0/P1（分级即阻塞）。
  const blocking = record.result.findings.filter((f) => f && (f.blocking === true || f.severity === "P0" || f.severity === "P1"));
  let disposition = [];
  if (record.result.verdict === "blocked" && blocking.length > 0) {
    disposition = recordFindingSightings(cwd, record.slug, {
      runId: record.runId,
      attempt: record.attempt,
      at: record.endedAt,
      dutyId: record.duty?.id ?? null, // M4 拍板 13：来源职责入账（close 同职责复核校验锚）
      findings: blocking.map((f) => ({ severity: f.severity, title: f.title, location: f.location })),
    });
  }
  const blockingNow = new Set(blocking.map(fpOf));
  const closureCandidates = isRecheck ? (openBefore ?? []).filter((fp) => !blockingNow.has(fp)) : null;
  return { upserted: disposition.length, disposition, closureCandidates };
}

// ── 0.4.0 M4 N1：评审范围资格与适用性（ADR-0032；plan-v040 §5；本 goal 拍板 1-4/8）──
// 家族位阶=loop/ 外 reset 不清（loadFamilyFile/saveFamilyFile 家法）；登记 core/loop.js
// ANY_TMP_SCAN_DIRS（tmp 孤儿观测+清扫同表，ADJ-13 单源）。复用/资格记录不是运行档
//（无 sessionId/raw、不 spawn）——独立家族，不混 review 运行族（形状闸冻结全字段）也不
// 混 verify 回执族（职责级适用性判断 ≠ check 级配方回执，ADR-0032 只沿用「追加判断不改写」
// 的机制，不共用证据权威）。

export const SCOPE_FAMILY = "review-scope";
export const SCOPE_VERSION = 1;
export const SCOPE_KINDS = ["qualification", "applicability"];
// 范围声明类别（拍板 2）：in-scope=职责依赖（变化⇒重评）；unrelated=已证无关（变化⇒可保持）；
// dynamic=动态输入（不可界定⇒任何触碰回退）。未匹配任何规则=unknown⇒回退（保守缺省）。
export const SCOPE_CLASSES = ["in-scope", "unrelated", "dynamic"];
// 挑战轴（拍板 3）：五核心轴（§5.2 点名：in-scope/canary-keep/missed-dependency/unknown-new/
// rename-delete）+ 五共享轴（lockfile/check-script/env/contract/duty）。
export const CHALLENGE_AXES = [
  "in-scope",
  "canary-keep",
  "missed-dependency",
  "unknown-new",
  "rename-delete",
  "lockfile",
  "check-script",
  "env",
  "contract",
  "duty",
];
export const CHALLENGE_EXPECTS = ["invalidate", "keep"];
const KIND_TAG = { qualification: "q", applicability: "p" };
const DIFF_ENTRY_TYPES = ["modified", "added", "deleted", "renamed"];

export function reviewScopeDir(cwd) {
  return join(cwd, ".lazyzcode", SCOPE_FAMILY);
}
function scopeRecordPath(cwd, id) {
  return join(reviewScopeDir(cwd), `${id}.json`);
}
export function scopeRecordStem(slug, attempt, kind, seq) {
  return `${slug}.a${attempt}.${KIND_TAG[kind]}${seq}`;
}
// 序号分配（确定序）：与 nextRunSeq 同法——max+1，对人工删除免疫碰撞；只数本 kind 茎。
export function nextScopeSeq(cwd, slug, attempt, kind) {
  const tag = KIND_TAG[kind];
  if (!tag) throw new ReviewError(`scope kind 不识别：${JSON.stringify(kind)}`);
  let names;
  try {
    names = readdirSync(reviewScopeDir(cwd));
  } catch {
    return 1;
  }
  const prefix = `${slug}.a${attempt}.${tag}`;
  let max = 0;
  for (const n of names) {
    if (!n.startsWith(prefix)) continue;
    const tail = n.slice(prefix.length);
    const m = tail.endsWith(".json") ? tail.slice(0, -".json".length) : tail;
    const k = Number(m);
    if (Number.isInteger(k) && k > max) max = k;
  }
  return max + 1;
}

// ── 形状闸：双 kind 单闸分派（机械自洽；策略性判定——资格身份现行、diff 分类完备——归
// gate 复用腿与 reuse 判定面，形状闸不复制政策，同 assertRunShape 纪律）──

function assertScopeCandidate(c, bad, what) {
  if (!c || typeof c !== "object" || Array.isArray(c)) return bad(`${what} 须为对象`);
  for (const k of ["headSha", "compositeFingerprint"]) {
    if (typeof c[k] !== "string" || !c[k]) bad(`${what}.${k} 缺席或空`);
  }
  if (c.cliVersion !== null && (typeof c.cliVersion !== "string" || !c.cliVersion)) {
    bad(`${what}.cliVersion 须为非空字符串或 null（verify.js candidateIdentity 同源）`);
  }
}

function assertScopeRules(rules, bad) {
  if (!Array.isArray(rules) || rules.length === 0) bad("scope.rules 须为非空数组");
  const seen = new Set();
  for (const r of rules) {
    if (!r || typeof r !== "object" || Array.isArray(r)) bad("scope.rules 项须为对象");
    if (typeof r.pattern !== "string" || !r.pattern) bad("scope.rules[].pattern 缺席或空");
    if (r.pattern.startsWith("/") || r.pattern.split("/").includes("..")) bad(`scope.rules[].pattern 须为仓内相对路径且不得穿越：${r.pattern}`);
    if (!SCOPE_CLASSES.includes(r.class)) bad(`scope.rules[].class 不识别：${JSON.stringify(r.class ?? null)}`);
    if (seen.has(r.pattern)) bad(`scope.rules pattern 重复（首匹配语义下歧义）：${r.pattern}`);
    seen.add(r.pattern);
  }
}

function assertScopeShape(rec, p) {
  const bad = (m) => {
    throw new ReviewError(`评审范围记录形状非法：${m}：${p}`);
  };
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) bad("记录须为对象");
  if (!SCOPE_KINDS.includes(rec.kind)) bad(`kind 不识别：${JSON.stringify(rec.kind ?? null)}`);
  if (typeof rec.slug !== "string" || !rec.slug) bad("slug 缺席或空");
  if (!Number.isInteger(rec.attempt) || rec.attempt < 1) bad("attempt 须为 ≥1 整数");
  if (!Number.isInteger(rec.seq) || rec.seq < 1) bad("seq 须为 ≥1 整数");
  if (rec.id !== scopeRecordStem(rec.slug, rec.attempt, rec.kind, rec.seq)) bad("id 与 slug/attempt/kind/seq 不自洽");
  if (!rec.dutyId || !DUTY_TABLE.some((d) => d.id === rec.dutyId)) bad(`dutyId 不在职责表：${JSON.stringify(rec.dutyId ?? null)}`);
  // baseRunId 须同代次（同 slug+attempt 的运行茎）——跨代次复用无意义（候选锚不同）。
  const runStem = `${rec.slug}.a${rec.attempt}.r`;
  if (typeof rec.baseRunId !== "string" || !rec.baseRunId.startsWith(runStem)) bad(`baseRunId 须为同代次运行茎（${runStem}<n>）：${JSON.stringify(rec.baseRunId ?? null)}`);
  const baseSeq = Number(rec.baseRunId.slice(runStem.length));
  if (!Number.isInteger(baseSeq) || baseSeq < 1) bad(`baseRunId 尾序非法：${rec.baseRunId}`);
  if (typeof rec.at !== "string" || Number.isNaN(Date.parse(rec.at))) bad("at 须为 ISO 时间串");
  if (rec.note !== null && rec.note !== undefined && typeof rec.note !== "string") bad("note 须为字符串或 null");
  if (rec.schemaVersion !== SCOPE_VERSION) bad(`schemaVersion 须为 ${SCOPE_VERSION}`);

  if (rec.kind === "qualification") {
    if (!rec.scope || typeof rec.scope !== "object" || Array.isArray(rec.scope)) bad("scope 须为对象");
    assertScopeRules(rec.scope.rules, bad);
    if (!Array.isArray(rec.scope.sharedInputs)) bad("scope.sharedInputs 须为数组");
    const seen = new Set();
    for (const s of rec.scope.sharedInputs) {
      if (typeof s !== "string" || !s || s.startsWith("/") || s.split("/").includes("..")) bad(`scope.sharedInputs 项须为仓内相对路径：${JSON.stringify(s ?? null)}`);
      if (seen.has(s)) bad(`scope.sharedInputs 重复：${s}`);
      seen.add(s);
    }
    // scopeHash 复算等式（写侧毒化防护——内容与哈希必须互证）
    const expect = createHash("sha256").update(stableStringify({ dutyId: rec.dutyId, rules: rec.scope.rules, sharedInputs: rec.scope.sharedInputs })).digest("hex");
    if (rec.scopeHash !== expect) bad("scopeHash 与 scope 内容不符（复算失败）");
    // 结构身份快照（资格时点的规则/模板/契约/清单/引擎五轴）
    if (!rec.identity || typeof rec.identity !== "object" || Array.isArray(rec.identity)) bad("identity 须为对象");
    if (!HEX64.test(rec.identity.rulesHash ?? "")) bad("identity.rulesHash 须为 64 hex");
    if (!Number.isInteger(rec.identity.dutyTableVersion) || rec.identity.dutyTableVersion < 1) bad("identity.dutyTableVersion 须为 ≥1 整数");
    if (!HEX64.test(rec.identity.templateHash ?? "")) bad("identity.templateHash 须为 64 hex");
    if (rec.identity.contractHash !== null && !HEX64.test(rec.identity.contractHash)) bad("identity.contractHash 须为 64 hex 或 null");
    if (rec.identity.manifestHash !== null && !HEX64.test(rec.identity.manifestHash)) bad("identity.manifestHash 须为 64 hex 或 null");
    if (rec.identity.engine !== null && (typeof rec.identity.engine !== "string" || !rec.identity.engine)) bad("identity.engine 须为非空字符串或 null");
    if (rec.identity.env !== undefined && rec.identity.env !== null && !HEX64.test(rec.identity.env)) bad("identity.env 须为 64 hex 或 null（M4 环境轴；旧档缺键=读侧兼容）");
    if (!rec.suite || typeof rec.suite !== "object" || Array.isArray(rec.suite)) bad("suite 须为对象");
    if (typeof rec.suite.file !== "string" || !rec.suite.file) bad("suite.file 缺席或空");
    if (!HEX64.test(rec.suite.suiteHash ?? "")) bad("suite.suiteHash 须为 64 hex");
    if (!Number.isInteger(rec.suite.procedureVersion) || rec.suite.procedureVersion < 1) bad("suite.procedureVersion 须为 ≥1 整数");
    if (typeof rec.granted !== "boolean") bad("granted 须为布尔");
    if (!Array.isArray(rec.challenges)) bad("challenges 须为数组");
    if (rec.challenges.length === 0) bad("challenges 须为非空数组（无挑战不构成资格）");
    for (const c of rec.challenges) {
      if (!c || typeof c !== "object" || Array.isArray(c)) bad("challenges 项须为对象");
      if (typeof c.id !== "string" || !c.id) bad("challenges[].id 缺席或空");
      if (!CHALLENGE_AXES.includes(c.axis)) bad(`challenges[].axis 不识别：${JSON.stringify(c.axis ?? null)}`);
      if (!CHALLENGE_EXPECTS.includes(c.expect)) bad(`challenges[].expect 不识别：${JSON.stringify(c.expect ?? null)}`);
      if (typeof c.ok !== "boolean") bad("challenges[].ok 须为布尔");
      if (c.observed !== undefined && typeof c.observed !== "string") bad("challenges[].observed 须为字符串（判定说明）");
      if (c.drift !== undefined) {
        if (!c.drift || typeof c.drift !== "object" || Array.isArray(c.drift)) bad("challenges[].drift 须为对象（结构轴漂移证据，M5 N1）");
        if (!("base" in c.drift) || !("drifted" in c.drift)) bad("challenges[].drift 须带 base/drifted");
      }
    }
    // granted 与逐挑战结果互证（机械自洽）
    if (rec.granted && !rec.challenges.every((c) => c.ok)) bad("granted=true 但存在未通过的挑战");
    if (!rec.granted && rec.challenges.every((c) => c.ok)) bad("granted=false 但全部挑战通过（拒绝须点名失败挑战）");
  } else {
    // applicability
    const qStem = `${rec.slug}.a${rec.attempt}.q`;
    if (typeof rec.qualificationId !== "string" || !rec.qualificationId.startsWith(qStem)) bad(`qualificationId 须为同代次资格茎（${qStem}<n>）：${JSON.stringify(rec.qualificationId ?? null)}`);
    const qSeq = Number(rec.qualificationId.slice(qStem.length));
    if (!Number.isInteger(qSeq) || qSeq < 1) bad(`qualificationId 尾序非法：${rec.qualificationId}`);
    assertScopeCandidate(rec.target, bad, "target");
    if (rec.verdict !== "applicable" && rec.verdict !== "fallback") bad(`verdict 不识别：${JSON.stringify(rec.verdict ?? null)}`);
    if (!Array.isArray(rec.reasons)) bad("reasons 须为字符串数组");
    for (const r of rec.reasons) if (typeof r !== "string" || !r) bad("reasons 项须为非空字符串");
    if (rec.verdict === "fallback" && rec.reasons.length === 0) bad("fallback 须带逐因 reasons（不可解释的拒绝不是拒绝）");
    if (!rec.diff || typeof rec.diff !== "object" || Array.isArray(rec.diff)) bad("diff 须为对象");
    if (rec.diff.baseTreeHash !== null && !HEX64.test(rec.diff.baseTreeHash)) bad("diff.baseTreeHash 须为 64 hex 或 null");
    if (rec.diff.targetTreeHash !== null && !HEX64.test(rec.diff.targetTreeHash)) bad("diff.targetTreeHash 须为 64 hex 或 null");
    if (!Array.isArray(rec.diff.entries)) bad("diff.entries 须为数组");
    for (const e of rec.diff.entries) {
      if (!e || typeof e !== "object" || Array.isArray(e)) bad("diff.entries 项须为对象");
      if (!DIFF_ENTRY_TYPES.includes(e.type)) bad(`diff.entries[].type 不识别：${JSON.stringify(e.type ?? null)}`);
      if (typeof e.path !== "string" || !e.path) bad("diff.entries[].path 缺席或空");
      if (e.type === "renamed" && (typeof e.from !== "string" || !e.from)) bad("renamed 项须带 from");
    }
  }
}

const SCOPE_GATE = {
  versionKey: "schemaVersion",
  version: SCOPE_VERSION,
  label: "评审范围记录",
  shapeFn: assertScopeShape,
};

// 落档唯一入口：目标档已存在=拒（追加判断不改写——资格与适用性都是一次性事实）。
export function saveScopeRecord(cwd, rec) {
  if (!rec || typeof rec !== "object") throw new ReviewError("saveScopeRecord 须传记录对象");
  if (rec.schemaVersion !== SCOPE_VERSION) throw new ReviewError(`schemaVersion 须为 ${SCOPE_VERSION}`);
  if (!SCOPE_KINDS.includes(rec.kind)) throw new ReviewError(`kind 不识别：${JSON.stringify(rec.kind ?? null)}`);
  if (rec.id !== scopeRecordStem(rec.slug, rec.attempt, rec.kind, rec.seq)) {
    throw new ReviewError("id 须与 slug/attempt/kind/seq 自洽（nextScopeSeq 分配）");
  }
  const p = scopeRecordPath(cwd, rec.id);
  if (existsSync(p)) throw new ReviewError(`范围记录已存在，拒绝覆写：${p}`);
  saveFamilyFile(p, rec, SCOPE_GATE);
  return rec;
}

export function loadScopeFile(p) {
  return loadFamilyFile(p, SCOPE_GATE);
}

export function loadScopeRecord(cwd, id) {
  return loadScopeFile(scopeRecordPath(cwd, id));
}

// 在案枚举：fail-closed 整族读（任一档损坏即抛，listReviewRuns 同口径）；可按 slug/attempt/kind 过滤。
export function listScopeRecords(cwd, { slug, attempt, kind } = {}) {
  let names;
  try {
    names = readdirSync(reviewScopeDir(cwd)).filter((f) => f.endsWith(".json") && !f.startsWith("."));
  } catch {
    return [];
  }
  names.sort();
  const recs = names.map((f) => loadScopeFile(join(reviewScopeDir(cwd), f)));
  return recs
    .filter((r) => (slug == null || r.slug === slug) && (attempt == null || r.attempt === attempt) && (kind == null || r.kind === kind))
    .sort((a, b) => a.slug.localeCompare(b.slug) || a.attempt - b.attempt || a.seq - b.seq || a.kind.localeCompare(b.kind)); // seq 数值序（字典序 q10<q2 陷阱）
}

// ── 范围声明验形（拍板 2）：qualify 时输入工件，内容 sha256=scopeHash 入资格档 ──
// 运行档形状零改动；声明不落独立档——内容由资格档全量携带（scopeHash 互证）。

export function validateScopeDeclaration(decl) {
  const bad = (m) => {
    throw new ReviewError(`范围声明非法：${m}`);
  };
  if (!decl || typeof decl !== "object" || Array.isArray(decl)) bad("声明须为对象");
  if (!decl.dutyId || !DUTY_TABLE.some((d) => d.id === decl.dutyId)) bad(`dutyId 不在职责表：${JSON.stringify(decl.dutyId ?? null)}`);
  assertScopeRules(decl.rules, bad);
  if (!Array.isArray(decl.sharedInputs)) bad("sharedInputs 须为数组");
  const seen = new Set();
  for (const s of decl.sharedInputs) {
    if (typeof s !== "string" || !s || s.startsWith("/") || s.split("/").includes("..")) bad(`sharedInputs 项须为仓内相对路径：${JSON.stringify(s ?? null)}`);
    if (seen.has(s)) bad(`sharedInputs 重复：${s}`);
    seen.add(s);
  }
  const normalized = { dutyId: decl.dutyId, rules: decl.rules, sharedInputs: decl.sharedInputs };
  return { ...normalized, scopeHash: createHash("sha256").update(stableStringify(normalized)).digest("hex") };
}

// ── 迷你 glob（拍板 4 逐路径首匹配的实现底座）：** 跨段、* 单段内、? 单字符，其余字面量。
// 确定性零依赖；声明 pattern 先经验形（相对路径、无穿越），此处只做编译。──

function globToRegExp(pattern) {
  let re = "^";
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "*" && pattern[i + 1] === "*") {
      if (pattern[i + 2] === "/") {
        re += "(?:.*/)?"; // `**/` 匹配零个或多个前导目录（根下文件如 package.json 必须可命中）
        i += 3;
      } else {
        re += ".*";
        i += 2;
      }
    } else if (pattern[i] === "*") {
      re += "[^/]*";
      i++;
    } else if (pattern[i] === "?") {
      re += "[^/]";
      i++;
    } else {
      re += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  return new RegExp(`${re}$`);
}

// 首条命中规则（拍板 4：声明规则的匹配语义=数组序首匹配——歧义由验形拒重复 pattern 消解）。
export function matchScopeRule(path, rules) {
  for (const r of rules) {
    if (globToRegExp(r.pattern).test(path)) return r;
  }
  return null;
}

// 逐路径判定与归因（拍板 4）：sharedInput 与声明内/动态判 invalidate、显式 unrelated 判 keep、
// 未匹配判 unknown。分类器与资格挑战选路共用此单一事实源（防「选路判定」与「复用判定」两套口径漂移）。
export function classifyScopePath(path, declaration) {
  if (declaration.sharedInputs.includes(path)) return { path, matched: "shared-input", decision: "invalidate" };
  const rule = matchScopeRule(path, declaration.rules);
  if (!rule) return { path, matched: "unmatched", decision: "unknown" };
  return { path, matched: rule.class, decision: rule.class === "unrelated" ? "keep" : "invalidate", pattern: rule.pattern };
}

// ── 文件级快照与差异（分类器的数据面）：内容 sha256 复合 map——与 hashTree 同口径但产出
// 逐文件 map（hashTree 只产聚合，不动既有值；快照树哈希的既有记录保持可读可比）。

export function buildFileMap(root) {
  const map = {};
  const walk = (dir, rel) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of entries) {
      const p = join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        walk(p, r);
      } else if (e.isFile()) {
        map[r] = createHash("sha256").update(readFileSync(p)).digest("hex");
      } else if (e.isSymbolicLink()) {
        map[r] = `symlink:${readlinkSync(p)}`;
      } else {
        throw new ReviewError(`快照含非常规项（git archive 不产）：${r}`);
      }
    }
  };
  walk(root, "");
  return map;
}

// 差异四类（确定性）：modified/added/deleted/renamed；重命名=删除项与新增项内容哈希相同的
// 贪心配对（两侧各按路径字典序）。renamed 项规范形 {path: 新路径, type:"renamed", from: 旧路径}。
export function diffFileMaps(baseMap, curMap) {
  const modified = [];
  const added = [];
  const deleted = [];
  const renamed = [];
  for (const [p, h] of Object.entries(curMap)) {
    if (!(p in baseMap)) added.push({ path: p, type: "added" });
    else if (baseMap[p] !== h) modified.push({ path: p, type: "modified" });
  }
  for (const [p, h] of Object.entries(baseMap)) {
    if (!(p in curMap)) deleted.push({ path: p, type: "deleted", hash: h });
  }
  const addedByHash = new Map();
  for (const a of added) {
    const h = curMap[a.path];
    if (!addedByHash.has(h)) addedByHash.set(h, []);
    addedByHash.get(h).push(a);
  }
  for (const d of deleted) {
    const candidates = addedByHash.get(d.hash);
    if (candidates && candidates.length > 0) {
      const a = candidates.shift();
      renamed.push({ path: a.path, type: "renamed", from: d.path });
      added.splice(added.indexOf(a), 1);
    }
  }
  const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  modified.sort(byPath);
  added.sort(byPath);
  deleted.sort(byPath);
  renamed.sort(byPath);
  return { modified, added, deleted, renamed };
}

// 逐路径分类（拍板 4）：sharedInputs 精确匹配⇒invalidate；声明规则首匹配——in-scope/dynamic⇒
// invalidate、unrelated⇒keep；未匹配⇒unknown（复用时回退）。renamed 双端各判，任一端非 keep
// 即整项降级（invalidate 优先于 unknown）。
export function classifyDiffEntries(entries, declaration) {
  const out = [];
  for (const e of entries) {
    const paths = e.type === "renamed" ? [e.from, e.path] : [e.path];
    const classify = paths.map((p) => classifyScopePath(p, declaration));
    const decision = classify.some((x) => x.decision === "invalidate")
      ? "invalidate"
      : classify.some((x) => x.decision === "unknown")
        ? "unknown"
        : "keep";
    out.push({ ...e, classify, decision });
  }
  return out;
}

// 聚合裁决（拍板 4/7）：结构轴漂移（调用方传入逐因）∨ 任一 invalidate/unknown ⇒ fallback；
// 全 keep 且零结构因 ⇒ applicable。
export function scopeReuseVerdict(classified, structuralReasons = []) {
  const reasons = [...structuralReasons];
  for (const e of classified) {
    const label = e.type === "renamed" ? `${e.from} → ${e.path}` : e.path;
    if (e.decision === "invalidate") reasons.push(`声明内/共享输入变化：${label}（${e.type}）——职责影响不可排除，须重评`);
    else if (e.decision === "unknown") reasons.push(`未知路径：${label}（${e.type}；不在声明规则内——保守回退，拍板 2）`);
  }
  return { verdict: reasons.length === 0 ? "applicable" : "fallback", reasons };
}

// ── 关闭依据适用性审计（拍板 8，plan §5.5）：closed（fixed|falsified）发现，其 closure
// 引用的复核运行候选与当前候选漂移且变更命中发现定位文件 ⇒ stale（gate findings 子句逐因
// 阻塞的数据面）。fail-closed：复核运行档/候选快照不可读=按 stale 上报（不可判≠放行）。
// 定位匹配=v1 精确文件匹配（location 去掉 :line 尾注）；漂移未触定位文件=关闭依据仍适用。

function locationPathOf(location) {
  return location.replace(/:\d+(-\d+)?$/, "");
}

// git archive HEAD → destDir（materializeCandidate 同款解包面；供当前树文件 map 复用）。
function gitArchiveHead(cwd, destDir) {
  mkdirSync(destDir, { recursive: true });
  let proc = spawnSync("git", ["archive", "--format=tar", "HEAD"], { cwd, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 512 * 1024 * 1024 });
  if (proc.status !== 0) {
    throw new ReviewError(`当前树快照失败（git archive 退出 ${proc.status}）：${String(proc.stderr ?? "").slice(0, 200)}`);
  }
  const tarPath = join(destDir, ".audit.tar");
  writeFileSync(tarPath, proc.stdout, { mode: 0o600 });
  proc = spawnSync("tar", ["-x", "-f", tarPath, "-C", destDir], { stdio: ["ignore", "ignore", "pipe"] });
  rmSync(tarPath, { force: true });
  if (proc.status !== 0) {
    throw new ReviewError(`当前树快照失败（tar 解包退出 ${proc.status}）：${String(proc.stderr ?? "").slice(0, 200)}`);
  }
}

function defaultCurrentFileMap(cwd) {
  const tmp = mkdtempSync(join(tmpdir(), "lzy-scope-audit-"));
  try {
    const curDir = join(tmp, "tree");
    gitArchiveHead(cwd, curDir);
    return buildFileMap(curDir);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function auditClosedFindingsApplicability(cwd, slug, deps = {}) {
  const getCurrentFileMap = deps.getCurrentFileMap ?? defaultCurrentFileMap;
  const closed = listFindings(cwd, slug, { includeClosed: true }).filter((f) => CLOSED_FINDING_STATUSES.includes(f.status));
  const current = candidateIdentity(cwd);
  const stale = [];
  let fresh = 0;
  for (const f of closed) {
    const rid = f.closure?.recheckRunId;
    const base = { fingerprint: f.fingerprint, title: f.title, severity: f.severity, location: f.location, status: f.status, recheckRunId: rid ?? null, closureAt: f.closure?.at ?? null };
    if (!rid) {
      stale.push({ ...base, reason: "closure-basis-unavailable", detail: "closure 缺 recheckRunId（旧账形态）——关闭依据无法随候选核对，fail-closed" });
      continue;
    }
    let run;
    try {
      run = loadReviewFile(join(reviewDir(cwd), `${rid}.json`));
    } catch (e) {
      stale.push({ ...base, reason: "closure-basis-unavailable", detail: `复核运行档不可读：${String(e?.message ?? e).slice(0, 140)}` });
      continue;
    }
    if (!run) {
      stale.push({ ...base, reason: "closure-basis-unavailable", detail: `复核运行档不在案：${rid}——关闭依据无法随候选核对，fail-closed` });
      continue;
    }
    const same = run.candidate?.headSha === current.headSha && run.candidate?.compositeFingerprint === current.compositeFingerprint;
    if (same) {
      fresh++;
      continue;
    }
    const candDir = join(reviewDir(cwd), rid, "candidate");
    let baseMap;
    try {
      baseMap = buildFileMap(candDir);
    } catch (e) {
      stale.push({ ...base, reason: "closure-basis-unavailable", detail: `复核运行候选快照缺席（${candDir}）：${String(e?.message ?? e).slice(0, 100)}` });
      continue;
    }
    let curMap;
    try {
      curMap = getCurrentFileMap(cwd);
    } catch (e) {
      stale.push({ ...base, reason: "closure-basis-unavailable", detail: `当前树快照失败：${String(e?.message ?? e).slice(0, 140)}` });
      continue;
    }
    const diff = diffFileMaps(baseMap, curMap);
    const changed = new Set(
      [...diff.modified, ...diff.added, ...diff.deleted, ...diff.renamed].flatMap((e) => (e.type === "renamed" ? [e.from, e.path] : [e.path])),
    );
    const hit = locationPathOf(f.location);
    if (changed.has(hit)) {
      stale.push({ ...base, reason: "closure-basis-stale", detail: `关闭依据候选已漂移且变更命中定位文件：${hit}` });
    } else {
      fresh++;
    }
  }
  return { stale, fresh, checked: closed.length };
}

// ── 0.4.0 M4 N2：资格挑战执行器（拍板 3：五核心轴+共享轴；oracle 期望对表；granted/拒绝
// 双面落档）。套件随职责模板同目录（<dutyId>.qualify.json，内容哈希入 policyRulesHash——N4
// 翻面同批）；随包套件未落前执行器行为以 deps.suite 注入合成套件验证（契约测试同法）。
// qualify 不 spawn 会话、零积分（拍板 10）——资格是机械对抗验证，不是评审运行。──

// 套件必含五核心轴（§5.2 点名）；共享轴在案即验形（缺省不拒——reuse 时结构性轴恒复判，
// 套件挑战的价值是证明分类管线对它们的失效语义，属补充证据）。
const CORE_CHALLENGE_AXES = ["in-scope", "canary-keep", "missed-dependency", "unknown-new", "rename-delete"];

export function validateChallengeSuite(suite) {
  const bad = (m) => {
    throw new ReviewError(`挑战套件非法：${m}`);
  };
  if (!suite || typeof suite !== "object" || Array.isArray(suite)) bad("套件须为对象");
  if (suite.schemaVersion !== 1) bad(`schemaVersion 须为 1（实得 ${JSON.stringify(suite.schemaVersion ?? null)}）`);
  if (!suite.dutyId || !DUTY_TABLE.some((d) => d.id === suite.dutyId)) bad(`dutyId 不在职责表：${JSON.stringify(suite.dutyId ?? null)}`);
  if (!Number.isInteger(suite.procedureVersion) || suite.procedureVersion < 1) bad("procedureVersion 须为 ≥1 整数");
  if (!Array.isArray(suite.challenges) || suite.challenges.length === 0) bad("challenges 须为非空数组");
  const ids = new Set();
  const axes = new Set();
  for (const c of suite.challenges) {
    if (!c || typeof c !== "object" || Array.isArray(c)) bad("challenges 项须为对象");
    if (typeof c.id !== "string" || !c.id) bad("challenges[].id 缺席或空");
    if (ids.has(c.id)) bad(`挑战 id 重复：${c.id}`);
    ids.add(c.id);
    if (!CHALLENGE_AXES.includes(c.axis)) bad(`axis 不识别：${JSON.stringify(c.axis ?? null)}`);
    if (!CHALLENGE_EXPECTS.includes(c.expect)) bad(`expect 不识别：${JSON.stringify(c.expect ?? null)}`);
    if (c.hint !== undefined && (typeof c.hint !== "string" || !c.hint)) bad("hint 须为非空字符串或缺席");
    if (c.hints !== undefined && (!Array.isArray(c.hints) || c.hints.some((h) => typeof h !== "string" || !h))) bad("hints 须为非空字符串数组或缺席");
    if (c.path !== undefined && (typeof c.path !== "string" || !c.path)) bad("path 须为非空字符串或缺席");
    axes.add(c.axis);
  }
  for (const a of CORE_CHALLENGE_AXES) {
    if (!axes.has(a)) bad(`缺核心轴 ${a}（§5.2 点名：资格须覆盖应失效/可保持/范围外遗漏/未知新增/重命名删除）`);
  }
  return suite;
}

export function challengeSuiteHash(suite) {
  return createHash("sha256").update(stableStringify(suite)).digest("hex");
}

// 随包套件加载（declarable 职责恒有套件；读后缓存——policyRulesHash 高频调用面）。
// 返回 {suite, hash}；whole-candidate 职责返回 null（无套件语义）。
const suiteCache = new Map();
export function loadChallengeSuite(dutyId) {
  const entry = DUTY_TABLE.find((d) => d.id === dutyId);
  if (!entry) throw new ReviewError(`职责不在表：${dutyId}`);
  if (entry.scopeMode !== "declarable") return null;
  if (suiteCache.has(dutyId)) return suiteCache.get(dutyId);
  let suite;
  try {
    suite = JSON.parse(readFileSync(packageRelative(`core/review-duties/${dutyId}.qualify.json`), "utf8"));
  } catch (e) {
    throw new ReviewError(`挑战套件不可读：${dutyId}（${String(e?.message ?? e).slice(0, 120)}）`);
  }
  validateChallengeSuite(suite);
  const out = { suite, hash: challengeSuiteHash(suite) };
  suiteCache.set(dutyId, out);
  return out;
}

export function dutySuiteHash(dutyId) {
  const loaded = loadChallengeSuite(dutyId);
  return loaded ? loaded.hash : null;
}

// 清单哈希取值（资格/复用的结构身份轴）：goal 缺席时以最小合成目标跑身份函数
//（computePolicyIdentity 只读 manifest/contract 面）。实现为 catch-all 归 null（收口自审
// a3.r1 F-5 对齐注释）：解析失败不外抛——双失败=null==null 由 gate policyIdentity 子句的
// manifestInvalid 兜底阻塞；单侧失败=身份漂移 ⇒ 复用判 fallback，保守方向。
function manifestHashOf(cwd, goal) {
  try {
    const id = computePolicyIdentity(cwd, goal ?? { slug: "", attempt: 0, version: 2 });
    return id.manifestPresent ? id.manifestHash : null;
  } catch {
    return null;
  }
}

// 环境指纹（结构轴 env）：平台/架构/Node/TZ 复合哈希——资格与复用时点环境一致性判据
//（挑战 env 轴的复用时点对应物）。值原文不落盘。
export function scopeEnvFingerprint() {
  return createHash("sha256").update(JSON.stringify({ platform: process.platform, arch: process.arch, node: process.version, tz: process.env.TZ ?? null })).digest("hex");
}

// 现行结构身份七轴（拍板 7 复用腿与 reuse 判定共用的单一事实源；gate 复用腿同源调用）。
export function currentScopeIdentityAxes(cwd, goal, dutyId) {
  return {
    rulesHash: policyRulesHash(),
    dutyTableVersion: DUTY_TABLE_VERSION,
    templateHash: dutyTemplateHash(dutyId),
    contractHash: goal?.contract?.contractHash ?? null,
    manifestHash: manifestHashOf(cwd, goal),
    engine: findEngine(),
    env: scopeEnvFingerprint(),
  };
}

// 复用腿逐轴对表的轴集（0.4.0 M5 N2 单一事实源）：gate 复用腿与资格身份七轴同源——
// templateHash/dutyTableVersion 在 gate 侧有具名拒因故单列，余轴在此枚举（M4 曾漏 env，
// M4 输入 9③；新增轴两侧同批改）。
export const SCOPE_REUSE_LEG_AXES = ["rulesHash", "contractHash", "manifestHash", "engine", "env"];

// select：声明类规则序优先、路径字典序次之（拍板 3 select 钉死）。
function pickExistingByRules(baseMap, rules, cls) {
  for (const r of rules) {
    if (r.class !== cls) continue;
    const re = globToRegExp(r.pattern);
    for (const p of Object.keys(baseMap).sort()) {
      if (re.test(p)) return p;
    }
  }
  return null;
}

// select：套件 hint（单 glob 或 hints 数组，hint 序优先、路径字典序次之）对仓现存文件（声明作者
// 不可控的 ground truth 位）。返回全部命中（去重保序），供「遗漏反例」选路复用。
function listExistingByHint(baseMap, hints) {
  const list = typeof hints === "string" ? [hints] : Array.isArray(hints) ? hints : [];
  const out = [];
  const seen = new Set();
  for (const h of list) {
    const re = globToRegExp(h);
    for (const p of Object.keys(baseMap).sort()) {
      if (!seen.has(p) && re.test(p)) {
        seen.add(p);
        out.push(p);
      }
    }
  }
  return out;
}

// 注入写 containment（0.4.0 M5 N4，M4 输入 8）：仓库物化后的符号链接被注入路径命中时不再
// 越界写/崩溃——悬空=realpath 抛、指向夹具外=拒、目录/非常规文件=拒，各出 clean 失败对象由
// 调用面落 mk(...)（夹具外字节零触碰）。旧实现直 join+readFileSync/writeFileSync：悬空链接
// ENOENT 直抛、外指链接把标记写进夹具外目标。
function mutateAppend(fx, rel) {
  const p = join(fx, rel);
  let fxReal;
  let real;
  try {
    fxReal = realpathSync(fx); // 夹具根先归一：tmpdir 在 macOS 经 /var→/private/var 链接，两侧不同归一会把整仓误判越界
    real = realpathSync(p);
  } catch {
    return { ok: false, reason: `注入落点不可解析（悬空链接或缺席）：${rel}` };
  }
  if (real !== fxReal && !real.startsWith(fxReal + sep)) {
    return { ok: false, reason: `注入落点越界（符号链接逃逸夹具）：${rel}` };
  }
  let st;
  try {
    st = statSync(p);
  } catch {
    return { ok: false, reason: `注入落点不可 stat：${rel}` };
  }
  if (!st.isFile()) return { ok: false, reason: `注入落点非常规文件：${rel}` };
  writeFileSync(p, Buffer.concat([readFileSync(p), Buffer.from("\n// scope-challenge\n")]));
  return { ok: true };
}

// 结构轴挑战（env/contract/duty）：真身份漂移注入（0.4.0 M5 N1，M4 输入 7）——三轴各构造
// 同形状漂移值（env=TZ 变体重算指纹；contract=变异哈希；duty=表版本+1），以漂移判定为主
// 判据、聚合管线失效语义为伴断言。旧实现直接以合成 reason 走管线恒 fallback、不读 expect
//（恒真断言，不构成证据）。
const STRUCTURAL_CHALLENGE_REASONS = {
  env: "资格挑战注入：env 指纹漂移",
  contract: "资格挑战注入：契约哈希漂移",
  duty: "资格挑战注入：职责/规则版本漂移",
};
const STRUCTURAL_AXIS_FIELD = { env: "env", contract: "contractHash", duty: "dutyTableVersion" };

function structuralDriftAxes(axis, baseAxes) {
  const drifted = { ...baseAxes };
  if (axis === "env") {
    drifted.env = createHash("sha256")
      .update(JSON.stringify({ platform: process.platform, arch: process.arch, node: process.version, tz: `${process.env.TZ ?? "null"}+scope-challenge` }))
      .digest("hex");
  } else if (axis === "contract") {
    drifted.contractHash = createHash("sha256").update("scope-challenge:contract-drift").digest("hex");
  } else if (axis === "duty") {
    drifted.dutyTableVersion = (baseAxes?.dutyTableVersion ?? 0) + 1;
  }
  return drifted;
}

// 纯函数：结构轴身份漂移判定——与 gate 复用腿身份轴比较同语义（String 归一，null 安全）；
// 漂移未发生判 keep（挑战自无效，经 ok=observed!==expect 暴露为失败），漂移发生判 invalidate。
export function structuralAxisDriftVerdict(axis, baseAxes, driftedAxes) {
  const field = STRUCTURAL_AXIS_FIELD[axis] ?? axis;
  return String(baseAxes?.[field] ?? "null") === String(driftedAxes?.[field] ?? "null") ? "keep" : "invalidate";
}

function runChallengeSuite({ candDir, baseMap, declaration, suite, identityAxes }) {
  const tmp = mkdtempSync(join(tmpdir(), "lzy-scope-qualify-"));
  const results = [];
  try {
    suite.challenges.forEach((c, i) => {
      const mk = (observed, ok, path) => ({ id: c.id, axis: c.axis, expect: c.expect, ok, observed: `${observed}${path ? ` @${path}` : ""}` });
      const res = (() => {
        if (STRUCTURAL_CHALLENGE_REASONS[c.axis]) {
          const field = STRUCTURAL_AXIS_FIELD[c.axis];
          const driftedAxes = structuralDriftAxes(c.axis, identityAxes);
          const observed = structuralAxisDriftVerdict(c.axis, identityAxes, driftedAxes);
          if (observed === "invalidate") {
            const v = scopeReuseVerdict([], [STRUCTURAL_CHALLENGE_REASONS[c.axis]]);
            if (v.verdict !== "fallback") return mk(`structural-pipeline-broken:${v.verdict}`, false, null);
          }
          const entry = mk(observed, observed === c.expect, null);
          entry.drift = { base: identityAxes?.[field] ?? null, drifted: driftedAxes?.[field] ?? null };
          return entry;
        }
        const fx = join(tmp, `ch-${i}`);
        // verbatimSymlinks：缺省 false 会把相对链接目标改写成**绝对**路径串，而 buildFileMap
        // 记 `symlink:<target>` ⇒ 含相对符号链接的真实仓每个挑战都掺入伪「modified」未知路径
        // 污染（期望 keep 的 canary 轴必拒、期望 invalidate 的轴假过）——实测 openchamber
        // （CLAUDE.md -> AGENTS.md、.claude/skills/* -> ../../.agents/skills/*，N10 缺陷 ②）。
        cpSync(candDir, fx, { recursive: true, verbatimSymlinks: true });
        const classify = () => {
          const cur = buildFileMap(fx);
          const diff = diffFileMaps(baseMap, cur);
          const classified = classifyDiffEntries([...diff.modified, ...diff.added, ...diff.deleted, ...diff.renamed], declaration);
          const v = scopeReuseVerdict(classified, []);
          return v.verdict === "applicable" ? "keep" : "invalidate";
        };
        if (c.axis === "in-scope" || c.axis === "canary-keep") {
          const cls = c.axis === "in-scope" ? "in-scope" : "unrelated";
          const path = c.path ?? pickExistingByRules(baseMap, declaration.rules, cls);
          if (!path) return mk(cls === "in-scope" ? "no-in-scope-file（声明未覆盖任何现存文件——空洞范围）" : "no-unrelated-file（canary 无处安放——过窄声明）", false);
          const inj1 = mutateAppend(fx, path);
          if (!inj1.ok) return mk(inj1.reason, false, path);
          const observed = classify();
          return mk(observed, observed === c.expect, path);
        }
        if (c.axis === "missed-dependency" || c.axis === "check-script" || c.axis === "lockfile") {
          const matches = listExistingByHint(baseMap, c.hints ?? c.hint);
          // missed-dependency=遗漏反例轴：hint 命中集里优先取「声明显式判 unrelated」者注入——越界
          // 声明（把依赖制品划出范围）必被点名拒。无此类命中时回落首个命中：未匹配判 unknown⇒
          // invalidate（保守回退语义），即「漏声明」不构成反例，只有「划错类」才是。
          const counterexample = c.axis === "missed-dependency" ? matches.find((p) => classifyScopePath(p, declaration).decision === "keep") : undefined;
          const path =
            c.path ??
            (c.axis === "lockfile" ? declaration.sharedInputs.find((s) => baseMap[s] !== undefined) : null) ??
            counterexample ??
            matches[0] ??
            null;
          if (!path) {
            return mk(c.axis === "lockfile" ? "no-shared-input-file（声明的 sharedInputs 均不在仓内）" : "hint-no-match（套件 hint 对仓无现存文件——套件与仓不匹配）", false);
          }
          if (baseMap[path] === undefined) return mk("path-not-in-snapshot（套件指定路径不在候选快照内）", false);
          const inj2 = mutateAppend(fx, path);
          if (!inj2.ok) return mk(inj2.reason, false, path);
          const observed = classify();
          return mk(observed, observed === c.expect, path);
        }
        if (c.axis === "unknown-new") {
          const path = c.path ?? "__scope_challenge__/unknown-new.txt";
          const dest = join(fx, path);
          const relDest = relative(fx, resolve(dest)); // 新建文件无 realpath 可核——词法 containment（套件 path 逃逸拒绝）
          if (relDest.startsWith("..") || isAbsolute(relDest)) return mk(`注入落点越界（套件 path 逃逸夹具）：${path}`, false, path);
          mkdirSync(dirname(dest), { recursive: true });
          writeFileSync(dest, "scope challenge: unknown new file\n");
          const observed = classify();
          return mk(observed, observed === c.expect, path);
        }
        if (c.axis === "rename-delete") {
          const path = c.path ?? pickExistingByRules(baseMap, declaration.rules, "in-scope");
          if (!path) return mk("no-in-scope-file（重命名删除轴无从注入）", false);
          const dest = `${path}.scopechall-moved`;
          // rename 注入
          let obsRename;
          {
            // 单挑战内两注入各自独立判定：先 rename 后还原再 delete
            renameSyncSafe(join(fx, path), join(fx, dest));
            const cur1 = buildFileMap(fx);
            const d1 = diffFileMaps(baseMap, cur1);
            const c1 = classifyDiffEntries([...d1.modified, ...d1.added, ...d1.deleted, ...d1.renamed], declaration);
            obsRename = scopeReuseVerdict(c1, []).verdict === "applicable" ? "keep" : "invalidate";
            renameSyncSafe(join(fx, dest), join(fx, path));
          }
          // delete 注入
          let obsDelete;
          {
            rmSync(join(fx, path));
            const cur2 = buildFileMap(fx);
            const d2 = diffFileMaps(baseMap, cur2);
            const c2 = classifyDiffEntries([...d2.modified, ...d2.added, ...d2.deleted, ...d2.renamed], declaration);
            obsDelete = scopeReuseVerdict(c2, []).verdict === "applicable" ? "keep" : "invalidate";
          }
          const ok = obsRename === c.expect && obsDelete === c.expect;
          return mk(`rename=${obsRename}/delete=${obsDelete}`, ok, path);
        }
        return mk("axis-unhandled", false);
      })();
      results.push(res);
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return results;
}

// rename 的显式包裹（挑战夹具为一次性拷贝；目标残留先清、父目录在场断言 fail-loud）。
function renameSyncSafe(from, to) {
  rmSync(to, { force: true });
  realpathSync(dirname(from));
  renameSync(from, to);
}

// 资格主流程：base 运行有效且 pass ∧ 职责 declarable ∧ 声明合法同职责 ∧ 套件在案合法 ⇒
// 物化挑战夹具逐轴对表 oracle，granted/拒绝双面落档（拒绝也是事实）。
export async function qualifyReviewScope(cwd, { runId, scopeDecl }, deps = {}) {
  const pre = (m, reason = "preflight") => {
    throw new ReviewPreflightError(m, { reason });
  };
  const m = /^(.+)\.a(\d+)\.r(\d+)$/.exec(runId ?? "");
  if (!m) pre(`runId 形如 <slug>.a<n>.r<n>：${JSON.stringify(runId ?? null)}`, "usage");
  const slug = m[1];
  const attempt = Number(m[2]);
  const seq = Number(m[3]);
  if (!Number.isInteger(attempt) || attempt < 1 || !Number.isInteger(seq) || seq < 1) pre(`runId 序号非法：${runId}`, "usage");
  let run;
  try {
    run = loadReviewFile(join(reviewDir(cwd), `${runId}.json`));
  } catch (e) {
    pre(`base 运行档不可读：${runId}（${String(e?.message ?? e).slice(0, 120)}）`);
  }
  if (!run) pre(`base 运行档不在案：${runId}`);
  if (run.slug !== slug || run.attempt !== attempt) pre(`runId 与档内身份不符：${run.slug}.a${run.attempt}.r${run.seq}`);
  if (run.validity?.status !== "valid") pre(`base 运行非 valid（${run.validity?.status ?? "null"}${run.validity?.reason ? `：${run.validity.reason}` : ""}）——资格只授有效评审`);
  if (run.result?.verdict !== "pass") pre(`base 运行判决非 pass（${run.result?.verdict ?? "null"}）——阻塞评审无从谈复用（ADR-0032）`);
  const dutyEntry = deps.dutyEntry ?? DUTY_TABLE.find((d) => d.id === run.duty.id);
  if (!dutyEntry) pre(`职责不在表：${run.duty.id}`);
  if (dutyEntry.scopeMode !== "declarable") {
    pre(`职责 ${dutyEntry.id} 非 declarable（scopeMode=${dutyEntry.scopeMode ?? "whole-candidate"}）——整候选职责恒重评（拍板 5）`);
  }
  const decl = validateScopeDeclaration(scopeDecl);
  if (decl.dutyId !== run.duty.id) pre(`声明 dutyId=${decl.dutyId} ≠ base 运行职责 ${run.duty.id}——声明只对被复核职责立`);
  // 套件：deps 注入优先（测试/合成），否则随包 <dutyId>.qualify.json（loadChallengeSuite
  // 校验+缓存；declarable 职责随包套件由本批职责入表落地）
  const suiteFileRel = `core/review-duties/${decl.dutyId}.qualify.json`;
  let suite = deps.suite;
  if (!suite) {
    const loaded = loadChallengeSuite(decl.dutyId);
    if (!loaded) pre(`职责 ${decl.dutyId} 无随包套件（whole-candidate 不参与资格）`);
    suite = loaded.suite;
  } else {
    validateChallengeSuite(suite);
  }
  if (suite.dutyId !== decl.dutyId) throw new ReviewError(`套件职责不符：套件 ${suite.dutyId} ≠ 声明 ${decl.dutyId}`);
  // base 快照
  const candDir = join(reviewDir(cwd), runId, "candidate");
  let baseMap;
  try {
    baseMap = buildFileMap(candDir);
  } catch (e) {
    pre(`base 运行候选快照缺席（${candDir}）：${String(e?.message ?? e).slice(0, 120)}——无挑战夹具底座`);
  }
  // 执行
  // 结构身份快照（资格时点七轴——reuse/gate 复用腿时与现行对表，漂移即身份失效）；
  // 同一对象供结构轴挑战作漂移基线（M5 N1）。
  const goal = readGoal(cwd);
  const manifestHash = manifestHashOf(cwd, goal);
  const identityAxes = {
    rulesHash: policyRulesHash(),
    dutyTableVersion: DUTY_TABLE_VERSION,
    templateHash: dutyTemplateHash(decl.dutyId),
    contractHash: goal?.contract?.contractHash ?? null,
    manifestHash,
    engine: findEngine(),
    env: scopeEnvFingerprint(),
  };
  const challenges = runChallengeSuite({ candDir, baseMap, declaration: decl, suite, identityAxes });
  const granted = challenges.every((c) => c.ok);
  const seqQ = nextScopeSeq(cwd, slug, attempt, "qualification");
  const rec = {
    schemaVersion: SCOPE_VERSION,
    kind: "qualification",
    id: scopeRecordStem(slug, attempt, "qualification", seqQ),
    slug,
    attempt,
    seq: seqQ,
    dutyId: decl.dutyId,
    baseRunId: runId,
    scopeHash: decl.scopeHash,
    scope: { rules: decl.rules, sharedInputs: decl.sharedInputs },
    identity: { ...identityAxes },
    suite: { file: suiteFileRel, suiteHash: challengeSuiteHash(suite), procedureVersion: suite.procedureVersion },
    granted,
    challenges,
    at: new Date().toISOString(),
    note: "mechanical（零积分——资格=机械对抗验证，无会话无消耗，拍板 10）",
  };
  saveScopeRecord(cwd, rec);
  return { record: rec, granted, failed: challenges.filter((c) => !c.ok) };
}

// ── 0.4.0 M4 N3：复用适用性判定（拍板 4/7/9）：base 运行+在案 granted 资格 ⇒ 当前候选
// diff 分类完备性判定 → applicable/fallback 适用档（只追加；base 运行档与资格档字节零触碰）。
// 结构轴漂移（rulesHash/dutyTableVersion/templateHash/contractHash/manifestHash/engine/env 任一）
// =资格身份失效⇒fallback 逐因（plan §5.4「资格版本变化回退重评」）；不 spawn 零积分。──

export async function reuseReviewScope(cwd, { runId }, deps = {}) {
  const pre = (m, reason = "preflight") => {
    throw new ReviewPreflightError(m, { reason });
  };
  const m = /^(.+)\.a(\d+)\.r(\d+)$/.exec(runId ?? "");
  if (!m) pre(`runId 形如 <slug>.a<n>.r<n>：${JSON.stringify(runId ?? null)}`, "usage");
  const slug = m[1];
  const attempt = Number(m[2]);
  let run;
  try {
    run = loadReviewFile(join(reviewDir(cwd), `${runId}.json`));
  } catch (e) {
    pre(`base 运行档不可读：${runId}（${String(e?.message ?? e).slice(0, 120)}）`);
  }
  if (!run) pre(`base 运行档不在案：${runId}`);
  if (run.slug !== slug || run.attempt !== attempt) pre(`runId 与档内身份不符：${run.slug}.a${run.attempt}.r${run.seq}`);
  if (run.validity?.status !== "valid") pre(`base 运行非 valid（${run.validity?.status ?? "null"}）——复用只授有效评审`);
  if (run.result?.verdict !== "pass") pre(`base 运行判决非 pass（${run.result?.verdict ?? "null"}）——阻塞评审无可复用`);
  const dutyEntry = deps.dutyEntry ?? DUTY_TABLE.find((d) => d.id === run.duty.id);
  if (!dutyEntry || dutyEntry.scopeMode !== "declarable") {
    pre(`职责 ${run.duty.id} 非 declarable——整候选职责恒重评（拍板 5）`);
  }
  // 资格在案：同 baseRunId 最新档（seq 数值序取末）；拒绝态资格不可作复用依据。
  const quals = listScopeRecords(cwd, { slug, attempt, kind: "qualification" }).filter((r) => r.baseRunId === runId);
  const qual = quals.at(-1) ?? null;
  if (!qual) pre(`base 运行无在案资格档——先 lzy review qualify ${runId} --scope <声明>（复用只授已过资格挑战的声明，ADR-0032）`);
  if (qual.granted !== true) pre(`base 运行最新资格档为拒绝态（${qual.id}）——修正声明重走资格挑战，不得以拒资复用`);
  // 结构身份对表（资格时点七轴 vs 现行）：任一漂移⇒fallback 逐因（仍落档——回退重评是判断结果）
  const goal = readGoal(cwd);
  const current = currentScopeIdentityAxes(cwd, goal, qual.dutyId);
  const short = (v) => (typeof v === "string" && v.length > 12 ? `${v.slice(0, 12)}…` : JSON.stringify(v ?? null));
  const drift = [];
  for (const k of Object.keys(current)) {
    if (String(current[k]) !== String(qual.identity[k])) {
      drift.push(`资格身份漂移：${k}（资格 ${short(qual.identity[k])} → 现行 ${short(current[k])}）——回退重评（plan §5.4）`);
    }
  }
  // base 快照与当前候选
  const candDir = join(reviewDir(cwd), runId, "candidate");
  let baseMap;
  try {
    baseMap = buildFileMap(candDir);
  } catch (e) {
    pre(`base 运行候选快照缺席（${candDir}）：${String(e?.message ?? e).slice(0, 120)}——复用无锚`);
  }
  const tmp = mkdtempSync(join(tmpdir(), "lzy-scope-reuse-"));
  let targetTreeHash;
  let curMap;
  try {
    const curDir = join(tmp, "tree");
    gitArchiveHead(cwd, curDir);
    curMap = buildFileMap(curDir);
    targetTreeHash = hashTree(curDir);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const target = candidateIdentity(cwd);
  // diff 分类与聚合
  const diff = diffFileMaps(baseMap, curMap);
  const entries = [...diff.modified, ...diff.added, ...diff.deleted, ...diff.renamed];
  const classified = classifyDiffEntries(entries, { rules: qual.scope.rules, sharedInputs: qual.scope.sharedInputs });
  const { verdict, reasons } = scopeReuseVerdict(classified, drift);
  // 适用档（追加写；base 运行档与资格档零触碰）
  const seqP = nextScopeSeq(cwd, slug, attempt, "applicability");
  const rec = {
    schemaVersion: SCOPE_VERSION,
    kind: "applicability",
    id: scopeRecordStem(slug, attempt, "applicability", seqP),
    slug,
    attempt,
    seq: seqP,
    dutyId: qual.dutyId,
    baseRunId: runId,
    qualificationId: qual.id,
    target: { headSha: target.headSha, compositeFingerprint: target.compositeFingerprint, cliVersion: target.cliVersion },
    diff: {
      baseTreeHash: run.snapshot?.treeHash ?? null,
      targetTreeHash,
      entries: entries.map((e) => (e.type === "renamed" ? { path: e.path, type: e.type, from: e.from } : { path: e.path, type: e.type })),
    },
    verdict,
    reasons,
    at: new Date().toISOString(),
    note: "mechanical（零积分——适用性=追加判断，不改写旧记录，ADR-0032）",
  };
  saveScopeRecord(cwd, rec);
  return { record: rec, verdict, reasons, diffEntries: entries.length };
}
