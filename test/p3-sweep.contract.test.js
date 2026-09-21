// P3 清账契约测试：评审轮 R1-3/R1-4/R1-5②/R2-8/R2-9/R2-10/R2-11/R3-7 + 启动器 spawn 面。
// 全部经 process.execPath（或 /bin/sh 字面量）拉起；不触碰真实 $HOME 与仓库 .lazyzcode/。
import { test } from "node:test";
// 人权门非本文件被测面（门由 human-gate.contract.test.js 两面钉）——spawn 继承此 env 保采纳畅通
process.env.LZY_ABLATE_HUMAN_GATE = "1";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const HOOKS = join(ROOT, "plugin", "hooks");
const LAUNCHER = join(HOOKS, "run-hook"); // POSIX 面（win32 走 run-hook.cmd 孪生，见启动器契约）
const LAUNCHER_WIN = join(HOOKS, "run-hook.cmd");

const scratch = () => mkdtempSync(join(tmpdir(), "lzy-p3-"));
const cleanup = (...dirs) => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
};

const ISOLATED_HOME = mkdtempSync(join(tmpdir(), "lzy-p3-home-")); // HOME 隔离(goal ratelimit-scan-budget):不读真实引擎日志

function lzy(args, cwd) {
  return spawnSync(process.execPath, [join(ROOT, "cli", "lzy.js"), ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, HOME: ISOLATED_HOME, USERPROFILE: ISOLATED_HOME },
  });
}

// 在隔离目录里注册→采纳→开跑一个最小目标（git-less：N 项流转不依赖 git）。
function startGoal(d) {
  mkdirSync(join(d, ".lazyzcode", "plans"), { recursive: true });
  const plan = join(d, ".lazyzcode", "plans", "p.md");
  writeFileSync(plan, "- [N1] 实现步骤一\n- [N2] 实现步骤二\n- [F1] · 终验：CLI stdout 显示 ok\n");
  gitInit(d); // 非 git 宿主 register 硬拒（ADR-0019，0.1.1）：夹具补 git 初始化
  assert.equal(lzy(["loop", "register", "t1", "--title", "t"], d).status, 0);
  assert.equal(lzy(["loop", "plan", plan], d).status, 0);
  assert.equal(lzy(["loop", "start"], d).status, 0);
}

// 非 git 宿主 register 硬拒（ADR-0019）的夹具侧适配：注册类用例先落 git 仓
function gitInit(d) {
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "a\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "init"]);
}

test("parseArgs：--force=true 布尔归一放行带未决标记计划；--force 前置不吞路径（R2-8）", () => {
  const d = scratch();
  try {
    gitInit(d);
    mkdirSync(join(d, ".lazyzcode", "plans"), { recursive: true });
    const plan = join(d, ".lazyzcode", "plans", "p.md");
    writeFileSync(plan, "- [N1] 含未决字样：待定（--force 越过属设计内）\n");
    assert.equal(lzy(["loop", "register", "t1", "--title", "t"], d).status, 0);
    const r1 = lzy(["loop", "plan", plan, "--force=true"], d);
    assert.equal(r1.status, 0, r1.stderr || r1.stdout);
    const d2 = scratch();
    try {
      gitInit(d2);
      assert.equal(lzy(["loop", "register", "t2", "--title", "t"], d2).status, 0);
      const r2 = lzy(["loop", "plan", "--force", plan], d2);
      assert.equal(r2.status, 0, r2.stderr || r2.stdout);
    } finally {
      cleanup(d2);
    }
  } finally {
    cleanup(d);
  }
});

test("step done：note 301 拒 / 300 收；evidence 4001 拒（R2-9）", () => {
  const d = scratch();
  try {
    startGoal(d);
    const badNote = lzy(["step", "done", "N1", "--note", "x".repeat(301)], d);
    assert.equal(badNote.status, 1);
    assert.match(badNote.stderr, /--note 超上限 300/);
    assert.equal(lzy(["step", "done", "N1", "--note", "y".repeat(300)], d).status, 0);
    const badEv = lzy(["step", "done", "F1", "--evidence", "e".repeat(4001)], d);
    assert.equal(badEv.status, 1);
    assert.match(badEv.stderr, /--evidence 超上限 4000/);
  } finally {
    cleanup(d);
  }
});

