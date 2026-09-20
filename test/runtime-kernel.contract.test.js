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
      // ADJ-28（0.2.1 五轮双审）：超顶时本笔仍如实入账（账本与现实对账）+ lastOverrun 标记。
      const afterOver = loadRuntime(d2).budget;
      assert.equal(afterOver.spentMs, 101, "超顶笔如实入账（原实现整笔拒致账本低于实耗）");
      assert.equal(typeof afterOver.lastOverrun?.at, "string", "lastOverrun 标记在场");
      assert.throws(() => withLock(d2, () => recordSpend(d2, { ms: "abc" })), /记账拒/);
      assert.throws(() => withLock(d2, () => recordSpend(d2, { ms: -5 })), /记账拒/);
    } finally {
      rmSync(d2, { recursive: true, force: true });
    }
    const d3 = repo("lzy-runtime-budget3-");
    try {
      withLock(d3, () => initBudget(d3, {}));
      assert.throws(() => withLock(d3, () => recordSpend(d3, { ms: 50, points: 999 })), /积分预算超顶/);
    } finally {
      rmSync(d3, { recursive: true, force: true });
    }
    // 恰好不超=过（边界：等于 cap 非超）——独立仓：超顶笔现已如实入账（ADJ-28），
    // 同仓二次记账会撞上一笔已入账的 50ms。
    const d5 = repo("lzy-runtime-budget5-");
    try {
      withLock(d5, () => initBudget(d5, {}));
      withLock(d5, () => recordSpend(d5, { ms: 100, points: 0 }));
    } finally {
      rmSync(d5, { recursive: true, force: true });
    }
    // env 非法值 fail-loud（ADJ-28：原 parseInt 静默吞错值——"abc"/"1e3"/"0" 全被吞）
    process.env.LZY_DRIVE_WALLCLOCK_BUDGET_MS = "abc";
    const d4 = repo("lzy-runtime-budget4-");
    try {
      assert.throws(() => withLock(d4, () => initBudget(d4, {})), /LZY_DRIVE_WALLCLOCK_BUDGET_MS 非法/);
    } finally {
      process.env.LZY_DRIVE_WALLCLOCK_BUDGET_MS = "100";
      rmSync(d4, { recursive: true, force: true });
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
    // ADJ-31（0.2.1）：lease/budget 写面现前置 requireGoalPreLock（ADR-0006 fail-fast：无
    // goal 目录不留 runtime.json 空壳/幻影租约）——夹具先注册目标（goal 只是前置；本文件
    // 被测面仍是 runtime 面）。
    const reg = lzy(["loop", "register", "rt", "--title", "t"], d);
    assert.equal(reg.code, 0, reg.out);
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

// ADJ-31 反向面：无 goal 目录上五个变更调用点一律拒，且不留 runtime.json 空壳/幻影租约
test("无 goal 前置门：lease/budget 写面拒且零疤痕（runtime.json 都不建）", () => {
  const d = repo("lzy-runtime-bare-");
  try {
    for (const args of [
      ["loop", "lease", "acquire"],
      ["loop", "lease", "heartbeat", "--fence", "1"],
      ["loop", "lease", "release", "--fence", "1"],
      ["loop", "budget", "init"],
      ["loop", "budget", "spend", "--ms", "1"],
    ]) {
      const r = lzy(args, d);
      assert.equal(r.code, 1, `${args.join(" ")} → ${r.out}`);
      assert.match(r.out, /没有目标循环状态/, r.out);
    }
    assert.equal(existsSync(runtimeJson(d)), false, "无 goal 不留 runtime.json 空壳");
    assert.equal(existsSync(join(d, ".lazyzcode", "loop")), false, "连 loop/ 目录都不建（fail-fast 家法）");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ADJ-27/ADJ-80（0.2.1）：声明通道与值旗标的非法输入 fail-loud——三条静默漏放
//（空串/裸旗标/科学计数）与「裸值旗标静默默认 true」都在解析处显式拒。
test("ADJ-27/80：--fence 非法形态与裸值旗标一律用法错（不再静默漏放/TypeError）", () => {
  const d = repo("lzy-runtime-flag-");
  try {
    assert.equal(lzy(["loop", "register", "fl", "--title", "t"], d).code, 0);
    for (const args of [
      ["step", "done", "N1", "--fence", ""], // 空串：旧实现静默直通（写落盘）
      ["step", "done", "N1", "--fence"], // 裸旗标：旧实现记 true 静默直通
      ["step", "done", "N1", "--fence", "1e9"], // 科学计数：旧实现 parseInt 截成 1
      ["step", "done", "N1", "--fence", "abc"], // 非数字：旧实现误导为「你已被接管」
      ["step", "done", "N1", "--fence", "0"], // 0 非正整数
    ]) {
      const r = lzy(args, d);
      assert.equal(r.code, 1, `${args.join(" ")} → ${r.out}`);
      assert.match(r.out, /--fence 须为正整数/, r.out);
    }
    assert.equal(lzy(["loop", "status"], d).out.includes("[lzy]"), false, "非法 fence 不写盘（用法错先于门）");
    // 裸值旗标（漏值）——旧实现静默默认 true，下游 title?.trim 抛 TypeError
    const reg = lzy(["loop", "register", "fl2", "--title"], d);
    assert.equal(reg.code, 1, reg.out);
    assert.match(reg.out, /--title 缺值/);
    assert.doesNotMatch(reg.out, /is not a function/);
    for (const flag of ["--tier", "--risk", "--points", "--ms", "--ttl-ms", "--wall-ms", "--max-segments", "--mode", "--snapshot"]) {
      const r = lzy(["loop", "budget", "init", flag], d);
      assert.equal(r.code, 1, `${flag} 裸旗标应拒：${r.out}`);
      assert.match(r.out, /缺值/, r.out);
    }
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
