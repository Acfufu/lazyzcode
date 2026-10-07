// 读面契约（M2 N6，决策 #47 必落／a1.r10 F-3）：drive 收束分族进 status 读面——
// metrics.json 带 cause:<族> 计数（handoffGoal 登记累加，跨 reset 永续）时，
// status --json checks 含 handoff-causes 行（ok＋分族计数 detail；无登记=skip 不误警）；
// 观察面契约不破（schemaVersion=1、顶层四键、checks 三键——status-doctor-json 契约同域）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli", "lzy.js");

function fixtureMetrics(metrics) {
  const d = mkdtempSync(join(tmpdir(), "lzy-cause-readface-"));
  mkdirSync(join(d, ".lazyzcode", "loop"), { recursive: true });
  writeFileSync(join(d, ".lazyzcode", "loop", "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  return d;
}

function statusJson(cwd) {
  const p = spawnSync(process.execPath, [CLI, "status", "--json"], { cwd, encoding: "utf8", shell: false, timeout: 120_000 });
  return JSON.parse(p.stdout);
}

test("handoff-causes：cause:* 计数在场时 status --json 出 ok 行分族计数", () => {
  const d = fixtureMetrics({ registered: 2, consumed: 1, "cause:gate": 2, "cause:segment-failed": 1 });
  try {
    const parsed = statusJson(d);
    const row = parsed.checks.find((c) => c.name === "handoff-causes");
    assert.ok(row, "handoff-causes 行缺席");
    assert.equal(row.state, "ok");
    assert.ok(row.detail.includes("gate×2"), `gate 计数缺席：${row.detail}`);
    assert.ok(row.detail.includes("segment-failed×1"), `segment-failed 计数缺席：${row.detail}`);
    // 观察面契约同域不破：schemaVersion/顶层四键/checks 三键
    assert.equal(parsed.schemaVersion, 1);
    assert.deepEqual(Object.keys(parsed).sort(), ["checks", "command", "ok", "schemaVersion"]);
    for (const c of parsed.checks) assert.deepEqual(Object.keys(c).sort(), ["detail", "name", "state"]);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("handoff-causes：无 cause:* 登记=skip（不误警；疤痕巡逻豁免纪律）", () => {
  const d = fixtureMetrics({ registered: 5, consumed: 5 });
  try {
    const parsed = statusJson(d);
    const row = parsed.checks.find((c) => c.name === "handoff-causes");
    assert.ok(row, "handoff-causes 行缺席（有 metrics 时行应在场）");
    assert.equal(row.state, "skip", `无登记应 skip：${row.state}`);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("handoff-causes：metrics.json 缺席=行整体缺席（与 handoff-usage 同隐现）", () => {
  const d = mkdtempSync(join(tmpdir(), "lzy-cause-readface-empty-"));
  try {
    const parsed = statusJson(d);
    assert.ok(!parsed.checks.some((c) => c.name === "handoff-causes"), "无 metrics 不应出行");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── M2 评审 a1.r1 F-4 收口：收束分类写面断言（此前只有读面自证）——handoffGoal 登记
// 真写 marker.cause 与 metrics cause:* 计数；旧签名（无 causeFamily）=cause null 不计数。
import { readFileSync } from "node:fs";
import { handoffGoal } from "../core/loop.js";

function goalFixture() {
  const d = mkdtempSync(join(tmpdir(), "lzy-cause-write-"));
  mkdirSync(join(d, ".lazyzcode", "loop"), { recursive: true });
  writeFileSync(
    join(d, ".lazyzcode", "loop", "goal.json"),
    JSON.stringify({
      version: 2, slug: "cw", title: "fixture", status: "executing", attempt: 1, tier: "light", risk: "low",
      policy: { schemaVersion: 1 }, contract: null, subjects: [],
      steps: [{ id: "N1", kind: "N", title: "do", status: "pending", note: null, acceptsRefs: [] }],
    }),
  );
  return d;
}

test("handoffGoal 写面：marker.cause 落盘＋metrics cause:* 计数（a1.r1 F-4）", () => {
  const d = goalFixture();
  try {
    const snap = join(d, "snap.md");
    writeFileSync(
      snap,
      [
        "# 交接快照",
        "## 剩余步骤",
        "N1 [N] do",
        "## 下一步动作",
        "接手会话按计划推下一未完步骤",
        "## 目标与进度",
        "cw · 0/1 步 · drive 收束因=波间门拒（gate）",
        "## 脏树清单",
        "（无）",
        "## tree hash",
        "（不可解析）",
        "## 风险与坑",
        "测试夹具",
        "## 复归指令",
        "zw 继续",
      ].join("\n") + "\n",
    );
    handoffGoal(d, snap, null, "gate");
    const marker = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "handoff.json"), "utf8"));
    assert.equal(marker.cause, "gate", `marker.cause 未落盘：${JSON.stringify(marker)}`);
    const metrics = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "metrics.json"), "utf8"));
    assert.equal(metrics.registered, 1);
    assert.equal(metrics["cause:gate"], 1, `cause:gate 计数缺席：${JSON.stringify(metrics)}`);
    // 再登记一次同族：计数累加
    handoffGoal(d, snap, null, "gate");
    const metrics2 = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "metrics.json"), "utf8"));
    assert.equal(metrics2["cause:gate"], 2, "同族二次登记计数未累加");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("handoffGoal 旧签名（无 causeFamily）：marker.cause=null 且不产 cause:* 键", () => {
  const d = goalFixture();
  try {
    const snap = join(d, "snap.md");
    writeFileSync(snap, "# 交接快照\n## 剩余步骤\nN1\n## 下一步动作\nx\n## 目标与进度\ncw\n## 脏树清单\n（无）\n## tree hash\n（不可解析）\n## 风险与坑\nx\n## 复归指令\nzw 继续\n");
    handoffGoal(d, snap, null);
    const marker = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "handoff.json"), "utf8"));
    assert.equal(marker.cause, null);
    const metrics = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "metrics.json"), "utf8"));
    assert.ok(!Object.keys(metrics).some((k) => k.startsWith("cause:")), `不应产 cause 键：${JSON.stringify(metrics)}`);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
