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

function repo(prefix, { steps = ["- [N1] x", "- [N2] y", "- [N3] z"], risk, planning = false, tier } = {}) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "seed\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "init"]);
  lzyIn(d, ["loop", "register", "dw", "--title", "t", ...(risk ? ["--risk", risk] : []), ...(tier ? ["--tier", tier] : [])]);
  writeFileSync(join(d, "p.md"), `${steps.join("\n")}\n`);
  const plan = lzyIn(d, ["loop", "plan", "p.md", ...(tier === "heavy" ? ["--review", "plan-reviewer: PASS — 夹具"] : [])]);
  if (plan.status !== 0) throw new Error(`plan 失败：${plan.stdout}${plan.stderr}`);
  if (!planning) lzyIn(d, ["loop", "start"]);
  return { dir: d, lzy: (args) => lzyIn(d, args) };
}

const goalJson = (d) => join(d, ".lazyzcode", "loop", "goal.json");
const wtRoot = (d) => siblingRoot(d);
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
// 异步假工人（⑨/⑨c 用）：Atomics.wait 忙等会**阻塞事件循环** ⇒ 两名工人实为串行，实测耗时
// 互相吃掉（w1=900 的那波被量成 1606=900+700）——于是「墙钟取 max 不 sum」在该夹具下根本
// 不可观测，这正是旧 ⑨ 断言窗失效的第二个原因（ADJ-18，v024-fix-round#N3）。异步 await 让
// 两工人真并发，max 口径与 sum 口径才分得开（1800 vs 3200）。
function fakeWorkerAsync({ ms = 0, mutate = null } = {}) {
  return async ({ argv, cwd }) => {
    if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
    const prompt = String(argv[argv.indexOf("--prompt") + 1] ?? "");
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
test("③装配与清理：run 中兄弟 worktree 在场；收束后 runDir 清、logs 留、subject 被摘除（ADJ-01）", async () => {
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
    const goal = JSON.parse(readFileSync(goalJson(d), "utf8"));
    assert.deepEqual(goal.subjects ?? [], [], "收束相须摘除本 run 声明的工人 subject（否则悬空根恒拒 finish，ADJ-01）");
    // ADJ-30：工人段原文分波归档（各波同名曾互相覆写，只剩末波）
    const logs = readdirSync(join(wtRoot(d), after.find((e) => e.endsWith(".logs"))));
    assert.ok(logs.includes("worker-w1-wave1.txt") && logs.includes("worker-w1-wave2.txt"), `分波归档缺失：${JSON.stringify(logs)}`);
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(siblingRoot(d), { recursive: true, force: true });
  }
});

// ── ③b 收束相完整性（ADJ-01/03，v024-fix-round#N1）────────────────────────────
test("③b 非 done 收束清理相：subject 摘除、脏 worktree 连同未提交物保留并点名、干净 worktree 删除", async () => {
  const r = repo("lzy-dw-cleanup-");
  const d = r.dir;
  try {
    // w1 留未提交物（合规真工人会提交——受控假工人构造 ADJ-03 形态）；w2 零动作
    const run = ({ argv, cwd }) => {
      const wid = /工人 w(\d+)/.exec(String(argv[argv.indexOf("--prompt") + 1] ?? ""))?.[1] ?? "?";
      if (wid === "1") writeFileSync(join(cwd, "uncommitted.txt"), "salvage\n");
      return { exitCode: 0, stdout: `${JSON.stringify({ sessionId: `sess-w${wid}` })}`, stderr: "" };
    };
    const { lines } = await captureStdout(() =>
      runDrive(d, { workers: 2, maxSegments: 2 }, passDeps(run)),
    );
    const goal = JSON.parse(readFileSync(goalJson(d), "utf8"));
    assert.equal(goal.status, "executing", "夹具应停在非 done 的干净收束");
    assert.deepEqual(goal.subjects ?? [], [], "①收束相摘除本 run 的工人 subject");
    const entries = siblingEntries(d);
    const runDirName = entries.find((e) => /^fast-\d{14}(-\d+)?$/.test(e));
    assert.ok(runDirName, `②有保留物时 runDir 不得整体删除；实得 ${JSON.stringify(entries)}`);
    const kept = join(siblingRoot(d), runDirName);
    assert.ok(existsSync(join(kept, "w1", "uncommitted.txt")), "②脏 worktree 的未提交物必须保留");
    assert.ok(!existsSync(join(kept, "w2")), "③干净 worktree 应被删除");
    assert.match(lines, /\[drive\] 清理：/, "清理相须留一行台账");
    assert.match(lines, /w1/, "台账须点名被保留的工人");
    const hd = join(d, ".lazyzcode", "loop", "handoff");
    const snaps = readdirSync(hd).sort();
    const snapText = readFileSync(join(hd, snaps.at(-1)), "utf8");
    assert.match(snapText, /w1/, "④收束快照须点名被保留的 worktree（恢复仪表）");
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

// ── ⑤b 启动回收矩阵（ADJ-02，v024-fix-round#N2）──────────────────────────────
test("⑤b 启动回收：无哨兵/形不符/归档零删除；带哨兵含未提交内容者整体保留；带哨兵干净者回收", async () => {
  const r = repo("lzy-dw-reclaim-");
  const d = r.dir;
  const wtRoot = siblingRoot(d);
  const mk = (name) => {
    const p = join(wtRoot, name);
    mkdirSync(p, { recursive: true });
    writeFileSync(join(p, "keep.txt"), "x\n");
    return p;
  };
  const sentinel = (p, runId) =>
    writeFileSync(join(p, ".lzy-run.json"), JSON.stringify({ version: 1, runId, slug: "dw", host: d, createdAt: "2025-01-01T00:00:00.000Z" }));
  try {
    mkdirSync(wtRoot, { recursive: true });
    const noSentinel = mk("fast-20250101000000"); // 形符但无哨兵=无所有权证据
    const foreign = mk("my-notes"); // 形不符（无关用户目录）
    const archive = mk("fast-20250101000001.logs"); // 工人 stdout 归档
    const dirtySentinel = mk("fast-20250101000002"); // 带哨兵 + 未提交内容
    sentinel(dirtySentinel, "fast-20250101000002");
    rmSync(join(dirtySentinel, "keep.txt"));
    mkdirSync(join(dirtySentinel, "w1"), { recursive: true });
    writeFileSync(join(dirtySentinel, "w1", "uncommitted.txt"), "salvage\n");
    const cleanSentinel = mk("fast-20250101000003"); // 带哨兵 + 干净=可回收
    sentinel(cleanSentinel, "fast-20250101000003");
    rmSync(join(cleanSentinel, "keep.txt"));
    const { lines } = await captureStdout(() => runDrive(d, { workers: 2, maxSegments: 1 }, passDeps()));
    assert.ok(existsSync(noSentinel), "形符无哨兵目录零删除（无所有权证据）");
    assert.ok(existsSync(foreign), "形不符目录零删除（可能是无关用户目录）");
    assert.ok(existsSync(archive), ".logs 归档不动");
    assert.ok(existsSync(join(dirtySentinel, "w1", "uncommitted.txt")), "含未提交内容的 runDir 整体保留");
    assert.ok(!existsSync(cleanSentinel), "带哨兵且干净=照常回收");
    assert.match(lines, /跳过/, "跳过项须入回收日志");
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(wtRoot, { recursive: true, force: true });
  }
});

// ── ⑤c runId 唯一化（ADJ-33，v024-fix-round#N2）──────────────────────────────
test("⑤c runId 唯一化：同名 runDir 已在场时追加 -<pid>，不再撞 worktree add -b", async () => {
  const r = repo("lzy-dw-runid-");
  const d = r.dir;
  const wtRoot = siblingRoot(d);
  const stamp = () => `fast-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
  try {
    const collided = stamp();
    mkdirSync(join(wtRoot, collided), { recursive: true });
    writeFileSync(join(wtRoot, collided, "keep.txt"), "x\n"); // 无哨兵：不该被回收
    const { result } = await captureStdout(() => runDrive(d, { workers: 2, maxSegments: 1 }, passDeps()));
    assert.equal(result.ok, true, "同秒撞名不得让本次 run 硬抛（worktree add -b 失败）");
    assert.ok(existsSync(join(wtRoot, collided)), "撞名目录（无哨兵）保留不动");
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(wtRoot, { recursive: true, force: true });
  }
});

// ── ⑤d doctor 残留计数三桶（ADJ-22，v024-fix-round#N2）────────────────────────
test("⑤d doctor 残留计数：归档与形符无哨兵分列，不把 .logs 计入可回收残留", async () => {
  const r = repo("lzy-dw-doctorcnt-");
  const d = r.dir;
  const wtRoot = siblingRoot(d);
  try {
    mkdirSync(join(wtRoot, "fast-20250101000001.logs"), { recursive: true });
    mkdirSync(join(wtRoot, "fast-20250101000009"), { recursive: true }); // 形符无哨兵桶
    mkdirSync(join(wtRoot, "fast-20250101000002"), { recursive: true });
    writeFileSync(join(wtRoot, "fast-20250101000002", ".lzy-run.json"), JSON.stringify({ version: 1, runId: "fast-20250101000002", slug: "dw", host: d, createdAt: "2025-01-01T00:00:00.000Z" }));
    const out = lzyIn(d, ["doctor"]);
    const line = (out.stdout ?? "").split("\n").find((l) => /workers 残留/.test(l)) ?? "";
    assert.match(line, /workers 残留 runDir 1（可回收）/, `可回收桶应=1（实得行：${line}）`);
    assert.match(line, /1（形符无哨兵/, `形符无哨兵桶应=1（实得行：${line}）`);
    assert.match(line, /归档 1/, `归档桶应=1（实得行：${line}）`);
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(wtRoot, { recursive: true, force: true });
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
test("⑨墙钟取 max 不 sum（每波 900ms/700ms → 两波 ≈1800 而非 sum≈3200）；maxSegments=2 恰两波收束", async () => {
  const r = repo("lzy-dw-wall-");
  try {
    // ADJ-18（v024-fix-round#N3）：旧夹具 60ms/10ms 的两个假设（max≈120 / sum≈140）只差
    // 20ms，而真实进程开销在负载下可达 +55ms（实测 175 越窗 ⇒ 既无判别力又 flaky）；且同步
    // 假工人把两名工人串行化（见 fakeWorkerAsync 注），量到的是 sum 形。异步假 + 900/700：
    // max 口径 1800、sum 口径 3200，相隔 1.4s ≫ 抖动。
    const slow = fakeWorkerAsync({ ms: 900 });
    const fast = fakeWorkerAsync({ ms: 700 });
    const pick = ({ argv, cwd, env, timeoutMs }) => {
      const prompt = String(argv[argv.indexOf("--prompt") + 1] ?? "");
      return (/工人 w1/.test(prompt) ? slow : fast)({ argv, cwd, env, timeoutMs });
    };
    const { result, lines } = await captureStdout(() =>
      runDrive(r.dir, { workers: 2, maxSegments: 2 }, passDeps(pick)),
    );
    assert.match(lines, /墙钟取 max=/);
    const spent = loadRuntime(r.dir)?.budget?.spentMs ?? 0;
    assert.ok(spent >= 1500, `spentMs 应 ≥1500（两波 max=900 口径 ≈1800），实得 ${spent}`);
    assert.ok(spent < 2600, `spentMs 应 <2600（sum 口径 ≈3200），实得 ${spent}`);
    assert.match(lines, /波 2\/2/);
    assert.match(result.cause, /波数尽（2 波）/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
    rmSync(siblingRoot(r.dir), { recursive: true, force: true });
  }
});

// ── ⑨b 屏障条件化（ADJ-04/05，v024-fix-round#N3）─────────────────────────────
test("⑨b 零变更波不重锚：F 证据不被改写、绿代数不涨、收束因=stuck（假推进根治）", async () => {
  const r = repo("lzy-dw-noanchor-", { steps: ["- [N1] x", "- [N2] y", "- [N3] z", "- [F1] f"] });
  const d = r.dir;
  try {
    const done = r.lzy(["step", "done", "F1", "--evidence", "初版取证（夹具）", "--harness", "npm test"]);
    assert.equal(done.status, 0, `F1 基线取证应成功：${done.stdout}${done.stderr}`);
    const { result, lines } = await captureStdout(() =>
      runDrive(d, { workers: 2, maxSegments: 3 }, passDeps(fakeWorker())),
    );
    assert.match(lines, /未变——跳过屏障重锚/, "零变更波须打印跳过行");
    assert.match(result.cause, /stuck/, `零推进应收束为 stuck；实得 ${result.cause}`);
    // 重锚恰一次（首波 subject 集实变导致），此后零变更波不再重锚——代数不随波数累积
    assert.equal((lines.match(/屏障重锚完成/g) ?? []).length, 1, "重锚次数应为 1（仅首波实变那次）");
    const list = r.lzy(["evidence", "list"]).stdout ?? "";
    assert.ok(!/gen3|gen4/.test(list), `零变更波不得再写新绿代数（实得：${list.replace(/\n/g, " ")}）`);
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(siblingRoot(d), { recursive: true, force: true });
  }
});

test("⑨c 实变波重锚恰一次且 harness 原样透传（INV-08 不因重锚变哑）", async () => {
  const r = repo("lzy-dw-anchor2-", { steps: ["- [N1] x", "- [N2] y", "- [N3] z", "- [F1] f"] });
  const d = r.dir;
  const har = (out) => (String(out ?? "").match(/🔧([0-9a-f]{8})/) ?? [])[1];
  try {
    const done = r.lzy(["step", "done", "F1", "--evidence", "初版取证（夹具）", "--harness", "npm test"]);
    assert.equal(done.status, 0, `F1 基线取证应成功：${done.stdout}${done.stderr}`);
    const h1 = har(r.lzy(["evidence", "list"]).stdout);
    assert.ok(h1, "基绿应带 harness 标记");
    const { lines } = await captureStdout(() =>
      runDrive(d, { workers: 2, maxSegments: 2 }, passDeps(fakeWorker({ mutate: (cwd, wid) => fakeAddFile(wid)(cwd) }))),
    );
    assert.match(lines, /屏障重锚完成（subject 头树集实变）/, "实变波须重锚");
    const h2 = har(r.lzy(["evidence", "list"]).stdout);
    assert.equal(h2, h1, `重锚新绿须与原绿同 harness（原 ${h1}，新 ${h2 ?? "缺"}）`);
    assert.match(r.lzy(["evidence", "list"]).stdout ?? "", /gen2|gen3/, "重锚应产生新一代绿节点");
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(siblingRoot(d), { recursive: true, force: true });
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
test("⑫启动回收：带哨兵且无未提交内容的残留 runDir 被清；未合并 fast-* 分支保留（salvage 族）", async () => {
  const r = repo("lzy-dw-reclaim-");
  const d = r.dir;
  try {
    const sib = siblingRoot(d);
    const stale = join(sib, "fast-20990101000000");
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, "stale.txt"), "stale\n");
    // 属主哨兵=回收的唯一授权证据（ADJ-02 起）
    writeFileSync(join(stale, ".lzy-run.json"), JSON.stringify({ version: 1, runId: "fast-20990101000000", slug: "dw", host: d, createdAt: "2099-01-01T00:00:00.000Z" }));
    // 造一个真未合并分支：开分支提交一次再切回原分支。
    const prev = spawnSync("git", ["-C", d, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).stdout.trim();
    spawnSync("git", ["-C", d, "switch", "-q", "-C", "fast-20990101000000-w1"], { encoding: "utf8" });
    writeFileSync(join(d, "unmerged.txt"), "x\n");
    spawnSync("git", ["-C", d, "-c", "user.email=t@l", "-c", "user.name=t", "add", "unmerged.txt"], { encoding: "utf8" });
    spawnSync("git", ["-C", d, "-c", "user.email=t@l", "-c", "user.name=t", "commit", "-qm", "unmerged"], { encoding: "utf8" });
    spawnSync("git", ["-C", d, "switch", "-q", prev], { encoding: "utf8" });
    await captureStdout(() => runDrive(d, { workers: 2, maxSegments: 1 }, passDeps(fakeWorker())));
    assert.ok(!existsSync(stale), "哨兵在场且无未提交内容的残留 runDir 应被回收");
    const branches = spawnSync("git", ["-C", d, "branch", "--format", "%(refname:short)"], { encoding: "utf8" }).stdout ?? "";
    assert.match(branches, /fast-20990101000000-w1/, "未合并残留分支保留（salvage 族）");
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(siblingRoot(d), { recursive: true, force: true });
  }
});

// ── ⑬HEAVY 拒入（ADJ-11，v024-fix-round#N4）──────────────────────────────────
test("⑬HEAVY 目标拒入 workers（结构性死端 fail-closed，带恢复指路）", async () => {
  const r = repo("lzy-dw-heavy-", { tier: "heavy", steps: ["- [N1] x", "- [N2] y", "- [F1] 夹具终验：scratch 仓 lzy loop status 显示宿主树清洁"] });
  try {
    await assert.rejects(
      () => runDrive(r.dir, { workers: 2 }, passDeps()),
      /workers 模式不支持 HEAVY/,
      "HEAVY × workers 必拒（每波重锚 ⇒ 对照 attestation 必 stale ⇒ finish 必拒）",
    );
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

// ── ⑭认领释放（ADJ-12）───────────────────────────────────────────────────────
test("⑭本 run 遗留的步级认领在波终被释放（不再 48h 饿死分派池）", async () => {
  const r = repo("lzy-dw-claimrel-");
  const d = r.dir;
  try {
    // 假工人：用真 CLI 认领被分派的步但不收口 → 波终应由调度器释放
    const run = ({ argv }) => {
      const prompt = String(argv[argv.indexOf("--prompt") + 1] ?? "");
      for (const id of (prompt.match(/N\d/g) ?? []).sort()) lzyIn(d, ["loop", "claim", id]);
      return { exitCode: 0, stdout: `${JSON.stringify({ sessionId: "s" })}`, stderr: "" };
    };
    const { lines } = await captureStdout(() => runDrive(d, { workers: 2, maxSegments: 1 }, passDeps(run)));
    assert.match(lines, /认领释放：N\d/, "波终须释放本 run 自造的认领");
    const goal = JSON.parse(readFileSync(goalJson(d), "utf8"));
    for (const st of goal.steps) assert.ok(!st.claim, `步骤 ${st.id} 的认领应已释放`);
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(siblingRoot(d), { recursive: true, force: true });
  }
});

// ── ⑮记账相位（ADJ-13）───────────────────────────────────────────────────────
test("⑮预算尽收束时本波产出已合并入宿主（recordSpend 相位在 merge 之后）", async () => {
  const r = repo("lzy-dw-spend-");
  const d = r.dir;
  const saved = process.env.LZY_DRIVE_WALLCLOCK_BUDGET_MS;
  try {
    process.env.LZY_DRIVE_WALLCLOCK_BUDGET_MS = "1"; // 首波记账即超顶
    const { result } = await captureStdout(() =>
      runDrive(d, { workers: 2, maxSegments: 3 }, passDeps(fakeWorker({ mutate: (cwd, wid) => fakeAddFile(wid)(cwd) }))),
    );
    assert.match(result.cause, /预算尽/, `实得 ${result.cause}`);
    const log = spawnSync("git", ["-C", d, "log", "--oneline"], { encoding: "utf8" }).stdout ?? "";
    assert.match(log, /w1|w2/, "预算尽收束时本波工人提交必须已在宿主历史（产出不脱账）");
  } finally {
    if (saved == null) delete process.env.LZY_DRIVE_WALLCLOCK_BUDGET_MS;
    else process.env.LZY_DRIVE_WALLCLOCK_BUDGET_MS = saved;
    rmSync(d, { recursive: true, force: true });
    rmSync(siblingRoot(d), { recursive: true, force: true });
  }
});

// ── ⑯工人提示词红线 + env-auth 同强度（ADJ-19/23）────────────────────────────
test("⑯工人提示词含 finish 禁令；env-auth 判据同强度（0 字节拒、次候选可命中）", async () => {
  const seen = [];
  const r = repo("lzy-dw-prompt-");
  const empty = join(HOME, "provider-empty.json");
  writeFileSync(empty, "");
  try {
    const run = ({ argv }) => {
      seen.push(String(argv[argv.indexOf("--prompt") + 1] ?? ""));
      return { exitCode: 0, stdout: `${JSON.stringify({ sessionId: "s" })}`, stderr: "" };
    };
    await withEnv({ ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: ENV_FILE }, async () => {
      await captureStdout(() => runDrive(r.dir, { workers: 2, maxSegments: 1 }, passDeps(run)));
    });
    assert.ok(seen.length > 0, "夹具应至少派发一次工人段");
    assert.ok(seen.every((p) => /绝不运行 lzy loop finish/.test(p)), "工人提示词须含 finish 禁令（ADJ-19）");
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
    rmSync(siblingRoot(r.dir), { recursive: true, force: true });
  }
  const r2 = repo("lzy-dw-envauth2-");
  try {
    await withEnv({ ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: empty }, async () => {
      await assert.rejects(
        () => runDrive(r2.dir, { workers: 2 }, passDeps()),
        /workers 模式要求 env-auth/,
        "0 字节凭据文件应与 headless 侧同判（拒）",
      );
    });
    await withEnv({ ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: join(HOME, "nope.json"), ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: ENV_FILE }, async () => {
      const res = await captureStdout(() => runDrive(r2.dir, { workers: 2, maxSegments: 1 }, passDeps()));
      assert.equal(res.result.ok, true, "首候选缺席应落到次候选（either-or，不短路）");
    });
  } finally {
    rmSync(r2.dir, { recursive: true, force: true });
    rmSync(siblingRoot(r2.dir), { recursive: true, force: true });
  }
});

// ── ⑰认领新鲜谓词单一源（ADJ-39）─────────────────────────────────────────────
test("⑰未来时间戳认领不饿死分派池（与 core 同判「不新鲜」）", async () => {
  const r = repo("lzy-dw-futureclaim-");
  const d = r.dir;
  try {
    const g = JSON.parse(readFileSync(goalJson(d), "utf8"));
    g.steps[0].claim = { at: new Date(Date.now() + 86_400_000).toISOString() }; // 未来戳=异常标记
    writeFileSync(goalJson(d), `${JSON.stringify(g, null, 2)}\n`);
    const seen = [];
    const run = ({ argv }) => {
      const prompt = String(argv[argv.indexOf("--prompt") + 1] ?? "");
      const m = prompt.match(/只做你被分派的步：([^\n]+)/);
      if (m) seen.push(m[1]);
      return { exitCode: 0, stdout: `${JSON.stringify({ sessionId: "s" })}`, stderr: "" };
    };
    await captureStdout(() => runDrive(d, { workers: 2, maxSegments: 1 }, passDeps(run)));
    assert.ok(seen.some((x) => x.includes("N1")), `未来戳认领的 N1 仍应可分派；实得 ${JSON.stringify(seen)}`);
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(siblingRoot(d), { recursive: true, force: true });
  }
});

// ── ⑱装配失败收束（ADJ-14，v024-fix-round#N5）────────────────────────────────
test("⑱装配相中途失败：回滚已建物、自写快照、零波派发、不穿出异常", async () => {
  const r = repo("lzy-dw-assembfail-");
  const d = r.dir;
  const wt = siblingRoot(d);
  try {
    // 确定性触发器：把 .git/worktrees 换成普通文件 ⇒ `git worktree add` 必败（"could not create
    // leading directories"），且不依赖 runId 的秒级戳（早先按戳预置撞名分支的夹具会跨秒漂移）。
    rmSync(join(d, ".git", "worktrees"), { recursive: true, force: true });
    writeFileSync(join(d, ".git", "worktrees"), "blocker\n");
    const { result, lines } = await captureStdout(() => runDrive(d, { workers: 2, maxSegments: 1 }, passDeps()));
    assert.equal(result.ok, false, "装配失败属非干净收束");
    assert.match(result.cause, /装配失败/, `实得 ${result.cause}`);
    assert.ok(result.handoff, "装配失败须自写 7 字段快照（ADJ-14：原实现异常直接穿出）");
    assert.match(lines, /未派发任何段/);
    const goal = JSON.parse(readFileSync(goalJson(d), "utf8"));
    assert.deepEqual(goal.subjects ?? [], [], "装配失败须回滚已 add 的 subject（不留半装状态）");
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(wt, { recursive: true, force: true });
  }
});

// ── ⑲--fast=false 语义（ADJ-21，v024-fix-round#N8）───────────────────────────
test("⑲CLI：--fast=false 显式关=单工人（不得反转进 workers 2）", () => {
  const r = repo("lzy-dw-fasting-", { planning: true }); // planning 仓：两径错误消息不同
  try {
    withEnv({ ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: ENV_FILE }, () => {
      // 两径在 planning 仓都停在状态门，但 workers 径的文案不同（「——无人值守边界不变」）——
      // 以此判别走了哪条径（⑪ 家法的收严版）。
      const off = r.lzy(["loop", "drive", "--fast=false"]);
      const offOut = `${off.stdout}${off.stderr}`;
      assert.doesNotMatch(offOut, /无人值守边界不变/, `--fast=false 不应进 workers 径；实得 ${offOut}`);
      assert.match(offOut, /绝不立新计划/, "--fast=false 应走单工人径");
      const on = r.lzy(["loop", "drive", "--fast"]);
      assert.match(`${on.stdout}${on.stderr}`, /无人值守边界不变/, "--fast 裸旗标仍须进 workers 径");
    });
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

// ── ⑳收束族覆盖（ADJ-25，v024-fix-round#N12）─────────────────────────────────
test("⑳工人段失败：收束因=工人段失败 + !ok + 快照在场 + 分支保留（本波不组装）", async () => {
  const r = repo("lzy-dw-segfail-");
  const d = r.dir;
  try {
    const run = ({ argv }) => {
      const wid = /工人 w(\d+)/.exec(String(argv[argv.indexOf("--prompt") + 1] ?? ""))?.[1] ?? "?";
      if (wid === "1") return { exitCode: 1, stdout: "", stderr: "probe: worker 1 died" };
      return { exitCode: 0, stdout: `${JSON.stringify({ sessionId: "s" })}`, stderr: "" };
    };
    const { result, lines } = await captureStdout(() => runDrive(d, { workers: 2, maxSegments: 2 }, passDeps(run)));
    assert.equal(result.ok, false, "工人段失败属非干净收束");
    assert.match(result.cause, /工人段失败/);
    assert.ok(result.handoff, "失败收束须自写快照");
    assert.match(lines, /产出留在各工人分支（未合并/, "报文须如实（不再声称『已按 merge 相保留』）");
    const branches = spawnSync("git", ["-C", d, "branch", "--format", "%(refname:short)"], { encoding: "utf8" }).stdout ?? "";
    assert.match(branches, /-w1/, "工人分支保留（!ok 不清理）");
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(siblingRoot(d), { recursive: true, force: true });
  }
});

test("⑳b 屏障重锚前置读失败：账本损坏 ⇒ fail-closed 收束（不静默写无 harness 新绿）", async () => {
  const r = repo("lzy-dw-dagbroken-", { steps: ["- [N1] x", "- [N2] y", "- [N3] z", "- [F1] f"] });
  const d = r.dir;
  try {
    const done = r.lzy(["step", "done", "F1", "--evidence", "初版取证（夹具）", "--harness", "npm test"]);
    assert.equal(done.status, 0, `F1 基线取证应成功：${done.stdout}${done.stderr}`);
    // 破坏账本（写坏 JSON）：重锚前置读须 fail-closed 收束，而不是静默不带 harness 重锚
    writeFileSync(join(d, ".lazyzcode", "loop", "dag.json"), "{ broken\n");
    const { result, lines } = await captureStdout(() =>
      runDrive(d, { workers: 2, maxSegments: 2 }, passDeps(fakeWorker({ mutate: (cwd, wid) => fakeAddFile(wid)(cwd) }))),
    );
    assert.equal(result.ok, false, "账本不可读=非干净收束");
    assert.match(result.cause, /屏障重锚前置读失败/, `实得 ${result.cause}`);
    assert.match(lines, /fail-closed|恢复/);
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(siblingRoot(d), { recursive: true, force: true });
  }
});

test("⑳c 无 pending 步 ⇒ drive 自走 finish 链收口（done + 清理相）", async () => {
  const r = repo("lzy-dw-finishchain-", { steps: ["- [N1] x", "- [N2] y"] });
  const d = r.dir;
  try {
    // 夹具的 plan.md 等未跟踪文件会让 finish 的完整性闸门拒（dirty 根）——先提交干净
    spawnSync("git", ["-C", d, "add", "-A"], { encoding: "utf8" });
    spawnSync("git", ["-C", d, "-c", "user.email=t@l", "-c", "user.name=t", "commit", "-qm", "fixture plan"], { encoding: "utf8" });
    // 假工人用真 CLI 收口自己被分派的步 ⇒ 下一波 pendingCount===0 ⇒ drive 自走 finish
    const run = ({ argv }) => {
      const prompt = String(argv[argv.indexOf("--prompt") + 1] ?? "");
      const m = prompt.match(/只做你被分派的步：([^\n]+)/);
      for (const id of (m?.[1] ?? "").match(/N\d/g) ?? []) {
        spawnSync(process.execPath, [CLI, "step", "done", id, "--note", "probe 假工人收口"], { cwd: d, encoding: "utf8", timeout: 60_000 });
      }
      return { exitCode: 0, stdout: `${JSON.stringify({ sessionId: "s" })}`, stderr: "" };
    };
    const { result, lines } = await captureStdout(() => runDrive(d, { workers: 2, maxSegments: 3 }, passDeps(run)));
    assert.equal(result.ok, true);
    assert.equal(result.cause, "done", `实得 ${result.cause}`);
    assert.match(lines, /✔ goal done/);
    const goal = JSON.parse(readFileSync(goalJson(d), "utf8"));
    assert.equal(goal.status, "done", "drive 须自走 finish 链把目标收口");
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(siblingRoot(d), { recursive: true, force: true });
  }
});
