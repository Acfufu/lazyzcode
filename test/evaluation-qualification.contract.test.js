// 评估资格判定契约（0.5.0 M0，goal v050-m0-instrument · plan-v050 §4 P0 收口）：
// 六类不完整批必须「不具备评估资格」（stage=evaluation-qualification），与 §9.2 质量门
// 「不满足」可判别；关键反例清单绑定批清单（缺席=拒，显式空=声明「无」）；每任务
// 门槛按预注册 trial 分母计算（不再硬编码成功数 2）。全替身面，不依赖引擎与网络。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RP = join(ROOT, "scripts", "evaluation", "run-pairs.mjs");
const { qualificationGate, qualityGate, writeReport, appendJournal, loadJournal } = await import(`file://${RP}`);
const sha256Of = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

const TASKS = ["lazyzcode/task-1", "lazyzcode/task-2"];
const SEQ = [];
{
  let seq = 0;
  for (const taskId of TASKS) for (let trial = 1; trial <= 3; trial += 1) for (const arm of ["old", "new"]) SEQ.push({ seq: (seq += 1), repo: "lazyzcode", taskId, trial, arm });
}
const row = (c, over = {}) => ({ ...c, status: "ok", oraclePassed: true, goalDone: true, oracleJudge: 2, ...over });

function makeBatch(overrides = {}) {
  const d = mkdtempSync(join(tmpdir(), "lzy-qg-"));
  const tgzB = join(d, "b.tgz");
  const tgzC = join(d, "c.tgz");
  writeFileSync(tgzB, "b");
  writeFileSync(tgzC, "c");
  return {
    batchId: "fx-qg",
    keyCounterexampleIds: ["lazyzcode/task-1"],
    repoTaskIds: { lazyzcode: TASKS },
    sequence: SEQ,
    packages: { baseline: { path: tgzB, sha256: sha256Of(tgzB) }, candidate: { path: tgzC, sha256: sha256Of(tgzC) } },
    env: { node: process.version },
    ...overrides,
  };
}

