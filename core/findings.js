// 发现账本家族（0.4.0 M3，ADR-0031 §4.2 + 发布矩阵 V06/V07；docs/plan-v040-engineering-policy.md §8-M3）。
// 位阶同 policy/review：loop/ 外、reset 不清；每 goal slug 一档 <slug>.json。族容器走 queue.js
// loadFamilyFile/saveFamilyFile 家法（原子写 0600+校验和+版本+形状闸 fail-closed）。
// 关闭通道唯一性（V06）：阻塞发现只能经 resolve-request（声称）→ review recheck（同职责新独立
// 会话、不注入旧结论）不再报该指纹后 close（fixed|falsified 二选一、basis 必填、recheck 引用校验）
// 关闭——本模块只认账与状态机，运行记录的读取与校验在 cli/review 层（依赖方向：本模块不 import
// review.js，防环）。重复根因（V12）：连续 DIAGNOSIS_REQUIRED_THRESHOLD 次无效修复翻
// diagnosis-required，diagnose 记录根因重置计数后方可再入关闭通道。relink 别名链（V06 别名变化）：
// 查询面按 slug 的别名闭包并集读，别名只增不改——历史不改写。
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadFamilyFile, saveFamilyFile } from "./queue.js";

export const FINDINGS_VERSION = 1;
export const FINDING_STATUSES = [
  "open",
  "resolve-requested",
  "contested",
  "closed-fixed",
  "closed-falsified",
  "diagnosis-required",
];
export const CLOSURE_OUTCOMES = ["fixed", "falsified"];
// 终态（关闭）；非终态（open/resolve-requested/diagnosis-required）都是「阻塞在场」。
export const CLOSED_FINDING_STATUSES = ["closed-fixed", "closed-falsified"];
// 本族专用恢复指路（自审 r5-F5 收口）：未关闭阻塞发现是放行依据（V06），不沿用队列族
// 的「删除只损失记账」口径。
export const FINDINGS_RECOVERY =
  "恢复：本家族在 loop/ 外、reset 不触及；未关闭阻塞发现是统一门放行依据（V06），删除/破坏不解除阻塞只破坏可判性——先备份再人工核对该文件";
export const DIAGNOSIS_REQUIRED_THRESHOLD = 2;
// 底线职责 id 本地副本（与 review.js BASELINE_DUTY_TABLE 同字面量；findings.js 不反向依赖
// review.js 防环——两侧注释互指，改动须同批，单源纪律家法）。
const BASELINE_DUTY_ID_LOCAL = "review.general-correctness";
// slug 即文件名成分——路径穿越面在账本入口钉死（relink --from 的入参不走 goal.json，须自证清白）。
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const HEX64 = /^[0-9a-f]{64}$/;

export class FindingsError extends Error {}

function assertSlug(slug, what = "slug") {
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
    throw new FindingsError(`${what} 非法（须为文件名安全 slug）：${JSON.stringify(slug ?? null)}`);
  }
}

// ── 路径 ──

export function findingsDir(cwd) {
  return join(cwd, ".lazyzcode", "findings");
}
export function findingsPath(cwd, slug) {
  assertSlug(slug);
  return join(findingsDir(cwd), `${slug}.json`);
}

// ── 稳定身份（V06 重跑/改名不洗）：指纹=内容哈希，与 runId/attempt 无关 ──

function normalizePart(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}
export function findingFingerprint({ severity, title, location }) {
  const basis = `${normalizePart(severity)}|${normalizePart(title)}|${normalizePart(location)}`;
  return createHash("sha256").update(basis).digest("hex");
}

// ── 形状闸（只做机械自洽；策略性判定归统一门 findings 子句——形状闸不复制政策）──

function assertSighting(s, what, p) {
  const bad = (m) => {
    throw new FindingsError(`发现账本形状非法：${what}${m}：${p}`);
  };
  if (!s || typeof s !== "object" || Array.isArray(s)) bad(" sighting 须为对象");
  if (typeof s.runId !== "string" || !s.runId) bad(" runId 缺席");
  if (!Number.isInteger(s.attempt) || s.attempt < 1) bad(" attempt 须为 ≥1 整数");
  if (typeof s.at !== "string" || !s.at) bad(" at 缺席");
}

