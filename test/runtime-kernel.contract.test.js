// runtime kernel 契约测试（0.2.0 棒1，ADR-0020）：runtime.json 账本沿 attempt.js 家法
//（校验和/原子写/fail-closed/写护栏单调性）、lease 三原语（acquire 互斥/heartbeat 续期/
// release）、fence 写路径守卫（opt-in 申报制：缺席放行、在场必须与现行租约相符）、
// budget 双硬顶（init/spend/remaining，超顶拒）与 CLI 生命周期面（真实表面=CLI stdout）。
// HOME 隔离+引擎抑制（债③家法）；budget 剩余读面的水位联动行在隔离 HOME 下如实降级。
import { test } from "node:test";
// 人权门非本文件被测面——spawn 继承此 env 保任意采纳畅通
process.env.LZY_ABLATE_HUMAN_GATE = "1";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  acquireLease,
  assertFenceIfPresent,
  DEFAULT_DRIVE_POINTS,
  DEFAULT_DRIVE_WALLCLOCK_MS,
  heartbeatLease,
  initBudget,
  loadRuntime,
  recordSpend,
  releaseLease,
  RUNTIME_VERSION,
  saveRuntime,
} from "../core/runtime.js";
import { withLock } from "../core/loop.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");
const SUPPRESS_ENGINE = "/nonexistent-lzy-suppressed-engine";
const HOME = mkdtempSync(join(tmpdir(), "lzy-runtime-home-"));

function repo(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "a\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "init"]);
  return d;
}

function lzy(args, cwd, env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE, ...env },
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const runtimeJson = (d) => join(d, ".lazyzcode", "loop", "runtime.json");
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

