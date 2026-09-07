// 目标循环（goal loop）状态机：注册目标 → 计划门（决策完备）→ 逐步派发 →
// 证据验证（F 项绑定 tree hash，代码一变旧证据作废）→ 完成。
// 状态落工作区 .lazyzcode/loop/goal.json（与宿主 .zcode/ 划清边界，宪法 §4 决策 #6）。
// 本模块零 spawn（tree hash 经 core/git.js 取），全部同步语义。
import { copyFileSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { createHash } from "node:crypto";

export const GOAL_VERSION = 1;
const ACTIVE_STATES = new Set(["planning", "executing"]);

// --note / --evidence 入账上限（评审 R2-9）
export const NOTE_MAX = 300;
export const EVIDENCE_MAX = 4000;
// 证据附件上限：单 F 项 ≤4 个文件、单个 ≤20MB（截图/响应转储足够；防手滑塞巨物）
export const EVIDENCE_FILES_MAX = 4;
export const EVIDENCE_FILE_MAX_BYTES = 20 * 1024 * 1024;

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

function withLock(cwd, fn) {
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

function requireActive(cwd, ...states) {
  const goal = readGoal(cwd);
  if (!goal) throw new LoopError("本目录没有目标（先 lzy loop register）");
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
export function registerGoal(cwd, slug, title) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(slug ?? "")) {
    throw new LoopError(`slug 不合法：${slug}（仅字母数字与连字符，≤64 字符）`);
  }
  if (!title?.trim()) throw new LoopError("目标标题不能为空（--title）");
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
    planPath: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    baseTreeHash: null,
    steps: [],
  };
  writeGoal(cwd, goal);
  return goal;
}

// ── 2. 计划门：解析 N/F 清单，决策完备（无待定）才放行 ────────────────────
const ITEM_RE = /^-\s*\[([NF])(\d+)\]\s*(.+)$/;
const UNDECIDED_RE = /(TBD|待定|待确认|未定|待讨论)/i;

