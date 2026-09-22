// v023-fix-round#N1 契约批（0.2.3 修复轮批次一）：drive 段循环三可抛面收口（ADJ-02）、
// h3r-hit rename 原子消费（ADJ-03）、reset 清理补两名（ADJ-04）、心跳轴 I/O 族分派
//（ADJ-19）、段界恢复指引分流（ADJ-32）、步存在性先判（ADJ-33）、收束因空白折叠
//（ADJ-34）、fenceCounter 条件种子（ADJ-35）。红绿两半纪律：每钉先在改前代码跑红。
// env 卫生（ADJ-28 家法）：用例内 set/delete 成对，消融 shell 里不假红。
import { test } from "node:test";
// 人权门非本文件被测面——spawn 继承此 env 保任意采纳畅通
process.env.LZY_ABLATE_HUMAN_GATE = "1";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runDrive } from "../core/drive.js";
import { acquireLease, loadRuntime, releaseLease } from "../core/runtime.js";
import { lintHandoffSnapshot, withLock } from "../core/loop.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");
const SUPPRESS_ENGINE = "/nonexistent-lzy-suppressed-engine";
const HOME = mkdtempSync(join(tmpdir(), "lzy-n1-home-"));

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

function executingRepo(prefix, { risk } = {}) {
  const d = repo(prefix);
  const riskFlag = risk ? ["--risk", risk] : [];
  lzy(["loop", "register", "n1", "--title", "t", ...riskFlag], d);
  writeFileSync(join(d, "p.md"), "- [N1] x\n- [N2] y\n");
  const plan = lzy(["loop", "plan", "p.md"], d);
  if (plan.code !== 0) throw new Error(`plan 失败：${plan.out}`);
  lzy(["loop", "start"], d);
  return d;
}

const goalJson = (d) => join(d, ".lazyzcode", "loop", "goal.json");
const loopDirOf = (d) => join(d, ".lazyzcode", "loop");
const markFirstStepDone = (d) => {
  const goal = JSON.parse(readFileSync(goalJson(d), "utf8"));
  const i = goal.steps.findIndex((s) => s.status !== "done");
  if (i >= 0) goal.steps[i] = { ...goal.steps[i], status: "done" };
  writeFileSync(goalJson(d), `${JSON.stringify(goal, null, 2)}\n`);
};

function captureStdout(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  return Promise.resolve(fn()).finally(() => {
    console.log = orig;
  }).then((r) => ({ result: r, lines: lines.join("\n") }));
}

