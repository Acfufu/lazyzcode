// attempt 世系契约测试（0.1.0 棒B，ADR-0016）：attempt.json 原子写+校验和 fail-closed /
// register 初始化与采纳绑定 / supersede forward-only 流（同哈希拒/planning 拒/无快照拒/
// HEAVY 评审门照走）/ 证据按代次隔离 / finish-abandon 收口 / 跨 reset 常驻与派生视图 /
// tmp 家族 / dag stale 查询面三态。
// 家法同 dag-kernel.contract.test.js：核心直调（快、确定）+CLI spawn（隔离 HOME 双 env、
// LZY_ZCODE_ENGINE 抑制）；win32 雷回避：不 split("/")、EACCES 腿挂平台 skip。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGit } from "../core/git.js";
import {
  ATTEMPT_VERSION,
  AttemptError,
  bindPlanToAttempt,
  closeAttempt,
  formatAttempts,
  initLineageAtRegister,
  loadAttempts,
  saveAttempts,
  supersedeAttempt,
} from "../core/attempt.js";
import { appendPlanNode, emptyDag, loadDag, saveDag } from "../core/dag.js";
import {
  abandonLoop,
  adoptPlan,
  completeStep,
  finishLoop,
  readGoal,
  registerGoal,
  resetLoop,
  startLoop,
  supersedePlan,
  verifyEvidence,
} from "../core/loop.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");
const SUPPRESS_ENGINE = "/nonexistent-lzy-suppressed-engine";
const HOME = mkdtempSync(join(tmpdir(), "lzy-v0110-home-"));
const IS_WIN = process.platform === "win32";

function repo(prefix = "lzy-v0110-attempt-") {
  const d = mkdtempSync(join(tmpdir(), prefix));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "a\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "init"]);
  return d;
}

function cli(args, cwd) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE },
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function attemptFileOf(d) {
  return join(d, ".lazyzcode", "loop", "attempt.json");
}

function goalJson(d) {
  return JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8"));
}

function writePlan(d, text) {
  mkdirSync(join(d, ".lazyzcode"), { recursive: true });
  const p = join(d, ".lazyzcode", "plan.md");
  writeFileSync(p, text);
  return p;
}

function cycle(d, slug = "t") {
  registerGoal(d, slug, "title");
  adoptPlan(d, writePlan(d, "- [N1] x\n- [F1] v\n"));
  startLoop(d, createGit(d));
}

// 冻结时钟（Date.now 与 Date 构造都冻——round-trip 字节稳定家法）。返回还原函数。
function freezeClock(fixed = 1_700_000_000_000) {
  const Real = Date;
  class Frozen extends Real {
    constructor(...a) {
      super(a.length === 0 ? fixed : a[0], ...a.slice(1));
    }
    static now() {
      return fixed;
    }
  }
  globalThis.Date = Frozen;
  return () => {
    globalThis.Date = Real;
  };
}

// ── 内核：原子写 + 校验和 + fail-closed ──────────────────────────────────────
test("saveAttempts→loadAttempts round-trip 保形，同状态双跑字节一致（冻结钟）", () => {
  const d = repo();
  const restore = freezeClock();
  try {
    initLineageAtRegister(d, { slug: "s", n: 1, tier: "heavy" });
    const bytes1 = readFileSync(attemptFileOf(d));
    const loaded = loadAttempts(d);
    assert.equal(loaded.attemptVersion, ATTEMPT_VERSION);
    assert.equal(loaded.slug, "s");
    assert.equal(loaded.attempts.length, 1);
    assert.equal(loaded.attempts[0].status, "active");
    saveAttempts(d, structuredClone(loaded));
    const bytes2 = readFileSync(attemptFileOf(d));
    assert.equal(bytes2.toString("utf8"), bytes1.toString("utf8"), "同状态双跑必须逐字节一致（prompt-cache/确定性家法）");
  } finally {
    restore();
  }
});

