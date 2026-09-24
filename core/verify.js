// 受控执行器与执行回执（0.3.0 M2，主方案 §4.1/§4.2；ADR-0025 范围档的资格与复用判定同族）。
// 职责边界：本模块=检查配方经受控执行（argv 数组、shell:false、超时击杀、env 白名单）产生
// **真实回执**——runId/checkId/acceptanceIds/契约哈希/候选身份/配方与清单摘要/输入指纹/
// 环境指纹/起止/退出/工件 sha256；原始输出落 raw/ 与人工摘要分离保存。回执由真实执行产生，
// 文本或指纹更新不构成新执行（主方案 §4.1）。范围档复用判定（四问）与 qualification 资格
// 活体也在本模块（ADR-0025：复用保留原时点原观察事实，追加适用性判定，不改写旧回执）。
// 回执家族：`.lazyzcode/verify/<slug>/receipt-<seq>-<runId>.json` 自校验和 + `<slug>/raw/<runId>.log`。
// 家族在 loop/ 外（reset 不清，位阶同 authorizations/）；tmp 登记 ANY_TMP_SCAN_DIRS
//（core/loop.js 增补——观测面与清扫面同一判据）。校验和/原子写/errno 判别家法照 core/attempt.js。
// 本模块执行面 spawnSync 全同步；依赖方向 verify.js → project.js/loop.js/git.js 单向（免循环）。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { loadProjectManifest } from "./project.js";
import { fingerprintSubjects, readGoal } from "./loop.js";
import { createGit } from "./git.js";

export const VERIFY_VERSION = 1;
export const RECEIPT_KINDS = ["run", "reuse", "qualification", "ci"];
export const VERIFY_FAMILY = "verify";
export const DEFAULT_TIMEOUT_MS = 600_000;

export class VerifyError extends Error {}

const RECOVERY = `恢复：备份后删除受损回执文件可重建读面（回执只能由真实执行重新产生，不可手补）；` +
  `lzy verify list 重新枚举在案回执`;

function verifyRoot(cwd) {
  return join(cwd, ".lazyzcode", VERIFY_FAMILY);
}

function checksumOf(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

// runId：文件名安全、无冒号（win32 雷防）、时间可读；碰撞概率靠秒级时戳+进程 pid+随机尾。
export function newRunId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "T");
  const rand = Math.random().toString(36).slice(2, 6);
  return `r-${stamp}-${process.pid.toString(36)}${rand}`;
}

function assertReceiptShape(r, p) {
  const bad = (msg) => {
    throw new VerifyError(`执行回执形状畸形（${msg}）：${p}。${RECOVERY}`);
  };
  if (!r || typeof r !== "object" || Array.isArray(r)) bad("顶层须为对象");
  if (r.schemaVersion !== VERIFY_VERSION) bad(`schemaVersion 不识别：${r.schemaVersion}（本 lzy 期望 ${VERIFY_VERSION}）`);
  if (!RECEIPT_KINDS.includes(r.kind)) bad(`kind 不识别：${r.kind}（合法：${RECEIPT_KINDS.join("/")}）`);
  for (const k of ["slug", "runId", "checkId", "startedAt", "endedAt"]) {
    if (typeof r[k] !== "string" || !r[k]) bad(`${k} 缺席或非字符串`);
  }
  if (!Array.isArray(r.acceptanceIds)) bad("acceptanceIds 须为数组");
  if (!r.candidate || typeof r.candidate !== "object") bad("candidate 缺席");
  if (!r.recipe || typeof r.recipe !== "object" || !Array.isArray(r.recipe.argv)) bad("recipe 形状非法");
  if (!r.exit || typeof r.exit !== "object") bad("exit 缺席");
  if (!Array.isArray(r.artifacts)) bad("artifacts 须为数组");
  for (const a of r.artifacts) {
    if (!a || typeof a !== "object" || typeof a.path !== "string" || !/^[0-9a-f]{64}$/.test(a.sha256 ?? "")) {
      bad(`artifacts 条目须 {path, sha256}：${JSON.stringify(a)?.slice(0, 60)}`);
    }
  }
  if (r.baseRunId !== null && r.baseRunId !== undefined && typeof r.baseRunId !== "string") bad("baseRunId 须为字符串或 null");
  // kind 特化断言：reuse/qualification 必有溯源；qualification 必有对抗注入记录；ci 必有检查集。
  if (r.kind === "reuse") {
    if (typeof r.baseRunId !== "string") bad("reuse 回执 baseRunId 缺席");
    if (!r.reuseJudgment || typeof r.reuseJudgment !== "object" || !Array.isArray(r.reuseJudgment.reasons)) {
      bad("reuse 回执缺 reuseJudgment {judgedAt, reasons[], qualificationRunId}");
    }
  }
  if (r.kind === "qualification") {
    if (typeof r.baseRunId !== "string") bad("qualification 回执 baseRunId 缺席");
    if (!Array.isArray(r.injections) || r.injections.length === 0) bad("qualification 回执缺 injections 对抗注入记录");
    for (const inj of r.injections) {
      if (!inj || typeof inj !== "object" || typeof inj.entry !== "string" || inj.detected !== true || inj.restored !== true) {
        bad(`injections 条目须 {entry, mode, detected:true, restored:true}：${JSON.stringify(inj)?.slice(0, 60)}`);
      }
    }
  }
  if (r.kind === "ci") {
    if (!r.ci || typeof r.ci !== "object" || !Array.isArray(r.ci.checks) || typeof r.ci.sha !== "string") {
      bad("ci 回执缺 ci {repo, sha, checks[], queriedAt}");
    }
  }
}

