// 评审范围资格与适用性契约测试（0.4.0 M4 N7，ADR-0032）：review-scope 家族形状闸/声明验形/
// 分类器逐轴/qualify 双面/reuse 逐因/gate 复用合取真值表/closure-basis-stale 与 reopen/
// deriveObligations 三专项矩阵/V01 确定性/CLI 退出码。deps 注入零真引擎（qualify/reuse 是
// 机械挑战不 spawn），CI 可跑。结构沿 review-findings.contract.test.js。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync, readlinkSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "cli", "lzy.js");

import {
  SCOPE_VERSION, SCOPE_CLASSES, CHALLENGE_AXES,
  reviewScopeDir, scopeRecordStem, nextScopeSeq,
  saveScopeRecord, loadScopeFile, listScopeRecords,
  validateScopeDeclaration, matchScopeRule, buildFileMap, diffFileMaps,
  classifyDiffEntries, scopeReuseVerdict,
  qualifyReviewScope, reuseReviewScope, auditClosedFindingsApplicability,
  loadChallengeSuite, dutySuiteHash, validateChallengeSuite, challengeSuiteHash,
  dutyTemplateHash, REVIEW_VERSION, DUTY_TABLE, BASELINE_DUTY_ID,
  reserveRun, materializeCandidate, saveReviewRun,
} from "../core/review.js";
import * as policy from "../core/policy.js";
import { computePolicyIdentity, deriveObligations, ensurePolicyRecord, stableStringify, loadPolicyRecord } from "../core/policy.js";
import { evaluateGate } from "../core/gate.js";
import {
  recordFindingSightings, requestResolve, closeFinding, reopenFinding, findingFingerprint, CLOSED_FINDING_STATUSES, listFindings,
} from "../core/findings.js";
import { candidateIdentity } from "../core/verify.js";

const DECLARABLE = DUTY_TABLE.find((d) => d.scopeMode === "declarable").id; // review.external-side-effects（表序首条）
const HEX = (c) => c.repeat(64);

// 夹具仓：src=声明内 / docs=可保持对照 / shared=遗漏反例 hint 命中 / lockfile+check 脚本齐备。
function fixture({ goal = true } = {}) {
  const d = mkdtempSync(join(tmpdir(), "lzy-scope-"));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@t"]);
  g(["config", "user.name", "t"]);
  g(["config", "commit.gpgsign", "false"]);
  for (const sub of ["src", "docs", "shared", "scripts"]) mkdirSync(join(d, sub), { recursive: true });
  writeFileSync(join(d, "src", "util.js"), "export const a=1;\n");
  writeFileSync(join(d, "docs", "readme.md"), "# doc\n");
  writeFileSync(join(d, "shared", "dep-config.json"), "{}\n");
  writeFileSync(join(d, "package-lock.json"), "{}\n");
  writeFileSync(join(d, "scripts", "check.sh"), "echo ok\n");
  writeFileSync(join(d, "contract.md"), "task: fx\nendpoint: B\nscope: .\nrecipe: none\n\n- [A1] x\n");
  writeFileSync(join(d, ".gitignore"), ".lazyzcode/\n");
  if (goal) {
    mkdirSync(join(d, ".lazyzcode", "loop"), { recursive: true });
    writeFileSync(
      join(d, ".lazyzcode", "loop", "goal.json"),
      JSON.stringify({ version: 2, slug: "fx", title: "fixture", status: "executing", attempt: 1, tier: "light", risk: "low", policy: { schemaVersion: 1 }, contract: null, subjects: [] }),
    );
  }
  g(["add", "-A"]);
  g(["commit", "-qm", "init"]);
  return d;
}

function commit(d, msg) {
  spawnSync("git", ["add", "-A"], { cwd: d });
  const r = spawnSync("git", ["commit", "-qm", msg], { cwd: d });
  return r.status;
}

// 合成套件（五核心轴+lockfile/check-script/env；missed-dependency hint 指 shared/**）
const SUITE = {
  schemaVersion: 1,
  dutyId: DECLARABLE,
  procedureVersion: 1,
  challenges: [
    { id: "C1", axis: "in-scope", expect: "invalidate" },
    { id: "C2", axis: "canary-keep", expect: "keep" },
    { id: "C3", axis: "missed-dependency", expect: "invalidate", hints: ["shared/**"] },
    { id: "C4", axis: "unknown-new", expect: "invalidate" },
    { id: "C5", axis: "rename-delete", expect: "invalidate" },
    { id: "C6", axis: "lockfile", expect: "invalidate" },
    { id: "C7", axis: "check-script", expect: "invalidate", hints: ["scripts/**"] },
    { id: "C8", axis: "env", expect: "invalidate" },
  ],
};
const DUTY_ENTRY = { id: DECLARABLE, scopeMode: "declarable", template: `core/review-duties/${DECLARABLE}.md` };
const DECL = { dutyId: DECLARABLE, rules: [{ pattern: "src/**", class: "in-scope" }, { pattern: "docs/**", class: "unrelated" }], sharedInputs: ["package-lock.json"] };

