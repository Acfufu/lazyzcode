// H3R 高危步门契约测试（0.2.2 棒2，ADR-0022）：kill-switch 两半 + 值语义 + 判定面单元例。
// 夹具沿 `test/drive.contract.test.js` 的 deps 注入家法（假引擎，零真引擎、零网络、零触网）。
//
// 两半定义（`docs/research-ablation-design.md:39`「红半约定」）：
// - 唤醒半（= 开关开启态的 fixture 表面）：`LZY_ABLATE_H3R_GATE=1` 且下一步命中 → drive 在
//   段循环里停摆（cause 带 `高危步停摆（H3R）`）、7 字段快照落盘、**零引擎 spawn**。
// - 休眠半（= 默认关与改动前行为逐字段同）：开关缺席时同一夹具照常推进，绝不出现 h3r 因。
//
// 涉及 `core/h3r.js` 的断言一律走**动态** `await import("../core/h3r.js")`——基线 worktree
// （F1 红半）上该模块缺席，静态 import 会让整个文件加载即崩，红半就取不到了。
import { test } from "node:test";
// 人权门非本文件被测面——spawn 继承此 env 保任意采纳畅通
process.env.LZY_ABLATE_HUMAN_GATE = "1";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runDrive } from "../core/drive.js";
import { handoffDir } from "../core/loop.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");
const SUPPRESS_ENGINE = "/nonexistent-lzy-suppressed-engine";
const HOME = mkdtempSync(join(tmpdir(), "lzy-h3r-home-"));

const h3r = await import("../core/h3r.js").catch(() => null);

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

// 造一个 executing 态的 scratch goal，计划条目文本可控（这是 H3R 的判定面）。
function executingRepo(prefix, stepTitles) {
  const d = repo(prefix);
  lzy(["loop", "register", "h3r", "--title", "t", "--risk", "med"], d);
  writeFileSync(join(d, "p.md"), `${stepTitles.map((t, i) => `- [N${i + 1}] ${t}`).join("\n")}\n`);
  const plan = lzy(["loop", "plan", "p.md"], d);
  if (plan.code !== 0) throw new Error(`plan 失败：${plan.out}`);
  lzy(["loop", "start"], d);
  return d;
}

const passDeps = (run, extra = {}) => ({
  enginePath: "/fake/engine.cjs",
  detectAuth: () => ({ oauth: true, envAuth: false, ok: true }),
  run: run ?? (() => ({ exitCode: 0, stdout: "{}", stderr: "" })),
  ...extra,
});

// 每段假引擎把「第一个 pending 步」翻 done —— 让夹具能真的往前走（否则第二段就撞 stuck）。
function advancingEngine(d) {
  const calls = [];
  const run = () => {
    calls.push(1);
    const p = join(d, ".lazyzcode", "loop", "goal.json");
    const goal = JSON.parse(readFileSync(p, "utf8"));
    const i = goal.steps.findIndex((s) => s.status !== "done");
    if (i >= 0) goal.steps[i] = { ...goal.steps[i], status: "done" };
    writeFileSync(p, `${JSON.stringify(goal, null, 2)}\n`);
    return { exitCode: 0, stdout: '{"sessionId":"sess-h3r","response":"ok","usage":{}}', stderr: "" };
  };
  return { run, calls };
}

function captureStdout(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  return Promise.resolve(fn())
    .finally(() => {
      console.log = orig;
    })
    .then((r) => ({ result: r, lines: lines.join("\n") }));
}

const snapshots = (d) => {
  try {
    return readdirSync(handoffDir(d));
  } catch {
    return [];
  }
};

// 每个 case 跑完把租约与 fence 清干净（drive 的 finally 已释放，这里兜底防串味）
async function withEnv(value, fn) {
  const prev = process.env.LZY_ABLATE_H3R_GATE;
  if (value === null) delete process.env.LZY_ABLATE_H3R_GATE;
  else process.env.LZY_ABLATE_H3R_GATE = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.LZY_ABLATE_H3R_GATE;
    else process.env.LZY_ABLATE_H3R_GATE = prev;
  }
}