function assertFindingEntry(fp, e, p) {
  const bad = (m) => {
    throw new FindingsError(`发现账本形状非法：发现 ${fp.slice(0, 8)} ${m}：${p}`);
  };
  if (!HEX64.test(fp)) bad(`指纹须为 64 hex（实得 ${JSON.stringify(fp)}）`);
  if (!e || typeof e !== "object" || Array.isArray(e)) bad("须为对象");
  if (!FINDING_STATUSES.includes(e.status)) bad(`状态非法：${JSON.stringify(e.status ?? null)}`);
  for (const k of ["severity", "title", "location"]) {
    if (typeof e[k] !== "string" || !e[k]) bad(`${k} 缺席或空`);
  }
  assertSighting(e.firstSeen, "firstSeen", p);
  assertSighting(e.lastSeen, "lastSeen", p);
  if (!Number.isInteger(e.occurrences) || e.occurrences < 1) bad("occurrences 须为 ≥1 整数");
  if (!Number.isInteger(e.invalidFixCount) || e.invalidFixCount < 0) bad("invalidFixCount 须为 ≥0 整数");
  if (e.resolveRequest !== null && (typeof e.resolveRequest !== "object" || Array.isArray(e.resolveRequest))) {
    bad("resolveRequest 须为对象或 null");
  }
  // 异议原语（决策 #44，2026-10-01 grill）：contested 态的异议记录（{at,groundsPath,
  // groundsSha256,note?}）——旧账无此键=读侧兼容（duty 键同款范式，:102）。
  if (e.contest !== undefined && e.contest !== null && (typeof e.contest !== "object" || Array.isArray(e.contest))) {
    bad("contest 须为对象或 null");
  }
  if (e.closure !== null && (typeof e.closure !== "object" || Array.isArray(e.closure))) {
    bad("closure 须为对象或 null");
  }
  if (e.diagnosis !== null && (typeof e.diagnosis !== "object" || Array.isArray(e.diagnosis))) {
    bad("diagnosis 须为对象或 null");
  }
  if (!Array.isArray(e.history)) bad("history 须为数组");
  if (e.duty !== undefined && (typeof e.duty !== "string" || !e.duty)) bad("duty 须为非空字符串（M4 拍板 13 入账面；旧账无此键=读侧兼容）");
  if (CLOSED_FINDING_STATUSES.includes(e.status) && !e.closure) {
    bad(`closed 态缺 closure`);
  }
}

export function assertFindingsShape(rec, p) {
  const bad = (m) => {
    throw new FindingsError(`发现账本形状非法：${m}：${p}`);
  };
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) bad("记录须为对象");
  assertSlug(rec.slug, "记录 slug");
  if (!Array.isArray(rec.aliases)) bad("aliases 须为数组");
  for (const a of rec.aliases) assertSlug(a, "别名");
  if (new Set(rec.aliases).size !== rec.aliases.length) bad("aliases 有重复");
  if (!rec.findings || typeof rec.findings !== "object" || Array.isArray(rec.findings)) bad("findings 须为对象映射");
  for (const [fp, e] of Object.entries(rec.findings)) assertFindingEntry(fp, e, p);
}

export function loadFindingsFile(cwd, slug) {
  try {
    return loadFamilyFile(findingsPath(cwd, slug), {
      versionKey: "schemaVersion",
      version: FINDINGS_VERSION,
      label: "发现账本",
      shapeFn: assertFindingsShape,
    });
  } catch (err) {
    if (err instanceof FindingsError) throw err;
    // 家族容器错误（QueueError）换本族恢复指路重抛——口径对齐放行依据语义（r5-F5）。
    throw new FindingsError(`${String(err?.message ?? err).split("。恢复：")[0]}。${FINDINGS_RECOVERY}`);
  }
}

function saveFindingsFile(cwd, payload) {
  saveFamilyFile(findingsPath(cwd, payload.slug), payload, {
    versionKey: "schemaVersion",
    version: FINDINGS_VERSION,
    label: "发现账本",
    shapeFn: assertFindingsShape,
  });
}

function emptyRecord(slug) {
  return { slug, aliases: [], findings: {} };
}

function loadOrCreate(cwd, slug) {
  return loadFindingsFile(cwd, slug) ?? emptyRecord(slug);
}

