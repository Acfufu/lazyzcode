// ablation-pipeline 契约测试（ADR-0015，goal true-ablation-full-flow#N4）：管线机械面
// ——指标抽取（假完成判定/续跑计数/finish_reject/attempt note/限流计数/零缺字段）与
// aggregate 完备性报告（工件齐全+ledger 行数核对+签名表）。经 CLI spawn + 隔离
// LZY_ABLATION_OUT_ROOT（绝不触碰真 artifacts/ablation/）；引擎面（spawn-engine/
// install-variant/run-trial）归 N6 pilot 实弹，不在本文件伪造。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const EXTRACT = join(ROOT, "scripts", "ablation", "extract-metrics.mjs");
const AGGREGATE = join(ROOT, "scripts", "ablation", "aggregate.mjs");
const ISOLATED_HOME = mkdtempSync(join(tmpdir(), "lzy-ablpipe-home-"));

function run(script, args, outRoot) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      HOME: ISOLATED_HOME,
      USERPROFILE: ISOLATED_HOME,
      LZY_ABLATION_OUT_ROOT: outRoot,
    },
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const ARTIFACTS = [
  "engine-stdout.txt",
  "engine-summary.json",
  "lazyzcode-tree",
  "git-log.txt",
  "rollout.jsonl",
  "metrics.json",
];

// 造一个完备 trial 目录（工件五类 + scratch 循环态）；verdictRow/goalStatus 可调。
// verdictRow={exit,signal}（0.2.1 修复轮 ADJ-84 起 run-trial 双记 signal）。
function fakeTrial(outRoot, trialId, { verdictExit = 0, verdictSignal = null, goalStatus = "executing", rateHits = "", attestFiles = 0, usage = { modelRequestCount: 9, inputTokens: 100, outputTokens: 20 } } = {}) {
  const d = join(outRoot, trialId);
  const scratch = join(d, "scratch");
  const loop = join(scratch, ".lazyzcode", "loop");
  mkdirSync(join(loop, "sessions"), { recursive: true });
  mkdirSync(join(scratch, ".lazyzcode", "plans"), { recursive: true });
  mkdirSync(join(d, "lazyzcode-tree"), { recursive: true });
  writeFileSync(join(d, "engine-stdout.txt"), `some log\n${rateHits}\n`);
  writeFileSync(
    join(d, "engine-summary.json"),
    JSON.stringify({
      sessionId: "sess_fake",
      // turnCount=用户回合数（headless 单发恒 1，无测量力）；turns 指标从 ADJ-85 起读
      // usage.modelRequestCount——两值刻意不同，防指标再漂回 projection 面而不被察觉。
      projection: { turnCount: 1 },
      usage,
    }),
  );
  writeFileSync(join(d, "git-log.txt"), "0000000 seed\n");
  writeFileSync(join(d, "rollout.jsonl"), '{"absent":false}\n');
  writeFileSync(
    join(loop, "goal.json"),
    JSON.stringify({ slug: "t", title: "t", status: goalStatus, steps: [] }),
  );
  writeFileSync(join(loop, "sessions", "s1.json"), JSON.stringify({ continues: 2 }));
  writeFileSync(join(loop, "sessions", "s2.json"), JSON.stringify({ continues: 1 }));
  writeFileSync(join(loop, "metrics.json"), JSON.stringify({ finish_attempts: 3, finish_reject_stale: 2 }));
  writeFileSync(join(scratch, ".lazyzcode", "plans", "t.md"), "# p\n- [N1] x\n- [!] attempt 2: dropped A because B; switching to C\n");
  if (attestFiles > 0) {
    mkdirSync(join(scratch, ".lazyzcode", "attestations"), { recursive: true });
    for (let i = 0; i < attestFiles; i++) writeFileSync(join(scratch, ".lazyzcode", "attestations", `a${i}.json`), "{}");
  }
  writeFileSync(join(d, "verdict.json"), JSON.stringify({ exit: verdictExit, signal: verdictSignal }));
  writeFileSync(
    join(d, "trial-meta.json"),
    JSON.stringify({ trialId, batch: "tb", variant: trialId.split("-")[1], task: "fake-task", rep: 1 }),
  );
  return d;
}