function parsePlanItems(body) {
  const items = [];
  for (const raw of body.split(/\r?\n/)) {
    const m = raw.match(ITEM_RE);
    if (!m) continue;
    const id = `${m[1]}${m[2]}`;
    if (items.some((it) => it.id === id)) throw new LoopError(`计划清单 id 重复：${id}`);
    items.push({ id, kind: m[1], title: m[3].trim() });
  }
  return items;
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

export function adoptPlan(cwd, planFile, opts = {}) {
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
  goal.planPath = relative(cwd, planFile) || planFile;
  const verdict = review ? parseVerdict(review) : null;
  goal.review = review
    ? { by: "plan-reviewer", verdict: verdict === "PASS" ? "PASS" : "UNVERIFIED", summary: review.slice(0, 500), at: new Date().toISOString() }
    : null;
  goal.steps = items.map((it) => ({
    id: it.id,
    kind: it.kind,
    title: it.title,
    status: "pending",
    doneAt: null,
    note: null,
    evidence: null,
  }));
  writeGoal(cwd, goal);
  return goal;
}

// ── 3. 开跑：planning → executing，记录基线 tree hash ──────────────────────
export function startLoop(cwd, git) {
  return withLock(cwd, () => doStartLoop(cwd, git));
}

function doStartLoop(cwd, git) {
  const goal = requireActive(cwd, "planning");
  if (goal.steps.length === 0) {
    throw new LoopError("计划门未过：先 lzy loop plan <文件> 采纳清单");
  }
  goal.status = "executing";
  goal.startedAt = new Date().toISOString();
  goal.baseTreeHash = git ? git.treeHash() : null;
  writeGoal(cwd, goal);
  return goal;
}

// ── 4. 逐步完成：F 项强制证据 + 绑定当时 tree hash；已完成步骤可重跑以重新取证 ──
export function completeStep(cwd, git, id, opts = {}) {
  return withLock(cwd, () => doCompleteStep(cwd, git, id, opts));
}

// 证据附件：把取证产物（截图/响应转储）复制进 .lazyzcode/evidence/ 并绑 sha256——
// 原件在 /tmp 会被清，副本让证据包自包含（.lazyzcode/ 不计工作区脏，决策 #14）。
function attachEvidenceFiles(cwd, goal, step, files) {
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
    const dest = join(outDir, `${goal.slug}.${step.id}.${i + 1}${ext}`);
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
  step.note = trimmedNote ?? (rebinding ? step.note : null);
  const attached = attachEvidenceFiles(cwd, goal, step, files);
  step.evidence =
    step.kind === "F"
      ? {
          text: trimmedEvidence,
          treeHash: git ? git.treeHash() : null,
          at: step.doneAt,
          ...(attached ? { files: attached } : {}),
        }
      : null;
  writeGoal(cwd, goal);
  return { goal, step, rebinding, dirty: git ? git.dirty() : false };
}

// ── 5. 证据时效：F 项证据的 tree hash 是否仍等于当前工作树 ─────────────────
export function verifyEvidence(cwd, git) {
  const goal = readGoal(cwd);
  if (!goal) throw new LoopError("本目录没有目标");
  const current = git ? git.treeHash() : null;
  const fresh = [];
  const stale = [];
  const unbound = [];
  for (const s of goal.steps) {
    if (s.kind !== "F" || s.status !== "done") continue;
    if (!s.evidence?.treeHash || !current) unbound.push(s);
    else if (s.evidence.treeHash === current) fresh.push(s);
    else stale.push(s);
  }
  return { current, fresh, stale, unbound };
}

// ── 6. 完成：全部步骤 done + F 项证据全部新鲜 ──────────────────────────────
export function finishLoop(cwd, git) {
  return withLock(cwd, () => doFinishLoop(cwd, git));
}

function doFinishLoop(cwd, git) {
  const goal = requireActive(cwd, "executing");
  const pending = goal.steps.filter((s) => s.status !== "done");
  if (pending.length > 0) {
    throw new LoopError(
      `未完成即停 = 半途而废：还剩 ${pending.map((s) => s.id).join(" ")}（用 lzy step done 逐项收口）`,
    );
  }
  const { current, stale, unbound } = verifyEvidence(cwd, git);
  // 过期（代码后变，重取证即可）与未绑定（git 缺失，重取证也无济于事）必须分诊，药方不同（评审 R2-4）。
  if (stale.length > 0) {
    throw new LoopError(
      `证据已过期（代码在取证后变更，tree hash 对不上）：${stale.map((s) => s.id).join(" ")}。` +
        `在当前代码上重新取证后重跑 lzy step done <id> --evidence …（current=${current ?? "未知"}）`,
    );
  }
  if (unbound.length > 0) {
    throw new LoopError(
      `证据未绑定 tree hash：${unbound.map((s) => s.id).join(" ")}。` +
        (current
          ? "证据缺少 tree hash，重新取证即可绑定。"
          : "本目录不是 git 仓库或还没有任何提交——先 git init 并提交，再重新取证。"),
    );
  }
  goal.status = "done";
  goal.finishedAt = new Date().toISOString();
  writeGoal(cwd, goal);
  return goal;
}

// ── 7. 证据包导出：goal 的可审阅档案（评审判决/步骤注记/F 项证据+附件清单）──
// 人在接管前要快速看清「凭什么说做完了」，这就是那份材料（OmO 哲学：接管=失败信号，
// 接管时人需要证据，不是结论）。落 .lazyzcode/evidence/<slug>.report.md，reset 不清它。
export function exportReport(cwd, git) {
  const goal = readGoal(cwd);
  if (!goal) throw new LoopError("本目录没有目标");
  if (goal.steps.length === 0) {
    throw new LoopError(`目标 ${goal.slug} 还没采纳计划，无可导出（先 lzy loop plan）`);
  }
  const done = goal.steps.filter((s) => s.status === "done").length;
  const current = git ? git.treeHash() : null;
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
      lines.push(`  - 证据 @ tree ${(s.evidence.treeHash ?? "未绑定").slice(0, 10)} · ${s.evidence.at}：${s.evidence.text}`);
      for (const f of s.evidence.files ?? []) {
        lines.push(`  - 附件 \`${f.path}\`（sha256 ${f.sha256.slice(0, 16)}… · ${f.bytes} bytes）`);
      }
    }
  }
  const p = join(cwd, ".lazyzcode", "evidence", `${goal.slug}.report.md`);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${lines.join("\n")}\n`);
  return { path: relative(cwd, p) };
}

export function abandonLoop(cwd) {
  return withLock(cwd, () => doAbandonLoop(cwd));
}

function doAbandonLoop(cwd) {
  const goal = requireActive(cwd);
  goal.status = "abandoned";
  goal.finishedAt = new Date().toISOString();
  writeGoal(cwd, goal);
  return goal;
}

export function resetLoop(cwd) {
  return withLock(cwd, () => doResetLoop(cwd));
}

// 孤儿/残留清理（评审 R2-11）：kill -9 落在 tmp 写入与 rename 之间会留孤儿 .tmp；
// 会话计数器在 goal 清除后也成悬空状态。doctor 的状态卫生与 reset 指引共用此语义。
function cleanupLoopResidue(cwd) {
  const dir = loopDir(cwd);
  const goalName = basename(goalPath(cwd));
  let cleaned = 0;
  try {
    for (const f of readdirSync(dir)) {
      if (f.startsWith(`.${goalName}.`) && f.endsWith(".tmp")) {
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
  return cleaned;
}

function doResetLoop(cwd) {
  const goal = readGoal(cwd);
  const cleaned = cleanupLoopResidue(cwd);
  if (!goal) {
    rmSync(goalPath(cwd), { force: true });
    if (cleaned === 0) throw new LoopError("本目录没有目标，无需 reset");
    return { slug: "（仅残留状态，已清理）" };
  }
  rmSync(goalPath(cwd), { force: true });
  return goal;
}

// ── 展示 ────────────────────────────────────────────────────────────────────
export function formatStatus(cwd, git) {
  const goal = readGoal(cwd);
  if (!goal) return "（本目录没有目标循环状态；lzy loop register <slug> --title … 开始）";
  const done = goal.steps.filter((s) => s.status === "done");
  const lines = [
    `目标 ${goal.slug} — ${goal.title}`,
    `  状态 ${goal.status} · 步骤 ${done.length}/${goal.steps.length} · 计划 ${goal.planPath ?? "未采纳"}`,
  ];
  const next = nextStep(goal);
  if (next) lines.push(`  下一步 → ${next.id} [${next.kind}] ${next.title}`);
  if (goal.steps.length > 0) {
    for (const s of goal.steps) {
      const mark = s.status === "done" ? "✔" : "·";
      const ev =
        s.kind === "F" && s.evidence
          ? ` 证据@${(s.evidence.treeHash ?? "未绑定").slice(0, 10)}` +
            (s.evidence.files?.length ? ` · 附件 ${s.evidence.files.length}` : "")
          : "";
      lines.push(`  ${mark} ${s.id.padEnd(4)} [${s.kind}] ${s.title}${ev}`);
    }
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
