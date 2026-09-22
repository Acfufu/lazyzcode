// 红绿豁免收紧契约测试（0.1.0 棒B，ADR-0016）：INV-09 缺红不得以补绿收口（HEAVY finish
// 逐 F 检查，恢复=lzy evidence red 反向配对或 waive-red）+ INV-08 harness 冻结（红绿
// --harness 同源核对，错配拒；waive 不收 harness）+ 反向配对边形（绿后补录=当场 red_of
// 指锚定绿，查找原语与 finish 同源）+ LIGHT 不设机器门。
// 家法同 dag-authority.contract.test.js：核心直调 + CLI spawn（隔离 HOME 双 env、引擎抑制）。
import { test } from "node:test";
// 人权门非本文件被测面（门由 human-gate.contract.test.js 两面钉）——spawn 继承此 env 保采纳畅通
process.env.LZY_ABLATE_HUMAN_GATE = "1";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGit } from "../core/git.js";
import { loadDag } from "../core/dag.js";
import { recordComparatorAttestation } from "../core/attest.js";
import {
  HARNESS_MAX,
  adoptPlan,
  completeStep,
  finishLoop,
  readGoal,
  recordEvidenceHalf,
  registerGoal,
  startLoop,
} from "../core/loop.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");
const SUPPRESS_ENGINE = "/nonexistent-lzy-suppressed-engine";
const HOME = mkdtempSync(join(tmpdir(), "lzy-v0110-rg-"));

