// P2 N6：钩子权威读路径双后端 A/B——两侧同驱**生产 plugin/hooks/trigger.js**（stdin）。
// JSON 工作区（无库；queue.json checksum 家族）× DB 工作区（state.sqlite 在场=DB 权威）。
// 七支判定族（approve/void/refuse-multi/candidates-no-match/write-failed/unreadable/none）
// + 全失败分支 exit 码断言（跨平台）+ write-failed 可读不可写构造（POSIX chmod 555，win32
// 具名 skip，r2-F3：零记录断言落在真实可读目录上）+ DB 专项两支（schema_version 异版本/
// 行级 delivery_json 坏行=当不可读）。已知同构面：approve/void/refuse-multi/candidates/
// write-failed 五支文案逐字同；none 支两侧同落生产 no-goal 诊断支（pilot reader 的 {}
// 落回信号随之退役）。已知差异面（如实断言）：unreadable 支 JSON 侧静默 fail-open 落既有
// 诊断支，DB 侧零记录+具名诊断（库在场即 DB 权威，不回落旧 JSON 批准——设计 §10）。
// 「模块缺席」与「major<24」两支经本地 nvm 22.x 实跑取证（F4；自动化腿在 <24 具名 skip）。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { saveQueue } from "../core/queue.js";
import { openStore, ensureSchema, putQueueItem, readSnapshot, stateDbPath, SCHEMA_VERSION } from "../core/statedb.js";

