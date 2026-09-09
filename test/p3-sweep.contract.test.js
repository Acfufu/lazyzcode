// P3 清账契约测试：评审轮 R1-3/R1-4/R1-5②/R2-8/R2-9/R2-10/R2-11/R3-7 + 启动器 spawn 面。
// 全部经 process.execPath（或 /bin/sh 字面量）拉起；不触碰真实 $HOME 与仓库 .lazyzcode/。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const HOOKS = join(ROOT, "plugin", "hooks");
const LAUNCHER = join(HOOKS, "run-hook.sh");

const scratch = () => mkdtempSync(join(tmpdir(), "lzy-p3-"));
const cleanup = (...dirs) => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
};

function lzy(args, cwd) {
  return spawnSync(process.execPath, [join(ROOT, "cli", "lzy.js"), ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
  });
}

// 在隔离目录里注册→采纳→开跑一个最小目标（git-less：N 项流转不依赖 git）。
function startGoal(d) {
  mkdirSync(join(d, ".lazyzcode", "plans"), { recursive: true });
  const plan = join(d, ".lazyzcode", "plans", "p.md");
  writeFileSync(plan, "- [N1] 实现步骤一\n- [N2] 实现步骤二\n- [F1] · 终验：CLI stdout 显示 ok\n");
  assert.equal(lzy(["loop", "register", "t1", "--title", "t"], d).status, 0);
  assert.equal(lzy(["loop", "plan", plan], d).status, 0);
  assert.equal(lzy(["loop", "start"], d).status, 0);
}

test("parseArgs：--force=true 布尔归一放行带未决标记计划；--force 前置不吞路径（R2-8）", () => {
  const d = scratch();
  try {
    mkdirSync(join(d, ".lazyzcode", "plans"), { recursive: true });
    const plan = join(d, ".lazyzcode", "plans", "p.md");
    writeFileSync(plan, "- [N1] 含未决字样：待定（--force 越过属设计内）\n");
    assert.equal(lzy(["loop", "register", "t1", "--title", "t"], d).status, 0);
    const r1 = lzy(["loop", "plan", plan, "--force=true"], d);
    assert.equal(r1.status, 0, r1.stderr || r1.stdout);
    const d2 = scratch();
    try {
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
      env: { ...process.env, HOME: h },
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

test("注册表字节幂等：重复 upsert 不重写、updatedAt 不漂移（R3-7）", () => {
  const d = scratch();
  try {
    const code = `
      import { upsertRegistryEntry } from ${JSON.stringify(join(ROOT, "core", "installer.js"))};
      import { installPathFor } from ${JSON.stringify(join(ROOT, "core", "paths.js"))};
      import { readFileSync, statSync, mkdirSync } from "node:fs";
      const m = { name: "lazyzcode", version: "0.0.1" };
      mkdirSync(installPathFor(m), { recursive: true });
      const p = installPathFor(m);
      upsertRegistryEntry(m, p);
      const rp = process.env.HOME + "/.zcode/cli/plugins/installed_plugins.json";
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
      env: { ...process.env, HOME: d },
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
      import { installPathFor } from ${JSON.stringify(join(ROOT, "core", "paths.js"))};
      const attempt = (m) => { try { installPathFor(m); return "no-throw"; } catch (e) { return e.message; } };
      console.log(JSON.stringify({
        badVersion: attempt({ name: "lazyzcode" }),
        badName: attempt({ name: "a/b", version: "1.0.0" }),
        ok: installPathFor({ name: "lazyzcode", version: "0.0.1" }),
      }));
    `;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      encoding: "utf8",
      env: { ...process.env, HOME: d },
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
      import { writeSessionCounter, readSessionCounter } from ${JSON.stringify(join(HOOKS, "hook-lib.js"))};
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

test("run-hook.sh：--print-node 解析；PATH-less 时 fallback 或 fail-open（分支 A）", () => {
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