function appendHistory(entry, row) {
  entry.history.push({ at: row.at ?? new Date().toISOString(), kind: row.kind, ...(row.runId ? { runId: row.runId } : {}), ...(row.attempt != null ? { attempt: row.attempt } : {}), ...(row.note ? { note: row.note } : {}) });
}

// ── 别名闭包（V06 别名变化后同链可读）：slug 自身 + 传递别名，visited 防环；
// 沿途任一档损坏→fail-closed 抛出（与 doctor checkFindings 同口径）。缺席档跳过。──

export function resolveFindingsScope(cwd, slug) {
  assertSlug(slug);
  const out = [];
  const visited = new Set();
  const queue = [slug];
  while (queue.length > 0) {
    const s = queue.shift();
    if (visited.has(s)) continue;
    visited.add(s);
    out.push(s);
    const rec = loadFindingsFile(cwd, s);
    if (rec) for (const a of rec.aliases) if (!visited.has(a)) queue.push(a);
  }
  return out;
}

// ── 别名家族（双向闭包；closeFinding 的 recheck slug 轴用，收口自审 a3.r1 F-2）：
// slug 自身+别名闭包 ∪ 把闭包成员挂为别名的账。relink 只在现行账记 aliases（旧账不知道新名），
// 单向 closure 从旧账侧够不到现行 slug——反向扫描补齐。闭包内档损坏 fail-closed 抛出
// （与 resolveFindingsScope 同口径）；家族外档读侧失败跳过（无成员关系可证，跳过=如实读）。──
function findingsSlugFamily(cwd, slug) {
  const family = new Set(resolveFindingsScope(cwd, slug));
  let names = [];
  try {
    names = readdirSync(findingsDir(cwd));
  } catch {
    names = [];
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const s = name.slice(0, -".json".length);
    if (family.has(s)) continue;
    let rec = null;
    try {
      rec = loadFindingsFile(cwd, s);
    } catch {
      continue;
    }
    if (rec && Array.isArray(rec.aliases) && rec.aliases.some((a) => family.has(a))) family.add(s);
  }
  return [...family];
}

// 跨作用域并集读：每条目带 originSlug；closed 是否含入由调用方定。
export function listFindings(cwd, slug, { includeClosed = true } = {}) {
  const out = [];
  for (const s of resolveFindingsScope(cwd, slug)) {
    const rec = loadFindingsFile(cwd, s);
    if (!rec) continue;
    for (const [fp, e] of Object.entries(rec.findings)) {
      if (!includeClosed && CLOSED_FINDING_STATUSES.includes(e.status)) continue;
      out.push({ originSlug: s, fingerprint: fp, ...e });
    }
  }
  out.sort((a, b) => (a.lastSeen.at < b.lastSeen.at ? -1 : a.lastSeen.at > b.lastSeen.at ? 1 : 0));
  return out;
}

// 统一门 findings 子句（N5）的数据面：未关闭=非 closed 终态（open/resolve-requested/
// contested/diagnosis-required 都是「阻塞在场」——异议不解除阻塞，只换对话通道）。
export function openBlockingFindings(cwd, slug) {
  return listFindings(cwd, slug, { includeClosed: false });
}

// ── 状态机 ──