test("缺席=null（非空账本）；损坏三态 fail-closed 带恢复指路", () => {
  const d = repo();
  assert.equal(loadAttempts(d), null, "ENOENT=缺席（派生视图语义），非空账本");
  mkdirSync(join(d, ".lazyzcode", "loop"), { recursive: true });
  writeFileSync(attemptFileOf(d), "{ not json");
  assert.throws(() => loadAttempts(d), /JSON 解析失败/);
  // register 在损坏账本上 fail-closed（写命令不在损账本上落新运行，同 dag-first 家法）
  assert.throws(() => initLineageAtRegister(d, { slug: "s", n: 1, tier: null }), AttemptError);
  rmSync(attemptFileOf(d));
  initLineageAtRegister(d, { slug: "s", n: 1, tier: null });
  // 形状腿：条目非法但校验和自洽——校验和只证内容未变不证结构可用（ADJ-05 家法）
  const bad = { attemptVersion: ATTEMPT_VERSION, slug: "s", attempts: [{ n: 0, status: "bogus" }] };
  const checksum = createHash("sha256").update(JSON.stringify(bad)).digest("hex");
  writeFileSync(attemptFileOf(d), `${JSON.stringify({ ...bad, checksum }, null, 2)}\n`);
  assert.throws(() => loadAttempts(d), /形状畸形/);
  // 版本腿
  const ver = { attemptVersion: 99, slug: "s", attempts: [{ n: 1, status: "active" }] };
  const vc = createHash("sha256").update(JSON.stringify(ver)).digest("hex");
  writeFileSync(attemptFileOf(d), `${JSON.stringify({ ...ver, checksum: vc }, null, 2)}\n`);
  assert.throws(() => loadAttempts(d), /版本不兼容/);
});

if (!IS_WIN) {
  test("EACCES 不可读=拒绝（POSIX 腿；ADJ-01 家法：不可读绝不静默当缺席）", () => {
    const d = repo();
    initLineageAtRegister(d, { slug: "s", n: 1, tier: null });
    chmodSync(attemptFileOf(d), 0o000);
    try {
      assert.throws(() => loadAttempts(d), AttemptError);
    } finally {
      chmodSync(attemptFileOf(d), 0o644);
    }
  });
}

test("写护栏：盘上有载荷而写入空 attempts=拒（覆写即毁世系唯一副本）", () => {
  const d = repo();
  initLineageAtRegister(d, { slug: "s", n: 1, tier: null });
  assert.throws(() => saveAttempts(d, { attemptVersion: ATTEMPT_VERSION, slug: "s", attempts: [] }), /写护栏/);
});

// ── register 初始化 + 采纳绑定 + supersede 流 ───────────────────────────────
test("register 初始化单条 active；adoptPlan 绑定 planHash", () => {
  const d = repo();
  registerGoal(d, "t", "title");
  let lin = loadAttempts(d);
  assert.equal(lin.attempts[0].n, 1);
  assert.equal(lin.attempts[0].planHash, null);
  assert.equal(lin.attempts[0].status, "active");
  const p = writePlan(d, "- [N1] x\n- [F1] v\n");
  adoptPlan(d, p);
  lin = loadAttempts(d);
  assert.ok(lin.attempts[0].planHash, "采纳后 planHash 绑定进世系");
  assert.ok(lin.attempts[0].adoptedAt);
});

