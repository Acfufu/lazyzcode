// 受控独立评审运行时契约测试（0.4.0 M2 N7；docs/plan-v040-engineering-policy.md §4.1/§4.2/§6）。
// 被测面=core/review.js 的运行族/形状闸/解析归一化/失败分类 + core/gate.js 评审子句七合取
//（拍板 6）。家法：判定面直调（core 函数级模子，同 policy.contract.test）；runReview 全走
// deps 注入（spawnHeadless/preflight/querySessionPoints——CI 无凭据零真引擎可跑，拍板 11）；
// 授权前置腿走真 effectiveAuthorization + recordAuthorization（非手写批准记录）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASELINE_DUTY_ID,
  INVALID_REASONS,
  REVIEW_VERSION,
  ReviewError,
  ReviewPreflightError,
  assertNoLeak,
  assertReadsContained,
  assertRunShape,
  buildInputPackage,
  listReviewRuns,
  loadReviewFile,
  loadDutyTemplate,
  dutyTemplateHash,
  nextRunSeq,
  normalizeVerdict,
  parseReviewResult,
  reserveRun,
  runReview,
  saveReviewRun,
} from "../core/review.js";
import { ensurePolicyRecord } from "../core/policy.js";
import { evaluateGate } from "../core/gate.js";
import { recordAuthorization } from "../core/contract.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const CLI = join(ROOT, "cli", "lzy.js");
const CONTRACT = "task: t\nendpoint: A\nscope: .\nrecipe: none\nbudget-ref: none\n\n- [A1] x\n";
const FENCE = (obj) => "```json\n" + JSON.stringify(obj) + "\n```";
const PASS = { duty: BASELINE_DUTY_ID, verdict: "pass", findings: [], summary: "clean" };
const METERED = { absent: false, unpriced: [], points: 42 };
const preflightStub = async () => ({ budget: null });

function scratch(prefix = "lzy-rrt-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function fixture({ dirty = false, attempt = 1 } = {}) {
  const d = scratch();
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@t"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "hello\n");
  writeFileSync(join(d, "contract.md"), CONTRACT);
  mkdirSync(join(d, ".lazyzcode", "loop"), { recursive: true });
  writeFileSync(
    join(d, ".lazyzcode", "loop", "goal.json"),
    JSON.stringify({
      version: 2, slug: "fx", title: "fixture", status: "executing", attempt, tier: "light", risk: "low",
      policy: { schemaVersion: 1 },
      contract: { path: "contract.md", contractHash: "c".repeat(64) }, subjects: [],
      steps: [{ id: "N1", kind: "N", title: "do", status: "done", note: "did", acceptsRefs: [] }],
    }),
  );
  if (dirty) writeFileSync(join(d, "dirty.txt"), "uncommitted\n");
  else g(["add", "-A"]), g(["commit", "-qm", "init"]);
  return d;
}

// 替身引擎：写转录（界内读）+ 可注入行为
function stubSpawn({ response = FENCE(PASS), during = null, timedOut = false, exitCode = 0, withTranscript = true, sessionId = "sess_rrt", readOutside = null } = {}) {
  return async ({ cwd, home }) => {
    if (during) during(cwd);
    if (withTranscript) {
      mkdirSync(join(home, ".zcode", "cli", "rollout"), { recursive: true });
      writeFileSync(
        join(home, ".zcode", "cli", "rollout", `model-io-${sessionId}.jsonl`),
        JSON.stringify({ tool: { file_path: readOutside ?? join(cwd, "a.txt") } }) + "\n",
      );
    }
    return {
      ok: !timedOut && exitCode === 0, exitCode: timedOut ? null : exitCode, signal: timedOut ? "SIGKILL" : null,
      timedOut, durationMs: 5, stdout: (response ?? "") + "\n" + JSON.stringify({ sessionId, response: response ?? "" }) + "\n", stderr: "",
      response: timedOut ? undefined : response, sessionId: timedOut ? undefined : sessionId,
    };
  };
}
const deps = (extra = {}) => ({ preflight: preflightStub, spawnHeadless: stubSpawn({}), querySessionPoints: async () => ({ ...METERED }), ...extra });

