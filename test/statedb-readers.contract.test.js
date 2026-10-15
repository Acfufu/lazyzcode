// P1 N3：双读者契约测试——JSON 路径（驱真 plugin/hooks/trigger.js，stdin）× DB 路径（驱自包含原型 hook-reader.mjs）
// 七支逐分支 A/B：approve / void（漂泊立据） / refuse-multi / candidates-no-match / write-failed / unreadable / none
// ＋一致性（dry 判定 vs readSnapshot 同读数）＋fail-open 纪律（零记录、exit 0、不阻断）。
// 已知输出面差异（如实断言）：none/unreadable 两侧不同构——JSON 侧落回既有诊断支（no-goal 文案），
// DB 侧给具名诊断/落回信号；共同不变量=零记录 ∧ exit 0（设计 §10 fail-open 家族纪律）。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { saveQueue } from "../core/queue.js";
import { openStore, ensureSchema, putQueueItem, readSnapshot, stateDbPath } from "../scripts/p1-sqlite-pilot/statedb.mjs";

const MAJOR = Number(process.versions.node.split(".")[0]);
const FLOOR_SKIP = MAJOR >= 24 ? false : `地板 Node ≥24.0.0（拍板 2026-10-16；22 线不入支持面）；当前 v${process.versions.node} 跳过`;
const HOME = mkdtempSync(join(tmpdir(), "lzy-readers-home-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
after(() => rmSync(HOME, { recursive: true, force: true }));

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const TRIGGER = join(ROOT, "plugin", "hooks", "trigger.js");
const READER = join(ROOT, "scripts", "p1-sqlite-pilot", "hook-reader.mjs");
const T = "2026-01-01T00:00:00.000Z";
const H_MAIN = "cd".repeat(32);
const sha = (s) => createHash("sha256").update(s).digest("hex");

function item(id, { delivery = null, state = "authorized", endpoint = "B" } = {}) {
  return {
    id, title: `夹具 ${id}`, goalSlug: `goal-${id}`, contractHash: H_MAIN, contractPath: "contracts/main.md",
    planPath: ".lazyzcode/plans/x.md", endpoint, state, createdAt: T, updatedAt: T, deps: [], delivery,
  };
}
function mk() { return mkdtempSync(join(tmpdir(), "lzy-readers-")); }

function buildCase({ items, contractBodies = {} }) {
  const dirJ = mk();
  const dirD = mk();
  for (const [rel, body] of Object.entries(contractBodies)) {
    for (const d of [dirJ, dirD]) {
      mkdirSync(dirname(join(d, rel)), { recursive: true });
      writeFileSync(join(d, rel), body);
    }
  }
  saveQueue(dirJ, { queueVersion: 1, items });
  const db = openStore(stateDbPath(dirD));
  ensureSchema(db);
  for (const it of items) putQueueItem(db, it);
  db.close();
  return { dirJ, dirD, db: openStore(stateDbPath(dirD), { readOnly: true }) };
}

function run(side, dir, prompt, { apply = true } = {}) {
  const args = side === "json" ? [TRIGGER] : [READER, ...(apply ? ["--apply"] : [])];
  const r = spawnSync(process.execPath, args, {
    input: JSON.stringify({ prompt, cwd: dir, session_id: "ab" }),
    encoding: "utf8", timeout: 30000,
    env: { ...process.env, HOME, USERPROFILE: HOME },
  });
  let parsed = null;
  try { parsed = JSON.parse((r.stdout ?? "").trim() || "null"); } catch {}
  return { status: r.status, raw: (r.stdout ?? "").trim(), parsed };
}
function records(dir) {
  try { return readdirSync(join(dir, ".lazyzcode", "authorizations")).filter((f) => !f.startsWith(".")); } catch { return []; }
}
function record(dir, name) {
  return JSON.parse(readFileSync(join(dir, ".lazyzcode", "authorizations", name), "utf8"));
}

test("A/B①approve：判定与记录形状两侧一致", { skip: FLOOR_SKIP }, () => {
  const body = "task: delivery B\nendpoint: B\n";
  const { dirJ, dirD } = buildCase({
    items: [item("q-ab-1", { delivery: { B: { path: "contracts/b.md", hash: sha(body) } } })],
    contractBodies: { "contracts/b.md": body },
  });
  try {
    const short = sha(body).slice(0, 8);
    const j = run("json", dirJ, `批准 ${short}`);
    const d = run("db", dirD, `批准 ${short}`);
    assert.equal(j.status, 0);
    assert.equal(d.status, 0);
    assert.equal(j.parsed.additionalContext, d.parsed.additionalContext); // 文案逐字同
    assert.equal(j.parsed.additionalContext.includes("Human approval recorded for delivery B of queue item q-ab-1"), true);
    assert.equal(records(dirJ).length, 1);
    assert.equal(records(dirD).length, 1);
    const rj = record(dirJ, records(dirJ)[0]);
    const rd = record(dirD, records(dirD)[0]);
    assert.deepEqual(Object.keys(rj).sort(), Object.keys(rd).sort());
    assert.deepEqual({ version: rd.version, kind: rd.kind, slug: rd.slug, contractHash: rd.contractHash }, { version: 1, kind: "approval", slug: "goal-q-ab-1", contractHash: sha(body) });
  } finally { rmSync(dirJ, { recursive: true, force: true }); rmSync(dirD, { recursive: true, force: true }); }
});

test("A/B②void：契约入队后漂移=短码作废，两侧零记录", { skip: FLOOR_SKIP }, () => {
  const { dirJ, dirD } = buildCase({
    items: [item("q-ab-2", { delivery: { B: { path: "contracts/b.md", hash: sha("original") } } })],
    contractBodies: { "contracts/b.md": "tampered-after-enqueue\n" },
  });
  try {
    const short = sha("original").slice(0, 8);
    const j = run("json", dirJ, `批准 ${short}`);
    const d = run("db", dirD, `批准 ${short}`);
    assert.equal(j.parsed.additionalContext, d.parsed.additionalContext);
    assert.match(j.parsed.additionalContext, /short code is void/);
    assert.equal(records(dirJ).length, 0);
    assert.equal(records(dirD).length, 0);
  } finally { rmSync(dirJ, { recursive: true, force: true }); rmSync(dirD, { recursive: true, force: true }); }
});

test("A/B③refuse-multi：同短码多命中=拒猜，两侧零记录", { skip: FLOOR_SKIP }, () => {
  const h1 = "deadbeef" + "a".repeat(56);
  const h2 = "deadbeef" + "b".repeat(56);
  const { dirJ, dirD } = buildCase({
    items: [
      item("q-ab-3a", { delivery: { B: { path: "contracts/a.md", hash: h1 } } }),
      item("q-ab-3b", { delivery: { B: { path: "contracts/b.md", hash: h2 } } }),
    ],
  });
  try {
    const j = run("json", dirJ, "批准 deadbeef");
    const d = run("db", dirD, "批准 deadbeef");
    assert.equal(j.parsed.additionalContext, d.parsed.additionalContext);
    assert.match(j.parsed.additionalContext, /refusing to guess/);
    assert.equal(records(dirJ).length, 0);
    assert.equal(records(dirD).length, 0);
  } finally { rmSync(dirJ, { recursive: true, force: true }); rmSync(dirD, { recursive: true, force: true }); }
});

test("A/B④candidates-no-match：有候选零命中=诊断列短码，两侧零记录", { skip: FLOOR_SKIP }, () => {
  const h = "12345678" + "a".repeat(56);
  const { dirJ, dirD } = buildCase({
    items: [item("q-ab-4", { delivery: { B: { path: "contracts/b.md", hash: h } } })],
  });
  try {
    const j = run("json", dirJ, "批准 87654321");
    const d = run("db", dirD, "批准 87654321");
    assert.equal(j.parsed.additionalContext, d.parsed.additionalContext);
    assert.match(j.parsed.additionalContext, /No pending approval matches this code/);
    assert.equal(records(dirJ).length, 0);
    assert.equal(records(dirD).length, 0);
  } finally { rmSync(dirJ, { recursive: true, force: true }); rmSync(dirD, { recursive: true, force: true }); }
});

test("A/B⑤write-failed：记录写失败=零记录且门保持关闭，两侧一致", { skip: FLOOR_SKIP }, () => {
  const body = "task: delivery B\n";
  const { dirJ, dirD } = buildCase({
    items: [item("q-ab-5", { delivery: { B: { path: "contracts/b.md", hash: sha(body) } } })],
    contractBodies: { "contracts/b.md": body },
  });
  try {
    // 用文件占位 authorizations 目录路径 → mkdirSync 失败（两侧同一构造）
    for (const d of [dirJ, dirD]) {
      mkdirSync(join(d, ".lazyzcode"), { recursive: true });
      writeFileSync(join(d, ".lazyzcode", "authorizations"), "blocked\n");
    }
    const short = sha(body).slice(0, 8);
    const j = run("json", dirJ, `批准 ${short}`);
    const d = run("db", dirD, `批准 ${short}`);
    assert.equal(j.parsed.additionalContext, d.parsed.additionalContext);
    assert.match(j.parsed.additionalContext, /could not be written/);
    assert.match(j.parsed.additionalContext, /queue gate stays closed/);
    assert.equal(records(dirJ).length, 0);
    assert.equal(records(dirD).length, 0);
  } finally { rmSync(dirJ, { recursive: true, force: true }); rmSync(dirD, { recursive: true, force: true }); }
});

test("A/B⑥unreadable：库/文件损坏=零记录+exit 0；DB 侧具名诊断（JSON 侧落既有诊断支）", { skip: FLOOR_SKIP }, () => {
  const body = "task: delivery B\n";
  const { dirJ, dirD } = buildCase({
    items: [item("q-ab-6", { delivery: { B: { path: "contracts/b.md", hash: sha(body) } } })],
    contractBodies: { "contracts/b.md": body },
  });
  try {
    writeFileSync(join(dirJ, ".lazyzcode", "queue", "queue.json"), "{not json");
    writeFileSync(stateDbPath(dirD), "not a database at all");
    const short = sha(body).slice(0, 8);
    const j = run("json", dirJ, `批准 ${short}`);
    const d = run("db", dirD, `批准 ${short}`);
    assert.equal(j.status, 0);
    assert.equal(d.status, 0);
    assert.equal(d.parsed.branch, "unreadable");
    assert.match(d.parsed.additionalContext, /nothing was recorded/);
    assert.match(j.parsed.additionalContext, /no goal loop is registered/); // JSON 侧 fail-open 落既有诊断支（差异如实断言）
    assert.equal(records(dirJ).length, 0);
    assert.equal(records(dirD).length, 0);
  } finally { rmSync(dirJ, { recursive: true, force: true }); rmSync(dirD, { recursive: true, force: true }); }
});

test("A/B⑦none：零候选=落回信号（DB {}），两侧零记录+exit 0", { skip: FLOOR_SKIP }, () => {
  const { dirJ, dirD } = buildCase({ items: [item("q-ab-7", { endpoint: "A" })] }); // A 无 delivery=无候选
  try {
    const j = run("json", dirJ, "批准 11112222");
    const d = run("db", dirD, "批准 11112222");
    assert.equal(j.status, 0);
    assert.equal(d.status, 0);
    assert.equal(d.raw, "{}"); // 落回信号
    assert.match(j.parsed.additionalContext, /no goal loop is registered/);
    assert.equal(records(dirJ).length, 0);
    assert.equal(records(dirD).length, 0);
  } finally { rmSync(dirJ, { recursive: true, force: true }); rmSync(dirD, { recursive: true, force: true }); }
});

test("A/B⑧一致性：dry 判定与 readSnapshot 同读数（且 dry 零写）", { skip: FLOOR_SKIP }, () => {
  const body = "task: delivery B\n";
  const { dirD, db } = buildCase({
    items: [item("q-ab-8", { delivery: { B: { path: "contracts/b.md", hash: sha(body) } } })],
    contractBodies: { "contracts/b.md": body },
  });
  try {
    const short = sha(body).slice(0, 8);
    const d = run("db", dirD, `批准 ${short}`, { apply: false }); // dry
    assert.equal(d.parsed.branch, "approve");
    assert.equal(d.parsed.dry, true);
    assert.equal(records(dirD).length, 0); // dry 零写
    const snap = readSnapshot(db);
    assert.equal(d.parsed.itemId, snap.items[0].id);
    assert.equal(d.parsed.ep, "B");
    assert.equal(d.parsed.hash, snap.items[0].delivery.B.hash); // 与 readSnapshot 同读数一致
    assert.equal(d.parsed.hash, sha(body));
  } finally { rmSync(dirD, { recursive: true, force: true }); }
});