test("supersede forward-only：attempt+1、旧快照归档、世系置换、plan 节点带新戳", () => {
  const d = repo();
  cycle(d);
  assert.equal(goalJson(d).attempt, 1);
  // 同哈希拒
  assert.throws(() => supersedePlan(d, join(d, ".lazyzcode", "plan.md")), /计划哈希未变/);
  // 实质变更 → 新代次
  const p2 = writePlan(d, "- [N1] x CHANGED\n- [F1] v\n");
  const { goal, superseded } = supersedePlan(d, p2);
  assert.deepEqual(superseded, { from: 1, to: 2 });
  assert.equal(goal.attempt, 2);
  assert.ok(existsSync(join(d, ".lazyzcode", "loop", "snapshots", "t.attempt1.md")), "旧快照归档");
  const lin = loadAttempts(d);
  assert.equal(lin.attempts[0].status, "superseded");
  assert.equal(lin.attempts[0].supersededBy, 2);
  assert.equal(lin.attempts[1].status, "active");
  assert.notEqual(lin.attempts[1].planHash, lin.attempts[0].planHash);
  // 中央账本 plan 节点带代次戳：1 与 2 各一
  const dag = loadDag(d);
  const stamps = dag.nodes.filter((n) => n.kind === "plan").map((n) => n.attempt).sort();
  assert.deepEqual(stamps, [1, 2]);
  // goal.json steps 重置为 pending
  assert.ok(goal.steps.every((s) => s.status === "pending"));
});

test("supersede 拒绝面：planning 态拒；无 planHash 走恢复出口拒", () => {
  const d = repo();
  registerGoal(d, "t", "title");
  const p = writePlan(d, "- [N1] x\n- [F1] v\n");
  adoptPlan(d, p);
  assert.throws(() => supersedePlan(d, p), /仅 executing 态有语义/);
  // 无 planHash 存量（ADJ-09 恢复人群）：手剥 planHash 后 supersede 拒、plan 重采纳放行
  startLoop(d, createGit(d));
  const gPath = join(d, ".lazyzcode", "loop", "goal.json");
  const g = JSON.parse(readFileSync(gPath, "utf8"));
  delete g.planHash;
  writeFileSync(gPath, `${JSON.stringify(g, null, 2)}\n`);
  assert.throws(() => supersedePlan(d, p), /恢复出口 lzy loop plan/);
  const { goal } = adoptPlan(d, p);
  assert.equal(goal.status, "executing");
});

test("HEAVY supersede 评审门照走：无 PASS 机器拒，PASS 放行", () => {
  const d = repo();
  registerGoal(d, "t", "title", { tier: "heavy" });
  adoptPlan(d, writePlan(d, "- [N1] x\n- [F1] v\n"), { review: "plan-reviewer: PASS — r1" });
  startLoop(d, createGit(d));
  const p2 = writePlan(d, "- [N1] x CHANGED\n- [F1] v\n");
  assert.throws(() => supersedePlan(d, p2, { review: "self: UNVERIFIED" }), /HEAVY 目标机器拒/);
  const { goal } = supersedePlan(d, p2, { review: "plan-reviewer: PASS — r2" });
  assert.equal(goal.attempt, 2);
  assert.equal(goal.review.planHash, goal.planHash, "评审绑新代次 planHash");
});

test("证据按代次隔离：supersede 后旧代次绿不锚定、新代次取证独立锚定", () => {
  const d = repo();
  cycle(d);
  completeStep(d, createGit(d), "N1", { note: "n" });
  completeStep(d, createGit(d), "F1", { evidence: "green v1" });
  const p2 = writePlan(d, "- [N1] x CHANGED\n- [F1] v\n");
  supersedePlan(d, p2);
  completeStep(d, createGit(d), "N1", { note: "n2" });
  completeStep(d, createGit(d), "F1", { evidence: "green v2" });
  const goal = readGoal(d);
  const dag = loadDag(d);
  const greens = dag.nodes.filter((n) => n.kind === "evidence" && n.half === "green");
  assert.equal(greens.length, 2);
  assert.deepEqual(greens.map((n) => n.attempt).sort(), [1, 2]);
  // verifyEvidence 锚定 attempt 2 的 gen1 绿（steps 已重置重取证）——fresh
  const v = verifyEvidence(d, createGit(d));
  assert.equal(v.fresh.length, 1);
  assert.equal(v.stale.length, 0);
  assert.equal(goal.attempt, 2);
});

