// dag-kernel 契约测试（v009 棒1）：loadDag/saveDag 原子写+校验和 fail-closed / 追加式
// 节点与边（多条 red_of 最新现行）/ dependents 与 stalePreview / dag-first 失败回滚 /
// 跨 reset 常驻 / adopt 注册 plan+review / 锁竞争（§⑪ 并发交叉点）/ 同状态双跑字节一致
// （确定性=冻结 Date.now 与 Date 构造）。
// 家法同 integrity-kernel.contract.test.js：核心直调（快、确定）+CLI spawn（隔离 HOME 双
// env、LZY_ZCODE_ENGINE 抑制）；win32 雷回避：basename 断言、不 split("/")。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGit } from "../core/git.js";
import {
  addCapturedOn,
  addSupersedes,
  appendEvidenceNode,
  appendPlanNode,
  appendReviewNode,
  addEdge,
  dependents,
  DAG_VERSION,
  emptyDag,
  findLatestGreen,
  loadDag,
  nextId,
  pairReds,
  saveDag,
  stalePreview,
} from "../core/dag.js";
import { adoptPlan, completeStep, readGoal, recordEvidenceHalf, registerGoal, resetLoop, startLoop } from "../core/loop.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");
const SUPPRESS_ENGINE = "/nonexistent-lzy-suppressed-engine";
const HOME = mkdtempSync(join(tmpdir(), "lzy-v009-home-"));

