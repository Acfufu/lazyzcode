// dag-authority 契约测试（v009 棒2）：verify/finish 切中央 DAG 统一权威——代次锚定选择
// （孤儿 ghost 不可现行不阻断）/ legacy 双轨 0.0.8 原文 / 账本-goal 分歧 fail-closed /
// 损坏账本三读面拒 / comparator attestation 机器门四态+LIGHT 免门 / 终验 attestation /
// doctor payload-ver 三态 / fail-fast 无壳 / comparator dependents / 锁竞争（§⑪ 交叉点）。
// 家法同 dag-kernel.contract.test.js：核心直调+CLI spawn（隔离 HOME 双 env、引擎抑制）；
// 校验和类篡改必须动 nodes/edges 载荷本体（无关新键会被归一丢弃——伪断言必失败）；
// 对照结论文件写在仓外（untracked 杂物会触发 finish 完整性闸门 dirty 拒）。
import { test } from "node:test";
// 人权门非本文件被测面（门由 human-gate.contract.test.js 两面钉）——spawn 继承此 env 保采纳畅通
process.env.LZY_ABLATE_HUMAN_GATE = "1";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGit } from "../core/git.js";
import {
  appendComparatorNode,
  appendEvidenceNode,
  dependents,
  emptyDag,
  findGreenByGeneration,
  findLatestComparator,
  loadDag,
  saveDag,
  stalePreview,
} from "../core/dag.js";
import {
  addSubject,
  adoptPlan,
  completeStep,
  finishLoop,
  readGoal,
  recordEvidenceHalf,
  registerGoal,
  resetLoop,
  setTier,
  startLoop,
  verifyEvidence,
  writeGoalReport,
} from "../core/loop.js";
import { recordComparatorAttestation } from "../core/attest.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");
const SUPPRESS_ENGINE = "/nonexistent-lzy-suppressed-engine";
const HOME = mkdtempSync(join(tmpdir(), "lzy-v009-home-"));
const CLI_VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