test("goal 版本不兼容快败并指路 reset（R2-10）", () => {
  const d = scratch();
  try {
    startGoal(d);
    const gp = join(d, ".lazyzcode", "loop", "goal.json");
    const g = JSON.parse(readFileSync(gp, "utf8"));
    g.version = 99;
    writeFileSync(gp, JSON.stringify(g));
    const r = lzy(["loop", "status"], d);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /版本不兼容/);
  } finally {
    cleanup(d);
  }
});

test("reset 连带清理会话计数与孤儿 tmp；无目标无残留时拒绝（R2-11）", () => {
  const d = scratch();
  try {
    startGoal(d);
    writeFileSync(join(d, ".lazyzcode", "loop", ".goal.json.999.123.tmp"), "x");
    mkdirSync(join(d, ".lazyzcode", "loop", "sessions"), { recursive: true });
    writeFileSync(join(d, ".lazyzcode", "loop", "sessions", "s.json"), "{}");
    assert.equal(lzy(["loop", "reset"], d).status, 0);
    const loopDir = join(d, ".lazyzcode", "loop");
    assert.equal(readdirSync(loopDir).filter((f) => f.endsWith(".tmp")).length, 0);
    assert.equal(readdirSync(join(loopDir, "sessions")).length, 0);
    const r2 = lzy(["loop", "reset"], d);
    assert.equal(r2.status, 1);
    assert.match(r2.stderr, /无需 reset/);
  } finally {
    cleanup(d);
  }
});

test("doctor 疤痕巡逻（ADR-0006）：空壳 loop 目录→warn 指手动 rm；目录缺席→干净", () => {
  const runDoctor = (d, h) =>
    spawnSync(process.execPath, [join(ROOT, "cli", "lzy.js"), "doctor"], {
      cwd: d,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, HOME: h, USERPROFILE: h },
    });
  const lineOf = (out, name) => out.split(/\r?\n/).find((l) => l.includes(name));
  // 疤痕态：有 .lazyzcode/loop/ 无 goal.json（旧版写命令疤痕）→ warn 且指引手动 rm -r；
  // 并与 reset 互证：null-goal 空壳报「无需 reset」，清不掉目录本身
  const d1 = scratch();
  const h1 = scratch();
  try {
    mkdirSync(join(d1, ".lazyzcode", "loop"), { recursive: true });
    const r = runDoctor(d1, h1);
    const state = lineOf(`${r.stdout ?? ""}${r.stderr ?? ""}`, "state");
    assert.ok(state, "doctor 输出应含 state 行");
    assert.match(state, /空壳疤痕/);
    assert.match(state, /rm -r/);
    const r2 = lzy(["loop", "reset"], d1);
    assert.equal(r2.status, 1);
    assert.match(r2.stderr, /无需 reset/);
  } finally {
    cleanup(d1, h1);
  }
  // 干净态：目录整体缺席 → ok（不误报疤痕）
  const d2 = scratch();
  const h2 = scratch();
  try {
    const r = runDoctor(d2, h2);
    const state = lineOf(`${r.stdout ?? ""}${r.stderr ?? ""}`, "state");
    assert.ok(state, "doctor 输出应含 state 行");
    assert.match(state, /干净/);
    assert.doesNotMatch(state, /疤痕/);
  } finally {
    cleanup(d2, h2);
  }
});