function recordPayload(d, { attempt = 1, seq = 1, overrides = {} } = {}) {
  return {
    slug: "fx", attempt, seq, runId: `fx.a${attempt}.r${seq}`, schemaVersion: REVIEW_VERSION,
    duty: { id: BASELINE_DUTY_ID }, dutyTableVersion: 2, templateHash: dutyTemplateHash(),
    inputPackageHash: "a".repeat(64),
    candidate: { headSha: "b".repeat(64), compositeFingerprint: "c".repeat(64), cliVersion: null, clean: true },
    snapshot: { treeHash: "d".repeat(64) },
    startedAt: "2026-09-27T00:00:00.000Z", endedAt: "2026-09-27T00:01:00.000Z",
    exit: { code: 0, signal: null }, sessionId: "sess_x", engine: "stub",
    raw: { path: "raw.txt", sha256: "e".repeat(64), bytes: 10 },
    transcript: { path: "home/.zcode/cli/rollout/model-io-sess_x.jsonl", sha256: "f".repeat(64) },
    budget: null,
    metering: { status: "metered", points: 1, note: null },
    validity: { status: "valid", reason: null, detail: null },
    result: { verdict: "pass", findings: [], summary: "ok", normalization: null },
    ...overrides,
  };
}

// ── 家族与形状闸 ──

