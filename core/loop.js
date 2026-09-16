// 目标循环（goal loop）状态机：注册目标 → 计划门（决策完备）→ 逐步派发 →
// 证据验证（F 项绑定 tree hash，代码一变旧证据作废）→ 完成。
// 状态落工作区 .lazyzcode/loop/goal.json（与宿主 .zcode/ 划清边界，宪法 §4 决策 #6）。
// 本模块零 spawn（tree hash 经 core/git.js 取），全部同步语义。
import { copyFileSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { createGit } from "./git.js";
import { packageRoot } from "./paths.js";
import {
  addCapturedOn,
  addEdge,
  addSupersedes,
  appendEvidenceNode,
  appendPlanNode,
  appendReviewNode,
  findGreenByGeneration,
  findLatestComparator,
  findLatestGreen,
  loadDag,
  pairReds,
  saveDag,
} from "./dag.js";

export const GOAL_VERSION = 1;
const ACTIVE_STATES = new Set(["planning", "executing"]);

// --note / --evidence 入账上限（评审 R2-9）
export const NOTE_MAX = 300;
export const EVIDENCE_MAX = 4000;
// 证据附件上限：单 F 项 ≤4 个文件、单个 ≤20MB（截图/响应转储足够；防手滑塞巨物）
export const EVIDENCE_FILES_MAX = 4;
export const EVIDENCE_FILE_MAX_BYTES = 20 * 1024 * 1024;
// rebind 历史上限：取证历史 append-only 留审计，超出丢最旧（plan-v2 Phase 2-1）
export const EVIDENCE_HISTORY_MAX = 5;

export class LoopError extends Error {}

function loopDir(cwd) {
  return join(cwd, ".lazyzcode", "loop");
}

export function goalPath(cwd) {
  return join(loopDir(cwd), "goal.json");
}

export function readGoal(cwd) {
  let goal;
  try {
    goal = JSON.parse(readFileSync(goalPath(cwd), "utf8"));
  } catch {
    return null;
  }
  // 版本快败：schema 不符的状态文件会在远离成因处被误读（评审 R2-10）。
  if (goal && typeof goal === "object" && goal.version !== GOAL_VERSION) {
    throw new LoopError(
      `goal 状态文件版本不兼容（盘上 v${goal.version}，本 lzy 期望 v${GOAL_VERSION}）；` +
        `lzy loop reset 清除后重新注册`,
    );
  }
  return goal;
}

function writeGoal(cwd, goal) {
  const p = goalPath(cwd);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = join(dirname(p), `.${basename(p)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(goal, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, p);
}

// ── 跨进程互斥：goal.json 的 read-modify-write 必须串行，后写覆盖会丢步骤（评审 R2-5）──
const LOCK_STALE_MS = 10_000; // 持锁者死亡（进程被杀）后锁可抢
const LOCK_WAIT_MS = 5_000;

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// 导出给 attest.js 复用（attest.js → loop.js 单向依赖；锁原语单源不另造）。
export function withLock(cwd, fn) {
  const lock = join(loopDir(cwd), ".lock");
  mkdirSync(loopDir(cwd), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(lock); // mkdir 原子性：同刻只有一个进程能建成
      break;
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;
      let ageMs = 0;
      try {
        ageMs = Date.now() - statSync(join(lock, "owner.json")).mtimeMs;
      } catch {
        ageMs = 0; // owner 还没写完 = 刚加的锁，继续等
      }
      if (ageMs > LOCK_STALE_MS) {
        rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new LoopError(
          "目标循环被另一进程持锁（等待超时）。确认没有并发 lzy 后可删除 .lazyzcode/loop/.lock",
        );
      }
      sleepMs(50);
    }
  }
  try {
    writeFileSync(
      join(lock, "owner.json"),
      `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`,
      { mode: 0o600 },
    );
    return fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

// 恢复式报错（ADR-0006 严格就地语义）：无 goal 的全部出口共用同一文案源——报出实际检查的
// 绝对路径 + 一行恢复指引（目录解析不 walk-up，走错目录时人需要知道该回哪个根）。
export function noGoalMessage(cwd) {
  return (
    `本目录没有目标循环状态（已检查 ${loopDir(cwd)}）。` +
    `恢复：在注册了目标的工作区根重跑此命令；多仓目标回宿主工作区根；新建用 lzy loop register <slug> --title …`
  );
}

// 写命令 fail-fast（ADR-0006）：withLock 的 mkdirSync 会在没有 goal 的目录上留下
// .lazyzcode/loop/ 空壳疤痕，故进锁前先判空即抛（文案走 noGoalMessage 同源）。
// reset 显式豁免：null-goal 残留清理语义是契约（p3-sweep.contract.test.js 固化）。
// 导出给 attest.js 复用（attest.js → loop.js 单向依赖；守卫语义单源不另造）。
export function requireGoalPreLock(cwd) {
  if (!readGoal(cwd)) throw new LoopError(noGoalMessage(cwd));
}

// 导出给 attest.js 复用（attest.js → loop.js 单向依赖；守卫语义单源不另造）。
export function requireActive(cwd, ...states) {
  const goal = readGoal(cwd);
  if (!goal) throw new LoopError(noGoalMessage(cwd));
  // 空 states = 不限状态（abandon/reset 路径）；空数组是真值，必须按长度判。
  if (states.length > 0 && !states.includes(goal.status)) {
    throw new LoopError(
      `目标 ${goal.slug} 当前状态 ${goal.status}，此操作要求 ${states.join("/")}`,
    );
  }
  return goal;
}

export function nextStep(goal) {
  return goal.steps.find((s) => s.status === "pending") ?? null;
}

// ── 1. 注册 ────────────────────────────────────────────────────────────────
export function registerGoal(cwd, slug, title, { tier = "light" } = {}) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(slug ?? "")) {
    throw new LoopError(`slug 不合法：${slug}（仅字母数字与连字符，≤64 字符）`);
  }
  if (!title?.trim()) throw new LoopError("目标标题不能为空（--title）");
  // tier 落盘（v008#N8）：大小写归一为小写；非法值 LoopError。
  const tierNorm = typeof tier === "string" ? tier.toLowerCase() : tier;
  if (tierNorm !== "light" && tierNorm !== "heavy") {
    throw new LoopError(`tier 不合法：${tier}（light | heavy，默认 light）`);
  }
  // 查重+写入同一临界区（评审 R6A-1）：并发 register 双方 readGoal 均 null 时
  // 各自 writeGoal 原子覆盖，先注册的目标无痕丢失——唯一漏网的 goal.json 变更操作补齐入锁。
  return withLock(cwd, () => {
    const existing = readGoal(cwd);
    if (existing && ACTIVE_STATES.has(existing.status)) {
      throw new LoopError(
        `已有进行中的目标 ${existing.slug}（${existing.status}）；先 finish/abandon，或 lzy loop reset`,
      );
    }
    if (existing) {
      throw new LoopError(
        `已存在目标状态 ${existing.slug}（${existing.status}，含证据档案）；lzy loop reset 清除后再注册`,
      );
    }
    const goal = {
      version: GOAL_VERSION,
      slug,
      title: title.trim(),
      status: "planning",
      tier: tierNorm,
      planPath: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      baseTreeHash: null,
      subjects: [],
      steps: [],
    };
    writeGoal(cwd, goal);
    return goal;
  });
}

// tier 升级子命令（v008#N8）：planning/executing 可用；light→heavy 单向（反向 LoopError，
// 只升不降宪法）；大小写归一；同值=no-op。升级时 review 为空或非 PASS→warn 一行
// （warn-only 保住只升不降；机器门=采纳时点，executing 升级为程序性自报不回溯评审，
// ADR-0013 记 warn 与语义在案）。
export function setTier(cwd, value) {
  requireGoalPreLock(cwd);
  return withLock(cwd, () => {
    const goal = requireActive(cwd, "planning", "executing");
    const norm = typeof value === "string" ? value.toLowerCase() : value;
    if (norm !== "light" && norm !== "heavy") {
      throw new LoopError(`tier 不合法：${value}（用法：lzy loop tier heavy）`);
    }
    const current = goal.tier ?? "light";
    if (norm === "light" && current === "heavy") {
      throw new LoopError("tier 只升不降：heavy 目标不可降为 light（宪法 Tier 规则）");
    }
    if (norm === current) {
      return { goal, changed: false, warn: null };
    }
    goal.tier = norm;
    let warn = null;
    if (norm === "heavy") {
      const verdict = goal.review?.verdict ?? null;
      if (verdict !== "PASS") {
        warn = "本目标从未过评审门（review 为空或非 PASS）——HEAVY 机器门只在采纳时点执法，此升级为程序性自报";
      }
    }
    writeGoal(cwd, goal);
    return { goal, changed: true, warn };
  });
}

// ── 2. 计划门：解析 N/F 清单，决策完备（无待定）才放行 ────────────────────
const ITEM_RE = /^-\s*\[([NF])(\d+)\]\s*(.+)$/;
const UNDECIDED_RE = /(TBD|待定|待确认|未定|待讨论)/i;
// 依赖边声明（决策 #21 最小链，2026-09-14）：紧随条目行的下一行 `deps: N1,N2`；
// 无声明=现状零变化，旧计划文件逐字节兼容。分隔容逗号/空白/全角逗号；token 必须
// 是 N/F 条目 id。孤儿 deps 行（不紧随条目/大小写不符/重复声明）在计划门响亮拒绝，
// 不静默吞——静默丢边=比作者认知更弱的阻塞图（评审 R1-A2/R1-B3/B4/B5）；正文提及
// deps 语法的行（如教学示例）可按门豁免先例行尾加 <!--lzy:allow-->。
const DEPS_RE = /^\s*deps:\s*(.*)$/;
// 孤儿扫描容 bullet 前缀（`- deps: …` 也算声明形态——门姿势「不静默吞」对齐，评审 R2-B）。
const DEPS_ORPHAN_RE = /^\s*(?:[-*]\s+)?deps\s*:/i;
const DEP_TOKEN_RE = /^[NF]\d+$/;
// subject 集声明（v008-integrity-kernel#N3，拍板③）：计划头 `subjects: <path>` 每行一路径，
// 相对路径按宿主根解析；头内重复=LoopError；路径不存在/非 git 仓/与宿主包含=LoopError 拒采纳。
// 正文杂散 subjects: 行沿 deps orphan 家法响亮拒绝（行级 <!--lzy:allow--> 豁免同款）。
const SUBJECTS_RE = /^\s*subjects:\s*(\S+)\s*$/;
const SUBJECTS_ORPHAN_RE = /^\s*(?:[-*]\s+)?subjects\s*:/i;

function parsePlanItems(body) {
  const lines = body.split(/\r?\n/);
  const items = [];
  const consumedDeps = new Set();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(ITEM_RE);
    if (!m) continue;
    const id = `${m[1]}${m[2]}`;
    if (items.some((it) => it.id === id)) throw new LoopError(`计划清单 id 重复：${id}`);
    let deps = [];
    if (i + 1 < lines.length && DEPS_RE.test(lines[i + 1])) {
      consumedDeps.add(i + 1);
      const tokens = lines[i + 1].match(DEPS_RE)[1].split(/[\s,，]+/).filter(Boolean);
      if (tokens.length === 0) throw new LoopError(`deps 声明为空：${id}（语法：deps: N1,N2）`);
      for (const t of tokens) {
        if (!DEP_TOKEN_RE.test(t)) {
          throw new LoopError(
            `deps 条目非法：${id} → ${t}（必须是 N/F 条目 id，语法：deps: N1,N2）`,
          );
        }
      }
      deps = [...new Set(tokens)];
    }
    items.push({ id, kind: m[1], title: m[3].trim(), deps });
  }
  for (const [i, line] of lines.entries()) {
    if (consumedDeps.has(i) || line.includes("<!--lzy:allow-->")) continue;
    if (DEPS_ORPHAN_RE.test(line)) {
      throw new LoopError(
        `孤儿 deps 行（必须是其条目行的下一行）：L${i + 1}: ${line.trim().slice(0, 60)}`,
      );
    }
  }
  return items;
}

// 依赖边校验：引用存在、不自指、无环（三色 DFS；显式栈迭代——递归在 ~5000 节深链上
// 爆调用栈误拒合法计划，对抗审查 R5-A 实测）。环路径封顶展示，防千节环刷出巨幅报错。
const CYCLE_PATH_CAP = 8;

function capCyclePath(path) {
  if (path.length <= CYCLE_PATH_CAP) return path.join(" → ");
  return `${path.slice(0, CYCLE_PATH_CAP).join(" → ")} → …（共 ${path.length} 节）`;
}

function validateDeps(items) {
  const byId = new Map(items.map((it) => [it.id, it]));
  for (const it of items) {
    for (const dep of it.deps) {
      if (dep === it.id) throw new LoopError(`依赖边自指：${it.id} 依赖自己`);
      if (!byId.has(dep)) {
        throw new LoopError(
          `依赖边引用不存在的条目：${it.id} → ${dep}（现有：${items.map((x) => x.id).join(" ")}）`,
        );
      }
    }
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const state = new Map(items.map((it) => [it.id, WHITE]));
  for (const start of items) {
    if (state.get(start.id) !== WHITE) continue;
    const stack = [{ id: start.id, i: 0 }];
    state.set(start.id, GRAY);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const deps = byId.get(top.id).deps;
      if (top.i < deps.length) {
        const dep = deps[top.i];
        top.i += 1;
        const st = state.get(dep);
        if (st === GRAY) {
          const from = stack.findIndex((f) => f.id === dep);
          throw new LoopError(
            `计划依赖成环：${capCyclePath([...stack.slice(from).map((f) => f.id), dep])}`,
          );
        }
        if (st === WHITE) {
          state.set(dep, GRAY);
          stack.push({ id: dep, i: 0 });
        }
      } else {
        stack.pop();
        state.set(top.id, BLACK);
      }
    }
  }
}

// 评审判决解析：优先认 VERDICT: 记号（plan-reviewer 契约）——命中即采信，忽略评审正文里的普通用词
// （如 PASS 附言写着 revise 某行，不再误拒，评审 R2-3）；无记号回退关键词扫描保持兼容。
function parseVerdict(review) {
  const m = review.match(/\bVERDICT:\s*(PASS|REVISE)\b/i);
  if (m) return m[1].toUpperCase();
  if (/\bREVISE\b/i.test(review)) return "REVISE";
  if (/\bPASS\b/i.test(review)) return "PASS";
  return "UNVERIFIED";
}

// ── 2.5 subject 集（v008-integrity-kernel#N3）───────────────────────────────
// 校验单个 subject 根：存在目录、git 仓（HEAD 头树可解析）、与宿主无包含关系（任一向，
// 尾分隔符判定防 /foo 误配 /foobar——拍板③只认兄弟仓根，host 子目录只会复刻 host 树）。
// 返回 realpath 归一绝对路径。
function validateSubjectRoot(cwd, p) {
  const abs = resolve(cwd, p);
  let st;
  try {
    st = statSync(abs);
  } catch {
    throw new LoopError(`subject 路径不存在：${abs}`);
  }
  if (!st.isDirectory()) throw new LoopError(`subject 路径不是目录：${abs}`);
  const root = realpathSync(abs);
  const host = realpathSync(cwd);
  if (root === host) throw new LoopError(`subject 不能是宿主仓自身：${root}`);
  if (root.startsWith(host + sep) || host.startsWith(root + sep)) {
    throw new LoopError(
      `subject 与宿主仓存在包含关系（拍板③只认兄弟仓根）：subject=${root} host=${host}`,
    );
  }
  if (!createGit(root).headTreeHash()) {
    throw new LoopError(`subject 不是 git 仓库（HEAD 头树不可解析）：${root}`);
  }
  return root;
}

// 计划头 subjects: 行解析：仅首个清单项之前生效；头内重复（realpath 后）=LoopError；
// 头内形态非法（bullets/空值）与正文杂散 subjects: 行=LoopError（不静默吞家法）。
function parseSubjectsHeader(cwd, body) {
  const lines = body.split(/\r?\n/);
  const firstItem = lines.findIndex((l) => ITEM_RE.test(l));
  const headerEnd = firstItem === -1 ? lines.length : firstItem;
  const declared = [];
  for (let i = 0; i < headerEnd; i++) {
    const line = lines[i];
    if (line.includes("<!--lzy:allow-->")) continue;
    const m = line.match(SUBJECTS_RE);
    if (m) {
      declared.push(m[1]);
      continue;
    }
    if (SUBJECTS_ORPHAN_RE.test(line)) {
      throw new LoopError(
        `subjects: 头声明形态非法（语法：subjects: <path> 每行一路径，仅计划头）：L${i + 1}: ${line.trim().slice(0, 60)}`,
      );
    }
  }
  const roots = declared.map((p) => validateSubjectRoot(cwd, p));
  const seen = new Set();
  for (const root of roots) {
    if (seen.has(root)) throw new LoopError(`subjects: 头声明重复路径：${root}`);
    seen.add(root);
  }
  for (let i = headerEnd; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("<!--lzy:allow-->")) continue;
    if (SUBJECTS_ORPHAN_RE.test(line)) {
      throw new LoopError(
        `孤儿 subjects: 行（声明仅在计划头，首个清单项之前）：L${i + 1}: ${line.trim().slice(0, 60)}`,
      );
    }
  }
  return roots;
}

// 复合指纹：subject 集={host}∪roots 每根 HEAD 头树哈希，按 realpath 排序拼
// "realpath\0hash\n" 串取 sha256。任一根树变（或集合变）→ 指纹变 → 全体绑定指纹的
// F 证据过期。防御分支：subject 根消失/非 git 仓时该根以 "missing" 参与串（采纳门已拒，
// 此处兜底；finish 闸门另有 missing 分支拦「重录取证致指纹含 missing 仍 fresh」穿越）。
// host 自身非 git 仓 → 返回 null（unbound 语义，镜像 legacy `!treeHash` 谓词）。
// 缺键归一单点：roots 按 `?? []` 归一（0.0.8 前的 goal 无 subjects 键，计算面同容忍）。
export function fingerprintSubjects(cwd, roots) {
  const hostHash = createGit(cwd).headTreeHash();
  if (!hostHash) return null;
  const list = [resolve(cwd), ...(Array.isArray(roots) ? roots : [])];
  const parts = list.map((root) => {
    let rp = root;
    try {
      rp = realpathSync(root);
    } catch {
      // 根消失：按存储路径参与排序，哈希记 missing
    }
    const hash = root === resolve(cwd) ? hostHash : (createGit(root).headTreeHash() ?? "missing");
    return { rp, hash };
  });
  parts.sort((a, b) => (a.rp < b.rp ? -1 : a.rp > b.rp ? 1 : 0));
  return createHash("sha256").update(parts.map((x) => `${x.rp}\0${x.hash}\n`).join("")).digest("hex");
}

// 中途加 subject（仅 executing）：校验镜像采纳门；realpath 幂等去重。
// 语义：任何集合变化→指纹变化→全体已录 F 证据过期，重取后才可 finish。
export function addSubject(cwd, path) {
  requireGoalPreLock(cwd);
  return withLock(cwd, () => {
    const goal = requireActive(cwd, "executing");
    const root = validateSubjectRoot(cwd, path);
    const subjects = goal.subjects ?? [];
    if (subjects.includes(root)) return { goal, root, added: false };
    goal.subjects = [...subjects, root];
    writeGoal(cwd, goal);
    return { goal, root, added: true };
  });
}

// 中途移除 subject（仅 executing）：集合维护命令（评审 4 轮增补=missing 死锁出口：
// 根永久消失时 remove 是 abandon 外唯一出路）。收窄与从未声明同信任级——不违「无逃生门」
// （证据过期语义照走：移除后指纹变，全体 F 证据过期须重取）。
export function removeSubject(cwd, path) {
  requireGoalPreLock(cwd);
  return withLock(cwd, () => {
    const goal = requireActive(cwd, "executing");
    const subjects = goal.subjects ?? [];
    let rp;
    try {
      rp = realpathSync(resolve(cwd, path));
    } catch {
      rp = resolve(cwd, path); // 根已消失：按入参归一参与匹配
    }
    const idx = subjects.indexOf(rp);
    if (idx === -1) {
      throw new LoopError(`该路径不在 subject 集合：${rp}（当前集合 ${subjects.length} 项）`);
    }
    goal.subjects = subjects.filter((_, i) => i !== idx);
    writeGoal(cwd, goal);
    return { goal, root: rp };
  });
}

export function adoptPlan(cwd, planFile, opts = {}) {
  requireGoalPreLock(cwd);
  return withLock(cwd, () => doAdoptPlan(cwd, planFile, opts));
}

function doAdoptPlan(cwd, planFile, { force = false, review = null } = {}) {
  const goal = requireActive(cwd, "planning");
  // 评审门（宪法 §4 #15）：判决 REVISE = 拒绝采纳，--force 不越过（修计划重审才是正道）。
  if (review && parseVerdict(review) === "REVISE") {
    throw new LoopError(
      `计划评审未过门（plan-reviewer 判决 REVISE）。按评审意见修计划、重跑评审后再采纳；评审记录：${review.slice(0, 200)}`,
    );
  }
  // ── HEAVY 机器门（v008#N8，拍板②「无 PASS 机器拒」）：HEAVY 目标采纳必须带 PASS 评审，
  // 任意非空非 PASS 串（含 UNVERIFIED）同拒，--force 不越过；LIGHT 无评审行为不变。
  // 判据=当次 --review 的 parseVerdict（采纳时点归一），不重解析盘上 500 截断的 summary。
  if ((goal.tier ?? "light") === "heavy") {
    const verdict = review ? parseVerdict(review) : null;
    if (verdict !== "PASS") {
      throw new LoopError(
        `HEAVY 目标机器拒：无 PASS 评审不得采纳（${review ? `判决 ${verdict}` : "未带 --review"}）。` +
          `先过 plan-reviewer 评审门（VERDICT: PASS）再带 --review 采纳；--force 不越过此门。`,
      );
    }
  }
  let body;
  try {
    body = readFileSync(planFile, "utf8");
  } catch {
    throw new LoopError(`计划文件不可读：${planFile}`);
  }
  if (!force) {
    // 逐行报行号+摘录，并给行级豁免 <!--lzy:allow-->：正文提及（如「尚无定论」）不再逼人全有全无地 --force（评审 R2-7）。
    const hits = [];
    for (const [i, line] of body.split(/\r?\n/).entries()) {
      if (line.includes("<!--lzy:allow-->")) continue;
      if (UNDECIDED_RE.test(line)) hits.push(`L${i + 1}: ${line.trim().slice(0, 80)}`);
    }
    if (hits.length > 0) {
      throw new LoopError(
        `计划未决策完备（含未决标记 ${hits.length} 处）。消除标记后重跑；确要带病开工用 --force；` +
          `若某行只是正文提及而非未决事项，行尾加 <!--lzy:allow--> 豁免。\n  ${hits
            .slice(0, 5)
            .join("\n  ")}`,
      );
    }
  }
  const items = parsePlanItems(body);
  if (items.length === 0) {
    throw new LoopError("计划里没有清单项（语法：- [N1] … / - [F1] …，F 项需真实表面证据）");
  }
  validateDeps(items);
  const subjects = parseSubjectsHeader(cwd, body);
  // ── plan snapshot+hash（v008#N7）：采纳即快照计划文→.lazyzcode/loop/snapshots/<slug>.md
  // （reset 不清，照证据报告先例；目录名避开 .lazyzcode/plans/ 同形词），goal.planHash=
  // sha256(快照内容)，review 携 planHash（评审绑被评审物）。原 planPath 文件继续承载
  // 换路注记——不可变快照与可变叙事分离。复采纳纪律：planHash 变而评审未换→warn（机器
  // 不拦；红线句在 SKILL/ADR）——比对基准=存量 goal.review.summary（500 截断面）。
  const warnings = [];
  const planHash = createHash("sha256").update(body).digest("hex");
  if (goal.planHash && goal.planHash !== planHash) {
    if (!review || review === (goal.review?.summary ?? null)) {
      warnings.push(
        `复采纳：计划快照哈希已变而评审未重跑（--review 未带或与上次采纳逐字相同）——修订后的计划须重过 plan-reviewer 再采纳`,
      );
    }
  }
  goal.planPath = relative(cwd, planFile) || planFile;
  goal.subjects = subjects;
  goal.planHash = planHash;
  const verdict = review ? parseVerdict(review) : null;
  goal.review = review
    ? { by: "plan-reviewer", verdict: verdict === "PASS" ? "PASS" : "UNVERIFIED", summary: review.slice(0, 500), at: new Date().toISOString(), planHash }
    : null;
  goal.steps = items.map((it) => ({
    id: it.id,
    kind: it.kind,
    title: it.title,
    status: "pending",
    deps: it.deps,
    claim: null,
    doneAt: null,
    note: null,
    evidence: null,
  }));
  // 快照先落盘再持久 goal（写序：goal.planHash 永不指向缺席快照；快照写失败=采纳失败）。
  const snapDir = join(loopDir(cwd), "snapshots");
  mkdirSync(snapDir, { recursive: true });
  writeFileSync(join(snapDir, `${goal.slug}.md`), body);
  // 评审/采纳即注册边（v009-bat1#N4，ADR-0014）：plan+review 节点与 reviews/plans 边落
  // 中央 DAG——dag-first（账本写失败=采纳拒，goal.json 未动）。复采纳=新节点追加（账本
  // 不可变，最新节点为现役——权威切换归棒2）。
  {
    const dag = loadDag(cwd);
    const planNode = appendPlanNode(dag, { slug: goal.slug, planHash });
    addEdge(dag, { type: "plans", from: planNode.id, to: goal.slug });
    if (goal.review) {
      const reviewNode = appendReviewNode(dag, {
        planHash,
        verdict: `${goal.review.verdict} ${goal.review.summary}`.slice(0, 300),
      });
      addEdge(dag, { type: "reviews", from: reviewNode.id, to: planNode.id });
    }
    saveDag(cwd, dag);
  }
  writeGoal(cwd, goal);
  return { goal, warnings };
}

// ── 3. 开跑：planning → executing，记录基线 tree hash ──────────────────────
export function startLoop(cwd, git) {
  requireGoalPreLock(cwd);
  return withLock(cwd, () => doStartLoop(cwd, git));
}

function doStartLoop(cwd, git) {
  const goal = requireActive(cwd, "planning");
  if (goal.steps.length === 0) {
    throw new LoopError("计划门未过：先 lzy loop plan <文件> 采纳清单");
  }
  goal.status = "executing";
  goal.startedAt = new Date().toISOString();
  goal.baseTreeHash = git ? git.headTreeHash() : null;
  writeGoal(cwd, goal);
  return goal;
}

// ── 4. 逐步完成：F 项强制证据 + 绑定当时 tree hash；已完成步骤可重跑以重新取证 ──
export function completeStep(cwd, git, id, opts = {}) {
  requireGoalPreLock(cwd);
  return withLock(cwd, () => doCompleteStep(cwd, git, id, opts));
}

// 证据附件：把取证产物（截图/响应转储）复制进 .lazyzcode/evidence/ 并绑 sha256——
// 原件在 /tmp 会被清，副本让证据包自包含（.lazyzcode/ 不计工作区脏，决策 #14）。
function attachEvidenceFiles(cwd, goal, step, files, seq = 1) {
  if (!files || files.length === 0) return undefined;
  if (step.kind !== "F") {
    throw new LoopError(`附件证据仅 F 项支持（${step.id} 是 ${step.kind} 项）；N 项的完成由 note 承载`);
  }
  if (files.length > EVIDENCE_FILES_MAX) {
    throw new LoopError(`附件超上限：最多 ${EVIDENCE_FILES_MAX} 个/项（当前 ${files.length}）`);
  }
  const outDir = join(cwd, ".lazyzcode", "evidence");
  mkdirSync(outDir, { recursive: true });
  return files.map((src, i) => {
    let st;
    try {
      st = statSync(src);
    } catch {
      throw new LoopError(`证据文件不可读：${src}`);
    }
    if (!st.isFile()) throw new LoopError(`证据路径不是文件：${src}`);
    if (st.size > EVIDENCE_FILE_MAX_BYTES) {
      throw new LoopError(`证据文件超上限 ${EVIDENCE_FILE_MAX_BYTES} bytes：${src}（${st.size}）`);
    }
    const ext = (/(\.[a-z0-9]{1,9})$/i.exec(basename(src))?.[1] ?? ".bin").toLowerCase();
    // seq=取证代数（step.evidenceSeq）：重取证落新代数文件名，不再同名覆写旧附件（plan-v2 Phase 2-1）
    const dest = join(outDir, `${goal.slug}.${step.id}.${seq}.${i + 1}${ext}`);
    copyFileSync(src, dest);
    return {
      path: relative(cwd, dest),
      name: basename(src),
      sha256: createHash("sha256").update(readFileSync(dest)).digest("hex"),
      bytes: st.size,
    };
  });
}

function doCompleteStep(cwd, git, id, { note = null, evidence = null, files = null } = {}) {
  const goal = requireActive(cwd, "executing");
  const step = goal.steps.find((s) => s.id === id);
  if (!step) {
    throw new LoopError(
      `无此步骤：${id}（现有：${goal.steps.map((s) => s.id).join(" ") || "无"}）`,
    );
  }
  const rebinding = step.status === "done";
  // 长度上限：状态文件要常驻且每次 status/verify 重解析，巨串入账会让全流程变慢（评审 R2-9；
  // 上限对齐项目自身纪律——note 同 comment-checker 的 300，evidence 容忍一段 stdout 摘录）。
  const trimmedNote = note?.trim() || null;
  if (trimmedNote && trimmedNote.length > NOTE_MAX) {
    throw new LoopError(`--note 超上限 ${NOTE_MAX} 字符（当前 ${trimmedNote.length}）；请凝成一两句`);
  }
  const trimmedEvidence = evidence?.trim() ?? null;
  if (step.kind === "F") {
    if (!trimmedEvidence) {
      throw new LoopError(
        `终验项 ${id} 必须带 --evidence（真实表面取证：HTTP 返回/截图/CLI stdout；测试全绿≠证据）`,
      );
    }
    if (trimmedEvidence.length > EVIDENCE_MAX) {
      throw new LoopError(
        `--evidence 超上限 ${EVIDENCE_MAX} 字符（当前 ${trimmedEvidence.length}）；请只摘录关键输出`,
      );
    }
  }
  step.status = "done";
  step.doneAt = new Date().toISOString();
  delete step.claim; // 步级认领随收口自动释放（决策 #21：done 即自清，不留僵尸标记）
  step.note = trimmedNote ?? (rebinding ? step.note : null);
  const previousEvidence = rebinding ? step.evidence : null;
  const captureGen = step.evidenceSeq ?? 1;
  const attached = attachEvidenceFiles(cwd, goal, step, files, captureGen);
  step.evidence =
    step.kind === "F"
      ? {
          text: trimmedEvidence,
          // v008 起证据绑复合指纹（{host}∪subjects）；treeHash 字段停写，legacy 证据
          // 对象保留原字段不动（verify 双轨回退比对，行为与 0.0.7 全同）。
          fingerprint: fingerprintSubjects(cwd, goal.subjects),
          at: step.doneAt,
          ...(attached ? { files: attached } : {}),
        }
      : null;
  // rebind 痕迹：旧证据整对象入历史（append-only，审计「凭什么改口」）；代数随每次取证
  // 推进并进附件文件名——同一 F 项反复取证不再互相覆写（plan-v2 Phase 2-1）。
  if (previousEvidence) {
    step.evidenceHistory = [...(step.evidenceHistory ?? []), previousEvidence].slice(
      -EVIDENCE_HISTORY_MAX,
    );
  }
  if (step.kind === "F") step.evidenceSeq = (step.evidenceSeq ?? 1) + 1;
  // 取证即注册边（v009-bat1#N4，ADR-0014）：green 半镜像落中央 DAG——dag-first，账本写
  // 失败=整命令拒（writeGoal 未跑、goal.json 不动、重试安全）；未配对 red/waive 回填
  // red_of（多条合法、最新为现行），rebind 追加 supersedes。verify/finish 判定不读此账本
  // （统一权威切换=棒2）。
  if (step.kind === "F") {
    const dag = loadDag(cwd);
    const priorGreen = findLatestGreen(dag, goal.slug, id);
    const greenNode = appendEvidenceNode(dag, {
      slug: goal.slug,
      step: id,
      seq: captureGen,
      half: "green",
      surface: step.evidence.fingerprint
        ? { kind: "fingerprint", value: step.evidence.fingerprint }
        : null,
      text: trimmedEvidence ?? "",
      files: attached ?? [],
    });
    if (step.evidence.fingerprint) {
      addCapturedOn(dag, greenNode.id, { kind: "fingerprint", value: step.evidence.fingerprint });
    }
    if (priorGreen) addSupersedes(dag, priorGreen.id, greenNode.id);
    pairReds(dag, { slug: goal.slug, step: id, greenId: greenNode.id });
    saveDag(cwd, dag);
  }
  writeGoal(cwd, goal);
  return { goal, step, rebinding, dirty: git ? git.dirty() : false };
}

// ── 红绿机器账本（v009 棒1，ADR-0014）：red/waive-red 半的登记面 ─────────────
// 红半/waive 边只存在中央 DAG（goal.json 零改动——机器只记账不裁决，缺半不拦任何门，
// 执法仍在协议文本+comparator）。E-01 调和：red 各绑各面——--surface 显式外部表面
// （已发布版版本号等自由串），缺省=当前复合指纹（改前取证时点即 base 树）。
export function recordEvidenceHalf(cwd, git, id, { half, text = null, files = null, surfaceExternal = null } = {}) {
  return withLock(cwd, () => doRecordEvidenceHalf(cwd, git, id, { half, text, files, surfaceExternal }));
}

function doRecordEvidenceHalf(cwd, git, id, { half, text, files, surfaceExternal }) {
  const goal = requireActive(cwd, "executing");
  const step = goal.steps.find((s) => s.id === id);
  if (!step) {
    throw new LoopError(`无此步骤：${id}（现有：${goal.steps.map((s) => s.id).join(" ") || "无"}）`);
  }
  if (step.kind !== "F") {
    throw new LoopError(`红绿账本只记 F 项（${id} 是 ${step.kind} 项；红绿纪律是终验项的取证纪律）`);
  }
  const isWaive = half === "waived";
  const trimmed = text?.trim() ?? null;
  const cap = isWaive ? NOTE_MAX : EVIDENCE_MAX;
  const label = isWaive ? "--reason" : "--evidence";
  if (!trimmed) {
    throw new LoopError(
      isWaive
        ? `终验项 ${id} 的红半豁免必须带 --reason（一行豁免的机器形态：说明为何构造不出反态）`
        : `终验项 ${id} 必须带 ${label}（改前态上的失败取证：红半与绿半各绑各面）`,
    );
  }
  if (trimmed.length > cap) {
    throw new LoopError(`${label} 超上限 ${cap} 字符（当前 ${trimmed.length}）；请凝成一两句`);
  }
  let surface = null;
  if (!isWaive) {
    if (surfaceExternal) {
      surface = { kind: "external", value: surfaceExternal };
    } else {
      const fp = fingerprintSubjects(cwd, goal.subjects);
      if (!fp) {
        throw new LoopError(`无绑定表面可记（宿主非 git 仓？）；用 --surface 显式声明外部表面`);
      }
      surface = { kind: "fingerprint", value: fp };
    }
  }
  // 代数对齐绿半：红半瞄准的取证代数=绿半即将落地的同一代数（completeStep 的 captureGen
  // 同源取 step.evidenceSeq ?? 1），配对真值由 red_of 边承载、seq 只作展示。
  const seq = step.evidenceSeq ?? 1;
  const attached = attachHalfFiles(cwd, goal, step, files, seq, half);
  // dag-first：账本写失败=整命令拒（goal.json 本就不动）；附件已拷贝的残留属既有
  // 部分失败家族（与 completeStep 的 writeGoal 失败同语义，无害孤儿）。
  const dag = loadDag(cwd);
  const node = appendEvidenceNode(dag, {
    slug: goal.slug,
    step: id,
    seq,
    half,
    surface,
    text: trimmed,
    files: attached ?? [],
  });
  if (surface) addCapturedOn(dag, node.id, surface);
  saveDag(cwd, dag);
  return { node, dirty: git ? git.dirty() : false };
}

// 红半附件：与 attachEvidenceFiles 同约束，命名带 half 段（<slug>.<F>.<half>.<seq>.<n><ext>）
// ——红半与绿半瞄准同一代数，不带 half 段会互相覆写。
function attachHalfFiles(cwd, goal, step, files, seq, half) {
  if (!files || files.length === 0) return undefined;
  if (files.length > EVIDENCE_FILES_MAX) {
    throw new LoopError(`附件超上限：最多 ${EVIDENCE_FILES_MAX} 个/项（当前 ${files.length}）`);
  }
  const outDir = join(cwd, ".lazyzcode", "evidence");
  mkdirSync(outDir, { recursive: true });
  return files.map((src, i) => {
    let st;
    try {
      st = statSync(src);
    } catch {
      throw new LoopError(`证据文件不可读：${src}`);
    }
    if (!st.isFile()) throw new LoopError(`证据路径不是文件：${src}`);
    if (st.size > EVIDENCE_FILE_MAX_BYTES) {
      throw new LoopError(`证据文件超上限 ${EVIDENCE_FILE_MAX_BYTES} bytes：${src}（${st.size}）`);
    }
    const ext = (/(\.[a-z0-9]{1,9})$/i.exec(basename(src))?.[1] ?? ".bin").toLowerCase();
    const dest = join(outDir, `${goal.slug}.${step.id}.${half}.${seq}.${i + 1}${ext}`);
    copyFileSync(src, dest);
    return {
      path: relative(cwd, dest),
      name: basename(src),
      sha256: createHash("sha256").update(readFileSync(dest)).digest("hex"),
      bytes: st.size,
    };
  });
}

// ── 4b. 步级认领（决策 #21 最小链，2026-09-14）：同目标多工人占步互斥 ────────
// 匿名目录级：不记 sessionId（ADR-0009 同款立场——模型在 Bash 拿不到自己身份，任何
// 要求转抄身份的设计都在最需要的时刻制造新失败面）。互斥窗口=认领 TTL（CLAIM_TTL_MS
// 48h，与 goal 级 claimedAt 同常数）；step done 自动清；goal.json 写路径全走 withLock。

// 认领新鲜谓词：claim.at 在 TTL 内才算在场（过期=可再认领，重认领自然覆写）。
function isClaimFresh(step) {
  if (!step.claim || typeof step.claim.at !== "string") return false;
  const at = Date.parse(step.claim.at);
  return Number.isFinite(at) && Date.now() - at <= CLAIM_TTL_MS;
}

// 无阻塞谓词：deps 全 done（无 deps=恒无阻塞）。返回未完成依赖 id 列表（空=可认领）。
// 容忍旧 goal.json 无 deps 字段（additive 字段，hooks 同款容忍读法）。
function blockedBy(step, goal) {
  const deps = Array.isArray(step.deps) ? step.deps : [];
  if (deps.length === 0) return [];
  const byId = new Map(goal.steps.map((s) => [s.id, s]));
  return deps.filter((d) => byId.get(d)?.status !== "done");
}

export function claimStep(cwd, id, { release = false } = {}) {
  requireGoalPreLock(cwd);
  return withLock(cwd, () => {
    const goal = requireActive(cwd, "executing");
    const step = goal.steps.find((s) => s.id === id);
    if (!step) {
      throw new LoopError(
        `无此步骤：${id}（现有：${goal.steps.map((s) => s.id).join(" ") || "无"}）`,
      );
    }
    if (release) {
      if (!step.claim) throw new LoopError(`步骤 ${id} 当前无认领标记，无需释放`);
      delete step.claim;
      writeGoal(cwd, goal);
      return { goal, step, released: true };
    }
    if (step.status === "done") throw new LoopError(`步骤 ${id} 已完成，无需认领`);
    if (isClaimFresh(step)) {
      throw new LoopError(
        `步骤 ${id} 已被认领（${step.claim.at}，48h 内互斥）；过期后可重新认领，或 --release 释放`,
      );
    }
    const undone = blockedBy(step, goal);
    if (undone.length > 0) {
      throw new LoopError(
        `步骤 ${id} 被阻塞：依赖未完成 ${undone.join(" ")}（先收口依赖步，或认领无阻塞步）`,
      );
    }
    step.claim = { at: new Date().toISOString() };
    writeGoal(cwd, goal);
    return { goal, step, released: false };
  });
}

// 可认领集：未 done、无在场认领、无阻塞。无参 claim 与 status 读面共用。
function claimableSteps(goal) {
  return goal.steps.filter(
    (s) => s.status !== "done" && !isClaimFresh(s) && blockedBy(s, goal).length === 0,
  );
}

// 无参 claim 的读面（CLI 直调；只读但要求 executing——planning 态认领没有语义）。
export function formatClaimList(cwd) {
  const goal = readGoal(cwd);
  if (!goal) throw new LoopError(noGoalMessage(cwd));
  if (goal.status !== "executing") {
    throw new LoopError(`目标 ${goal.slug} 当前状态 ${goal.status}，步级认领仅 executing 态有语义`);
  }
  const claimable = claimableSteps(goal);
  if (claimable.length === 0) {
    return "可认领集为空（全部步骤已收口、已被认领或被依赖阻塞；释放用 lzy loop claim <id> --release）";
  }
  return (
    `可认领 ${claimable.length}：${claimable.map((s) => s.id).join(" ")}` +
    `\n${claimable.map((s) => `  ${s.id.padEnd(4)} [${s.kind}] ${s.title}`).join("\n")}` +
    `\n认领：lzy loop claim <id>（匿名互斥 48h；step done 自动释放；提前释放加 --release）`
  );
}

// ── 5. 证据时效统一权威（v009 棒2，ADR-0014）：判定读中央 DAG 账本——绿节点按
// goal.json 当前代次锚定选择（孤儿 ghost 不可现行、不阻断），节点 surface 为权威作
// 比对，hash 比对降为账本上的边型之一；无节点的 treeHash 形态记录=legacy 双轨
// （0.0.8 行为逐字段同）；fingerprint 形态而节点缺席=账本与 goal.json 分歧，
// fail-closed 拒（无逃生 flag，沿 ADR-0013 家法；恢复=rebind 重注册节点）。
export function verifyEvidence(cwd, git) {
  const goal = readGoal(cwd);
  if (!goal) throw new LoopError(noGoalMessage(cwd));
  const dag = loadDag(cwd); // DagError 原样上抛：账本不可读即拒（消息自带恢复指路）
  const current = git ? git.headTreeHash() : null;
  const fingerprint = fingerprintSubjects(cwd, goal.subjects ?? []);
  const fresh = [];
  const stale = [];
  const unbound = [];
  for (const s of goal.steps) {
    if (s.kind !== "F" || s.status !== "done") continue;
    if (s.evidence?.fingerprint) {
      // 指纹主轨（权威=账本节点）：按 goal.json 当前代次锚定绿节点——captureGen =
      // evidenceSeq-1（doCompleteStep 写后自增），缺省 1。
      const gen = s.evidenceSeq ? s.evidenceSeq - 1 : 1;
      const node = findGreenByGeneration(dag, goal.slug, s.id, gen);
      if (!node) {
        // 账本-goal 分歧：0.0.8 时代在途 goal 升级（fingerprint 形态先于 DAG）、或账本
        // 被改动——fail-closed，重取证 rebind 即重注册节点。
        throw new LoopError(
          `证据账本不一致：${s.id} 记录第 ${gen} 代绿半但中央 DAG 无对应节点` +
            `（疑 0.0.8 在途 goal 升级或账本缺改）。` +
            `恢复：在当前代码上重跑 lzy step done ${s.id} --evidence …（rebind 即重注册账本节点）。`,
        );
      }
      // subject 集任一根变化（含集合增删）即过期；host 非 git 仓=指纹 null=未绑定；
      // 节点面非指纹（null/external——正常流不产生，防御性归未绑定=强制重取证）。
      if (!fingerprint || node.surface?.kind !== "fingerprint") unbound.push(s);
      else if (node.surface.value === fingerprint) fresh.push(s);
      else stale.push(s);
    } else {
      // legacy 单树轨（0.0.7 证据对象，无账本节点）：行为与 0.0.7/0.0.8 全同。
      if (!s.evidence?.treeHash || !current) unbound.push(s);
      else if (s.evidence.treeHash === current) fresh.push(s);
      else stale.push(s);
    }
  }
  return { current, fingerprint, fresh, stale, unbound, dag };
}

// dirty 命中路径提示（multisession-discipline#N1）：前 3 条 + 超出计数。路径缺席（旧形状/
// 异常路径）时静默省略该子句——提示永不改变拒绝语义，只改变可读性。
const DIRTY_PATH_HINT_MAX = 3;

function dirtyPathHint(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return "";
  const head = paths.slice(0, DIRTY_PATH_HINT_MAX).join("、");
  const more = paths.length > DIRTY_PATH_HINT_MAX ? ` 等 ${paths.length} 处` : "";
  return `命中：${head}${more}。`;
}

// ── 6. 完成：全部步骤 done + F 项证据全部新鲜 ──────────────────────────────
export function finishLoop(cwd, git, opts = {}) {
  requireGoalPreLock(cwd);
  return withLock(cwd, () => doFinishLoop(cwd, git, opts));
}

function doFinishLoop(cwd, git, { writeReport = null } = {}) {
  const goal = requireActive(cwd, "executing");
  // 埋点（plan-v2 Phase 2-1）：finish 尝试与三分拒绝计数——veto 判定式①「finish 首过率」
  // 的数据面；incMetrics 契约永不抛，计数失败不影响拒绝/放行语义。
  incMetrics(cwd, "finish_attempts");
  const pending = goal.steps.filter((s) => s.status !== "done");
  if (pending.length > 0) {
    incMetrics(cwd, "finish_reject_pending");
    throw new LoopError(
      `未完成即停 = 半途而废：还剩 ${pending.map((s) => s.id).join(" ")}（用 lzy step done 逐项收口）`,
    );
  }
  const { current, stale, unbound, fingerprint, dag } = verifyEvidence(cwd, git);
  // 过期（代码后变，重取证即可）与未绑定（git 缺失，重取证也无济于事）必须分诊，药方不同（评审 R2-4）。
  if (stale.length > 0) {
    incMetrics(cwd, "finish_reject_stale");
    throw new LoopError(
      `证据已过期（代码在取证后变更，tree hash 对不上）：${stale.map((s) => s.id).join(" ")}。` +
        `在当前代码上重新取证后重跑 lzy step done <id> --evidence …（current=${current ?? "未知"}）`,
    );
  }
  if (unbound.length > 0) {
    incMetrics(cwd, "finish_reject_unbound");
    throw new LoopError(
      `证据未绑定 tree hash：${unbound.map((s) => s.id).join(" ")}。` +
        (current
          ? "证据缺少 tree hash，重新取证即可绑定。"
          : "本目录不是 git 仓库或还没有任何提交——先 git init 并提交，再重新取证。"),
    );
  }
  // ── 对照 attestation 机器门（v009 棒2，§⑪ N3）：HEAVY 强制现行记录且 MATCH 且指纹
  // 未过期；LIGHT 可 self-check 免录（协议层自查）。无逃生 flag（ADR-0013 家法）。
  let comparator = null;
  if ((goal.tier ?? "light") === "heavy") {
    comparator = findLatestComparator(dag, goal.slug, goal.planHash);
    if (!comparator) {
      throw new LoopError(
        `HEAVY finish 需对照 attestation 且 MATCH：先派 qa-executor 对每个 F 项断言×证据逐对对照，` +
          `再 lzy attest comparator --file <结论.json>（LIGHT 目标可 self-check 免录；机器门无逃生 flag）`,
      );
    }
    if (comparator.verdict !== "MATCH") {
      throw new LoopError(
        `对照 attestation 判决为 MISMATCH（记录 ${comparator.id}）：处置不匹配项后重新对照并重录` +
          `（lzy attest comparator --file …）`,
      );
    }
    if (comparator.fingerprint !== fingerprint) {
      throw new LoopError(
        `对照 attestation 已过期（记录 ${comparator.id} 的指纹与当前树不符——对照后代码又变了）：重新对照并重录`,
      );
    }
  }
  // ── 第四拒：完整性闸门（P0-A 闭合，v008）——{host}∪subjects 任一根 dirty/missing/git
  // 错即拒，不提供任何绕过 flag（拍板③「无逃生门」）。git spawn 逐根顺序、共享 8s 墙钟
  // 预算（< LOCK_STALE_MS 10s 留余量；单根超时/预算耗尽按 fail-closed 拒）。
  const GATE_BUDGET_MS = 8_000;
  const gateStart = Date.now();
  for (const root of [cwd, ...(goal.subjects ?? [])]) {
    const remaining = GATE_BUDGET_MS - (Date.now() - gateStart);
    let check;
    if (remaining <= 0) {
      check = { state: "error", detail: `闸门墙钟预算 ${GATE_BUDGET_MS}ms 耗尽（根 ${root} 未检）` };
    } else {
      check = createGit(root).integrity(remaining);
    }
    if (check.state === "clean") continue;
    incMetrics(cwd, "finish_reject_dirty");
    const which = root === cwd ? "host" : "subject";
    const advice =
      check.state === "dirty"
        ? `该根有未提交改动：commit 或 stash 后重跑 finish（.lazyzcode/ 账本不计该根脏；先提交再取证，未提交改动不进指纹）。${dirtyPathHint(check.paths)}杂物文件可写进 .gitignore 或移出仓库，不必为它提交；若这不是你的改动，可能是同一工作目录里另一个会话的未提交工作。`
        : check.state === "missing"
          ? `该根不存在/非 git 仓/HEAD 不可解析，不可验收：复原路径，或 lzy loop subject remove <path> 移出集合，或 lzy loop abandon。${check.detail ? `（${check.detail}）` : ""}`
          : `git 调用失败（fail-closed 按拒处理）：修复 git 后重跑 finish。原始报错：${check.detail ?? "未知"}`;
    throw new LoopError(
      `finish 完整性闸门拒绝（${check.state}）：${which} ${root}。${advice}`,
    );
  }
  // ── 原子收尾（v008#N6）：先在内存置 done/finishedAt（writer 渲染完成态，报告状态行
  // =done、formatHistory 解析不退化），writer 成功后才 writeGoal 落盘；失败→LoopError
  // （不落盘不置 done，goal 保持 executing，状态文件与报告永不互相说谎）。
  goal.status = "done";
  goal.finishedAt = new Date().toISOString();
  if (typeof writeReport === "function") {
    try {
      writeReport({ cwd, git, goal });
    } catch (e) {
      throw new LoopError(
        `证据包归档失败（finish 未置 done，状态保持 executing）：修复写入失败原因后重跑 finish（或先 lzy loop export 留档）。原始错误：${e?.message ?? e}`,
      );
    }
  }
  // ── 终验 attestation（v009 棒2，§⑪ N5）：LOOP_COMPLETE 的机器证明。写失败同报告
  // 契约（LoopError、状态保持 executing、goal.json 不落 done）。
  let attestation;
  try {
    attestation = writeFinalAttestation(cwd, git, goal, { comparator, fingerprint, dag, reportWritten: typeof writeReport === "function" });
  } catch (e) {
    throw new LoopError(
      `终验 attestation 写失败（finish 未置 done，状态保持 executing）：修复写入失败原因后重跑 finish。原始错误：${e?.message ?? e}`,
    );
  }
  writeGoal(cwd, goal);
  return { goal, attestation };
}

// 终验 attestation 落盘（纯写面，校验已在门里）：`.lazyzcode/attestations/<attemptId>.json`，
// tmp+rename 原子写。attemptId=<slug>-<finish 时刻 UTC 紧凑串（秒粒度）>——追加不覆写
// （同 slug 重注册再 finish 天然新 id）；目录在 loop/ 之外=doctor 疤痕巡逻零接触、
// reset 不清（历史证明，同 evidence/ 语义）。
function writeFinalAttestation(cwd, git, goal, { comparator, fingerprint, dag, reportWritten }) {
  const dir = join(cwd, ".lazyzcode", "attestations");
  mkdirSync(dir, { recursive: true });
  const attemptId = `${goal.slug}-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`;
  const reportRel = `.lazyzcode/evidence/${goal.slug}.report.md`;
  let reportSha = null;
  if (reportWritten) {
    try {
      reportSha = createHash("sha256").update(readFileSync(join(cwd, reportRel))).digest("hex");
    } catch {
      reportSha = null;
    }
  }
  const evidence = goal.steps
    .filter((s) => s.kind === "F" && s.status === "done")
    .map((s) => {
      const gen = s.evidenceSeq ? s.evidenceSeq - 1 : 1;
      const node = findGreenByGeneration(dag, goal.slug, s.id, gen);
      return { fid: s.id, generation: gen, nodeId: node?.id ?? null, surface: node?.surface ?? null };
    });
  const doc = {
    attemptId,
    slug: goal.slug,
    title: goal.title,
    tier: goal.tier ?? "light",
    lzyVersion: readLzyVersion(),
    planHash: goal.planHash ?? null,
    subjects: [resolve(cwd), ...(goal.subjects ?? [])].map((root) => ({
      root,
      headTreeHash: createGit(root).headTreeHash(),
    })),
    fingerprint: fingerprint ?? null,
    evidence,
    comparator: comparator
      ? { nodeId: comparator.id, verdict: comparator.verdict, fingerprint: comparator.fingerprint }
      : null,
    report: { path: reportRel, sha256: reportSha },
    finishedAt: goal.finishedAt,
  };
  const p = join(dir, `${attemptId}.json`);
  const tmp = join(dir, `.${attemptId}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, p);
  return { path: `.lazyzcode/attestations/${attemptId}.json`, attemptId };
}

function readLzyVersion() {
  try {
    return JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

// ── 7. 证据包导出：goal 的可审阅档案（评审判决/步骤注记/F 项证据+附件清单）──
// 人在接管前要快速看清「凭什么说做完了」，这就是那份材料（OmO 哲学：接管=失败信号，
// 接管时人需要证据，不是结论）。落 .lazyzcode/evidence/<slug>.report.md，reset 不清它。
// v008#N6 拆分：buildReportLines（纯渲染）+ writeReportFile（tmp 落盘+rename 原子写，
// 支持指定目标路径）+ writeGoalReport（finish 的锁内 writer 回调形态——接收内存中已置
// done 的 goal 对象渲染，不从盘上重读，报告状态行=done）。
function buildReportLines(cwd, git, goal) {
  const done = goal.steps.filter((s) => s.status === "done").length;
  const current = git ? git.headTreeHash() : null;
  const lines = [
    `# 目标循环报告：${goal.slug} — ${goal.title}`,
    "",
    `- 状态 ${goal.status} · 创建 ${goal.createdAt} · 完成 ${goal.finishedAt ?? "—"}`,
    `- 计划 ${goal.planPath ?? "未采纳"} · 评审 ${goal.review ? `${goal.review.verdict}（${goal.review.by}）` : "未评审"}`,
    `- 基线 tree ${(goal.baseTreeHash ?? "未知").slice(0, 10)} · 当前 tree ${(current ?? "未知").slice(0, 10)} · 步骤 ${done}/${goal.steps.length}`,
    "",
    "## 步骤",
  ];
  for (const s of goal.steps) {
    const mark = s.status === "done" ? "✔" : "·";
    lines.push(`- ${mark} ${s.id} [${s.kind}] ${s.title}${s.note ? ` — ${s.note}` : ""}`);
    if (s.evidence) {
      // 指纹化显示面（v008）：新证据显示指纹短码，legacy 证据维持 tree 短码（防「未绑定」回归）。
      const bind = s.evidence.fingerprint
        ? `指纹 ${s.evidence.fingerprint.slice(0, 10)}`
        : `tree ${(s.evidence.treeHash ?? "未绑定").slice(0, 10)}`;
      lines.push(`  - 证据 @ ${bind} · ${s.evidence.at}：${s.evidence.text}`);
      for (const f of s.evidence.files ?? []) {
        lines.push(`  - 附件 \`${f.path}\`（sha256 ${f.sha256.slice(0, 16)}… · ${f.bytes} bytes）`);
      }
    }
  }
  return lines;
}

function writeReportFile(cwd, goal, lines, targetPath) {
  const p = targetPath ?? join(cwd, ".lazyzcode", "evidence", `${goal.slug}.report.md`);
  mkdirSync(dirname(p), { recursive: true });
  // tmp 落盘+rename 原子写：kill -9 窗口的 .tmp 残片为无害孤儿（history 读面按
  // .report.md 后缀过滤不受扰；ADR-0013 已知边界）。
  const tmp = join(dirname(p), `.${basename(p)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, `${lines.join("\n")}\n`);
  renameSync(tmp, p);
  return { path: relative(cwd, p) };
}

// finish 的 writer 回调形态：用内存中的 goal（已置 done）渲染，不从盘上重读。
export function writeGoalReport(cwd, git, goal) {
  return writeReportFile(cwd, goal, buildReportLines(cwd, git, goal));
}

export function exportReport(cwd, git) {
  const goal = readGoal(cwd);
  if (!goal) throw new LoopError(noGoalMessage(cwd));
  if (goal.steps.length === 0) {
    throw new LoopError(`目标 ${goal.slug} 还没采纳计划，无可导出（先 lzy loop plan）`);
  }
  return writeReportFile(cwd, goal, buildReportLines(cwd, git, goal));
}

export function abandonLoop(cwd, git) {
  requireGoalPreLock(cwd);
  return withLock(cwd, () => doAbandonLoop(cwd, git));
}

function doAbandonLoop(cwd, git) {
  const goal = requireActive(cwd);
  const salvage = writeSalvageStub(cwd, goal, git, "abandon 放弃");
  goal.status = "abandoned";
  goal.finishedAt = new Date().toISOString();
  writeGoal(cwd, goal);
  return { ...goal, salvage };
}

// ── 交接放行（ADR-0009）──────────────────────────────────────────────────
// 目录级匿名标记：模型收尾前登记交接，Stop 钩子一次性原子消费后放行（不耗续跑预算）。
// 匿名性是特性不是缺陷：模型在 Bash 环境拿不到自己的 sessionId（引擎只注入 hook env），
// 任何要求模型转抄会话身份的设计都在最需要逃逸的时刻制造新的失败面（双审 P1 定案）。

export function handoffPath(cwd) {
  return join(loopDir(cwd), "handoff.json");
}

// ── 放行计数（可观测面）：registered=CLI 登记数、consumed=Stop 侧消费数。
// 目录级匿名（只有计数无会话身份，ADR-0009）；跨 reset 永续（价值在长期观测，
// cleanupLoopResidue 与疤痕巡逻均豁免它）。无锁读-合-写近似计数（≥ 语义）：多写方
// 同窗可丢增量，观测面可接受。契约：本节函数永不抛——计数失败绝不阻断登记/放行主路径。
export function metricsPath(cwd) {
  return join(loopDir(cwd), "metrics.json");
}

export function readMetrics(cwd) {
  try {
    const m = JSON.parse(readFileSync(metricsPath(cwd), "utf8"));
    if (m && typeof m === "object" && !Array.isArray(m)) return m;
  } catch {}
  return null;
}

export function incMetrics(cwd, field) {
  try {
    const m = readMetrics(cwd) ?? {};
    m[field] = (typeof m[field] === "number" && Number.isInteger(m[field]) ? m[field] : 0) + 1;
    m.updatedAt = new Date().toISOString();
    const p = metricsPath(cwd);
    mkdirSync(dirname(p), { recursive: true });
    const tmp = join(dirname(p), `.${basename(p)}.${process.pid}.${Date.now()}.tmp`);
    writeFileSync(tmp, `${JSON.stringify(m, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, p);
    return m;
  } catch {
    return null;
  }
}

// 快照新鲜度上限：没有真实快照的交接不是交接（防滥用防化石——双审 P2 对冲）。
// 2h（plan-v2 Phase 2-5）：交接标记本就期待下个 Stop 即消费，隔夜快照=化石。
export const HANDOFF_SNAPSHOT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

// 交接快照 7 字段 lint（plan-v2 Phase 2-5）：快照内容必须自含续跑全量。标题列表是契约
// 字面量——zw SKILL.md Continuation 节的模板与之逐字节一致（改一处须同步另一处）；
// 脏树清单节承载 git status --porcelain 原文（脏树继承协议，卫生规则④）。
export const HANDOFF_SNAPSHOT_SECTIONS = [
  "## 剩余步骤",
  "## 下一步动作",
  "## 目标与进度",
  "## 脏树清单",
  "## tree hash",
  "## 风险与坑",
  "## 复归指令",
];

// 内容 lint：7 节标题在场且各节至少一行非空正文（裸标题=空壳交接，与缺节同拒）。
function lintHandoffSnapshot(content) {
  const missing = [];
  for (const head of HANDOFF_SNAPSHOT_SECTIONS) {
    const at = content.indexOf(head);
    if (at < 0) {
      missing.push(head);
      continue;
    }
    const rest = content.slice(at + head.length);
    const next = rest.indexOf("\n## ");
    if (!((next < 0 ? rest : rest.slice(0, next)).trim())) missing.push(`${head}（空节）`);
  }
  return missing;
}

export function handoffGoal(cwd, snapshot, treeHash) {
  requireActive(cwd, "executing"); // planning/已完结目标上登记交接没有语义（Stop 不拉）
  if (typeof snapshot !== "string" || !snapshot.trim()) {
    throw new LoopError(
      "用法：lzy loop handoff --snapshot <快照文件>（先把交接状态写入快照，再登记交接）",
    );
  }
  const snapAbs = resolve(cwd, snapshot.trim());
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(snapAbs).mtimeMs;
  } catch {
    throw new LoopError(`交接快照不存在：${snapAbs}（先写快照再登记，拒绝空壳交接）`);
  }
  if (Date.now() - mtimeMs > HANDOFF_SNAPSHOT_MAX_AGE_MS) {
    throw new LoopError(`交接快照已过期（mtime 超过 2h）：${snapAbs}（更新快照后重新登记）`);
  }
  let content = "";
  try {
    content = readFileSync(snapAbs, "utf8");
  } catch {
    throw new LoopError(`交接快照不可读：${snapAbs}（存在但读不了，拒绝盲登记）`);
  }
  const missing = lintHandoffSnapshot(content);
  if (missing.length > 0) {
    throw new LoopError(
      `交接快照缺强制节：${missing.join("、")}。7 字段模板见 zw SKILL.md Continuation 节` +
        `（脏树清单节须内嵌 git status --porcelain 原文，干净树写（无））`,
    );
  }
  // 写入入锁（评审 R6A-3）：锁外交写与 resetLoop 锁内 cleanupLoopResidue 的 rm handoff.json
  // 交错会留孤儿标记——下一目标首个 Stop 被误放行。锁内重查 executing 保证「goal 在场」
  // 与「标记落盘」同一临界区（对 Stop 侧 unlink 消费的原子性不受影响）。
  return withLock(cwd, () => {
    requireActive(cwd, "executing");
    const marker = {
      snapshot: snapAbs,
      treeHash: typeof treeHash === "string" ? treeHash : null,
      requestedAt: new Date().toISOString(),
    };
    const p = handoffPath(cwd);
    const tmp = join(dirname(p), `.${basename(p)}.${process.pid}.${Date.now()}.tmp`);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(tmp, `${JSON.stringify(marker, null, 2)}\n`);
    renameSync(tmp, p); // 原子落盘：与 Stop 侧 unlink 消费的互斥由文件系统原子性保证
    incMetrics(cwd, "registered"); // 永不抛（契约见上）——登记不因计数失败而失败
    return marker;
  });
}

export function resetLoop(cwd, git) {
  return withLock(cwd, () => doResetLoop(cwd, git));
}

// 孤儿/残留清理（评审 R2-11）：kill -9 落在 tmp 写入与 rename 之间会留孤儿 .tmp；
// 会话计数器在 goal 清除后也成悬空状态。doctor 的状态卫生与 reset 指引共用此语义。
// tmp 家族表（v009-bat1#N2）：goal.json 之外再收中央 DAG 账本（core/dag.js saveDag
// 同一命名约定 .<basename>.<pid>.<ts>.tmp）——新增常驻账本须在此登记，否则孤儿不可清。
function cleanupLoopResidue(cwd) {
  const dir = loopDir(cwd);
  const goalName = basename(goalPath(cwd));
  const tmpFamilies = [`.${goalName}.`, ".dag.json."];
  let cleaned = 0;
  try {
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".tmp") && tmpFamilies.some((p) => f.startsWith(p))) {
        rmSync(join(dir, f), { force: true });
        cleaned++;
      }
    }
  } catch {}
  try {
    for (const f of readdirSync(join(dir, "sessions"))) {
      rmSync(join(dir, "sessions", f), { recursive: true, force: true });
      cleaned++;
    }
  } catch {}
  try {
    // 交接标记（ADR-0009）随目标清理：残留会让下一个 executing 目标的首个 Stop 被误放行（评审 P2）。
    rmSync(join(dir, "handoff.json"), { force: true });
  } catch {}
  return cleaned;
}