test("doctor 疤痕巡逻豁免 metrics.json（放行计数跨 reset 永续，非疤痕）", () => {
  const runDoctor = (d, h) =>
    spawnSync(process.execPath, [join(ROOT, "cli", "lzy.js"), "doctor"], {
      cwd: d,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, HOME: h, USERPROFILE: h },
    });
  const lineOf = (out, name) => out.split(/\r?\n/).find((l) => l.includes(name));
  const d1 = scratch();
  const h1 = scratch();
  try {
    const loop = join(d1, ".lazyzcode", "loop");
    mkdirSync(loop, { recursive: true });
    // 仅剩 metrics.json（reset 后的常态：计数永续、goal 已清）→ 不算疤痕
    writeFileSync(join(loop, "metrics.json"), JSON.stringify({ registered: 3, consumed: 1 }));
    const r = runDoctor(d1, h1);
    const state = lineOf(`${r.stdout ?? ""}${r.stderr ?? ""}`, "state");
    assert.ok(state, "doctor 输出应含 state 行");
    assert.doesNotMatch(state, /疤痕/);
    // 连同 salvage/ 一起在（既有豁免不受影响）→ 仍不算疤痕
    mkdirSync(join(loop, "salvage"), { recursive: true });
    writeFileSync(join(loop, "salvage", "x.md"), "# stub");
    const r2 = runDoctor(d1, h1);
    assert.doesNotMatch(lineOf(`${r2.stdout ?? ""}${r2.stderr ?? ""}`, "state") ?? "", /疤痕/);
    // 计数文件在场 → handoff-usage 读面行同步可见（status 面，doctor 继承）
    assert.match(`${r2.stdout ?? ""}${r2.stderr ?? ""}`, /handoff-usage/);
    // 空 sessions/（reset 清内容留目录的正常残留）→ 仍不算疤痕；非空已由残留分支分流
    mkdirSync(join(loop, "sessions"), { recursive: true });
    const r3 = runDoctor(d1, h1);
    assert.doesNotMatch(lineOf(`${r3.stdout ?? ""}${r3.stderr ?? ""}`, "state") ?? "", /疤痕/);
  } finally {
    cleanup(d1, h1);
  }
});

test("注册表字节幂等：重复 upsert 不重写、updatedAt 不漂移（R3-7）", () => {
  const d = scratch();
  try {
    const code = `
      import { upsertRegistryEntry } from ${JSON.stringify(pathToFileURL(join(ROOT, "core", "installer.js")).href)};
      import { installPathFor } from ${JSON.stringify(pathToFileURL(join(ROOT, "core", "paths.js")).href)};
      import { readFileSync, statSync, mkdirSync } from "node:fs";
      import { homedir } from "node:os";
      import { join as pjoin } from "node:path";
      const m = { name: "lazyzcode", version: "0.0.1" };
      mkdirSync(installPathFor(m), { recursive: true });
      const p = installPathFor(m);
      upsertRegistryEntry(m, p);
      const rp = pjoin(homedir(), ".zcode", "cli", "plugins", "installed_plugins.json");
      const b1 = readFileSync(rp, "utf8");
      const t1 = statSync(rp).mtimeMs;
      upsertRegistryEntry(m, p);
      console.log(JSON.stringify({
        same: b1 === readFileSync(rp, "utf8"),
        mtimeSame: t1 === statSync(rp).mtimeMs,
      }));
    `;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      encoding: "utf8",
      env: { ...process.env, HOME: d, USERPROFILE: d },
      timeout: 30_000,
    });
    assert.equal(r.status, 0, r.stderr);
    const o = JSON.parse(r.stdout.trim());
    assert.equal(o.same, true);
    assert.equal(o.mtimeSame, true);
  } finally {
    cleanup(d);
  }
});

