// 需求契约与授权账本（0.3.0 M1，ADR-0024）：人批准「需求+验收+授权边界」（不可变
// contractHash），代理在边界内自主维护执行计划。契约 = 宿主树内 markdown 文件，行首
// 结构键（task/endpoint/scope/recipe/budget-ref/non-goals）+ A 前缀验收项；哈希 =
// 文件原始字节 sha256（与 planHash 同族）。授权账本 `.lazyzcode/authorizations/`
// 追加式逐记录 JSON（在 loop/ 外，reset 不清，镜像 approvals/ 家族）；唯一写入口 =
// trigger.js UPS 钩子（自包含 inline 写，本仓缓存布局不含 core/，钩子不 import 本模块——
// 记录形状由 test/contract-gate.contract.test.js 两侧同钉）。读面 fail-closed：单条记录
// 损坏即拒（跳过会让损坏的 withdrawal 隐藏撤回、越权放行——比 approvals 的 skip 严，
// 威胁差异见 docs/spikes/v030-m1-report.md §5）。本模块零 spawn、全部同步。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { createHash } from "node:crypto";

export const AUTHORIZATION_VERSION = 1;
export const AUTHORIZATION_KINDS = new Set(["approval", "withdrawal"]);
export const CONTRACT_ENDPOINTS = new Set(["A", "B", "C"]);
const HEADER_KEYS = new Set(["task", "endpoint", "scope", "recipe", "budget-ref", "non-goals"]);
const HEADER_RE = /^([A-Za-z][A-Za-z-]*):\s*(.*)$/;
const A_ITEM_RE = /^-\s*\[A(\d+)\]\s*(.+)$/;
const HASH8_RE = /^[0-9a-f]{8}$/;
const FULL_HASH_RE = /^[0-9a-f]{64}$/;

export class ContractError extends Error {}

export function hashContractBytes(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// 读契约文件并算哈希：字节面哈希在解析之前——哈希身份 = 文件原文，与解析规则解耦。
export function readContractFile(absPath) {
  let buf;
  try {
    buf = readFileSync(absPath);
  } catch (err) {
    throw new ContractError(`契约文件不可读（${err?.code ?? err?.message ?? err}）：${absPath}`);
  }
  return { bytes: buf, hash: hashContractBytes(buf), text: buf.toString("utf8") };
}

// 解析契约：头部结构键只认文件顶部的前导块（空行/结构键行；首个其他行起视为正文，
// 防正文散文误吞）；单值键重复=拒（错字早暴露）；scope 可重复、宿主根相对或绝对、
// 须存在；recipe = 8hex 或 none；验收项 A+数字、稳定 id、重复拒、至少 1 条。
export function parseContract(text, hostRoot) {
  const lines = text.split(/\r?\n/);
  const header = { task: null, endpoint: null, recipe: null, budgetRef: null, nonGoals: null, scope: [] };
  const seen = new Set();
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const m = HEADER_RE.exec(line);
    if (!m) break;
    const key = m[1].toLowerCase();
    if (!HEADER_KEYS.has(key)) {
      throw new ContractError(`契约结构键不认识：${m[1]}（合法键：task/endpoint/scope/recipe/budget-ref/non-goals；结构键只认文件顶部前导块）`);
    }
    if (key !== "scope" && seen.has(key)) {
      throw new ContractError(`契约结构键重复：${key}（单值键只允许出现一次）`);
    }
    seen.add(key);
    const value = m[2].trim();
    if (key === "task") header.task = value;
    else if (key === "endpoint") header.endpoint = value.toUpperCase();
    else if (key === "scope") header.scope.push(value);
    else if (key === "recipe") header.recipe = value.toLowerCase();
    else if (key === "budget-ref") header.budgetRef = value;
    else if (key === "non-goals") header.nonGoals = value;
  }
  for (const k of ["task", "endpoint"]) {
    if (!header[k]) throw new ContractError(`契约缺必填结构键：${k}`);
  }
  if (!CONTRACT_ENDPOINTS.has(header.endpoint)) {
    throw new ContractError(`契约 endpoint 非法：${header.endpoint}（合法：A|B|C——A 可合并变更 / B 合并主干 / C 上线验证）`);
  }
  if (header.scope.length === 0) {
    throw new ContractError(`契约缺必填结构键：scope（至少一条允许写入根路径）`);
  }
  const scope = header.scope.map((raw) => {
    const abs = isAbsolute(raw) ? resolve(raw) : resolve(join(hostRoot, raw));
    if (!existsSync(abs)) {
      throw new ContractError(`契约 scope 路径不存在：${raw}（解析为 ${abs}）`);
    }
    return abs;
  });
  if (header.recipe != null && header.recipe !== "none" && !HASH8_RE.test(header.recipe)) {
    throw new ContractError(`契约 recipe 非法：${header.recipe}（合法：none 或 lzy.project.json 内容 sha256 前 8 位）`);
  }
  const acceptances = [];
  const ids = new Set();
  for (; i < lines.length; i++) {
    const m = A_ITEM_RE.exec(lines[i]);
    if (!m) continue;
    const id = `A${m[1]}`;
    if (ids.has(id)) throw new ContractError(`契约验收项 id 重复：${id}`);
    ids.add(id);
    acceptances.push({ id, text: m[2].trim() });
  }
  if (acceptances.length === 0) {
    throw new ContractError(`契约无验收项（至少一条 A 项；格式：方括号 A+数字开头行）`);
  }
  return {
    task: header.task,
    endpoint: header.endpoint,
    scope,
    scopeRaw: header.scope,
    recipe: header.recipe ?? "none",
    budgetRef: header.budgetRef,
    nonGoals: header.nonGoals,
    acceptances,
  };
}

