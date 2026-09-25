// 累计预算账本契约测试（0.3.0 M3，主方案 §5.2/拍板 2/4/8）：跨 reset/换 goal 累计不刷新；
// 相同回执 dedupKey 不重复扣账；崩溃未决占用按登记上限保守计入（绝不当零）；账本损坏
// fail-closed；预算设定/追加 provenance；--resume-points 只豁免确认时点前记录。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addQueueItem,
  appendLedgerEntry,
  budgetView,
  loadLedger,
  loadQueue,
  loadDispatch,
  refreshQueue,
  runQueueDispatch,
  setQueueBudget,
  describeReadiness,
} from "../core/queue.js";
import { recordAuthorization } from "../core/contract.js";

process.env.LZY_ABLATE_HUMAN_GATE = "1";
const HOME = mkdtempSync(join(tmpdir(), "lzy-qbudget-home-"));
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

const AUTH = () => ({ slug: "qi-w", contractHash: "a".repeat(64) });

// 两项串行队列夹具（q2 deps q1），全部真实批准记录
function twoItemQueue(d, slugs = ["qi-w1", "qi-w2"]) {
  const i1 = addQueueItem(d, { title: "w1", contractFile: join(d, "c.md"), planFile: join(d, "p.md"), goalSlug: slugs[0] });
  recordAuthorization(d, { kind: "approval", slug: slugs[0], contractHash: i1.contractHash, sessionId: "t", at: new Date().toISOString() });
  const i2 = addQueueItem(d, { title: "w2", contractFile: join(d, "c.md"), planFile: join(d, "p.md"), goalSlug: slugs[1], deps: ["q1"] });
  recordAuthorization(d, { kind: "approval", slug: slugs[1], contractHash: i2.contractHash, sessionId: "t", at: new Date().toISOString() });
  return { i1, i2 };
}

// 假 drive 骨架（逐测试内联展开，带各自的 sessionId/耗时）
const markSteps = (cwd) => {
  spawnSync(process.execPath, [CLI, "step", "done", "N1"], { cwd, encoding: "utf8", env: { ...process.env } });
  spawnSync(process.execPath, [CLI, "step", "done", "F1", "--evidence", "fake drive 完成"], { cwd, encoding: "utf8", env: { ...process.env } });
};