test("installPathFor：name/version 白名单校验、非法即清晰报错（R1-5②）", () => {
  const d = scratch();
  try {
    const code = `
      import { installPathFor } from ${JSON.stringify(pathToFileURL(join(ROOT, "core", "paths.js")).href)};
      const attempt = (m) => { try { installPathFor(m); return "no-throw"; } catch (e) { return e.message; } };
      console.log(JSON.stringify({
        badVersion: attempt({ name: "lazyzcode" }),
        badName: attempt({ name: "a/b", version: "1.0.0" }),
        ok: installPathFor({ name: "lazyzcode", version: "0.0.1" }),
      }));
    `;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      encoding: "utf8",
      env: { ...process.env, HOME: d, USERPROFILE: d },
      timeout: 30_000,
    });
    assert.equal(r.status, 0, r.stderr);
    const o = JSON.parse(r.stdout.trim());
    assert.match(o.badVersion, /manifest\.version 不合法/);
    assert.match(o.badName, /manifest\.name 不合法/);
    assert.match(o.ok, /cache/);
  } finally {
    cleanup(d);
  }
});

test("sessionId 消毒：恶意 id 不逸出 sessions/ 目录（R1-3）", () => {
  const d = scratch();
  try {
    const code = `
      import { writeSessionCounter, readSessionCounter } from ${JSON.stringify(pathToFileURL(join(HOOKS, "hook-lib.js")).href)};
      const evil = "../../evil";
      writeSessionCounter(${JSON.stringify(d)}, evil, 1);
      console.log(JSON.stringify({ read: readSessionCounter(${JSON.stringify(d)}, evil) }));
    `;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout.trim()).read, 1);
    // 状态文件确实落在 sessions/ 内且名字已消毒；上层目录无逸出物
    const files = readdirSync(join(d, ".lazyzcode", "loop", "sessions"));
    assert.deepEqual(files, [".._.._evil.json"]);
  } finally {
    cleanup(d);
  }
});

test("withSessionLock：owner 缺席的陈旧锁按锁目录 mtime 回收（V021-ADJ-59）", () => {
  const d = scratch();
  try {
    // 复现形态：mkdirSync(lock) 与 writeFileSync(owner) 之间持锁进程被强杀 → 锁目录无 owner、
    // 且永远无人再写它。旧实现 owner stat 失败即 ageMs=0（注释当「刚加的锁」），锁永不回收，
    // 此后该会话每个 Stop 白等 SESSION_LOCK_WAIT_MS=2s 才无锁放行。
    const lock = join(d, ".lazyzcode", "loop", "sessions", ".lock-s");
    mkdirSync(lock, { recursive: true });
    const old = Date.now() / 1000 - 60; // 锁目录 mtime 回拨 60s（远超 5s 陈旧线）
    utimesSync(lock, old, old);
    const code = `
      import { withSessionLock } from ${JSON.stringify(pathToFileURL(join(HOOKS, "hook-lib.js")).href)};
      const t0 = Date.now();
      const r = withSessionLock(${JSON.stringify(d)}, "s", () => "ran");
      console.log(JSON.stringify({ r, elapsedMs: Date.now() - t0 }));
    `;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(r.status, 0, r.stderr);
    const o = JSON.parse(r.stdout.trim());
    assert.equal(o.r, "ran", "陈旧锁回收后临界段照常执行");
    assert.ok(o.elapsedMs < 1_000, `陈旧锁须立即回收（elapsedMs=${o.elapsedMs}；旧实现要等满 2s）`);
    assert.equal(existsSync(lock), false, "临界段结束释放锁");
  } finally {
    cleanup(d);
  }
});

test("stop 并发：同会话 6 连发续跑发放不超过 2（R1-4 锁语义）", () => {
  const d = scratch();
  try {
    mkdirSync(join(d, ".lazyzcode", "loop"), { recursive: true });
    writeFileSync(
      join(d, ".lazyzcode", "loop", "goal.json"),
      JSON.stringify({
        version: 1,
        slug: "t",
        title: "t",
        status: "executing",
        steps: [{ id: "N1", kind: "N", status: "pending" }],
      }),
    );
    const inp = JSON.stringify({ sessionId: "conc", cwd: d });
    const procs = Array.from({ length: 6 }, () =>
      spawnSync(process.execPath, [join(HOOKS, "stop.js")], {
        input: inp,
        encoding: "utf8",
        timeout: 20_000,
      }),
    );
    assert.ok(procs.every((r) => r.status === 0));
    const continues = procs.filter((r) => {
      try {
        return JSON.parse(r.stdout).continue === true;
      } catch {
        return false;
      }
    }).length;
    assert.ok(continues <= 2, `continues=${continues}（预算须 ≤2）`);
  } finally {
    cleanup(d);
  }
});

