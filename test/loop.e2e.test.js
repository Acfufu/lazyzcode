// 目标循环 E2E：spawn 真实 CLI 于临时 git 仓，固化状态机与两道门的行为契约。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");

function repo({ git = true } = {}) {
  const d = mkdtempSync(join(tmpdir(), "lzy-e2e-"));
  if (git) {
    const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
    g(["init", "-q"]);
    g(["config", "user.email", "t@l"]);
    g(["config", "user.name", "t"]);
    writeFileSync(join(d, "a.txt"), "a\n");
    g(["add", "a.txt"]);
    g(["commit", "-qm", "init"]);
  }
  return d;
}

function lzy(args, cwd, opts = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", timeout: 60_000, ...opts });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const THREE_STEPS = "- [N1] x\n- [N2] y\n- [F1] v\n";

function setup(dir, body) {
  const p = join(dir, "plan.md");
  writeFileSync(p, body);
  return "plan.md";
}

test("全链：计划门→REVISE force 不越过→证据门→过期拦截→finish", () => {
  const d = repo();
  try {
    assert.equal(lzy(["loop", "register", "e2e", "--title", "t"], d).code, 0);
    const bad = setup(d, "- [N1] ok\n- 背景注：去留未定\n");
    const rBad = lzy(["loop", "plan", bad], d);
    assert.equal(rBad.code, 1);
    assert.match(rBad.out, /L2/); // 评审 R2-7：报行号
    const ok = setup(d, THREE_STEPS);
    assert.equal(lzy(["loop", "plan", ok, "--review", "plan-reviewer: VERDICT: REVISE — fix"], d).code, 1);
    assert.equal(
      lzy(["loop", "plan", ok, "--review", "plan-reviewer: VERDICT: REVISE — fix", "--force"], d).code,
      1,
    ); // --force 不越过（宪法 #15）
    // R2-3 回归：VERDICT: PASS 附言含 revise 不得误拒
    assert.equal(
      lzy(["loop", "plan", ok, "--review", "plan-reviewer: VERDICT: PASS — ok, revise wording later"], d).code,
      0,
    );
    assert.equal(lzy(["loop", "start"], d).code, 0);
    assert.equal(lzy(["step", "done", "F1"], d).code, 1); // F 项强制证据
    assert.equal(lzy(["step", "done", "N1", "--note", "n"], d).code, 0);
    assert.equal(lzy(["step", "done", "N2", "--note", "n"], d).code, 0);
    assert.equal(lzy(["step", "done", "F1", "--evidence", "saw stdout"], d).code, 0);
    assert.equal(lzy(["loop", "verify"], d).code, 0); // 新鲜
    writeFileSync(join(d, "a.txt"), "b\n");
    spawnSync("git", ["add", "a.txt"], { cwd: d });
    const commit = spawnSync("git", ["commit", "-qm", "c2"], { cwd: d, encoding: "utf8" });
    assert.equal(commit.status, 0);
    assert.equal(lzy(["loop", "verify"], d).code, 1); // 过期即 1（评审 R2-6）
    assert.equal(lzy(["loop", "finish"], d).code, 1); // 终验拦截
    assert.match(lzy(["loop", "finish"], d).out, /已过期/);
    assert.equal(lzy(["step", "done", "F1", "--evidence", "rebind"], d).code, 0);
    const fin = lzy(["loop", "finish"], d);
    assert.equal(fin.code, 0);
    assert.match(fin.out, /目标完成/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("abandon 两态可用（P1 回归）；abandoned 占用工作区直至 reset", () => {
  const d = repo();
  try {
    assert.equal(lzy(["loop", "register", "ab", "--title", "t"], d).code, 0);
    const a1 = lzy(["loop", "abandon"], d); // planning 态
    assert.equal(a1.code, 0);
    assert.match(a1.out, /已放弃/);
    assert.equal(lzy(["loop", "register", "ab2", "--title", "t"], d).code, 1); // abandoned 仍占用
    assert.equal(lzy(["loop", "reset"], d).code, 0);
    assert.equal(lzy(["loop", "register", "ab3", "--title", "t"], d).code, 0);
    writeFileSync(join(d, "p.md"), "- [N1] x\n");
    assert.equal(lzy(["loop", "plan", "p.md"], d).code, 0);
    assert.equal(lzy(["loop", "start"], d).code, 0);
    assert.equal(lzy(["loop", "abandon"], d).code, 0); // executing 态
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("并发 step done：锁串行化，全部落账且 goal.json 合法（R2-5 回归）", async () => {
  const d = repo();
  try {
    assert.equal(lzy(["loop", "register", "cc", "--title", "t"], d).code, 0);
    writeFileSync(join(d, "p.md"), "- [N1] x\n- [N2] y\n- [N3] z\n");
    assert.equal(lzy(["loop", "plan", "p.md"], d).code, 0);
    assert.equal(lzy(["loop", "start"], d).code, 0);
    const kids = ["N1", "N2", "N3"].map((id) =>
      spawn(process.execPath, [CLI, "step", "done", id, "--note", id], { cwd: d }),
    );
    const codes = await Promise.all(
      kids.map((k) => new Promise((res) => k.on("close", (c) => res(c)))),
    );
    assert.deepEqual(codes, [0, 0, 0]);
    const goal = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8"));
    assert.deepEqual(
      goal.steps.filter((s) => s.status === "done").map((s) => s.id).sort(),
      ["N1", "N2", "N3"],
    );
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("git-less 目录：证据未绑定与 finish 的分诊文案（R2-4 回归）", () => {
  const d = repo({ git: false });
  try {
    assert.equal(lzy(["loop", "register", "ng", "--title", "t"], d).code, 0);
    writeFileSync(join(d, "p.md"), "- [N1] x\n- [F1] v\n");
    assert.equal(lzy(["loop", "plan", "p.md"], d).code, 0);
    assert.equal(lzy(["loop", "start"], d).code, 0);
    assert.equal(lzy(["step", "done", "N1", "--note", "n"], d).code, 0);
    assert.equal(lzy(["step", "done", "F1", "--evidence", "saw"], d).code, 0);
    const fin = lzy(["loop", "finish"], d);
    assert.equal(fin.code, 1);
    assert.match(fin.out, /未绑定/);
    assert.match(fin.out, /不是 git 仓库/); // 药方可执行，不再误诊「过期」
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("fail-fast（ADR-0006）：空目录写命令报错且不留 .lazyzcode/ 疤痕", () => {
  const d = repo({ git: false });
  try {
    const r = lzy(["step", "done", "N1", "--note", "n"], d);
    assert.equal(r.code, 1);
    assert.match(r.out, /本目录没有目标/);
    assert.ok(r.out.includes(join(d, ".lazyzcode", "loop")), "报错应含实际检查的绝对路径");
    assert.equal(existsSync(join(d, ".lazyzcode")), false); // withLock 前判空，无空壳疤痕
    assert.equal(lzy(["loop", "finish"], d).code, 1);
    assert.equal(existsSync(join(d, ".lazyzcode")), false);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("恢复式报错（ADR-0006）：status 读面报实际检查路径 + 恢复指引，不报错", () => {
  const d = repo({ git: false });
  try {
    const r = lzy(["loop", "status"], d);
    assert.equal(r.code, 0); // 读面：打印指引而非抛错
    assert.match(r.out, /本目录没有目标循环状态/);
    assert.ok(r.out.includes(join(d, ".lazyzcode", "loop")));
    assert.match(r.out, /恢复/);
    assert.match(r.out, /宿主工作区|工作区根/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("handoff（ADR-0009）：三拒（缺参/不存在/过期）+ 登记可见 + reset 清扫", () => {
  const d = repo();
  try {
    assert.equal(lzy(["loop", "register", "ho", "--title", "t"], d).code, 0);
    const p = setup(d, THREE_STEPS);
    assert.equal(lzy(["loop", "plan", p], d).code, 0);
    assert.equal(lzy(["loop", "start"], d).code, 0); // handoff 仅 executing 态有语义
    assert.match(lzy(["loop", "handoff"], d).out, /用法/); // 缺 --snapshot
    assert.match(lzy(["loop", "handoff", "--snapshot", "nope.md"], d).out, /不存在/);
    const stale = join(d, "stale.md");
    writeFileSync(stale, "old snapshot");
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    utimesSync(stale, old, old); // mtime 回拨 25h：化石快照
    assert.match(lzy(["loop", "handoff", "--snapshot", "stale.md"], d).out, /过期/);
    const snap = join(d, "snap.md");
    writeFileSync(snap, "handoff state");
    assert.match(lzy(["loop", "handoff", "--snapshot", "snap.md"], d).out, /交接已登记/);
    assert.equal(existsSync(join(d, ".lazyzcode", "loop", "handoff.json")), true);
    assert.match(lzy(["loop", "status"], d).out, /交接标记在场/);
    assert.equal(lzy(["loop", "reset"], d).code, 0); // cleanupLoopResidue 收编
    assert.equal(existsSync(join(d, ".lazyzcode", "loop", "handoff.json")), false);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("放行计数（可观测面）：登记 +1、reset 后永续、status 双面读、两侧 incMetrics 形状一致", () => {
  const d = repo();
  try {
    assert.equal(lzy(["loop", "register", "ho", "--title", "t"], d).code, 0);
    const p = setup(d, THREE_STEPS);
    assert.equal(lzy(["loop", "plan", p], d).code, 0);
    assert.equal(lzy(["loop", "start"], d).code, 0);
    const snap = join(d, "snap.md");
    writeFileSync(snap, "handoff state");
    assert.equal(lzy(["loop", "handoff", "--snapshot", "snap.md"], d).code, 0);
    const mp = join(d, ".lazyzcode", "loop", "metrics.json");
    const m1 = JSON.parse(readFileSync(mp, "utf8"));
    assert.equal(m1.registered, 1); // CLI 登记路径计数
    assert.equal(m1.consumed, undefined); // 消费归 Stop 侧
    assert.match(lzy(["loop", "status"], d).out, /放行计数：登记 1/);
    // 跨 reset 永续（设计拍板 #1）：计数不是目标状态，reset 不清
    assert.equal(lzy(["loop", "reset"], d).code, 0);
    assert.equal(JSON.parse(readFileSync(mp, "utf8")).registered, 1);
    // 无 goal 分支读面：reset 后恰是回看使用率的主时刻
    assert.match(lzy(["loop", "status"], d).out, /放行计数：登记 1 · 消费 0/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("两侧 incMetrics 形状一致（hook-lib 自包含复制防漂移）", async () => {
  const { incMetrics: coreInc } = await import("../core/loop.js");
  const { incMetrics: hookInc } = await import("../plugin/hooks/hook-lib.js");
  const strip = (m) => {
    const { updatedAt, ...rest } = m ?? {};
    return rest;
  };
  const d1 = repo({ git: false });
  const d2 = repo({ git: false });
  try {
    const a = strip(coreInc(d1, "consumed"));
    const b = strip(hookInc(d2, "consumed"));
    assert.deepEqual(a, b); // 同输入各自 inc 后 JSON 结构深等
    assert.deepEqual(a, { consumed: 1 });
  } finally {
    rmSync(d1, { recursive: true, force: true });
    rmSync(d2, { recursive: true, force: true });
  }
});

function goalJsonAt(dir, slug, status, steps) {
  const loop = join(dir, ".lazyzcode", "loop");
  mkdirSync(loop, { recursive: true });
  writeFileSync(
    join(loop, "goal.json"),
    JSON.stringify({ version: 1, slug, title: slug, status, steps, startedAt: "2026-09-10T00:00:00.000Z" }),
  );
}

test("loop list 跨仓清单：executing 前置、认领/存根列、版本不符容忍、--root、空锚 never-throw", () => {
  const anchor = mkdtempSync(join(tmpdir(), "lzy-list-"));
  const execRepo = join(anchor, "alpha-exec");
  const doneRepo = join(anchor, "beta-done");
  const badRepo = join(anchor, "gamma-badver");
  mkdirSync(execRepo, { recursive: true });
  mkdirSync(doneRepo, { recursive: true });
  mkdirSync(badRepo, { recursive: true });
  mkdirSync(join(badRepo, ".lazyzcode", "loop"), { recursive: true });
  try {
    goalJsonAt(execRepo, "x-loop", "executing", [
      { id: "N1", kind: "N", status: "done" },
      { id: "N2", kind: "N", status: "pending" },
    ]);
    mkdirSync(join(execRepo, ".lazyzcode", "loop", "sessions"), { recursive: true });
    writeFileSync(
      join(execRepo, ".lazyzcode", "loop", "sessions", "s1.json"),
      JSON.stringify({ claimedAt: "2026-09-10T00:00:00.000Z" }),
    );
    goalJsonAt(doneRepo, "y-loop", "done", [{ id: "F1", kind: "F", status: "done" }]);
    mkdirSync(join(doneRepo, ".lazyzcode", "loop", "salvage"), { recursive: true });
    writeFileSync(join(doneRepo, ".lazyzcode", "loop", "salvage", "z.md"), "# stub");
    writeFileSync(join(badRepo, ".lazyzcode", "loop", "goal.json"), JSON.stringify({ version: 99 }));

    // 场景 a：--root 显式锚；executing 排 done 前；认领/存根/版本不符逐列可见
    const probe = mkdtempSync(join(tmpdir(), "lzy-listcwd-")); // cwd 在锚外，逼 --root 生效
    try {
      const r = lzy(["loop", "list", "--root", anchor], probe);
      assert.equal(r.code, 0);
      const execLine = r.out.indexOf("alpha-exec");
      const doneLine = r.out.indexOf("beta-done");
      assert.ok(execLine > -1 && doneLine > -1, "两仓都应列席");
      assert.ok(execLine < doneLine, "executing 应排在 done 前");
      assert.match(r.out, /x-loop/);
      assert.match(r.out, /认领 1/);
      assert.match(r.out, /存根 1/);
      assert.match(r.out, /版本不符/); // gamma-badver 行容忍不炸全局
      assert.match(r.out, /1\/2/); // 步骤进度

      // 场景 b：默认锚=dirname(cwd)——从锚下一级仓内跑，同表可见（含 cwd 自身语义）
      const r2 = lzy(["loop", "list"], execRepo);
      assert.equal(r2.code, 0);
      assert.match(r2.out, /alpha-exec/);
      assert.match(r2.out, /beta-done/);
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }

    // 场景 c：--root 不存在 → 说明行 exit 0（never-throw）
    const r3 = lzy(["loop", "list", "--root", join(anchor, "no-such-dir")], doneRepo);
    assert.equal(r3.code, 0);
    assert.match(r3.out, /没有仓持有/);

    // 场景 d：空锚（无 goal.json）→ 说明行 exit 0
    const emptyAnchor = mkdtempSync(join(tmpdir(), "lzy-listempty-"));
    try {
      const r4 = lzy(["loop", "list", "--root", emptyAnchor], execRepo);
      assert.equal(r4.code, 0);
      assert.match(r4.out, /没有仓持有/);
    } finally {
      rmSync(emptyAnchor, { recursive: true, force: true });
    }
  } finally {
    rmSync(anchor, { recursive: true, force: true });
  }
});

test("register 写面入锁（R6A-1）：持锁即 5s 超时拦截，非锁外旁路", () => {
  const d = repo();
  try {
    // 活锁形态：.lock 在场且无 owner.json = 刚加的锁（withLock 判 ageMs=0 继续等满 deadline）
    mkdirSync(join(d, ".lazyzcode", "loop", ".lock"), { recursive: true });
    const r = lzy(["loop", "register", "lk", "--title", "t"], d);
    assert.equal(r.code, 1);
    assert.match(r.out, /持锁/); // 修复前 register 无视持锁直接成功写 goal.json
    assert.equal(existsSync(join(d, ".lazyzcode", "loop", "goal.json")), false);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("handoff 写面入锁（R6A-3）：过锁外预检后持锁即 5s 超时拦截", () => {
  const d = repo();
  try {
    // 前置：executing 态 + 真实新鲜快照，先过锁外两道预检才会阻塞在锁上
    assert.equal(lzy(["loop", "register", "hk", "--title", "t"], d).code, 0);
    const p = setup(d, THREE_STEPS);
    assert.equal(lzy(["loop", "plan", p], d).code, 0);
    assert.equal(lzy(["loop", "start"], d).code, 0);
    const snap = join(d, "snap.md");
    writeFileSync(snap, "handoff state");
    mkdirSync(join(d, ".lazyzcode", "loop", ".lock"), { recursive: true });
    const r = lzy(["loop", "handoff", "--snapshot", "snap.md"], d);
    assert.equal(r.code, 1);
    assert.match(r.out, /持锁/); // 修复前：锁外交写留下孤儿标记
    assert.equal(existsSync(join(d, ".lazyzcode", "loop", "handoff.json")), false);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("status 损坏 goal.json 降级（R6A-2）：单项 warn 不炸全套检查", () => {
  const d = repo();
  try {
    mkdirSync(join(d, ".lazyzcode", "loop"), { recursive: true });
    writeFileSync(join(d, ".lazyzcode", "loop", "goal.json"), JSON.stringify({ version: 99 }));
    const r = lzy(["status"], d);
    assert.equal(r.code, 0); // warn-only 不翻退出码（criticalFail 语义，对齐 doctor fail-soft）；修复前=单行 LoopError 炸掉全部且 exit 1
    assert.match(r.out, /goal 状态不可读/);
    assert.match(r.out, /版本不兼容/); // 原始成因信息保留
    assert.match(r.out, /install/); // 其余检查行仍在场（全套未丢）
    assert.match(r.out, /files/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
