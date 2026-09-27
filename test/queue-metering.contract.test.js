// 计量与积分近似限制契约测试（0.3.0 M3，#32 拍板语义）：真实缺席路径（HOME 隔离→宿主
// db 缺席→metering-absent 不算零）；未计价模型同停类；killed-inflight 假零申报面；
// sessionId 白名单净化（注入面防御）；达限停止下一次派发（budget-ledger ⑤ 的姊妹面，
// 此处钉「受积分限额约束」的停派语义——纯墙钟批次不因计量缺席停）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addQueueItem,
  budgetView,
  loadLedger,
  loadQueue,
  querySessionPoints,
  refreshQueue,
  runQueueDispatch,
  setQueueBudget,
} from "../core/queue.js";
import { recordAuthorization } from "../core/contract.js";

process.env.LZY_ABLATE_HUMAN_GATE = "1";
const HOME = mkdtempSync(join(tmpdir(), "lzy-qmeter-home-"));
process.env.HOME = HOME; // billingDbPath 落本 HOME→db 缺席=真实计量缺席路径
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

function approvedItem(d, slug) {
  const it = addQueueItem(d, { title: slug, contractFile: join(d, "c.md"), planFile: join(d, "p.md"), goalSlug: slug });
  recordAuthorization(d, { kind: "approval", slug, contractHash: it.contractHash, sessionId: "t", at: new Date().toISOString() });
  refreshQueue(d);
  return it;
}

// 0.4.0 M1 sweep（拍板 6a）：注册产物恒 v2（N6），本文件验证计量面——直写降 v1 分域外。
function demoteV1(cwd) {
  const gp = join(cwd, ".lazyzcode", "loop", "goal.json");
  const g = JSON.parse(readFileSync(gp, "utf8"));
  delete g.policy;
  g.version = 1;
  writeFileSync(gp, `${JSON.stringify(g, null, 2)}\n`);
}

const okDriveDeps = {
  enginePath: "/fake/engine.cjs",
  detectAuth: () => ({ ok: true }),
  drive: async (cwd, opts) => {
    demoteV1(cwd); // 0.4.0 M1 sweep（拍板 6a）：降 v1 分域外（本文件验证计量面，非政策面）
    spawnSync(process.execPath, [CLI, "step", "done", "N1"], { cwd, encoding: "utf8", env: { ...process.env } });
    spawnSync(process.execPath, [CLI, "step", "done", "F1", "--evidence", "done"], { cwd, encoding: "utf8", env: { ...process.env } });
    opts.segmentRecords.push({ sessionId: "sess-m1", durationMs: 100, exitCode: 0, endedAt: new Date().toISOString() });
    return { ok: true, cause: "fake" };
  },
};