test("finish/abandon 收口进世系；跨 reset 常驻且重注册派生衔接", () => {
  const d = repo();
  cycle(d);
  completeStep(d, createGit(d), "N1", { note: "n" });
  completeStep(d, createGit(d), "F1", { evidence: "e" });
  finishLoop(d, createGit(d));
  assert.equal(loadAttempts(d).attempts[0].status, "completed");
  resetLoop(d, createGit(d));
  assert.ok(existsSync(attemptFileOf(d)), "reset 不清世系（同 dag.json）");
  // 重注册同 slug：deriveAttempt=账本最大戳+1=2；世系文件重置为本运行，派生视图补历史
  registerGoal(d, "t", "title again");
  assert.equal(goalJson(d).attempt, 2);
  const lin = loadAttempts(d);
  assert.deepEqual(lin.attempts.map((a) => a.n), [1, 2], "同 slug 重注册追加，历史 supersede 链保真");
  assert.equal(lin.attempts[0].status, "completed");
  assert.equal(lin.attempts[1].status, "active");
  const rendered = formatAttempts(d, "t");
  assert.match(rendered, /#1 completed/);
  assert.match(rendered, /#2 active/);
  // abandon 终态
  const d2 = repo();
  cycle(d2, "u");
  abandonLoop(d2, createGit(d2));
  assert.equal(loadAttempts(d2).attempts[0].status, "abandoned");
});

test("formatAttempts 降级不抛：损坏账本渲染 ⚠ 行（never-throw 读面家族）", () => {
  const d = repo();
  mkdirSync(join(d, ".lazyzcode", "loop"), { recursive: true });
  writeFileSync(attemptFileOf(d), "{ broken");
  const out = formatAttempts(d, null);
  assert.match(out, /⚠ 世系账本不可读/);
  // 派生腿炸（无 goal 无账本 slug）也不抛
  assert.ok(formatAttempts(d, "ghost-slug").includes("attempt 世系"));
});

test("supersedeAttempt/bindPlanToAttempt/closeAttempt 派生基准：无文件时从账本重建落盘", () => {
  const d = repo();
  // 模拟 0.0.10 在途 goal：dag 有 plan 戳、无世系文件
  const dag = emptyDag();
  appendPlanNode(dag, { slug: "legacy", planHash: "aa".repeat(32), attempt: 1 });
  saveDag(d, dag);
  bindPlanToAttempt(d, { slug: "legacy", n: 1, planHash: "bb".repeat(32), tier: "light" });
  const lin = loadAttempts(d);
  assert.equal(lin.slug, "legacy");
  assert.equal(lin.attempts[0].n, 1);
  assert.equal(lin.attempts[0].planHash, "bb".repeat(32), "首次写按派生基准落盘并绑定");
  supersedeAttempt(d, { slug: "legacy", from: 1, to: 2, planHash: "cc".repeat(32), tier: "light" });
  const lin2 = loadAttempts(d);
  assert.equal(lin2.attempts[0].status, "superseded");
  assert.equal(lin2.attempts[1].status, "active");
  closeAttempt(d, { slug: "legacy", n: 2, status: "completed" });
  assert.equal(loadAttempts(d).attempts[1].status, "completed");
});

// ── CLI 面 ──────────────────────────────────────────────────────────────────
test("CLI supersede 流 + attempts 读面 + plan 拒面（隔离 HOME spawn）", () => {
  const d = repo();
  let r = cli(["loop", "register", "t", "--title", "T"], d);
  assert.equal(r.code, 0);
  const p = join(d, ".lazyzcode", "plan.md");
  mkdirSync(join(d, ".lazyzcode"), { recursive: true });
  writeFileSync(p, "- [N1] x\n- [F1] v\n");
  r = cli(["loop", "plan", p], d);
  assert.equal(r.code, 0);
  r = cli(["loop", "start"], d);
  assert.equal(r.code, 0);
  writeFileSync(p, "- [N1] x CHANGED\n- [F1] v\n");
  r = cli(["loop", "plan", p], d);
  assert.equal(r.code, 1);
  assert.match(r.out, /lzy loop supersede/);
  r = cli(["loop", "supersede", p], d);
  assert.equal(r.code, 0);
  assert.match(r.out, /attempt 1 → 2/);
  assert.match(r.out, /旧快照归档 .attempt1\.md/);
  r = cli(["loop", "attempts"], d);
  assert.equal(r.code, 0);
  assert.match(r.out, /#1 superseded → #2/);
  assert.match(r.out, /#2 active/);
  // 同哈希拒
  r = cli(["loop", "supersede", p], d);
  assert.equal(r.code, 1);
  assert.match(r.out, /计划哈希未变/);
});

test("CLI reset 清孤儿 tmp（.attempt.json.*.tmp 家族）但留世系本体", () => {
  const d = repo();
  cli(["loop", "register", "t", "--title", "T"], d);
  const loop = join(d, ".lazyzcode", "loop");
  writeFileSync(join(loop, ".attempt.json.999.123.tmp"), "orphan");
  const r = cli(["loop", "reset"], d);
  assert.equal(r.code, 0);
  assert.ok(!existsSync(join(loop, ".attempt.json.999.123.tmp")), "孤儿 tmp 被清扫");
  assert.ok(existsSync(attemptFileOf(d)), "世系本体 reset 存活");
  const residue = readdirSync(loop).filter((f) => f.endsWith(".tmp"));
  assert.equal(residue.length, 0);
});

test("CLI dag stale：fresh/stale/superseded/外部/n-a 五态逐一命中", () => {
  const d = repo();
  let r = cli(["loop", "register", "t", "--title", "T"], d);
  assert.equal(r.code, 0);
  const p = writePlan(d, "- [N1] x\n- [F1] v\n- [F2] w\n");
  r = cli(["loop", "plan", p], d);
  assert.equal(r.code, 0);
  r = cli(["loop", "start"], d);
  assert.equal(r.code, 0);
  r = cli(["step", "done", "F1", "--evidence", "fresh now"], d);
  assert.equal(r.code, 0);
  r = cli(["evidence", "red", "F2", "--evidence", "pre-state", "--surface", "published:x@1"], d);
  assert.equal(r.code, 0);
  r = cli(["dag", "stale"], d);
  assert.equal(r.code, 0, `退出码 0（只展示不进门）：${r.out}`);
  assert.match(r.out, /新鲜 1/);
  assert.match(r.out, /不适用（非绿半） 1/);
  assert.match(r.out, /n\d+ green t\/F1 gen1\s+新鲜/);
  // 提交推进树 → F1 过期；rebind → 旧代次历史、新代次新鲜
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  writeFileSync(join(d, "b.txt"), "b\n");
  g(["add", "b.txt"]);
  g(["commit", "-qm", "advance"]);
  r = cli(["dag", "stale"], d);
  assert.match(r.out, /过期 1/);
  r = cli(["step", "done", "F1", "--evidence", "fresh again"], d);
  assert.equal(r.code, 0);
  r = cli(["dag", "stale"], d);
  assert.match(r.out, /历史代次 1/);
  assert.match(r.out, /新鲜 1/);
  // 无 goal 基准（--goal 历史查面）不炸
  r = cli(["dag", "stale", "--goal", "t"], d);
  assert.equal(r.code, 0);
});

test("CLI rm 后重注册：supersede 链跨 reset 由派生视图续读", () => {
  const d = repo();
  cli(["loop", "register", "t", "--title", "T"], d);
  const p = writePlan(d, "- [N1] x\n- [F1] v\n");
  cli(["loop", "plan", p], d);
  cli(["loop", "start"], d);
  writeFileSync(p, "- [N1] x C2\n- [F1] v\n");
  cli(["loop", "supersede", p], d);
  cli(["loop", "reset"], d);
  cli(["loop", "register", "t", "--title", "T2"], d);
  const r = cli(["loop", "attempts"], d);
  assert.match(r.out, /#1 superseded → #2/);
  assert.match(r.out, /#2 superseded → #3/);
  assert.match(r.out, /#3 active/);
});