test("①dedup：同 dedupKey 第二次入账=duplicate（相同运行回执不重复扣账）", () => {
  const d = qrepo("lzy-qbudget-1-");
  try {
    const a = AUTH();
    const e1 = appendLedgerEntry(d, { kind: "wall", dedupKey: "wall:tx1:s1", authorization: a, ms: 1000 });
    assert.equal(e1.duplicate, false);
    const e2 = appendLedgerEntry(d, { kind: "wall", dedupKey: "wall:tx1:s1", authorization: a, ms: 1000 });
    assert.equal(e2.duplicate, true);
    assert.equal(budgetView(d).wallMs, 1000); // 只记一次
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("②损坏 fail-closed：篡改 ledger.json 字节→读面拒绝（校验和家法）", () => {
  const d = qrepo("lzy-qbudget-2-");
  try {
    appendLedgerEntry(d, { kind: "points", dedupKey: "points:tx1:s1", authorization: AUTH(), points: 3 });
    const p = join(d, ".lazyzcode", "budget", "ledger.json");
    const raw = JSON.parse(readFileSync(p, "utf8"));
    raw.entries[0].points = 999; // 篡改实际消耗
    writeFileSync(p, `${JSON.stringify(raw, null, 2)}\n`);
    assert.throws(() => budgetView(d), /校验和不符/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("③未决占用不假零：drive 异常留 open tx→按登记上限保守计入墙钟→预算尽不 ready", async () => {
  const d = qrepo("lzy-qbudget-3-");
  try {
    const it = addQueueItem(d, { title: "w", contractFile: join(d, "c.md"), planFile: join(d, "p.md"), goalSlug: "qi-w" });
    recordAuthorization(d, { kind: "approval", slug: "qi-w", contractHash: it.contractHash, sessionId: "t", at: new Date().toISOString() });
    setQueueBudget(d, { wallMs: 10000 });
    refreshQueue(d);
    const r = await runQueueDispatch(d, { wallMs: 10000 }, {
      enginePath: "/fake/engine.cjs",
      detectAuth: () => ({ ok: true }),
      drive: async () => {
        throw new Error("boom-中途崩溃");
      },
    });
    assert.equal(r.results[0].outcome, "error");
    const v = budgetView(d);
    assert.equal(v.openWallMs, 10000); // 占用登记=登记上限（保守）
    assert.equal(v.wallExhausted, true); // 未决占用计入→尽
    assert.ok(loadDispatch(d).txs[0].phase === "open"); // 未决不核销
    const reasons = describeReadiness(d, loadQueue(d).items[0]).reasons;
    assert.ok(reasons.some((x) => /墙钟总额已尽/.test(x)));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("④跨 reset/换 goal 累计不刷新：两项各自 finish+reset→ledger 两段墙钟同账本累计", async () => {
  const d = qrepo("lzy-qbudget-4-");
  try {
    twoItemQueue(d);
    let call = 0;
    const r = await runQueueDispatch(d, {}, {
      enginePath: "/fake/engine.cjs",
      detectAuth: () => ({ ok: true }),
      drive: async (cwd, opts) => {
        call += 1;
        markSteps(cwd);
        opts.segmentRecords.push({ sessionId: call === 1 ? "s-one" : "s-two", durationMs: call === 1 ? 5000 : 7000, exitCode: 0, endedAt: new Date().toISOString() });
        return { ok: true, cause: "fake 段数尽" };
      },
    });
    assert.deepEqual(r.results.map((x) => x.outcome), ["completed", "completed"]);
    const v = budgetView(d);
    assert.equal(v.wallMs, 12000); // 5000+7000：两次 reset/两个 goal，账本不分家
    assert.equal(loadLedger(d).entries.filter((e) => e.kind === "wall").length, 2);
    const q = loadQueue(d);
    assert.equal(q.items[0].state, "completed");
    assert.equal(q.items[0].completedEndpoint, "A");
    assert.equal(q.items[1].state, "completed");
    // 队列/派发家族在 reset 后健在（loop/ 外位阶）
    assert.ok(loadQueue(d).items.length === 2);
    assert.equal(loadDispatch(d).txs.length, 2);
    assert.ok(loadDispatch(d).txs.every((t) => t.phase === "settled"));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑤积分轴：逐会话 points 入账+达限停止下一次派发+在途超额如实 overrun", async () => {
  const d = qrepo("lzy-qbudget-5-");
  try {
    twoItemQueue(d, ["qi-p1", "qi-p2"]);
    setQueueBudget(d, { points: 10 });
    let n = 0;
    const r = await runQueueDispatch(d, {}, {
      enginePath: "/fake/engine.cjs",
      detectAuth: () => ({ ok: true }),
      drive: async (cwd, opts) => {
        n += 1;
        markSteps(cwd);
        opts.segmentRecords.push({ sessionId: `sess-${n}`, durationMs: 1000, exitCode: 0, endedAt: new Date().toISOString() });
        return { ok: true, cause: "fake" };
      },
      querySessionPoints: (sid) => ({ absent: false, unpriced: [], points: sid === "sess-1" ? 6 : 6 }),
    });
    // 第一项 6 分（<10）→完成；第二项入账 6→累计 12 越限→overrun 如实+停止
    assert.equal(r.results[0].outcome, "completed");
    assert.equal(r.results[1].outcome, "completed"); // 已派发的在途超额不抹（如实记账后完成）
    const ledger = loadLedger(d).entries;
    assert.equal(ledger.filter((e) => e.kind === "points").length, 2);
    const overrun = ledger.filter((e) => e.kind === "overrun");
    assert.equal(overrun.length, 1);
    assert.equal(overrun[0].points, 2); // 12-10：实际超额
    const v = budgetView(d);
    assert.equal(v.pointsExhausted, true); // 停止下一次派发
    const r2 = await runQueueDispatch(d, {}, { enginePath: "/fake/e", detectAuth: () => ({ ok: true }), drive: async () => ({ ok: true }) });
    assert.match(r2.stop, /无 ready 项|积分总额已尽/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑥--resume-points 只豁免确认时点前的在案记录；其后新增重新停止", () => {
  const d = qrepo("lzy-qbudget-6-");
  try {
    addQueueItem(d, { title: "w", contractFile: join(d, "c.md"), planFile: join(d, "p.md"), goalSlug: "qi-r" });
    setQueueBudget(d, { points: 5 });
    appendLedgerEntry(d, { kind: "metering-absent", dedupKey: "metering-absent:t1:s1", authorization: AUTH() });
    assert.equal(budgetView(d).pointsStopped, true);
    setQueueBudget(d, { resumePoints: true, note: "人工核对后恢复" });
    assert.equal(budgetView(d).pointsStopped, false); // 确认豁免在案记录
    // 确认之后新增缺席（新 tx）→重新停止
    appendLedgerEntry(d, { kind: "killed-inflight", dedupKey: "killed-inflight:t2", authorization: AUTH() });
    assert.equal(budgetView(d).pointsStopped, true);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑦预算设定校验：非正 points/非整 wall-ms 拒；注记追加不覆写", () => {
  const d = qrepo("lzy-qbudget-7-");
  try {
    addQueueItem(d, { title: "w", contractFile: join(d, "c.md"), planFile: join(d, "p.md"), goalSlug: "qi-v" });
    assert.throws(() => setQueueBudget(d, { points: 0 }), /正数/);
    assert.throws(() => setQueueBudget(d, { wallMs: -5 }), /正整数/);
    setQueueBudget(d, { points: 10, note: "n1" });
    setQueueBudget(d, { points: 20, note: "n2" }); // 追加额度=新值+新注记
    const q = loadQueue(d);
    assert.equal(q.budget.pointsLimit, 20);
    assert.deepEqual(q.budget.notes.map((x) => x.note), ["n1", "n2"]);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