test("①家族：确定序+孤儿目录跳过+幂等拒覆写+损坏族整枚举拒", () => {
  const d = scratch();
  try {
    mkdirSync(join(d, ".lazyzcode", "review"), { recursive: true });
    assert.equal(nextRunSeq(d, "fx", 1), 1);
    const r1 = reserveRun(d, "fx", 1);
    assert.equal(r1.runId, "fx.a1.r1");
    saveReviewRun(d, recordPayload(d, { seq: r1.seq }));
    // 孤儿运行目录（json 已失而目录在）→ 下一序号跳过不撞（SIGKILL 中途死=新 runId，拍板 8）
    mkdirSync(join(d, ".lazyzcode", "review", "fx.a1.r2", "candidate"), { recursive: true });
    const r3 = reserveRun(d, "fx", 1);
    assert.equal(r3.runId, "fx.a1.r3", "孤儿目录计数后取新号");
    // 幂等：同 seq 落档=拒绝覆写
    assert.throws(() => saveReviewRun(d, recordPayload(d, { seq: 1 })), /拒绝覆写/);
    // 损坏族：listReviewRuns fail-closed 整枚举拒
    const p = join(d, ".lazyzcode", "review", "fx.a1.r1.json");
    const obj = JSON.parse(readFileSync(p, "utf8"));
    obj.duty = { id: "tampered" };
    delete obj.checksum;
    writeFileSync(p, JSON.stringify(obj, null, 2));
    assert.throws(() => listReviewRuns(d), /校验和/, "任一档损坏=整族枚举拒");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("②形状闸 fail-closed：校验和/版本/形状三面+valid 耦合（sessionId/raw/transcript/result）", () => {
  const d = scratch();
  try {
    const rec = recordPayload(d, {});
    assertRunShape(rec, "test"); // 合法形状过
    // 破坏面逐个拒
    const cases = [
      ["runId 不自洽", { ...rec, runId: "fx.a1.r9" }],
      ["duty 不在表", { ...rec, duty: { id: "review.nope" } }],
      ["dutyTableVersion 非正整数", { ...rec, dutyTableVersion: 0 }],
      ["templateHash 非哈希", { ...rec, templateHash: "xyz" }],
      ["valid 无 result", { ...rec, result: null }],
      ["valid 无 sessionId", { ...rec, sessionId: null }],
      ["valid 无 raw", { ...rec, raw: null }],
      ["valid 无 transcript", { ...rec, transcript: null }],
      ["invalid 无名因", { ...rec, validity: { status: "invalid", reason: "mystery", detail: null } }],
      ["absent 无不算零注记", { ...rec, metering: { status: "absent", points: null, note: null }, validity: { status: "invalid", reason: "metering-absent", detail: null }, result: null, sessionId: null, raw: null, transcript: null }],
      ["pass 与 blocking 并存", { ...rec, result: { verdict: "pass", findings: [{ id: "F-1", title: "t", severity: "P1", blocking: true, location: "a:1", evidence: "e", summary: "s" }], summary: "x", normalization: null } }],
    ];
    for (const [label, bad] of cases) {
      assert.throws(() => assertRunShape(bad, "test"), ReviewError, `须拒：${label}`);
    }
    // INVALID_REASONS 全枚举可作 reason（具名失败分类闭环）
    for (const reason of INVALID_REASONS) {
      assertRunShape({ ...rec, validity: { status: "invalid", reason, detail: null }, result: null, sessionId: null, raw: null, transcript: null }, "test");
    }
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── 解析与归一化 ──

test("③解析面：恰一围栏过/多块拒/零块拒/形状越界拒/duty 回显不符拒；归一化矛盾体按 blocked", () => {
  const ok = parseReviewResult(`分析文字\n${FENCE(PASS)}\n尾注`, { dutyId: BASELINE_DUTY_ID });
  assert.equal(ok.ok, true);
  assert.equal(ok.result.verdict, "pass");
  assert.match(parseReviewResult("无围栏", { dutyId: BASELINE_DUTY_ID }).reason, /围栏/);
  assert.match(parseReviewResult(`${FENCE(PASS)}\n${FENCE(PASS)}`, { dutyId: BASELINE_DUTY_ID }).reason, /2 个/);
  assert.match(parseReviewResult(FENCE({ duty: BASELINE_DUTY_ID, verdict: "huge", findings: [] }), { dutyId: BASELINE_DUTY_ID }).reason, /verdict 不识别/);
  assert.match(parseReviewResult(FENCE({ duty: "other", verdict: "pass", findings: [], summary: "s" }), { dutyId: BASELINE_DUTY_ID }).reason, /duty 回显不符/);
  assert.match(parseReviewResult(FENCE({ duty: BASELINE_DUTY_ID, verdict: "pass", findings: [{ id: "F-1", title: "t", severity: "P9", blocking: false, location: "", evidence: "e", summary: "s" }], summary: "s" }), { dutyId: BASELINE_DUTY_ID }).reason, /severity 不识别/);
  // 归一化：pass ∧ blocking/P0/P1 ⇒ blocked + 注记
  const bad = { verdict: "pass", findings: [{ id: "F-1", title: "t", severity: "P0", blocking: false, location: "a:1", evidence: "e", summary: "s" }], summary: "x", normalization: null };
  const norm = normalizeVerdict(bad);
  assert.equal(norm.verdict, "blocked");
  assert.match(norm.normalization, /blocked/);
  assert.equal(normalizeVerdict(PASS).verdict, "pass");
});

// ── 运行族端到端（deps 注入） ──

test("④runReview 绿例：valid+pass+metered；候选竞态（注入运行中前进提交）=invalid；污染=invalid", async () => {
  const d = fixture();
  try {
    const res = await runReview(d, { deps: deps() });
    assert.equal(res.exitHint, 0);
    assert.equal(res.record.validity.status, "valid");
    assert.equal(res.record.result.verdict, "pass");
    assert.equal(res.record.metering.status, "metered");
    assert.equal(res.record.dutyTableVersion, 3, "dutyTableVersion 取现行策略记录/职责表版本（M3 N5 翻面 v2→v3）");
    // 候选竞态：spawn 期间 HEAD 前进 → candidate-moved（运行照常落档，不可改判）
    const d2 = fixture();
    const res2 = await runReview(d2, { deps: deps({ spawnHeadless: stubSpawn({ during: () => spawnSync("git", ["commit", "-qm", "move", "--allow-empty"], { cwd: d2 }) }) }) });
    assert.equal(res2.record.validity.reason, "candidate-moved");
    assert.equal(res2.exitHint, 1);
    // 污染：快照树被改 → contamination
    const d3 = fixture();
    const res3 = await runReview(d3, { deps: deps({ spawnHeadless: stubSpawn({ during: (cwd) => writeFileSync(join(cwd, "a.txt"), "tampered\n") }) }) });
    assert.equal(res3.record.validity.reason, "contamination");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑤解析失败/超时/转录缺席/轨迹越界：逐因 invalid 且 raw 照常封存", async () => {
  const d1 = fixture();
  const r1 = await runReview(d1, { deps: deps({ spawnHeadless: stubSpawn({ response: "没有围栏" }) }) });
  assert.equal(r1.record.validity.reason, "parse-fail");
  assert.equal(r1.record.result, null);
  assert.ok(r1.record.raw.bytes > 0);
  rmSync(d1, { recursive: true, force: true });

  const d2 = fixture();
  const r2 = await runReview(d2, { deps: deps({ spawnHeadless: stubSpawn({ timedOut: true, response: null }) }) });
  assert.equal(r2.record.validity.reason, "timeout");
  assert.equal(r2.record.exit.signal, "SIGKILL");
  rmSync(d2, { recursive: true, force: true });

  const d3 = fixture();
  const r3 = await runReview(d3, { deps: deps({ spawnHeadless: stubSpawn({ withTranscript: false }) }) });
  assert.equal(r3.record.validity.reason, "isolation-breach");
  assert.match(r3.record.validity.detail, /隔离未证/);
  rmSync(d3, { recursive: true, force: true });

  const d4 = fixture();
  const r4 = await runReview(d4, { deps: deps({ spawnHeadless: stubSpawn({ readOutside: "/etc/passwd" }) }) });
  assert.equal(r4.record.validity.reason, "isolation-breach");
  assert.match(r4.record.validity.detail, /越界/);
  rmSync(d4, { recursive: true, force: true });
});

test("⑥泄漏断言：在先运行 runId/结论摘要哈希/raw 哈希串命中=invalid（leak 不 spawn）", async () => {
  const d = fixture();
  try {
    const first = await runReview(d, { deps: deps() });
    assert.equal(first.exitHint, 0);
    const priors = listReviewRuns(d, { slug: "fx", attempt: 1 });
    assert.equal(priors.length, 1);
    const needles = [priors[0].runId, priors[0].raw.sha256];
    for (const needle of needles) {
      const hit = assertNoLeak(`内容 ${needle} 引用`, priors);
      assert.equal(hit.ok, false, `命中 ${needle.slice(0, 8)}…`);
      const clean = assertNoLeak("与在先运行无关的事实文本", priors);
      assert.equal(clean.ok, true);
    }
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑦计量三分类与前置：metered 过/absent invalid/unpriced invalid；脏树/无 auth/撤回=前置拒不落档", async () => {
  const d1 = fixture();
  const r1 = await runReview(d1, { deps: deps({ querySessionPoints: async () => ({ absent: false, unpriced: ["weird-x"], points: 0 }) }) });
  assert.equal(r1.record.validity.reason, "unpriced-model");
  assert.equal(r1.record.metering.status, "unpriced");
  rmSync(d1, { recursive: true, force: true });

  const d2 = fixture();
  const r2 = await runReview(d2, { deps: deps({ querySessionPoints: async () => ({ absent: true, unpriced: [], points: 0 }) }) });
  assert.equal(r2.record.validity.reason, "metering-absent");
  assert.match(r2.record.metering.note, /不算零/);
  rmSync(d2, { recursive: true, force: true });

  // 脏树=前置拒（评审候选须提交态）
  const d3 = fixture({ dirty: true });
  await assert.rejects(() => runReview(d3, { deps: deps() }), (e) => e instanceof ReviewPreflightError && e.reason === "candidate-dirty");
  assert.equal(listReviewRuns(d3).length, 0);
  rmSync(d3, { recursive: true, force: true });

  // 真 preflight：无 auth=拒
  const d4 = fixture();
  await assert.rejects(() => runReview(d4, { deps: { detectAuth: () => ({ ok: false }) } }), (e) => e.reason === "no-auth");
  rmSync(d4, { recursive: true, force: true });

  // 真 preflight：批准后过、撤回后拒（真 effectiveAuthorization 面，报文带撤回短码）
  // N4 #8：认证腿=隔离 HOME 会话创建门（provider env）——OAuth-only 形态拒（宿主 OAuth
  // 不进入隔离面，白烧前拒绝先行）。
  const d5 = fixture();
  recordAuthorization(d5, { kind: "approval", slug: "fx", contractHash: "c".repeat(64), sessionId: "t", at: "2026-09-27T00:00:00.000Z" });
  await assert.rejects(() => runReview(d5, { deps: { detectAuth: () => ({ oauth: true, envAuth: false, ok: true }) } }), (e) => {
    return e instanceof ReviewPreflightError && e.reason === "no-auth" && e.message.includes("OAuth");
  });
  const okRun = await runReview(d5, { deps: { detectAuth: () => ({ ok: true, envAuth: true }), spawnHeadless: stubSpawn({}), querySessionPoints: async () => ({ ...METERED }) } });
  assert.equal(okRun.exitHint, 0);
  recordAuthorization(d5, { kind: "withdrawal", slug: "fx", contractHash: "c".repeat(64), sessionId: "t", at: "2026-09-27T01:00:00.000Z" });
  await assert.rejects(() => runReview(d5, { deps: { detectAuth: () => ({ ok: true, envAuth: true }) } }), (e) => {
    return e instanceof ReviewPreflightError && e.reason === "unauthorized" && e.message.includes("已撤回") && e.message.includes("cccccccc");
  });
  rmSync(d5, { recursive: true, force: true });

  // 计量能力缺席=拒（sqliteProbe 注入；批准在场——前置四查按序走到第④查）
  const d6 = fixture();
  recordAuthorization(d6, { kind: "approval", slug: "fx", contractHash: "c".repeat(64), sessionId: "t", at: "2026-09-27T00:00:00.000Z" });
  await assert.rejects(() => runReview(d6, { deps: { detectAuth: () => ({ ok: true, envAuth: true }), sqliteProbe: () => ({ ok: false }) } }), (e) => e.reason === "metering-capability");
  rmSync(d6, { recursive: true, force: true });
});

// ── 统一门评审子句成对（拍板 6） ──

function gateFixture({ attempt = 1 } = {}) {
  const d = fixture({ attempt });
  const goal = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8"));
  const created = ensurePolicyRecord(d, goal);
  assert.ok(created.applicable, "策略记录落档");
  return d;
}

test("⑧gate 成对：无运行=阻塞；metered+pass+候选现行=满足；blocked=阻塞；候选漂移=阻塞；a1 运行不冒充 a2 义务", async () => {
  // (a) v2 无运行：阻塞理由=评审无在案运行（N5 翻面后的新语义，重钉≠放宽）
  const d1 = gateFixture();
  try {
    const g1 = evaluateGate(d1);
    assert.equal(g1.applicable, true);
    const rev1 = g1.obligations.find((o) => o.id === BASELINE_DUTY_ID);
    assert.equal(rev1.state, "unsatisfied");
    assert.match(rev1.reasons.join("\n"), /评审无在案运行/);
  } finally {
    rmSync(d1, { recursive: true, force: true });
  }

  // (b) metered+pass+候选现行 → 满足（deps 注入的真实运行产物，非植入记录）
  const d2 = gateFixture();
  try {
    const res = await runReview(d2, { deps: deps() });
    assert.equal(res.exitHint, 0);
    const g2 = evaluateGate(d2);
    const rev2 = g2.obligations.find((o) => o.id === BASELINE_DUTY_ID);
    assert.equal(rev2.state, "satisfied", rev2.reasons.join("\n"));
    assert.equal(rev2.basis.runId, res.record.runId);
    assert.equal(rev2.basis.attempt, 1);
    assert.match(rev2.reasons.join("\n"), /七合取/);
    assert.match(rev2.reasons.join("\n"), /findings 子句/); // M3 N5：发现生命周期由独立子句执法
    // (c) 追加 blocked 运行（最新档）→ 阻塞点名阻塞发现
    const blocked = { ...PASS, verdict: "blocked", findings: [{ id: "F-1", title: "t", severity: "P1", blocking: true, location: "a.txt:1", evidence: "e", summary: "s" }] };
    const res3 = await runReview(d2, { deps: deps({ spawnHeadless: stubSpawn({ response: FENCE(blocked) }) }) });
    assert.equal(res3.record.validity.status, "valid");
    const g3 = evaluateGate(d2);
    const rev3 = g3.obligations.find((o) => o.id === BASELINE_DUTY_ID);
    assert.equal(rev3.state, "unsatisfied");
    assert.match(rev3.reasons.join("\n"), /评审判 blocked/);
    assert.match(rev3.reasons.join("\n"), /F-1/);
    // (d) 候选漂移：pass 运行后候选前进 → 阻塞点名 head 短码
    spawnSync("git", ["commit", "-qm", "advance", "--allow-empty"], { cwd: d2 });
    const res4 = await runReview(d2, { deps: deps() });
    assert.equal(res4.exitHint, 0);
    spawnSync("git", ["commit", "-qm", "advance-again", "--allow-empty"], { cwd: d2 });
    const g4 = evaluateGate(d2);
    const rev4 = g4.obligations.find((o) => o.id === BASELINE_DUTY_ID);
    assert.equal(rev4.state, "unsatisfied");
    assert.match(rev4.reasons.join("\n"), /候选漂移/);
  } finally {
    rmSync(d2, { recursive: true, force: true });
  }

  // (e) a1 代运行不冒充 a2 义务：goal attempt=2、策略记录 a2、在案运行 a1 → 同代次缺席
  const d3 = gateFixture({ attempt: 2 });
  try {
    mkdirSync(join(d3, ".lazyzcode", "review"), { recursive: true });
    saveReviewRun(d3, recordPayload(d3, { attempt: 1, seq: 1 }));
    const g5 = evaluateGate(d3);
    const rev5 = g5.obligations.find((o) => o.id === BASELINE_DUTY_ID);
    assert.equal(rev5.state, "unsatisfied");
    assert.match(rev5.reasons.join("\n"), /评审无在案运行/, "a1 代记录不满足 a2 义务（代次锚）");
    assert.equal(rev5.basis.runsInGeneration, 0);
  } finally {
    rmSync(d3, { recursive: true, force: true });
  }
});

test("⑨输入包/隔离原语：facts-only 汇总+快照确定性+轨迹断言归一路径", async () => {
  const d = fixture();
  try {
    const res = reserveRun(d, "fx", 1);
    const pkg = buildInputPackage(d, JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8")), res.runDir);
    const facts = JSON.parse(readFileSync(pkg.inputPath, "utf8"));
    assert.equal(facts.goal.slug, "fx");
    assert.ok(facts.contract.text.includes("endpoint: A"));
    assert.ok(facts.steps.length === 1);
    assert.equal(facts.candidate.headSha.length >= 40, true);
    assert.equal(facts.policy, null, "策略记录未落档时如实 null");
    // 轨迹断言：/var→/private/var realpath 归一（macOS tmpdir 陷阱）；不存在路径=幻影不判 breach
    const inside = assertReadsContained(JSON.stringify({ file_path: join(res.runDir, "input.json") }) + "\n", [res.runDir]);
    assert.equal(inside.ok, true, "界内路径过（realpath 归一后）");
    const outsideReal = join(d, "..", `outside-${basename(d)}`);
    writeFileSync(outsideReal, "x\n");
    try {
      const outside = assertReadsContained(JSON.stringify({ cwd: outsideReal }) + "\n", [res.runDir]);
      assert.equal(outside.ok, false, "界外存在路径=breach");
      const phantom = assertReadsContained(JSON.stringify({ cwd: "/nonexistent-phantom-path-xyz" }) + "\n", [res.runDir]);
      assert.equal(phantom.ok, true, "不存在路径=幻影尝试不判 breach（无数据流动）");
      assert.equal(phantom.phantoms.length, 1, "幻影如实计数透出");
    } finally {
      rmSync(outsideReal, { force: true });
    }
    rmSync(res.runDir, { recursive: true, force: true });
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑩CLI 面：list 空族 0/损坏族 fail-closed 非 0/未知子命令 2（真 CLI 子进程）", () => {
  const d = fixture();
  try {
    const env = { ...process.env, LZY_ZCODE_ENGINE: "/nonexistent-lzy-suppressed", LZY_ABLATE_HUMAN_GATE: "1" };
    const lzy = (args) => {
      const r = spawnSync(process.execPath, [CLI, ...args], { cwd: d, encoding: "utf8", timeout: 60_000, env });
      return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
    };
    assert.equal(lzy(["review", "list"]).code, 0);
    assert.equal(lzy(["review", "badsub"]).code, 2);
    // 落一档合法记录再破坏 → list/show fail-closed 非 0
    const res = reserveRun(d, "fx", 1);
    saveReviewRun(d, recordPayload(d, { seq: res.seq }));
    const p = join(d, ".lazyzcode", "review", `fx.a1.r${res.seq}.json`);
    const obj = JSON.parse(readFileSync(p, "utf8"));
    obj.snapshot = null;
    delete obj.checksum;
    writeFileSync(p, JSON.stringify(obj, null, 2));
    assert.equal(lzy(["review", "list"]).code, 1);
    assert.equal(lzy(["review", "show", `fx.a1.r${res.seq}`]).code, 1);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
