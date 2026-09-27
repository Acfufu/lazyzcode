// 发现账本契约测试（0.4.0 M3 N10）：家族/指纹/状态机/relink/门 findings 子句成对/close 拒
// 矩阵/CLI 退出码/评审预算执法。deps 注入零真引擎，CI 可跑。结构沿 review-runtime.contract.test.js。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "cli", "lzy.js");

import {
  loadFindingsFile, findingsPath, findingFingerprint, assertFindingsShape,
  recordFindingSightings, requestResolve, closeFinding, diagnoseFinding, relinkFindings,
  resolveFindingsScope, listFindings, openBlockingFindings,
  FINDINGS_VERSION, DIAGNOSIS_REQUIRED_THRESHOLD,
} from "../core/findings.js";
import { runReview, preflightReview, BASELINE_DUTY_ID, REVIEW_VERSION, dutyTemplateHash } from "../core/review.js";
import { evaluateGate } from "../core/gate.js";
import { appendLedgerEntry, budgetView, reviewLedgerPoints } from "../core/queue.js";
import { recordAuthorization } from "../core/contract.js";
import { saveFamilyFile } from "../core/queue.js";

const CONTRACT = "task: t\nendpoint: A\nscope: .\nrecipe: none\nbudget-ref: none\n\n- [A1] x\n";
const CONTRACT_POINTS = "task: t\nendpoint: A\nscope: .\nrecipe: none\nbudget-ref: points:1\n\n- [A1] x\n";
const FENCE = (obj) => "```json\n" + JSON.stringify(obj) + "\n```";
const PASS = { duty: BASELINE_DUTY_ID, verdict: "pass", findings: [], summary: "clean" };
const BLOCKED = (title = "授权撤回可绕过") => ({
  duty: BASELINE_DUTY_ID,
  verdict: "blocked",
  findings: [{ id: "f1", title, severity: "P1", blocking: true, location: "auth.js:12", evidence: "e", summary: "s" }],
  summary: "bad",
});

function fixture({ contractText = CONTRACT } = {}) {
  const d = mkdtempSync(join(tmpdir(), "lzy-rft-"));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@t"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "hello\n");
  writeFileSync(join(d, "contract.md"), contractText);
  mkdirSync(join(d, ".lazyzcode", "loop"), { recursive: true });
  writeFileSync(
    join(d, ".lazyzcode", "loop", "goal.json"),
    JSON.stringify({
      version: 2, slug: "fx", title: "fixture", status: "executing", attempt: 1, tier: "light", risk: "low",
      policy: { schemaVersion: 1 }, contract: { path: "contract.md", contractHash: "c".repeat(64) }, subjects: [],
      steps: [{ id: "N1", kind: "N", title: "do", status: "done", note: "did", acceptsRefs: [] }],
    }),
  );
  g(["add", "-A"]);
  g(["commit", "-qm", "init"]);
  return d;
}