// 有效 pass 运行档（同茎 candidate 物化；候选三字段用合成值=恒漂移，供复用腿/真实候选双形态）
function saveBaseRun(d, { slug = "fx", candidate = null } = {}) {
  const { seq, runId, runDir } = reserveRun(d, slug, 1);
  const cand = materializeCandidate(d, runDir);
  writeFileSync(join(runDir, "raw.txt"), "stub raw");
  const rec = {
    schemaVersion: REVIEW_VERSION, runId, slug, attempt: 1, seq,
    duty: { id: DECLARABLE }, dutyTableVersion: 4, templateHash: dutyTemplateHash(DECLARABLE),
    inputPackageHash: null,
    candidate: candidate ?? { ...candidateIdentity(d), clean: true },
    snapshot: { treeHash: cand.treeHash },
    startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
    exit: { code: 0, signal: null }, sessionId: "sess-fx", engine: "/bin/true",
    raw: { path: "raw.txt", sha256: createHash("sha256").update(readFileSync(join(runDir, "raw.txt"))).digest("hex"), bytes: 9 },
    transcript: { path: "rollout/fx.jsonl", sha256: HEX("c") },
    budget: null, metering: { status: "metered", points: 1, note: null },
    validity: { status: "valid", reason: null, detail: null },
    result: { verdict: "pass", findings: [], summary: "clean", normalization: null },
    recheck: null, containment: { phantomCount: 0, phantoms: [] },
  };
  saveReviewRun(d, rec);
  return rec;
}
describe("①review-scope 家族", () => {
  test("确定序+覆写拒+毒化拒+损坏族 fail-closed", () => {
    const d = fixture({ goal: false });
    try {
      assert.equal(nextScopeSeq(d, "fx", 1, "qualification"), 1);
      const decl = validateScopeDeclaration(DECL);
      const rec = {
        schemaVersion: SCOPE_VERSION, kind: "qualification", id: scopeRecordStem("fx", 1, "qualification", 1),
        slug: "fx", attempt: 1, seq: 1, dutyId: DECLARABLE, baseRunId: "fx.a1.r1",
        scopeHash: decl.scopeHash, scope: { rules: DECL.rules, sharedInputs: DECL.sharedInputs },
        identity: { rulesHash: HEX("a"), dutyTableVersion: 4, templateHash: HEX("b"), contractHash: null, manifestHash: null, engine: null },
        suite: { file: "core/review-duties/x.qualify.json", suiteHash: HEX("c"), procedureVersion: 1 },
        granted: true,
        challenges: [{ id: "C1", axis: "in-scope", expect: "invalidate", ok: true }],
        at: new Date().toISOString(), note: null,
      };
      saveScopeRecord(d, rec);
      assert.throws(() => saveScopeRecord(d, rec), /拒绝覆写/);
      // 毒化：scope 内容与哈希不符（写侧形状闸复算）
      const poison = { ...rec, id: scopeRecordStem("fx", 1, "qualification", 2), seq: 2, scope: { rules: [{ pattern: "evil/**", class: "in-scope" }], sharedInputs: [] } };
      assert.throws(() => saveScopeRecord(d, poison), /scopeHash 与 scope 内容不符/);
      // granted 与挑战互证
      const liar = { ...rec, id: scopeRecordStem("fx", 1, "qualification", 3), seq: 3, granted: false };
      assert.throws(() => saveScopeRecord(d, liar), /granted=false 但全部挑战通过/);
      // baseRunId 跨代次拒
      const crossGen = { ...rec, id: scopeRecordStem("fx", 2, "qualification", 1), attempt: 2, seq: 1 };
      assert.throws(() => saveScopeRecord(d, crossGen), /同代次运行茎/);
      // 读回+枚举
      assert.equal(loadScopeFile(join(reviewScopeDir(d), "fx.a1.q1.json")).id, "fx.a1.q1");
      assert.equal(listScopeRecords(d, { kind: "qualification" }).length, 1);
      // 损坏族 fail-closed（list 整族读）
      writeFileSync(join(reviewScopeDir(d), "junk.json"), "{not json");
      assert.throws(() => listScopeRecords(d), /损坏|JSON/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("②声明验形与分类器", () => {
  test("声明验形拒矩阵", () => {
    const bad = (decl, re) => assert.throws(() => validateScopeDeclaration(decl), re);
    bad(null, /声明须为对象/);
    bad({ ...DECL, dutyId: "nope" }, /不在职责表/);
    bad({ ...DECL, rules: [] }, /非空数组/);
    bad({ ...DECL, rules: [{ pattern: "src/**", class: "sometimes" }] }, /class 不识别/);
    bad({ ...DECL, rules: [{ pattern: "/abs/**", class: "in-scope" }] }, /仓内相对路径/);
    bad({ ...DECL, rules: [{ pattern: "a/../b", class: "in-scope" }] }, /穿越/);
    bad({ ...DECL, rules: [{ pattern: "src/**", class: "in-scope" }, { pattern: "src/**", class: "unrelated" }] }, /重复/);
    bad({ ...DECL, sharedInputs: ["/etc/passwd"] }, /仓内相对路径/);
    bad({ ...DECL, sharedInputs: ["a", "a"] }, /重复/);
    // 合法形：scopeHash 确定性
    const v1 = validateScopeDeclaration(DECL);
    const v2 = validateScopeDeclaration({ ...DECL });
    assert.equal(v1.scopeHash, v2.scopeHash);
    assert.equal(v1.scopeHash, createHash("sha256").update(stableStringify({ dutyId: v1.dutyId, rules: v1.rules, sharedInputs: v1.sharedInputs })).digest("hex"));
  });

  test("分类器逐轴矩阵（五核心+共享+unknown+rename 双端）", () => {
    const entries = [
      { path: "src/a.js", type: "modified" },              // in-scope → invalidate
      { path: "docs/r.md", type: "modified" },             // unrelated → keep
      { path: "package-lock.json", type: "modified" },     // shared-input → invalidate
      { path: "unknown/new.txt", type: "added" },          // unmatched → unknown
      { path: "docs/new.md", type: "renamed", from: "docs/old.md" }, // 双端 unrelated → keep
      { path: "src/moved.js", type: "renamed", from: "src/old.js" }, // 双端含 in-scope → invalidate
      { path: "shared/x.json", type: "deleted" },          // unmatched → unknown
    ];
    const cls = classifyDiffEntries(entries, DECL);
    const by = (p) => cls.find((e) => (e.type === "renamed" ? e.path === p : e.path === p));
    assert.equal(by("src/a.js").decision, "invalidate");
    assert.equal(by("docs/r.md").decision, "keep");
    assert.equal(by("package-lock.json").decision, "invalidate");
    assert.equal(by("package-lock.json").classify[0].matched, "shared-input");
    assert.equal(by("unknown/new.txt").decision, "unknown");
    assert.equal(by("docs/new.md").decision, "keep");
    assert.equal(by("src/moved.js").decision, "invalidate");
    assert.equal(by("shared/x.json").decision, "unknown");
    const v = scopeReuseVerdict(cls, []);
    assert.equal(v.verdict, "fallback");
    assert.equal(v.reasons.filter((r) => r.includes("声明内/共享输入变化")).length, 3);
    assert.equal(v.reasons.filter((r) => r.includes("未知路径")).length, 2);
    // 全 keep + 结构因 ⇒ fallback；全 keep 无因 ⇒ applicable
    const keepOnly = classifyDiffEntries([entries[1], entries[4]], DECL);
    assert.equal(scopeReuseVerdict(keepOnly, []).verdict, "applicable");
    assert.equal(scopeReuseVerdict(keepOnly, ["结构轴漂移"]).verdict, "fallback");
    // glob **/ 前导目录语义（根下文件可命中）
    assert.ok(matchScopeRule("package.json", [{ pattern: "**/*.json", class: "in-scope" }]));
    assert.ok(matchScopeRule("a/b/c.js", [{ pattern: "src/**", class: "in-scope" }]) === null);
  });
});

describe("③qualify 双面", () => {
  test("相对符号链接仓：挑战夹具保目标串（不得改写为绝对）⇒ 仍可 granted", async () => {
    const d = fixture();
    try {
      // 真实仓常见形态（N10 缺陷 ② openchamber 实测）：根级相对链接 + 目录链接
      writeFileSync(join(d, "AGENTS.md"), "# agents\n");
      symlinkSync("AGENTS.md", join(d, "CLAUDE.md"));
      symlinkSync("util.js", join(d, "src", "doc-link.md")); // 指向同目录 src 文件（appending 经链命中声明内）
      commit(d, "symlinks");
      saveBaseRun(d);
      // 前提：物化候选保链接（git archive/tar 面）
      assert.equal(readlinkSync(join(d, "CLAUDE.md")), "AGENTS.md");
      const res = await qualifyReviewScope(d, { runId: "fx.a1.r1", scopeDecl: DECL }, { dutyEntry: DUTY_ENTRY });
      assert.equal(res.granted, true, res.failed.map((c) => `${c.axis}:${c.observed}`).join("; "));
      // 反向：canary-keep 轴须给出 keep（污染若在则恒 invalidate——缺陷 ② 的可用判据）
      const canary = res.record.challenges.find((c) => c.axis === "canary-keep");
      assert.equal(canary.ok, true, canary.observed);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("granted 面：真随包套件注入下逐轴全过", async () => {
    const d = fixture();
    try {
      saveBaseRun(d);
      const res = await qualifyReviewScope(d, { runId: "fx.a1.r1", scopeDecl: DECL }, { dutyEntry: DUTY_ENTRY });
      assert.equal(res.granted, true, res.failed.map((c) => `${c.axis}:${c.observed}`).join(";"));
      assert.equal(res.record.id, "fx.a1.q1");
      assert.ok(res.record.scopeHash);
      assert.equal(res.record.suite.procedureVersion, 1);
      assert.match(res.record.note, /零积分/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("拒绝面：已知依赖标 unrelated ⇒ missed-dependency 判 keep 拒；拒绝也落档", async () => {
    const d = fixture();
    try {
      saveBaseRun(d);
      const badDecl = { ...DECL, rules: [...DECL.rules, { pattern: "shared/**", class: "unrelated" }] };
      const res = await qualifyReviewScope(d, { runId: "fx.a1.r1", scopeDecl: badDecl }, { dutyEntry: DUTY_ENTRY, suite: SUITE });
      assert.equal(res.granted, false);
      assert.ok(res.failed.some((c) => c.axis === "missed-dependency" && /keep/.test(c.observed)));
      assert.equal(listScopeRecords(d, { kind: "qualification" }).length, 1, "拒绝也落档");
      const rec = listScopeRecords(d, { kind: "qualification" })[0];
      assert.equal(rec.granted, false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("过窄拒面：canary 未声明 unrelated ⇒ 判 invalidate 拒", async () => {
    const d = fixture();
    try {
      saveBaseRun(d);
      const narrow = { ...DECL, rules: [{ pattern: "src/**", class: "in-scope" }] }; // docs 未声明
      const res = await qualifyReviewScope(d, { runId: "fx.a1.r1", scopeDecl: narrow }, { dutyEntry: DUTY_ENTRY, suite: SUITE });
      assert.equal(res.granted, false);
      assert.ok(res.failed.some((c) => c.axis === "canary-keep"));
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("前置拒矩阵（不落档）：无运行/跨代次/声明异职责/套件职责不符/非 declarable", async () => {
    const d = fixture();
    try {
      await assert.rejects(() => qualifyReviewScope(d, { runId: "fx.a1.r1", scopeDecl: DECL }, { dutyEntry: DUTY_ENTRY }), /运行档不在案/);
      const saved = saveBaseRun(d);
      assert.equal(saved.runId, "fx.a1.r1");
      await assert.rejects(() => qualifyReviewScope(d, { runId: "fx.a1.r9", scopeDecl: DECL }, { dutyEntry: DUTY_ENTRY }), /不在案/);
      await assert.rejects(() => qualifyReviewScope(d, { runId: "fx.a1.r1", scopeDecl: { ...DECL, dutyId: BASELINE_DUTY_ID } }, { dutyEntry: DUTY_ENTRY }), /≠ base 运行职责/);
      await assert.rejects(() => qualifyReviewScope(d, { runId: "fx.a1.r1", scopeDecl: DECL }, { dutyEntry: DUTY_ENTRY, suite: { ...SUITE, dutyId: BASELINE_DUTY_ID } }), /套件职责不符/);
      // 非 declarable（baseline whole-candidate）
      await assert.rejects(
        () => qualifyReviewScope(d, { runId: "fx.a1.r1", scopeDecl: { ...DECL, dutyId: BASELINE_DUTY_ID } }, { dutyEntry: { ...DUTY_ENTRY, id: BASELINE_DUTY_ID, scopeMode: "whole-candidate" } }),
        /整候选职责恒重评/,
      );
      assert.equal(listScopeRecords(d).length, 0, "前置拒不落档");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("④reuse 逐因", () => {
  async function qualified(d) {
    saveBaseRun(d);
    const q = await qualifyReviewScope(d, { runId: "fx.a1.r1", scopeDecl: DECL }, { dutyEntry: DUTY_ENTRY });
    assert.equal(q.granted, true);
  }
  test("候选未变/无关变化 ⇒ applicable；声明内变化⇒fallback（in-scope 因）；未知新文件⇒fallback（unknown 因）", async () => {
    const d = fixture();
    try {
      await qualified(d);
      // 候选未变（HEAD 未动）
      const r0 = await reuseReviewScope(d, { runId: "fx.a1.r1" }, { dutyEntry: DUTY_ENTRY });
      assert.equal(r0.verdict, "applicable");
      // 无关变化
      writeFileSync(join(d, "docs", "readme.md"), "# doc\n# more\n");
      commit(d, "docs");
      const r1 = await reuseReviewScope(d, { runId: "fx.a1.r1" }, { dutyEntry: DUTY_ENTRY });
      assert.equal(r1.verdict, "applicable");
      // 声明内变化
      writeFileSync(join(d, "src", "util.js"), "export const a=2;\n");
      commit(d, "src");
      const r2 = await reuseReviewScope(d, { runId: "fx.a1.r1" }, { dutyEntry: DUTY_ENTRY });
      assert.equal(r2.verdict, "fallback");
      assert.ok(r2.reasons.some((x) => x.includes("src/util.js")));
      // 未知新文件
      writeFileSync(join(d, "stranger.txt"), "??\n");
      commit(d, "unknown");
      const r3 = await reuseReviewScope(d, { runId: "fx.a1.r1" }, { dutyEntry: DUTY_ENTRY });
      assert.equal(r3.verdict, "fallback");
      assert.ok(r3.reasons.some((x) => x.includes("未知路径")));
      // 旧运行档与资格档字节零触碰（哈希对照 qualification 刚落档时的字节）
      const baseSha = createHash("sha256").update(readFileSync(join(d, ".lazyzcode", "review", "fx.a1.r1.json"))).digest("hex");
      const qualSha = createHash("sha256").update(readFileSync(join(d, ".lazyzcode", "review-scope", "fx.a1.q1.json"))).digest("hex");
      const baseSha2 = createHash("sha256").update(readFileSync(join(d, ".lazyzcode", "review", "fx.a1.r1.json"))).digest("hex");
      const qualSha2 = createHash("sha256").update(readFileSync(join(d, ".lazyzcode", "review-scope", "fx.a1.q1.json"))).digest("hex");
      assert.equal(baseSha, baseSha2);
      assert.equal(qualSha, qualSha2);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("结构轴漂移（engine 身份不符）⇒fallback；无资格/拒资格 ⇒ preflight 拒", async () => {
    const d = fixture();
    try {
      // 无资格档 ⇒ preflight
      saveBaseRun(d);
      await assert.rejects(() => reuseReviewScope(d, { runId: "fx.a1.r1" }, { dutyEntry: DUTY_ENTRY }), /无在案资格档/);
      // 拒绝态资格 ⇒ preflight
      const badDecl = { ...DECL, rules: [...DECL.rules, { pattern: "shared/**", class: "unrelated" }] };
      const qbad = await qualifyReviewScope(d, { runId: "fx.a1.r1", scopeDecl: badDecl }, { dutyEntry: DUTY_ENTRY, suite: SUITE });
      assert.equal(qbad.granted, false);
      await assert.rejects(() => reuseReviewScope(d, { runId: "fx.a1.r1" }, { dutyEntry: DUTY_ENTRY }), /拒绝态/);
      // 结构身份漂移：engine 合成值 ≠ 现行 findEngine()（夹具引擎轴必漂移）
      const qok = await qualifyReviewScope(d, { runId: "fx.a1.r1", scopeDecl: DECL }, { dutyEntry: DUTY_ENTRY });
      assert.equal(qok.granted, true);
      // 篡改资格档 engine 轴模拟漂移（重算校验和走 saveFamilyFile 家法不可行——直接改盘+重算）
      const p = join(d, ".lazyzcode", "review-scope", `${qok.record.id}.json`);
      const raw = JSON.parse(readFileSync(p, "utf8"));
      const { checksumOf } = await import("../core/queue.js");
      void checksumOf;
      // 资格档是家族档——直接改 engine 字段会校验和失配；改用「当前引擎轴变化」的等价面：
      // reuse 读现行 findEngine()，资格档记录的是 qualify 时点 findEngine()——同机同进程两者相等，
      // 故结构漂移轴用「契约哈希轴」验证：goal 注入契约（资格时点无契约 → 现行有契约=漂移）。
      const g = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8"));
      g.contract = { path: "contract.md", contractHash: HEX("f") };
      writeFileSync(join(d, ".lazyzcode", "loop", "goal.json"), JSON.stringify(g));
      const r1 = await reuseReviewScope(d, { runId: "fx.a1.r1" }, { dutyEntry: DUTY_ENTRY });
      assert.equal(r1.verdict, "fallback");
      assert.ok(r1.reasons.some((x) => x.includes("contractHash")));
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("⑤gate 复用合取真值表", () => {
  function gateFor(d, goal = null) {
    const g = goal ?? JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8"));
    return evaluateGate(d, { goal: g });
  }
  test("七态：直跑满足/漂移无适用档/复用满足/复用 fallback 拒/目标陈旧拒/模板哈希漂移拒", async () => {
    const d = fixture();
    try {
      const goal = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8"));
      ensurePolicyRecord(d, goal);
      // 走 core：造 declarable 职责的义务——policy 默认推导按夹具身份（low/无清单）只有底线；
      // 复用腿按 duty 判，直接以 DECLARABLE 运行档+适用档驱动 gate 的评审义务判定需要
      // 义务在案——注入契约 B（endpoint=B ⇒ external+state-recovery 推导）。
      const g2 = { ...goal, risk: "med", contract: { path: "contract.md", contractHash: HEX("1") }, subjects: ["../nonexistent-subject-for-fx"] };
      void 0; // contract.md 已在夹具 init 提交内（避免后续 commit 卷入未跟踪新文件制造 unknown 差）
      // g2 同步落盘（qualify/reuse 的身份轴读盘上 goal——gate 注入对象与磁盘必须同源）
      writeFileSync(join(d, ".lazyzcode", "loop", "goal.json"), JSON.stringify(g2));
      // 影响扩大通道（risk/endpoint 轴升级 ⇒ 专项义务 expand 重导；无 expand=漂移不重导 V02）
      const grown = ensurePolicyRecord(d, g2, { expand: true, reason: "契约测试：endpoint B 注入推导专项职责" });
      assert.equal(grown.expanded, true);
      const obIds = policy.loadPolicyRecord(d, g2.slug, g2.attempt).obligations.map((o) => o.id);
      assert.ok(obIds.includes(DECLARABLE), `推导义务缺 ${DECLARABLE}：${obIds.join(",")}`);
      void obIds;
      // ① 漂移运行在案（合成候选三字段）+无适用档 ⇒ 复用腿不可用
      saveBaseRun(d, { candidate: { headSha: "f".repeat(40), compositeFingerprint: HEX("e"), cliVersion: "0.0.1", clean: true } });
      let gate = gateFor(d, g2);
      let ob = gate.obligations.find((o) => o.id === DECLARABLE);
      assert.equal(ob.state, "unsatisfied");
      assert.ok(ob.reasons.some((r) => r.includes("复用腿不可用") && r.includes("无在案适用档")), ob.reasons.join("|"));
      // ② 资格+适用档（applicable·目标=现行）⇒ 复用腿满足
      const q = await qualifyReviewScope(d, { runId: "fx.a1.r1", scopeDecl: DECL }, { dutyEntry: DUTY_ENTRY });
      assert.equal(q.granted, true);
      const r1 = await reuseReviewScope(d, { runId: "fx.a1.r1" }, { dutyEntry: DUTY_ENTRY });
      assert.equal(r1.verdict, "applicable");
      gate = gateFor(d, g2);
      ob = gate.obligations.find((o) => o.id === DECLARABLE);
      assert.equal(ob.state, "satisfied", ob.reasons.join("|"));
      assert.equal(ob.basis?.reuse?.baseRunId, "fx.a1.r1");
      assert.equal(ob.basis?.reuse?.qualificationId, q.record.id);
      // ③ 声明内变化 ⇒ 新适用档 fallback ⇒ 复用腿不足
      writeFileSync(join(d, "src", "util.js"), "export const a=2;\n");
      commit(d, "src");
      const r2 = await reuseReviewScope(d, { runId: "fx.a1.r1" }, { dutyEntry: DUTY_ENTRY });
      assert.equal(r2.verdict, "fallback");
      gate = gateFor(d, g2);
      ob = gate.obligations.find((o) => o.id === DECLARABLE);
      assert.equal(ob.state, "unsatisfied");
      assert.ok(ob.reasons.some((r) => r.includes("复用腿不足") && r.includes("fallback")), ob.reasons.join("|"));
      // ④ 复用腿再满足：还原声明内文件（diff 对 base 快照累积判定——还原后仅 docs 无关差）
      writeFileSync(join(d, "src", "util.js"), "export const a=1;\n");
      writeFileSync(join(d, "docs", "readme.md"), "# doc2\n");
      commit(d, "docs2"); // 无关变化（docs unrelated）→ 新 applicable 且目标=当前 HEAD
      const r3 = await reuseReviewScope(d, { runId: "fx.a1.r1" }, { dutyEntry: DUTY_ENTRY });
      assert.equal(r3.verdict, "applicable");
      gate = gateFor(d, g2);
      ob = gate.obligations.find((o) => o.id === DECLARABLE);
      assert.equal(ob.state, "satisfied");
      // ⑤ 资格模板哈希漂移：篡改资格档 templateHash → 校验和失配拒读=资格档不可读 fail-closed
      const qp = join(d, ".lazyzcode", "review-scope", `${q.record.id}.json`);
      const raw = JSON.parse(readFileSync(qp, "utf8"));
      raw.identity.templateHash = HEX("9");
      writeFileSync(qp, `${JSON.stringify(raw, null, 2)}\n`);
      gate = gateFor(d, g2);
      ob = gate.obligations.find((o) => o.id === DECLARABLE);
      assert.equal(ob.state, "unsatisfied");
      assert.ok(ob.reasons.some((r) => r.includes("复用腿不可用") || r.includes("资格档不可读") || r.includes("复用腿不足")), ob.reasons.join("|"));
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
  test("⑧复用腿身份轴 env：资格后 env 漂移 ⇒ gate 复用腿不足并点名 env（M5 N2，改前红）", async () => {
    const d = fixture();
    try {
      const goal = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8"));
      ensurePolicyRecord(d, goal);
      const g2 = { ...goal, risk: "med", contract: { path: "contract.md", contractHash: HEX("1") }, subjects: ["../nonexistent-subject-for-fx"] };
      writeFileSync(join(d, ".lazyzcode", "loop", "goal.json"), JSON.stringify(g2));
      ensurePolicyRecord(d, g2, { expand: true, reason: "契约测试：endpoint B 注入推导专项职责" });
      saveBaseRun(d, { candidate: { headSha: "f".repeat(40), compositeFingerprint: HEX("e"), cliVersion: "0.0.1", clean: true } });
      const q = await qualifyReviewScope(d, { runId: "fx.a1.r1", scopeDecl: DECL }, { dutyEntry: DUTY_ENTRY });
      const r1 = await reuseReviewScope(d, { runId: "fx.a1.r1" }, { dutyEntry: DUTY_ENTRY });
      assert.equal(r1.verdict, "applicable");
      // 篡改资格档 identity.env（重算校验和保持档可读——只漂移 env 轴；其余轴原样）
      const qp = join(d, ".lazyzcode", "review-scope", `${q.record.id}.json`);
      const parsed = JSON.parse(readFileSync(qp, "utf8"));
      const { checksum: _c, ...rest } = parsed;
      void _c;
      rest.identity.env = HEX("e");
      writeFileSync(qp, `${JSON.stringify({ ...rest, checksum: createHash("sha256").update(JSON.stringify(rest)).digest("hex") }, null, 2)}\n`);
      const gate = gateFor(d, g2);
      const ob = gate.obligations.find((o) => o.id === DECLARABLE);
      assert.equal(ob.state, "unsatisfied", `env 漂移后复用腿应不足：${ob.reasons.join("|")}`);
      assert.ok(ob.reasons.some((r) => r.includes("资格身份漂移") && r.includes("env")), `拒因须点名 env 轴：${ob.reasons.join("|")}`);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("⑥closure-basis-stale 与 reopen 通道", () => {
  test("stale 审计三态：候选一致 fresh/漂移命中定位文件 stale/复核档缺席 unavailable；reopen 后重走关闭", async () => {
    const d = fixture();
    try {
      const { runId } = await (async () => {
        const rec = saveBaseRun(d);
        return { runId: rec.runId };
      })();
      const at0 = new Date().toISOString();
      const disp = recordFindingSightings(d, "fx", { runId, attempt: 1, at: at0, dutyId: DECLARABLE, findings: [{ severity: "P1", title: "t", location: "src/util.js:1" }] });
      const fp = disp[0].fingerprint;
      requestResolve(d, "fx", fp, { at: at0 });
      // 造同候选真复核运行（候选三字段=现行 ⇒ fresh）
      const rec2 = saveBaseRun(d); // fx.a1.r2——候选三字段=当前 candidateIdentity
      void runId;
      const run2 = rec2.runId;
      closeFinding(d, "fx", fp, {
        outcome: "fixed", basis: "复核不再报",
        recheck: { runId: run2, valid: true, slug: "fx", attempt: 1, dutyId: DECLARABLE, reportedFingerprints: [], isRecheck: true, at: new Date(Date.now() + 5000).toISOString() },
        expectedAttempt: 1,
      });
      let audit = auditClosedFindingsApplicability(d, "fx");
      assert.equal(audit.stale.length, 0, JSON.stringify(audit.stale));
      assert.equal(audit.fresh, 1);
      // 漂移命中定位文件 ⇒ stale
      writeFileSync(join(d, "src", "util.js"), "export const a=2;\n");
      commit(d, "drift");
      audit = auditClosedFindingsApplicability(d, "fx");
      assert.equal(audit.stale.length, 1);
      assert.equal(audit.stale[0].reason, "closure-basis-stale");
      // gate findings 子句阻塞
      const goal = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8"));
      let gate = evaluateGate(d, { goal });
      assert.equal(gate.clauses.findings.ok, false);
      assert.ok(gate.clauses.findings.reasons.some((r) => r.includes("关闭依据失效")));
      // reopen → 重复核 → 重关 → gate 翻过
      const ro = reopenFinding(d, "fx", fp, { reason: "closure-basis-stale" });
      assert.equal(ro.status, "resolve-requested");
      assert.ok(CLOSED_FINDING_STATUSES.includes("closed-fixed") === true);
      gate = evaluateGate(d, { goal });
      assert.equal(gate.clauses.findings.ok, false, "reopen 后回未关闭态仍拦");
      // 重复核（r3 候选=漂移后现行）再关闭
      const rec3 = saveBaseRun(d);
      closeFinding(d, "fx", fp, {
        outcome: "fixed", basis: "二次复核不再报",
        recheck: { runId: rec3.runId, valid: true, slug: "fx", attempt: 1, dutyId: DECLARABLE, reportedFingerprints: [], isRecheck: true, at: new Date(Date.now() + 9000).toISOString() },
        expectedAttempt: 1,
      });
      audit = auditClosedFindingsApplicability(d, "fx");
      assert.equal(audit.stale.length, 0);
      gate = evaluateGate(d, { goal });
      assert.equal(gate.clauses.findings.ok, true, gate.clauses.findings.reasons.join("|"));
      // close 的职责绑定拒：recheck 职责 ≠ 发现来源职责
      const disp2 = recordFindingSightings(d, "fx", { runId, attempt: 1, at: at0, dutyId: DECLARABLE, findings: [{ severity: "P1", title: "t2", location: "src/other.js:1" }] });
      requestResolve(d, "fx", disp2[0].fingerprint, { at: at0 });
      assert.throws(
        () => closeFinding(d, "fx", disp2[0].fingerprint, { outcome: "fixed", basis: "x", recheck: { runId: rec3.runId, valid: true, slug: "fx", attempt: 1, dutyId: BASELINE_DUTY_ID, reportedFingerprints: [], isRecheck: true, at: new Date(Date.now() + 9000).toISOString() } }),
        /职责不符/,
      );
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("⑦三专项职责套件与推导", () => {
  test("declarable 职责恒有随包套件（五核心轴必含）；baseline 无套件", () => {
    for (const d of DUTY_TABLE) {
      const loaded = loadChallengeSuite(d.id);
      if (d.scopeMode === "declarable") {
        assert.ok(loaded, `${d.id} 缺随包套件`);
        const axes = new Set(loaded.suite.challenges.map((c) => c.axis));
        for (const a of ["in-scope", "canary-keep", "missed-dependency", "unknown-new", "rename-delete"]) {
          assert.ok(axes.has(a), `${d.id} 套件缺核心轴 ${a}`);
        }
        assert.equal(loaded.hash, dutySuiteHash(d.id));
      } else {
        assert.equal(loaded, null);
        assert.equal(dutySuiteHash(d.id), null);
      }
    }
    // 套件哈希确定性 + 校验器拒面
    assert.equal(challengeSuiteHash(SUITE), challengeSuiteHash({ ...SUITE }));
    assert.throws(() => validateChallengeSuite({ ...SUITE, challenges: SUITE.challenges.slice(0, 3) }), /缺核心轴/);
    assert.throws(() => validateChallengeSuite({ ...SUITE, challenges: [{ ...SUITE.challenges[0], axis: "nope" }] }), /axis 不识别|缺核心轴/);
  });

  test("deriveObligations 三专项推导矩阵（非恒真）", () => {
    const base = { slug: "s", attempt: 1, goalVersion: 2, tier: "light", risk: "low", contractHash: null, endpoint: null, subjectsCount: 0, contractDrift: false, manifestPresent: false, manifestHash: null, manifestInvalid: false, checkIds: [], ciRequiredChecks: [] };
    const ids = (over) => deriveObligations({ ...base, ...over }).map((o) => o.id);
    // 低风险无清单 ⇒ 只底线（Known unknowns #2 非恒真锚）
    assert.deepEqual(ids({}), [BASELINE_DUTY_ID === "review.general-correctness" ? "review.general-correctness" : BASELINE_DUTY_ID]);
    assert.ok(ids({ checkIds: ["lint"] }).includes("review.verification-deps"));
    assert.ok(ids({ ciRequiredChecks: ["ci"] }).includes("review.verification-deps"));
    assert.ok(ids({ risk: "med" }).includes("review.external-side-effects"));
    assert.ok(!ids({ risk: "low" }).includes("review.external-side-effects"));
    assert.ok(ids({ endpoint: "B" }).includes("review.external-side-effects") && ids({ endpoint: "B" }).includes("review.state-recovery"));
    assert.ok(ids({ subjectsCount: 2 }).includes("review.state-recovery"));
    assert.ok(!ids({ subjectsCount: 1 }).includes("review.state-recovery"));
    // V01 确定性双调逐字节
    const ident = computePolicyIdentity instanceof Function ? { ...base } : base;
    void ident;
    assert.equal(stableStringify(deriveObligations({ ...base })), stableStringify(deriveObligations({ ...base })));
  });
});

describe("⑧CLI 退出码（真子进程）", () => {
  const HOME = mkdtempSync(join(tmpdir(), "lzy-scope-home-"));
  const lzy = (d, args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: d, encoding: "utf8", timeout: 60_000, env: { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: "/nonexistent-suppressed" } });
    return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  };
  test("qualify/reuse 用法错 2/前置不具备 3；reopen 余态 1/不在账 1/用法 2", async () => {
    const d = fixture();
    try {
      assert.equal(lzy(d, ["review", "qualify"]).code, 2);
      assert.equal(lzy(d, ["review", "qualify", "fx.a1.r1"]).code, 2, "缺 --scope");
      assert.equal(lzy(d, ["review", "qualify", "fx.a1.r1", "--scope", "/nonexistent.json"]).code, 2);
      assert.equal(lzy(d, ["review", "qualify", "fx.a1.r1", "--scope", writeTmpDecl(d)]).code, 3, "无运行=前置拒");
      assert.equal(lzy(d, ["review", "reuse", "fx.a1.r9"]).code, 3, "运行不在案=前置拒");
      assert.equal(lzy(d, ["review", "reuse"]).code, 2);
      assert.equal(lzy(d, ["finding", "reopen"]).code, 1, "状态变更族指纹不合法=语义拒（F-6 口径）");
      assert.equal(lzy(d, ["finding", "reopen", "deadbeef"]).code, 1, "不在账=语义拒");
      // open 态 reopen 拒（语义 1）
      const disp = recordFindingSightings(d, "fx", { runId: "fx.a1.r1", attempt: 1, at: new Date().toISOString(), dutyId: DECLARABLE, findings: [{ severity: "P2", title: "cli", location: "a.txt:1" }] });
      void disp;
      assert.equal(lzy(d, ["finding", "reopen", listFindings(d, "fx")[0].fingerprint.slice(0, 8)]).code, 1, "open 态 reopen=语义拒");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

// ── 0.4.0 M5 N1（M4 输入 7）：结构三轴必须真注入身份漂移并携带证据——旧实现直接以合成
// reason 走聚合管线恒 fallback、不读 expect（恒真断言，不构成证据）。──
describe("⑮结构轴真漂移注入（M5 N1）", () => {
  const STRUCT_SUITE = {
    schemaVersion: 1,
    dutyId: DECLARABLE,
    procedureVersion: 1,
    challenges: [
      ...SUITE.challenges,
      { id: "C9", axis: "contract", expect: "invalidate" },
      { id: "C10", axis: "duty", expect: "invalidate" },
    ],
  };
  test("env/contract/duty 三轴真漂移检出+证据字段+expect 对表", async () => {
    const d = fixture();
    try {
      saveBaseRun(d);
      const res = await qualifyReviewScope(d, { runId: "fx.a1.r1", scopeDecl: DECL }, { dutyEntry: DUTY_ENTRY, suite: STRUCT_SUITE });
      assert.equal(res.granted, true, "三轴真漂移应全部检出");
      const struct = res.record.challenges.filter((c) => ["env", "contract", "duty"].includes(c.axis));
      assert.equal(struct.length, 3);
      for (const c of struct) {
        assert.equal(c.observed, "invalidate", `${c.axis} 观察值须为身份漂移判定 invalidate（旧实现恒 structural-invalidate 合成串）`);
        assert.equal(c.ok, true, `${c.axis} 挑战应通过`);
        assert.equal(c.ok, c.observed === c.expect, `${c.axis} ok 须与 expect 对表（不再恒真）`);
        assert.ok(c.drift && String(c.drift.base) !== String(c.drift.drifted), `${c.axis} 须携带真实漂移证据（base≠drifted）`);
      }
      const envC = struct.find((c) => c.axis === "env");
      assert.match(String(envC.drift.drifted), /^[0-9a-f]{64}$/, "env 漂移值须为同形状 64 hex 指纹");
      const dutyC = struct.find((c) => c.axis === "duty");
      assert.equal(Number(dutyC.drift.drifted), Number(dutyC.drift.base) + 1, "duty 漂移=表版本+1");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
  test("structuralAxisDriftVerdict 纯函数真值表（漂移未发生=keep）", async () => {
    const { structuralAxisDriftVerdict } = await import("../core/review.js");
    assert.equal(structuralAxisDriftVerdict("env", { env: "a" }, { env: "a" }), "keep");
    assert.equal(structuralAxisDriftVerdict("env", { env: "a" }, { env: "b" }), "invalidate");
    assert.equal(structuralAxisDriftVerdict("contract", { contractHash: null }, { contractHash: HEX("d") }), "invalidate");
    assert.equal(structuralAxisDriftVerdict("duty", { dutyTableVersion: 4 }, { dutyTableVersion: 5 }), "invalidate");
    assert.equal(structuralAxisDriftVerdict("duty", { dutyTableVersion: 4 }, { dutyTableVersion: 4 }), "keep");
  });
});

// CLI 用例辅助：声明文件落盘
function writeTmpDecl(d) {
  const p = join(d, "decl.json");
  writeFileSync(p, JSON.stringify(DECL));
  return p;
}
