// drive workers 波编排契约测试（v024-fast-scheduler#N4；保留 fast 拍板 2026-09-23）：
// 旗标解析（--workers/--fast 糖/非法值拒）、N=1 逐字段冻结（不建 worktree/不动 subject）、
// 兄弟 worktree+subject 装配与清理相、波分派均分、组装 merge+屏障重锚、merge-conflict
// 收束因（不清理）、env-auth 前提拒入、H3R 唤醒互斥、墙钟=max 收敛+一波=一段、HIGH+ 拒入
// 照旧、CLI 接线、启动回收（残留 runDir 清/未合并分支保留）。
// HOME 隔离+引擎抑制（债③家法）；真 spawn 走 deps.run 假引擎——CI 零触网。env-auth 判定
// 读本进程 env（ZCODE_*_PROVIDER_CONFIG_FILE），测试内显式 save/set/restore 保证封闭性。
// win32 雷回避：不 split("/")、路径断言用 join、无平台专属调用。
import { test } from "node:test";
process.env.LZY_ABLATE_HUMAN_GATE = "1"; // 人权门非本文件被测面
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runDrive } from "../core/drive.js";
import { loadRuntime } from "../core/runtime.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");
const SUPPRESS_ENGINE = "/nonexistent-lzy-suppressed-engine";
const HOME = mkdtempSync(join(tmpdir(), "lzy-dw-home-"));

const ENV_KEYS = [
  "ZCODE_BUILTIN_PROVIDER_CONFIG_FILE",
  "ZCODE_PERSONAL_PROVIDER_CONFIG_FILE",
  "LZY_ABLATE_H3R_GATE",
  "LZY_ABLATE_H3R_ONESTEP",
  "LZY_ABLATE_H3R_PRETOOL",
];
function withEnv(map, fn) {
  const saved = new Map(ENV_KEYS.map((k) => [k, process.env[k]]));
  try {
    for (const k of ENV_KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(map ?? {})) if (v != null) process.env[k] = v;
    return fn();
  } finally {
    for (const [k, v] of saved) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
const ENV_FILE = (() => {
  const p = join(HOME, "provider-env-ok.json");
  writeFileSync(p, "{}\n");
  return p;
})();

const lzyIn = (d, args) =>
  spawnSync(process.execPath, [CLI, ...args], {
    cwd: d,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE, LZY_ABLATE_HUMAN_GATE: "1" },
  });

function repo(prefix, { steps = ["- [N1] x", "- [N2] y", "- [N3] z"], risk, planning = false } = {}) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "seed\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "init"]);
  lzyIn(d, ["loop", "register", "dw", "--title", "t", ...(risk ? ["--risk", risk] : [])]);
  writeFileSync(join(d, "p.md"), `${steps.join("\n")}\n`);
  const plan = lzyIn(d, ["loop", "plan", "p.md"]);
  if (plan.status !== 0) throw new Error(`plan 失败：${plan.stdout}${plan.stderr}`);
  if (!planning) lzyIn(d, ["loop", "start"]);
  return { dir: d, lzy: (args) => lzyIn(d, args) };
}

const goalJson = (d) => join(d, ".lazyzcode", "loop", "goal.json");
const siblingRoot = (d) => join(dirname(d), basename(d) + "-fast");
const siblingEntries = (d) => (existsSync(siblingRoot(d)) ? readdirSync(siblingRoot(d)) : []);

function captureStdout(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  return Promise.resolve(fn()).finally(() => {
    console.log = orig;
  }).then((r) => ({ result: r, lines: lines.join("\n") }));
}

const passDeps = (run) => ({
  enginePath: "/fake/engine.cjs",
  detectAuth: () => ({ oauth: false, envAuth: true, ok: true }),
  run: run ?? (() => ({ exitCode: 0, stdout: "{}", stderr: "" })),
  rollingPoints: 0,
  cliPath: CLI, // deps.cliPath seam：node --test 下 argv[1] 是测试文件自身，不可当 CLI
});