function doResetLoop(cwd, git) {
  const goal = readGoal(cwd);
  const cleaned = cleanupLoopResidue(cwd);
  if (!goal) {
    rmSync(goalPath(cwd), { force: true });
    if (cleaned === 0) throw new LoopError("本目录没有目标，无需 reset");
    return { slug: "（仅残留状态，已清理）" };
  }
  const salvage = writeSalvageStub(cwd, goal, git, "reset 清除");
  rmSync(goalPath(cwd), { force: true });
  return { ...goal, salvage };
}

// ── 可回收工件（C 面）：终止时盘点残留入存根——接管者跨会话可见，事件打印会随销毁
// 会话的转录一起死，故落盘是本体、打印只是 convenience。git 不可用降级为仅资产指针。──
function salvageDir(cwd) {
  return join(loopDir(cwd), "salvage");
}

export function listSalvageStubs(cwd) {
  try {
    return readdirSync(salvageDir(cwd))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -".md".length));
  } catch {
    return [];
  }
}

function salvageLine(cwd) {
  const stubs = listSalvageStubs(cwd);
  if (stubs.length === 0) return null;
  return (
    `  可回收存根 ${stubs.length}：${stubs.join(" ")}` +
    `（先前实例的工件盘点在 .lazyzcode/loop/salvage/，接管/重立前先读）`
  );
}

