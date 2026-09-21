// 锁竞争窗仪器契约（0.2.2 棒1#N5，§⑩-4）：①mergeMetrics 的累加/取最大语义与
// never-throw 契约；②withLock 在「竞争后获锁」「等到放弃」「无竞争获锁」三态各记什么
// （记账写在**释放之后**——写在临界段内会让仪器延长它所测量的窗口）；③doctor lock 行
// 三态（无样本 skip 不翻退出码 / 有样本 ok / 有超时 warn=原预注册触发条件命中）。
// 并发选手来自**独立子进程**：withLock 的等待是 Atomics.wait，会阻塞事件循环，
// 进程内 setTimeout 永远不跑（探针第一版即死于此）。
import { test } from "node:test";
process.env.LZY_ABLATE_HUMAN_GATE = "1";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOCK_WAIT_MS,
  loopDir,
  mergeMetrics,
  readMetrics,
  withLock,
} from "../core/loop.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");
const SUPPRESS_ENGINE = "/nonexistent-lzy-suppressed-engine";
const HOME = mkdtempSync(join(tmpdir(), "lzy-lock-home-"));

function scratch(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  const g = (...a) => spawnSync("git", a, { cwd: d, encoding: "utf8" });
  g("init", "-q");
  g("config", "user.email", "t@l");
  g("config", "user.name", "t");
  writeFileSync(join(d, "a.txt"), "a\n");
  g("add", "-A");
  g("commit", "-qm", "init");
  mkdirSync(loopDir(d), { recursive: true });
  return d;
}

function lzy(args, cwd) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE },
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function plantLock(d, token = "holder") {
  const lock = join(loopDir(d), ".lock");
  mkdirSync(lock, { recursive: true });
  writeFileSync(
    join(lock, "owner.json"),
    `${JSON.stringify({ pid: 999999, token, at: new Date().toISOString() })}\n`,
  );
  return lock;
}

function releaseLater(lockPath, delayMs) {
  const code = `setTimeout(() => { try { require("fs").rmSync(${JSON.stringify(lockPath)}, { recursive: true, force: true }); } catch {} }, ${delayMs});`;
  spawn(process.execPath, ["-e", code], { stdio: "ignore", detached: true }).unref();
}

test("N5 · mergeMetrics：累加与取最大各自正确，且 never-throw", () => {
  const d = scratch("lzy-lock-merge-");
  mergeMetrics(d, { add: { lock_waits: 2 }, max: { lock_wait_ms_max: 300 } });
  mergeMetrics(d, { add: { lock_waits: 3 }, max: { lock_wait_ms_max: 120 } });
  const m = readMetrics(d);
  assert.equal(m.lock_waits, 5, "add 语义=累加");
  assert.equal(m.lock_wait_ms_max, 300, "max 语义=取最大（不累加、不回退）");
  mergeMetrics(d, { add: { lock_waits: 1 }, max: { lock_wait_ms_max: 900 } });
  assert.equal(readMetrics(d).lock_wait_ms_max, 900, "更大的 max 覆盖");
  // never-throw：坏 patch 不得抛（主路径契约）
  assert.doesNotThrow(() => mergeMetrics(d, { add: { x: "nan" }, max: { y: undefined } }));
  assert.doesNotThrow(() => mergeMetrics(d, null));
});

test("N5 · 无竞争获锁：记 acquisitions 且 waits=0", () => {
  const d = scratch("lzy-lock-free-");
  withLock(d, () => {});
  const m = readMetrics(d);
  assert.equal(m.lock_acquisitions, 1);
  assert.equal(m.lock_waits, 0, "没等过就不算等待");
  assert.equal(m.lock_wait_ms_total, 0);
});

test("N5 · 竞争后获锁：记 waits 与等待时长", () => {
  const d = scratch("lzy-lock-contended-");
  releaseLater(plantLock(d), 300);
  withLock(d, () => {});
  const m = readMetrics(d);
  assert.equal(m.lock_acquisitions, 1);
  assert.equal(m.lock_waits, 1, "等过才算等待");
  assert.ok(m.lock_wait_ms_total >= 250, `等待时长应≈300ms，实得 ${m.lock_wait_ms_total}`);
  assert.equal(m.lock_wait_ms_max, m.lock_wait_ms_total, "单次等待 → max=total");
});

test("N5 · 等到放弃：记 lock_timeouts 且抛 LoopError（含实等毫秒）", () => {
  const d = scratch("lzy-lock-timeout-");
  plantLock(d); // 刻意不移除
  const t0 = Date.now();
  assert.throws(() => withLock(d, () => {}), (err) => {
    assert.match(err.message, /等待超时，等待 \d+ms/);
    return true;
  });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= LOCK_WAIT_MS, `应等满常量 ${LOCK_WAIT_MS}ms，实测 ${elapsed}ms`);
  const m = readMetrics(d);
  assert.equal(m.lock_timeouts, 1, "超时独立计数");
  assert.equal(m.lock_acquisitions ?? 0, 0, "从未获锁 → 不记 acquisitions");
  assert.ok(m.lock_wait_ms_max >= LOCK_WAIT_MS);
  rmSync(join(loopDir(d), ".lock"), { recursive: true, force: true });
});

test("N5 · doctor lock 行三态：无样本 skip / 有样本 ok / 有超时 warn", () => {
  const d = scratch("lzy-lock-doctor-");
  // 无样本：loop/ 在场但无 lock_* 计数（doctor 按状态字形渲染：➖=skip / ✔=ok / ⚠=warn）
  const skip = lzy(["doctor"], d);
  assert.match(skip.out, /➖ lock\s+无锁竞争样本/, `实得：${skip.out}`);
  // 断言限定在 lock 行本身：隔离 HOME 下 install/files 两行必然 ✖（无插件注册/无缓存），
  // doctor 整体退出码由它们决定，拿绝对退出码来断言「skip 不翻码」在测试环境里测不到真东西。
  assert.ok(!/✖ lock/.test(skip.out), `lock 行不得出 fail 态，实得：${skip.out}`);

  // 有样本无超时 → ok
  mergeMetrics(d, {
    add: { lock_acquisitions: 4, lock_waits: 1, lock_wait_ms_total: 120 },
    max: { lock_wait_ms_max: 120 },
  });
  const ok = lzy(["doctor"], d);
  assert.match(ok.out, /✔ lock\s+获锁 4 次/, `实得：${ok.out}`);
  assert.match(ok.out, /超时 0 次（对照 LOCK_WAIT_MS 5000ms/, `实得：${ok.out}`);

  // 有超时 → warn（§⑩-4 原预注册触发条件命中）
  mergeMetrics(d, { add: { lock_timeouts: 1 }, max: { lock_wait_ms_max: 5100 } });
  const warn = lzy(["doctor"], d);
  assert.match(warn.out, /⚠ lock\s+.*超时 1 次/, `实得：${warn.out}`);
  assert.match(warn.out, /§⑩-4 预注册触发条件命中/, `实得：${warn.out}`);
});

test("N5 · loop status 透出锁竞争行（有样本才出行）", () => {
  const d = scratch("lzy-lock-status-");
  const before = lzy(["loop", "status"], d);
  assert.ok(!/锁竞争：/.test(before.out), `无样本不得出行，实得：${before.out}`);
  mergeMetrics(d, { add: { lock_acquisitions: 2, lock_waits: 1 }, max: { lock_wait_ms_max: 42 } });
  const after = lzy(["loop", "status"], d);
  assert.match(after.out, /锁竞争：获锁 2 次 · 需等待 1 次 · 最长 42ms · 超时 0 次/);
});