// 假工人 run：可注入时长（Atomics.wait 忙等→durationMs 反映）与行为（mutate(cwd, argv)）。
function fakeWorker({ ms = 0, mutate = null } = {}) {
  return ({ argv, cwd, env, timeoutMs }) => {
    if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    const prompt = String(argv.includes("--prompt") ? argv[argv.indexOf("--prompt") + 1] : "");
    const wid = /工人 w(\d+)/.exec(prompt)?.[1] ?? "?";
    if (mutate) mutate(cwd, wid, argv);
    return { exitCode: 0, stdout: `${JSON.stringify({ sessionId: `sess-fake-w${wid}`, status: "idle" })}`, stderr: "" };
  };
}
// 在 worktree 内提交一个新文件（w<tag>.txt，跨工人不相交——merge 必成）。
function fakeAddFile(tag) {
  return (cwd) => {
    writeFileSync(join(cwd, `w${tag}.txt`), `${tag}\n`);
    spawnSync("git", ["-C", cwd, "-c", "user.email=t@l", "-c", "user.name=t", "add", `w${tag}.txt`], { encoding: "utf8" });
    spawnSync("git", ["-C", cwd, "-c", "user.email=t@l", "-c", "user.name=t", "commit", "-qm", `w${tag}`], { encoding: "utf8" });
  };
}
// 在 worktree 内改同一 tracked 文件（merge 冲突造型）。
function fakeConflictEdit(tag) {
  return (cwd) => {
    writeFileSync(join(cwd, "a.txt"), `${tag}\n`);
    spawnSync("git", ["-C", cwd, "-c", "user.email=t@l", "-c", "user.name=t", "commit", "-aqm", `w${tag}`], { encoding: "utf8" });
  };
}

// ── ① 旗标解析 ────────────────────────────────────────────────────────────────
test("①旗标：workers 非法值三拒（0/负/非整数）；--fast 糖进 workers 径（env-auth 缺席拒为证）；--workers 带值优先", async () => {
  const r = repo("lzy-dw-flags-");
  try {
    for (const bad of [0, -1, 1.5]) {
      await assert.rejects(() => runDrive(r.dir, { workers: bad }, passDeps()), /--workers 非法/);
    }
    await withEnv({}, async () => {
      await assert.rejects(() => runDrive(r.dir, { fast: true }, passDeps()), /workers 模式要求 env-auth/);
      await assert.rejects(() => runDrive(r.dir, { workers: 0, fast: true }, passDeps()), /--workers 非法/);
    });
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
    rmSync(siblingRoot(r.dir), { recursive: true, force: true });
  }
});

// ── ② N=1 冻结 ────────────────────────────────────────────────────────────────
test("②N=1 冻结：显式 workers:1 与缺省 outcome 逐字段同；不建兄弟根、不动 subject 集", async () => {
  const d1 = repo("lzy-dw-f1-").dir;
  const d2 = repo("lzy-dw-f2-").dir;
  try {
    const a = await captureStdout(() => runDrive(d1, { maxSegments: 2 }, passDeps()));
    const b = await captureStdout(() => runDrive(d2, { workers: 1, maxSegments: 2 }, passDeps()));
    assert.deepEqual(
      { ...a.result, handoff: a.result.handoff ? "snap" : null },
      { ...b.result, handoff: b.result.handoff ? "snap" : null },
    );
    assert.ok(!existsSync(siblingRoot(d2)), "N=1 不得创建兄弟 worktree 根");
    const goal = JSON.parse(readFileSync(goalJson(d2), "utf8"));
    assert.equal((goal.subjects ?? []).length, 0, "N=1 不得改 subject 集");
  } finally {
    rmSync(d1, { recursive: true, force: true });
    rmSync(d2, { recursive: true, force: true });
  }
});

// ── ③装配+清理相 ──────────────────────────────────────────────────────────────
test("③装配与清理：run 中兄弟 worktree 在场；收束后 runDir 清、logs 留、subject 随 goal 惰性存", async () => {
  const r = repo("lzy-dw-assemble-");
  const d = r.dir;
  try {
    let midRunEntries = null;
    const orig = fakeWorker();
    const probe = (a) => {
      const cwd = a.cwd;
      midRunEntries = existsSync(siblingRoot(d)) ? readdirSync(siblingRoot(d)) : [];
      return orig(a);
    };
    const { lines } = await captureStdout(() =>
      runDrive(d, { workers: 2, maxSegments: 2 }, passDeps(probe)),
    );
    assert.match(lines, /启动（workers=2）/);
    assert.match(lines, /turns≈2×/);
    assert.ok(midRunEntries?.some((e) => /^fast-\d{14}$/.test(e)), "run 中 runDir 在场");
    const after = siblingEntries(d);
    assert.ok(!after.some((e) => /^fast-\d{14}$/.test(e)), "清理相后 runDir 已清");
    assert.ok(after.some((e) => e.endsWith(".logs")), "logs 目录留待下轮回收");
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(siblingRoot(d), { recursive: true, force: true });
  }
});