// 运行落账（N2 接线）：blocking 发现 upsert。返回逐条处置读数供运行档 note 与对账报文消费。
// M4 N6 拍板 13：发现档增 duty 字段（首次 sighting 的运行职责=来源职责，close 同职责复核
// 校验的锚）；旧账无此键=读侧兼容，回退底线职责判。
export function recordFindingSightings(cwd, slug, { runId, attempt, at, dutyId, findings }) {
  assertSlug(slug);
  if (!Array.isArray(findings)) throw new FindingsError("sightings.findings 须为数组");
  const rec = loadOrCreate(cwd, slug);
  const disposition = [];
  for (const f of findings) {
    const severity = normalizePart(f.severity);
    const title = normalizePart(f.title);
    const location = normalizePart(f.location);
    if (!severity || !title) throw new FindingsError(`落账发现缺 severity/title：runId=${runId}`);
    const fp = findingFingerprint({ severity, title, location });
    const seen = { runId, attempt, at };
    let e = rec.findings[fp];
    if (!e) {
      e = rec.findings[fp] = {
        severity,
        title,
        location,
        duty: typeof dutyId === "string" && dutyId ? dutyId : undefined,
        status: "open",
        firstSeen: seen,
        lastSeen: seen,
        occurrences: 1,
        invalidFixCount: 0,
        resolveRequest: null,
        contest: null,
        closure: null,
        diagnosis: null,
        history: [],
      };
      appendHistory(e, { at, kind: "seen", runId, attempt });
      disposition.push({ fingerprint: fp, severity, title, action: "created", status: e.status });
      continue;
    }
    e.occurrences += 1;
    e.lastSeen = seen;
    if (CLOSED_FINDING_STATUSES.includes(e.status)) {
      // 已关闭发现再现=回归（新事实）：开新周期，旧 closure 留 history 不改写。
      e.status = "open";
      e.closure = null;
      e.invalidFixCount = 0;
      e.resolveRequest = null;
      e.contest = null;
      appendHistory(e, { at, kind: "regression", runId, attempt });
      disposition.push({ fingerprint: fp, severity, title, action: "regression", status: e.status });
      continue;
    }
    if (e.status === "resolve-requested") {
      // 声称修复后再现=无效修复一记（recheck 与常规运行同判——独立复核只是关闭的前置，
      // 不是无效判定的独占通道）。
      e.invalidFixCount += 1;
      e.resolveRequest = null;
      if (e.invalidFixCount >= DIAGNOSIS_REQUIRED_THRESHOLD) {
        e.status = "diagnosis-required";
        appendHistory(e, { at, kind: "diagnosis-required", runId, attempt, note: `连续 ${e.invalidFixCount} 次无效修复` });
      } else {
        e.status = "open";
        appendHistory(e, { at, kind: "invalid-fix", runId, attempt, note: `无效修复 ${e.invalidFixCount}/${DIAGNOSIS_REQUIRED_THRESHOLD}` });
      }
      disposition.push({ fingerprint: fp, severity, title, action: "invalid-fix", status: e.status, invalidFixCount: e.invalidFixCount });
      continue;
    }
    disposition.push({ fingerprint: fp, severity, title, action: "seen", status: e.status });
  }
  saveFindingsFile(cwd, rec);
  return disposition;
}

// contest（异议原语，决策 #44，2026-10-01 grill 四象限拍板）：唯一入态 open→contested。
// 语义=实现者声明「此发现不应成立」并附书面异议书（grounds 文件 sha256 入档），**不改代码、
// 非修复声称**——区别于 resolve-request（声称修复）。堵语义洞：closed-falsified 终态旧仅自
// resolve-requested 可达，异议被迫先假装声称修复污染审计面。contested 是「阻塞在场」态
// （未关闭、统一门照拦）；被新评审运行再 sighting 时走 seen 分支状态保持。FINDINGS_VERSION
// 保持 1（additive 不 bump——contest 键旧账读侧兼容）。
export function contestFinding(cwd, slug, fingerprint, { groundsPath, note, at } = {}) {
  assertSlug(slug);
  if (typeof groundsPath !== "string" || !groundsPath.trim()) {
    throw new FindingsError("contest 须带 --grounds <文件>（书面异议书必填——无异议书的 contested=空口宣称，不允许）");
  }
  const abs = resolve(cwd, groundsPath.trim());
  let buf;
  try {
    buf = readFileSync(abs);
  } catch (err) {
    throw new FindingsError(`异议书不可读（${err?.code ?? err?.message ?? err}）：${abs}`);
  }
  const rec = loadFindingsFile(cwd, slug);
  if (!rec?.findings[fingerprint]) throw new FindingsError(`发现不在账：${slug} ${fingerprint.slice(0, 8)}`);
  const e = rec.findings[fingerprint];
  // contested 态受理重新提交（0.5.0 M0 评审 F-1 修复）：复判前置拒（缺席/漂移/超长）的
  // 恢复指路「重新提交异议」必须可达——否则发现卡死 contested 并永久阻塞统一门。
  // re-contest 以新文书整体置换 contest 记录（新路径+新 sha256），历史只追加。
  if (e.status !== "open" && e.status !== "contested") {
    throw new FindingsError(`状态机拒绝：${e.status} 态不受理 contest（open 可提异议；contested 可重新提交异议书；修复声称走 resolve-request，关闭态走 reopen）`);
  }
  const stamp = at ?? new Date().toISOString();
  const recontested = e.status === "contested";
  e.status = "contested";
  e.contest = {
    at: stamp,
    groundsPath: abs,
    groundsSha256: createHash("sha256").update(buf).digest("hex"),
    ...(note ? { note } : {}),
  };
  appendHistory(e, { at: stamp, kind: "contested", note: `${recontested ? "重新提交异议书" : "异议书"} ${abs}（sha256 ${e.contest.groundsSha256.slice(0, 12)}…）` });
  saveFindingsFile(cwd, rec);
  return { fingerprint, status: e.status, contest: e.contest };
}