test("run-hook 启动器：--print-node 解析；PATH-less 时 fallback 或 fail-open（分支 A；win32 走 .cmd 孪生）", () => {
  if (process.platform === "win32") {
    // Node ≥18 对 .cmd 直接 spawn 抛 EINVAL（CVE-2024-27980），doctor 同款显式过 cmd
    const comspec = process.env.ComSpec ?? "cmd.exe";
    const probe = (args, env) =>
      spawnSync(comspec, ["/d", "/s", "/c", `"${LAUNCHER_WIN}" ${args.join(" ")}`], {
        encoding: "utf8",
        // 30s 同本文件其余 win32 探针预算（216/242/265）：runner 上 cmd→批处理→node 单趟
        // 延迟实测 0.1s–2s 波动，10s 上限在 5.4s 基线旁贴线偶发误杀（2026-09-15 CI 实录）
        timeout: 30_000,
        windowsVerbatimArguments: true,
        input: "",
        ...(env ? { env } : {}),
      });
    const r1 = probe(["--print-node"]);
    assert.equal(r1.status, 0);
    assert.match(r1.stdout.trim(), /node(\.exe)?$/);
    const strippedEnv = { PATH: join(process.env.SystemRoot ?? "C:\\Windows", "System32"), SystemRoot: process.env.SystemRoot ?? "C:\\Windows", USERPROFILE: process.env.USERPROFILE ?? "" };
    const r2 = probe(["--print-node"], strippedEnv);
    if (r2.status === 0) {
      assert.match(r2.stdout.trim(), /node(\.exe)?$/);
      const r3 = probe(["stop.js"], strippedEnv);
      assert.equal(r3.status, 0);
      assert.equal(r3.stdout.trim(), "{}");
    } else {
      // 回退链彻底落空：exit 0 静默放行（fail-open），绝不阻断
      const r3 = probe(["stop.js"], strippedEnv);
      assert.equal(r3.status, 0);
      assert.equal(r3.stdout.trim(), "");
    }
    return;
  }
  const r1 = spawnSync("/bin/sh", [LAUNCHER, "--print-node"], { encoding: "utf8", timeout: 10_000 });
  assert.equal(r1.status, 0);
  assert.match(r1.stdout.trim(), /node$/);
  const strippedEnv = { PATH: "/usr/bin:/bin", HOME: process.env.HOME ?? "" };
  const spawnStripped = (args, input) =>
    spawnSync("/bin/sh", [LAUNCHER, ...args], {
      encoding: "utf8",
      timeout: 10_000,
      env: strippedEnv,
      input,
    });
  const r2 = spawnStripped(["--print-node"], "");
  if (r2.status === 0) {
    // 本机（nvm/homebrew fallback 命中）：钩子全链可拉起，空 stdin → failOpen {}
    assert.match(r2.stdout.trim(), /node$/);
    const r3 = spawnStripped(["stop.js"], "");
    assert.equal(r3.status, 0);
    assert.equal(r3.stdout.trim(), "{}");
  } else {
    // CI（无 fallback 可用）：启动器彻底落空也必须 exit 0 静默放行，绝不阻断
    const r3 = spawnStripped(["stop.js"], "");
    assert.equal(r3.status, 0);
    assert.equal(r3.stdout.trim(), "");
  }
});

