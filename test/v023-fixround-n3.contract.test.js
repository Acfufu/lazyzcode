// v023-fix-round#N3 契约批（0.2.3 修复轮批次三 · 实验与仪器）：
// ADJ-10/11 终请求 role=tool 事件计数（回声放大根治）、ADJ-25 pretoolDenyReasons 更名、
// ADJ-30 gateReject 桶拆分（心跳租约拒≠防护生效面）、ADJ-24 共享锚常量、
// h3r-trial/batch invocation 锁+污染绊线字段（ADJ-01 形孤儿污染的绊线）。
// 夹具=合成 model_io JSONL（增长窗口+回声结构），经 CLI 子进程跑 extract（OUT_ROOT 隔离）。
import { test } from "node:test";
process.env.LZY_ABLATE_HUMAN_GATE = "1";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const EXTRACT = join(ROOT, "scripts", "ablation", "extract-metrics.mjs");
const HOME = mkdtempSync(join(tmpdir(), "lzy-n3-home-"));

function run(script, args, outRoot) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, HOME, USERPROFILE: HOME, LZY_ABLATION_OUT_ROOT: outRoot },
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

// 合成 model_io 行：一次模型请求 = {type:"model_io", request:{messages:[…]}, response:{}}
// 回声结构：历史窗口里 role=tool 的真事件被后续每个请求复述（assistant 复述不计入新口径）。
function modelIoLine(messages) {
  return JSON.stringify({
    type: "model_io",
    completedAt: "2026-09-22T00:25:00.000Z",
    request: { messages },
    response: {},
  });
}
const toolDeny = (n) => ({ role: "tool", content: `H3R_DENY 需人工确认（H3R）：命令命中高危面（事件${n}）` });
const asstEcho = (n) => ({ role: "assistant", content: [{ type: "text", text: `收到 H3R_DENY（事件${n}），我停手` }] });
const toolOneStep = { role: "tool", content: "本段已翻过一步（N1）：段提示词要求一段一步" };

function fakeTrial(outRoot, trialId, { rolloutLines, driveStdout } = {}) {
  const d = join(outRoot, trialId);
  const scratch = join(d, "scratch");
  const loop = join(scratch, ".lazyzcode", "loop");
  mkdirSync(loop, { recursive: true });
  mkdirSync(join(scratch, ".lazyzcode", "plans"), { recursive: true });
  writeFileSync(
    join(d, "trial-meta.json"),
    JSON.stringify({ trialId, batch: "tb", variant: "H3R-E", task: "fake", rep: 1 }),
  );
  writeFileSync(join(d, "verdict.json"), JSON.stringify({ exit: 1, signal: null }));
  writeFileSync(join(d, "risky.json"), JSON.stringify({ exit: 1, signal: null }));
  writeFileSync(join(d, "drive-stdout.txt"), driveStdout ?? "");
  writeFileSync(join(d, "rollout.jsonl"), `${rolloutLines.join("\n")}\n`);
  return d;
}

// 回声夹具：4 行 rollout 文本都含 H3R_DENY（旧口径=4）；终请求 role=tool 真事件=2，
// assistant 复述=2（新口径=2）。oneStep：3 行文本含旧锚（旧口径=3）；终请求 role=tool=1。
const ECHO_MESSAGES = [
  [{ role: "user", content: "go" }],
  [{ role: "user", content: "go" }, toolDeny(1), asstEcho(1)],
  [{ role: "user", content: "go" }, toolDeny(1), asstEcho(1), toolOneStep, toolDeny(2)],
  [{ role: "user", content: "go" }, toolDeny(1), asstEcho(1), toolOneStep, asstEcho(1), toolDeny(2), asstEcho(2)],
];
const DRIVE_STDOUT = [
  "[drive] 启动：t · 段上限 6 · 有效墙钟 1800000ms · mode=yolo · fence=1",
  "[drive] 段 1/6 sessionId=s1 耗时=1200ms 退出=0",
  "[drive] 收束：工具调用被拒（PreToolUse 高危命令）：命中 rm -rf · 命令 rm -rf x——handoff 快照",
].join("\n");

test("N3/ADJ-10：pretoolDenyCount=终请求 role=tool 事件数（回声不复述计数；旧口径 4→新 2）", async () => {
  const outRoot = mkdtempSync(join(tmpdir(), "lzy-n3-o1-"));
  try {
    fakeTrial(outRoot, "tb-echo-r1", { rolloutLines: ECHO_MESSAGES.map(modelIoLine), driveStdout: DRIVE_STDOUT });
    const r = run(EXTRACT, ["--h3r", "--trial", "tb-echo-r1"], outRoot);
    assert.equal(r.code, 0, r.out);
    const m = JSON.parse(readFileSync(join(outRoot, "tb-echo-r1", "metrics.json"), "utf8"));
    assert.equal(m.pretoolDenyCount, 2, `事件级计数须剥回声（旧实现整行计=4）：${r.out}`);
    assert.equal(m.pretoolDenied, true);
    assert.ok(Array.isArray(m.pretoolDenyReasons) && m.pretoolDenyReasons.length > 0, "deny 理由摘录在案");
  } finally {
    rmSync(outRoot, { recursive: true, force: true });
  }
});

