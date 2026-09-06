// 目标循环（goal loop）状态机：注册目标 → 计划门（决策完备）→ 逐步派发 →
// 证据验证（F 项绑定 tree hash，代码一变旧证据作废）→ 完成。
// 状态落工作区 .lazyzcode/loop/goal.json（与宿主 .zcode/ 划清边界，宪法 §4 决策 #6）。
// 本模块零 spawn（tree hash 经 core/git.js 取），全部同步语义。
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

export const GOAL_VERSION = 1;
const ACTIVE_STATES = new Set(["planning", "executing"]);

export class LoopError extends Error {}

function loopDir(cwd) {
  return join(cwd, ".lazyzcode", "loop");
}

export function goalPath(cwd) {
  return join(loopDir(cwd), "goal.json");
}

export function readGoal(cwd) {
  try {
    return JSON.parse(readFileSync(goalPath(cwd), "utf8"));
  } catch {
    return null;
  }
}

function writeGoal(cwd, goal) {
  const p = goalPath(cwd);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = join(dirname(p), `.${basename(p)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(goal, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, p);
}

function requireActive(cwd, ...states) {
  const goal = readGoal(cwd);
  if (!goal) throw new LoopError("本目录没有目标（先 lzy loop register）");
  if (states && !states.includes(goal.status)) {
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

export function adoptPlan(cwd, planFile, { force = false, review = null } = {}) {
  const goal = requireActive(cwd, "planning");
  // 评审门（宪法 §4 #15）：评审判决 REVISE = 拒绝采纳，--force 不越过（修计划重审才是正道）。
  if (review && /\bREVISE\b/i.test(review)) {
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
    const undecided = body
      .split(/\r?\n/)
      .filter((l) => UNDECIDED_RE.test(l))
      .map((l) => l.trim());
    if (undecided.length > 0) {
      throw new LoopError(
        `计划未决策完备（含 TBD/待定 标记 ${undecided.length} 处）。先消除待定项再开跑；确要带病开工用 --force。\n  ${undecided
          .slice(0, 3)
          .join("\n  ")}`,
      );
    }
  }
  const items = parsePlanItems(body);
  if (items.length === 0) {
    throw new LoopError("计划里没有清单项（语法：- [N1] … / - [F1] …，F 项需真实表面证据）");
  }
  goal.planPath = relative(cwd, planFile) || planFile;
  goal.review = review
    ? { by: "plan-reviewer", verdict: /\bPASS\b/i.test(review) ? "PASS" : "UNVERIFIED", summary: review.slice(0, 500), at: new Date().toISOString() }
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
export function completeStep(cwd, git, id, { note = null, evidence = null } = {}) {
  const goal = requireActive(cwd, "executing");
  const step = goal.steps.find((s) => s.id === id);
  if (!step) {
    throw new LoopError(
      `无此步骤：${id}（现有：${goal.steps.map((s) => s.id).join(" ") || "无"}）`,
    );
  }
  const rebinding = step.status === "done";
  if (step.kind === "F" && !evidence?.trim()) {
    throw new LoopError(
      `终验项 ${id} 必须带 --evidence（真实表面取证：HTTP 返回/截图/CLI stdout；测试全绿≠证据）`,
    );
  }
  const trimmedNote = note?.trim() || null;
  step.status = "done";
  step.doneAt = new Date().toISOString();
  step.note = trimmedNote ?? (rebinding ? step.note : null);
  step.evidence =
    step.kind === "F"
      ? { text: evidence.trim(), treeHash: git ? git.treeHash() : null, at: step.doneAt }
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
  const goal = requireActive(cwd, "executing");
  const pending = goal.steps.filter((s) => s.status !== "done");
  if (pending.length > 0) {
    throw new LoopError(
      `未完成即停 = 半途而废：还剩 ${pending.map((s) => s.id).join(" ")}（用 lzy step done 逐项收口）`,
    );
  }
  const { current, stale, unbound } = verifyEvidence(cwd, git);
  const bad = [...stale, ...unbound];
  if (bad.length > 0) {
    throw new LoopError(
      `证据已过期（代码在取证后变更，tree hash 对不上）：${bad.map((s) => s.id).join(" ")}。` +
        `在当前代码上重新取证后重跑 lzy step done <id> --evidence …（current=${current ?? "未知"}）`,
    );
  }
  goal.status = "done";
  goal.finishedAt = new Date().toISOString();
  writeGoal(cwd, goal);
  return goal;
}

export function abandonLoop(cwd) {
  const goal = requireActive(cwd);
  goal.status = "abandoned";
  goal.finishedAt = new Date().toISOString();
  writeGoal(cwd, goal);
  return goal;
}

export function resetLoop(cwd) {
  const goal = readGoal(cwd);
  if (!goal) throw new LoopError("本目录没有目标，无需 reset");
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
          ? ` 证据@${(s.evidence.treeHash ?? "未绑定").slice(0, 10)}`
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