function repo(prefix = "lzy-v0110-rg-") {
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

function writePlan(d, text) {
  mkdirSync(join(d, ".lazyzcode"), { recursive: true });
  const p = join(d, ".lazyzcode", "plan.md");
  writeFileSync(p, text);
  return p;
}

function verdictFile(d, body) {
  const p = join(mkdtempSync(join(tmpdir(), "lzy-v0110-verdict-")), "verdicts.json");
  writeFileSync(p, JSON.stringify(body));
  return p;
}

// HEAVY goal：N1+F1，可选红半/harness，绿半可选 harness。
function heavyCycle(d, { red = false, redHarness = null, greenHarness = null, waive = false } = {}) {
  registerGoal(d, "t", "title", { tier: "heavy" });
  adoptPlan(d, writePlan(d, "- [N1] x\n- [F1] v\n"), { review: "plan-reviewer: PASS — t" });
  startLoop(d, createGit(d));
  completeStep(d, createGit(d), "N1", { note: "x" });
  if (red) recordEvidenceHalf(d, createGit(d), "F1", { half: "red", text: "改前失败", harness: redHarness });
  if (waive) recordEvidenceHalf(d, createGit(d), "F1", { half: "waived", text: "无反态可构造" });
  completeStep(d, createGit(d), "F1", { evidence: "绿半通过", harness: greenHarness });
  recordComparatorAttestation(d, verdictFile(d, { slug: "t", items: [{ fid: "F1", verdict: "MATCH", generation: 1, basis: "吻合" }] }));
}

// ── INV-09：缺红不得以补绿收口 ───────────────────────────────────────────────
test("INV-09：HEAVY 仅绿半 finish 拒且报文带恢复指路；绿后补红=反向配对即过", () => {
  const d = repo();
  heavyCycle(d, { red: false });
  assert.throws(() => finishLoop(d, createGit(d)), /INV-09.*缺红半且无豁免.*lzy evidence red F1/s);
  // 恢复路径：按指路补红（绿后录=反向配对）→ finish 过
  recordEvidenceHalf(d, createGit(d), "F1", { half: "red", text: "绿后补录的改前态失败取证" });
  const dag = loadDag(d);
  const red = dag.nodes.find((n) => n.kind === "evidence" && n.half === "red");
  const green = dag.nodes.find((n) => n.kind === "evidence" && n.half === "green");
  assert.ok(dag.edges.some((e) => e.type === "red_of" && e.from === red.id && e.to === green.id), "反向 red_of 指锚定绿");
  // ADJ-10（0.2.1 五轮双审）：反向配对的节点 seq=**锚定绿的 seq**（展示代数与 red_of 边同代；
  // 旧实现写 evidenceSeq 现值=锚绿代数+1，让 evidence list 的「红 gen2」与指向 gen1 的边互相矛盾）
  assert.equal(red.seq, green.seq, "反向配对代数对齐锚定绿");
  const { goal } = finishLoop(d, createGit(d));
  assert.equal(goal.status, "done");
});

test("INV-09：waive-red 豁免路径过门；绿前录红=原语义 pairReds 配对照常", () => {
  const d = repo();
  heavyCycle(d, { waive: true });
  const { goal } = finishLoop(d, createGit(d));
  assert.equal(goal.status, "done");
  const dag = loadDag(d);
  const green = dag.nodes.find((n) => n.kind === "evidence" && n.half === "green");
  assert.ok(dag.edges.some((e) => e.type === "red_of" && e.to === green.id), "waived 经 pairReds 配对现行绿");
});

test("INV-09：绿前录红（经典改前取证）照常过门；LIGHT 缺红不拦（机器门不涉 LIGHT）", () => {
  const d = repo();
  heavyCycle(d, { red: true });
  const { goal } = finishLoop(d, createGit(d));
  assert.equal(goal.status, "done");
  // LIGHT：无对照门无 INV-09——缺红 finish 照常过（执法在协议文本+comparator）
  const d2 = repo();
  registerGoal(d2, "t", "title");
  adoptPlan(d2, writePlan(d2, "- [N1] x\n- [F1] v\n"));
  startLoop(d2, createGit(d2));
  completeStep(d2, createGit(d2), "N1", { note: "x" });
  completeStep(d2, createGit(d2), "F1", { evidence: "仅绿半" });
  const { goal: g2 } = finishLoop(d2, createGit(d2));
  assert.equal(g2.status, "done", "LIGHT 缺红不设机器门");
});

// ── INV-08：harness 冻结 ─────────────────────────────────────────────────────
test("INV-08：红绿同 harness 过门；错配拒；缺省（未声明）不核对", () => {
  const d = repo();
  heavyCycle(d, { red: true, redHarness: "npm test -- --grep login", greenHarness: "npm test -- --grep login" });
  const { goal } = finishLoop(d, createGit(d));
  assert.equal(goal.status, "done");
  // 错配拒
  const d2 = repo();
  heavyCycle(d2, { red: true, redHarness: "npm test", greenHarness: "python -m pytest" });
  assert.throws(() => finishLoop(d2, createGit(d2)), /INV-08.*harness 错配/);
  // 红绿俱未声明 harness → 不核对，照常过
  const d3 = repo();
  heavyCycle(d3, { red: true });
  const { goal: g3 } = finishLoop(d3, createGit(d3));
  assert.equal(g3.status, "done");
});

test("INV-08 现行红口径：红重录统一 harness 后旧代红不绊门（red_of 多条、最新为现行 §4#24）；现行红错配仍拒", () => {
  const cycle = (d, greenHarness) => {
    registerGoal(d, "t", "title", { tier: "heavy" });
    adoptPlan(d, writePlan(d, "- [N1] x\n- [F1] v\n"), { review: "plan-reviewer: PASS — t" });
    startLoop(d, createGit(d));
    completeStep(d, createGit(d), "N1", { note: "x" });
    recordEvidenceHalf(d, createGit(d), "F1", { half: "red", text: "改前失败 v1", harness: "cmd v1" });
    recordEvidenceHalf(d, createGit(d), "F1", { half: "red", text: "改前失败 v2（重录统一程序）", harness: "cmd v2" });
    completeStep(d, createGit(d), "F1", { evidence: "绿半通过", harness: greenHarness });
    recordComparatorAttestation(d, verdictFile(d, { slug: "t", items: [{ fid: "F1", verdict: "MATCH", generation: 1, basis: "吻合" }] }));
  };
  // 真实形态（v024-debt-bundle finish 活体）：首录红 harness v1 → 重录红 v2（统一）→ 绿 v2
  // ⇒ finish 须过——append-only 账本上「按同一程序重录」的恢复路径必须可达，旧代红留账不执法。
  const d = repo();
  cycle(d, "cmd v2");
  const { goal } = finishLoop(d, createGit(d));
  assert.equal(goal.status, "done", "现行红（最新）与绿同源，旧代红不绊门");
  // 对照半区：现行红错配照旧执法（最新红 v2 ≠ 绿 v1 → INV-08 拒）
  const d2 = repo();
  cycle(d2, "cmd v1");
  assert.throws(() => finishLoop(d2, createGit(d2)), /INV-08.*harness 错配/, "现行红错配照旧执法");
});

test("harness 入账形态：节点带 harnessHash=harnessSpec 的 sha256；上限 300；waive 拒收", () => {
  const d = repo();
  heavyCycle(d, { red: true, redHarness: "cmd A", greenHarness: "cmd A" });
  const dag = loadDag(d);
  const red = dag.nodes.find((n) => n.kind === "evidence" && n.half === "red");
  const green = dag.nodes.find((n) => n.kind === "evidence" && n.half === "green");
  assert.equal(red.harnessHash, green.harnessHash, "同程序串同 hash");
  assert.equal(green.harnessSpec, "cmd A");
  assert.throws(() => recordEvidenceHalf(d, createGit(d), "F1", { half: "red", text: "x", harness: "y".repeat(301) }), /--harness 超上限 300/);
  assert.throws(() => recordEvidenceHalf(d, createGit(d), "F1", { half: "waived", text: "x", harness: "cmd" }), /waive-red 不收 harness/);
  assert.throws(() => completeStep(d, createGit(d), "N1", { note: "x", harness: "cmd" }), /--harness 仅 F 项支持/);
});

// ── CLI 面 ──────────────────────────────────────────────────────────────────
test("CLI：--harness 旗标贯通红绿两半；INV-09 拒面在 finish stdout 可见", () => {
  const d = repo();
  let r = cli(["loop", "register", "t", "--title", "T", "--tier", "heavy"], d);
  assert.equal(r.code, 0);
  const p = writePlan(d, "- [N1] x\n- [F1] v\n");
  r = cli(["loop", "plan", p, "--review", "plan-reviewer: PASS — t"], d);
  assert.equal(r.code, 0);
  r = cli(["loop", "start"], d);
  assert.equal(r.code, 0);
  r = cli(["step", "done", "N1", "--note", "x"], d);
  assert.equal(r.code, 0);
  r = cli(["step", "done", "F1", "--evidence", "绿半", "--harness", "npm test"], d);
  assert.equal(r.code, 0);
  assert.match(r.out, /证据已绑定/);
  r = cli(["evidence", "list"], d);
  assert.match(r.out, /🔧[0-9a-f]{8}.*🔧[0-9a-f]{8}|绿 ✓/);
  // 对照 MATCH 但缺红 → INV-09 拒
  const vf = join(mkdtempSync(join(tmpdir(), "lzy-v0110-verdict-")), "v.json");
  writeFileSync(vf, JSON.stringify({ slug: "t", items: [{ fid: "F1", verdict: "MATCH", generation: 1, basis: "吻合" }] }));
  r = cli(["attest", "comparator", "--file", vf], d);
  assert.equal(r.code, 0);
  r = cli(["loop", "finish"], d);
  assert.equal(r.code, 1);
  assert.match(r.out, /INV-09/);
  assert.match(r.out, /lzy evidence red F1/);
  // 按指路补红（带同一 harness）→ 过
  r = cli(["evidence", "red", "F1", "--evidence", "改前失败", "--harness", "npm test"], d);
  assert.equal(r.code, 0);
  assert.match(r.out, /harness [0-9a-f]{10}/);
  r = cli(["loop", "finish"], d);
  assert.equal(r.code, 0, r.out);
});

test("CLI：harness 错配在 evidence list 展示 ⚠（LIGHT 语境不拦）", () => {
  const d = repo();
  cli(["loop", "register", "t", "--title", "T"], d);
  const p = writePlan(d, "- [N1] x\n- [F1] v\n");
  cli(["loop", "plan", p], d);
  cli(["loop", "start"], d);
  cli(["step", "done", "N1", "--note", "x"], d);
  cli(["evidence", "red", "F1", "--evidence", "改前", "--harness", "cmd A"], d);
  cli(["step", "done", "F1", "--evidence", "绿半", "--harness", "cmd B"], d);
  const r = cli(["evidence", "list"], d);
  assert.equal(r.code, 0);
  assert.match(r.out, /⚠ harness 错配/);
});