test("runtime 账本缺席=null；lease acquire 落盘且带校验和；篡改/损坏 fail-closed", () => {
  const d = repo("lzy-runtime-basic-");
  try {
    assert.equal(loadRuntime(d), null);
    const lease = withLock(d, () => acquireLease(d, { ttlMs: 60_000 }));
    assert.equal(lease.fence, 1);
    assert.equal(loadRuntime(d).runtimeVersion, RUNTIME_VERSION);
    const disk = JSON.parse(readFileSync(runtimeJson(d), "utf8"));
    assert.ok(typeof disk.checksum === "string" && disk.checksum.length === 64);
    // 篡改载荷 → 校验和不符拒（ADJ-01 家法：不可读不当缺席）
    disk.fenceCounter = 99;
    writeFileSync(runtimeJson(d), JSON.stringify(disk));
    assert.throws(() => loadRuntime(d), /校验和不符/);
    rmSync(runtimeJson(d));
    // 重建后写坏 JSON → 解析失败拒
    writeFileSync(runtimeJson(d), "{not json");
    assert.throws(() => loadRuntime(d), /JSON 解析失败/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("lease 互斥：活跃租约在场=二次 acquire 拒；过期后自然可再认领", () => {
  const d = repo("lzy-runtime-lease-");
  try {
    const l1 = withLock(d, () => acquireLease(d, { ttlMs: 30_000 }));
    assert.throws(() => withLock(d, () => acquireLease(d, { ttlMs: 30_000 })), /另一运行时持租/);
    withLock(d, () => heartbeatLease(d, l1.fence, { ttlMs: 30_000 }));
    // fence 错/释放错都拒
    assert.throws(() => withLock(d, () => heartbeatLease(d, 999, {})), /fence 999 非现行/);
    assert.throws(() => withLock(d, () => releaseLease(d, 999)), /不可释放他人的租约/);
    withLock(d, () => releaseLease(d, l1.fence));
    assert.equal(loadRuntime(d).activeLease, null);
    const l2 = withLock(d, () => acquireLease(d, { ttlMs: 30_000 }));
    assert.equal(l2.fence, 2); // 单调发号不回退
    withLock(d, () => releaseLease(d, l2.fence));
    // 过期（ttl 1ms + 忙等）→ leaseActive false → acquire 成功、heartbeat 拒
    withLock(d, () => acquireLease(d, { ttlMs: 1 }));
    sleep(20);
    assert.throws(() => withLock(d, () => heartbeatLease(d, 2, {})), /无活跃租约/);
    const l3 = withLock(d, () => acquireLease(d, { ttlMs: 30_000 }));
    assert.equal(l3.fence, 4); // 过期租约的 acquire 也耗号（3），单调发号不回退
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("fence 守卫 opt-in 申报制：缺席恒放行；在场必须与现行活跃租约相符", () => {
  const d = repo("lzy-runtime-fence-");
  try {
    // 无账本：申报=拒（无租约在册），未申报=放行
    assert.throws(() => assertFenceIfPresent(d, 1), /无活跃租约在册/);
    assert.deepEqual(assertFenceIfPresent(d, null), { checked: false });
    const l = withLock(d, () => acquireLease(d, { ttlMs: 30_000 }));
    assert.equal(assertFenceIfPresent(d, l.fence).checked, true);
    assert.throws(() => assertFenceIfPresent(d, l.fence + 100), /非现行/);
    withLock(d, () => releaseLease(d, l.fence));
    // 释放后持旧 fence=僵尸写，拒（拍板语义：失效=已被接管→停手不写）
    assert.throws(() => assertFenceIfPresent(d, l.fence), /无活跃租约在册/);
    // 未申报的交互写恒放行（向后兼容：无租约时逐字段同旧行为）
    assert.deepEqual(assertFenceIfPresent(d, null), { checked: false });
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("saveRuntime 写护栏：fenceCounter 单调性回退拒", () => {
  const d = repo("lzy-runtime-guard-");
  try {
    withLock(d, () => acquireLease(d, { ttlMs: 30_000 }));
    const state = loadRuntime(d);
    assert.throws(
      () => saveRuntime(d, { ...state, fenceCounter: state.fenceCounter - 1 }),
      /单调发号器不可回退/,
    );
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("budget：缺省定标（env 覆盖）+ 记账递减 + 墙钟/积分超顶拒 + 未初始化拒", () => {
  const d = repo("lzy-runtime-budget-");
  const envSave = { wall: process.env.LZY_DRIVE_WALLCLOCK_BUDGET_MS, pts: process.env.LZY_DRIVE_POINTS_BUDGET };
  try {
    delete process.env.LZY_DRIVE_WALLCLOCK_BUDGET_MS;
    delete process.env.LZY_DRIVE_POINTS_BUDGET;
    assert.throws(() => recordSpend(d, { ms: 1 }), /预算未初始化/);
    let b = withLock(d, () => initBudget(d, {}));
    assert.equal(b.wallClockBudgetMs, DEFAULT_DRIVE_WALLCLOCK_MS);
    assert.equal(b.pointsBudget, DEFAULT_DRIVE_POINTS);
    assert.throws(() => withLock(d, () => initBudget(d, {})), /预算已初始化/);
    b = withLock(d, () => recordSpend(d, { ms: 1000, points: 1 }));
    assert.equal(b.spentMs, 1000);
    // env 小预算覆盖：新仓重验超顶拒（墙钟维/积分维各一）
    process.env.LZY_DRIVE_WALLCLOCK_BUDGET_MS = "100";
    const d2 = repo("lzy-runtime-budget2-");
    try {
      withLock(d2, () => initBudget(d2, {}));
      assert.throws(() => withLock(d2, () => recordSpend(d2, { ms: 101 })), /墙钟预算超顶/);
      assert.throws(() => withLock(d2, () => recordSpend(d2, { ms: 50, points: 999 })), /积分预算超顶/);
      // 恰好不超=过（边界：等于 cap 非超）
      withLock(d2, () => recordSpend(d2, { ms: 100, points: 0 }));
    } finally {
      rmSync(d2, { recursive: true, force: true });
    }
  } finally {
    if (envSave.wall === undefined) delete process.env.LZY_DRIVE_WALLCLOCK_BUDGET_MS;
    else process.env.LZY_DRIVE_WALLCLOCK_BUDGET_MS = envSave.wall;
    if (envSave.pts === undefined) delete process.env.LZY_DRIVE_POINTS_BUDGET;
    else process.env.LZY_DRIVE_POINTS_BUDGET = envSave.pts;
    rmSync(d, { recursive: true, force: true });
  }
});

test("fence 写路径守卫（CLI 集成面）：申报制三态+开关两半——僵尸持旧 fence 写被拒", () => {
  const d = repo("lzy-runtime-guard-cli-");
  try {
    assert.equal(lzy(["loop", "register", "t", "--title", "t"], d).code, 0);
    writeFileSync(join(d, ".lazyzcode", "plan.md"), "- [N1] x\n- [F1] v\n");
    assert.equal(lzy(["loop", "plan", ".lazyzcode/plan.md"], d).code, 0);
    assert.equal(lzy(["loop", "start"], d).code, 0);
    assert.equal(lzy(["loop", "lease", "acquire", "--ttl-ms", "60000"], d).code, 0);
    // 未申报（交互直通）→ 放行
    let r = lzy(["step", "done", "N1", "--note", "x"], d);
    assert.equal(r.code, 0, r.out);
    // 申报错误 fence（僵尸形态）→ 拒、写不落
    r = lzy(["step", "done", "N1", "--note", "zombie"], d, { LZY_RUNTIME_FENCE: "99" });
    assert.notEqual(r.code, 0);
    assert.match(r.out, /立即停手不写/);
    // --fence 旗标通道同效（解析桥接 env）
    r = lzy(["step", "done", "N1", "--note", "zombie2", "--fence", "98"], d);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /立即停手不写/);
    // 申报现行 fence → 放行
    r = lzy(["step", "done", "N1", "--note", "ok", "--fence", "1"], d);
    assert.equal(r.code, 0, r.out);
    // 开关开（恰 "1"）→ 错误 fence 也放行（闸门被绕过）
    r = lzy(["step", "done", "F1", "--evidence", "v"], d, { LZY_RUNTIME_FENCE: "99", LZY_ABLATE_FENCE: "1" });
    assert.equal(r.code, 0, r.out);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("CLI 生命周期面（真实表面=stdout）：lease acquire/heartbeat/release + budget init/spend/remaining", () => {
  const d = repo("lzy-runtime-cli-");
  try {
    let r = lzy(["loop", "lease", "acquire", "--ttl-ms", "60000"], d);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /租约已获：fence 1/);
    r = lzy(["loop", "lease", "acquire"], d); // 二次 acquire 拒
    assert.notEqual(r.code, 0);
    assert.match(r.out, /另一运行时持租/);
    r = lzy(["loop", "lease", "heartbeat", "--fence", "1"], d);
    assert.equal(r.code, 0, r.out);
    r = lzy(["loop", "lease", "heartbeat", "--fence", "99"], d);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /非现行/);
    r = lzy(["loop", "budget", "init", "--wall-ms", "5000", "--points", "10"], d);
    assert.equal(r.code, 0, r.out);
    r = lzy(["loop", "budget", "spend", "--ms", "100", "--points", "1"], d);
    assert.equal(r.code, 0, r.out);
    r = lzy(["loop", "budget", "remaining"], d);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /墙钟：100\/5000ms/);
    assert.match(r.out, /积分：1\/10/);
    assert.match(r.out, /近 5h 滚动水位/); // 隔离 HOME 下如实降级行也在场
    r = lzy(["loop", "budget", "spend", "--points", "11"], d);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /积分预算超顶/);
    r = lzy(["loop", "lease", "release", "--fence", "1"], d);
    assert.equal(r.code, 0, r.out);
    // CLI 全程未破坏 goal 面（runtime.json 与 goal.json 互不干扰）
    assert.equal(lzy(["loop", "status"], d).code, 0);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