function writeSalvageStub(cwd, goal, git, reason) {
  const dirty = git ? git.porcelainPaths() : null;
  const commits = git ? git.commitSubjects(`Goal: ${goal.slug}#`) : null;
  const lines = [
    `# 可回收工件存根 — ${goal.slug}`,
    "",
    `目标循环已${reason}（${new Date().toISOString()}）。接管者从这里开始：`,
    "",
    "## 未提交改动（.lazyzcode/ 自身不计）",
    ...((dirty ?? []).length ? dirty.map((p) => `- ${p}`) : ["- 无"]),
    "",
    `## 带本目标尾注的提交（Goal: ${goal.slug}#）`,
    ...((commits ?? []).length ? commits.map((c) => `- ${c}`) : ["- 无"]),
    "",
    "## 既有资产指针",
    `- 计划：.lazyzcode/plans/${goal.slug}.md（reset/abandon 不删除，PASS 评审文本可复用重采纳）`,
    ...(goal.planHash
      ? [`- 计划快照：.lazyzcode/loop/snapshots/${goal.slug}.md（采纳时点不可变副本，sha256 ${goal.planHash.slice(0, 10)}…，reset 不清）`]
      : []),
    `- 证据包：.lazyzcode/evidence/${goal.slug}.report.md（finish 归档，reset 不清）`,
    "",
  ];
  mkdirSync(salvageDir(cwd), { recursive: true });
  const p = join(salvageDir(cwd), `${goal.slug}.md`);
  writeFileSync(p, lines.join("\n"));
  return { path: relative(cwd, p), dirty: dirty?.length ?? 0, commits: commits?.length ?? 0 };
}