// adjudicate（异议复判，决策 #44）：唯一出态 contested → closed-falsified（异议成立=发现
// 被证伪）| open（异议驳回=维持）。复判引用=review recheck 运行档且带 contestedOf 标记
// （决策 #44；指向本指纹）——同职责同代次校验沿 closeFinding 家法；时序须晚于异议声明。
// upheld=true 须复核不再报该指纹（与 close 同判）；upheld=false 须复核仍报（驳回的实证）。
// 驳回后 status 回 open（contest 记录保留=最新异议在案，历史只追加）。
export function adjudicateContest(cwd, slug, fingerprint, { upheld, basis, recheck, at, expectedAttempt } = {}) {
  assertSlug(slug);
  if (typeof upheld !== "boolean") {
    throw new FindingsError("adjudicate 须带 --upheld|--rejected（异议成立=发现证伪 / 驳回=维持 open）");
  }
  if (typeof basis !== "string" || !basis.trim()) {
    throw new FindingsError("adjudicate 须带 --basis（复判依据必填）");
  }
  if (!recheck || typeof recheck !== "object" || typeof recheck.runId !== "string" || !recheck.runId) {
    throw new FindingsError("adjudicate 须带 recheck 运行引用（{runId,valid,slug,attempt,dutyId,reportedFingerprints,contestedOf}）");
  }
  if (recheck.valid !== true) {
    throw new FindingsError(`recheck 运行非 valid，不能作复判依据：${recheck.runId}`);
  }
  if (recheck.isRecheck !== true) {
    throw new FindingsError(`recheck 引用非复核运行：${recheck.runId}（须 lzy review recheck 产出）`);
  }
  if (recheck.contestedOf !== fingerprint) {
    throw new FindingsError(`recheck 运行非本发现异议复判：contestedOf=${recheck.contestedOf ?? "null"} ≠ ${fingerprint.slice(0, 8)}（须 lzy review recheck --contested ${fingerprint.slice(0, 8)} 产出）`);
  }
  if (!Array.isArray(recheck.reportedFingerprints)) {
    throw new FindingsError("recheck 引用缺 reportedFingerprints 数组（fail-closed——无法核对「仍报」面）");
  }
  const rec = loadFindingsFile(cwd, slug);
  if (!rec?.findings[fingerprint]) throw new FindingsError(`发现不在账：${slug} ${fingerprint.slice(0, 8)}`);
  const e = rec.findings[fingerprint];
  if (e.status !== "contested") {
    throw new FindingsError(`状态机拒绝：${e.status} 态不受理 adjudicate（仅 contested 态）`);
  }
  if (!e.contest) {
    throw new FindingsError("contested 态缺 contest 记录（账本形状与状态不自洽）——先备份再人工核对");
  }
  if (recheck.slug !== null && recheck.slug !== undefined && !findingsSlugFamily(cwd, slug).includes(recheck.slug)) {
    throw new FindingsError(`recheck 运行代次不符：run slug=${recheck.slug} ∉ 账本 ${slug} 的别名家族`);
  }
  // 同代次校验沿 closeFinding（M4 F-3）：跨 attempt 的复核不得裁决本代次异议。
  if (expectedAttempt != null && recheck.attempt !== null && recheck.attempt !== undefined && Number(recheck.attempt) !== Number(expectedAttempt)) {
    throw new FindingsError(`recheck 运行代次不符：attempt ${recheck.attempt} ≠ 目标 attempt ${expectedAttempt}——跨代次复判须重走（lzy review recheck --contested）`);
  }
  const expectedDuty = typeof e.duty === "string" && e.duty ? e.duty : BASELINE_DUTY_ID_LOCAL;
  if (typeof recheck.dutyId === "string" && recheck.dutyId && recheck.dutyId !== expectedDuty) {
    throw new FindingsError(`recheck 运行职责不符：${recheck.dutyId} ≠ 发现来源职责 ${expectedDuty}（同职责复核——异议复判依赖原发现职责模板）`);
  }
  if (typeof recheck.at === "string" && recheck.at <= e.contest.at) {
    throw new FindingsError(`recheck 运行时序不符：不晚于异议声明（${e.contest.at}）——复判须发生在异议之后`);
  }
  const stamp = at ?? new Date().toISOString();
  if (upheld) {
    if (recheck.reportedFingerprints.includes(fingerprint)) {
      throw new FindingsError(`复判运行仍报该发现（${recheck.runId}）——异议不能裁成立（发现仍被独立复核证实在场）`);
    }
    e.status = "closed-falsified";
    e.closure = { outcome: "falsified", basis: basis.trim(), recheckRunId: recheck.runId, at: stamp, contested: true };
    appendHistory(e, { at: stamp, kind: "contest-upheld", runId: recheck.runId, note: basis.trim() });
  } else {
    if (!recheck.reportedFingerprints.includes(fingerprint)) {
      throw new FindingsError(`复判运行不再报该发现（${recheck.runId}）——异议不能裁驳回（发现已被独立复核证伪，应 --upheld）`);
    }
    e.status = "open";
    appendHistory(e, { at: stamp, kind: "contest-rejected", runId: recheck.runId, note: basis.trim() });
  }
  saveFindingsFile(cwd, rec);
  return { fingerprint, status: e.status, closure: e.closure ?? null };
}