// ── 唤醒半：开时停摆 ─────────────────────────────────────────────────────────
test("H3R 唤醒半：高危步在首位 → 一次引擎调用都不花，直接停摆+快照落盘", async () => {
  const d = executingRepo("lzy-h3r-first-", ["执行 rm -rf build-cache/ 清理并提交", "补充 README 用法一节"]);
  const eng = advancingEngine(d);
  const { result, lines } = await withEnv("1", () =>
    captureStdout(() => runDrive(d, { maxSegments: 4 }, passDeps(eng.run, { detectAuth: () => ({ oauth: true, ok: true }) }))),
  );
  assert.equal(result.ok, true, "停摆是干净收束（ok:true ⇒ 退出码 0）");
  assert.match(result.cause, /高危步停摆（H3R）/, `收束因须点名 h3r。实得：${result.cause}`);
  assert.match(result.cause, /N1/, "收束因须点名命中的步骤 id");
  assert.match(lines, /rm -rf/, "stdout 须透出命中词");
  // 零引擎 spawn：门在 spawn 之前，连一次引擎调用都不花（这是位置选择的全部价值）
  assert.equal(eng.calls.length, 0, `首位命中即停，不得 spawn 任何段。实得调用数=${eng.calls.length}`);
  // 7 字段快照落盘 + marker 登记
  const snaps = snapshots(d);
  assert.equal(snaps.length, 1, `须恰有一份交接快照。实得：${snaps.length}`);
  assert.ok(existsSync(join(d, ".lazyzcode", "loop", "handoff.json")), "handoff marker 须已登记");
  // 快照内容承载恢复路径
  const body = readFileSync(join(handoffDir(d), snaps[0]), "utf8");
  assert.match(body, /交接快照/);
  assert.match(body, /ADR-0022|人工/, "风险与坑须给人工恢复指引");
  assert.match(body, /N1/, "剩余步骤须含未完成的 N1");
});

test("H3R 唤醒半：高危步在第二位 → 先推进安全步，恰好停在触门前", async () => {
  const d = executingRepo("lzy-h3r-second-", ["整理构建脚本", "执行 rm -rf build-cache/ 清理并提交"]);
  const eng = advancingEngine(d);
  const { result } = await withEnv("1", () =>
    captureStdout(() => runDrive(d, { maxSegments: 4 }, passDeps(eng.run))),
  );
  assert.equal(result.ok, true);
  assert.match(result.cause, /高危步停摆（H3R）：N2/, `须停在高危步 N2。实得：${result.cause}`);
  // 安全步照跑（这正是「触门前判定」相对「any-pending 提前停」的差别：不白扔安全活）
  assert.equal(eng.calls.length, 1, `安全步须被推进一次。实得=${eng.calls.length}`);
  const goal = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8"));
  assert.equal(goal.steps[0].status, "done", "N1 安全步须已完成");
  assert.equal(goal.steps[1].status, "pending", "N2 高危步须原封未动");
});

test("H3R 唤醒半：升格标记 [risk:high] 与词表走同一通道（不靠词表），且高危步零执行", async () => {
  const d = executingRepo("lzy-h3r-mk-", ["清理临时产物 [risk:high]"]);
  const eng = advancingEngine(d);
  const { result } = await withEnv("1", () =>
    captureStdout(() => runDrive(d, { maxSegments: 4 }, passDeps(eng.run))),
  );
  assert.equal(result.ok, true);
  assert.match(result.cause, /高危步停摆（H3R）/);
  assert.match(result.cause, /risk:high/, "标记须作为命中项出现在报文里");
  assert.equal(eng.calls.length, 0);
  // 「未执行任何步骤」：goal 里 N1 仍 pending（门在 spawn 前，连安全步也没跑）
  const goal = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8"));
  assert.equal(goal.steps.filter((s) => s.status === "done").length, 0, "停摆不得留下已执行步骤");
});

test("H3R 唤醒半：下一步干净则不停（停摆不是「开开关就全停」）", async () => {
  const d = executingRepo("lzy-h3r-clean-", ["整理构建脚本", "补充 README 用法一节"]);
  const eng = advancingEngine(d);
  const { result } = await withEnv("1", () =>
    captureStdout(() => runDrive(d, { maxSegments: 2 }, passDeps(eng.run))),
  );
  assert.ok(!/高危步停摆/.test(result.cause), `无命中不得停摆。实得：${result.cause}`);
  assert.ok(eng.calls.length > 0, "无命中时段循环须照常推进");
});

test("H3R 唤醒半：无未完步骤则不停（收尾路径不被误拦）", async () => {
  const d = executingRepo("lzy-h3r-nopending-", ["只此一步"]);
  const goalPath = join(d, ".lazyzcode", "loop", "goal.json");
  const goal = JSON.parse(readFileSync(goalPath, "utf8"));
  goal.steps = goal.steps.map((s) => ({ ...s, status: "done" }));
  writeFileSync(goalPath, `${JSON.stringify(goal, null, 2)}\n`);
  const eng = advancingEngine(d);
  const { result } = await withEnv("1", () =>
    captureStdout(() => runDrive(d, { maxSegments: 1 }, passDeps(eng.run))),
  );
  assert.ok(!/高危步停摆/.test(result.cause), `无 pending 不得停摆。实得：${result.cause}`);
});