// ── 展示 ────────────────────────────────────────────────────────────────────
// 会话旗标扫描（ADR-0004 读面）：认领谓词=文件含 claimedAt（纯振数文件不算认领）；
// stuck=显式 true（原地无进展两振停拉标记）。目录缺失/文件损坏一律静默跳过。
// 认领 TTL（plan-v2 Phase 2-5）：引擎无 SessionEnd 事件，死亡会话的认领以 48h 时效退役——
// 过期不计入认领集（Stop 空集=目录级现状，单调收紧不破），文件原地保留（重认领自然覆写，
// doctor 过期计数可见）。canonical 常量；plugin/hooks/hook-lib.js 持自包含同形副本。
export const CLAIM_TTL_MS = 48 * 60 * 60 * 1000;

export function scanSessionFlags(cwd) {
  const claims = [];
  const stuck = [];
  const expired = []; // 认领 TTL（plan-v2 Phase 2-5）：claimedAt 超 48h 的死亡会话认领
  let names;
  try {
    names = readdirSync(join(loopDir(cwd), "sessions"));
  } catch {
    return { claims, stuck, expired };
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue; // 连 .lock-<sid> 目录与 .pid.tmp 一起排除
    try {
      const raw = JSON.parse(readFileSync(join(loopDir(cwd), "sessions", name), "utf8"));
      if (raw && typeof raw === "object") {
        const sid = name.slice(0, -".json".length);
        if (typeof raw.claimedAt === "string" && raw.claimedAt) {
          const at = Date.parse(raw.claimedAt);
          if (Number.isFinite(at) && Date.now() - at > CLAIM_TTL_MS) expired.push(sid);
          else claims.push(sid);
        }
        if (raw.stuck === true) stuck.push(sid);
      }
    } catch {
      // 损坏文件跳过
    }
  }
  return { claims, stuck, expired };
}