// resolve-request（声称修复）：唯一入态 open→resolve-requested；diagnosis-required 态拒绝（V12）。
export function requestResolve(cwd, slug, fingerprint, { note, at } = {}) {
  assertSlug(slug);
  const rec = loadFindingsFile(cwd, slug);
  if (!rec?.findings[fingerprint]) throw new FindingsError(`发现不在账：${slug} ${fingerprint.slice(0, 8)}`);
  const e = rec.findings[fingerprint];
  if (e.status === "diagnosis-required") {
    throw new FindingsError(`diagnosis-required：连续 ${e.invalidFixCount} 次无效修复——先 lzy finding diagnose ${fingerprint.slice(0, 8)} 记录根因，方可再入关闭通道`);
  }
  if (e.status !== "open") {
    throw new FindingsError(`状态机拒绝：${e.status} 态不受理 resolve-request（仅 open 态可声称修复）`);
  }
  e.status = "resolve-requested";
  e.resolveRequest = { at: at ?? new Date().toISOString(), ...(note ? { note } : {}) };
  appendHistory(e, { at: e.resolveRequest.at, kind: "resolve-requested", note });
  saveFindingsFile(cwd, rec);
  return { fingerprint, status: e.status };
}

// close（独立复核关闭，V06 唯一通道）：resolve-requested → closed-fixed|closed-falsified。
// recheck 证据由调用方（cli/review 层读运行档）传入事实字段，这里做机械校验——valid ∧
// 不再报该指纹 ∧ 同目标代次（slug+attempt，M4 F-3）∧ 同职责（发现来源 duty，M4 拍板 13；
// 旧账无 duty 键回退底线职责）。
export function closeFinding(cwd, slug, fingerprint, { outcome, basis, recheck, at, expectedAttempt } = {}) {
  assertSlug(slug);
  if (!CLOSURE_OUTCOMES.includes(outcome)) {
    throw new FindingsError(`close outcome 非法：${JSON.stringify(outcome ?? null)}（fixed|falsified）`);
  }
  if (typeof basis !== "string" || !basis.trim()) {
    throw new FindingsError("close 须带 --basis（修复依据/证伪依据必填——无依据关闭=手工关闭通道，不允许）");
  }
  if (!recheck || typeof recheck !== "object" || typeof recheck.runId !== "string" || !recheck.runId) {
    throw new FindingsError("close 须带 recheck 运行引用（{runId,valid,slug,attempt,dutyId,reportedFingerprints}）");
  }
  if (recheck.valid !== true) {
    throw new FindingsError(`recheck 运行非 valid，不能作关闭依据：${recheck.runId}`);
  }
  if (recheck.isRecheck !== true) {
    throw new FindingsError(`recheck 引用非复核运行：${recheck.runId}（须 lzy review recheck 产出——常规运行不构成独立复核，V06）`);
  }
  const rec = loadFindingsFile(cwd, slug);
  if (!rec?.findings[fingerprint]) throw new FindingsError(`发现不在账：${slug} ${fingerprint.slice(0, 8)}`);
  const e = rec.findings[fingerprint];
  // M4 F-3：recheck 引用补绑目标代次——跨 slug/attempt 的在案 valid 运行不得冒充本发现复核。
  // 收口自审修正（a3.r1 F-2）：slug 轴按别名家族判（relink 改名后复核运行恒记现行 slug，
  // 严格相等会把旧账发现的关闭通道永久堵死、gate 修复指路不可执行）——家族={slug 别名闭包}
  // ∪{把闭包成员挂为别名的账}（findingsSlugFamily）。
  if (recheck.slug !== null && recheck.slug !== undefined && !findingsSlugFamily(cwd, slug).includes(recheck.slug)) {
    throw new FindingsError(`recheck 运行代次不符：run slug=${recheck.slug} ∉ 账本 ${slug} 的别名家族——close 只认同家族代次的独立复核`);
  }
  if (expectedAttempt != null && recheck.attempt !== null && recheck.attempt !== undefined && Number(recheck.attempt) !== Number(expectedAttempt)) {
    throw new FindingsError(`recheck 运行代次不符：attempt ${recheck.attempt} ≠ 目标 attempt ${expectedAttempt}——跨代次复核须重走（lzy review recheck）`);
  }
  // M4 拍板 13：同职责复核语义（发现来源 duty ↔ recheck 运行 duty）；旧账无 duty 键回退底线。
  const expectedDuty = typeof e.duty === "string" && e.duty ? e.duty : BASELINE_DUTY_ID_LOCAL;
  if (typeof recheck.dutyId === "string" && recheck.dutyId && recheck.dutyId !== expectedDuty) {
    throw new FindingsError(`recheck 运行职责不符：${recheck.dutyId} ≠ 发现来源职责 ${expectedDuty}（V06 同职责复核——专项发现的复现依赖其职责模板）`);
  }
  if (e.resolveRequest?.at && typeof recheck.at === "string" && recheck.at <= e.resolveRequest.at) {
    throw new FindingsError(`recheck 运行时序不符：不晚于修复声称（${e.resolveRequest.at}）——独立复核须发生在声称之后`);
  }
  if (e.status !== "resolve-requested") {
    throw new FindingsError(`状态机拒绝：${e.status} 态不受理 close（关闭通道=resolve-request → review recheck → close）`);
  }
  if (!Array.isArray(recheck.reportedFingerprints)) {
    throw new FindingsError("recheck 引用缺 reportedFingerprints 数组（fail-closed——无法核对「仍报」面）");
  }
  if (recheck.reportedFingerprints.includes(fingerprint)) {
    throw new FindingsError(`recheck 运行仍报该发现（${recheck.runId}）——不能关闭；修复未生效则该轮记无效修复`);
  }
  const stamp = at ?? new Date().toISOString();
  e.status = `closed-${outcome}`;
  e.closure = { outcome, basis: basis.trim(), recheckRunId: recheck.runId, at: stamp };
  appendHistory(e, { at: stamp, kind: `closed-${outcome}`, runId: recheck.runId, note: basis.trim() });
  saveFindingsFile(cwd, rec);
  return { fingerprint, status: e.status, closure: e.closure };
}