// ── 休眠半：默认关 = 行为与改动前逐字段同 ────────────────────────────────────
test("H3R 休眠半：开关缺席 → 同一高危夹具照常推进，绝无 h3r 因", async () => {
  const d = executingRepo("lzy-h3r-off-", ["整理构建脚本", "执行 rm -rf build-cache/ 清理并提交"]);
  const eng = advancingEngine(d);
  const { result, lines } = await withEnv(null, () =>
    captureStdout(() => runDrive(d, { maxSegments: 1 }, passDeps(eng.run))),
  );
  assert.ok(!/高危步停摆/.test(result.cause ?? ""), `默认关不得出现 h3r 因。实得：${result.cause}`);
  assert.ok(!/H3R/.test(lines), `默认关 stdout 不得出现 H3R 字样。实得：${lines}`);
  assert.equal(eng.calls.length, 1, "默认关须正常 spawn 段（行为与 0.2.1 同）");
  // 关态可能因**其他**收束因（此处=段数尽）写快照——那是 drive 既有行为，不是 H3R 造成的；
  // 判据落在「快照里不得有 H3R 痕迹」，而不是「不得有快照」。
  for (const s of snapshots(d)) {
    const body = readFileSync(join(handoffDir(d), s), "utf8");
    assert.ok(!/H3R/.test(body), `默认关的快照不得含 H3R 痕迹。实得：${s}`);
  }
});

test("H3R 值语义：\"\" / \"0\" / \"true\" 一律不唤醒（沿 ablated 家法）", async () => {
  for (const v of ["", "0", "true", "TRUE", "yes"]) {
    const d = executingRepo(`lzy-h3r-val-`, ["执行 rm -rf build-cache/ 清理并提交"]);
    const eng = advancingEngine(d);
    const { result } = await withEnv(v, () =>
      captureStdout(() => runDrive(d, { maxSegments: 1 }, passDeps(eng.run))),
    );
    assert.ok(
      !/高危步停摆/.test(result.cause ?? ""),
      `值 ${JSON.stringify(v)} 不得唤醒门。实得 cause=${result.cause}`,
    );
  }
});

// ── core/h3r.js 判定面单元例（基线 worktree 上模块缺席 → 跳过并标注）──────────
test("H3R 判定面：词表命中 / 大小写不敏感 / 升格标记 / 空文本", { skip: h3r ? false : "core/h3r.js 缺席（基线 worktree 红半面）——动态导入跳过" }, () => {
  assert.deepEqual(h3r.h3rMatches("执行 rm -rf build-cache/ 清理"), ["rm -rf"]);
  assert.deepEqual(h3r.h3rMatches("Rotate the CREDENTIALS file"), ["credentials"], "大小写不敏感");
  assert.deepEqual(h3r.h3rMatches("读取 .env 并复制"), [".env"]);
  assert.deepEqual(h3r.h3rMatches("npm publish 发版"), ["npm publish"]);
  assert.deepEqual(h3r.h3rMatches("目录清理 [risk:high]"), ["[risk:high]"], "升格标记走同一通道");
  assert.deepEqual(h3r.h3rMatches(""), [], "空文本零命中");
  assert.deepEqual(h3r.h3rMatches("无任何高危字样的普通步骤"), [], "干净文本零命中");
  // 六枚预注册具名词逐一可命中（词表是判定面，缺一枚即判定漏一 class；比对时剪尾空格）
  for (const w of ["rm -rf", "credentials", ".env", "--force", "npm publish", "chmod"]) {
    const hits = h3r.h3rMatches(`前置文本 ${w} 后置文本`).map((h) => h.trim());
    assert.ok(hits.includes(w), `预注册词 ${w} 须可命中。实得命中=${JSON.stringify(hits)}`);
  }
});

test("H3R 唤醒判据：恰 \"1\" 才真；其余取值一律假", { skip: h3r ? false : "core/h3r.js 缺席（基线 worktree 红半面）——动态导入跳过" }, () => {
  assert.equal(h3r.h3rArmed({ LZY_ABLATE_H3R_GATE: "1" }), true);
  for (const v of ["", "0", "true", "TRUE", "10", " 1", "yes"]) {
    assert.equal(h3r.h3rArmed({ LZY_ABLATE_H3R_GATE: v }), false, `值 ${JSON.stringify(v)} 不得唤醒`);
  }
  assert.equal(h3r.h3rArmed({}), false, "缺席不得唤醒");
});

test("H3R 判定面：只看下一步（触门前判定），不扫全量 pending", { skip: h3r ? false : "core/h3r.js 缺席（基线 worktree 红半面）——动态导入跳过" }, () => {
  const goal = {
    steps: [
      { id: "N1", status: "pending", title: "整理构建脚本" },
      { id: "N2", status: "pending", title: "执行 rm -rf build-cache/" },
    ],
  };
  assert.deepEqual(h3r.h3rStepVerdict(goal).matches, [], "下一步干净 ⇒ 不停（哪怕后面有高危步）");
  const goal2 = { steps: [{ id: "N1", status: "done", title: "x" }, ...goal.steps.slice(1)] };
  assert.deepEqual(h3r.h3rStepVerdict(goal2).matches, ["rm -rf"], "翻到高危步即命中");
  assert.equal(h3r.h3rStepVerdict({ steps: [] }).step, null, "无 pending 返回空判定");
});