export function formatStatus(cwd, git) {
  const goal = readGoal(cwd);
  const stubLine = salvageLine(cwd); // 无 goal/有 goal 两分支均渲染（C 面；reset 后无 goal 恰是回收主时刻）
  if (!goal) {
    let out = stubLine ? `${noGoalMessage(cwd)}\n${stubLine}` : noGoalMessage(cwd);
    const m = readMetrics(cwd); // 放行计数跨 reset 永续——无 goal 恰是回看使用率的主时刻
    if (m) {
      out += `\n  放行计数：登记 ${m.registered ?? 0} · 消费 ${m.consumed ?? 0}（差值=reset 清理/坏标记，非损失）`;
    }
    return out;
  }
  const done = goal.steps.filter((s) => s.status === "done");
  const lines = [
    `目标 ${goal.slug} — ${goal.title}`,
    `  状态 ${goal.status} · 步骤 ${done.length}/${goal.steps.length} · 计划 ${goal.planPath ?? "未采纳"}`,
  ];
  // 快照在场+篡改复核读面（v008#N7）：planHash 缺席（0.0.8 前采纳的 goal）=静默不查；
  // 在场而快照缺席或 sha256 不符→warn（采纳后篡改可见；防本体 goal 中途误警）。
  if (goal.planHash) {
    let snapState = "复核一致";
    try {
      const snap = readFileSync(join(loopDir(cwd), "snapshots", `${goal.slug}.md`));
      if (createHash("sha256").update(snap).digest("hex") !== goal.planHash) {
        snapState = "⚠ sha256 不符（疑篡改）";
      }
    } catch {
      snapState = "⚠ 快照缺席";
    }
    lines.push(`  快照 ${goal.planHash.slice(0, 10)} · ${snapState}`);
  }
  // tier/subjects 读面（v008#N8）：缺键容忍（0.0.8 前 goal 无 tier/subjects 键按 light/空集）。
  lines.push(`  tier ${goal.tier ?? "light"} · subjects ${(goal.subjects ?? []).length} 项`);
  const next = nextStep(goal);
  if (next) {
    // 下一步标注（评审 R1-A4）：指向的 pending 步被认领/阻塞时如实点名，不再裸指。
    let note = "";
    if (isClaimFresh(next)) note = "（已认领）";
    else {
      const undone = blockedBy(next, goal);
      if (undone.length > 0) note = `（被阻塞：${undone.join(",")}）`;
    }
    lines.push(`  下一步 → ${next.id} [${next.kind}] ${next.title}${note}`);
  }
  if (goal.steps.length > 0) {
    for (const s of goal.steps) {
      const mark = s.status === "done" ? "✔" : "·";
      // 步级认领/阻塞读面（决策 #21）：done 不标注（认领已自清）；blocked 只列未完成依赖。
      let flag = "";
      if (s.status !== "done") {
        if (isClaimFresh(s)) flag = " [claimed]";
        else {
          const undone = blockedBy(s, goal);
          if (undone.length > 0) flag = ` [blocked: ${undone.join(",")}]`;
        }
      }
      const evBind = s.evidence?.fingerprint
        ? `指纹@${s.evidence.fingerprint.slice(0, 10)}`
        : `证据@${(s.evidence?.treeHash ?? "未绑定").slice(0, 10)}`;
      const ev =
        s.kind === "F" && s.evidence
          ? ` ${evBind}` + (s.evidence.files?.length ? ` · 附件 ${s.evidence.files.length}` : "")
          : "";
      lines.push(`  ${mark} ${s.id.padEnd(4)} [${s.kind}] ${s.title}${flag}${ev}`);
    }
  }
  if (goal.status === "executing") {
    const flags = scanSessionFlags(cwd);
    if (flags.claims.length > 0) {
      lines.push(`  认领 ${flags.claims.length}：${flags.claims.join(" ")}（仅认领会话会被 Stop 拉回）`);
    } else {
      lines.push("  认领 0（待认领：任一会话发「zw 继续」即接管）");
    }
    const claimable = claimableSteps(goal);
    if (claimable.length > 0) {
      lines.push(
        `  可认领 ${claimable.length}：${claimable.map((s) => s.id).join(" ")}（lzy loop claim <id> 占步，多工人互斥 48h）`,
      );
    }
    if (flags.stuck.length > 0) {
      lines.push(`  ⚠ stuck ${flags.stuck.length}：${flags.stuck.join(" ")}（原地无进展两振停拉，推进步骤即自愈）`);
    }
    try {
      // 交接标记读面（ADR-0009）：在场=下个 Stop 将消费并放行（一次性）。
      const marker = JSON.parse(readFileSync(handoffPath(cwd), "utf8"));
      lines.push(`  ⚠ 交接标记在场（快照 ${marker.snapshot ?? "?"}）——下个 Stop 将放行`);
    } catch {} // 无标记=常态，静默
  }
  if (stubLine) lines.push(stubLine);
  const metrics = readMetrics(cwd); // 放行计数（可观测面，跨 reset 永续）
  if (metrics) {
    lines.push(
      `  放行计数：登记 ${metrics.registered ?? 0} · 消费 ${metrics.consumed ?? 0}（差值=reset 清理/坏标记，非损失）`,
    );
  }
  if (git && (goal.status === "executing" || goal.status === "done")) {
    const { current, stale, unbound } = verifyEvidence(cwd, git);
    const fDone = goal.steps.filter((s) => s.kind === "F" && s.status === "done");
    const freshCount = fDone.length - stale.length - unbound.length;
    lines.push(`  tree ${(current ?? "未知").slice(0, 10)}`);
    lines.push(
      `  证据时效：新鲜 ${freshCount} · 过期 ${stale.length} · 未绑定 ${unbound.length}` +
        (stale.length + unbound.length > 0 ? "（lzy loop finish 会被拦）" : ""),
    );
  }
  return lines.join("\n");
}