test("run-hook：nvm 候选按版本序取最大——v9 残留 + v24 并存时选 v24（V021-ADJ-57）", () => {
  if (process.platform === "win32") return; // POSIX 面（win32 孪生逻辑同语义，不在此夹具内）
  const home = scratch();
  try {
    // 三个 nvm 候选，字典序最后 = v9.11.2（"v9" > "v2x" 逐字节）——旧 last-wins 选中它，
    // Node 9 跑 ESM 钩子=解析即失败，六钩子全灭且此路径无 fail-open 日志。
    for (const v of ["v9.11.2", "v20.11.0", "v24.19.0"]) {
      const bin = join(home, ".nvm", "versions", "node", v, "bin");
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, "node"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    }
    const r = spawnSync("/bin/sh", [LAUNCHER, "--print-node"], {
      encoding: "utf8",
      timeout: 10_000,
      env: { PATH: "/usr/bin:/bin", HOME: home }, // PATH 无 node → 走 nvm fallback
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout.trim(), /v24\.19\.0\/bin\/node$/, "取版本最大者而非字典序最后");
  } finally {
    cleanup(home);
  }
});

const HAS_SQLITE3 = spawnSync("sqlite3", ["--version"], { timeout: 5_000 }).status === 0;

test("orphan-wake doctor 检查（plan-v2 Phase 2-4）：无索引 skip/零 wake skip/空转 warn/喂活 ok", { skip: !HAS_SQLITE3 }, () => {
  const lineOf = (out, name) => out.split(/\r?\n/).find((l) => l.includes(name));
  const mkIdx = (home, extraSql) => {
    const dir = join(home, ".zcode", "v2");
    mkdirSync(dir, { recursive: true });
    const schema =
      "CREATE TABLE automations (automation_id TEXT, workspace_path TEXT, enabled INTEGER, lifecycle_status TEXT, target_task_id TEXT);" +
      "CREATE TABLE automation_runs (automation_id TEXT, outcome TEXT, scheduled_at INTEGER);";
    const r = spawnSync("sqlite3", [join(dir, "tasks-index.sqlite"), schema + (extraSql ?? "")], {
      timeout: 10_000,
    });
    assert.equal(r.status, 0);
  };
  const runDoctor = (d, h) =>
    spawnSync(process.execPath, [join(ROOT, "cli", "lzy.js"), "doctor"], {
      cwd: d,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, HOME: h, USERPROFILE: h },
    });
  const d1 = scratch();
  const h1 = scratch(); // 无索引库
  const d2 = scratch();
  const h2 = scratch();
  mkIdx(h2, ""); // 库在但零 automation
  const d3 = scratch();
  const h3 = scratch();
  const now = Date.now();
  mkIdx(
    h3,
    `INSERT INTO automations VALUES ('w1','${d3}',1,'active',NULL);` +
      [0, 1, 2].map((i) => `INSERT INTO automation_runs VALUES ('w1','succeeded',${now - i * 3_600_000});`).join(""),
  );
  const d4 = scratch();
  const h4 = scratch();
  mkIdx(h4, `INSERT INTO automations VALUES ('w4','${d4}',1,'active',NULL);`);
  try {
    mkdirSync(join(d4, ".lazyzcode", "loop"), { recursive: true });
    writeFileSync(
      join(d4, ".lazyzcode", "loop", "goal.json"),
      JSON.stringify({ slug: "t", title: "t", status: "executing", steps: [{ id: "N1", kind: "N", status: "pending" }] }),
    );
    const s1 = lineOf(`${runDoctor(d1, h1).stdout ?? ""}`, "orphan-wake");
    assert.match(s1, /无宿主自动化索引库/);
    const s2 = lineOf(`${runDoctor(d2, h2).stdout ?? ""}`, "orphan-wake");
    assert.match(s2, /无 unbound wake/);
    const s3 = lineOf(`${runDoctor(d3, h3).stdout ?? ""}`, "orphan-wake");
    assert.match(s3, /orphan 空转面/);
    const s4 = lineOf(`${runDoctor(d4, h4).stdout ?? ""}`, "orphan-wake");
    assert.match(s4, /正常喂活/);
  } finally {
    cleanup(d1, h1, d2, h2, d3, d4, h3, h4);
  }
});