test("extract-metrics：假完成/续跑/finish_reject/attempt/限流计数齐面，零缺字段", () => {
  const outRoot = mkdtempSync(join(tmpdir(), "lzy-ablpipe-o1-"));
  try {
    fakeTrial(outRoot, "tb-D-fake-task-r1", { verdictExit: 1, goalStatus: "done", rateHits: "rate_limited x2 then 1302" });
    const r = run(EXTRACT, ["--trial", "tb-D-fake-task-r1"], outRoot);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /缺失字段 无/);
    const m = JSON.parse(readFileSync(join(outRoot, "tb-D-fake-task-r1", "metrics.json"), "utf8"));
    assert.equal(m.verdict, "fail");
    assert.equal(m.finishAchieved, true);
    assert.equal(m.fakeComplete, true); // finish 达成且 verdict 挂=预注册核心信号
    assert.equal(m.sessionId, "sess_fake");
    assert.equal(m.turns, 9, "turns=usage.modelRequestCount（ADJ-85；projection.turnCount 是用户回合数）");
    assert.equal(m.usage.inputTokens, 100);
    assert.equal(m.stopContinues, 2); // 跨会话取 max
    assert.equal(m.finishReject.finish_reject_stale, 2);
    assert.equal(m.attemptNotes, 1);
    assert.equal(m.rateLimitedEvents, 2); // rate_limited×1 + 1302×1
    assert.equal(m.variant, "D");
  } finally {
    rmSync(outRoot, { recursive: true, force: true });
  }
});

test("extract-metrics：verdict 过+未 finish=非假完成（负向半）", () => {
  const outRoot = mkdtempSync(join(tmpdir(), "lzy-ablpipe-o2-"));
  try {
    fakeTrial(outRoot, "tb-A-fake-task-r1", { verdictExit: 0, goalStatus: "executing" });
    const r = run(EXTRACT, ["--trial", "tb-A-fake-task-r1"], outRoot);
    assert.equal(r.code, 0, r.out);
    const m = JSON.parse(readFileSync(join(outRoot, "tb-A-fake-task-r1", "metrics.json"), "utf8"));
    assert.equal(m.verdict, "pass");
    assert.equal(m.finishAchieved, false);
    assert.equal(m.fakeComplete, false);
  } finally {
    rmSync(outRoot, { recursive: true, force: true });
  }
});

test("extract-metrics：verdict 三态——被信号杀死=void 且不进假完成（ADJ-84）", () => {
  const outRoot = mkdtempSync(join(tmpdir(), "lzy-ablpipe-o4-"));
  try {
    // 对照两半：同为「verdict 挂 + finish 达成」，唯一差别是 signal 有无。
    fakeTrial(outRoot, "tb-D-sig-fail-r1", { verdictExit: 1, goalStatus: "done" });
    fakeTrial(outRoot, "tb-D-sig-void-r1", { verdictExit: null, verdictSignal: "SIGTERM", goalStatus: "done" });
    for (const id of ["tb-D-sig-fail-r1", "tb-D-sig-void-r1"]) assert.equal(run(EXTRACT, ["--trial", id], outRoot).code, 0);
    const f = JSON.parse(readFileSync(join(outRoot, "tb-D-sig-fail-r1", "metrics.json"), "utf8"));
    const v = JSON.parse(readFileSync(join(outRoot, "tb-D-sig-void-r1", "metrics.json"), "utf8"));
    assert.equal(f.verdict, "fail");
    assert.equal(f.verdictSignal, null);
    assert.equal(f.fakeComplete, true);
    assert.equal(v.verdict, "void");
    assert.equal(v.verdictSignal, "SIGTERM");
    assert.equal(v.fakeComplete, false, "void=基础设施故障，不伪造完成信号（树脏项无 git 仓时读 null）");
  } finally {
    rmSync(outRoot, { recursive: true, force: true });
  }
});

test("extract-metrics：attestationPresent 只认 finish 达成（ADJ-51 弱信号收口）", () => {
  const outRoot = mkdtempSync(join(tmpdir(), "lzy-ablpipe-o5-"));
  try {
    // 失败窗假阳面：目录有 .json 但 goal 未 done → 必须 false；done + 文件在场 → true。
    fakeTrial(outRoot, "tb-A-att-weak-r1", { goalStatus: "executing", attestFiles: 2 });
    fakeTrial(outRoot, "tb-A-att-strong-r1", { goalStatus: "done", attestFiles: 1 });
    for (const id of ["tb-A-att-weak-r1", "tb-A-att-strong-r1"]) assert.equal(run(EXTRACT, ["--trial", id], outRoot).code, 0);
    assert.equal(JSON.parse(readFileSync(join(outRoot, "tb-A-att-weak-r1", "metrics.json"), "utf8")).attestationPresent, false);
    assert.equal(JSON.parse(readFileSync(join(outRoot, "tb-A-att-strong-r1", "metrics.json"), "utf8")).attestationPresent, true);
  } finally {
    rmSync(outRoot, { recursive: true, force: true });
  }
});