// reopen（0.4.0 M4 N3，拍板 8）：closed-fixed|closed-falsified → resolve-requested 的受控
// 转换——关闭依据随候选失效（closure-basis-stale，gate findings 子句数据面）后重入复核通道
// 的唯一出口。closure 字段保留（「曾关闭」历史事实不灭，plan §5.5）；resolveRequest 以重开
// 时点重建（close 的 recheck 时序校验由此重新起算）；事件只追加。余态拒（未关闭发现走既有
// 通道：open→resolve-request；diagnosis-required→diagnose）。
export function reopenFinding(cwd, slug, fingerprint, { reason, at } = {}) {
  assertSlug(slug);
  const rec = loadFindingsFile(cwd, slug);
  if (!rec?.findings[fingerprint]) throw new FindingsError(`发现不在账：${slug} ${fingerprint.slice(0, 8)}`);
  const e = rec.findings[fingerprint];
  if (!CLOSED_FINDING_STATUSES.includes(e.status)) {
    throw new FindingsError(`状态机拒绝：${e.status} 态不受理 reopen（仅 closed-fixed|closed-falsified——未关闭发现走既有通道）`);
  }
  const stamp = at ?? new Date().toISOString();
  const why = typeof reason === "string" && reason.trim() ? reason.trim() : "closure-basis-stale（关闭依据随候选失效——重走独立复核）";
  const reopenedFrom = e.status;
  e.status = "resolve-requested";
  e.resolveRequest = { at: stamp, note: why };
  appendHistory(e, { at: stamp, kind: "reopen", note: why });
  saveFindingsFile(cwd, rec);
  return { fingerprint, status: e.status, reopenedFrom };
}

