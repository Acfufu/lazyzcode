// drive 编排器契约测试（0.2.0 棒2，ADR-0020/§⑮ Q3）：门序逐门拒（executing/risk/引擎/
// 凭据/他租）、段循环（fence env 注入段会话、两段达 done）、recordSpend 超顶拒路由干净
// 收束（非异常逃逸）、水位联动执法、无推进 stuck 收束、initBudget restart 两半（持租
// 重开/无租拒+交互 init 拒重置回归）、doctor drive 行三态、CLI 接线面。
// HOME 隔离+引擎抑制（债③家法）；真 spawn 走 deps.run 注入（headless.js 先例）——CI 零触网。
// win32 雷回避：不 split("/")、路径断言用 join、无平台专属调用。
import { test } from "node:test";
// 人权门非本文件被测面——spawn 继承此 env 保任意采纳畅通
process.env.LZY_ABLATE_HUMAN_GATE = "1";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runDrive } from "../core/drive.js";
import { initBudget, loadRuntime, acquireLease, releaseLease } from "../core/runtime.js";
import { lintHandoffSnapshot, withLock } from "../core/loop.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");
const SUPPRESS_ENGINE = "/nonexistent-lzy-suppressed-engine";
const HOME = mkdtempSync(join(tmpdir(), "lzy-drive-home-"));

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

// 造一个 executing 态的 scratch goal（trivial 单步计划，人权门消融 env 直采）。
function executingRepo(prefix, { risk } = {}) {
  const d = repo(prefix);
  const riskFlag = risk ? ["--risk", risk] : [];
  lzy(["loop", "register", "drv", "--title", "t", ...riskFlag], d);
  writeFileSync(join(d, "p.md"), "- [N1] x\n");
  const plan = lzy(["loop", "plan", "p.md"], d);
  if (plan.code !== 0) throw new Error(`plan 失败：${plan.out}`);
  lzy(["loop", "start"], d);
  return d;
}

const goalJson = (d) => join(d, ".lazyzcode", "loop", "goal.json");
const markAllSteps = (d, { finish = false } = {}) => {
  const goal = JSON.parse(readFileSync(goalJson(d), "utf8"));
  goal.steps = goal.steps.map((s) => ({ ...s, status: "done" }));
  if (finish) goal.status = "done";
  writeFileSync(goalJson(d), `${JSON.stringify(goal, null, 2)}\n`);
};
const markFirstStepDone = (d) => {
  const goal = JSON.parse(readFileSync(goalJson(d), "utf8"));
  const i = goal.steps.findIndex((s) => s.status !== "done");
  if (i >= 0) goal.steps[i] = { ...goal.steps[i], status: "done" };
  writeFileSync(goalJson(d), `${JSON.stringify(goal, null, 2)}\n`);
};

// console.log 捕获（drive 的进度面是 stdout）。
function captureStdout(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  return Promise.resolve(fn()).finally(() => {
    console.log = orig;
  }).then((r) => ({ result: r, lines: lines.join("\n") }));
}

