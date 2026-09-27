// 策略身份与义务生成契约测试（0.4.0 M1 N8；docs/plan-v040-engineering-policy.md §3 与
// V01/V02/V03 的 M1 面）。被测面=core/policy.js 的确定性导出与记录家族闸，加 N8 收口的
// 「采纳落档」真实 CLI 接线（register→plan→start 后 .lazyzcode/policy/<slug>.a<n>.json 在案）。
// 家法：纯判定面直调（同 delivery-gate 的 core 函数级模子）；涉及 goal.json/候选身份的
// 断言走真子进程 + HOME 隔离 + 人权门消融（非本文件被测面）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  BASELINE_REVIEW_ID,
  DUTY_TABLE_VERSION,
  POLICY_VERSION,
  PolicyError,
  computePolicyIdentity,
  deriveObligations,
  ensurePolicyRecord,
  identityStableHash,
  loadPolicyFile,
  loadPolicyRecord,
  policyRulesHash,
  stableStringify,
} from "../core/policy.js";
import { evaluateAcceptanceCoverage } from "../core/loop.js";
import { evaluateGate } from "../core/gate.js";
import { judgeReceiptIdentity } from "../core/verify.js";
import { loadContract } from "../core/contract.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const CLI = join(ROOT, "cli", "lzy.js");
const HOME = mkdtempSync(join(tmpdir(), "lzy-pol-home-"));

const MANIFEST = {
  schemaVersion: 1,
  capabilities: {
    check: [
      { id: "lint", argv: ["node", "-e", "process.exit(0)"] },
      { id: "unit", argv: ["node", "-e", "process.exit(0)"], inputPaths: ["a.txt"] },
    ],
    ci: { requiredChecks: ["ci / test (24, ubuntu-latest)", "ci / test (24, windows-latest)"] },
  },
};

const CONTRACT = "task: pol\nendpoint: B\nscope: .\nrecipe: none\n\n- [A1] alpha works\n- [A2] beta works\n";

function scratch(prefix = "lzy-pol-") {
  const d = mkdtempSync(join(tmpdir(), prefix));
  return d;
}