function repo(prefix = "lzy-v009-dag-") {
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

function dagFileOf(d) {
  return join(d, ".lazyzcode", "loop", "dag.json");
}

function goalJson(d) {
  return JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8"));
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// 冻结时钟（Date.now 与 Date 构造都冻——`at` 一律 Date.now() 派生，withLock owner
// 戳走 new Date()，两者都不可漂）。返回还原函数。
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

function cycle(d) {
  registerGoal(d, "t", "title");
  const p = join(d, ".lazyzcode", "plan.md");
  mkdirSync(join(d, ".lazyzcode"), { recursive: true });
  writeFileSync(p, "- [N1] x\n- [F1] v\n");
  adoptPlan(d, p);
  startLoop(d, createGit(d));
}

// ── 内核：原子写 + 校验和 + fail-closed ──────────────────────────────────────
test("saveDag→loadDag round-trip 保形，同状态双跑字节一致（冻结钟）", () => {
  const d = repo();
  const restore = freezeClock();
  try {
    const dag = emptyDag();
    const red = appendEvidenceNode(dag, { slug: "s", step: "F1", seq: 1, half: "red", surface: { kind: "external", value: "published:x@1" }, text: "r" });
    const green = appendEvidenceNode(dag, { slug: "s", step: "F1", seq: 1, half: "green", surface: { kind: "fingerprint", value: "ff".repeat(32) }, text: "g" });
    addCapturedOn(dag, green.id, { kind: "fingerprint", value: "ff".repeat(32) });
    pairReds(dag, { slug: "s", step: "F1", greenId: green.id });
    saveDag(d, dag);
    const bytes1 = readFileSync(dagFileOf(d));
    const loaded = loadDag(d);
    assert.equal(loaded.dagVersion, DAG_VERSION);
    assert.equal(loaded.nodes.length, 2);
    assert.equal(loaded.edges.length, 2);
    saveDag(d, structuredClone(loaded));
    const bytes2 = readFileSync(dagFileOf(d));
    assert.equal(bytes2.toString("utf8"), bytes1.toString("utf8"), "同状态双跑必须逐字节一致（prompt-cache/确定性家法）");
    assert.ok(red.id && green.id && red.id !== green.id);
  } finally {
    restore();
  }
});

test("tmp 家族命名与无残留：saveDag 后 loop/ 不留 .dag.json.*.tmp", () => {
  const d = repo();
  saveDag(d, emptyDag());
  const loop = join(d, ".lazyzcode", "loop");
  const residue = readdirSync(loop).filter((f) => f.endsWith(".tmp"));
  assert.deepEqual(residue, []);
  assert.ok(existsSync(dagFileOf(d)));
});

test("fail-closed 三态：JSON 损坏/校验和不符/版本不识别 都拒且带恢复指路", () => {
  const d = repo();
  const good = emptyDag();
  appendEvidenceNode(good, { slug: "s", step: "F1", seq: 1, half: "red", surface: { kind: "external", value: "x" }, text: "r" });
  saveDag(d, good);
  const p = dagFileOf(d);
  const original = readFileSync(p, "utf8");
  writeFileSync(p, "{corrupt");
  assert.throws(() => loadDag(d), /JSON 解析失败.*恢复/s);
  // 篡改节点真值（无关新键会被载荷归一丢弃，须动 nodes/edges 载荷本体）
  writeFileSync(p, original.replace('"text": "r"', '"text": "tampered"'));
  assert.throws(() => loadDag(d), /校验和不符.*恢复/s);
  const obj = JSON.parse(original);
  obj.dagVersion = 99;
  delete obj.checksum;
  obj.checksum = createHash("sha256").update(JSON.stringify({ dagVersion: obj.dagVersion, nodes: obj.nodes, edges: obj.edges })).digest("hex");
  writeFileSync(p, JSON.stringify(obj, null, 2));
  assert.throws(() => loadDag(d), /版本不兼容/s);
});

test("缺席账本=空库（首次使用零误差）", () => {
  const d = repo();
  const dag = loadDag(d);
  assert.deepEqual(dag, { dagVersion: DAG_VERSION, nodes: [], edges: [] });
});

// ADJ-24（0.0.10）：同代次第二条红半附件曾静默覆写第一条（账本 sha256 成假声明）；
// 附件名现带节点身份永不碰撞，账本写失败不留半截附件。
test("红半附件带节点身份：同代次两条红半共存不覆写且 sha256 属真；账本写失败不留附件", () => {
  const d = repo();
  registerGoal(d, "t", "title");
  const p = join(d, ".lazyzcode", "plan.md");
  mkdirSync(join(d, ".lazyzcode"), { recursive: true });
  writeFileSync(p, "- [F1] v\n");
  adoptPlan(d, p);
  startLoop(d, createGit(d));
  const shot = join(d, "shot.png");
  writeFileSync(shot, "PNGDATA-A");
  const r1 = recordEvidenceHalf(d, createGit(d), "F1", { half: "red", text: "第一条红半", files: [shot] });
  writeFileSync(shot, "PNGDATA-B");
  const r2 = recordEvidenceHalf(d, createGit(d), "F1", { half: "red", text: "第二条红半", files: [shot] });
  assert.notEqual(r1.node.id, r2.node.id, "同代次两条红半=两个节点");
  assert.notEqual(r1.node.files[0].path, r2.node.files[0].path, "附件落两个文件");
  assert.match(r2.node.files[0].path, /\.gen1\.n\d+\.1\.png$/);
  for (const rec of [r1, r2]) {
    const content = readFileSync(join(d, rec.node.files[0].path));
    assert.equal(createHash("sha256").update(content).digest("hex"), rec.node.files[0].sha256, "账本 sha256 与盘面一致");
  }
  // 失败路径：账本不可读（写护栏拒）→ 整命令拒且不留半截附件
  const dagFile = dagFileOf(d);
  const before = readFileSync(dagFile, "utf8");
  if (process.platform !== "win32") {
    chmodSync(dagFile, 0o000);
    try {
      assert.throws(
        () => recordEvidenceHalf(d, createGit(d), "F1", { half: "red", text: "第三条", files: [shot] }),
        /不可读/,
      );
    } finally {
      chmodSync(dagFile, 0o644);
    }
    assert.equal(readFileSync(dagFile, "utf8"), before, "账本字节未动");
    const leftovers = readdirSync(join(d, ".lazyzcode", "evidence")).filter((f) => f.endsWith(".png"));
    assert.equal(leftovers.length, 2, "失败命令不落第三份附件");
  }
});

// ADJ-01 P0（0.0.10）：不可读曾被裸 catch 当空库，下一写命令整库覆写毁红/waive 唯一
// 副本（红半探针 adj01-chmod-destroy.txt 活体）。回归钉：仅 ENOENT 当缺席。
test("不可读三态：EACCES（POSIX 腿）/EISDIR/形状畸形（缺 edges 键、nodes:[null]、坏边）都 DagError 拒且带恢复指路", () => {
  const d = repo();
  const good = emptyDag();
  appendEvidenceNode(good, { slug: "s", step: "F1", seq: 1, half: "red", surface: { kind: "external", value: "x" }, text: "r" });
  saveDag(d, good);
  const p = dagFileOf(d);
  const original = readFileSync(p, "utf8");
  if (process.platform !== "win32") {
    chmodSync(p, 0o000);
    try {
      assert.throws(() => loadDag(d), /不可读.*EACCES.*毁掉红/s);
    } finally {
      chmodSync(p, 0o644);
    }
  }
  rmSync(p);
  mkdirSync(p);
  try {
    assert.throws(() => loadDag(d), /不可读.*EISDIR.*恢复/s);
  } finally {
    rmSync(p, { recursive: true });
    writeFileSync(p, original);
  }
  const rewrite = (mutate) => {
    const obj = JSON.parse(original);
    mutate(obj);
    delete obj.checksum;
    obj.checksum = createHash("sha256")
      .update(JSON.stringify({ dagVersion: obj.dagVersion, nodes: obj.nodes, edges: obj.edges }))
      .digest("hex");
    writeFileSync(p, JSON.stringify(obj, null, 2));
  };
  rewrite((o) => {
    delete o.edges;
  });
  assert.throws(() => loadDag(d), /形状畸形（nodes\/edges 须为数组）.*恢复/s);
  rewrite((o) => {
    o.nodes = [null];
  });
  assert.throws(() => loadDag(d), /形状畸形（节点缺 id\/kind.*恢复/s);
  rewrite((o) => {
    o.edges = [{ type: "bogus", from: "n1", to: "n2" }];
  });
  assert.throws(() => loadDag(d), /形状畸形（边缺 type\/from\/to.*恢复/s);
});

// ADJ-01 配套：写护栏——盘上不可读或有载荷而内存空账本一律拒落盘（rename 不看目标
// 文件权限，护栏是 EACCES 场景下防覆写的最后一线）。
test("写护栏：盘上有载荷而内存空账本拒写且盘面原样；盘上不可读拒落盘（POSIX 腿）", () => {
  const d = repo();
  const p = dagFileOf(d);
  const good = emptyDag();
  appendEvidenceNode(good, { slug: "s", step: "F1", seq: 1, half: "red", surface: { kind: "external", value: "x" }, text: "r" });
  saveDag(d, good);
  const before = readFileSync(p, "utf8");
  assert.throws(() => saveDag(d, emptyDag()), /写护栏.*拒绝覆写.*重新加载账本/s);
  assert.equal(readFileSync(p, "utf8"), before);
  assert.equal(loadDag(d).nodes.length, 1);
  if (process.platform !== "win32") {
    chmodSync(p, 0o000);
    try {
      assert.throws(() => saveDag(d, good), /写护栏拒绝落盘/s);
    } finally {
      chmodSync(p, 0o644);
    }
  }
});

// ── 查询原语 ────────────────────────────────────────────────────────────────
test("dependents：节点 id 双向命中；表面值走 captured_on；多条 red_of 取最新", () => {
  const dag = emptyDag();
  const red = appendEvidenceNode(dag, { slug: "s", step: "F1", seq: 1, half: "red", surface: { kind: "external", value: "base" }, text: "r" });
  const g1 = appendEvidenceNode(dag, { slug: "s", step: "F1", seq: 1, half: "green", surface: { kind: "fingerprint", value: "h1" }, text: "g1" });
  const g2 = appendEvidenceNode(dag, { slug: "s", step: "F1", seq: 2, half: "green", surface: { kind: "fingerprint", value: "h2" }, text: "g2" });
  addCapturedOn(dag, g1.id, { kind: "fingerprint", value: "h1" });
  addCapturedOn(dag, g2.id, { kind: "fingerprint", value: "h2" });
  addSupersedes(dag, g1.id, g2.id);
  assert.equal(pairReds(dag, { slug: "s", step: "F1", greenId: g1.id }), 1);
  // rebind：同一 red 再配新绿（ADJ-04 实现追文档：多条 red_of 合法，追加不删，最新为现行）
  assert.equal(pairReds(dag, { slug: "s", step: "F1", greenId: g2.id }), 1, "已配对的 red rebind 时重配新绿");
  const fromRed = dependents(dag, red.id);
  const redOfs = fromRed.hits.filter((h) => h.edge.type === "red_of");
  assert.equal(redOfs.length, 2, "两条 red_of 历史（→g1 与 →g2），现行取最新");
  const bySurface = dependents(dag, "h2");
  assert.equal(bySurface.kind, "surface");
  assert.equal(bySurface.hits.length, 1);
  assert.equal(bySurface.hits[0].node.id, g2.id);
  const ofPlan = emptyDag();
  const plan = appendPlanNode(ofPlan, { slug: "s", planHash: "ph" });
  const review = appendReviewNode(ofPlan, { planHash: "ph", verdict: "PASS x" });
  addEdge(ofPlan, { type: "reviews", from: review.id, to: plan.id });
  addEdge(ofPlan, { type: "plans", from: plan.id, to: "s" });
  const deps = dependents(ofPlan, plan.id);
  assert.equal(deps.hits.length, 2, "plan 节点双向：reviews 入边+plans 出边");
});

test("stalePreview 五态：fresh/stale/superseded/external/null 指纹", () => {
  const dag = emptyDag();
  appendEvidenceNode(dag, { slug: "s", step: "F1", seq: 1, half: "green", surface: { kind: "fingerprint", value: "h1" }, text: "" });
  const g2 = appendEvidenceNode(dag, { slug: "s", step: "F1", seq: 2, half: "green", surface: { kind: "fingerprint", value: "h2" }, text: "" });
  appendEvidenceNode(dag, { slug: "s", step: "F2", seq: 1, half: "green", surface: { kind: "external", value: "pub@1" }, text: "" });
  const g4 = appendEvidenceNode(dag, { slug: "s", step: "F3", seq: 1, half: "green", surface: null, text: "" });
  addSupersedes(dag, dag.nodes[0].id, g2.id);
  const map = new Map(stalePreview(dag, "h2").map((x) => [x.node.id, x.status]));
  assert.equal(map.get(dag.nodes[0].id), "superseded");
  assert.equal(map.get(g2.id), "fresh");
  assert.equal(map.get(dag.nodes[2].id), "external");
  assert.equal(map.get(g4.id), "unknown");
  assert.ok(findLatestGreen(dag, "s", "F1").id === g2.id);
  assert.equal(nextId(dag), `n${dag.nodes.length + 1}`);
});

// ── 接线行为（核心直调） ────────────────────────────────────────────────────
test("dag-first：corrupt 账本令 step done 整命令拒且 goal.json 不动", () => {
  const d = repo();
  cycle(d);
  writeFileSync(dagFileOf(d), "{corrupt");
  const before = sha256(readFileSync(join(d, ".lazyzcode", "loop", "goal.json")));
  assert.throws(() => completeStep(d, createGit(d), "F1", { evidence: "绿半" }), /恢复/);
  const after = sha256(readFileSync(join(d, ".lazyzcode", "loop", "goal.json")));
  assert.equal(after, before, "dag-first：账本写失败=goal.json 零改动（重试安全）");
  assert.equal(goalJson(d).steps.find((s) => s.id === "F1").status, "pending");
});

test("adoptPlan 注册 plan+review 节点与 reviews/plans 边；step done 镜像 green 并配对 red", () => {
  const d = repo();
  registerGoal(d, "t", "title");
  const p = join(d, ".lazyzcode", "plan.md");
  mkdirSync(join(d, ".lazyzcode"), { recursive: true });
  writeFileSync(p, "- [F1] v\n");
  adoptPlan(d, p, { review: "plan-reviewer: PASS — t" });
  let dag = loadDag(d);
  const planNode = dag.nodes.find((n) => n.kind === "plan");
  const reviewNode = dag.nodes.find((n) => n.kind === "review");
  assert.ok(planNode && reviewNode, "采纳即注册 plan+review");
  assert.equal(reviewNode.planHash, planNode.planHash);
  assert.ok(dag.edges.some((e) => e.type === "reviews" && e.from === reviewNode.id && e.to === planNode.id));
  assert.ok(dag.edges.some((e) => e.type === "plans" && e.to === "t"));
  startLoop(d, createGit(d));
  recordEvidenceHalf(d, createGit(d), "F1", { half: "red", text: "红半" });
  completeStep(d, createGit(d), "F1", { evidence: "绿半" });
  dag = loadDag(d);
  const green = dag.nodes.find((n) => n.kind === "evidence" && n.half === "green");
  const red = dag.nodes.find((n) => n.kind === "evidence" && n.half === "red");
  assert.ok(green && red);
  assert.ok(dag.edges.some((e) => e.type === "red_of" && e.from === red.id && e.to === green.id), "green 落地回填 red_of");
  const goal = goalJson(d);
  assert.equal(green.seq, (goal.steps.find((s) => s.id === "F1").evidenceSeq ?? 1) - 1, "green gen=落地取证代数");
});

test("rebind：二次取证追加 supersedes 与新 captured_on，旧 red_of 保留（历史）", () => {
  const d = repo();
  cycle(d);
  completeStep(d, createGit(d), "F1", { evidence: "绿1" });
  writeFileSync(join(d, "a.txt"), "b\n");
  spawnSync("git", ["add", "a.txt"], { cwd: d });
  spawnSync("git", ["commit", "-qm", "c2"], { cwd: d });
  completeStep(d, createGit(d), "F1", { evidence: "绿2" });
  const dag = loadDag(d);
  const greens = dag.nodes.filter((n) => n.kind === "evidence" && n.half === "green");
  assert.equal(greens.length, 2);
  assert.ok(dag.edges.some((e) => e.type === "supersedes" && e.from === greens[1].id && e.to === greens[0].id));
});

test("跨 reset 常驻：resetLoop 后 dag.json 与节点原样（照 metrics.json 先例）", () => {
  const d = repo();
  cycle(d);
  completeStep(d, createGit(d), "F1", { evidence: "绿" });
  const before = readFileSync(dagFileOf(d), "utf8");
  resetLoop(d, createGit(d));
  assert.equal(readFileSync(dagFileOf(d), "utf8"), before);
  assert.ok(!existsSync(join(d, ".lazyzcode", "loop", "goal.json")));
});

test("锁竞争（§⑪ 交叉点）：持锁在 forces evidence red 等满 5s 后 LoopError", () => {
  const d = repo();
  cycle(d);
  mkdirSync(join(d, ".lazyzcode", "loop", ".lock")); // 无 owner.json=必等满 LOCK_WAIT_MS
  const t0 = Date.now();
  assert.throws(() => recordEvidenceHalf(d, createGit(d), "F1", { half: "red", text: "x" }), /持锁/);
  const waited = Date.now() - t0;
  assert.ok(waited >= 4_500, `等锁应≥4.5s（实测 ${waited}ms）`);
});

test("CLI 双跑字节一致（list 同状态 stdout 逐字节同）+ 引擎抑制不触真引擎", () => {
  const d = repo();
  cycle(d);
  recordEvidenceHalf(d, createGit(d), "F1", { half: "red", text: "红半" });
  const r1 = cli(["evidence", "list"], d);
  const r2 = cli(["evidence", "list"], d);
  assert.equal(r1.code, 0);
  assert.equal(r2.out, r1.out, "list 同状态双跑逐字节一致");
});

// ADJ-44/04（0.0.10）：跨 reset 同 slug 重注册=新实例（attempt 戳）——配对与 supersedes
// 限本实例；rebind 时同实例 red 重配现行绿（实现追文档）。
test("跨实例隔离：旧实例红不配新实例绿、supersedes 不跨实例；同实例 rebind 重配对", () => {
  const d = repo();
  registerGoal(d, "t", "title");
  let p = join(d, ".lazyzcode", "plan.md");
  mkdirSync(join(d, ".lazyzcode"), { recursive: true });
  writeFileSync(p, "- [F1] v\n");
  adoptPlan(d, p);
  startLoop(d, createGit(d));
  recordEvidenceHalf(d, createGit(d), "F1", { half: "red", text: "实例1红半" });
  completeStep(d, createGit(d), "F1", { evidence: "实例1绿" });
  resetLoop(d, createGit(d));
  // 实例2：同 slug 重注册（账本常驻，attempt 推导=2）
  registerGoal(d, "t", "title");
  writeFileSync(p, "- [F1] v\n");
  adoptPlan(d, p);
  startLoop(d, createGit(d));
  completeStep(d, createGit(d), "F1", { evidence: "实例2绿（无红半）" });
  const dag = loadDag(d);
  assert.equal(goalJson(d).attempt, 2, "attempt 从账本既有戳推导");
  const greens = dag.nodes.filter((n) => n.kind === "evidence" && n.half === "green");
  const g1 = greens.find((n) => n.attempt === 1);
  const g2 = greens.find((n) => n.attempt === 2);
  assert.ok(g1 && g2, "两实例各带戳");
  const redOfs = dag.edges.filter((e) => e.type === "red_of");
  assert.equal(redOfs.length, 1, "仅实例1 内部一条配对");
  assert.equal(redOfs[0].to, g1.id);
  assert.ok(!dag.edges.some((e) => e.type === "supersedes" && (e.to === g1.id || e.from === g1.id)), "supersedes 不跨实例");
  // 实例2 rebind：本实例红半（新录）重配现行绿
  recordEvidenceHalf(d, createGit(d), "F1", { half: "red", text: "实例2红半" });
  writeFileSync(join(d, "a.txt"), "b\n");
  spawnSync("git", ["add", "a.txt"], { cwd: d });
  spawnSync("git", ["commit", "-qm", "c2"], { cwd: d });
  completeStep(d, createGit(d), "F1", { evidence: "实例2绿2" });
  const dag2 = loadDag(d);
  const g2b = dag2.nodes.filter((n) => n.kind === "evidence" && n.half === "green" && n.attempt === 2);
  assert.equal(g2b.length, 2, "实例2 两代绿");
  const red2 = dag2.nodes.find((n) => n.kind === "evidence" && n.half === "red" && n.text === "实例2红半");
  const red2Edges = dag2.edges.filter((e) => e.type === "red_of" && e.from === red2.id);
  assert.equal(red2Edges.length, 1, "实例2 红半只配其落地后的现行绿（g2b）；重配对语义由 dependents 单测钉");
  assert.equal(red2Edges[0].to, g2b[1].id);
});