// 通过全部早期门的 deps（引擎/凭据注入；真 spawn 走 deps.run 假引擎，零触网）。
const passDeps = (run, extra = {}) => ({
  enginePath: "/fake/engine.cjs",
  detectAuth: () => ({ oauth: true, envAuth: false, ok: true }),
  run: run ?? (() => ({ exitCode: 0, stdout: "{}", stderr: "" })),
  ...extra,
});

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// ── ① 门序逐门拒 ─────────────────────────────────────────────────────────────
test("门序①②：planning 态拒；risk=high/restricted 拒（CLI 面，suppressed engine 下先撞 risk 门=门序②先于③）", () => {
  const d1 = repo("lzy-drive-g1-");
  try {
    lzy(["loop", "register", "g1", "--title", "t"], d1);
    writeFileSync(join(d1, "p.md"), "- [N1] x\n");
    lzy(["loop", "plan", "p.md"], d1);
    const r = lzy(["loop", "drive"], d1);
    assert.equal(r.code, 1);
    assert.match(r.out, /drive 只推进 executing 目标（现状 planning）/);
  } finally {
    rmSync(d1, { recursive: true, force: true });
  }
  for (const risk of ["high", "restricted"]) {
    const d = executingRepo(`lzy-drive-g-${risk}-`, { risk });
    try {
      const r = lzy(["loop", "drive"], d);
      assert.equal(r.code, 1);
      assert.match(r.out, risk === "high" ? /HIGH 风险目标禁入无人值守车道/ : /RESTRICTED 硬禁/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  }
});

test("门序③④：引擎缺席拒（LZY_ZCODE_ENGINE 抑制）；凭据双缺拒（deps.detectAuth=false 注入）", async () => {
  const d = executingRepo("lzy-drive-g3-");
  try {
    const r = lzy(["loop", "drive"], d);
    assert.equal(r.code, 1);
    assert.match(r.out, /引擎未找到——drive 段需 ZCode 桌面端引擎/);
    await assert.rejects(
      () =>
        runDrive(d, {}, {
          enginePath: "/fake/engine.cjs",
          detectAuth: () => ({ oauth: false, envAuth: false, ok: false }),
          run: () => ({ exitCode: 0, stdout: "{}", stderr: "" }),
        }),
      /headless 凭据缺席/,
    );
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("门序⑤：他租在场=drive 拒「另一运行时持租」（lease 单运行时互斥）", async () => {
  const d = executingRepo("lzy-drive-g5-");
  try {
    withLock(d, () => acquireLease(d, { ttlMs: 60_000 }));
    await assert.rejects(
      () => runDrive(d, {}, passDeps(null, { rollingPoints: 0 })),
      /另一运行时持租/,
    );
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── ② 段循环：两段达 done；fence env 注入段会话 ──────────────────────────────
test("假引擎两段达 done：EXIT=0+段日志两行+段 env 带 LZY_RUNTIME_FENCE+lease 释放+budget 入账", async () => {
  const d = executingRepo("lzy-drive-two-");
  const seenEnvs = [];
  let call = 0;
  const run = (x) => {
    seenEnvs.push(x.env.LZY_RUNTIME_FENCE);
    call += 1;
    sleep(2); // durationMs>0：段账入账断言之基（瞬时假段可为 0ms）
    if (call === 1) markFirstStepDone(d);
    else markAllSteps(d, { finish: true });
    return { exitCode: 0, stdout: "{}", stderr: "" };
  };
  try {
    const { result, lines } = await captureStdout(() => runDrive(d, { maxSegments: 4 }, passDeps(run, { rollingPoints: 0 })));
    assert.equal(result.ok, true, lines);
    assert.equal(result.cause, "done");
    assert.match(lines, /段 1\/4/);
    assert.match(lines, /段 2\/4/);
    assert.match(lines, /✔ goal done（drv）/);
    assert.deepEqual(seenEnvs, ["1", "1"], "段会话 env 注入现行 fence（ADR-0020 派生工人申报）");
    const rt = loadRuntime(d);
    assert.equal(rt.activeLease, null, "lease 已释放");
    assert.equal(rt.budget.spentMs > 0, true, "段账入账（durationMs>0）");
    assert.equal(rt.budget.spentPoints, 0, "积分恒 0（活体归因不可行，ADR-0020 边界如实记账）");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── ③ recordSpend 超顶拒路由干净收束 ─────────────────────────────────────────
test("墙钟小预算（1ms env）+5ms 假段：超顶拒被 catch 路由=收束 banner「预算尽」+快照过 lint+marker 在场+EXIT=0", async () => {
  const d = executingRepo("lzy-drive-wall-");
  const run = () => {
    sleep(5); // durationMs ≥ 5ms > 1ms cap → recordSpend 必拒
    return { exitCode: 0, stdout: "{}", stderr: "" };
  };
  const saved = process.env.LZY_DRIVE_WALLCLOCK_BUDGET_MS;
  process.env.LZY_DRIVE_WALLCLOCK_BUDGET_MS = "1";
  try {
    const { result, lines } = await captureStdout(() =>
      runDrive(d, {}, passDeps(run, { rollingPoints: 0 })),
    );
    assert.equal(result.ok, true, `超顶拒是收束信号非异常逃逸：${lines}`);
    assert.match(lines, /预算尽（墙钟预算超顶）/);
    assert.match(lines, /handoff 快照：.+（复归：zw 继续）/, "干净收束带快照路径");
    const marker = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "handoff.json"), "utf8"));
    assert.ok(existsSync(marker.snapshot), "handoff 标记在场");
    const missing = lintHandoffSnapshot(readFileSync(marker.snapshot, "utf8"));
    assert.deepEqual(missing, [], "drive 自写快照过 7 字段 lint");
    assert.equal(loadRuntime(d).activeLease, null);
    assert.ok(result.handoff, "收束结果带回快照路径");
  } finally {
    if (saved === undefined) delete process.env.LZY_DRIVE_WALLCLOCK_BUDGET_MS;
    else process.env.LZY_DRIVE_WALLCLOCK_BUDGET_MS = saved;
    rmSync(d, { recursive: true, force: true });
  }
});

// ── ④ 水位联动执法 ───────────────────────────────────────────────────────────
test("水位联动：rollingPoints ≥ pointsBudget→收束「积分预算尽」；null→跳过注记+段数尽收束", async () => {
  const d1 = executingRepo("lzy-drive-wl1-");
  try {
    const { result, lines } = await captureStdout(() =>
      runDrive(d1, {}, passDeps(null, { rollingPoints: 500 })),
    );
    assert.equal(result.ok, true, lines);
    assert.match(lines, /积分预算尽（近 5h 滚动水位 500 ≥ 积分硬顶 400）/);
    assert.match(lines, /handoff 快照：/);
  } finally {
    rmSync(d1, { recursive: true, force: true });
  }
  const d2 = executingRepo("lzy-drive-wl2-");
  let call2 = 0;
  const progressRun = () => {
    call2 += 1;
    // 首段有推进→避开 stuck（本用例钉段数尽路径）。判据=进度信号状态集（0.2.2 棒1#N3）：
    // 假引擎既不提交也不取证，唯一能推得动状态集的动作就是翻步，故此处仍须翻步。
    if (call2 === 1) markFirstStepDone(d2);
    return { exitCode: 0, stdout: "{}", stderr: "" };
  };
  try {
    const { result, lines } = await captureStdout(() =>
      runDrive(d2, { maxSegments: 2 }, passDeps(progressRun, { rollingPoints: null })),
    );
    assert.equal(result.ok, true, lines);
    assert.match(lines, /水位读数不可读（fail-soft）/, "null=跳过并注记");
    assert.match(lines, /收束：段数尽（2 段）/);
  } finally {
    rmSync(d2, { recursive: true, force: true });
  }
});

// ── ⑤ 段败收束：可操作报文连带 stdout（ADJ-22） ──────────────────────────────
test("ADJ-22：段失败收束时 headless 失败族文案连带打印 stdout（不再只落快照「风险与坑」）", async () => {
  const d = executingRepo("lzy-drive-segfail-");
  const run = () => ({ exitCode: 1, stdout: "", stderr: "boom: AUTH_EXPIRED at provider" });
  try {
    const { result, lines } = await captureStdout(() =>
      runDrive(d, { maxSegments: 3 }, passDeps(run, { rollingPoints: 0 })),
    );
    assert.equal(result.ok, false, lines);
    assert.match(lines, /收束：段失败（exit=1）/);
    assert.match(lines, /handoff 快照：/);
    // 原因行=riskNote 原文（含 headless 的恢复式文案与 stderr 尾部），不再只存在于快照里
    assert.match(lines, /\[drive\] 原因：第 1 段 headless 调用失败：引擎 headless 调用非零退出（exit 1）。stderr 尾部：boom: AUTH_EXPIRED at provider/);
    const marker = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "handoff.json"), "utf8"));
    assert.match(readFileSync(marker.snapshot, "utf8"), /## 风险与坑\n第 1 段 headless 调用失败/, "快照面照旧在场");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── ⑥ 无推进 stuck 收束（状态集判据两半，0.2.2 棒1#N3/ADJ-34） ──────────────
test("真惰性两段零推进→stuck 收束（镜像 Stop 振数纪律）+快照交回", async () => {
  const d = executingRepo("lzy-drive-stuck-");
  try {
    const { result, lines } = await captureStdout(() =>
      runDrive(d, { maxSegments: 5 }, passDeps(null, { rollingPoints: 0 })),
    );
    assert.equal(result.ok, true, lines);
    assert.match(lines, /无推进（stuck，连续 2 段零推进）/);
    assert.match(lines, /handoff 快照：/);
    assert.equal(loadRuntime(d).activeLease, null);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("重活/长步：段段有提交但步未翻 done→不得误判 stuck（ADJ-34 的修法本体）", async () => {
  const d = executingRepo("lzy-drive-longstep-");
  let seg = 0;
  // 假引擎模拟「真推进」——每段落一次提交，但一次也不翻步（旧判据在此完全失明）
  const committingRun = () => {
    seg += 1;
    const f = join(d, `work-${seg}.txt`);
    writeFileSync(f, `work ${seg}\n`);
    spawnSync("git", ["add", f], { cwd: d });
    spawnSync("git", ["-c", "user.email=t@l", "-c", "user.name=t", "commit", "-qm", `seg ${seg}`], { cwd: d });
    return { exitCode: 0, stdout: "{}", stderr: "" };
  };
  try {
    const { result, lines } = await captureStdout(() =>
      runDrive(d, { maxSegments: 4 }, passDeps(committingRun, { rollingPoints: 0 })),
    );
    assert.equal(result.ok, true, lines);
    assert.ok(!/stuck/.test(lines), `有提交即非零推进，不得收 stuck。实得：${lines}`);
    assert.match(lines, /收束：段数尽（4 段）/, "应跑满段数而非被 stuck 提前掐断");
    assert.equal(seg, 4, "四段都真的跑了");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── ⑦ initBudget restart 两半 ───────────────────────────────────────────────
test("restart 两半：持现行租 fence 重开成功（spent 归零）；无租/错 fence 拒；交互 budget init 拒重置回归钉", () => {
  const d = repo("lzy-drive-restart-");
  try {
    const lease = withLock(d, () => acquireLease(d, { ttlMs: 60_000 }));
    withLock(d, () => initBudget(d, {}));
    withLock(d, () => initBudget(d, { restart: true, fence: lease.fence }));
    assert.equal(loadRuntime(d).budget.spentMs, 0, "重开=spent 归零");
    assert.throws(
      () => withLock(d, () => initBudget(d, { restart: true, fence: 999 })),
      /预算重开拒：无活跃租约或 fence 999 非现行/,
    );
    withLock(d, () => releaseLease(d, lease.fence));
    assert.throws(
      () => withLock(d, () => initBudget(d, { restart: true, fence: lease.fence })),
      /预算重开拒/,
      "无活跃租约=重开拒（僵尸无租重置被拒）",
    );
    // 交互 CLI：budget init 维持拒重置（restart 仅 drive 内部路径）
    // ADJ-31：CLI 写面前置 requireGoalPreLock——本段是 CLI 面，先注册目标（无 goal 会撞
    // 前置门，报文与「预算已初始化」不同轴）。
    assert.equal(lzy(["loop", "register", "dr", "--title", "t"], d).code, 0);
    lzy(["loop", "budget", "init"], d);
    const r = lzy(["loop", "budget", "init"], d);
    assert.equal(r.code, 1);
    assert.match(r.out, /预算已初始化/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── ⑦ doctor drive 行 ───────────────────────────────────────────────────────
test("doctor drive 行：引擎缺席=skip 态；引擎在场机器行恒在且含「drive 通道」", () => {
  const d = repo("lzy-drive-doctor-");
  try {
    const r = lzy(["doctor"], d);
    assert.match(r.out, /drive\s+引擎缺席.*drive 无人值守通道不可用/, "skip 态原文");
    const r2 = spawnSync(process.execPath, [CLI, "doctor"], {
      cwd: d,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: "" },
    });
    assert.match(`${r2.stdout}${r2.stderr}`, /drive\s+drive 通道|drive\s+引擎缺席/, "行恒在（状态按机器如实）");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("doctor drive 行：活跃租约显 fence 值+预算计数（真引擎机器条件断言；无引擎机器如实 skip）", () => {
  const d = repo("lzy-drive-doctor2-");
  try {
    withLock(d, () => acquireLease(d, { ttlMs: 60_000 }));
    withLock(d, () => initBudget(d, { wallClockBudgetMs: 12345, pointsBudget: 40 }));
    const out = spawnSync(process.execPath, [CLI, "doctor"], {
      cwd: d,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: "" },
    });
    const text = `${out.stdout}${out.stderr}`;
    const driveLine = text.split("\n").find((l) => /drive 通道|➖ drive|drive\s+引擎缺席/.test(l)) ?? "";
    if (/引擎缺席/.test(driveLine) || driveLine === "") {
      assert.ok(true, "CI 无引擎：skip 态即契约（fence 显示由 ok 态机器活体 F3 承载）");
    } else {
      assert.match(driveLine, /活跃租约 fence=1/);
      assert.match(driveLine, /预算 0\/12345ms · 0\/40pt/);
    }
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── ⑧ CLI 接线面 ────────────────────────────────────────────────────────────
test("CLI 面：枚举串含 drive（22 项）；help 含 drive 行与 handoff 行；无 goal 恢复式报错原文", () => {
  const d = repo("lzy-drive-cli-");
  try {
    const r = lzy(["loop", "bogus"], d);
    assert.match(r.out, /未知 loop 子命令：bogus（[^）]*\bdrive\b[^）]*）/);
    assert.equal(r.out.split("drive）")[0].split("（")[1].split("/").length, 22, "枚举串恰 22 项");
    const h = lzy(["help"], d);
    assert.match(h.out, /lzy loop drive \[--wall-ms N\]/);
    assert.match(h.out, /lzy loop handoff --snapshot/);
    const ng = lzy(["loop", "drive"], d);
    assert.equal(ng.code, 1);
    assert.match(ng.out, /本目录没有目标循环状态/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
