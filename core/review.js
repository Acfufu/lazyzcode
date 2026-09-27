// 受控独立评审运行记录家族（0.4.0 M2，ADR-0031；docs/plan-v040-engineering-policy.md §4.1/§4.2）。
// 位阶同 policy/verify：loop/ 外、reset 不清；每次评审运行一档 <slug>.a<attempt>.r<seq>.json +
// 同茎运行目录（input.json/candidate/home/raw.txt，N2/N3 物化）。族容器走 queue.js
// loadFamilyFile/saveFamilyFile 家法（原子写 0600+校验和+版本+形状闸 fail-closed）。
// 记录携带 attempt/dutyTableVersion/templateHash 三字段=统一门代次锚与规则一致性谓词的数据面
//（拍板 6）；dutyTableVersion 不在此钉现行值——旧规则版本的记录须保持可读，一致性由 gate 判。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync, openSync, closeSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawnSync } from "node:child_process";
import { loadFamilyFile, saveFamilyFile } from "./queue.js";
import { candidateIdentity, listReceipts } from "./verify.js";
import { loadPolicyRecord } from "./policy.js";

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
// 命中前缀外=breach；转录缺席由调用方按 isolation-breach 判（隔离未证——M0 口径）。
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
  const visit = (v, key, line) => {
    if (typeof v === "string") {
      if (key && /path|file|dir|cwd/i.test(key) && v.startsWith("/") && !contained(v)) {
        breaches.push({ path: v.slice(0, 200), line });
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
  return { ok: breaches.length === 0, breaches };
}
