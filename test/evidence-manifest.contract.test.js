// evidence-manifest 契约测试（v009 棒1）：lzy evidence red/waive-red 表面各绑各面 /
// waive 必填理由 / 非 F 项拒 / 绿半配对与 rebind supersedes / manifest 视图（halves 行、
// rebind 链、waive 理由、口径句）/ 孤儿 green 超前代数标注 / 历史 --goal 读面 /
// doctor dag.json 豁免无疤痕误警 + .dag.json.*.tmp 计数与 reset 清扫 / 无 goal 恢复式报错零疤痕。
// 家法同 dag-kernel.contract.test.js：CLI spawn（隔离 HOME 双 env+引擎抑制）；win32 雷回避。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendEvidenceNode, loadDag, saveDag } from "../core/dag.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");
const SUPPRESS_ENGINE = "/nonexistent-lzy-suppressed-engine";
const HOME = mkdtempSync(join(tmpdir(), "lzy-v009-ev-home-"));

function repo(prefix = "lzy-v009-ev-") {
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

function doctorLine(d, name) {
  const r = cli(["doctor"], d);
  return r.out.split(/\r?\n/).filter((l) => l.trim().startsWith("➖") || l.trim().startsWith("✔") || l.trim().startsWith("⚠") || l.trim().startsWith("✖")).find((l) => l.includes(name));
}

function setup(d, plan = "- [N1] x\n- [F1] v one\n- [F2] v two\n") {
  assert.equal(cli(["loop", "register", "t", "--title", "t"], d).code, 0);
  mkdirSync(join(d, ".lazyzcode"), { recursive: true });
  writeFileSync(join(d, ".lazyzcode", "plan.md"), plan);
  assert.equal(cli(["loop", "plan", ".lazyzcode/plan.md"], d).code, 0);
  assert.equal(cli(["loop", "start"], d).code, 0);
}

test("evidence red：缺省绑复合指纹面；--surface 绑外部面（红绿各绑各面）", () => {
  const d = repo();
  setup(d);
  const r1 = cli(["evidence", "red", "F1", "--evidence", "红半：改前断言失败"], d);
  assert.equal(r1.code, 0, r1.out);
  assert.match(r1.out, /红半账本已记/);
  assert.match(r1.out, /fingerprint:[0-9a-f]{10}/);
  const r2 = cli(["evidence", "red", "F2", "--evidence", "红半：已发布版失败", "--surface", "published:lazyzcode@0.0.8"], d);
  assert.equal(r2.code, 0, r2.out);
  assert.match(r2.out, /external:published:lazyzcode@0\.0\.8/);
  const dag = loadDag(d);
  const reds = dag.nodes.filter((n) => n.half === "red");
  assert.equal(reds.length, 2);
  assert.equal(reds[0].surface.kind, "fingerprint");
  assert.equal(reds[1].surface.kind, "external");
  assert.ok(dag.edges.some((e) => e.type === "captured_on" && e.to.kind === "external"));
});

test("waive-red：必填 --reason；合法豁免=waived 节点无表面；非 F 项与缺 id 拒", () => {
  const d = repo();
  setup(d);
  const noReason = cli(["evidence", "waive-red", "F1"], d);
  assert.equal(noReason.code, 1);
  assert.match(noReason.out, /--reason/);
  const onN = cli(["evidence", "red", "N1", "--evidence", "x"], d);
  assert.equal(onN.code, 1);
  assert.match(onN.out, /只记 F 项/);
  const ok = cli(["evidence", "waive-red", "F1", "--reason", "纯可达性面构造不出反态"], d);
  assert.equal(ok.code, 0, ok.out);
  const dag = loadDag(d);
  const waived = dag.nodes.find((n) => n.half === "waived");
  assert.ok(waived);
  assert.equal(waived.surface, null, "waived 本无红表面");
  assert.ok(!dag.edges.some((e) => e.type === "captured_on" && e.from === waived.id));
});

test("绿半落地配对 red_of；rebind 追加 supersedes、旧 red_of 保留（多条最新现行）", () => {
  const d = repo();
  setup(d, "- [F1] v\n");
  cli(["evidence", "red", "F1", "--evidence", "红半"], d);
  cli(["step", "done", "F1", "--evidence", "绿1"], d);
  let dag = loadDag(d);
  const red = dag.nodes.find((n) => n.half === "red");
  const greens = () => dag.nodes.filter((n) => n.half === "green");
  assert.ok(dag.edges.some((e) => e.type === "red_of" && e.from === red.id && e.to === greens()[0].id));
  writeFileSync(join(d, "a.txt"), "b\n");
  spawnSync("git", ["add", "a.txt"], { cwd: d });
  spawnSync("git", ["commit", "-qm", "c2"], { cwd: d });
  cli(["step", "done", "F1", "--evidence", "绿2（rebind）"], d);
  dag = loadDag(d);
  assert.equal(greens().length, 2);
  const bySeq = greens().sort((a, b) => a.seq - b.seq);
  assert.ok(dag.edges.some((e) => e.type === "supersedes" && e.from === bySeq[1].id && e.to === bySeq[0].id));
  const redOfs = dag.edges.filter((e) => e.type === "red_of" && e.from === red.id);
  assert.equal(redOfs.length, 1, "已配对 red 不重复配（历史经 supersedes 链可见）");
});

test("manifest 视图：halves 行+rebind 链+waive 理由+口径句；ghost 落账本后孤儿行如实标注", () => {
  const d = repo();
  setup(d, "- [F1] v one\n- [F2] v two\n");
  cli(["evidence", "waive-red", "F2", "--reason", "纯可达性面构造不出反态"], d);
  cli(["step", "done", "F1", "--evidence", "绿1"], d);
  writeFileSync(join(d, "a.txt"), "b\n");
  spawnSync("git", ["add", "a.txt"], { cwd: d });
  spawnSync("git", ["commit", "-qm", "c2"], { cwd: d });
  cli(["step", "done", "F1", "--evidence", "绿2"], d);
  const r = cli(["evidence", "list"], d);
  assert.equal(r.code, 0);
  assert.match(r.out, /只记账不裁决/);
  assert.match(r.out, /F1 · 绿 ✓ gen2/);
  assert.match(r.out, /rebind 链 2 代（gen1→gen2，现行 gen2）/);
  assert.match(r.out, /F2 · 绿 ✗（未录） · 红 ➖ waived（「纯可达性面构造不出反态」）/);
  assert.doesNotMatch(r.out, /孤儿节点/);
  // dag-first 部分失败残留形态：账本 green 代数超前 goal.json → 视图如实标注不隐藏
  const dag = loadDag(d);
  appendEvidenceNode(dag, { slug: "t", step: "F1", seq: 9, half: "green", surface: null, text: "residue" });
  saveDag(d, dag);
  const r2 = cli(["evidence", "list"], d);
  assert.equal(r2.code, 0);
  assert.match(r2.out, /孤儿节点 n\d+（t\/F1 gen9）：账本有而 goal\.json 无此代数记录/);
});

test("无 goal 无 --goal：恢复式报错+exit1+零疤痕（目录都不建）", () => {
  const d = repo();
  const r = cli(["evidence", "list"], d);
  assert.equal(r.code, 1);
  assert.match(r.out, /本目录没有目标循环状态/);
  assert.match(r.out, /--goal/);
  assert.ok(!existsSync(join(d, ".lazyzcode")), "读路径绝不留 .lazyzcode 疤痕");
});

test("历史账本：reset 后 --goal <slug> 仍可读（孤儿判定缺席基准如实声明）", () => {
  const d = repo();
  setup(d, "- [F1] v\n");
  cli(["step", "done", "F1", "--evidence", "绿"], d);
  cli(["loop", "reset"], d);
  const r = cli(["evidence", "list", "--goal", "t"], d);
  assert.equal(r.code, 0);
  assert.match(r.out, /绿 ✓ gen1/);
  assert.match(r.out, /无孤儿判定基准/);
});

test("doctor：dag.json 豁免无疤痕误警；孤儿 .dag.json.*.tmp 入残留计数；reset 清扫", () => {
  const d = repo();
  setup(d, "- [F1] v\n");
  cli(["step", "done", "F1", "--evidence", "绿"], d);
  cli(["loop", "reset"], d);
  // reset 后 loop/ 只剩 salvage+dag.json（+快照/度量）——state 行必须是 ok 不是疤痕
  const line = doctorLine(d, "state");
  assert.ok(line, "doctor 应有 state 行");
  assert.match(line, /✔|无目标循环状态（干净）|干净/);
  assert.doesNotMatch(line, /疤痕/);
  // 孤儿 tmp：计入残留 warn，且 reset 清扫
  writeFileSync(join(d, ".lazyzcode", "loop", ".dag.json.999.1700000000000.tmp"), "x");
  const warnLine = doctorLine(d, "state");
  assert.match(warnLine, /孤儿 tmp 1 个/);
  assert.equal(cli(["loop", "reset"], d).code, 0);
  const leftovers = readdirSync(join(d, ".lazyzcode", "loop")).filter((f) => f.endsWith(".tmp"));
  assert.deepEqual(leftovers, [], "reset 必须清扫 .dag.json.*.tmp 家族");
});

test("dag dependents：plan 节点查得 reviews 边与 slug 世系（F4 面形状）", () => {
  const d = repo();
  assert.equal(cli(["loop", "register", "t", "--title", "t"], d).code, 0);
  mkdirSync(join(d, ".lazyzcode"), { recursive: true });
  writeFileSync(join(d, ".lazyzcode", "plan.md"), "- [F1] v\n");
  cli(["loop", "plan", ".lazyzcode/plan.md", "--review", "plan-reviewer: PASS — t"], d);
  const r = cli(["dag", "dependents", "n1"], d);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /→ plans t/);
  assert.match(r.out, /← reviews n2 review/);
  const bad = cli(["dag", "dependents"], d);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /用法/);
});