// ── 跨仓目标清单（只读诊断）：扫锚目录一级子目录（默认 dirname(cwd)，含 cwd 自身）
// 各仓的循环状态。读面永不抛（对齐 loop status 姿态）；每仓独立 try/catch——一个版本
// 不符/损坏的仓不炸全局清单。ADR-0006 严格就地语义约束的是写面（goal 解析不 walk-up），
// 本命令是只读旁视，不触碰当前目标解析。
const REPO_STATUS_RANK = { executing: 0, planning: 1, done: 2 };

export function listRepos(cwd, rootOverride) {
  const anchor = rootOverride ? resolve(rootOverride) : dirname(cwd);
  let entries;
  try {
    entries = readdirSync(anchor, { withFileTypes: true });
  } catch {
    return { anchor, repos: [] }; // 锚不可读/不存在 = 空集
  }
  const repos = [];
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
    const repo = join(anchor, ent.name);
    const row = { repo: ent.name, path: repo, slug: null, status: null, error: null };
    try {
      const goal = readGoal(repo);
      if (!goal) continue; // 无循环状态=空仓，不进清单（防大目录全量噪音）
      row.slug = goal.slug;
      row.status = goal.status;
      const steps = Array.isArray(goal.steps) ? goal.steps : [];
      row.stepsDone = steps.filter((s) => s?.status === "done").length;
      row.stepsTotal = steps.length;
      const flags = scanSessionFlags(repo);
      row.claims = flags.claims.length;
      row.stuck = flags.stuck.length;
      row.salvage = listSalvageStubs(repo).length;
      try {
        row.ageMs = Math.max(0, Date.now() - statSync(goalPath(repo)).mtimeMs);
      } catch {
        row.ageMs = null;
      }
    } catch (err) {
      row.error = err instanceof LoopError ? "版本不符" : "读取失败"; // 单仓损坏不炸全局
    }
    repos.push(row);
  }
  repos.sort((a, b) => {
    const ra = REPO_STATUS_RANK[a.status] ?? 3;
    const rb = REPO_STATUS_RANK[b.status] ?? 3;
    if (ra !== rb) return ra - rb;
    return (b.ageMs ?? 0) - (a.ageMs ?? 0); // 同组内最近活跃在前
  });
  return { anchor, repos };
}