const passDeps = (run, extra = {}) => ({
  enginePath: "/fake/engine.cjs",
  detectAuth: () => ({ oauth: true, envAuth: false, ok: true }),
  run: run ?? (() => ({ exitCode: 0, stdout: "{}", stderr: "" })),
  ...extra,
});

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// withEnv：用例级临时 env（用后精确恢复；ADJ-28 家法——测试不继承消融 shell 残留）
function withEnv(map, fn) {
  const saved = new Map();
  for (const [k, v] of Object.entries(map)) {
    saved.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

// ── ADJ-02·① takeH3rHit 对「标记变目录」不再裸逃逸（rename+recursive 清，静默当空） ──
test("N1/ADJ-02①：h3r-hit.json 变目录 → runDrive 正常收束（不抛 EISDIR），垃圾目录被清", async () => {
  const d = executingRepo("lzy-n1-eisdir-");
  try {
    mkdirSync(join(loopDirOf(d), "h3r-hit.json"));
    await withEnv({ LZY_ABLATE_H3R_PRETOOL: "1" }, async () => {
      const { result, lines } = await captureStdout(() =>
        runDrive(d, { maxSegments: 2 }, passDeps(null, { rollingPoints: 0 })),
      );
      assert.equal(result.ok, true, `目录形态标记不得让 drive 裸逃逸：${lines}`);
      assert.match(lines, /无推进（stuck/, "正常走到收束而非内部错误逃逸");
      assert.ok(!existsSync(join(loopDirOf(d), "h3r-hit.json")), "垃圾目录标记已被消费面清掉");
    });
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── ADJ-02·② 唤醒态词表损坏 → 干净收束「门不可判」而非裸逃逸（词表 seam：LZY_H3R_WORDS_FILE）──
test("N1/ADJ-02②：唤醒态词表不可判 → h3rStopVerdict 抛错被收口为 ok:true 干净收束+恢复指引", async () => {
  const d = executingRepo("lzy-n1-badwords-");
  const bad = join(d, "bad-words.json");
  writeFileSync(bad, "{not json");
  try {
    await withEnv({ LZY_ABLATE_H3R_GATE: "1", LZY_H3R_WORDS_FILE: bad }, async () => {
      const { result, lines } = await captureStdout(() =>
        runDrive(d, { maxSegments: 2 }, passDeps(null, { rollingPoints: 0 })),
      );
      assert.equal(result.ok, true, `门不可判=干净停摆（未执行任何步骤）：${lines}`);
      assert.match(lines, /门不可判/, "收束因点名词表不可判");
      assert.match(lines, /handoff 快照：/, "停摆带 7 字段快照");
      assert.doesNotMatch(lines, /载荷词表缺失\/损坏.*——重跑 lzy sync 或重装\n?at /, "异常栈不得穿出 runDrive");
    });
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── ADJ-02·③ windDown 内 readGoal 护栏：段间 goal.json 损坏 → outcome 落地而非异常穿出 ──
test("N1/ADJ-02③：段间 goal.json 损坏 → runDrive 返回收束结果（不再二次抛穿），raw 报错进 stdout 注记", async () => {
  const d = executingRepo("lzy-n1-corruptgoal-");
  const run = () => {
    writeFileSync(goalJson(d), "{corrupted");
    return { exitCode: 0, stdout: "{}", stderr: "" };
  };
  try {
    const { result, lines } = await captureStdout(() =>
      runDrive(d, { maxSegments: 3 }, passDeps(run, { rollingPoints: 0 })),
    );
    assert.ok(result, "runDrive 必须正常返回 outcome（异常穿出=红）");
    assert.equal(result.ok, false);
    assert.match(result.cause, /段间门拒/);
    assert.ok(!/内部错误：循环无显式收束因退出/.test(result.cause), "不得落进无因兜底");
    assert.match(lines, /无快照可写|交接快照写失败|无需交接快照/, "护栏降级路径如实注记（goal 不可读=无快照可写）");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── 入口特性钉（预注册）：drive 入口遇损坏 goal.json 保持裸 fail-closed（两代同） ──
test("N1/特性钉：drive 入口遇损坏 goal.json 仍 fail-closed 拒（windDown 护栏不越界到入口）", async () => {
  const d = executingRepo("lzy-n1-entrypin-");
  try {
    writeFileSync(goalJson(d), "{corrupted");
    await assert.rejects(() => runDrive(d, {}, passDeps(null, { rollingPoints: 0 })));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── ADJ-19 心跳轴分派：I/O 族走快照收束+回收指引；接管族保持 skipHandoff ──
test("N1/ADJ-19：心跳 I/O 族（RUNTIME_IO）→ 带快照收束+租约回收指引（不复用接管文案）", async () => {
  const d = executingRepo("lzy-n1-hbio-");
  const ioErr = Object.assign(new Error("EACCES: permission denied, open runtime.json"), { code: "RUNTIME_IO" });
  try {
    const { result, lines } = await captureStdout(() =>
      runDrive(d, { maxSegments: 3 }, passDeps(null, { rollingPoints: 0, heartbeatLease: () => { throw ioErr; } })),
    );
    assert.equal(result.ok, false, lines);
    assert.match(result.cause, /段间心跳失败/, "I/O 族走独立收束因");
    assert.ok(!/已被接管/.test(lines), "存储 I/O 不得被打成接管：定语必须符合事实");
    assert.match(lines, /handoff 快照：/, "本 drive 仍持租（假 I/O），写交接合法且必须");
    assert.match(lines, /lease reclaim/, "租约可能滞留——回收指引必须给出");
    assert.ok(result.handoff, "收束结果带回快照路径");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── ADJ-32 段界恢复指引分流：RESTRICTED 的处方=收窄+reset 重注册（非「确认后推进」） ──
test("N1/ADJ-32：RESTRICTED 段界拒的恢复指引给「收窄+reset 重注册」处方，不再误导按计划推进", async () => {
  const d = executingRepo("lzy-n1-restg-");
  const run = () => {
    const goal = JSON.parse(readFileSync(goalJson(d), "utf8"));
    goal.risk = "restricted";
    writeFileSync(goalJson(d), `${JSON.stringify(goal, null, 2)}\n`);
    return { exitCode: 0, stdout: "{}", stderr: "" };
  };
  try {
    const { result, lines } = await captureStdout(() =>
      runDrive(d, { maxSegments: 3 }, passDeps(run, { rollingPoints: 0 })),
    );
    assert.equal(result.ok, false, lines);
    assert.match(lines, /段间门拒（RESTRICTED 硬禁/);
    assert.match(lines, /收窄[^]*reset[^]*重注册|重注册[^]*收窄/, "RESTRICTED 处方=收窄范围+reset 重注册（ADR-0020 出口）");
    assert.ok(!/确认后按计划推进/.test(lines), "「确认后推进」对 RESTRICTED 是误导性处方（唯一出口=重建）");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── ADJ-33 步存在性先判：拼错步 id 得「无此步骤」而非一段一步拒 ──
test("N1/ADJ-33：同段内拼错步 id → 「无此步骤：N9」（步存在性校验先于一段一步门）", () => {
  const d = executingRepo("lzy-n1-order-");
  try {
    writeFileSync(
      join(loopDirOf(d), "segment.json"),
      `${JSON.stringify({ segmentId: "5:seg-1", stepId: "N1", at: "2026-01-01T00:00:00Z" }, null, 2)}\n`,
    );
    const r = lzy(["step", "done", "N9", "--note", "拼错 id 的第一步"], d, { LZY_SEGMENT_ID: "5:seg-1" });
    assert.equal(r.code, 1);
    assert.match(r.out, /无此步骤：N9/, `实得：${r.out}`);
    assert.ok(!/本段已翻过一步/.test(r.out), "判序颠倒会把拼错 id 误报成一段一步拒");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── ADJ-34 收束因内嵌命令空白折叠：多行命令不打散 stdout/快照行形 ──
// 段标配方（ADJ-35 种子化后）：先领一次租确立 counter（种子只在「counter 归零+盘面有
// 段标残留」时触发），再写段标为「下一次租的 fence」——drive 领到的 fence 与段标必然相符。
function seedMarkerFence(d) {
  const lease = withLock(d, () => acquireLease(d, { ttlMs: 60_000 }));
  withLock(d, () => releaseLease(d, lease.fence));
  return `${lease.fence + 1}:seg-1`;
}

test("N1/ADJ-34：h3r-hit 命令带换行 → 收束因单行化（空白折叠），stdout 与快照行形完整", async () => {
  const d = executingRepo("lzy-n1-nl-");
  try {
    const segId = seedMarkerFence(d);
    writeFileSync(
      join(loopDirOf(d), "h3r-hit.json"),
      `${JSON.stringify(
        { segmentId: segId, tool: "Bash", command: "rm -rf /tmp/x\necho pwned", matched: ["rm -rf"], at: new Date().toISOString() },
        null,
        2,
      )}\n`,
    );
    await withEnv({ LZY_ABLATE_H3R_PRETOOL: "1", LZY_ABLATE_H3R_GATE: undefined }, async () => {
      const { result, lines } = await captureStdout(() =>
        runDrive(d, { maxSegments: 1 }, passDeps(null, { rollingPoints: 0 })),
      );
      assert.equal(result.ok, true, lines);
      assert.match(result.cause, /工具调用被拒/);
      assert.equal(result.cause.includes("\n"), false, `收束因必须单行：${JSON.stringify(result.cause)}`);
      assert.match(result.cause, /rm -rf \/tmp\/x echo pwned/, "命令文本空白折叠后可读");
      const outLines = lines.split("\n");
      const causeLine = outLines.find((l) => l.includes("工具调用被拒"));
      assert.ok(causeLine.includes("handoff 快照"), "收束行与快照行同在且不互切");
    });
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── ADJ-35 fenceCounter 条件种子：盘面有段标残留而 counter 归零 → 重基防撞标 ──
test("N1/ADJ-35：counter 归零+盘面残留段标 → acquireLease 以时间派生高位重基（不再撞旧段标）", () => {
  const d = executingRepo("lzy-n1-seed-");
  try {
    writeFileSync(
      join(loopDirOf(d), "segment.json"),
      `${JSON.stringify({ segmentId: "1:seg-1", stepId: "N1", at: "2026-01-01T00:00:00Z" }, null, 2)}\n`,
    );
    rmSync(join(loopDirOf(d), "runtime.json"), { force: true }); // 文档化恢复路径：人工删账本
    const lease = withLock(d, () => acquireLease(d, { ttlMs: 60_000 }));
    const timeBase = Math.floor(Date.now() / 60_000);
    assert.ok(lease.fence > timeBase, `撞标防线：残留 segment.json(fence 1) 在场时新 fence 必须重基。实得 ${lease.fence}`);
    const second = withLock(d, () => {
      releaseLease(d, lease.fence);
      return acquireLease(d, { ttlMs: 60_000 });
    });
    assert.equal(second.fence, lease.fence + 1, "重基后单调 +1 保持");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("N1/ADJ-35 对照半：无残留段标的新账本 fence 从 1 起（种子只修撞击链，不改常规路径）", () => {
  const d = executingRepo("lzy-n1-seedctl-");
  try {
    rmSync(join(loopDirOf(d), "runtime.json"), { force: true });
    const lease = withLock(d, () => acquireLease(d, { ttlMs: 60_000 }));
    assert.equal(lease.fence, 1, "盘面无段标残留 → 常规计数不变（既有 fence=1 钉全部保持）");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── ADJ-04 reset 清理补两名：segment.json / h3r-hit.json 随 reset 消失 ──
test("N1/ADJ-04：reset 清 segment.json 与 h3r-hit.json（含目录形态）；start 清 h3r-hit.json", () => {
  const d = executingRepo("lzy-n1-clean-");
  try {
    writeFileSync(join(loopDirOf(d), "segment.json"), "{}\n");
    writeFileSync(join(loopDirOf(d), "h3r-hit.json"), "{}\n");
    const r = lzy(["loop", "reset"], d);
    assert.equal(r.code, 0, r.out);
    assert.ok(!existsSync(join(loopDirOf(d), "segment.json")), "reset 后 segment.json 不再残留");
    assert.ok(!existsSync(join(loopDirOf(d), "h3r-hit.json")), "reset 后 h3r-hit.json 不再残留（此前零清理路径）");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
  // start 半区：goal 须停在 planning（start 从 planning 态进），h3r-hit.json 在场时开跑即清
  const d2 = repo("lzy-n1-clean2-");
  try {
    lzy(["loop", "register", "n1b", "--title", "t"], d2);
    writeFileSync(join(d2, "p.md"), "- [N1] x\n");
    lzy(["loop", "plan", "p.md"], d2);
    writeFileSync(join(loopDirOf(d2), "h3r-hit.json"), "{}\n");
    const r = lzy(["loop", "start"], d2);
    assert.equal(r.code, 0, r.out);
    assert.ok(!existsSync(join(loopDirOf(d2), "h3r-hit.json")), "start 清段标双保险覆盖 h3r-hit.json");
  } finally {
    rmSync(d2, { recursive: true, force: true });
  }
});

// ── ADJ-03 rename 原子消费：消费点后晚到的同段标记由下段清理，不再被 rm 竞态硬删 ──
test("N1/ADJ-03：标记消费走 rename 原子序（先 rename 后读清），消费 tmp 属 h3r-hit.json. 家族", async () => {
  const d = executingRepo("lzy-n1-rename-");
  try {
    const segId = seedMarkerFence(d);
    writeFileSync(
      join(loopDirOf(d), "h3r-hit.json"),
      `${JSON.stringify({ segmentId: segId, tool: "Bash", command: "rm -rf x", matched: ["rm -rf"], at: new Date().toISOString() }, null, 2)}\n`,
    );
    await withEnv({ LZY_ABLATE_H3R_PRETOOL: "1" }, async () => {
      const { result } = await captureStdout(() =>
        runDrive(d, { maxSegments: 1 }, passDeps(null, { rollingPoints: 0 })),
      );
      assert.match(result.cause, /工具调用被拒/, "相符标记照常消费");
      assert.ok(!existsSync(join(loopDirOf(d), "h3r-hit.json")), "消费后本名消失");
      const leftovers = existsSync(loopDirOf(d))
        ? (await import("node:fs")).readdirSync(loopDirOf(d)).filter((f) => f.startsWith("h3r-hit.json."))
        : [];
      assert.deepEqual(leftovers, [], "消费中间态不残留（孤儿态入既有 tmp 家族两面覆盖）");
    });
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// 快照 lint 回归钉：本批全部收束路径的自写快照仍过 7 字段 lint（抽样 stuck 路径）
test("N1/回归钉：stuck 收束自写快照过 7 字段 lint（本批 windDown 改造不破既有契约）", async () => {
  const d = executingRepo("lzy-n1-lint-");
  try {
    let marker = null;
    await withEnv({}, async () => {
      const { result, lines } = await captureStdout(() =>
        runDrive(d, { maxSegments: 2 }, passDeps(null, { rollingPoints: 0 })),
      );
      assert.equal(result.ok, true, lines);
      marker = JSON.parse(readFileSync(join(loopDirOf(d), "handoff.json"), "utf8"));
    });
    assert.deepEqual(lintHandoffSnapshot(readFileSync(marker.snapshot, "utf8")), []);
    assert.equal(loadRuntime(d).activeLease, null, "lease 已释放");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── N2 批次追加（v023-fix-round#N2）─────────────────────────────────────────

// ADJ-22 loop 侧：畸形段标按「无段标」处置——残留 env 不把一段一步门变成常量死锁
test("N2/ADJ-22：畸形 LZY_SEGMENT_ID 在一段一步门按无段标处置（同段多步不被 junk 段标误拒）", () => {
  const d = executingRepo("lzy-n2-shape-");
  try {
    const goal = JSON.parse(readFileSync(goalJson(d), "utf8"));
    goal.steps[0].status = "done"; // N1 已翻
    writeFileSync(goalJson(d), `${JSON.stringify(goal, null, 2)}\n`);
    const r = lzy(["step", "done", "N2", "--note", "junk 段标下的第二步"], d, { LZY_SEGMENT_ID: "residual-junk" });
    assert.equal(r.code, 0, `畸形段标不得激活一段一步门（实得）：${r.out}`);
    assert.ok(!existsSync(join(loopDirOf(d), "segment.json")), "畸形段标不落段记录");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("N2/ADJ-22 对照半：合法形状段标的一段一步门照常执法", () => {
  const d = executingRepo("lzy-n2-shapectl-");
  try {
    const r = lzy(["step", "done", "N1", "--note", "第一步"], d, { LZY_SEGMENT_ID: "42:seg-3" });
    assert.equal(r.code, 0, r.out);
    const r2 = lzy(["step", "done", "N2", "--note", "同段第二步"], d, { LZY_SEGMENT_ID: "42:seg-3" });
    assert.equal(r2.code, 1, "合法段标同段第二步应拒");
    assert.match(r2.out, /本段已翻过一步（N1）/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ADJ-29 休眠半区契约钉：PRETOOL 关 ⇒ 残留命中标记不被读不清（自愈路径的机器钉）
test("N2/ADJ-29：休眠半区不消费残留标记（唤醒面下一段照常消费——两半同测）", async () => {
  const d = executingRepo("lzy-n2-dormant-");
  try {
    // 段标配方：预领一次租确立 counter 后，预写「第二次 drive 的 fence」——休眠面
    // （第一次 drive）不消费，唤醒面（第二次 drive）段标相符照常消费。
    const l1 = withLock(d, () => acquireLease(d, { ttlMs: 60_000 }));
    withLock(d, () => releaseLease(d, l1.fence));
    writeFileSync(
      join(loopDirOf(d), "h3r-hit.json"),
      `${JSON.stringify({ segmentId: `${l1.fence + 2}:seg-1`, tool: "Bash", command: "rm -rf x", matched: ["rm -rf"], at: new Date().toISOString() }, null, 2)}\n`,
    );
    await withEnv({}, async () => {
      const { result } = await captureStdout(() =>
        runDrive(d, { maxSegments: 1 }, passDeps(null, { rollingPoints: 0 })),
      );
      assert.match(result.cause, /段数尽/, "休眠面不因残留标记收束");
      assert.ok(existsSync(join(loopDirOf(d), "h3r-hit.json")), "休眠半区不得读/清残留标记");
    });
    // 对照半：唤醒面照常消费（标记被清+收束因改写）
    await withEnv({ LZY_ABLATE_H3R_PRETOOL: "1" }, async () => {
      const { result } = await captureStdout(() =>
        runDrive(d, { maxSegments: 1 }, passDeps(null, { rollingPoints: 0 })),
      );
      assert.match(result.cause, /工具调用被拒/, "唤醒面消费残留标记（段标 1:seg-1 与本 run fence 相符时）");
    });
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