function repo(prefix = "lzy-v009-auth-") {
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

function commitAll(d, msg) {
  spawnSync("git", ["add", "-A"], { cwd: d });
  spawnSync("git", ["commit", "-qm", msg], { cwd: d });
}

// 造一个已取证的 executing goal（F1 红半+绿半已入账本），heavy=true 时走 HEAVY 采纳门。
// red=false 造缺红夹具（0.1.0 棒B INV-09 拒面测试专用；默认红半在场=0.0.10 行为基线）。
function cycle(d, { heavy = false, red = true } = {}) {
  registerGoal(d, "t", "title", { tier: heavy ? "heavy" : "light" });
  const p = join(d, ".lazyzcode", "plan.md");
  mkdirSync(join(d, ".lazyzcode"), { recursive: true });
  writeFileSync(p, "- [N1] x\n- [F1] v\n");
  adoptPlan(d, p, heavy ? { review: "plan-reviewer: PASS — t" } : undefined);
  startLoop(d, createGit(d));
  completeStep(d, createGit(d), "N1", { note: "x" });
  if (red) recordEvidenceHalf(d, createGit(d), "F1", { half: "red", text: "改前态失败取证" });
  completeStep(d, createGit(d), "F1", { evidence: "绿半" });
}

// 合法校验和下篡改账本（mutate 收到已解析载荷，动 nodes/edges 本体）。
function tamperLedger(d, mutate) {
  const p = dagFileOf(d);
  const obj = JSON.parse(readFileSync(p, "utf8"));
  mutate(obj);
  const payload = { dagVersion: obj.dagVersion, nodes: obj.nodes, edges: obj.edges };
  const out = { ...payload, checksum: createHash("sha256").update(JSON.stringify(payload)).digest("hex") };
  writeFileSync(p, `${JSON.stringify(out, null, 2)}\n`);
}

// 对照结论文件：写在仓外 tmp（untracked 杂物会脏树拦 finish）。
function verdictFile(d, body) {
  const p = join(mkdtempSync(join(tmpdir(), "lzy-v009-verdict-")), "verdicts.json");
  writeFileSync(p, typeof body === "string" ? body : JSON.stringify(body));
  return p;
}

function attestationFiles(d) {
  return readdirSync(join(d, ".lazyzcode", "attestations")).filter((f) => f.endsWith(".json"));
}

function finishWithReport(d) {
  return finishLoop(d, createGit(d), { writeReport: (o) => writeGoalReport(o.cwd, o.git, o.goal) });
}

// ── ① 权威翻转：判定随账本节点翻转（权威=账本非 goal.json）──────────────────
test("权威翻转：合法校验和下改绿节点 surface 值→verify 由新鲜翻过期（goal.json 未动）", () => {
  const d = repo();
  cycle(d);
  assert.equal(verifyEvidence(d, createGit(d)).stale.length, 0);
  const goalFpBefore = goalJson(d).steps.find((s) => s.id === "F1").evidence.fingerprint;
  tamperLedger(d, (obj) => {
    for (const n of obj.nodes) {
      if (n.kind === "evidence" && n.half === "green" && n.surface) {
        n.surface.value = `deadbeef${n.surface.value.slice(8)}`;
      }
    }
  });
  const v = verifyEvidence(d, createGit(d));
  assert.equal(v.stale.map((s) => s.id).join(","), "F1", "判定随账本节点翻转");
  assert.equal(v.fresh.length, 0);
  assert.equal(goalJson(d).steps.find((s) => s.id === "F1").evidence.fingerprint, goalFpBefore, "goal.json 仍是旧指纹——权威不在它");
});

// ── ② legacy 双轨：treeHash 形态记录走 0.0.8 原文（判定不查账本节点）─────────
test("legacy 双轨：treeHash 形态证据不查锚定节点（新鲜/过期 0.0.8 行为逐字段同）", () => {
  const d = repo();
  cycle(d);
  // 覆写成 0.0.7 形态证据（integrity-kernel 配方）：hash=当前头树，删代数指针
  const goal = readGoal(d);
  const step = goal.steps.find((s) => s.id === "F1");
  step.evidence = { text: "legacy", treeHash: createGit(d).headTreeHash(), at: new Date().toISOString() };
  delete step.evidenceSeq;
  writeFileSync(join(d, ".lazyzcode", "loop", "goal.json"), `${JSON.stringify(goal, null, 2)}\n`);
  // 账本里把该绿节点面改错值也影响不到 legacy 轨（它不读锚定节点）
  tamperLedger(d, (obj) => {
    for (const n of obj.nodes) {
      if (n.kind === "evidence" && n.half === "green" && n.surface) n.surface.value = "wrong";
    }
  });
  assert.equal(verifyEvidence(d, createGit(d)).fresh.map((s) => s.id).join(","), "F1");
  writeFileSync(join(d, "a.txt"), "b\n");
  commitAll(d, "c2");
  assert.equal(verifyEvidence(d, createGit(d)).stale.map((s) => s.id).join(","), "F1");
});

// ── ③ 账本-goal 分歧：fingerprint 形态无锚定节点 → fail-closed ───────────────
test("账本分歧：删绿节点（合法校验和）→ verify/status 拒「账本不一致」带恢复指路", () => {
  const d = repo();
  cycle(d);
  tamperLedger(d, (obj) => {
    obj.nodes = obj.nodes.filter((n) => !(n.kind === "evidence" && n.half === "green"));
  });
  assert.throws(() => verifyEvidence(d, createGit(d)), /账本不一致.*恢复.*step done F1/s);
  const v = cli(["loop", "verify"], d);
  assert.equal(v.code, 1);
  assert.match(v.out, /账本不一致/);
  const st = cli(["loop", "status"], d);
  assert.equal(st.code, 1, "status 读面同拒（不降级静默通过）");
  assert.match(st.out, /账本不一致/);
});

// ── ④ 损坏账本：verify/finish 双拒，goal.json 不动、状态保持 executing ───────
test("损坏账本：finish 拒（DagError 透传）且 goal.json 字节不动、状态保持 executing", () => {
  const d = repo();
  cycle(d);
  writeFileSync(dagFileOf(d), "{corrupt");
  const before = sha256(readFileSync(join(d, ".lazyzcode", "loop", "goal.json")));
  assert.throws(() => finishLoop(d, createGit(d)), /JSON 解析失败.*恢复/s);
  assert.equal(sha256(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"))), before);
  assert.equal(readGoal(d).status, "executing");
  const v = cli(["loop", "verify"], d);
  assert.equal(v.code, 1);
  assert.match(v.out, /恢复/);
});

// ── ⑤ 孤儿 ghost：锚定语义下不可现行、不阻断；list 面 ⚠ 兜底（两段式） ──────
test("孤儿 ghost：植更高代次合法绿节点→判定不变；evidence list 标 ⚠ 孤儿", () => {
  const d = repo();
  cycle(d);
  const list1 = cli(["evidence", "list"], d);
  assert.equal(list1.code, 0);
  assert.doesNotMatch(list1.out, /孤儿/);
  // 植 ghost：loadDag→append seq=2 绿节点（值=活指纹，带本实例戳=dag-first 半失败残留
  // 的现实形态）→saveDag（全合法，校验和过）
  const dag = loadDag(d);
  const fp = verifyEvidence(d, createGit(d)).fingerprint;
  const ghost = appendEvidenceNode(dag, { slug: "t", step: "F1", seq: 2, half: "green", surface: { kind: "fingerprint", value: fp }, text: "ghost", attempt: goalJson(d).attempt });
  saveDag(d, dag);
  assert.ok(findGreenByGeneration(loadDag(d), "t", "F1", 1), "锚定 gen1 仍命中");
  const v = verifyEvidence(d, createGit(d));
  assert.equal(v.fresh.map((s) => s.id).join(","), "F1", "孤儿不可现行：判定不随 ghost 翻");
  const list2 = cli(["evidence", "list"], d);
  assert.match(list2.out, new RegExp(`孤儿节点 ${ghost.id}`), "list ⚠ 兜底如实标注");
});

// ── ⑥ comparator attestation：四态 + LIGHT 免门 ─────────────────────────────
test("HEAVY finish 机器门：缺席拒→MISMATCH 拒→MATCH 过；指纹过期拒→重录过", () => {
  const d = repo();
  cycle(d, { heavy: true });
  // 缺席
  assert.throws(() => finishWithReport(d), /HEAVY finish 需对照 attestation 且 MATCH/);
  // MISMATCH 如实入账、门拒
  recordComparatorAttestation(d, verdictFile(d, { slug: "t", items: [{ fid: "F1", verdict: "MISMATCH", generation: 1, basis: "证据对不上" }] }));
  assert.throws(() => finishWithReport(d), /MISMATCH.*重新对照并重录/s);
  // MATCH 入账→过门完成
  recordComparatorAttestation(d, verdictFile(d, { slug: "t", items: [{ fid: "F1", verdict: "MATCH", generation: 1, basis: "逐对吻合" }] }));
  const { goal } = finishWithReport(d);
  assert.equal(goal.status, "done");
});

test("指纹过期门：对照后代码又变（rebind 后绿半新鲜）→旧对照拒→重录过", () => {
  const d = repo();
  cycle(d, { heavy: true });
  recordComparatorAttestation(d, verdictFile(d, { slug: "t", items: [{ fid: "F1", verdict: "MATCH", generation: 1, basis: "x" }] }));
  writeFileSync(join(d, "a.txt"), "b\n");
  commitAll(d, "c2");
  completeStep(d, createGit(d), "F1", { evidence: "绿半重取" }); // rebind gen2=新鲜
  assert.throws(() => finishWithReport(d), /对照 attestation 已过期/);
  recordComparatorAttestation(d, verdictFile(d, { slug: "t", items: [{ fid: "F1", verdict: "MATCH", generation: 2, basis: "重对照" }] }));
  const { goal } = finishWithReport(d);
  assert.equal(goal.status, "done");
});

test("LIGHT 免门：无 comparator 记录 finish 照过（self-check 语义）", () => {
  const d = repo();
  cycle(d);
  const { goal } = finishWithReport(d);
  assert.equal(goal.status, "done");
});

test("attest CLI：MISMATCH 回执+警示；schema 拒（slug 不符/未知 fid/空 items）", () => {
  const d = repo();
  cycle(d, { heavy: true });
  let r = cli(["attest", "comparator", "--file", verdictFile(d, { slug: "wrong", items: [{ fid: "F1", verdict: "MATCH" }] })], d);
  assert.equal(r.code, 1);
  assert.match(r.out, /slug 不符/);
  r = cli(["attest", "comparator", "--file", verdictFile(d, { slug: "t", items: [{ fid: "F9", verdict: "MATCH" }] })], d);
  assert.equal(r.code, 1);
  assert.match(r.out, /未知\/非 F 项 fid/);
  r = cli(["attest", "comparator", "--file", verdictFile(d, { slug: "t", items: [] })], d);
  assert.equal(r.code, 1);
  assert.match(r.out, /缺 items|未覆盖全部 F 项/);
  // 负例族补全（ADJ-18，0.0.10）：缺 fid/重复 fid/verdict 词形/未覆盖全 F 各自真断言
  r = cli(["attest", "comparator", "--file", verdictFile(d, { slug: "t", items: [{ verdict: "MATCH", generation: 1 }] })], d);
  assert.equal(r.code, 1);
  assert.match(r.out, /未知\/非 F 项 fid/);
  r = cli(["attest", "comparator", "--file", verdictFile(d, { slug: "t", items: [{ fid: "F1", verdict: "MATCH", generation: 1 }, { fid: "F1", verdict: "MATCH", generation: 1 }] })], d);
  assert.equal(r.code, 1);
  assert.match(r.out, /重复 fid/);
  r = cli(["attest", "comparator", "--file", verdictFile(d, { slug: "t", items: [{ fid: "F1", verdict: "match", generation: 1 }] })], d);
  assert.equal(r.code, 1);
  assert.match(r.out, /verdict 非法/);
  r = cli(["attest", "comparator", "--file", verdictFile(d, { slug: "t", items: [{ fid: "F1", verdict: "MATCH", generation: 9 }] })], d);
  assert.equal(r.code, 1);
  assert.match(r.out, /无对应绿半节点/, "绑定不存在的代次（先对照后取证族）");
  r = cli(["attest", "comparator", "--file", verdictFile(d, { slug: "t", items: [{ fid: "F1", verdict: "MISMATCH", generation: 1, basis: "x" }] })], d);
  assert.equal(r.code, 0);
  assert.match(r.out, /对照 attestation 已入账：n\d+ · MISMATCH/);
  assert.match(r.out, /机器只记账不裁决/);
  const dag = loadDag(d);
  const comp = findLatestComparator(dag, "t", readGoal(d).planHash);
  assert.equal(comp.verdict, "MISMATCH");
  assert.equal(findLatestComparator(dag, "t", "nope"), null, "planHash 不符不入现行集");
});

// ── ⑦ 终验 attestation ──────────────────────────────────────────────────────
test("终验 attestation：字段齐/锚定 nodeId/report sha256 吻合/HEAVY 含 comparator/LIGHT 为 null", () => {
  const d = repo();
  cycle(d, { heavy: true });
  recordComparatorAttestation(d, verdictFile(d, { slug: "t", items: [{ fid: "F1", verdict: "MATCH", generation: 1, basis: "x" }] }));
  finishWithReport(d);
  const files = attestationFiles(d);
  assert.equal(files.length, 1);
  assert.match(files[0], /^t-\d{8}T\d{6}Z\.json$/, "attemptId=<slug>-<UTC 秒粒度紧凑串>");
  const doc = JSON.parse(readFileSync(join(d, ".lazyzcode", "attestations", files[0]), "utf8"));
  assert.equal(doc.slug, "t");
  assert.equal(doc.tier, "heavy");
  assert.equal(doc.lzyVersion, CLI_VERSION);
  assert.equal(doc.planHash, readGoal(d).planHash);
  assert.equal(doc.fingerprint.length, 64);
  assert.equal(doc.subjects.length, 1);
  assert.equal(doc.subjects[0].root, resolve(d), "subject=宿主根（resolve 形态）");
  assert.ok(doc.subjects[0].headTreeHash && doc.subjects[0].headTreeHash.length === 40);
  assert.equal(doc.evidence.length, 1);
  const goalF1 = readGoal(d).steps.find((s) => s.id === "F1");
  assert.equal(doc.evidence[0].fid, "F1");
  assert.equal(doc.evidence[0].generation, (goalF1.evidenceSeq ?? 1) - 1);
  assert.match(doc.evidence[0].nodeId, /^n\d+$/, "锚定账本节点");
  // ADJ-19（0.0.10）：锚定 nodeId 的同一性断言（绑错节点不再全套存活）
  assert.equal(
    doc.evidence[0].nodeId,
    findGreenByGeneration(loadDag(d), "t", "F1", (goalF1.evidenceSeq ?? 1) - 1).id,
    "锚定 nodeId=该 F 项当前代次的真实绿节点",
  );
  assert.equal(doc.comparator.verdict, "MATCH");
  assert.match(doc.comparator.nodeId, /^n\d+$/);
  assert.ok(Number.isInteger(doc.at), "终验 attestation 带 at 时点字段（ADJ-02）");
  assert.ok(doc.comparator.at === null || Number.isInteger(doc.comparator.at));
  const report = readFileSync(join(d, ".lazyzcode", "evidence", "t.report.md"));
  assert.equal(doc.report.sha256, sha256(report), "report sha256 与实文件一致");
  assert.equal(doc.finishedAt, readGoal(d).finishedAt);
  // LIGHT：comparator=null
  const d2 = repo();
  cycle(d2);
  finishWithReport(d2);
  const light = JSON.parse(readFileSync(join(d2, ".lazyzcode", "attestations", attestationFiles(d2)[0]), "utf8"));
  assert.equal(light.tier, "light");
  assert.equal(light.comparator, null);
});

test("终验 attestation：report 写失败=finish 拒且无残留；reset 存活；doctor 无疤痕误警", () => {
  const d = repo();
  cycle(d, { heavy: true });
  recordComparatorAttestation(d, verdictFile(d, { slug: "t", items: [{ fid: "F1", verdict: "MATCH", generation: 1, basis: "x" }] }));
  assert.throws(
    () => finishLoop(d, createGit(d), { writeReport: () => { throw new Error("disk full"); } }),
    /证据包归档失败.*executing/s,
  );
  assert.ok(!existsSync(join(d, ".lazyzcode", "attestations")), "报告先败=终验 attestation 未写（无残留）");
  assert.equal(readGoal(d).status, "executing");
  finishWithReport(d);
  assert.equal(attestationFiles(d).length, 1);
  const before = readFileSync(join(d, ".lazyzcode", "attestations", attestationFiles(d)[0]), "utf8");
  resetLoop(d, createGit(d));
  assert.equal(readFileSync(join(d, ".lazyzcode", "attestations", attestationFiles(d)[0]), "utf8"), before, "reset 不清（历史证明）");
  const doc = cli(["doctor"], d);
  // 隔离 HOME 下 install/files 恒 fail 级（注册表/缓存缺席），doctor 退出码不可据此断言；
  // 疤痕面只看：输出不出现 attestations 相关行（loop/ 外目录零疤痕接触）。
  assert.doesNotMatch(doc.out, /疤痕|attestations/, "loop/ 外目录零疤痕接触");
});

// ── ⑧ doctor payload-ver 三态（债3）──────────────────────────────────────────
test("doctor payload-ver：一致 ok／错配 warn 带 sync 指路／缓存缺席 skip", () => {
  const cacheHome = (vers) => {
    const h = mkdtempSync(join(tmpdir(), "lzy-v009-docver-"));
    for (const v of vers) {
      mkdirSync(join(h, ".zcode", "cli", "plugins", "cache", "lazyzcode-local", "lazyzcode", v), { recursive: true });
    }
    return h;
  };
  const run = (home, d) =>
    spawnSync(process.execPath, [CLI, "doctor"], {
      cwd: d,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, HOME: home, USERPROFILE: home, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE },
    });
  const line = (r) => `${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n").find((l) => l.includes("payload-ver")) ?? "";
  const d1 = repo();
  const ok = line(run(cacheHome([CLI_VERSION]), d1));
  assert.match(ok, new RegExp(`✔ payload-ver\\s+缓存 \\[.*${CLI_VERSION.replace(/\./g, "\\.")}.*\\] · CLI ${CLI_VERSION.replace(/\./g, "\\.")} 一致`));
  const warn = line(run(cacheHome(["0.0.7"]), d1));
  assert.match(warn, /⚠ payload-ver\s+缓存 \[0\.0\.7\] 无 CLI \d+\.\d+\.\d+ 的载荷目录.*lzy sync.*ADR-0012/s);
  const absent = line(run(mkdtempSync(join(tmpdir(), "lzy-v009-docver-")), d1));
  assert.match(absent, /➖ payload-ver\s+载荷缓存缺席/);
  const r = cli(["doctor"], repo()); // 共享隔离 HOME 无缓存=skip 态（install/files 在隔离 HOME
  // 本就 fail 级→doctor 码恒 1，不据此断言；只断言 payload-ver 行不升级为 warn）
  assert.ok(!/⚠ payload-ver/.test(r.out), "skip 态不产 warn 级 payload-ver 行");
});

// ── ⑨ fail-fast 无壳（N6）───────────────────────────────────────────────────
test("fail-fast：无 goal 目录 evidence red/claim 拒且不留 .lazyzcode 空壳", () => {
  const d = mkdtempSync(join(tmpdir(), "lzy-v009-noshell-"));
  const r1 = cli(["evidence", "red", "F1", "--evidence", "x"], d);
  assert.equal(r1.code, 1);
  assert.match(r1.out, /本目录没有目标/);
  const r2 = cli(["loop", "claim", "N1"], d);
  assert.equal(r2.code, 1);
  assert.ok(!existsSync(join(d, ".lazyzcode")), "pre-lock 拦截：目录未建");
  // ADJ-20（0.0.10）：attest 路径同守卫（删守卫即在无 goal 目录留疤）
  const vf = join(mkdtempSync(join(tmpdir(), "lzy-v009-verdict-")), "v.json");
  writeFileSync(vf, JSON.stringify({ slug: "x", items: [{ fid: "F1", verdict: "MATCH", generation: 1 }] }));
  const r3 = cli(["attest", "comparator", "--file", vf], d);
  assert.equal(r3.code, 1);
  assert.match(r3.out, /本目录没有目标/);
  assert.ok(!existsSync(join(d, ".lazyzcode")), "attest pre-lock 拦截：目录未建");
});

// ── ⑩ comparator 节点查询面 ─────────────────────────────────────────────────
test("comparator 节点：attests 边→plan 节点，dependents 命中；stalePreview 不可见", () => {
  const d = repo();
  cycle(d, { heavy: true });
  recordComparatorAttestation(d, verdictFile(d, { slug: "t", items: [{ fid: "F1", verdict: "MATCH", generation: 1, basis: "x" }] }));
  const dag = loadDag(d);
  const comp = dag.nodes.find((n) => n.kind === "comparator");
  const plan = dag.nodes.find((n) => n.kind === "plan");
  const deps = dependents(dag, comp.id);
  assert.equal(deps.hits.length, 1);
  assert.equal(deps.hits[0].edge.type, "attests");
  assert.equal(deps.hits[0].node.id, plan.id);
  const preview = stalePreview(dag, "whatever");
  assert.ok(preview.every((x) => x.node.kind === "evidence"), "comparator/plan/review 节点不入 stalePreview");
});

// ── ⑪ 锁竞争（§⑪ 交叉点）：attest 写面嵌既有 withLock，无 owner .lock 等满 5s ──
test("锁竞争：attest 在持锁下等满 LOCK_WAIT_MS 后 LoopError（不新增锁原语）", () => {
  const d = repo();
  cycle(d, { heavy: true });
  mkdirSync(join(d, ".lazyzcode", "loop", ".lock")); // 无 owner.json=必等满 LOCK_WAIT_MS
  const t0 = Date.now();
  assert.throws(() => recordComparatorAttestation(d, verdictFile(d, { slug: "t", items: [{ fid: "F1", verdict: "MATCH" }] })), /持锁/);
  assert.ok(Date.now() - t0 >= 4_500, `等锁应≥4.5s（实测 ${Date.now() - t0}ms）`);
});

// CLI verify 权威面（绿半路径）：账本权威下新鲜判定照常出 0
test("CLI verify：正常链新鲜判定照常（权威切换零回归）", () => {
  const d = repo();
  cycle(d);
  const r = cli(["loop", "verify"], d);
  assert.equal(r.code, 0);
  assert.match(r.out, /新鲜 1：F1/);
});

// ── ⑫ 对照绑证据（ADJ-02，0.0.10）───────────────────────────────────────────
test("对照绑证据：缺绑定/悬空 nodeId/先对照后取证都在入账处拒；绑定后存实际节点 id 与代次", () => {
  const d = repo();
  registerGoal(d, "t", "title", { tier: "heavy" });
  const p = join(d, ".lazyzcode", "plan.md");
  mkdirSync(join(d, ".lazyzcode"), { recursive: true });
  writeFileSync(p, "- [F1] v\n");
  adoptPlan(d, p, { review: "plan-reviewer: PASS — t" });
  startLoop(d, createGit(d));
  // 缺绑定（schema 层）
  assert.throws(
    () => recordComparatorAttestation(d, verdictFile(d, { slug: "t", items: [{ fid: "F1", verdict: "MATCH", basis: "x" }] })),
    /缺证据绑定/,
  );
  // 悬空 nodeId（解析层）
  assert.throws(
    () =>
      recordComparatorAttestation(
        d,
        verdictFile(d, { slug: "t", items: [{ fid: "F1", verdict: "MATCH", evidenceNodeId: "n99", generation: 1 }] }),
      ),
    /不可解析/,
  );
  // 先对照后取证（generation 无对应绿半）
  assert.throws(
    () => recordComparatorAttestation(d, verdictFile(d, { slug: "t", items: [{ fid: "F1", verdict: "MATCH", generation: 1 }] })),
    /无对应绿半节点.*取证/s,
  );
  completeStep(d, createGit(d), "F1", { evidence: "绿半" });
  // 取证后绑定成功，入账存实际节点 id 与代次
  recordComparatorAttestation(d, verdictFile(d, { slug: "t", items: [{ fid: "F1", verdict: "MATCH", generation: 1 }] }));
  const dag = loadDag(d);
  const comp = dag.nodes.find((n) => n.kind === "comparator");
  const green = findGreenByGeneration(dag, "t", "F1", 1);
  assert.equal(comp.items[0].evidenceNodeId, green.id);
  assert.equal(comp.items[0].generation, 1);
});

test("finish 门绑定：rebind 后复用旧对照（指纹已同步）→未绑现行锚拒；对照早于取证时点拒", () => {
  const d = repo();
  cycle(d, { heavy: true });
  recordComparatorAttestation(d, verdictFile(d, { slug: "t", items: [{ fid: "F1", verdict: "MATCH", generation: 1 }] }));
  // rebind 到 gen2
  writeFileSync(join(d, "a.txt"), "b\n");
  commitAll(d, "c2");
  completeStep(d, createGit(d), "F1", { evidence: "绿半重取" });
  // 同步旧对照指纹到当前树（绕开指纹过期门，隔离绑定检查）
  const fp = verifyEvidence(d, createGit(d)).fingerprint;
  tamperLedger(d, (obj) => {
    for (const n of obj.nodes) {
      if (n.kind === "comparator") n.fingerprint = fp;
    }
  });
  assert.throws(() => finishWithReport(d), /未绑定 F1 的现行锚定证据.*rebind/s);
  // 绑定改到现行锚但 at 早于取证时点（先对照后取证变体）
  const anchor2 = findGreenByGeneration(loadDag(d), "t", "F1", 2);
  tamperLedger(d, (obj) => {
    for (const n of obj.nodes) {
      if (n.kind === "comparator") {
        n.items = [{ fid: "F1", verdict: "MATCH", evidenceNodeId: anchor2.id, generation: 2, basis: "x" }];
        n.at = 1;
      }
    }
  });
  assert.throws(() => finishWithReport(d), /早于所锚证据取证时点/s);
});

// ── ⑬ 三族死锁状态感知出口（ADJ-08/09/10，0.0.10，§⑪ Q5 拍板）───────────────
test("零 F HEAVY：采纳时拒零 F 计划；存量（light 采纳后升 heavy）finish 零 F 豁免过门", () => {
  const d = repo();
  registerGoal(d, "t", "title", { tier: "heavy" });
  const p = join(d, ".lazyzcode", "plan.md");
  mkdirSync(join(d, ".lazyzcode"), { recursive: true });
  writeFileSync(p, "- [N1] x\n");
  assert.throws(() => adoptPlan(d, p, { review: "plan-reviewer: PASS — t" }), /须含 ≥1 个 F 项/);
  // 存量形态：light 采纳零 F 计划→升 heavy→finish 豁免（无对照可录）
  const d2 = repo();
  registerGoal(d2, "t", "title");
  const p2 = join(d2, ".lazyzcode", "plan.md");
  mkdirSync(join(d2, ".lazyzcode"), { recursive: true });
  writeFileSync(p2, "- [N1] x\n");
  adoptPlan(d2, p2);
  startLoop(d2, createGit(d2));
  completeStep(d2, createGit(d2), "N1", { note: "x" });
  setTier(d2, "heavy");
  const { goal } = finishWithReport(d2);
  assert.equal(goal.status, "done");
});

test("done 态恢复白名单：rebind→重对照→重 finish 全链可执行，落第二份 attestation", () => {
  const d = repo();
  cycle(d, { heavy: true });
  recordComparatorAttestation(d, verdictFile(d, { slug: "t", items: [{ fid: "F1", verdict: "MATCH", generation: 1 }] }));
  finishWithReport(d);
  assert.equal(attestationFiles(d).length, 1);
  completeStep(d, createGit(d), "F1", { evidence: "done 态 rebind" });
  recordComparatorAttestation(d, verdictFile(d, { slug: "t", items: [{ fid: "F1", verdict: "MATCH", generation: 2 }] }));
  const { goal } = finishWithReport(d);
  assert.equal(goal.status, "done");
  assert.equal(attestationFiles(d).length, 2, "重 finish 落新 attestation");
});

test("无 planHash 存量：升档前移拒；executing 重采纳补快照后升档走通；有 planHash 重采纳仍拒", () => {
  const d = repo();
  cycle(d);
  // 造存量（模拟 0.0.7 在途）：删 planHash
  const g = goalJson(d);
  delete g.planHash;
  writeFileSync(join(d, ".lazyzcode", "loop", "goal.json"), `${JSON.stringify(g, null, 2)}\n`);
  assert.throws(() => setTier(d, "heavy"), /升档前移拒/);
  assert.throws(
    () => recordComparatorAttestation(d, verdictFile(d, { slug: "t", items: [{ fid: "F1", verdict: "MATCH", generation: 1 }] })),
    /无 planHash/,
  );
  // 存量出口：executing 态无 planHash 重采纳（补快照重评审）——清单重置为未完成，
  // 逐步重验后走通升档+finish
  const p = join(d, ".lazyzcode", "plan.md");
  adoptPlan(d, p, { review: "plan-reviewer: PASS — re-snapshot" });
  assert.ok(goalJson(d).planHash);
  completeStep(d, createGit(d), "N1", { note: "重快照后重验" });
  completeStep(d, createGit(d), "F1", { evidence: "重快照后重取证" });
  setTier(d, "heavy");
  recordComparatorAttestation(d, verdictFile(d, { slug: "t", items: [{ fid: "F1", verdict: "MATCH", generation: 1 }] }));
  const { goal } = finishWithReport(d);
  assert.equal(goal.status, "done");
  // 有 planHash 的 executing 重采纳仍拒
  const d2 = repo();
  cycle(d2);
  writeFileSync(join(d2, ".lazyzcode", "plan.md"), "- [N1] x\n- [F1] v2\n");
  assert.throws(() => adoptPlan(d2, join(d2, ".lazyzcode", "plan.md")), /已有计划快照/);
});

// ── ⑭ 窗口竞态复采（ADJ-06/13，0.0.10）──────────────────────────────────────
test("窗口竞态：闸门后 writeReport 内提交，attestation 指纹与头树仍同源自洽（闸门同点采样）", () => {
  const d = repo();
  cycle(d, { heavy: true });
  recordComparatorAttestation(d, verdictFile(d, { slug: "t", items: [{ fid: "F1", verdict: "MATCH", generation: 1 }] }));
  const { goal } = finishLoop(d, createGit(d), {
    writeReport: (o) => {
      writeGoalReport(o.cwd, o.git, o.goal);
      // 模拟窗口内另一会话提交（闸门与 attestation 落盘之间——旧实现此处重读头树）
      writeFileSync(join(d, "late.txt"), "late\n");
      spawnSync("git", ["add", "-A"], { cwd: d });
      spawnSync("git", ["commit", "-qm", "late"], { cwd: d });
    },
  });
  assert.equal(goal.status, "done");
  const files = attestationFiles(d);
  const doc = JSON.parse(readFileSync(join(d, ".lazyzcode", "attestations", files[0]), "utf8"));
  const recompute = createHash("sha256")
    .update(
      doc.subjects
        .slice()
        .sort((a, b) => (a.root < b.root ? -1 : a.root > b.root ? 1 : 0))
        .map((s) => `${realpathSync(s.root)}\0${s.headTreeHash}\n`)
        .join(""),
    )
    .digest("hex");
  assert.equal(doc.fingerprint, recompute, "机器证明内指纹与各根头树同点采样、不自相矛盾");
});

// ── ⑮ payload-ver 深对照（ADJ-38/15/37，0.0.10）──────────────────────────────
test("payload-ver 深对照：注册表钉旧版/内容漂移=warn；市场 B 名候选枚举=ok", () => {
  const pkgSkill = join(ROOT, "plugin", "skills", "zw", "SKILL.md");
  const homeWith = (market, version, skillContent) => {
    const h = mkdtempSync(join(tmpdir(), "lzy-v009-docver2-"));
    const dir = join(h, ".zcode", "cli", "plugins", "cache", market, "lazyzcode", version);
    mkdirSync(join(dir, "skills", "zw"), { recursive: true });
    writeFileSync(join(dir, "skills", "zw", "SKILL.md"), skillContent);
    return h;
  };
  const run = (home, d) =>
    spawnSync(process.execPath, [CLI, "doctor"], {
      cwd: d,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, HOME: home, USERPROFILE: home, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE },
    });
  const line = (r) => `${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n").find((l) => l.includes("payload-ver")) ?? "";
  const d = repo();
  const pkg = readFileSync(pkgSkill, "utf8");
  // 市场 B 名（非 lazyzcode-local）候选枚举：照常 ok
  const okB = line(run(homeWith("my-market-b", CLI_VERSION, pkg), d));
  assert.match(okB, new RegExp("✔ payload-ver\\s+缓存 \\[" + CLI_VERSION.replace(/\./g, "\\.") + "\\]"), "市场 B 名不误报未安装");
  // 注册表钉旧版 → warn（会话实际加载旧载荷）
  const h2 = homeWith("lazyzcode-local", CLI_VERSION, pkg);
  const regDir = join(h2, ".zcode", "cli", "plugins");
  mkdirSync(regDir, { recursive: true });
  writeFileSync(
    join(regDir, "installed_plugins.json"),
    JSON.stringify({ version: 1, plugins: [{ id: `lazyzcode@lazyzcode-local`, name: "lazyzcode", marketplace: "lazyzcode-local", version: "0.0.1", installPath: "/x" }] }),
  );
  const warnReg = line(run(h2, d));
  assert.match(warnReg, /注册表仍钉 0\.0\.1.*sync/s);
  // 内容漂移（缓存与包 payload 不同）→ warn
  const h3 = homeWith("lazyzcode-local", CLI_VERSION, pkg + "\n<!-- drift -->");
  const warnDrift = line(run(h3, d));
  assert.match(warnDrift, /内容级对照不符.*sync/s);
});

// ── ⑯ legacy 收紧（ADJ-11，0.0.10）──────────────────────────────────────────
test("legacy 收紧：多 subject 目标的 legacy 单树证据判过期（subject 提交不可见堵死）", () => {
  const d = repo();
  cycle(d);
  const sib = repo();
  addSubject(d, sib);
  const goal = readGoal(d);
  const step = goal.steps.find((x) => x.id === "F1");
  step.evidence = { text: "legacy", treeHash: createGit(d).headTreeHash(), at: new Date().toISOString() };
  delete step.evidenceSeq;
  writeFileSync(join(d, ".lazyzcode", "loop", "goal.json"), `${JSON.stringify(goal, null, 2)}\n`);
  // 主树未变（单树哈希仍命中）但多 subject 下 legacy 轨判过期——旧实现照过（假 finish 口子）
  const v = verifyEvidence(d, createGit(d));
  assert.equal(v.stale.map((x) => x.id).join(","), "F1", "legacy 轨不再是统一权威的按步退出口");
});