test("aggregate：签名表按格计数——同格分歧标 ⚠ 不再 last-wins 覆盖（ADJ-86）", () => {
  const outRoot = mkdtempSync(join(tmpdir(), "lzy-ablpipe-o6-"));
  try {
    // 真实先例形态：C×delta r1 fail / r2 pass / r3 fail——旧表只剩最后一行（fail），分歧不可见。
    const rows = [
      { trialId: "tb-C-div-task-r1", variant: "C", task: "div-task", rep: 1, status: "done", verdict: "fail", fakeComplete: false, dirty429: false },
      { trialId: "tb-C-div-task-r2", variant: "C", task: "div-task", rep: 2, status: "done", verdict: "pass", fakeComplete: false, dirty429: false },
      { trialId: "tb-C-div-task-r3", variant: "C", task: "div-task", rep: 3, status: "done", verdict: "fail", fakeComplete: false, dirty429: true },
      { trialId: "tb-B-div-task-r1", variant: "B", task: "div-task", rep: 1, status: "done", verdict: "void", fakeComplete: false, dirty429: false },
    ];
    mkdirSync(join(outRoot, "tb"), { recursive: true });
    writeFileSync(join(outRoot, "tb", "ledger.jsonl"), `${rows.map((o) => JSON.stringify(o)).join("\n")}\n`);
    const r = run(AGGREGATE, ["--batch", "tb"], outRoot);
    assert.equal(r.code, 0, r.out);
    // C 行：3 个 rep 全判过（2 fail + 1 pass），主判 ✗ + 分歧 ⚠ + 脏 1 rep
    assert.match(r.out, /C\s+3\/3 ✗⚠d1/);
    // B 行：唯一 rep 是 void → ?（不计入 pass/fail）
    assert.match(r.out, /B\s+\?/);
  } finally {
    rmSync(outRoot, { recursive: true, force: true });
  }
});

test("aggregate：工件+metrics 完备计数、ledger 行数核对、缺件点名、签名表成形", () => {
  const outRoot = mkdtempSync(join(tmpdir(), "lzy-ablpipe-o3-"));
  try {
    fakeTrial(outRoot, "tb-A-fake-task-r1", { verdictExit: 0, goalStatus: "done" });
    fakeTrial(outRoot, "tb-D-fake-task-r1", { verdictExit: 1, goalStatus: "done" });
    // 缺件 trial：先补齐 metrics（真实流程 run-trial 自动落 extract），再删 rollout.jsonl 点名
    fakeTrial(outRoot, "tb-B-fake-task-r1", { verdictExit: 0 });
    for (const id of ["tb-A-fake-task-r1", "tb-D-fake-task-r1", "tb-B-fake-task-r1"]) {
      assert.equal(run(EXTRACT, ["--trial", id], outRoot).code, 0);
    }
    rmSync(join(outRoot, "tb-B-fake-task-r1", "rollout.jsonl"));
    mkdirSync(join(outRoot, "tb"), { recursive: true });
    writeFileSync(
      join(outRoot, "tb", "ledger.jsonl"),
      [
        JSON.stringify({ trialId: "tb-A-fake-task-r1", variant: "A", task: "fake-task", status: "done", verdict: "pass", fakeComplete: false, dirty429: false }),
        JSON.stringify({ trialId: "tb-D-fake-task-r1", variant: "D", task: "fake-task", status: "done", verdict: "fail", fakeComplete: true, dirty429: true }),
        JSON.stringify({ trialId: "tb-B-fake-task-r1", variant: "B", task: "fake-task", status: "done", verdict: "pass", fakeComplete: false, dirty429: false }),
      ].join("\n") + "\n",
    );
    const r = run(AGGREGATE, ["--batch", "tb"], outRoot);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /trials=3 工件\+metrics 完备=2\/3 ledger 行=3（done=3）/);
    assert.match(r.out, /tb-B-fake-task-r1：缺工件 \[rollout\.jsonl\]/);
    assert.match(r.out, /n\/总 计数/); // 表头自述计数口径（ADJ-86）
    assert.match(r.out, /A\s+✓/); // A 过（单 rep 不缀计数）
    assert.match(r.out, /D\s+◉/); // D 假完成（预注册核心信号）
    assert.match(r.out, /D\s+◉d1/); // 脏 429 分层标记带命中 rep 数
  } finally {
    rmSync(outRoot, { recursive: true, force: true });
  }
});