// 单文件读：errno 判别（仅 ENOENT 视缺席）+ JSON/校验和/形状三层 fail-closed（attempt.js:62-92 家法）。
export function loadReceiptFile(p) {
  let text;
  try {
    text = readFileSync(p, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw new VerifyError(`执行回执不可读（${err?.code ?? err?.message ?? err}）：${p}。${RECOVERY}`);
  }
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new VerifyError(`执行回执损坏（JSON 解析失败）：${p}。${RECOVERY}`);
  }
  const { checksum, ...rest } = obj ?? {};
  if (checksum !== checksumOf(rest)) {
    throw new VerifyError(`执行回执校验和不符（内容与落盘时态不一致——回执不可改写，篡改即失效）：${p}。${RECOVERY}`);
  }
  assertReceiptShape(rest, p);
  return rest;
}

// 枚举：按 seq 升序；任一文件损坏即整体 fail-closed（静默跳过=错误复用面，沿 authorizations 语义）。
export function listReceipts(cwd, slug = null) {
  const root = verifyRoot(cwd);
  let dirs;
  try {
    dirs = slug ? [join(root, slug)] : readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(root, e.name));
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw new VerifyError(`回执家族不可读（${err?.code ?? err?.message ?? err}）：${root}。${RECOVERY}`);
  }
  const out = [];
  for (const dir of dirs) {
    const s = basename(dir);
    let names;
    try {
      names = readdirSync(dir).filter((n) => /^receipt-\d+-.*\.json$/.test(n)).sort();
    } catch {
      continue;
    }
    for (const n of names) out.push(loadReceiptFile(join(dir, n)));
  }
  out.sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
  return out;
}