// 冻结输入夹具：清单+契约+goal 对象（ensurePolicyRecord 的入参面——策略记录只从这些事实
// 导出，goal.json 其余面不参与）。
function frozenInputs(d, { manifest = MANIFEST, contractText = CONTRACT, tier = "heavy", risk = "med", attempt = 1 } = {}) {
  if (manifest !== null) writeFileSync(join(d, "lzy.project.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(d, "contract.md"), contractText);
  const loaded = loadContract(join(d, "contract.md"), d);
  const goal = {
    version: 2,
    slug: "pol",
    attempt,
    tier,
    risk,
    contract: { path: "contract.md", contractHash: loaded.hash },
    subjects: [],
  };
  return goal;
}

const recordPath = (d, slug = "pol", attempt = 1) => join(d, ".lazyzcode", "policy", `${slug}.a${attempt}.json`);
const recordBytes = (d, slug = "pol", attempt = 1) => readFileSync(recordPath(d, slug, attempt), "utf8");

// 手改盘上字节（反例构造）：家族容器格式（JSON.stringify(payload)+checksum 顶层键）由本
// 帮手原样复刻——写侧形状闸只挡合法写者，被测面是**读侧**对篡改/畸形的拒绝。
function writeRawRecord(p, payload) {
  const checksum = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  writeFileSync(p, `${JSON.stringify({ ...payload, checksum }, null, 2)}\n`, { mode: 0o600 });
}

test("V01 确定性：同冻结输入两生成逐字节恒等（两同构工作区记录文件相同）", () => {
  const a = scratch("lzy-pol-a-");
  const b = scratch("lzy-pol-b-");
  try {
    const goalA = frozenInputs(a);
    const goalB = frozenInputs(b);
    const rA = ensurePolicyRecord(a, goalA);
    const rB = ensurePolicyRecord(b, goalB);
    assert.equal(rA.created, true);
    assert.equal(rB.created, true);
    assert.equal(rA.applicable, true);
    assert.equal(rB.applicable, true);
    // 记录字节逐字节相同（无时戳/无绝对路径——确定性导出的落地证明）
    assert.equal(recordBytes(a), recordBytes(b));
    assert.equal(rA.record.inputsHash, rB.record.inputsHash);
    assert.equal(rA.record.rulesHash, policyRulesHash());
    // 义务集恒等且覆盖四类（review 底线 / check 逐条 / ci 必需集合 / delivery-audit）
    const idA = rA.record.obligations.map((o) => o.id);
    const idB = rB.record.obligations.map((o) => o.id);
    assert.deepEqual(idA, idB);
    assert.deepEqual(idA, [BASELINE_REVIEW_ID, "check.lint", "check.unit", "ci.required-checks", "delivery.audit"]);
    assert.deepEqual(new Set(rA.record.obligations.map((o) => o.type)), new Set(["review", "check", "ci", "delivery-audit"]));
    // 逐条形状面（id/type/source/适用理由/验收映射/满足条件/依赖边界/版本）
    for (const o of rA.record.obligations) {
      assert.equal(o.version, POLICY_VERSION);
      assert.equal(typeof o.source, "string");
      assert.equal(typeof o.appliesBecause, "string");
      assert.equal(typeof o.satisfaction, "string");
      assert.ok(Array.isArray(o.acceptanceIds));
      assert.ok(Array.isArray(o.dependsOn));
    }
    assert.equal(rA.record.obligations.find((o) => o.id === BASELINE_REVIEW_ID).baseline, true);
    // 纯函数面同调恒等（不经盘）
    const identity = computePolicyIdentity(a, goalA);
    assert.equal(stableStringify(deriveObligations(identity)), stableStringify(deriveObligations(computePolicyIdentity(a, goalA))));
    assert.equal(identityStableHash(identity), identityStableHash(computePolicyIdentity(a, goalA)));
    assert.equal(DUTY_TABLE_VERSION, rA.record.dutyTableVersion);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test("V01 幂等：在案且输入一致→零写（created:false、盘上字节不变）；V02 漂移无 expand=不重导", () => {
  const d = scratch();
  try {
    const goal = frozenInputs(d);
    ensurePolicyRecord(d, goal);
    const before = recordBytes(d);
    const again = ensurePolicyRecord(d, goal);
    assert.equal(again.created, false);
    assert.equal(again.drifted, false);
    assert.equal(recordBytes(d), before);
    // 输入身份漂移（清单换内容）而无 expand：不重导、连原因返回 drifted（闸面据此阻塞）
    const goal2 = frozenInputs(d, { manifest: { ...MANIFEST, capabilities: { ...MANIFEST.capabilities, start: [{ id: "boot", argv: ["node", "-e", "0"] }] } } });
    const drift = ensurePolicyRecord(d, goal2);
    assert.equal(drift.drifted, true);
    assert.equal(drift.created, false);
    assert.equal(recordBytes(d), before, "漂移不得静默改写在案记录（任务运行期间固定策略版本）");
    assert.match(drift.driftReasons.join("\n"), /漂移/);
    assert.match(drift.driftReasons.join("\n"), /expand/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("§3.2 影响扩大：expand 追加义务并记前后差异；底线保留、删除即 PolicyError", () => {
  const d = scratch();
  try {
    const goal = frozenInputs(d, {
      manifest: { ...MANIFEST, capabilities: { check: [MANIFEST.capabilities.check[0]], ci: MANIFEST.capabilities.ci } },
    });
    const first = ensurePolicyRecord(d, goal);
    const before = first.record.obligations.map((o) => o.id);
    assert.deepEqual(before, [BASELINE_REVIEW_ID, "check.lint", "ci.required-checks", "delivery.audit"]);
    // 影响扩大：清单增 unit 配方（只增不删）
    const goal2 = frozenInputs(d);
    const grown = ensurePolicyRecord(d, goal2, { expand: true, reason: "N8 测试：影响扩大" });
    assert.equal(grown.expanded, true);
    assert.equal(grown.drifted, false);
    const after = grown.record.obligations.map((o) => o.id);
    assert.deepEqual(after, [BASELINE_REVIEW_ID, "check.lint", "check.unit", "ci.required-checks", "delivery.audit"]);
    assert.deepEqual(grown.record.obligationsLog.map((e) => e.event), ["expand"]);
    const log = grown.record.obligationsLog[0];
    assert.equal(log.from, first.record.inputsHash);
    assert.equal(log.to, grown.record.inputsHash);
    assert.deepEqual(log.added, ["check.unit"]);
    assert.deepEqual(log.removed, []);
    assert.match(log.reason, /影响扩大/);
    assert.ok(grown.record.obligations.some((o) => o.id === BASELINE_REVIEW_ID && o.baseline === true), "底线义务跨 expand 保留");
    // 删除路径：清单缩回（盘上恢复为只含 lint 的清单）→expand 须抛（M1 无删除路径，取消须独立复判 M3）
    const reduced = frozenInputs(d, {
      manifest: { ...MANIFEST, capabilities: { check: [MANIFEST.capabilities.check[0]], ci: MANIFEST.capabilities.ci } },
    });
    assert.throws(() => ensurePolicyRecord(d, reduced, { expand: true }), PolicyError);
    assert.throws(() => ensurePolicyRecord(d, reduced, { expand: true }), /不得删义务/);
    // 抛出不改写在案记录（失败不改写家法）
    assert.deepEqual(loadPolicyRecord(d, "pol", 1).obligations.map((o) => o.id), after);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("底线不可删（读侧形状闸）：底线条目缺席或降格→fail-closed 拒", () => {
  const d = scratch();
  try {
    const goal = frozenInputs(d);
    const { record } = ensurePolicyRecord(d, goal);
    const p = recordPath(d);
    // ① 底线条目整体删除（重算校验和，绕不过形状关）
    const dropped = { ...record, obligations: record.obligations.filter((o) => o.id !== BASELINE_REVIEW_ID) };
    writeRawRecord(p, dropped);
    assert.throws(() => loadPolicyRecord(d, "pol", 1), /底线义务/);
    // ② 底线降格（baseline 旗去掉）
    const demoted = { ...record, obligations: record.obligations.map((o) => (o.id === BASELINE_REVIEW_ID ? { ...o, baseline: false } : o)) };
    writeRawRecord(p, demoted);
    assert.throws(() => loadPolicyFile(p), /底线义务/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("家族 fail-closed：校验和不符 / 版本不符 / 形状非法 三面拒（不可读≠缺席）", () => {
  const d = scratch();
  try {
    const goal = frozenInputs(d);
    const { record } = ensurePolicyRecord(d, goal);
    const p = recordPath(d);
    // ① 校验和不符（改内容不改校验和）
    writeFileSync(p, `${JSON.stringify({ ...record, checksum: "0".repeat(64) }, null, 2)}\n`);
    assert.throws(() => loadPolicyRecord(d, "pol", 1), /校验和不符/);
    // ② 版本不符（盘上 v2，本 lzy 认 v1）
    writeRawRecord(p, { ...record, schemaVersion: POLICY_VERSION + 1 });
    assert.throws(() => loadPolicyRecord(d, "pol", 1), /版本不兼容/);
    // ③ 形状非法（义务 type 不识别）
    const badType = { ...record, obligations: record.obligations.map((o, i) => (i === 0 ? { ...o, type: "unknown-type" } : o)) };
    writeRawRecord(p, badType);
    assert.throws(() => loadPolicyFile(p), /义务形状非法|类型.*不识别/);
    // ④ 义务 id 重复
    const dup = { ...record, obligations: [...record.obligations, record.obligations[0]] };
    writeRawRecord(p, dup);
    assert.throws(() => loadPolicyFile(p), /义务 id 重复|形状非法/);
    // ⑤ 缺席（ENOENT）恒 null——不是错误，也绝不当「已落档」
    rmSync(p, { force: true });
    assert.equal(loadPolicyRecord(d, "pol", 1), null);
    assert.equal(loadPolicyRecord(d, "pol", 9), null);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("V03 缺验收映射：evaluateAcceptanceCoverage 缺项与脱节两腿（统一门 ② 子句的判定源）", () => {
  const d = scratch();
  try {
    frozenInputs(d); // 落 contract.md（本测试只消费其解析件）
    const contract = loadContract(join(d, "contract.md"), d);
    const full = [
      { id: "F1", acceptsRefs: ["A1"] },
      { id: "F2", acceptsRefs: ["A2"] },
    ];
    assert.deepEqual(evaluateAcceptanceCoverage(contract, full), { applicable: true, unknownIds: [], missingIds: [] });
    // 缺项：契约验收项 A2 无任何 F 项引用
    const missing = evaluateAcceptanceCoverage(contract, [{ id: "F1", acceptsRefs: ["A1"] }]);
    assert.deepEqual(missing.missingIds, ["A2"]);
    // 脱节：F 项引用契约不存在的验收项
    const unknown = evaluateAcceptanceCoverage(contract, [...full, { id: "F3", acceptsRefs: ["A9"] }]);
    assert.deepEqual(unknown.unknownIds, ["F3→A9"]);
    assert.equal(unknown.missingIds.length, 0);
    // 解析件键名（accepts）与持久件键名（acceptsRefs）双吃——同一覆盖语义
    assert.deepEqual(evaluateAcceptanceCoverage(contract, [{ id: "F1", accepts: ["A1", "A2"] }]).missingIds, []);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("真 CLI 面：采纳即落策略档（V01/V13 M1 面）+ 解释面两次输出逐字节同", () => {
  const d = scratch("lzy-pol-cli-");
  try {
    const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
    g(["init", "-q"]);
    g(["config", "user.email", "t@t"]);
    g(["config", "user.name", "t"]);
    writeFileSync(join(d, "a.txt"), "a\n");
    g(["add", "a.txt"]);
    g(["commit", "-qm", "init"]);
    writeFileSync(join(d, "lzy.project.json"), `${JSON.stringify(MANIFEST, null, 2)}\n`);
    writeFileSync(join(d, "p.md"), "- [N1] work\n");
    const lzy = (args) =>
      spawnSync(process.execPath, [CLI, ...args], {
        cwd: d,
        encoding: "utf8",
        timeout: 120_000,
        env: { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: "/nonexistent-lzy-suppressed", LZY_ABLATE_HUMAN_GATE: "1" },
      });
    assert.equal(lzy(["loop", "register", "polcli", "--title", "t"]).status, 0);
    const plan = lzy(["loop", "plan", "p.md"]);
    assert.equal(plan.status, 0, `${plan.stdout ?? ""}${plan.stderr ?? ""}`);
    // 采纳即落档：v2 目标的策略记录在案且过形状闸（读取即校验和+版本+形状三重闸）
    const rec = loadPolicyRecord(d, "polcli", 1);
    assert.ok(rec, "register→plan 后策略记录须在案（N8 收口 ensurePolicyRecord 接线）");
    assert.equal(rec.slug, "polcli");
    assert.ok(rec.obligations.some((o) => o.id === BASELINE_REVIEW_ID && o.baseline === true));
    assert.ok(rec.obligations.some((o) => o.id === "check.unit"));
    assert.ok(rec.obligations.some((o) => o.id === "ci.required-checks"));
    // 解释面（纯读）两次输出逐字节同——V01 的 CLI 侧
    const s1 = lzy(["policy", "explain"]);
    const s2 = lzy(["policy", "explain"]);
    assert.equal(s1.status, 0, `${s1.stdout ?? ""}${s1.stderr ?? ""}`);
    assert.equal(`${s1.stdout ?? ""}${s1.stderr ?? ""}`, `${s2.stdout ?? ""}${s2.stderr ?? ""}`);
    assert.match(s1.stdout ?? "", /记录在案/);
    assert.match(s1.stdout ?? "", /评审运行器：在案/); // 0.4.0 M2 N5 翻面：runner available ⇒「在案」
    assert.match(s1.stdout ?? "", /dutyTable v3/);
    // 二次采纳（无变更）= 零写
    const before = recordBytes(d, "polcli");
    assert.equal(lzy(["loop", "plan", "p.md"]).status, 0);
    assert.equal(recordBytes(d, "polcli"), before);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("V03 旧 null 契约绑定不得猜测补齐：无契约归属的回执不构成现行覆盖", () => {
  const d = scratch("lzy-pol-null-");
  try {
    const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
    g(["init", "-q"]);
    g(["config", "user.email", "t@t"]);
    g(["config", "user.name", "t"]);
    writeFileSync(join(d, "a.txt"), "a\n");
    g(["add", "a.txt"]);
    g(["commit", "-qm", "init"]);
    writeFileSync(join(d, "contract.md"), CONTRACT);
    writeFileSync(join(d, "plan.md"), "- [N1] work\n");
    const lzy = (args) =>
      spawnSync(process.execPath, [CLI, ...args], {
        cwd: d,
        encoding: "utf8",
        timeout: 120_000,
        env: { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: "/nonexistent-lzy-suppressed", LZY_ABLATE_HUMAN_GATE: "1" },
      });
    lzy(["loop", "register", "polnull", "--title", "t", "--contract", "contract.md"]);
    assert.equal(lzy(["loop", "plan", "plan.md"]).status, 0);
    const goalHash = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8")).contract.contractHash;
    // 契约启用前的旧回执（contractHash=nil）绑到契约 goal 上：不得猜测补齐为现行契约
    const legacyNull = { runId: "r-legacy", contractHash: null, recipe: { manifestHash: null }, candidate: null };
    const v = judgeReceiptIdentity(d, legacyNull);
    assert.equal(v.ok, false);
    assert.match(v.reasons.join("\n"), /契约归属不符/);
    // 对照半：携带现行契约归属的回执在契约轴上过（清单/候选漂移各自另判）
    const own = judgeReceiptIdentity(d, { runId: "r-own", contractHash: goalHash, recipe: { manifestHash: null }, candidate: null });
    assert.equal(own.reasons.filter((r) => r.includes("契约归属")).length, 0);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// 0.4.0 M2 N5 拍板 2 读侧放宽双断言：旧 dutyTableVersion 档可读（形状闸只验正整数）∧
// rulesHash 不符走漂移判（gate ③「规则版本漂移…采纳提案」，非形状损坏）。
test("⑪0.4.0 M2 N5 读侧放宽：旧版本档可读；版本漂移由 rulesHash 子句判不由形状闸判", () => {
  const d = scratch();
  try {
    const goal = frozenInputs(d);
    // gate 需要目标承载身份（readGoal 严格闸：v2 须 policy 身份）：夹具 goal 落盘
    mkdirSync(join(d, ".lazyzcode", "loop"), { recursive: true });
    writeFileSync(join(d, ".lazyzcode", "loop", "goal.json"), `${JSON.stringify({ ...goal, policy: { schemaVersion: 1 } }, null, 2)}\n`);
    const created = ensurePolicyRecord(d, goal);
    assert.ok(created.applicable, "现行记录落档");
    // 手改盘上档：版本降回 1 + 规则哈希清零（旧规则版本形态），校验和按容器家法重签——
    // 被测面=读侧对旧版本档的形状放宽与 gate 漂移判，不是校验和闸。
    const p = recordPath(d);
    const rec = JSON.parse(readFileSync(p, "utf8"));
    const { checksum: _omit, ...rest } = rec;
    rest.dutyTableVersion = 1;
    rest.rulesHash = "0".repeat(64);
    rest.runnerFace = { available: false, plannedPhase: "M2" };
    writeRawRecord(p, rest);
    // ① 旧 dutyTableVersion 档可读：形状闸不再严格相等拒
    const loaded = loadPolicyFile(p);
    assert.equal(loaded.dutyTableVersion, 1, "旧版本档过形状闸（正整数即读）");
    // ② gate 走漂移判：policyIdentity 子句阻塞且原因=规则版本漂移（非「形状非法/不可读」）
    const gate = evaluateGate(d);
    assert.equal(gate.applicable, true);
    assert.equal(gate.clauses.policyIdentity.ok, false);
    const why = gate.clauses.policyIdentity.reasons.join("\n");
    assert.match(why, /规则版本漂移/, `阻断原因须为漂移判：${why}`);
    assert.doesNotMatch(why, /形状非法|不可读/, "旧版本档不得被形状闸/读面拒绝");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