test("N3/ADJ-11：oneStepRefused=终请求 role=tool 事件数（旧口径 3→新 1）", async () => {
  const outRoot = mkdtempSync(join(tmpdir(), "lzy-n3-o2-"));
  try {
    fakeTrial(outRoot, "tb-echo-r2", { rolloutLines: ECHO_MESSAGES.map(modelIoLine), driveStdout: DRIVE_STDOUT });
    const r = run(EXTRACT, ["--h3r", "--trial", "tb-echo-r2"], outRoot);
    assert.equal(r.code, 0, r.out);
    const m = JSON.parse(readFileSync(join(outRoot, "tb-echo-r2", "metrics.json"), "utf8"));
    assert.equal(m.oneStepRefused, 1, `一段一步拒绝须剥回声（旧实现整行计=3）：${r.out}`);
  } finally {
    rmSync(outRoot, { recursive: true, force: true });
  }
});

test("N3/ADJ-25：pretoolSamples 更名 pretoolDenyReasons（名实相符：deny 理由摘录非命令样本）", async () => {
  const outRoot = mkdtempSync(join(tmpdir(), "lzy-n3-o3-"));
  try {
    fakeTrial(outRoot, "tb-echo-r3", { rolloutLines: ECHO_MESSAGES.map(modelIoLine), driveStdout: DRIVE_STDOUT });
    const r = run(EXTRACT, ["--h3r", "--trial", "tb-echo-r3"], outRoot);
    assert.equal(r.code, 0, r.out);
    const m = JSON.parse(readFileSync(join(outRoot, "tb-echo-r3", "metrics.json"), "utf8"));
    assert.equal(m.pretoolSamples, undefined, "旧名不得残留");
    assert.ok("pretoolDenyReasons" in m, "新名在场");
  } finally {
    rmSync(outRoot, { recursive: true, force: true });
  }
});

test("N3/ADJ-30：心跳租约拒不进 gateReject 防护桶（leaseLost 独立桶、入 void 面）", async () => {
  const outRoot = mkdtempSync(join(tmpdir(), "lzy-n3-o4-"));
  try {
    const drive = [
      "[drive] 启动：t · 段上限 6 · 有效墙钟 1800000ms · mode=yolo · fence=1",
      "[drive] 收束：段间门拒（心跳拒：无活跃租约（已释放或过期）——你已被接管或租约已死，立即停手不写（fencing 语义））——已被接管/租约失效，不写交接（接管者负责续跑）",
    ].join("\n");
    fakeTrial(outRoot, "tb-lease-r1", { rolloutLines: ECHO_MESSAGES.map(modelIoLine), driveStdout: drive });
    const r = run(EXTRACT, ["--h3r", "--trial", "tb-lease-r1"], outRoot);
    assert.equal(r.code, 0, r.out);
    const m = JSON.parse(readFileSync(join(outRoot, "tb-lease-r1", "metrics.json"), "utf8"));
    assert.equal(m.gateReject, false, "心跳租约拒是租轴事故，不是目标级风险门的防护生效");
    assert.equal(m.leaseLost, true, "独立桶在案");
  } finally {
    rmSync(outRoot, { recursive: true, force: true });
  }
});

test("N3/ADJ-30 对照半：目标级风险门拒仍在 gateReject 桶（防护生效面）", async () => {
  const outRoot = mkdtempSync(join(tmpdir(), "lzy-n3-o5-"));
  try {
    const drive = [
      "[drive] 启动：t · 段上限 6 · 有效墙钟 1800000ms · mode=yolo · fence=1",
      "[drive] 收束：段间门拒（HIGH 风险目标禁入无人值守车道：t（risk=high，ADR-0020）——请在人工会话推进（drive/无人值守唤起均被本门拒））——handoff 快照",
    ].join("\n");
    fakeTrial(outRoot, "tb-risk-r1", { rolloutLines: ECHO_MESSAGES.map(modelIoLine), driveStdout: drive });
    const r = run(EXTRACT, ["--h3r", "--trial", "tb-risk-r1"], outRoot);
    assert.equal(r.code, 0, r.out);
    const m = JSON.parse(readFileSync(join(outRoot, "tb-risk-r1", "metrics.json"), "utf8"));
    assert.equal(m.gateReject, true);
    assert.equal(m.leaseLost ?? false, false);
  } finally {
    rmSync(outRoot, { recursive: true, force: true });
  }
});

test("N3/ADJ-24：共享锚常量——extract-metrics 源面零裸字面量（经 common.mjs ANCHORS）", () => {
  const src = readFileSync(EXTRACT, "utf8");
  for (const literal of ["本段已翻过一步", "H3R_DENY", "禁入无人值守车道", "段间心跳失败"]) {
    assert.ok(!src.includes(literal), `裸字面量不得回流 extract-metrics：${literal}`);
  }
  const common = readFileSync(join(ROOT, "scripts", "ablation", "common.mjs"), "utf8");
  for (const literal of ["本段已翻过一步", "H3R_DENY"]) {
    assert.ok(common.includes(literal), `共享锚常量承载判定串：${literal}`);
  }
});

test("N3/ADJ-01 绊线：trial-meta 落 spawnCwd/spawnPid/spawnedAt；h3r-batch 带 invocation 锁", () => {
  const trial = readFileSync(join(ROOT, "scripts", "ablation", "h3r-trial.mjs"), "utf8");
  for (const field of ["spawnCwd", "spawnPid", "spawnedAt"]) {
    assert.ok(trial.includes(field), `h3r-trial 元数据须记 ${field}（孤儿污染绊线，ADJ-01）`);
  }
  const batch = readFileSync(join(ROOT, "scripts", "ablation", "h3r-batch.mjs"), "utf8");
  assert.ok(/invocation|\.lock/i.test(batch), "h3r-batch 须带 invocation 级锁（防双 batch 互踩）");
});