function reportOf(batch, rows) {
  const d = mkdtempSync(join(tmpdir(), "lzy-qgrun-"));
  try {
    for (const r of rows) appendJournal(d, r);
    return writeReport(d, batch, loadJournal(d).lines.map((l) => l.record).filter(Boolean));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

describe("评估资格判定（0.5.0 M0）", () => {
  test("对照：完整批出报告，资格面与反例逐项判读绑定在案", () => {
    const out = reportOf(makeBatch(), SEQ.map((c) => row(c)));
    assert.equal(out.refused, false);
    assert.equal(out.report.qualification.eligible, true);
    assert.equal(out.report.counterexamples.declared, 1);
    assert.equal(out.report.counterexamples.items[0].id, "lazyzcode/task-1");
    assert.match(out.report.counterexamples.items[0].verdict, /守住/);
  });

  test("缺任务：任务零行=资格拒（stage=evaluation-qualification，非质量门形态）", () => {
    const out = reportOf(makeBatch(), SEQ.filter((c) => c.taskId === "lazyzcode/task-1").map((c) => row(c)));
    assert.equal(out.refused, true);
    assert.equal(out.stage, "evaluation-qualification");
    assert.ok(out.qualification.reasons.some((x) => /缺任务/.test(x)), out.qualification.reasons.join("；"));
  });

  test("缺臂：单臂批=资格拒", () => {
    const out = reportOf(makeBatch(), SEQ.filter((c) => c.taskId !== "lazyzcode/task-2" || c.arm === "new").map((c) => row(c)));
    assert.equal(out.refused, true);
    assert.ok(out.qualification.reasons.some((x) => /缺臂/.test(x)));
  });

  test("缺 trial：3 试缺 1=资格拒（预注册分母对表）", () => {
    const out = reportOf(makeBatch(), SEQ.filter((c) => !(c.taskId === "lazyzcode/task-2" && c.arm === "new" && c.trial === 3)).map((c) => row(c)));
    assert.equal(out.refused, true);
    assert.ok(out.qualification.reasons.some((x) => /缺 trial/.test(x)));
  });

  test("重复 trial：同格双行=资格拒", () => {
    const rows = SEQ.map((c) => row(c, c.seq === 8 ? { trial: 1, arm: "old" } : {}));
    const out = reportOf(makeBatch(), rows);
    assert.equal(out.refused, true);
    assert.ok(out.qualification.reasons.some((x) => /重复 trial/.test(x)));
  });

  test("未知判读：oraclePassed 缺席不记败=资格拒", () => {
    const out = reportOf(makeBatch(), SEQ.map((c) => row(c, c.seq === 3 ? { oraclePassed: null } : {})));
    assert.equal(out.refused, true);
    assert.ok(out.qualification.reasons.some((x) => /未知判读/.test(x)));
  });

  test("身份混杂：行格位与冻结序列错位=资格拒", () => {
    const out = reportOf(makeBatch(), SEQ.map((c) => row(c, c.seq === 5 ? { taskId: "lazyzcode/task-2" } : {})));
    assert.equal(out.refused, true);
    assert.ok(out.qualification.reasons.some((x) => /身份混杂/.test(x)));
  });

  test("判读代次混杂：v1 隐式行与 v2 行混批=资格拒", () => {
    const rows = SEQ.map((c) => {
      const r = row(c);
      if (c.seq === 2) delete r.oracleJudge;
      return r;
    });
    const out = reportOf(makeBatch(), rows);
    assert.equal(out.refused, true);
    assert.ok(out.qualification.reasons.some((x) => /判读代次混杂/.test(x)));
  });

  test("关键反例 id 悬空/错形：不在冻结任务集=资格拒（0.5.0 M0 评审 F-2，不再静默「守住」）", () => {
    const out = reportOf(makeBatch({ keyCounterexampleIds: ["lazyzcode/task-1", "lazyzcode/ghost-task"] }), SEQ.map((c) => row(c)));
    assert.equal(out.refused, true);
    assert.ok(out.qualification.reasons.some((x) => /关键反例 id 不在冻结任务集/.test(x)), out.qualification.reasons.join("；"));
  });

  test("关键反例清单未预注册：字段缺席=资格拒（与显式空可判别）", () => {
    const b = makeBatch();
    delete b.keyCounterexampleIds;
    const out = reportOf(b, SEQ.map((c) => row(c)));
    assert.equal(out.refused, true);
    assert.ok(out.qualification.reasons.some((x) => /未预注册关键反例清单/.test(x)));
  });

  test("分母去硬编码：6 trial 任务 3/6 正确=质量门拒且读数按预注册分母", () => {
    const seq6 = [];
    let s = 0;
    for (let trial = 1; trial <= 6; trial += 1) for (const arm of ["old", "new"]) seq6.push({ seq: (s += 1), repo: "lazyzcode", taskId: "lazyzcode/task-9", trial, arm });
    const rows = seq6.map((c) => row(c, { oraclePassed: c.arm === "new" ? c.trial <= 3 : true }));
    const out = reportOf(makeBatch({ keyCounterexampleIds: [], repoTaskIds: { lazyzcode: ["lazyzcode/task-9"] }, sequence: seq6 }), rows);
    assert.equal(out.refused, false);
    const qg = out.report.qualityGate;
    assert.equal(qg.met, false);
    assert.ok(qg.reasons.some((x) => /新臂正确交付 3\/6/.test(x)), qg.reasons.join("；"));
  });

  test("直接调用面：qualityGate 带 trialsByTask 时门槛=⌈2/3×预注册⌉；缺席回退 3（既有调用方兼容）", () => {
    const trialsByTask = new Map([["r/oldtask", 6]]);
    const mk = (taskId, arm, ok) => ({ repo: "r", taskId, trial: 1, arm, status: "ok", oraclePassed: ok, goalDone: ok });
    // 6 trial 任务 3 正确：<⌈2/3×6⌉=4 → 拒；默认分母（回退 3→需 2）时 3 正确放行。
    const rows6 = [1, 1, 1, 0, 0, 0].map((ok, i) => mk("oldtask", "new", Boolean(ok)));
    const strict = qualityGate(rows6, { trialsByTask });
    assert.equal(strict.met, false);
    assert.ok(strict.reasons.some((x) => /每任务须 ≥4\/6/.test(x)));
    const lenient = qualityGate(rows6.map((r, i) => ({ ...r, trial: i + 1 })));
    assert.equal(lenient.reasons.some((x) => /每任务须/.test(x)), false);
  });

  test("资格判定纯函数面：冻结序列重复格位/重复 seq 直接入拒因", () => {
    const b = makeBatch({ sequence: [...SEQ, { ...SEQ[0] }] });
    const qual = qualificationGate(SEQ.map((c) => row(c)), { batch: b, keyCounterexampleIds: ["lazyzcode/task-1"] });
    assert.equal(qual.eligible, false);
    assert.ok(qual.reasons.some((x) => /冻结序列重复格位/.test(x)));
    assert.ok(qual.reasons.some((x) => /seq 1 重复声明/.test(x)));
  });
});