// diagnose（V12 唯一出口）：diagnosis-required → open，根因入账、invalidFixCount 重置。
export function diagnoseFinding(cwd, slug, fingerprint, { rootCause, at } = {}) {
  assertSlug(slug);
  if (typeof rootCause !== "string" || !rootCause.trim()) {
    throw new FindingsError("diagnose 须带 --root-cause（重复根因诊断必填）");
  }
  const rec = loadFindingsFile(cwd, slug);
  if (!rec?.findings[fingerprint]) throw new FindingsError(`发现不在账：${slug} ${fingerprint.slice(0, 8)}`);
  const e = rec.findings[fingerprint];
  if (e.status !== "diagnosis-required") {
    throw new FindingsError(`状态机拒绝：${e.status} 态不受理 diagnose（仅 diagnosis-required 态）`);
  }
  const stamp = at ?? new Date().toISOString();
  e.status = "open";
  e.invalidFixCount = 0;
  e.diagnosis = { rootCause: rootCause.trim(), at: stamp };
  appendHistory(e, { at: stamp, kind: "diagnosed", note: rootCause.trim() });
  saveFindingsFile(cwd, rec);
  return { fingerprint, status: e.status };
}

// relink（V06 别名变化）：to 的账本记 from 别名，查询面闭包并集——不搬记录、不改历史。
// M4 F-4 方向校验（时间序版）：别名恒挂在 to 账上、查询走 to 的闭包——若两账都在案且
// to 账的最后活动明显早于 from 账，则请求方向反了（把查询位放到旧账上，较新的发现反而
// 不可达）。单边无账/空账不触发（改名后新账尚未落发现的合法流不受累）。
export function relinkFindings(cwd, fromSlug, toSlug, { at } = {}) {
  void at;
  assertSlug(fromSlug, "relink --from");
  assertSlug(toSlug, "relink --to");
  if (fromSlug === toSlug) throw new FindingsError("relink 自指：--from 与 --to 相同");
  const toRec = loadFindingsFile(cwd, toSlug);
  const fromRec = loadFindingsFile(cwd, fromSlug);
  if (toRec && fromRec && Object.keys(toRec.findings).length > 0 && Object.keys(fromRec.findings).length > 0) {
    const latest = (r) => Math.max(...Object.values(r.findings).map((e) => Date.parse(e.lastSeen?.at ?? "") || 0));
    if (latest(toRec) < latest(fromRec)) {
      throw new FindingsError(`relink 方向拒：--to ${toSlug} 账的最后活动早于 --from ${fromSlug} 账——别名须挂到较新（现行）账上（F-4 反挂=单向盲区）。正形：lzy finding relink --from ${toSlug} --to ${fromSlug}`);
    }
  }
  const rec = toRec ?? emptyRecord(toSlug);
  if (rec.aliases.includes(fromSlug)) {
    return { slug: toSlug, aliases: rec.aliases, changed: false };
  }
  // 环防护：from 的闭包已含 to 时不得再挂（会造 A→B→A 死环）。
  const fromScope = resolveFindingsScope(cwd, fromSlug);
  if (fromScope.includes(toSlug)) {
    throw new FindingsError(`relink 拒绝：--from ${fromSlug} 的别名闭包已含 ${toSlug}（会成环）`);
  }
  rec.aliases.push(fromSlug);
  saveFindingsFile(cwd, rec);
  return { slug: toSlug, aliases: rec.aliases, changed: true };
}
