import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import * as cost from "../core/cost.js";
import { SANDBOX_USAGE_LOCK, withSandboxUsageLock } from "../core/sandbox-usage-lock.js";

const url = new URL("../core/cost.js", import.meta.url).href;
const now = new Date("2026-10-25T04:00:00Z");
function record(tokens = 10, watermark = "w1", instance = "i1") {
  return { runId: "same.a1.r1", harvest: { instance, watermark }, metering: { points: tokens / 10, usage: [{ provider: "fixture", model: "fixture", inputTokens: tokens, cacheReadTokens: 0, outputTokens: 0, points: tokens / 10 }] } };
}
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "lzy-usage-reliability-"));
  const prior = process.env.LZY_SANDBOX_USAGE_DIR;
  process.env.LZY_SANDBOX_USAGE_DIR = dir;
  t.after(() => { if (prior === undefined) delete process.env.LZY_SANDBOX_USAGE_DIR; else process.env.LZY_SANDBOX_USAGE_DIR = prior; rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  return dir;
}
async function parallelAppend(dir, records, method = "appendSandboxUsage") {
  const file = join(dir, "worker.mjs");
  writeFileSync(file, `import * as cost from ${JSON.stringify(url)};process.send('ready');process.once('message',r=>{try{process.send({appended:cost[${JSON.stringify(method)}](r.project,r.record,{now:new Date('2026-10-25T04:00:00Z')})});}catch(e){process.send({error:e.message});}process.disconnect();});setTimeout(()=>process.exit(2),15000).unref();`);
  const workers = records.map(() => {
    const child = spawn(process.execPath, [file], { env: { ...process.env, LZY_SANDBOX_USAGE_DIR: dir }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
    const ready = once(child, "message");
    const exited = once(child, "exit");
    return { child, ready, exited };
  });
  let timer;
  const limit = new Promise((_, j) => { timer = setTimeout(() => j(new Error("worker barrier timeout")), 20000); });
  try {
    await Promise.race([Promise.all(workers.map(w => w.ready)), limit]);
    const done = workers.map(w => once(w.child, "message"));
    workers.forEach((w, i) => w.child.send(records[i]));
    const replies = (await Promise.race([Promise.all(done), limit])).map(([r]) => r);
    await Promise.all(workers.map(w => w.exited));
    for (const r of replies) assert.equal(r.error, undefined);
    return replies;
  } finally { clearTimeout(timer); for (const w of workers) if (w.child.exitCode === null) w.child.kill("SIGKILL"); await Promise.allSettled(workers.map(w => w.exited)); }
}

test("F2: four OS processes append one event exactly once; cross-project events survive", async t => {
  const dir = fixture(t);
  writeFileSync(join(dir, "2026-10.jsonl"), Array.from({ length: 2000 }, (_, i) => JSON.stringify({ kind: "review", project: "seed", runId: `s${i}`, points: 0, usage: [] })).join("\n") + "\n");
  const replies = await parallelAppend(dir, Array.from({ length: 4 }, () => ({ project: "p", record: record() })));
  assert.equal(replies.filter(r => r.appended).length, 1);
  assert.equal(cost.readSandboxUsageLines().filter(r => r.project === "p").length, 1);
  await parallelAppend(dir, ["p2", "p3"].map(project => ({ project, record: record() })));
  assert.equal(cost.readSandboxUsageLines().filter(r => r.runId === "same.a1.r1").length, 3);
});

test("F3: project/instance/watermark identities isolate spool; repeated event is stable", t => {
  const dir = fixture(t);
  for (const [p, r] of [["p/a", record()], ["p_a", record()], ["p/a", record(10, "w1", "i2")], ["p/a", record(20, "w2")]]) assert.equal(cost.spoolPendingAppend(p, r, new Error("offline failure")), true);
  assert.equal(cost.spoolPendingAppend("p/a", record(), new Error("retry failure")), true);
  assert.equal(cost.readSandboxUsageWithDiag().diag.pending, 4);
  const receipts = readdirSync(dir).filter(n => n.startsWith(".spool-pending-")).map(n => JSON.parse(readFileSync(join(dir, n), "utf8")));
  assert.equal(receipts.filter(r => r.project === "p_a").length, 1);
  writeFileSync(join(dir, ".spool-pending-legacy.json"), JSON.stringify({ project: "legacy", runId: "old" }));
  assert.equal(cost.readSandboxUsageWithDiag().diag.pending, 5);
});

test("snapshot apply recomputes under lock for old/new watermarks and runner interleavings", async t => {
  fixture(t);
  assert.equal(typeof cost.appendSandboxUsageSnapshot, "function");
  for (const [project, order] of [["old-first", [100, 150, 200]], ["new-first", [200, 100, 150]]]) {
    for (const tok of order) cost.appendSandboxUsageSnapshot(project, record(tok, tok === 150 ? null : `w${tok}`), { now });
    const rows = cost.readSandboxUsageLines().filter(r => r.project === project);
    assert.equal(rows.reduce((s, r) => s + r.usage[0].inputTokens, 0), 200);
    assert.equal(rows.reduce((s, r) => s + r.points, 0), 20);
  }
  const dir = process.env.LZY_SANDBOX_USAGE_DIR;
  await parallelAppend(dir, [100, 150, 200, 200].map(tok => ({ project: "concurrent", record: record(tok, `w${tok}`) })), "appendSandboxUsageSnapshot");
  assert.equal(cost.readSandboxUsageLines().filter(r => r.project === "concurrent").reduce((s, r) => s + r.points, 0), 20);
});

test("cross-month replay and distinct equal-consumption instances preserve history", t => {
  fixture(t);
  assert.equal(cost.appendSandboxUsage("p", record(), { now }), true);
  assert.equal(cost.appendSandboxUsage("p", record(), { now: new Date("2026-11-01T00:00:00Z") }), false);
  assert.equal(cost.appendSandboxUsage("p", record(10, "w1", "i2"), { now }), true);
  assert.equal(cost.readSandboxUsageLines().reduce((s, r) => s + r.points, 0), 2);
});

test("corrupt and partial ledger lines block writes, preserve original bytes and remain visible", t => {
  const dir = fixture(t), file = join(dir, "2026-10.jsonl");
  const original = '{"kind":"review"';
  writeFileSync(file, original);
  assert.throws(() => cost.appendSandboxUsage("p", record(), { now }), /完整|损坏|corrupt/i);
  assert.equal(readFileSync(file, "utf8"), original);
  assert.equal(cost.readSandboxUsageWithDiag().diag.corruptLines, 1);
});

test("snapshot legacy subtraction preserves old bytes and missing usage is not a zero row", t => {
  const dir = fixture(t), file = join(dir, "2026-10.jsonl");
  cost.appendSandboxUsage("p", { ...record(50), harvest: null }, { now });
  const before = readFileSync(file, "utf8");
  assert.equal(typeof cost.appendSandboxUsageSnapshot, "function");
  assert.equal(cost.appendSandboxUsageSnapshot("p", record(100), { now }), true);
  assert.ok(readFileSync(file, "utf8").startsWith(before));
  assert.equal(cost.readSandboxUsageLines().reduce((s, r) => s + r.points, 0), 10);
  assert.equal(cost.appendSandboxUsageSnapshot("p", { runId: "absent" }, { now }), false);
});

test("lock survives contention, releases after SIGKILL, and cannot be reentered", async t => {
  const dir = fixture(t), file = join(dir, "holder.mjs");
  // Create the coordination inode once, then the independent process owns it.
  withSandboxUsageLock(dir, () => undefined);
  writeFileSync(file, `import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(${JSON.stringify(join(dir, SANDBOX_USAGE_LOCK))});db.exec('BEGIN IMMEDIATE');process.send('held');setInterval(()=>{},1000);setTimeout(()=>process.exit(2),15000);`);
  const child = spawn(process.execPath, [file], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const exited = once(child, "exit");
  try {
    await once(child, "message");
    assert.throws(() => cost.appendSandboxUsage("p", record(), { now, lockTimeoutMs: 30 }), /锁忙/);
    assert.equal(child.exitCode, null, "live lock owner must not be killed/stolen");
    child.kill("SIGKILL");
    await exited;
    assert.equal(cost.appendSandboxUsage("p", record(), { now }), true);
    assert.throws(() => withSandboxUsageLock(dir, () => cost.appendSandboxUsage("nested", record())), /不可重入/);
    assert.equal(cost.appendSandboxUsage("after-error", record(), { now }), true);
  } finally { if (child.exitCode === null) child.kill("SIGKILL"); await exited; }
});

test("writer death after durable append and before acknowledgement does not double count", async t => {
  const dir = fixture(t), file = join(dir, "lost-ack.mjs");
  writeFileSync(file, `import {appendSandboxUsage} from ${JSON.stringify(url)};appendSandboxUsage('p',${JSON.stringify(record())},{now:new Date(${JSON.stringify(now.toISOString())})});process.kill(process.pid,'SIGKILL');`);
  const child = spawn(process.execPath, [file], { env: { ...process.env, LZY_SANDBOX_USAGE_DIR: dir }, stdio: "ignore" });
  await once(child, "exit");
  assert.equal(cost.appendSandboxUsage("p", record(), { now }), false);
  assert.equal(cost.readSandboxUsageLines().length, 1);
});

test("inconsistent cumulative snapshots fail visibly instead of inventing mixed deltas", t => {
  fixture(t);
  cost.appendSandboxUsageSnapshot("p", record(100), { now });
  const mixed = record(100, "w2");
  mixed.metering.usage[0].model = "different-model";
  assert.throws(() => cost.appendSandboxUsageSnapshot("p", mixed, { now }), /不单调/);
  assert.equal(cost.readSandboxUsageLines().length, 1);
});

test("growing session sets subtract prior subsets; disjoint runs remain distinct; ambiguity blocks", t => {
  fixture(t);
  const snapshot = (ids, tokens) => ({ ...record(tokens, `w${tokens}`, cost.instanceDigest(ids)), harvest: { instance: cost.instanceDigest(ids), watermark: `w${tokens}`, sessionIds: ids } });
  cost.appendSandboxUsageSnapshot("p", snapshot(["s1"], 100), { now });
  cost.appendSandboxUsageSnapshot("p", snapshot(["s1", "s2"], 200), { now });
  assert.equal(cost.readSandboxUsageLines().reduce((s, r) => s + r.points, 0), 20);
  assert.throws(() => cost.appendSandboxUsageSnapshot("p", snapshot(["s1"], 150), { now }), /完整快照/);
  cost.appendSandboxUsageSnapshot("p", snapshot(["new-session"], 200), { now });
  assert.equal(cost.readSandboxUsageLines().reduce((s, r) => s + r.points, 0), 40);
  cost.appendSandboxUsage("legacy", record(), { now });
  assert.throws(() => cost.appendSandboxUsageSnapshot("legacy", snapshot(["unknown"], 50), { now }), /历史实例缺会话集合/);
});

test("receipts without provable event identity never overwrite each other", t => {
  fixture(t);
  cost.spoolPendingAppend("p", { runId: "reused" }, new Error("first"));
  cost.spoolPendingAppend("p", { runId: "reused" }, new Error("second"));
  assert.equal(cost.readSandboxUsageWithDiag().diag.pending, 2);
});

test("an unidentified snapshot cannot recount an identified run; identity conflicts cannot drop growth", t => {
  fixture(t);
  cost.appendSandboxUsageSnapshot("p", record(100), { now });
  assert.throws(() => cost.appendSandboxUsageSnapshot("p", record(150, "w2", null), { now }), /缺来源实例/);
  assert.throws(() => cost.appendSandboxUsageSnapshot("p", record(150), { now }), /事件身份.*增长/);
  assert.equal(cost.readSandboxUsageLines().reduce((s, r) => s + r.points, 0), 10);
  assert.equal(cost.appendSandboxUsageSnapshot("p", record(150, "w2"), { now }), true);
  assert.equal(cost.readSandboxUsageLines().reduce((s, r) => s + r.points, 0), 15);
});

test("concurrent spool writers preserve distinct projects and one receipt per explicit event", async t => {
  const dir = fixture(t);
  await parallelAppend(dir, ["p/a", "p_a", "p/a", "third"].map(project => ({ project, record: record() })), "spoolPendingAppend");
  assert.equal(cost.readSandboxUsageWithDiag().diag.pending, 3);
  const receipts = readdirSync(dir).filter(n => n.startsWith(".spool-pending-")).map(n => JSON.parse(readFileSync(join(dir, n), "utf8")));
  assert.deepEqual(receipts.map(r => r.project).sort(), ["p/a", "p_a", "third"]);
});