const MAJOR = Number(process.versions.node.split(".")[0]);
const FLOOR_SKIP = MAJOR >= 24 ? false : `地板 Node ≥24.0.0（拍板 2026-10-16；22 线不入支持面）；当前 v${process.versions.node} 跳过`;
const WIN32_SKIP = process.platform === "win32" ? "win32 权限模型不适用（r2-F3：chmod 555 构造 POSIX-only，记档）" : false;
const HOME = mkdtempSync(join(tmpdir(), "lzy-readers-home-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
after(() => rmSync(HOME, { recursive: true, force: true }));

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const TRIGGER = join(ROOT, "plugin", "hooks", "trigger.js");
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

// 双工作区同数据构造：dirJ=JSON 家族；dirD=state.sqlite（同条目经 putQueueItem）
function buildCase({ items, contractBodies = {} }) {
  const dirJ = mk();
  const dirD = mk();
  for (const [rel, body] of Object.entries(contractBodies)) {
    for (const d of [dirJ, dirD]) {
      mkdirSync(join(d, dirname(rel)), { recursive: true });
      writeFileSync(join(d, rel), body);
    }
  }
  saveQueue(dirJ, { queueVersion: 1, items });
  const db = openStore(stateDbPath(dirD));
  ensureSchema(db);
  for (const it of items) putQueueItem(db, it);
  db.close();
  return { dirJ, dirD };
}

// 生产 trigger.js stdin 驱动（两侧同一入口；hook 契约恒 exit 0）
function run(dir, prompt) {
  const r = spawnSync(process.execPath, [TRIGGER], {
    input: JSON.stringify({ prompt, cwd: dir, session_id: "ab" }),
    encoding: "utf8", timeout: 30000,
    env: { ...process.env, HOME, USERPROFILE: HOME },
  });
  let parsed = null;
  try { parsed = JSON.parse((r.stdout ?? "").trim() || "null"); } catch {}
  return { status: r.status, raw: (r.stdout ?? "").trim(), parsed, stderr: (r.stderr ?? "").trim() };
}
function records(dir) {
  try { return readdirSync(join(dir, ".lazyzcode", "authorizations")).filter((f) => !f.startsWith(".")); } catch { return []; }
}
function record(dir, name) {
  return JSON.parse(readFileSync(join(dir, ".lazyzcode", "authorizations", name), "utf8"));
}
const rmCase = (dirJ, dirD) => {
  for (const d of [dirJ, dirD]) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
};

test("A/B①approve：判定与记录形状两侧一致（exit 0）", { skip: FLOOR_SKIP }, () => {
  const body = "task: delivery B\nendpoint: B\n";
  const { dirJ, dirD } = buildCase({
    items: [item("q-ab-1", { delivery: { B: { path: "contracts/b.md", hash: sha(body) } } })],
    contractBodies: { "contracts/b.md": body },
  });
  try {
    const short = sha(body).slice(0, 8);
    const j = run(dirJ, `批准 ${short}`);
    const d = run(dirD, `批准 ${short}`);
    assert.equal(j.status, 0, j.stderr);
    assert.equal(d.status, 0, d.stderr);
    assert.equal(j.parsed.additionalContext, d.parsed.additionalContext); // 文案逐字同
    assert.equal(j.parsed.additionalContext.includes("Human approval recorded for delivery B of queue item q-ab-1"), true);
    assert.equal(records(dirJ).length, 1);
    assert.equal(records(dirD).length, 1);
    const rj = record(dirJ, records(dirJ)[0]);
    const rd = record(dirD, records(dirD)[0]);
    assert.deepEqual(Object.keys(rj).sort(), Object.keys(rd).sort());
    assert.deepEqual({ version: rd.version, kind: rd.kind, slug: rd.slug, contractHash: rd.contractHash }, { version: 1, kind: "approval", slug: "goal-q-ab-1", contractHash: sha(body) });
  } finally { rmCase(dirJ, dirD); }
});

test("A/B②void：契约入队后漂移=短码作废，两侧零记录（exit 0）", { skip: FLOOR_SKIP }, () => {
  const { dirJ, dirD } = buildCase({
    items: [item("q-ab-2", { delivery: { B: { path: "contracts/b.md", hash: sha("original") } } })],
    contractBodies: { "contracts/b.md": "tampered-after-enqueue\n" },
  });
  try {
    const short = sha("original").slice(0, 8);
    const j = run(dirJ, `批准 ${short}`);
    const d = run(dirD, `批准 ${short}`);
    assert.equal(j.status, 0);
    assert.equal(d.status, 0);
    assert.equal(j.parsed.additionalContext, d.parsed.additionalContext);
    assert.match(j.parsed.additionalContext, /short code is void/);
    assert.equal(records(dirJ).length, 0);
    assert.equal(records(dirD).length, 0);
  } finally { rmCase(dirJ, dirD); }
});

test("A/B③refuse-multi：同短码多命中=拒猜，两侧零记录（exit 0）", { skip: FLOOR_SKIP }, () => {
  const h1 = "deadbeef" + "a".repeat(56);
  const h2 = "deadbeef" + "b".repeat(56);
  const { dirJ, dirD } = buildCase({
    items: [
      item("q-ab-3a", { delivery: { B: { path: "contracts/a.md", hash: h1 } } }),
      item("q-ab-3b", { delivery: { B: { path: "contracts/b.md", hash: h2 } } }),
    ],
  });
  try {
    const j = run(dirJ, "批准 deadbeef");
    const d = run(dirD, "批准 deadbeef");
    assert.equal(j.status, 0);
    assert.equal(d.status, 0);
    assert.equal(j.parsed.additionalContext, d.parsed.additionalContext);
    assert.match(j.parsed.additionalContext, /refusing to guess/);
    assert.equal(records(dirJ).length, 0);
    assert.equal(records(dirD).length, 0);
  } finally { rmCase(dirJ, dirD); }
});

test("A/B④candidates-no-match：有候选零命中=诊断列短码，两侧零记录（exit 0）", { skip: FLOOR_SKIP }, () => {
  const h = "12345678" + "a".repeat(56);
  const { dirJ, dirD } = buildCase({
    items: [item("q-ab-4", { delivery: { B: { path: "contracts/b.md", hash: h } } })],
  });
  try {
    const j = run(dirJ, "批准 87654321");
    const d = run(dirD, "批准 87654321");
    assert.equal(j.status, 0);
    assert.equal(d.status, 0);
    assert.equal(j.parsed.additionalContext, d.parsed.additionalContext);
    assert.match(j.parsed.additionalContext, /No pending approval matches this code/);
    assert.equal(records(dirJ).length, 0);
    assert.equal(records(dirD).length, 0);
  } finally { rmCase(dirJ, dirD); }
});

test("A/B⑤write-failed（跨平台构造）：authorizations 路径被文件占位=写失败，两侧同文案零记录", { skip: FLOOR_SKIP }, () => {
  const body = "task: delivery B\n";
  const { dirJ, dirD } = buildCase({
    items: [item("q-ab-5", { delivery: { B: { path: "contracts/b.md", hash: sha(body) } } })],
    contractBodies: { "contracts/b.md": body },
  });
  try {
    for (const d of [dirJ, dirD]) {
      mkdirSync(join(d, ".lazyzcode"), { recursive: true });
      writeFileSync(join(d, ".lazyzcode", "authorizations"), "blocked\n");
    }
    const short = sha(body).slice(0, 8);
    const j = run(dirJ, `批准 ${short}`);
    const d = run(dirD, `批准 ${short}`);
    assert.equal(j.status, 0);
    assert.equal(d.status, 0);
    assert.equal(j.parsed.additionalContext, d.parsed.additionalContext);
    assert.match(j.parsed.additionalContext, /could not be written/);
    assert.match(j.parsed.additionalContext, /queue gate stays closed/);
    assert.equal(records(dirJ).length, 0);
    assert.equal(records(dirD).length, 0);
  } finally { rmCase(dirJ, dirD); }
});

test("A/B⑤b write-failed（r2-F3 可读不可写构造）：authDir chmod 555=真实可读目录上零记录", { skip: FLOOR_SKIP ?? WIN32_SKIP }, () => {
  const body = "task: delivery B\n";
  const { dirJ, dirD } = buildCase({
    items: [item("q-ab-5b", { delivery: { B: { path: "contracts/b.md", hash: sha(body) } } })],
    contractBodies: { "contracts/b.md": body },
  });
  try {
    for (const d of [dirJ, dirD]) {
      const authDir = join(d, ".lazyzcode", "authorizations");
      mkdirSync(authDir, { recursive: true });
      chmodSync(authDir, 0o555); // 可读不可写（POSIX）；readdir 断言真实落在可读目录上
    }
    const short = sha(body).slice(0, 8);
    const j = run(dirJ, `批准 ${short}`);
    const d = run(dirD, `批准 ${short}`);
    assert.equal(j.status, 0);
    assert.equal(d.status, 0);
    assert.equal(j.parsed.additionalContext, d.parsed.additionalContext);
    assert.match(j.parsed.additionalContext, /could not be written/);
    // 零记录断言落在真实可读目录（readdir 成功且为空——非 readdir 吞错恒真）
    assert.deepEqual(records(dirJ), []);
    assert.deepEqual(records(dirD), []);
  } finally {
    for (const d of [dirJ, dirD]) {
      try { chmodSync(join(d, ".lazyzcode", "authorizations"), 0o755); } catch {}
    }
    rmCase(dirJ, dirD);
  }
});

test("A/B⑥unreadable：库/文件损坏=零记录+exit 0；DB 侧具名诊断（JSON 侧落既有诊断支——差异如实断言）", { skip: FLOOR_SKIP }, () => {
  const body = "task: delivery B\n";
  const { dirJ, dirD } = buildCase({
    items: [item("q-ab-6", { delivery: { B: { path: "contracts/b.md", hash: sha(body) } } })],
    contractBodies: { "contracts/b.md": body },
  });
  try {
    writeFileSync(join(dirJ, ".lazyzcode", "queue", "queue.json"), "{not json");
    writeFileSync(stateDbPath(dirD), "not a database at all");
    const short = sha(body).slice(0, 8);
    const j = run(dirJ, `批准 ${short}`);
    const d = run(dirD, `批准 ${short}`);
    assert.equal(j.status, 0);
    assert.equal(d.status, 0);
    assert.match(d.parsed.additionalContext, /state\.sqlite 在场但读面不可用/); // 具名诊断
    assert.match(d.parsed.additionalContext, /不回落旧 JSON 批准/); // 不回落纪律在文案
    assert.match(j.parsed.additionalContext, /no goal loop is registered/); // JSON 侧 fail-open 静默落回
    assert.equal(records(dirJ).length, 0);
    assert.equal(records(dirD).length, 0);
  } finally { rmCase(dirJ, dirD); }
});

test("A/B⑥b schema_version 异版本=当不可读：具名诊断+零记录（DB 专项）", { skip: FLOOR_SKIP }, () => {
  const body = "task: delivery B\n";
  const { dirJ, dirD } = buildCase({
    items: [item("q-ab-6b", { delivery: { B: { path: "contracts/b.md", hash: sha(body) } } })],
    contractBodies: { "contracts/b.md": body },
  });
  try {
    let db = openStore(stateDbPath(dirD));
    db.prepare("UPDATE meta SET value='2' WHERE key='schema_version'").run();
    db.close();
    const short = sha(body).slice(0, 8);
    const d = run(dirD, `批准 ${short}`);
    assert.equal(d.status, 0);
    assert.match(d.parsed.additionalContext, /schema_version=2 不识别/);
    assert.deepEqual(records(dirD), []);
  } finally { rmCase(dirJ, dirD); }
});

test("A/B⑥c 行级坏行（delivery_json 损坏）=整面当不可读：具名诊断+零记录（DB 专项，fail-closed）", { skip: FLOOR_SKIP }, () => {
  const body = "task: delivery B\n";
  const { dirJ, dirD } = buildCase({
    items: [
      item("q-ab-6c-ok", { delivery: { B: { path: "contracts/b.md", hash: sha(body) } } }),
      item("q-ab-6c-bad", { delivery: { B: { path: "contracts/b.md", hash: sha(body) } } }),
    ],
    contractBodies: { "contracts/b.md": body },
  });
  try {
    let db = openStore(stateDbPath(dirD));
    db.prepare("UPDATE queue_items SET delivery_json='{corrupt' WHERE id='q-ab-6c-bad'").run();
    db.close();
    const short = sha(body).slice(0, 8);
    const d = run(dirD, `批准 ${short}`);
    assert.equal(d.status, 0);
    assert.match(d.parsed.additionalContext, /行级 delivery_json 损坏/);
    assert.deepEqual(records(dirD), []); // 坏行=整面不可读：好行命中也不写（fail-closed）
  } finally { rmCase(dirJ, dirD); }
});

test("A/B⑦none：零候选=两侧同落生产 no-goal 诊断支（pilot {} 信号退役），零记录+exit 0", { skip: FLOOR_SKIP }, () => {
  const { dirJ, dirD } = buildCase({ items: [item("q-ab-7", { endpoint: "A" })] }); // A 无 delivery=无候选
  try {
    const j = run(dirJ, "批准 11112222");
    const d = run(dirD, "批准 11112222");
    assert.equal(j.status, 0);
    assert.equal(d.status, 0);
    // 同一生产诊断支（文案内嵌各自 cwd——既有形态；路径归一后逐字比对）
    const norm = (s) => String(s).split(dirJ).join("<CWD>").split(dirD).join("<CWD>");
    assert.equal(norm(j.parsed.additionalContext), norm(d.parsed.additionalContext));
    assert.match(j.parsed.additionalContext, /no goal loop is registered/);
    assert.equal(records(dirJ).length, 0);
    assert.equal(records(dirD).length, 0);
  } finally { rmCase(dirJ, dirD); }
});

test("A/B⑧一致性：DB 侧批准记录与 readSnapshot 同读数（同 slug/contractHash；SCHEMA_VERSION 门在库）", { skip: FLOOR_SKIP }, () => {
  const body = "task: delivery B\n";
  const { dirD } = buildCase({
    items: [item("q-ab-8", { delivery: { B: { path: "contracts/b.md", hash: sha(body) } } })],
    contractBodies: { "contracts/b.md": body },
  });
  const db = openStore(stateDbPath(dirD), { readOnly: true });
  try {
    const short = sha(body).slice(0, 8);
    const d = run(dirD, `批准 ${short}`);
    assert.equal(d.status, 0);
    const snap = readSnapshot(db);
    const rd = record(dirD, records(dirD)[0]);
    assert.equal(rd.slug, snap.items[0].goalSlug);
    assert.equal(rd.contractHash, snap.items[0].delivery.B.hash);
    assert.equal(String(SCHEMA_VERSION), "1"); // 钩子读面版本门常量与存储层同源
  } finally { db.close(); rmSync(dirD, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
