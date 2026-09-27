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
import { join } from "node:path";
import { loadFamilyFile, saveFamilyFile } from "./queue.js";

export const FINDINGS_VERSION = 1;
export const FINDING_STATUSES = [
  "open",
  "resolve-requested",
  "closed-fixed",
  "closed-falsified",
  "diagnosis-required",
];
export const CLOSURE_OUTCOMES = ["fixed", "falsified"];
// 终态（关闭）；非终态（open/resolve-requested/diagnosis-required）都是「阻塞在场」。
export const CLOSED_FINDING_STATUSES = ["closed-fixed", "closed-falsified"];
export const DIAGNOSIS_REQUIRED_THRESHOLD = 2;
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
  if (e.closure !== null && (typeof e.closure !== "object" || Array.isArray(e.closure))) {
    bad("closure 须为对象或 null");
  }
  if (e.diagnosis !== null && (typeof e.diagnosis !== "object" || Array.isArray(e.diagnosis))) {
    bad("diagnosis 须为对象或 null");
  }
  if (!Array.isArray(e.history)) bad("history 须为数组");
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
  return loadFamilyFile(findingsPath(cwd, slug), {
    versionKey: "schemaVersion",
    version: FINDINGS_VERSION,
    label: "发现账本",
    shapeFn: assertFindingsShape,
  });
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
// diagnosis-required 都是「阻塞在场」）。
export function openBlockingFindings(cwd, slug) {
  return listFindings(cwd, slug, { includeClosed: false });
}

// ── 状态机 ──

// 运行落账（N2 接线）：blocking 发现 upsert。返回逐条处置读数供运行档 note 与对账报文消费。
export function recordFindingSightings(cwd, slug, { runId, attempt, at, findings }) {
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
        status: "open",
        firstSeen: seen,
        lastSeen: seen,
        occurrences: 1,
        invalidFixCount: 0,
        resolveRequest: null,
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
// recheck 证据由调用方（cli/review 层读运行档）传入，这里做机械校验——valid 且不再报该指纹。
export function closeFinding(cwd, slug, fingerprint, { outcome, basis, recheck, at } = {}) {
  assertSlug(slug);
  if (!CLOSURE_OUTCOMES.includes(outcome)) {
    throw new FindingsError(`close outcome 非法：${JSON.stringify(outcome ?? null)}（fixed|falsified）`);
  }
  if (typeof basis !== "string" || !basis.trim()) {
    throw new FindingsError("close 须带 --basis（修复依据/证伪依据必填——无依据关闭=手工关闭通道，不允许）");
  }
  if (!recheck || typeof recheck !== "object" || typeof recheck.runId !== "string" || !recheck.runId) {
    throw new FindingsError("close 须带 recheck 运行引用（{runId,valid,dutyId,reportedFingerprints}）");
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
  if (e.resolveRequest?.at && typeof recheck.at === "string" && recheck.at <= e.resolveRequest.at) {
    throw new FindingsError(`recheck 运行时序不符：不晚于修复声称（${e.resolveRequest.at}）——独立复核须发生在声称之后`);
  }
  if (e.status !== "resolve-requested") {
    throw new FindingsError(`状态机拒绝：${e.status} 态不受理 close（关闭通道=resolve-request → review recheck → close）`);
  }
  if (Array.isArray(recheck.reportedFingerprints) && recheck.reportedFingerprints.includes(fingerprint)) {
    throw new FindingsError(`recheck 运行仍报该发现（${recheck.runId}）——不能关闭；修复未生效则该轮记无效修复`);
  }
  const stamp = at ?? new Date().toISOString();
  e.status = `closed-${outcome}`;
  e.closure = { outcome, basis: basis.trim(), recheckRunId: recheck.runId, at: stamp };
  appendHistory(e, { at: stamp, kind: `closed-${outcome}`, runId: recheck.runId, note: basis.trim() });
  saveFindingsFile(cwd, rec);
  return { fingerprint, status: e.status, closure: e.closure };
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
export function relinkFindings(cwd, fromSlug, toSlug, { at } = {}) {
  assertSlug(fromSlug, "relink --from");
  assertSlug(toSlug, "relink --to");
  if (fromSlug === toSlug) throw new FindingsError("relink 自指：--from 与 --to 相同");
  const rec = loadOrCreate(cwd, toSlug);
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
