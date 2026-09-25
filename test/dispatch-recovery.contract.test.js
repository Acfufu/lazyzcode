// 派发恢复契约测试（0.3.0 M3，主方案 §5.1/拍板 5/6）：恢复判定表 (a)(b)(c) 三支活体；
// 不重复派发（running 条目+未决事务拒再派）；腾槽时序（完成归档+队列确认之后才 reset）；
// 授权撤回批次停且未授权工作零执行；失败依赖阻塞+独立 ready 项续推；槽位被他目标占用
// 不越权处置；真实 runDrive 段记录 sink 协同（队列结算输入面）。
import { test } from "node:test";
process.env.LZY_ABLATE_HUMAN_GATE = "1";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addQueueItem,
  loadDispatch,
  loadLedger,
  loadQueue,
  reconcileDispatch,
  refreshQueue,
  runQueueDispatch,
  saveQueue,
} from "../core/queue.js";
import { recordAuthorization } from "../core/contract.js";
import { resetLoop } from "../core/loop.js";
import { createGit } from "../core/git.js";
import { runDrive } from "../core/drive.js";
import { acquireLease } from "../core/runtime.js";

const HOME = mkdtempSync(join(tmpdir(), "lzy-qrecov-home-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");

function qrepo(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "a\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "init"]);
  writeFileSync(
    join(d, "lzy.project.json"),
    JSON.stringify({ schemaVersion: 1, capabilities: { check: [{ id: "smoke", argv: ["node", "-e", "process.exit(0)"], timeoutMs: 30000 }] } }),
  );
  writeFileSync(join(d, "c.md"), "task: queue item\nendpoint: A\nscope: .\nrecipe: none\n\n- [A1] 完成\n");
  writeFileSync(join(d, "p.md"), "- [N1] x\n- [F1] marker\naccepts: A1\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "fixture"]); // finish 完整性闸门要求树净——夹具文件先落提交
  return d;
}

function approvedItem(d, slug, { deps } = {}) {
  const it = addQueueItem(d, { title: slug, contractFile: join(d, "c.md"), planFile: join(d, "p.md"), goalSlug: slug, deps });
  recordAuthorization(d, { kind: "approval", slug, contractHash: it.contractHash, sessionId: "t", at: new Date().toISOString() });
  refreshQueue(d);
  return it;
}

const itemState = (d, id) => loadQueue(d).items.find((x) => x.id === id).state;
const goalJson = (d) => join(d, ".lazyzcode", "loop", "goal.json");
// 崩溃形态：deps.drive 中途抛（tx 已开、goal 已注册）→tx open+item ready+goal executing
const crashingDeps = {
  enginePath: "/fake/engine.cjs",
  detectAuth: () => ({ ok: true }),
  drive: async () => {
    throw new Error("boom-SIGKILL-形态");
  },
};

test("①判定表(a)：未决 tx×goal executing→killed+killed-inflight 显式申报+item 回 ready（不重注册）", async () => {
  const d = qrepo("lzy-qrecov-1-");
  try {
    approvedItem(d, "qi-ra");
    await runQueueDispatch(d, {}, crashingDeps);
    assert.equal(loadDispatch(d).txs[0].phase, "open");
    const rec = reconcileDispatch(d);
    assert.equal(rec.verdicts[0].verdict, "killed（item 回 ready）");
    assert.equal(loadDispatch(d).txs[0].phase, "killed");
    assert.ok(loadLedger(d).entries.some((e) => e.kind === "killed-inflight"));
    assert.equal(itemState(d, "q1"), "ready");
    // goal 未被重注册/未被动：同一 executing goal 原样在场
    const goal = JSON.parse(readFileSync(goalJson(d), "utf8"));
    assert.equal(goal.slug, "qi-ra");
    assert.equal(goal.status, "executing");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("②判定表(b)：未决 tx×goal done→补结算诚实归账+item completed（崩溃在归档与确认之间）", async () => {
  const d = qrepo("lzy-qrecov-2-");
  try {
    approvedItem(d, "qi-rb");
    await runQueueDispatch(d, {}, crashingDeps);
    // 手工把 goal 推到 done（模拟另一路径完成归档而队列确认未达）
    const goal = JSON.parse(readFileSync(goalJson(d), "utf8"));
    goal.status = "done";
    writeFileSync(goalJson(d), `${JSON.stringify(goal, null, 2)}\n`);
    const rec = reconcileDispatch(d);
    assert.match(rec.verdicts[0].verdict, /^settled/);
    assert.equal(loadDispatch(d).txs[0].phase, "settled");
    assert.equal(itemState(d, "q1"), "completed");
    assert.equal(loadQueue(d).items[0].completedEndpoint, "A");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("③判定表(c)：未决 tx×goal 缺失→reconciled-orphan+item failed 带人工指路（不静默重注册）", async () => {
  const d = qrepo("lzy-qrecov-3-");
  try {
    approvedItem(d, "qi-rc");
    await runQueueDispatch(d, {}, crashingDeps);
    resetLoop(d, createGit(d)); // goal 被清（他因）
    const rec = reconcileDispatch(d);
    assert.match(rec.verdicts[0].verdict, /reconciled-orphan/);
    assert.equal(loadDispatch(d).txs[0].phase, "reconciled-orphan");
    assert.equal(itemState(d, "q1"), "failed");
    assert.match(loadQueue(d).items[0].blockedReason, /人工核对/);
    assert.ok(!existsSync(goalJson(d))); // 绝不静默重注册
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("④不重复派发/不越权核销：租约在握的 open tx→busy-live 不核销；无 ready 项止步零新事务", async () => {
  const d = qrepo("lzy-qrecov-4-");
  try {
    approvedItem(d, "qi-rd");
    await runQueueDispatch(d, {}, {
      enginePath: "/fake/engine.cjs",
      detectAuth: () => ({ ok: true }),
      drive: async () => {
        acquireLease(d, { ttlMs: 600_000, slug: "qi-rd" }); // 模拟 drive 持租（异常路径未释放=仍活跃形态）
        throw new Error("boom-持租中崩溃形态");
      },
    });
    assert.equal(loadDispatch(d).txs[0].phase, "open");
    const txCount = loadDispatch(d).txs.length;
    const r = await runQueueDispatch(d, {}, crashingDeps);
    assert.match(r.stop, /无 ready 项/); // 租约占用→不 ready→止步，绝不带血派发
    assert.equal(loadDispatch(d).txs.length, txCount); // 零新事务
    assert.equal(loadDispatch(d).txs[0].phase, "open"); // 租约在握→busy-live 不核销
    const ledger = loadLedger(d); // 从未结算→账本缺席（null）=无 killed-inflight 假零申报
    assert.ok(!ledger || !ledger.entries.some((e) => e.kind === "killed-inflight"));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑤腾槽时序：两项串行→两项各自完成后槽位腾空（确认后才 reset，全程零执行态残留）", async () => {
  const d = qrepo("lzy-qrecov-5-");
  try {
    approvedItem(d, "qi-re1");
    approvedItem(d, "qi-re2");
    let call = 0;
    const r = await runQueueDispatch(d, {}, {
      enginePath: "/fake/engine.cjs",
      detectAuth: () => ({ ok: true }),
      drive: async (cwd, opts) => {
        call += 1;
        markSteps(cwd);
        opts.segmentRecords.push({ sessionId: `s-${call}`, durationMs: 100, exitCode: 0, endedAt: new Date().toISOString() });
        return { ok: true, cause: "fake" };
      },
    });
    assert.deepEqual(r.results.map((x) => x.outcome), ["completed", "completed"]);
    assert.ok(!existsSync(goalJson(d))); // 终局：队列确认完毕、槽位腾空
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
const markSteps = (cwd) => {
  spawnSync(process.execPath, [CLI, "step", "done", "N1"], { cwd, encoding: "utf8", env: { ...process.env } });
  spawnSync(process.execPath, [CLI, "step", "done", "F1", "--evidence", "fake drive 完成"], { cwd, encoding: "utf8", env: { ...process.env } });
};

test("⑥撤回批次停：withdrawal→blocked(authorization)→dispatch 拒且零执行（goal 未注册）", async () => {
  const d = qrepo("lzy-qrecov-6-");
  try {
    const it = approvedItem(d, "qi-rf");
    recordAuthorization(d, { kind: "withdrawal", slug: "qi-rf", contractHash: it.contractHash, sessionId: "td", at: new Date().toISOString() });
    refreshQueue(d);
    assert.equal(itemState(d, "q1"), "blocked");
    const r = await runQueueDispatch(d, {}, {
      enginePath: "/fake/e", detectAuth: () => ({ ok: true }), drive: async () => ({ ok: true }),
    });
    assert.match(r.stop, /无 ready 项/);
    assert.ok(!existsSync(goalJson(d))); // 未授权工作零执行：goal 从未注册
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑦失败依赖阻塞+独立 ready 项续推：q1 失败→q2 blocked(deps)→q3 独立完成（下次派发）", async () => {
  const d = qrepo("lzy-qrecov-7-");
  try {
    approvedItem(d, "qi-rg1"); // q1
    approvedItem(d, "qi-rg2", { deps: ["q1"] }); // q2 deps q1
    approvedItem(d, "qi-rg3"); // q3 独立
    let call = 0;
    const drive = async (cwd, opts) => {
      call += 1;
      if (call === 1) return { ok: false, cause: "段失败（exit=1）" }; // q1 失败
      markSteps(cwd);
      opts.segmentRecords.push({ sessionId: `s-${call}`, durationMs: 100, exitCode: 0, endedAt: new Date().toISOString() });
      return { ok: true, cause: "fake" };
    };
    const deps0 = { enginePath: "/fake/engine.cjs", detectAuth: () => ({ ok: true }), drive };
    const r1 = await runQueueDispatch(d, {}, deps0);
    assert.equal(r1.results[0].outcome, "failed"); // 失败止步本批
    assert.equal(itemState(d, "q1"), "failed");
    assert.equal(itemState(d, "q2"), "blocked"); // 依赖失败阻塞
    assert.match(loadQueue(d).items[1].blockedReason, /依赖失败/);
    const r2 = await runQueueDispatch(d, {}, deps0); // 独立 ready 项可继续
    assert.equal(r2.results[0].outcome, "completed", JSON.stringify(r2.results[0]));
    assert.equal(itemState(d, "q3"), "completed");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑧槽位被他活跃目标占用：队列不越权处置——tx orphan+item failed+他目标原样", async () => {
  const d = qrepo("lzy-qrecov-8-");
  try {
    approvedItem(d, "qi-rh");
    // 造一个无关 executing goal 占槽（人权门消融 env 直采）
    spawnSync(process.execPath, [CLI, "loop", "register", "other-goal", "--title", "t"], { cwd: d, encoding: "utf8", env: { ...process.env } });
    writeFileSync(join(d, "pp.md"), "- [N1] x\n");
    spawnSync(process.execPath, [CLI, "loop", "plan", "pp.md"], { cwd: d, encoding: "utf8", env: { ...process.env } });
    spawnSync(process.execPath, [CLI, "loop", "start"], { cwd: d, encoding: "utf8", env: { ...process.env } });
    const r = await runQueueDispatch(d, {}, {
      enginePath: "/fake/e", detectAuth: () => ({ ok: true }), drive: async () => ({ ok: true }),
    });
    assert.equal(r.results[0].outcome, "failed");
    assert.match(r.results[0].cause, /槽位被他目标占用/);
    const goal = JSON.parse(readFileSync(goalJson(d), "utf8"));
    assert.equal(goal.slug, "other-goal"); // 他目标原样，绝不 reset
    assert.equal(goal.status, "executing");
    assert.equal(loadDispatch(d).txs[0].phase, "reconciled-orphan");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑨真实 runDrive 协同：段记录 sink 逐段外报（队列结算输入面，假引擎零触网）", async () => {
  const d = qrepo("lzy-qrecov-9-");
  try {
    spawnSync(process.execPath, [CLI, "loop", "register", "drv-q", "--title", "t"], { cwd: d, encoding: "utf8", env: { ...process.env } });
    writeFileSync(join(d, "p2.md"), "- [N1] x\n");
    spawnSync(process.execPath, [CLI, "loop", "plan", "p2.md"], { cwd: d, encoding: "utf8", env: { ...process.env } });
    spawnSync(process.execPath, [CLI, "loop", "start"], { cwd: d, encoding: "utf8", env: { ...process.env } });
    const segmentRecords = [];
    const r = await runDrive(d, { maxSegments: 1, segmentRecords }, {
      enginePath: "/fake/engine.cjs",
      detectAuth: () => ({ ok: true }),
      run: () => ({ exitCode: 0, stdout: JSON.stringify({ sessionId: "sess-x" }), stderr: "" }),
    });
    assert.equal(r.ok, true); // 段数尽=干净收束
    assert.equal(segmentRecords.length, 1);
    assert.equal(segmentRecords[0].sessionId, "sess-x");
    assert.equal(segmentRecords[0].exitCode, 0);
    assert.ok(typeof segmentRecords[0].durationMs === "number");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
