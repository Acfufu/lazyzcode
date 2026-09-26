// 队列×交付桥接契约测试（0.3.1 棒1，ADR-0030 §一.F）：dispatch 交付编排链 + reconcile 交付感知。
// 家法：真 CLI 完成 goal 步骤（假 drive 配方）+ deps 注入假 gh/curl（外部面假化，机器链全真）。
import { test } from "node:test";
process.env.LZY_ABLATE_HUMAN_GATE = "1"; // 授权门非本文件被测面（批准走 recordAuthorization 受信写者）
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { addQueueItem, loadDispatch, loadLedger, loadQueue, refreshQueue, reconcileDispatch, runQueueDispatch, saveDispatch } from "../core/queue.js";
import { recordAuthorization } from "../core/contract.js";
import { loadIntents, actDeliveryB } from "../core/delivery.js";
import { bindDeliveryContract } from "../core/loop.js";

const HOME = mkdtempSync(join(tmpdir(), "lzy-qbridge-home-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");

const HEAD = "a".repeat(40);
const MERGE = "b".repeat(40);
const REPO = "Acfufu/lazyzcode";
const MARKER = "v0.3.1";

function bridgeRepo(prefix, { endpoint = "C", delivery } = {}) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  g(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(d, "a.txt"), "a\n");
  writeFileSync(
    join(d, "lzy.project.json"),
    JSON.stringify({ schemaVersion: 1, capabilities: { check: [{ id: "smoke", argv: ["node", "-e", "process.exit(0)"], timeoutMs: 30000 }] } }),
  );
  writeFileSync(join(d, `c-main.md`), `task: main ${endpoint}\nendpoint: ${endpoint}\nscope: .\nrecipe: none\n\n- [A1] x\n`);
  writeFileSync(join(d, "cb.md"), "task: B 交付\nendpoint: B\nscope: .\nrepo: Acfufu/lazyzcode\nbase: main\nbranch: v031\npr-title: t\n\n- [A1] x\n");
  writeFileSync(join(d, "cc.md"), "task: C 交付\nendpoint: C\nscope: .\nrepo: Acfufu/lazyzcode\nexpect-marker: v0.3.1\npage: /guide/\n\n- [A1] x\n");
  writeFileSync(join(d, "p.md"), "- [N1] x\n- [F1] marker\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "fixture"]);
  const it = addQueueItem(d, {
    title: "bridge-item",
    contractFile: join(d, "c-main.md"),
    planFile: join(d, "p.md"),
    goalSlug: "qbridge",
    endpoint,
    delivery: delivery ?? { B: join(d, "cb.md"), C: join(d, "cc.md") },
  });
  recordAuthorization(d, { kind: "approval", slug: "qbridge", contractHash: it.contractHash, sessionId: "t", at: new Date().toISOString() });
  for (const ep of ["B", "C"]) {
    if (it.delivery?.[ep]) {
      recordAuthorization(d, { kind: "approval", slug: "qbridge", contractHash: it.delivery[ep].hash, sessionId: "t", at: new Date().toISOString() });
    }
  }
  refreshQueue(d);
  return { d, it };
}

// 假 drive（M3 配方）：真 CLI 标记 N1/F1 done（LIGHT finish 过）
const fakeDrive = {
  enginePath: "/fake/engine.cjs",
  detectAuth: () => ({ ok: true }),
  drive: async (cwd, opts) => {
    spawnSync(process.execPath, [CLI, "step", "done", "N1"], { cwd, encoding: "utf8", env: { ...process.env } });
    spawnSync(process.execPath, [CLI, "step", "done", "F1", "--evidence", "bridge-fake"], { cwd, encoding: "utf8", env: { ...process.env } });
    opts.segmentRecords.push({ sessionId: "sess-bridge", durationMs: 42, exitCode: 0, endedAt: new Date().toISOString() });
    return { ok: true, cause: "fake" };
  },
};

// 假 gh/curl（外部面假化；状态机：merge 前 OPEN/后 MERGED）
function fakeExt({ mergeWorks = true, pagesAligned = true, httpOk = true, markerOk = true } = {}) {
  const calls = [];
  let merged = false;
  return {
    sleep: () => {},
    gitHead: () => HEAD,
    gitPush: () => {
      calls.push("git-push");
      return { code: 0, stdout: "", stderr: "" };
    },
    ghApi: (args) => {
      const a = args.join(" ");
      calls.push(a);
      if (args[0] === "pr" && args[1] === "list") return { code: 0, stdout: "[]", stderr: "" };
      if (args[0] === "pr" && args[1] === "view") {
        return { code: 0, stdout: JSON.stringify({ state: merged ? "MERGED" : "OPEN", headRefOid: HEAD, baseRefName: "main", number: 7, url: "u", mergeCommit: merged ? { oid: MERGE } : null }), stderr: "" };
      }
      if (args[0] === "pr" && args[1] === "create") return { code: 0, stdout: JSON.stringify({ number: 7 }), stderr: "" };
      if (args[0] === "pr" && args[1] === "merge") {
        if (mergeWorks) merged = true;
        return { code: mergeWorks ? 0 : 1, signal: null, stdout: "", stderr: mergeWorks ? "" : "not mergeable" };
      }
      if (a.includes("check-runs")) return { code: 0, stdout: JSON.stringify([{ name: "ci", status: "COMPLETED", conclusion: "SUCCESS" }]), stderr: "" };
      if (a.includes("pages/builds/latest")) return { code: 0, stdout: JSON.stringify({ status: pagesAligned ? "built" : "building", commit: pagesAligned ? MERGE : "f".repeat(40) }), stderr: "" };
      return { code: 1, stdout: "", stderr: `fake 未匹配：${a}` };
    },
    curlGet: () => ({ code: 0, stdout: `${markerOk ? MARKER : "nope"}HTTPSTATUS:${httpOk ? 200 : 404}`, stderr: "" }),
    _calls: calls,
  };
}

// 造「goal 已 done」夹具态（register 后改 status；goalSlug 与条目一致）
function makeDoneGoal(d) {
  const r = spawnSync(process.execPath, [CLI, "loop", "register", "qbridge", "--title", "t"], {
    cwd: d, encoding: "utf8",
    env: { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: "/nonexistent-lzy-suppressed" },
  });
  if (r.status !== 0) throw new Error(`register 失败：${r.stderr || r.stdout}`);
  const gp = join(d, ".lazyzcode", "loop", "goal.json");
  const g = JSON.parse(readFileSync(gp, "utf8"));
  g.status = "done";
  writeFileSync(gp, `${JSON.stringify(g, null, 2)}\n`);
}

// 造「open tx」手工态（走 saveDispatch=家族校验和/形状同源，不手写 JSON）
function pushManualTx(d, tx) {
  const dj = loadDispatch(d) ?? { txs: [] };
  dj.txs.push(tx);
  saveDispatch(d, dj);
}

const itemOf = (d, id) => loadQueue(d).items.find((x) => x.id === id);
const mineIntents = (d, id) => (loadIntents(d)?.intents ?? []).filter((x) => x.origin?.itemId === id);

test("①桥全链（endpoint C）：drive→finish→B act/readback→C act/readback→completed(endpoint=C)，意图带 origin，交付墙钟入账", async () => {
  const { d, it } = bridgeRepo("lzy-qbridge-1-");
  try {
    const ext = fakeExt();
    const r = await runQueueDispatch(d, {}, { ...fakeDrive, ...ext });
    assert.equal(r.results[0].outcome, "completed", JSON.stringify(r));
    const final = itemOf(d, it.id);
    assert.equal(final.state, "completed");
    assert.equal(final.completedEndpoint, "C");
    const intents = mineIntents(d, it.id);
    assert.equal(intents.length, 2, "B∧C 各一条意图");
    assert.ok(intents.every((x) => x.status === "done"), intents.map((x) => `${x.endpoint}:${x.status}`).join(","));
    assert.deepEqual(intents.map((x) => x.endpoint).sort(), ["B", "C"]);
    assert.ok(intents.every((x) => x.origin.slug === "qbridge" && x.origin.kind === "queue"));
    const ledger = loadLedger(d).entries;
    assert.ok(ledger.some((e) => e.kind === "wall" && e.dedupKey === `wall:${loadDispatch(d).txs.at(-1).txId}:delivery`), "交付墙钟条目须在场");
    assert.equal(loadDispatch(d).txs.at(-1).phase, "settled");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("②交付未竟（endpoint B，PR 不合并）：item failed+指路、不动 goal、tx settled、零假完成", async () => {
  const { d, it } = bridgeRepo("lzy-qbridge-2-", { endpoint: "B", delivery: { B: "./cb.md" } });
  try {
    // 修正夹具：endpoint B 只声明 B 契约
    const d2 = d;
    void d2;
    const ext = fakeExt({ mergeWorks: false });
    const r = await runQueueDispatch(d, {}, { ...fakeDrive, ...ext });
    assert.equal(r.results[0].outcome, "failed", JSON.stringify(r));
    const final = itemOf(d, it.id);
    assert.equal(final.state, "failed");
    assert.match(final.blockedReason, /^交付未竟：B /);
    assert.match(final.blockedReason, /lzy delivery readback\/act/);
    assert.equal(final.completedEndpoint, null);
    assert.equal(loadDispatch(d).txs.at(-1).phase, "settled");
    const ledger = loadLedger(d).entries;
    assert.ok(ledger.some((e) => e.kind === "wall" && String(e.dedupeKey ?? e.dedupKey).endsWith(":delivery")), "未竟路径也入交付墙钟");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("③两处派发前拒绝：契约改后 / 计划改后 → item failed+指路、零 openTx、零 killed-inflight", async () => {
  const { d, it } = bridgeRepo("lzy-qbridge-3-");
  try {
    // 契约改后：改 cc.md（C 契约）→ 现字节哈希 != 入队值
    writeFileSync(join(d, "cc.md"), "task: C 改\nendpoint: C\nscope: .\nrepo: Acfufu/lazyzcode\nexpect-marker: v0.3.1\n\n- [A1] x\n");
    const r = await runQueueDispatch(d, {}, { ...fakeDrive, ...fakeExt() });
    assert.match(r.stop ?? "", /派发前拒绝.*交付契约已改/);
    const final = itemOf(d, it.id);
    assert.equal(final.state, "failed");
    assert.match(final.blockedReason, /交付契约已改=新哈希（C）/);
    assert.equal((loadDispatch(d)?.txs ?? []).filter((t) => t.phase === "open").length, 0, "零 openTx（未 openTx=无未决占用）");
    assert.equal((loadLedger(d)?.entries ?? []).filter((e) => e.kind === "killed-inflight").length, 0, "零 killed-inflight");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("④在途不改判：delivery-in-flight 且持有进程存活且在界内 → reconcile 判 delivering，item 不动", async () => {
  const { d, it } = bridgeRepo("lzy-qbridge-4-");
  try {
    makeDoneGoal(d);
    pushManualTx(d, {
      txId: "t-manual-1", itemId: it.id, goalSlug: "qbridge", phase: "open",
      openedAt: new Date().toISOString(), settledAt: null, limits: { wallMs: null, points: null },
      segments: [], note: "delivery-in-flight", deliveringSinceMs: Date.now(), deliveringPid: process.pid,
    });
    const rec = reconcileDispatch(d, {});
    assert.ok(rec.verdicts.some((v) => /delivering（交付链在途/.test(v.verdict)), JSON.stringify(rec.verdicts));
    assert.equal(itemOf(d, it.id).state, "ready", "在途期间 item 不得被改判");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑤死亡不死锁：超上界或持有进程已死 → reconcile 落账本判定+tx 收束+墙钟（观测上界）", async () => {
  const { d, it } = bridgeRepo("lzy-qbridge-5-");
  try {
    makeDoneGoal(d);
    pushManualTx(d, {
      txId: "t-manual-2", itemId: it.id, goalSlug: "qbridge", phase: "open",
      openedAt: new Date().toISOString(), settledAt: null, limits: { wallMs: null, points: null },
      segments: [], note: "delivery-in-flight",
      deliveringSinceMs: Date.now() - 12 * 60 * 1000, deliveringPid: process.pid, // 超上界（12min > 630s 上界）
    });
    const rec = reconcileDispatch(d, {});
    assert.ok(rec.verdicts.some((v) => /delivery-dead/.test(v.verdict)), JSON.stringify(rec.verdicts));
    const final = itemOf(d, it.id);
    assert.equal(final.state, "failed", "未收束端点 ⇒ failed+指路（不死锁）");
    assert.match(final.blockedReason, /^交付未竟：交付链进程死亡/);
    assert.equal(loadDispatch(d).txs.find((t) => t.txId === "t-manual-2").phase, "settled", "tx 诚实收束");
    assert.ok(loadLedger(d).entries.some((e) => e.dedupKey === "wall:t-manual-2:delivery"), "死亡路径墙钟在场");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑥交付追认：failed 条目经人工 act/readback 修复后 reconcile 翻 completed；deps 链解锁", async () => {
  const { d, it } = bridgeRepo("lzy-qbridge-6-", { endpoint: "B", delivery: { B: "./cb.md" } });
  try {
    // 先自然跑出「交付未竟」failed（PR 不合并）
    await runQueueDispatch(d, {}, { ...fakeDrive, ...fakeExt({ mergeWorks: false }) });
    assert.equal(itemOf(d, it.id).state, "failed");
    // 人工修复：直接以桥来源跑 B 链（模拟 lzy delivery act B 成功）
    const ext = fakeExt();
    // 需要 goal 处于 executing 或 done∧bound——当前 goal 已 done 且 delivery 已绑（本尝试）
    const rB = actDeliveryB(d, { origin: { kind: "queue", itemId: it.id, slug: "qbridge" }, repo: REPO, branch: "v031", base: "main", prTitle: "t", prBodyFile: "pb.md" }, ext);
    assert.equal(rB.intent.status, "done");
    const rec = reconcileDispatch(d, {});
    assert.ok(rec.verdicts.some((v) => /交付追认/.test(v.verdict)), JSON.stringify(rec.verdicts));
    const final = itemOf(d, it.id);
    assert.equal(final.state, "completed");
    assert.equal(final.completedEndpoint, "B");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑦基建分流：意图账本损坏 → item failed+「基建中止」（非交付失败）+tx killed+墙钟；再跑一轮终局不变", async () => {
  const { d, it } = bridgeRepo("lzy-qbridge-7-");
  try {
    const ip = join(d, ".lazyzcode", "delivery", "intents.json");
    mkdirSync(join(d, ".lazyzcode", "delivery"), { recursive: true });
    writeFileSync(ip, "{ 坏 JSON");
    const r = await runQueueDispatch(d, {}, { ...fakeDrive, ...fakeExt() });
    assert.equal(r.results[0].outcome, "failed", JSON.stringify(r));
    const final = itemOf(d, it.id);
    assert.equal(final.state, "failed");
    assert.match(final.blockedReason, /^基建中止：/);
    assert.match(final.blockedReason, /非交付失败/);
    assert.equal(loadDispatch(d).txs.at(-1).phase, "killed");
    assert.ok(loadLedger(d).entries.some((e) => String(e.note ?? "").includes("基建中止")), "基建中止也入墙钟");
    // 再跑一轮：终局不变（不翻 completed/不复活）
    const rec = reconcileDispatch(d, {});
    assert.equal(itemOf(d, it.id).state, "failed", "再跑一轮终局不变");
    assert.ok(!rec.verdicts.some((v) => /交付追认/.test(v.verdict)), "基建中止不得被追认");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑧幂等续跑：B 已 done（同来源）→ 重派时跳过 B 只补 C", async () => {
  const { d, it } = bridgeRepo("lzy-qbridge-8-");
  try {
    // 第一轮：drive 不完成步骤 → finish 拒 → item 回 ready（goal 仍 executing，契约已绑）
    const noopDrive = { ...fakeDrive, drive: async (cwd, opts) => { opts.segmentRecords.push({ sessionId: "s0", durationMs: 1, exitCode: 0 }); return { ok: true, cause: "noop" }; } };
    const r1 = await runQueueDispatch(d, {}, { ...noopDrive, ...fakeExt() });
    assert.equal(r1.results[0].outcome, "ready", JSON.stringify(r1));
    // 预置 B 的 done 意图（桥来源）
    const ext = fakeExt();
    const rB = actDeliveryB(d, { origin: { kind: "queue", itemId: it.id, slug: "qbridge" }, repo: REPO, branch: "v031", base: "main", prTitle: "t", prBodyFile: "pb.md" }, ext);
    assert.equal(rB.intent.status, "done");
    const callsBefore = ext._calls.length;
    // 第二轮：同一 item 重派（ready→dispatch）→ 链条应跳过 B（零 push/零 merge）只跑 C
    const ext2 = fakeExt();
    const r2 = await runQueueDispatch(d, {}, { ...fakeDrive, ...ext2 });
    assert.equal(r2.results[0].outcome, "completed", JSON.stringify(r2));
    assert.equal(itemOf(d, it.id).completedEndpoint, "C");
    assert.ok(!ext2._calls.some((x) => x.includes("pr merge")), `B 已 done 不得重发合并：${ext2._calls.join("|")}`);
    void callsBefore;
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑨HEAVY 计划改后拒绝：planHash 不符 → failed+「评审作废」、零 openTx（拒绝先于任何 goal 写）", async () => {
  const d = mkdtempSync(join(tmpdir(), "lzy-qbridge-9-"));
  try {
    const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
    g(["init", "-q"]);
    g(["config", "user.email", "t@l"]);
    g(["config", "user.name", "t"]);
    g(["config", "commit.gpgsign", "false"]);
    writeFileSync(join(d, "a.txt"), "a\n");
    writeFileSync(join(d, "lzy.project.json"), JSON.stringify({ schemaVersion: 1, capabilities: { check: [{ id: "smoke", argv: ["node", "-e", "process.exit(0)"], timeoutMs: 30000 }] } }));
    writeFileSync(join(d, "c-main.md"), "task: main A\nendpoint: A\nscope: .\nrecipe: none\n\n- [A1] x\n");
    writeFileSync(join(d, "p.md"), "- [N1] x\n- [F1] marker\n");
    g(["add", "-A"]);
    g(["commit", "-qm", "fixture"]);
    const planHash = createHash("sha256").update(readFileSync(join(d, "p.md"))).digest("hex");
    const it = addQueueItem(d, { title: "h", contractFile: join(d, "c-main.md"), planFile: join(d, "p.md"), goalSlug: "qh9", tier: "heavy", planReview: "plan-reviewer: PASS — ok", planHash });
    recordAuthorization(d, { kind: "approval", slug: "qh9", contractHash: it.contractHash, sessionId: "t", at: new Date().toISOString() });
    refreshQueue(d);
    writeFileSync(join(d, "p.md"), "- [N1] x（改）\n- [F1] marker\n"); // 计划改后
    const r = await runQueueDispatch(d, {}, { ...fakeDrive, ...fakeExt() });
    assert.match(r.stop ?? "", /派发前拒绝.*计划已改=评审作废/);
    assert.equal(itemOf(d, it.id).state, "failed");
    assert.equal((loadDispatch(d)?.txs ?? []).length, 0, "零 openTx（拒绝先于占用登记）");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑩HEAVY 入队透传：dispatch 注册后 goal.json tier=heavy/risk=med 读面（register+adopt 即采，无需 finish）", async () => {
  const d = mkdtempSync(join(tmpdir(), "lzy-qbridge-10-"));
  try {
    const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
    g(["init", "-q"]);
    g(["config", "user.email", "t@l"]);
    g(["config", "user.name", "t"]);
    g(["config", "commit.gpgsign", "false"]);
    writeFileSync(join(d, "a.txt"), "a\n");
    writeFileSync(join(d, "lzy.project.json"), JSON.stringify({ schemaVersion: 1, capabilities: { check: [{ id: "smoke", argv: ["node", "-e", "process.exit(0)"], timeoutMs: 30000 }] } }));
    writeFileSync(join(d, "c-main.md"), "task: main A\nendpoint: A\nscope: .\nrecipe: none\n\n- [A1] x\n");
    writeFileSync(join(d, "p.md"), "- [N1] x\n- [F1] marker\n");
    g(["add", "-A"]);
    g(["commit", "-qm", "fixture"]);
    const planHash = createHash("sha256").update(readFileSync(join(d, "p.md"))).digest("hex");
    const it = addQueueItem(d, { title: "h", contractFile: join(d, "c-main.md"), planFile: join(d, "p.md"), goalSlug: "qh10", tier: "heavy", risk: "med", planReview: "plan-reviewer: PASS — 零警告", planHash });
    recordAuthorization(d, { kind: "approval", slug: "qh10", contractHash: it.contractHash, sessionId: "t", at: new Date().toISOString() });
    refreshQueue(d);
    // 假 drive 不完成步骤（HEAVY finish 需 comparator——本轮只验 register+adopt 读面）
    const noopDrive = { ...fakeDrive, drive: async (cwd, opts) => { opts.segmentRecords.push({ sessionId: "s0", durationMs: 1, exitCode: 0 }); return { ok: true, cause: "noop" }; } };
    const r = await runQueueDispatch(d, {}, { ...noopDrive, ...fakeExt() });
    assert.equal(r.results[0].outcome, "ready", JSON.stringify(r));
    const gj = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8"));
    assert.equal(gj.slug, "qh10");
    assert.equal(gj.tier, "heavy", "HEAVY 须透传到 goal");
    assert.equal(gj.risk, "med", "risk 须透传到 goal");
    const st = spawnSync(process.execPath, [CLI, "loop", "status"], { cwd: d, encoding: "utf8", env: { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: "/nonexistent-lzy-suppressed" } });
    assert.match(`${st.stdout}`, /tier heavy|heavy/, "status 读面须可见 heavy");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