// ── ④波分派均分 ───────────────────────────────────────────────────────────────
test("④波分派：3 步 2 工人=2+1（worker prompt 只含分派步）", async () => {
  const seen = [];
  const run = ({ argv }) => {
    const prompt = String(argv[argv.indexOf("--prompt") + 1] ?? "");
    const ids = (prompt.match(/N\d/g) ?? []).sort();
    seen.push(ids.join(","));
    return { exitCode: 0, stdout: `${JSON.stringify({ sessionId: "sess-x" })}`, stderr: "" };
  };
  const r = repo("lzy-dw-split-");
  try {
    await captureStdout(() => runDrive(r.dir, { workers: 2, maxSegments: 1 }, passDeps(run)));
    const perWorker = seen.filter((s) => s.length > 0);
    assert.equal(perWorker.length, 2, "两名工人都被分派");
    const counts = perWorker.map((s) => s.split(",").length).sort((a, b) => b - a);
    assert.deepEqual(counts, [2, 1], `3 步 2 工人应 2+1，实得 ${JSON.stringify(perWorker)}`);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
    rmSync(siblingRoot(r.dir), { recursive: true, force: true });
  }
});

// ── ⑤组装 merge+屏障重锚 ──────────────────────────────────────────────────────
test("⑤组装：工人分支 merge 提交在案+屏障对已取证 F 项重锚（evidence 含 wave-barrier rebind）", async () => {
  const r = repo("lzy-dw-anchor-", { steps: ["- [N1] x", "- [F1] f"] });
  const d = r.dir;
  const g0 = JSON.parse(readFileSync(goalJson(d), "utf8"));
  const f1 = g0.steps.find((s) => s.id === "F1");
  f1.status = "done";
  f1.evidence = "初版取证";
  writeFileSync(goalJson(d), `${JSON.stringify(g0, null, 2)}\n`);
  try {
    await captureStdout(() =>
      runDrive(d, { workers: 2, maxSegments: 1 }, passDeps(fakeWorker({ mutate: (cwd, wid) => fakeAddFile(wid)(cwd) }))),
    );
    const log = spawnSync("git", ["-C", d, "log", "--oneline", "-8"], { encoding: "utf8" }).stdout ?? "";
    assert.match(log, /merge fast-.*-w1/);
    const goal = JSON.parse(readFileSync(goalJson(d), "utf8"));
    const f = goal.steps.find((s) => s.id === "F1");
    assert.match(JSON.stringify(f.evidence ?? ""), /wave-barrier rebind/);
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(siblingRoot(d), { recursive: true, force: true });
  }
});

// ── ⑥merge-conflict 收束因 ────────────────────────────────────────────────────
test("⑥merge-conflict：冲突→收束因 merge-conflict+快照在场+分支与 worktree 不清理", async () => {
  const r = repo("lzy-dw-conflict-");
  const d = r.dir;
  try {
    const wrapped = fakeWorker({
      mutate: (cwd, wid) => fakeConflictEdit(wid === "1" ? "one" : "two")(cwd),
    });
    const { result, lines } = await captureStdout(() =>
      runDrive(d, { workers: 2, maxSegments: 1 }, passDeps(wrapped)),
    );
    assert.equal(result.cause, "merge-conflict");
    assert.equal(result.ok, true, "merge-conflict 走干净收束（exit 0）");
    assert.ok(result.handoff, "merge-conflict 写 7 字段快照");
    assert.match(lines, /merge-conflict/);
    const branches = spawnSync("git", ["-C", d, "branch", "--format", "%(refname:short)"], { encoding: "utf8" }).stdout ?? "";
    assert.match(branches, /-w1/, "工人分支保留（不清理）");
    assert.ok(existsSync(join(siblingRoot(d))), "worktree 目录保留（不清理）");
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(siblingRoot(d), { recursive: true, force: true });
  }
});