const stubSpawn = (response) => async ({ cwd, home }) => {
  mkdirSync(join(home, ".zcode", "cli", "rollout"), { recursive: true });
  writeFileSync(join(home, ".zcode", "cli", "rollout", "model-io-sess_x.jsonl"), JSON.stringify({ tool: { file_path: join(cwd, "a.txt") } }) + "\n");
  return { ok: true, exitCode: 0, signal: null, timedOut: false, durationMs: 5, stdout: FENCE(response) + "\n" + JSON.stringify({ sessionId: "sess_x", response: FENCE(response) }) + "\n", stderr: "", response: FENCE(response), sessionId: "sess_x" };
};
const deps = (response, points = 1) => ({ preflight: async () => ({ budget: null }), spawnHeadless: stubSpawn(response), querySessionPoints: async () => ({ absent: false, unpriced: [], points }) });
const SIGHT = (title = "授权撤回可绕过") => ({ severity: "P1", title, location: "auth.js:12" });
const at = (h, m) => `2026-09-28T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;

describe("①家族：形状闸/roundtrip/损坏 fail-closed/slug 面", () => {
  test("落账建档、校验和与版本闸、篡改拒、非法 slug 拒", () => {
    const d = fixture();
    try {
      recordFindingSightings(d, "fx", { runId: "fx.a1.r1", attempt: 1, at: at(0, 0), findings: [SIGHT()] });
      const rec = loadFindingsFile(d, "fx");
      assert.equal(rec.slug, "fx");
      assert.deepEqual(rec.aliases, []);
      assert.equal(Object.keys(rec.findings).length, 1);
      const [fp, e] = Object.entries(rec.findings)[0];
      assert.match(fp, /^[0-9a-f]{64}$/);
      assert.equal(e.status, "open");
      assert.equal(e.occurrences, 1);
      // 篡改→fail-closed
      const p = findingsPath(d, "fx");
      const raw = JSON.parse(readFileSync(p, "utf8"));
      raw.findings[fp].occurrences = 999;
      delete raw.checksum;
      writeFileSync(p, JSON.stringify(raw));
      assert.throws(() => loadFindingsFile(d, "fx"), /校验和不符|形状非法/);
      // 非法 slug（路径穿越）
      assert.throws(() => findingsPath(d, "../evil"), /非法/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("②指纹与状态机：建账/重见/无效修复×2→diagnosis-required/diagnose 重置/关闭/回归", () => {
  test("全链流转与历史留痕", () => {
    const d = fixture();
    try {
      const fp = findingFingerprint(SIGHT());
      let disp = recordFindingSightings(d, "fx", { runId: "fx.a1.r1", attempt: 1, at: at(0, 0), findings: [SIGHT()] });
      assert.equal(disp[0].action, "created");
      disp = recordFindingSightings(d, "fx", { runId: "fx.a1.r2", attempt: 1, at: at(0, 1), findings: [SIGHT()] });
      assert.equal(disp[0].action, "seen");
      assert.equal(loadFindingsFile(d, "fx").findings[fp].occurrences, 2);
      // 声称→无效修复 1/2
      requestResolve(d, "fx", fp, { note: "试修", at: at(0, 2) });
      disp = recordFindingSightings(d, "fx", { runId: "fx.a1.r3", attempt: 1, at: at(0, 3), findings: [SIGHT()] });
      assert.equal(disp[0].status, "open");
      assert.equal(disp[0].invalidFixCount, 1);
      // 第二轮 → diagnosis-required
      requestResolve(d, "fx", fp, { at: at(0, 4) });
      disp = recordFindingSightings(d, "fx", { runId: "fx.a1.r4", attempt: 1, at: at(0, 5), findings: [SIGHT()] });
      assert.equal(disp[0].status, "diagnosis-required");
      assert.throws(() => requestResolve(d, "fx", fp, { at: at(0, 6) }), /diagnosis-required/);
      // diagnose 重置
      diagnoseFinding(d, "fx", fp, { rootCause: "公共放行函数未查撤回账", at: at(0, 7) });
      const e = loadFindingsFile(d, "fx").findings[fp];
      assert.equal(e.status, "open");
      assert.equal(e.invalidFixCount, 0);
      // 关闭（fixed）
      requestResolve(d, "fx", fp, { at: at(0, 8) });
      closeFinding(d, "fx", fp, { outcome: "fixed", basis: "撤回检查入放行函数", recheck: { runId: "fx.a1.r5", valid: true, reportedFingerprints: [] }, at: at(0, 9) });
      assert.equal(loadFindingsFile(d, "fx").findings[fp].status, "closed-fixed");
      assert.equal(openBlockingFindings(d, "fx").length, 0);
      // 回归重开
      recordFindingSightings(d, "fx", { runId: "fx.a2.r1", attempt: 2, at: at(1, 0), findings: [SIGHT()] });
      const e2 = loadFindingsFile(d, "fx").findings[fp];
      assert.equal(e2.status, "open");
      assert.equal(e2.closure, null);
      assert.ok(e2.history.some((h) => h.kind === "regression"));
      assert.ok(e2.history.some((h) => h.kind === "closed-fixed"));
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("③relink：闭包并集/环拒/穿越拒", () => {
  test("别名链与防护", () => {
    const d = fixture();
    try {
      const disp = recordFindingSightings(d, "fx", { runId: "fx.a1.r1", attempt: 1, at: at(0, 0), findings: [SIGHT()] });
      relinkFindings(d, "fx", "fx2", { at: at(0, 1) });
      assert.deepEqual(resolveFindingsScope(d, "fx2"), ["fx2", "fx"]);
      assert.equal(listFindings(d, "fx2", { includeClosed: false }).length, 1);
      assert.equal(listFindings(d, "fx2", { includeClosed: false })[0].originSlug, "fx");
      assert.throws(() => relinkFindings(d, "fx2", "fx"), /成环/);
      assert.throws(() => relinkFindings(d, "../../etc", "fx2"), /非法/);
      // 重复 relink 幂等
      const r = relinkFindings(d, "fx", "fx2");
      assert.equal(r.changed, false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("④门 findings 子句成对：open 拦/close 过/损坏 fail-closed", () => {
  test("统一门三态", () => {
    const d = fixture();
    try {
      let gate = evaluateGate(d);
      assert.equal(gate.clauses.findings.ok, true);
      const disp = recordFindingSightings(d, "fx", { runId: "fx.a1.r1", attempt: 1, at: at(0, 0), findings: [SIGHT()] });
      const fp = disp[0].fingerprint;
      gate = evaluateGate(d);
      assert.equal(gate.clauses.findings.ok, false);
      assert.ok(gate.blockedReasons.some((r) => r.startsWith("[findings]") && r.includes(fp.slice(0, 8))));
      // 别名改名后仍拦
      relinkFindings(d, "fx", "fx3");
      const goalPath = join(d, ".lazyzcode", "loop", "goal.json");
      const g = JSON.parse(readFileSync(goalPath, "utf8"));
      g.slug = "fx3";
      writeFileSync(goalPath, JSON.stringify(g));
      gate = evaluateGate(d);
      assert.equal(gate.clauses.findings.ok, false);
      // 关闭→过
      requestResolve(d, "fx", fp, { at: at(0, 2) });
      closeFinding(d, "fx", fp, { outcome: "falsified", basis: "原报证据与代码不符（误报）", recheck: { runId: "fx.a1.r2", valid: true, reportedFingerprints: [] } });
      gate = evaluateGate(d);
      assert.equal(gate.clauses.findings.ok, true);
      // 账本损坏→fail-closed
      const p = findingsPath(d, "fx");
      writeFileSync(p, "{not-json");
      gate = evaluateGate(d);
      assert.equal(gate.clauses.findings.ok, false);
      assert.match(gate.clauses.findings.reasons[0], /不可读/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("⑤close 拒矩阵（core 状态机）", () => {
  test("outcome/basis/recheck/状态 四拒", () => {
    const d = fixture();
    try {
      const disp = recordFindingSightings(d, "fx", { runId: "fx.a1.r1", attempt: 1, at: at(0, 0), findings: [SIGHT()] });
      const fp = disp[0].fingerprint;
      // open 态不能 close
      assert.throws(() => closeFinding(d, "fx", fp, { outcome: "fixed", basis: "x", recheck: { runId: "r", valid: true, reportedFingerprints: [] } }), /状态机拒绝/);
      requestResolve(d, "fx", fp, { at: at(0, 1) });
      assert.throws(() => closeFinding(d, "fx", fp, { outcome: "nope", basis: "x", recheck: { runId: "r", valid: true, reportedFingerprints: [] } }), /outcome 非法/);
      assert.throws(() => closeFinding(d, "fx", fp, { outcome: "fixed", recheck: { runId: "r", valid: true, reportedFingerprints: [] } }), /basis/);
      assert.throws(() => closeFinding(d, "fx", fp, { outcome: "fixed", basis: "x", recheck: { runId: "r", valid: false, reportedFingerprints: [] } }), /非 valid/);
      assert.throws(() => closeFinding(d, "fx", fp, { outcome: "fixed", basis: "x", recheck: { runId: "r", valid: true, reportedFingerprints: [fp] } }), /仍报该发现/);
      assert.equal(loadFindingsFile(d, "fx").findings[fp].status, "resolve-requested");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("⑥CLI 退出码（真子进程；finding 面零 spawn）", () => {
  test("list 空 0/未知子命令 2/show 无发现 2/resolve 不在账 1/损坏账本 list 非 0", () => {
    const d = fixture();
    try {
      const env = { ...process.env, LZY_ZCODE_ENGINE: "/nonexistent-lzy-suppressed", LZY_ABLATE_HUMAN_GATE: "1" };
      const lzy = (args) => {
        const r = spawnSync(process.execPath, [CLI, ...args], { cwd: d, encoding: "utf8", timeout: 60_000, env });
        return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
      };
      assert.equal(lzy(["finding", "list"]).code, 0);
      assert.equal(lzy(["finding", "badsub"]).code, 2);
      assert.equal(lzy(["finding", "show", "0123abcd"]).code, 2);
      assert.equal(lzy(["finding", "resolve-request", "0123abcd"]).code, 1);
      // 播种一条→list 命名；再破坏→fail-closed 非 0
      const disp = recordFindingSightings(d, "fx", { runId: "fx.a1.r1", attempt: 1, at: at(0, 0), findings: [SIGHT()] });
      const fp8 = disp[0].fingerprint.slice(0, 8);
      const r = lzy(["finding", "list"]);
      assert.equal(r.code, 0);
      assert.ok(r.out.includes(fp8));
      const p = findingsPath(d, "fx");
      writeFileSync(p, "{broken");
      assert.equal(lzy(["finding", "list"]).code, 1);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("⑦评审预算执法（N9）：入账/分项/超限拒/无契约不写", () => {
  test("ledger review 类与 preflight 执法", async () => {
    const d1 = fixture({ contractText: CONTRACT_POINTS });
    try {
      recordAuthorization(d1, { kind: "approval", slug: "fx", contractHash: "c".repeat(64), sessionId: "t", at: at(0, 0) });
      const r1 = await runReview(d1, { deps: deps(PASS, 0.4) });
      assert.equal(r1.record.validity.status, "valid");
      assert.ok(Math.abs(budgetView(d1).reviewPoints - 0.4) < 1e-9);
      assert.ok(Math.abs(reviewLedgerPoints(d1, "fx") - 0.4) < 1e-9);
      await runReview(d1, { deps: deps(PASS, 0.4) });
      await runReview(d1, { deps: { ...deps(PASS, 0.4), preflight: preflightReview, detectAuth: () => ({ ok: true, envAuth: true }), sqliteProbe: () => ({ ok: true }) } });
      assert.ok(Math.abs(budgetView(d1).reviewPoints - 1.2) < 1e-9);
      // 自审 F-1 修正：CI/无凭据机器可跑——真前置的凭据依赖（detectAuth/sqliteProbe）注入替身，
      // budget-exhausted 判因因此不被 no-auth 抢先。
      await assert.rejects(() => runReview(d1, { deps: { ...deps(PASS, 0.1), preflight: preflightReview, detectAuth: () => ({ ok: true, envAuth: true }), sqliteProbe: () => ({ ok: true }) } }), (e) => e.reason === "budget-exhausted");
      // dedup：同 runId 重复入账不双计
      const dup = appendLedgerEntry(d1, { kind: "review", dedupKey: `review:${r1.record.runId}`, authorization: { slug: "fx", contractHash: "c".repeat(64) }, points: 999 });
      assert.equal(dup.duplicate, true);
      assert.ok(Math.abs(reviewLedgerPoints(d1, "fx") - 1.2) < 1e-9);
    } finally {
      rmSync(d1, { recursive: true, force: true });
    }
    // 无契约 goal：metered 也不写 ledger
    const d3 = mkdtempSync(join(tmpdir(), "lzy-rft-noc-"));
    try {
      const g = (args) => spawnSync("git", args, { cwd: d3, encoding: "utf8" });
      g(["init", "-q"]); g(["config", "user.email", "t@t"]); g(["config", "user.name", "t"]);
      writeFileSync(join(d3, "a.txt"), "x\n");
      mkdirSync(join(d3, ".lazyzcode", "loop"), { recursive: true });
      writeFileSync(join(d3, ".lazyzcode", "loop", "goal.json"), JSON.stringify({ version: 2, slug: "fx", title: "t", status: "executing", attempt: 1, tier: "light", risk: "low", policy: { schemaVersion: 1 }, contract: null, subjects: [], steps: [] }));
      g(["add", "-A"]); g(["commit", "-qm", "i"]);
      const r = await runReview(d3, { deps: deps(PASS, 9) });
      assert.equal(r.record.validity.status, "valid");
      assert.equal(budgetView(d3).reviewPoints, 0);
    } finally {
      rmSync(d3, { recursive: true, force: true });
    }
  });
});