// 追加写：tmp 0600 + rename（家法）；写前形状校验（写侧毒化防护，ADJ-44 家法）。
// 回执**只追加不改写**——调用方永远写新文件（seq 递增），baseRunId 承担溯源。
function writeReceipt(cwd, receipt) {
  assertReceiptShape(receipt, "memory(写入前)");
  const dir = join(verifyRoot(cwd), receipt.slug);
  let seq = 0;
  try {
    for (const n of readdirSync(dir)) {
      const m = n.match(/^receipt-(\d+)-/);
      if (m) seq = Math.max(seq, Number(m[1]));
    }
  } catch {}
  const p = join(dir, `receipt-${seq + 1}-${receipt.runId}.json`);
  mkdirSync(dirname(p), { recursive: true });
  const out = { ...receipt, checksum: checksumOf(receipt) };
  const tmp = join(dirname(p), `.receipt-${process.pid}-${Date.now()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, p);
  return p;
}

function sha256File(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function headSha(cwd) {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd, shell: false, timeout: 10_000, encoding: "utf8" });
  const out = (r.stdout ?? "").trim();
  return /^[0-9a-f]{40,64}$/.test(out) ? out : null;
}

function cliVersion(cwd) {
  try {
    return JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

// 候选身份：HEAD 提交、复合指纹（{host}∪subjects，loop.js:749-765 同源）、lzy 版本。
export function candidateIdentity(cwd) {
  const goal = readGoal(cwd);
  const roots = goal?.subjects ?? [];
  return {
    headSha: headSha(cwd),
    compositeFingerprint: fingerprintSubjects(cwd, roots),
    cliVersion: cliVersion(cwd),
  };
}

// 环境指纹：逐名值 sha256——值原文不落盘（清单 env 名单可能承载凭据语义）。
function envFingerprint(names) {
  const vars = {};
  for (const n of names) {
    const v = process.env[n];
    vars[n] = v === undefined ? "absent" : createHash("sha256").update(v).digest("hex");
  }
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    TZ: process.env.TZ ?? null,
    vars,
  };
}

// 范围档：inputPaths 逐条目（文件/目录）全枚举 → {relPath: sha256} 快照。
// 目录条目递归全枚举（含未知新文件——新文件=变化=回退，ADR-0025）；条目缺失如实记 "missing"。
export function inputSnapshot(cwd, inputPaths) {
  const snap = {};
  if (!Array.isArray(inputPaths) || inputPaths.length === 0) return null;
  const walk = (abs, rel) => {
    const st = statSync(abs, { throwIfNoEntry: false });
    if (!st) {
      snap[rel] = "missing";
      return;
    }
    if (st.isDirectory()) {
      for (const e of readdirSync(abs).sort()) walk(join(abs, e), rel ? `${rel}/${e}` : e);
      return;
    }
    snap[rel] = sha256File(abs);
  };
  for (const entry of inputPaths) {
    if (isAbsolute(entry)) {
      throw new VerifyError(`inputPaths 含绝对路径：「${entry}」——只收项目根相对路径（writePaths 家法）`);
    }
    const abs = resolve(cwd, entry);
    const rel = relative(cwd, abs);
    if (rel.startsWith("..")) {
      throw new VerifyError(`inputPaths 逃逸项目根：「${entry}」→ ${rel}`);
    }
    walk(abs, rel.split("\\").join("/"));
  }
  return snap;
}

function findCheckRecipe(manifest, checkId) {
  const list = manifest?.capabilities?.check ?? [];
  const hit = list.find((r) => r.id === checkId);
  if (hit) return hit;
  const available = list.map((r) => r.id);
  throw new VerifyError(
    available.length === 0
      ? `清单无 check 类配方：checkId「${checkId}」不可执行——先在 lzy.project.json capabilities.check 落配方（lzy project check 看现状）`
      : `checkId「${checkId}」不在 check 类配方中（在案：${available.join(", ")}）`,
  );
}

// 受控执行一问（kind=run）：真实 spawn 产生回执。拒绝面：无 goal/无清单/checkId 缺席/
// cwd 非法。执行=spawnSync(argv, {shell:false})，超时 SIGTERM 击杀记 exit.timeout；
// 原始 stdout/stderr 落 raw/<runId>.log（与人工摘要分离保存），回执工件面绑 sha256。
export function runCheck(cwd, checkId, { accepts = [], note = null } = {}) {
  const goal = readGoal(cwd);
  if (!goal) throw new VerifyError(`无活跃目标：verify run 需 executing 目标承载 slug/契约/subject 集——先 lzy loop register`);
  const loaded = loadProjectManifest(cwd);
  if (!loaded) throw new VerifyError(`项目清单缺席：无 lzy.project.json 可执行配方——lzy project discover 看缺失面`);
  const recipe = findCheckRecipe(loaded.manifest, checkId);
  const recipeCwd = resolve(cwd, recipe.cwd ?? ".");
  if (!statSync(recipeCwd, { throwIfNoEntry: false })?.isDirectory()) {
    throw new VerifyError(`配方 cwd 不存在：${recipe.cwd} → ${recipeCwd}`);
  }
  const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
  for (const n of recipe.env ?? []) {
    if (process.env[n] !== undefined) env[n] = process.env[n];
  }
  const startedAt = new Date().toISOString();
  const runId = newRunId();
  const timeoutMs = recipe.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const r = spawnSync(recipe.argv[0], recipe.argv.slice(1), {
    cwd: recipeCwd,
    env,
    shell: false,
    timeout: timeoutMs,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const endedAt = new Date().toISOString();
  const rawRel = join(goal.slug, "raw", `${runId}.log`);
  const rawAbs = join(verifyRoot(cwd), rawRel);
  mkdirSync(dirname(rawAbs), { recursive: true });
  const rawText =
    `$ lzy verify run ${checkId}（argv: ${JSON.stringify(recipe.argv)} · cwd: ${recipe.cwd} · timeoutMs: ${timeoutMs}）\n` +
    `$ startedAt: ${startedAt} · endedAt: ${endedAt}\n` +
    `--- stdout ---\n${r.stdout ?? ""}\n--- stderr ---\n${r.stderr ?? ""}\n` +
    `--- exit ---\n${r.error ? `error: ${r.error.message}` : r.signal ? `signal: ${r.signal}（超时击杀）` : `code: ${r.status}`}\n`;
  writeFileSync(rawAbs, rawText, { mode: 0o600 });
  const artifacts = [{ path: rawRel.split("\\").join("/"), sha256: sha256File(rawAbs) }];
  for (const o of recipe.outputs ?? []) {
    const abs = resolve(recipeCwd, o);
    if (existsSync(abs)) artifacts.push({ path: o.split("\\").join("/"), sha256: sha256File(abs) });
  }
  const exit = r.error
    ? { error: r.error.message }
    : r.signal
      ? { timeout: true, signal: r.signal }
      : { code: r.status };
  const receipt = {
    schemaVersion: VERIFY_VERSION,
    kind: "run",
    slug: goal.slug,
    runId,
    checkId,
    acceptanceIds: [...new Set(accepts)],
    contractHash: goal.contract?.hash ?? null,
    candidate: candidateIdentity(cwd),
    recipe: { id: recipe.id, argv: recipe.argv, cwd: recipe.cwd ?? ".", timeoutMs, manifestHash: loaded.hash },
    inputSnapshot: inputSnapshot(cwd, recipe.inputPaths ?? []),
    envFingerprint: envFingerprint(recipe.env ?? []),
    startedAt,
    endedAt,
    exit,
    artifacts,
    summary: note,
    baseRunId: null,
  };
  const p = writeReceipt(cwd, receipt);
  return { receipt, receiptPath: relative(cwd, p), rawRel };
}

// 回执读面（show）：fail-closed 单读 + 「非现行」对照（记录身份 vs 现行候选）——身份不符
// 如实标注，不冒充现行（主方案 §4.2「复用保留原执行时间与原观察事实」的读面侧）。
export function showReceipt(cwd, runId) {
  for (const rcpt of listReceipts(cwd)) {
    if (rcpt.runId === runId) {
      const now = candidateIdentity(cwd);
      const current = rcpt.candidate.compositeFingerprint !== null && rcpt.candidate.compositeFingerprint === now.compositeFingerprint;
      return { receipt: rcpt, current, nowCandidate: now };
    }
  }
  throw new VerifyError(`runId 不在案：${runId}——lzy verify list 枚举在案回执`);
}

// ── 范围档（0.3.0 M2，ADR-0025）：四问复用判定 + qualification 对抗资格活体 ───────────
// 复用四问全过才放行；任一不过=保守回退（缺清单配方恒全树档）。回执只追加：reuse 是
// 追加适用性判定的新回执，永不改写 base（保留原时点原观察事实）。

function sameSnapshot(a, b) {
  if (a === null || b === null) return a === b;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

// 四问判定（不落盘，判定面）：(i) 配方有非空 inputPaths；(ii) 同 checkId 且同 manifestHash
// 的 qualification 在案；(iii) 现算输入快照与 base 回执快照一致；(iv) 清单哈希与环境指纹未变。
export function judgeReuse(cwd, checkId, baseRunId) {
  const reasons = [];
  const loaded = loadProjectManifest(cwd);
  if (!loaded) return { ok: false, reasons: ["项目清单缺席——无受验证范围可言，保守回退全树档"] };
  const recipe = loaded.manifest.capabilities.check.find((r) => r.id === checkId) ?? null;
  if (!recipe) return { ok: false, reasons: [`checkId「${checkId}」不在现行清单 check 类——保守回退全树档`] };
  if (!Array.isArray(recipe.inputPaths) || recipe.inputPaths.length === 0) {
    return { ok: false, reasons: ["配方无 inputPaths（无已验证输入清单）——恒全树档，不冒充范围资格"] };
  }
  let base = null;
  for (const rcpt of listReceipts(cwd)) {
    if (rcpt.runId === baseRunId) base = rcpt;
  }
  if (!base || base.kind !== "run" || base.checkId !== checkId) {
    reasons.push(`base 回执 ${baseRunId} 不在案或非同 checkId 的 run 回执`);
  }
  if (base && base.recipe.manifestHash !== loaded.hash) {
    reasons.push("清单自 base 执行后已变更（manifestHash 不符）——配方身份变化，旧回执适用性重估");
  }
  if (base && base.inputSnapshot === null) {
    reasons.push("base 回执无输入快照（执行于范围档启用前）——不可复用");
  }
  const quals = listReceipts(cwd).filter(
    (rcpt) => rcpt.kind === "qualification" && rcpt.checkId === checkId && rcpt.recipe.manifestHash === loaded.hash,
  );
  if (quals.length === 0) {
    reasons.push(`无同 checkId+manifestHash 的 qualification 资格回执——先 lzy verify qualify ${checkId}`);
  }
  let nowSnap = null;
  if (base && base.inputSnapshot !== null && base.recipe.manifestHash === loaded.hash) {
    nowSnap = inputSnapshot(cwd, recipe.inputPaths);
    if (!sameSnapshot(nowSnap, base.inputSnapshot)) {
      const changed = Object.keys({ ...base.inputSnapshot, ...nowSnap }).filter((k) => base.inputSnapshot[k] !== nowSnap[k]);
      reasons.push(`声明输入变化：${changed.slice(0, 5).join(", ")}${changed.length > 5 ? ` 等 ${changed.length} 项` : ""}——重验`);
    }
  }
  if (base && base.recipe.manifestHash === loaded.hash && !sameSnapshot(envFingerprint(recipe.env ?? []), base.envFingerprint)) {
    reasons.push("环境指纹变化（platform/node/TZ/名单变量）——环境变化无法解释即回退（ADR-0025）");
  }
  return reasons.length === 0
    ? { ok: true, reasons: ["(i) inputPaths 非空", `(ii) qualification 在案×${quals.length}`, "(iii) 输入快照一致", "(iv) 清单哈希与环境指纹未变"], nowSnapshot: nowSnap, recipe, base }
    : { ok: false, reasons, recipe, base };
}

// 显式复用（kind=reuse）：判定过→追加适用性判定回执（保留 base 原时点/退出/工件引用）；
// 判不过→保守回退（返回 ok:false 与回退原因，调用方指路 verify run 重验）。
export function reuseRun(cwd, checkId, baseRunId, { accepts = [], note = null } = {}) {
  const goal = readGoal(cwd);
  if (!goal) throw new VerifyError(`无活跃目标：verify reuse 需 executing 目标承载 slug/契约——先 lzy loop register`);
  const judgment = judgeReuse(cwd, checkId, baseRunId);
  if (!judgment.ok) return { ok: false, reasons: judgment.reasons };
  const base = judgment.base;
  const runId = newRunId();
  const receipt = {
    schemaVersion: VERIFY_VERSION,
    kind: "reuse",
    slug: goal.slug,
    runId,
    checkId,
    acceptanceIds: [...new Set(accepts)],
    contractHash: goal.contract?.hash ?? null,
    candidate: candidateIdentity(cwd),
    recipe: base.recipe,
    inputSnapshot: judgment.nowSnapshot,
    envFingerprint: base.envFingerprint,
    startedAt: base.startedAt,
    endedAt: base.endedAt,
    exit: base.exit,
    artifacts: base.artifacts,
    summary: note,
    baseRunId,
    reuseJudgment: {
      judgedAt: new Date().toISOString(),
      reasons: judgment.reasons,
      qualificationRunId: listReceipts(cwd).find(
        (rcpt) => rcpt.kind === "qualification" && rcpt.checkId === checkId,
      )?.runId ?? null,
    },
  };
  const p = writeReceipt(cwd, receipt);
  return { ok: true, receipt, receiptPath: relative(cwd, p) };
}

// qualification 对抗资格活体（kind=qualification）：对每条声明输入注入变更并验证检测——
// 文件条目=真实改一字节后快照必变；目录条目=注入未知新文件后快照必含。全部检测通过且
// 原样恢复（逐文件 sha256 复核）才落资格回执；任一未检测/未恢复=fail-closed 拒（不留资格）。
// 注入一次一条、即改即恢复；恢复失败尽力回滚后仍拒——资格宁缺毋滥（ADR-0025 保守回退语义）。
export function qualifyCheck(cwd, checkId, { note = null } = {}) {
  const goal = readGoal(cwd);
  if (!goal) throw new VerifyError(`无活跃目标：verify qualify 需 executing 目标承载 slug/契约——先 lzy loop register`);
  const loaded = loadProjectManifest(cwd);
  if (!loaded) throw new VerifyError(`项目清单缺席：无配方可资格化——lzy project discover 看缺失面`);
  const recipe = findCheckRecipe(loaded.manifest, checkId);
  if (!Array.isArray(recipe.inputPaths) || recipe.inputPaths.length === 0) {
    throw new VerifyError(`配方「${checkId}」无 inputPaths——无清单配方恒全树档，无资格可立`);
  }
  const baseline = runCheck(cwd, checkId, { note: "qualification 基线（真实执行）" });
  if (baseline.receipt.exit.code !== 0) {
    throw new VerifyError(`qualification 基线执行失败（exit=${JSON.stringify(baseline.receipt.exit)}）——检查不通过的配方不授资格`);
  }
  const injections = [];
  const restoreQueue = [];
  const cleanup = () => {
    for (const undo of restoreQueue.reverse()) {
      try {
        undo();
      } catch {}
    }
  };
  try {
    for (const entry of recipe.inputPaths) {
      const abs = resolve(cwd, entry);
      const st = statSync(abs, { throwIfNoEntry: false });
      if (!st) throw new VerifyError(`inputPaths 条目缺失，无法资格化：「${entry}」`);
      if (st.isDirectory()) {
        const probe = join(abs, `.lzy-qualify-probe-${Math.random().toString(36).slice(2, 8)}`);
        const before = inputSnapshot(cwd, [entry]);
        writeFileSync(probe, "qualification probe\n", { mode: 0o600 });
        restoreQueue.push(() => rmSync(probe, { force: true }));
        const after = inputSnapshot(cwd, [entry]);
        const detected = Object.keys(after).some((k) => !(k in before));
        injections.push({ entry, mode: "unknown-new-file", detected, originalSha: null });
      } else {
        const original = readFileSync(abs);
        const originalSha = createHash("sha256").update(original).digest("hex");
        const before = inputSnapshot(cwd, [entry]);
        writeFileSync(abs, Buffer.concat([original, Buffer.from(" ")]));
        restoreQueue.push(() => writeFileSync(abs, original));
        const after = inputSnapshot(cwd, [entry]);
        const detected = !sameSnapshot(before, after);
        injections.push({ entry, mode: "mutate-file", detected, originalSha });
      }
    }
    // 恢复并逐条复核：目录无探针残留；文件条目 sha256 与注入前逐字节一致
    cleanup();
    restoreQueue.length = 0;
    for (const inj of injections) {
      const abs = resolve(cwd, inj.entry);
      const st = statSync(abs, { throwIfNoEntry: false });
      if (st?.isDirectory()) {
        const residue = readdirSync(abs).filter((n) => n.startsWith(".lzy-qualify-probe-"));
        if (residue.length > 0) throw new VerifyError(`qualification 恢复复核失败：目录残留探针 ${residue.join(", ")}——拒绝授资格`);
      } else if (!st) {
        throw new VerifyError(`qualification 恢复复核失败：文件条目消失「${inj.entry}」——拒绝授资格`);
      } else if (inj.originalSha !== null && sha256File(abs) !== inj.originalSha) {
        throw new VerifyError(`qualification 恢复复核失败：「${inj.entry}」字节与注入前不一致——拒绝授资格`);
      }
    }
    for (const inj of injections) {
      if (!inj.detected) {
        throw new VerifyError(
          `qualification 未通过：条目「${inj.entry}」（${inj.mode}）注入变更未被快照检测——检测器不可信，拒绝授资格（已原样恢复）`,
        );
      }
    }
  } catch (err) {
    cleanup();
    throw err;
  }
  for (const inj of injections) inj.restored = true;
  const runId = newRunId();
  const receipt = {
    schemaVersion: VERIFY_VERSION,
    kind: "qualification",
    slug: goal.slug,
    runId,
    checkId,
    acceptanceIds: [],
    contractHash: goal.contract?.hash ?? null,
    candidate: candidateIdentity(cwd),
    recipe: { id: recipe.id, argv: recipe.argv, cwd: recipe.cwd ?? ".", timeoutMs: recipe.timeoutMs ?? DEFAULT_TIMEOUT_MS, manifestHash: loaded.hash },
    inputSnapshot: baseline.receipt.inputSnapshot,
    envFingerprint: baseline.receipt.envFingerprint,
    startedAt: baseline.receipt.startedAt,
    endedAt: new Date().toISOString(),
    exit: { qualification: "passed", injections: injections.length },
    artifacts: baseline.receipt.artifacts,
    summary: note,
    baseRunId: baseline.receipt.runId,
    injections,
  };
  const p = writeReceipt(cwd, receipt);
  return { receipt, receiptPath: relative(cwd, p), baselineRunId: baseline.receipt.runId };
}
