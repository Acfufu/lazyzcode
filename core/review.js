// 受控独立评审运行记录家族（0.4.0 M2，ADR-0031；docs/plan-v040-engineering-policy.md §4.1/§4.2）。
// 位阶同 policy/verify：loop/ 外、reset 不清；每次评审运行一档 <slug>.a<attempt>.r<seq>.json +
// 同茎运行目录（input.json/candidate/home/raw.txt，N2/N3 物化）。族容器走 queue.js
// loadFamilyFile/saveFamilyFile 家法（原子写 0600+校验和+版本+形状闸 fail-closed）。
// 记录携带 attempt/dutyTableVersion/templateHash 三字段=统一门代次锚与规则一致性谓词的数据面
//（拍板 6）；dutyTableVersion 不在此钉现行值——旧规则版本的记录须保持可读，一致性由 gate 判。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync, openSync, closeSync } from "node:fs";
import { join, resolve, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawnSync } from "node:child_process";
import { loadFamilyFile, saveFamilyFile, budgetView } from "./queue.js";
import { candidateIdentity, listReceipts } from "./verify.js";
import { loadPolicyRecord, DUTY_TABLE_VERSION } from "./policy.js";
import { createGit } from "./git.js";
import { findEngine } from "./paths.js";
import { HEADLESS_DEFAULT_TIMEOUT_MS, spawnHeadless, detectHeadlessAuth } from "./headless.js";
import { effectiveAuthorization, loadContract } from "./contract.js";
import { querySessionPoints } from "./cost.js";

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
  // 预算面（拍板 7③：budget-ref 非 none 读视图记占位不执法；none=只记事实）
  if (rec.budget !== null) {
    if (!rec.budget || typeof rec.budget !== "object" || Array.isArray(rec.budget)) bad("budget 须为对象或 null");
    if (rec.budget.ref !== null && typeof rec.budget.ref !== "string") bad("budget.ref 须为字符串或 null");
    if (typeof rec.budget.note !== "string" || !rec.budget.note) bad("budget.note 缺席或空（如实注记义务）");
    if (rec.budget.enforced !== false) bad("budget.enforced 恒 false（M2 不执法——执法面列 M3 输入）");
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

function readCappedText(p, cap) {
  const buf = readFileSync(p);
  const text = buf.toString("utf8");
  if (buf.length <= cap) return { text, bytes: buf.length, truncated: false };
  return { text: `${text.slice(0, cap)}\n…[输入包截断：原文 ${buf.length} 字节，只注入前 ${cap}]`, bytes: buf.length, truncated: true };
}

// facts-only 输入包（拍板 4 唯一定义）：契约文本、项目清单、AGENTS.md 项目规则、目标步骤与
// F 证据文本、回执摘要、策略义务集、候选身份。写 <runDir>/input.json（0600）并算
// inputPackageHash。多 subject 目标 fail-closed 拒（跨仓候选输入打包属 M5）。
export function buildInputPackage(cwd, goal, runDir, { dutyId = BASELINE_DUTY_ID, now = new Date() } = {}) {
  if (!goal || goal.version !== 2) throw new ReviewError(`评审输入包须 v2 目标（得到 version=${goal?.version ?? null}）`);
  if (Array.isArray(goal.subjects) && goal.subjects.length > 0) {
    throw new ReviewError(`多 subject 目标的评审候选跨仓，M2 不支持（跨仓输入打包列 M5）：${goal.subjects.join("、")}`);
  }
  const readOptional = (p, cap) => {
    try {
      return readCappedText(p, cap);
    } catch (err) {
      if (err && err.code === "ENOENT") return null;
      throw err;
    }
  };
  let evidence = [];
  try {
    evidence = readdirSync(join(cwd, ".lazyzcode", "evidence"))
      .filter((f) => f.startsWith(`${goal.slug}.`) && f.endsWith(".txt"))
      .sort()
      .map((f) => {
        const capped = readCappedText(join(cwd, ".lazyzcode", "evidence", f), EVIDENCE_CAP);
        return { file: f, sha256: createHash("sha256").update(capped.text).digest("hex"), ...capped };
      });
  } catch {}
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
    agentsRules: readOptional(join(cwd, "AGENTS.md"), AGENTS_CAP),
    steps: (goal.steps ?? []).map((s) => ({
      id: s.id,
      kind: s.kind ?? null,
      title: s.title,
      status: s.status,
      note: s.note ?? null,
      doneAt: s.doneAt ?? null,
      acceptsRefs: s.acceptsRefs ?? [],
    })),
    evidence,
    receipts,
    policy,
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
      if (key && /path|file|dir|cwd/i.test(key) && v.startsWith("/")) {
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
  const auth = (deps.detectAuth ?? detectHeadlessAuth)();
  if (!auth?.ok) {
    throw new ReviewPreflightError(
      "无引擎认证（OAuth 凭据与 provider env 均缺席）——隔离 HOME 下评审会话无法创建；恢复：桌面端登录或注入 provider env 后重跑（lzy doctor 看 headless 行）",
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
        view = { wallMs: v?.wallMs ?? null, points: v?.points ?? null };
      } catch {}
      budget = { ref: budgetRef, enforced: false, view, note: "budget-ref 非 none——预算视图如实记录占位；M2 不执法（执法面列 M3 输入）" };
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
export async function runReview(cwd, { duty = BASELINE_DUTY_ID, timeoutMs, deps = {} } = {}) {
  if (!DUTY_TABLE.some((d) => d.id === duty)) {
    throw new ReviewPreflightError(`职责不在表：${duty}（现行职责表：${DUTY_TABLE.map((d) => d.id).join("、")}）`, { reason: "duty-unknown" });
  }
  const goal = readGoalJson(cwd);
  if (!goal || goal.version !== 2) {
    throw new ReviewPreflightError("无 v2 活跃目标（.lazyzcode/loop/goal.json 缺席或 v1）——评审运行针对当前目标", { reason: "no-goal" });
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
  const reserve = reserveRun(cwd, goal.slug, goal.attempt);
  const failures = []; // [reason, detail] 按优先序；validity.reason=首因、detail=全列
  let pkgHash = null;
  let snapHash = null;
  try {
    const pkg = buildInputPackage(cwd, goal, reserve.runDir, { dutyId: duty, now: startedAt });
    pkgHash = pkg.inputPackageHash;
    const snap = materializeCandidate(cwd, reserve.runDir);
    snapHash = snap.treeHash;
    const iso = prepareIsolation(reserve.runDir);
    // 泄漏断言（拍板 4）：input 字节 vs 同 (slug,attempt) 在先运行标记——命中不 spawn
    const priors = listReviewRuns(cwd, { slug: goal.slug, attempt: goal.attempt }).filter((r) => r.seq < reserve.seq);
    const leak = assertNoLeak(readFileSync(pkg.inputPath, "utf8"), priors);
    if (!leak.ok) {
      failures.push(["leak", `输入包含在先运行标记：${leak.hits.map((h) => `${h.runId}/${h.kind}`).join("、")}（facts-only 违反，拍板 4）`]);
    }
    let spawned = false;
    let run = null;
    let sessionId = null;
    let rawInfo = null;
    let transcriptInfo = null;
    let result = null;
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
    // 隔离证词（拍板 4）：每会话转录缺席=invalid（隔离未证）；读取越界=invalid
    if (spawned) {
      if (sessionMeta.length === 0 || sessionMeta.some((m) => !m.transcript)) {
        failures.push(["isolation-breach", "转录缺席（隔离 HOME 内未找到 model-io 转录——隔离未证，M0 口径）"]);
      } else {
        // 允许前缀（拍板 4）：候选快照/运行目录/隔离 home/**引擎自身前缀**（provider 配置目录+
        // 引擎安装目录+node 可执行目录——引擎自身运行所需读取不构成隔离破口）。
        const enginePrefixes = [dirname(findEngine() ?? "/nonexistent"), dirname(process.execPath)];
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
    // deps 注入供 CI）。逐会话读数求和（单次重跑=两会话，点数合计=诚实记账）；三分类映射：
    // absent 行 / 全表外零计价 / metered（表外行如实注记下界）。
    let metering;
    if (!spawned) {
      metering = { status: "absent", points: null, note: "未 spawn——无计量可读（未消耗；不算零口径不适用）" };
    } else {
      const reads = [];
      for (const m of sessionMeta) {
        if (!m.sessionId) continue;
        try {
          const r = await (deps.querySessionPoints ?? querySessionPoints)(m.sessionId, {
            dbPath: join(iso.home, ".zcode", "cli", "db", "db.sqlite"),
          });
          reads.push({ sessionId: m.sessionId, r });
        } catch (e) {
          reads.push({ sessionId: m.sessionId, r: null, err: String(e?.message ?? e).slice(0, 80) });
        }
      }
      const withRows = reads.filter((x) => x.r && x.r.absent === false);
      const totalPoints = withRows.reduce((acc, x) => acc + (Number(x.r.points) || 0), 0);
      const anyUnpriced = reads.some((x) => x.r && x.r.absent === false && x.r.points === 0 && Array.isArray(x.r.unpriced) && x.r.unpriced.length > 0);
      const allAbsent = reads.length > 0 && withRows.length === 0;
      const sidList = reads.map((x) => x.sessionId).join("+");
      const sessionNote = reads.length > 1 ? `${reads.length} 会话（含单次重跑：${sidList}）` : `sessionId ${sidList}`;
      if (reads.some((x) => x.err)) {
        metering = { status: "absent", points: null, note: `计量读数失败（${reads.find((x) => x.err)?.err}）——缺用量不算零（ADR-0027 修正节）` };
      } else if (allAbsent) {
        metering = { status: "absent", points: null, note: `${sessionNote} 在子账本无完成用量行——缺用量不算零（ADR-0027 修正节）` };
      } else if (totalPoints === 0 && anyUnpriced) {
        metering = { status: "unpriced", points: null, note: `模型未计价（表外行；${sessionNote}）——unpriced 不算零（ADR-0027 修正节）` };
      } else {
        const hasUnpriced = reads.some((x) => x.r && Array.isArray(x.r.unpriced) && x.r.unpriced.length > 0);
        metering = {
          status: "metered",
          points: totalPoints,
          note: hasUnpriced
            ? `表外模型行计 0——读数为下界（计价子集口径；${sessionNote}）`
            : reads.length > 1
              ? `${sessionNote}（点数=两会话合计）`
              : null,
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
    };
    return finishRun(cwd, reserve, record);
  } catch (err) {
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
    };
    try {
      return { ...finishRun(cwd, reserve, record), thrown: err };
    } catch {
      throw err; // 落档也失败（如磁盘满）——原异常上抛
    }
  }
}

// 记录组装收尾：dutyTableVersion 从现行策略记录取（记录缺/不可读=回退现行职责表版本——
// runner 恒在现行规则下运行，不冒充他版）。
function finishRun(cwd, reserve, record) {
  let v = null;
  try {
    const rec = loadPolicyRecord(cwd, record.slug, record.attempt);
    if (rec && Number.isInteger(rec.dutyTableVersion)) v = rec.dutyTableVersion;
  } catch {}
  record.dutyTableVersion = v ?? DUTY_TABLE_VERSION;
  const saved = saveReviewRun(cwd, record);
  return { record: saved, exitHint: saved.validity.status === "valid" && saved.result?.verdict === "pass" ? 0 : 1 };
}