// 读+解析一步：调用方拿 hash 与 goal.contract.hash 比对（漂移检测在闸不在读）。
export function loadContract(contractPath, hostRoot) {
  const abs = isAbsolute(contractPath) ? resolve(contractPath) : resolve(join(hostRoot, contractPath));
  const { hash, text } = readContractFile(abs);
  return { ...parseContract(text, hostRoot), path: abs, hash };
}

function authorizationsDir(cwd) {
  return join(cwd, ".lazyzcode", "authorizations");
}

function assertRecordShape(rec, source, { relaxedVersion = false } = {}) {
  const versionOk = relaxedVersion ? (rec?.version === undefined || rec.version === AUTHORIZATION_VERSION) : rec?.version === AUTHORIZATION_VERSION;
  if (
    !rec ||
    typeof rec !== "object" ||
    !versionOk ||
    !AUTHORIZATION_KINDS.has(rec.kind) ||
    typeof rec.slug !== "string" ||
    !rec.slug ||
    typeof rec.contractHash !== "string" ||
    !FULL_HASH_RE.test(rec.contractHash) ||
    typeof rec.at !== "string" ||
    Number.isNaN(Date.parse(rec.at)) ||
    typeof rec.sessionId !== "string" ||
    !rec.sessionId
  ) {
    throw new ContractError(
      `授权账本记录形状畸形（须 {version:1, kind: approval|withdrawal, slug, contractHash(64hex), at(ISO), sessionId}）：${source}。` +
        `恢复：先人工核对该记录（谁写的/何时），确认是残缺残留后把该文件移出 authorizations/ 目录留档，再重跑当前命令`,
    );
  }
}

// 读授权账本：目录缺席（仅 ENOENT）=空；其余读失败/单条解析失败/形状畸形一律拒
// （fail-closed——跳过损坏记录会让 withdrawal 被隐藏、撤回后越权放行）。
export function loadAuthorizations(cwd) {
  const dir = authorizationsDir(cwd);
  let names;
  try {
    names = readdirSync(dir);
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw new ContractError(`授权账本目录不可读（${err?.code ?? err?.message ?? err}）：${dir}`);
  }
  const records = [];
  for (const name of names.sort()) {
    if (name.endsWith(".tmp") || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (!statSync(p).isFile()) continue;
    let obj;
    try {
      obj = JSON.parse(readFileSync(p, "utf8"));
    } catch {
      throw new ContractError(`授权账本记录损坏（JSON 解析失败）：${p}。恢复：人工核对该记录，确认残留后移出留档再重跑`);
    }
    assertRecordShape(obj, p);
    records.push({ ...obj, file: name });
  }
  return records;
}

// 生效判定：该 (slug, contractHash) 存在 approval 且其后无 withdrawal（追加式后到者赢；
// 时序 = at ISO 主键、文件名次键——同名秒内按文件名字典序，确定性成立）。
export function effectiveAuthorization(cwd, slug, contractHash) {
  const events = loadAuthorizations(cwd)
    .filter((r) => r.slug === slug && r.contractHash === contractHash)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  let effective = null;
  for (const e of events) effective = e;
  return {
    authorized: effective?.kind === "approval",
    lastEvent: effective ? { kind: effective.kind, at: effective.at, file: effective.file } : null,
    events: events.map((e) => ({ kind: e.kind, at: e.at, file: e.file })),
  };
}

// 追加一条授权记录（原子 tmp+rename 0600，文件名带时戳序）。唯一常规写者是 UPS 钩子
// （自包含 inline 同形实现）；本函数供测试与未来受信写者复用，CLI 不暴露写命令。
export function recordAuthorization(cwd, record) {
  // 写路径宽入（version 缺失即盖章）、读路径严检——防「写时宽松、读时自拒」的毒化账本。
  assertRecordShape(record, "recordAuthorization(incoming)", { relaxedVersion: true });
  const dir = authorizationsDir(cwd);
  mkdirSync(dir, { recursive: true });
  const safeSid = record.sessionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 24);
  const name = `${record.kind}-${record.contractHash.slice(0, 8)}-${safeSid}-${Date.now()}.json`;
  const p = join(dir, name);
  const tmp = join(dir, `.${name}.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify({ ...record, version: AUTHORIZATION_VERSION }, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, p);
  return p;
}