test("①真实缺席路径：HOME 隔离→宿主 db 缺席→querySessionPoints=absent（不算零）；派发结算记 metering-absent", async () => {
  const d = qrepo("lzy-qmeter-1-");
  try {
    assert.deepEqual(querySessionPoints("sess-abc"), { absent: true, unpriced: [], points: 0 });
    approvedItem(d, "qi-m1");
    setQueueBudget(d, { points: 100 }); // 积分限批次：缺席→停派语义激活
    const r = await runQueueDispatch(d, {}, okDriveDeps); // 不注入 queryPoints→真实缺席路径
    assert.equal(r.results[0].outcome, "completed"); // 本项在途完成不抹
    const ledger = loadLedger(d).entries;
    assert.ok(ledger.some((e) => e.kind === "metering-absent" && e.sessionId === "sess-m1"));
    assert.equal(budgetView(d).pointsStopped, true); // 受积分限额约束的派发停止（#32）
    assert.equal(budgetView(d).points, 0); // 缺席绝不折零入账——根本不产生 points 条目
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("②纯墙钟批次不因计量缺席停（#32 停派语义限定「受积分限额约束」）", async () => {
  const d = qrepo("lzy-qmeter-2-");
  try {
    approvedItem(d, "qi-m2");
    setQueueBudget(d, { wallMs: 600000 }); // 无积分总额
    const r = await runQueueDispatch(d, {}, okDriveDeps);
    assert.equal(r.results[0].outcome, "completed");
    assert.equal(budgetView(d).pointsStopped, false); // pointsLimited=false→停派不激活
    assert.ok(loadLedger(d).entries.some((e) => e.kind === "metering-absent")); // 记录仍在（如实）
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("③未计价模型=同停类：unpriced 记录 metering-absent 条目+pointsStopped", async () => {
  const d = qrepo("lzy-qmeter-3-");
  try {
    approvedItem(d, "qi-m3");
    setQueueBudget(d, { points: 100 });
    const r = await runQueueDispatch(d, {}, {
      ...okDriveDeps,
      querySessionPoints: () => ({ absent: false, unpriced: ["mystery-model"], points: 0 }),
    });
    assert.equal(r.results[0].outcome, "completed");
    const entry = loadLedger(d).entries.find((e) => e.kind === "metering-absent");
    assert.match(entry.note, /mystery-model/);
    assert.equal(budgetView(d).pointsStopped, true);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("④sessionId 白名单净化：引号/分号/越界字符→absent（不触 db，注入面防御）", () => {
  const d = qrepo("lzy-qmeter-4-");
  try {
    for (const evil of ["'; DROP TABLE model_usage;--", 'x"y', "a b", "中文名", ""]) {
      const m = querySessionPoints(evil);
      assert.equal(m.absent, true, `evil sessionId 须缺席判定：${evil}`);
      assert.equal(m.points, 0);
    }
    assert.equal(querySessionPoints(null).absent, true);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑤killed-inflight 申报在积分限批次下触发停派；墙钟批次不触发", async () => {
  const d = qrepo("lzy-qmeter-5-");
  try {
    approvedItem(d, "qi-m5");
    setQueueBudget(d, { points: 50, wallMs: 600000 });
    await runQueueDispatch(d, {}, {
      enginePath: "/fake/e", detectAuth: () => ({ ok: true }),
      drive: async () => {
        throw new Error("boom-段中死亡");
      },
    });
    // tx 未决未 reconcile：占用保守计入；killed-inflight 要 reconcile 后才申报
    assert.equal(budgetView(d).pointsStopped, false);
    const { reconcileDispatch } = await import("../core/queue.js");
    reconcileDispatch(d);
    assert.ok(loadLedger(d).entries.some((e) => e.kind === "killed-inflight"));
    assert.equal(budgetView(d).pointsStopped, true); // 未决消耗不假零→停积分限派发
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// 0.4.0 M2 N4：querySessionPoints dbPath 参数化（计量缝收口面，M0 发现一）——默认值=宿主
// 账本（既有调用点零变化），runner 恒传隔离 HOME 子账本路径。HAS_SQLITE3 分腿（sqlite3
// 缺席环境两腿都退化 absent，参数化面无从断言）。
const HAS_SQLITE3_N4 = spawnSync("sqlite3", ["--version"], { timeout: 5_000 }).status === 0;

test("⑥0.4.0 M2 参数化：默认路径=宿主账本（隔离 HOME 缺席→absent）；显式 dbPath 读子账本 metered>0 且二次读不累加", { skip: !HAS_SQLITE3_N4 }, () => {
  // 子账本夹具：隔离 HOME 外的独立路径（=评审运行目录 home 的形状）
  const sub = mkdtempSync(join(tmpdir(), "lzy-qmeter-sub-"));
  const dbDir = join(sub, ".zcode", "cli", "db");
  mkdirSync(dbDir, { recursive: true });
  const db = join(dbDir, "db.sqlite");
  const w = spawnSync(
    "sqlite3",
    [
      db,
      "CREATE TABLE model_usage (session_id TEXT, model_id TEXT, started_at INTEGER, input_tokens INTEGER, cache_read_input_tokens INTEGER, output_tokens INTEGER, status TEXT);" +
        "INSERT INTO model_usage VALUES ('sess-n4', 'glm-5.3-flash', 1, 1000000, 0, 1000, 'completed');",
    ],
    { encoding: "utf8" },
  );
  assert.equal(w.status, 0, `夹具账本写入：${w.stderr}`);
  try {
    // 默认路径（隔离 HOME 的宿主账本）不存在 → absent（默认行为未变）
    assert.equal(querySessionPoints("sess-n4").absent, true, "默认路径=宿主账本缺席→absent");
    // 显式 dbPath → 子账本读数 metered>0
    const m = querySessionPoints("sess-n4", { dbPath: db });
    assert.equal(m.absent, false);
    assert.ok(m.points > 0, `子账本读数 points>0（得 ${m.points}）`);
    // 二次读不累加（SELECT 只读幂等，拍板 7 去重语义）
    const m2 = querySessionPoints("sess-n4", { dbPath: db });
    assert.equal(m2.points, m.points, "同 sessionId 二次读同值（不累加）");
    // 白名单净化照走参数化路径
    assert.equal(querySessionPoints("evil;--", { dbPath: db }).absent, true);
  } finally {
    rmSync(sub, { recursive: true, force: true });
  }
});