function humanAge(ms) {
  if (ms === null || ms === undefined) return "未知";
  if (ms < 60_000) return "刚刚";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} 分前`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} 小时前`;
  return `${Math.floor(ms / 86_400_000)} 天前`;
}

export function formatRepoList(cwd, rootOverride) {
  const { anchor, repos } = listRepos(cwd, rootOverride);
  const head =
    `跨仓目标清单（锚 ${anchor}，扫一级子目录；只读诊断）`;
  if (repos.length === 0) {
    return `${head}\n  （锚下没有仓持有 .lazyzcode/loop/goal.json）`;
  }
  const lines = [head];
  const nameW = Math.max(...repos.map((r) => r.repo.length), 4);
  const statusW = Math.max(...repos.map((r) => (r.status ?? "？").length), 7);
  for (const r of repos) {
    if (r.error) {
      lines.push(`  ${r.repo.padEnd(nameW)}  ${r.error}（goal.json 无法解析，lzy loop reset 可清除）`);
      continue;
    }
    const flags = [r.claims > 0 ? `认领 ${r.claims}` : null, r.stuck > 0 ? `stuck ${r.stuck}` : null]
      .filter(Boolean)
      .join("·");
    const extras = [
      (r.stepsTotal > 0 ? `${r.stepsDone}/${r.stepsTotal}` : "-").padStart(5),
      humanAge(r.ageMs),
      flags || "—",
      r.salvage > 0 ? `存根 ${r.salvage}` : "",
    ]
      .filter(Boolean)
      .join("  ");
    lines.push(
      `  ${r.repo.padEnd(nameW)}  ${(r.status ?? "").padEnd(statusW)}  ${extras}  ${r.slug}`,
    );
  }
  lines.push("  认领/stuck=会话旗标数 · 存根=可回收工件存根 · 相对时间=goal.json 最后写入距今");
  return lines.join("\n");
}