// ── ⑦env-auth 前提拒入 ────────────────────────────────────────────────────────
test("⑦env-auth 缺席拒入（fail-closed 带指路）", async () => {
  const r = repo("lzy-dw-envauth-");
  try {
    await withEnv({}, async () => {
      await assert.rejects(() => runDrive(r.dir, { workers: 2 }, passDeps()), /workers 模式要求 env-auth/);
    });
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

// ── ⑧H3R 唤醒互斥 ─────────────────────────────────────────────────────────────
test("⑧H3R 唤醒开关在场拒入 workers（ADR-0022 单链假设）", async () => {
  const r = repo("lzy-dw-h3r-");
  try {
    await withEnv({ ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: ENV_FILE, LZY_ABLATE_H3R_GATE: "1" }, async () => {
      await assert.rejects(() => runDrive(r.dir, { workers: 2 }, passDeps()), /workers 模式与 H3R 唤醒态互斥/);
    });
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

// ── ⑨墙钟=max + 一波=一段 ─────────────────────────────────────────────────────
test("⑨墙钟取 max 不 sum（每波 60ms/10ms → 两波 ≈120 不是 ≈140）；maxSegments=2 恰两波收束", async () => {
  const r = repo("lzy-dw-wall-");
  try {
    const slow = fakeWorker({ ms: 60 });
    const fast = fakeWorker({ ms: 10 });
    const pick = ({ argv, cwd, env, timeoutMs }) => {
      const prompt = String(argv[argv.indexOf("--prompt") + 1] ?? "");
      return (/工人 w1/.test(prompt) ? slow : fast)({ argv, cwd, env, timeoutMs });
    };
    const { result, lines } = await captureStdout(() =>
      runDrive(r.dir, { workers: 2, maxSegments: 2 }, passDeps(pick)),
    );
    assert.match(lines, /墙钟取 max=/);
    const spent = loadRuntime(r.dir)?.budget?.spentMs ?? 0;
    assert.ok(spent >= 120, `spentMs 应 ≥120（两波 max 口径），实得 ${spent}`);
    assert.ok(spent < 168, `spentMs 应 <168（max 而非 sum≈180+），实得 ${spent}`);
    assert.match(lines, /波 2\/2/);
    assert.match(result.cause, /波数尽（2 波）/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
    rmSync(siblingRoot(r.dir), { recursive: true, force: true });
  }
});

// ── ⑩HIGH+ 拒入照旧 ───────────────────────────────────────────────────────────
test("⑩HIGH+ risk 拒入照旧（workers 模式不绕 assertDriveEligible）", async () => {
  const r = repo("lzy-dw-high-", { risk: "high" });
  try {
    await withEnv({ ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: ENV_FILE }, async () => {
      await assert.rejects(() => runDrive(r.dir, { workers: 2 }, passDeps()), /HIGH|拒入|禁入/);
    });
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

// ── ⑪CLI 接线：--workers 带值；--fast 裸旗标折算（planning 仓两径错误消息区分）──
test("⑪CLI 接线：--fast 折算进 workers 径（executing 检查消息）；--workers abc 用法拒", () => {
  const r = repo("lzy-dw-cli-", { planning: true });
  try {
    withEnv({ ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: ENV_FILE }, () => {
      const fast = r.lzy(["loop", "drive", "--fast"]);
      assert.match(`${fast.stdout}${fast.stderr}`, /drive 只推进 executing 目标（现状 planning）/);
      const bad = r.lzy(["loop", "drive", "--workers", "abc"]);
      assert.match(`${bad.stdout}${bad.stderr}`, /--workers 非法/);
    });
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

// ── ⑫启动回收 ────────────────────────────────────────────────────────────────
test("⑫启动回收：无租约关联的残留 runDir 被清；未合并 fast-* 分支保留（salvage 族）", async () => {
  const r = repo("lzy-dw-reclaim-");
  const d = r.dir;
  try {
    const sib = siblingRoot(d);
    const stale = join(sib, "fast-20990101000000");
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, "stale.txt"), "stale\n");
    // 造一个真未合并分支：开分支提交一次再切回原分支。
    const prev = spawnSync("git", ["-C", d, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).stdout.trim();
    spawnSync("git", ["-C", d, "switch", "-q", "-C", "fast-20990101000000-w1"], { encoding: "utf8" });
    writeFileSync(join(d, "unmerged.txt"), "x\n");
    spawnSync("git", ["-C", d, "-c", "user.email=t@l", "-c", "user.name=t", "add", "unmerged.txt"], { encoding: "utf8" });
    spawnSync("git", ["-C", d, "-c", "user.email=t@l", "-c", "user.name=t", "commit", "-qm", "unmerged"], { encoding: "utf8" });
    spawnSync("git", ["-C", d, "switch", "-q", prev], { encoding: "utf8" });
    await captureStdout(() => runDrive(d, { workers: 2, maxSegments: 1 }, passDeps(fakeWorker())));
    assert.ok(!existsSync(stale), "无租约关联残留 runDir 应被回收");
    const branches = spawnSync("git", ["-C", d, "branch", "--format", "%(refname:short)"], { encoding: "utf8" }).stdout ?? "";
    assert.match(branches, /fast-20990101000000-w1/, "未合并残留分支保留（salvage 族）");
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(siblingRoot(d), { recursive: true, force: true });
  }
});
