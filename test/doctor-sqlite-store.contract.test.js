// P4 N4（goal p4-sqlite-release）r3-F4：doctor sqlite-store 行 marker 归因拆分契约。
// 旧实现 marker JSON.parse 与 openStore 共用 try/catch——marker 损坏（SyntaxError）时库
// 健康，却统一误报 fail「state.sqlite 不可读」。定案（design §7 定案 2 + P4 计划 N4）：
// marker 不可读（解析失败或形状不识别）+库健康=warn 具名「读向标记损坏——当迁移态处理，
// state.sqlite 在场为权威」（不新增 state 枚举，#46 三键信封冻结）；库也不可读才 fail 归因库。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const MAJOR = Number(process.versions.node.split(".")[0]);
const FLOOR_SKIP = MAJOR >= 24 ? false : `地板 Node ≥24.0.0（ADR-0039；22 线不入 DB 支持面）；当前 v${process.versions.node} 跳过`;

const { saveLedger } = await import(pathToFileURL(join(ROOT, "core", "queue.js")).href);
const { migrateToSqlite } = await import(
  pathToFileURL(join(ROOT, "core", "sqlite-migrate.js")).href
);

const FIXED = "2026-03-01T00:00:00.000Z";
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const markerPath = (d) => join(d, ".lazyzcode", "state.backend.json");

// 稀疏工作区迁移到 DB 权威态（ledger-only，腿⑫同形态；doctor 以 cwd=d 真面驱动）。
function migratedFixture(tag) {
  const d = mkdtempSync(join(tmpdir(), `lzy-doc-sqlite-${tag}-`));
  spawnSync("git", ["init", "-q"], { cwd: d });
  const cHash = sha256(`doc-${tag}`);
  saveLedger(d, { entries: [{ seq: 1, kind: "review", at: FIXED, dedupKey: `review:doc-${tag}:1`, authorization: { slug: "g", contractHash: cHash }, provenance: `review:doc-${tag}`, itemId: null, txId: null, sessionId: null, ms: null, points: 3, note: "doctor 夹具" }] });
  migrateToSqlite(d);
  return d;
}

function doctorRow(d) {
  const p = spawnSync(process.execPath, [join(ROOT, "cli", "lzy.js"), "doctor", "--json"], {
    cwd: d, encoding: "utf8", timeout: 120_000,
    env: { ...process.env, LZY_ZCODE_ENGINE: "/nonexistent" },
  });
  assert.ok(p.status === 0 || p.status === 1, `doctor 退出码 0/1（实得 ${p.status}）：${p.stderr?.slice(0, 200)}`);
  const parsed = JSON.parse(p.stdout); // 非法 JSON 直接抛=契约失败
  assert.equal(parsed.schemaVersion, 1);
  const row = parsed.checks.find((c) => c.name === "sqlite-store");
  assert.ok(row, "sqlite-store 行在场");
  assert.deepEqual(Object.keys(row).sort(), ["detail", "name", "state"], "#46 三键信封");
  assert.ok(["ok", "fail", "warn", "skip"].includes(row.state), "state 枚举不新增");
  return row;
}

test("⑯r3-F4 doctor marker 归因：marker 损坏+库健康=warn 当迁移态处理（不误报库不可读）", { skip: FLOOR_SKIP }, () => {
  // ①parse 失败（{broken）+库健康 → warn 具名（红半=改前树 fail「state.sqlite 不可读」）
  const d1 = migratedFixture("broken");
  writeFileSync(markerPath(d1), "{broken");
  const r1 = doctorRow(d1);
  assert.equal(r1.state, "warn");
  assert.match(r1.detail, /读向标记损坏——当迁移态处理，state\.sqlite 在场为权威/);
  rmSync(d1, { recursive: true, force: true });

  // ②形状不识别（{"backend":"json"}）+库健康 → 同 warn（core 口径：形状不识别=同责）
  const d2 = migratedFixture("shape");
  writeFileSync(markerPath(d2), JSON.stringify({ backend: "json", format: 1 }));
  const r2 = doctorRow(d2);
  assert.equal(r2.state, "warn");
  assert.match(r2.detail, /读向标记损坏——当迁移态处理，state\.sqlite 在场为权威/);
  rmSync(d2, { recursive: true, force: true });

  // ③健康 marker+库 → ok（既有面回归守卫：backend 与条目数在场）
  const d3 = migratedFixture("healthy");
  const r3 = doctorRow(d3);
  assert.equal(r3.state, "ok");
  assert.match(r3.detail, /SQLite 权威（backend=sqlite/);
  rmSync(d3, { recursive: true, force: true });
});