// ── 目标谱系读面（pisper-absorption#N4，只读）：证据包 ∪ salvage 存根 ∪ git 尾注三源并集。
// 本模块保持零 spawn：git 面由调用方传入 createGit(cwd) 的 trailersBySlug()（null=无 git 面降级）。
// 解析容错：报告无「状态」行/存根节缺失都降级为在场计数，绝不 throw（never-throw 读面同 formatRepoList）。

function evidenceReports(cwd) {
  const dir = join(cwd, ".lazyzcode", "evidence");
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".report.md"));
  } catch {
    return [];
  }
  const reports = [];
  for (const f of files) {
    const slug = f.replace(/\.report\.md$/, "");
    try {
      const head = readFileSync(join(dir, f), "utf8").slice(0, 2000);
      const m = head.match(/- 状态 (\S+) · 创建 ([^·]+?) · 完成 ([^\n]+?)(?:\n|$)/);
      reports.push({ slug, status: m?.[1] ?? null, finishedAt: m?.[3]?.trim() ?? null });
    } catch {
      reports.push({ slug, status: null, finishedAt: null });
    }
  }
  return reports;
}

function salvageStubs(cwd) {
  const dir = join(loopDir(cwd), "salvage");
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  const stubs = [];
  for (const f of files) {
    const row = { slug: f.replace(/\.md$/, ""), resetAt: null, dirty: 0, commits: 0 };
    try {
      const text = readFileSync(join(dir, f), "utf8");
      row.slug = text.match(/^# 可回收工件存根 — (\S+)/m)?.[1] ?? row.slug;
      row.resetAt = text.match(/清除（([0-9T:.\-Z]+)）/)?.[1] ?? null;
      let cur = null;
      for (const line of text.split(/\r?\n/)) {
        if (line.startsWith("## ")) {
          cur = /未提交改动/.test(line) ? "dirty" : /尾注的提交/.test(line) ? "commits" : null;
        } else if (cur && line.startsWith("- ")) {
          row[cur] += 1;
        }
      }
    } catch {}
    stubs.push(row);
  }
  return stubs;
}

export function formatHistory(cwd, git) {
  const rows = new Map();
  const touch = (slug) => {
    if (!rows.has(slug))
      rows.set(slug, { slug, status: null, finishedAt: null, commits: 0, lastCommitAt: null, report: false, salvage: null });
    return rows.get(slug);
  };
  for (const r of evidenceReports(cwd)) {
    const row = touch(r.slug);
    row.report = true;
    row.status = r.status;
    row.finishedAt = r.finishedAt;
  }
  for (const s of salvageStubs(cwd)) {
    const row = touch(s.slug);
    row.salvage = s;
    if (!row.status) row.status = "已回收";
  }
  const trailers = typeof git?.trailersBySlug === "function" ? git.trailersBySlug() : null;
  if (trailers) {
    for (const [slug, t] of trailers) {
      const row = touch(slug);
      row.commits = t.commits;
      row.lastCommitAt = t.lastAt;
      if (!row.status) row.status = "仅尾注";
    }
  }
  const head = `目标谱系（本仓证据包 ∪ salvage 存根 ∪ git 尾注；只读）`;
  const list = [...rows.values()];
  if (list.length === 0) {
    return `${head}\n  （没有历史目标：本仓尚无证据包/salvage 存根/带 Goal: 尾注的提交）`;
  }
  const lastAt = (r) => [r.finishedAt, r.salvage?.resetAt, r.lastCommitAt].filter(Boolean).sort().pop() ?? "";
  list.sort((a, b) => (lastAt(b) || "").localeCompare(lastAt(a) || ""));
  const slugW = Math.max(...list.map((r) => r.slug.length), 4);
  const statusW = Math.max(...list.map((r) => (r.status ?? "？").length), 4);
  const lines = [head];
  for (const r of list) {
    const extras = [
      (r.commits > 0 ? `${r.commits} 提交` : "—").padStart(7),
      r.report ? "证据包✓" : "——",
      r.salvage ? `存根✓${r.salvage.dirty > 0 ? `(未提交 ${r.salvage.dirty})` : ""}` : "——",
      (lastAt(r) || "未知").slice(0, 10),
    ].join("  ");
    lines.push(`  ${r.slug.padEnd(slugW)}  ${(r.status ?? "？").padEnd(statusW)}  ${extras}`);
  }
  lines.push("  状态取证据包报告；仅存根=已回收；仅尾注=账本有提交但本仓无归档。日期=最近活动（完成/清除/末次尾注提交）");
  return lines.join("\n");
}
