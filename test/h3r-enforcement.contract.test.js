// H3R 换执法点契约测试（0.2.3 goal v023-h3r-enforcement；计划 详单 N9）
// 三面：① 词表单源（core 读者 vs 钩子同读的 plugin/hooks/h3r-words.json）
//       ② 一段一步机器核验（LZY_SEGMENT_ID 申报 + loop/segment.json）
//       ③ PreToolUse 门原型（plugin/hooks/h3r-pretool.js：作用域闸门 / 记账面排除 / deny 形状 / 命中标记）
// 全部经 process.execPath 拉起真实脚本与 CLI；HOME 隔离；不触碰真实仓库 .lazyzcode/。
// win32 雷回避：不 split("/")、路径断言用 join。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const HOOKS = join(ROOT, "plugin", "hooks");
const CLI = join(ROOT, "cli", "lzy.js");
const WORDS_FILE = join(HOOKS, "h3r-words.json");
const ISOLATED_HOME = mkdtempSync(join(tmpdir(), "lzy-h3r-home-"));

const scratch = (prefix) => mkdtempSync(join(tmpdir(), prefix));
const cleanup = (...dirs) => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
};

// 钩子实跑（同 hooks.contract.test.js 家法）：合成 stdin + env 覆盖；null 值=剔除该键。
// 脚本必须在场——否则「没输出」会被误读成「休眠零输出」（空过），红半取证时尤其危险。
function hook(input, extraEnv = {}) {
  const script = join(HOOKS, "h3r-pretool.js");
  assert.ok(existsSync(script), "h3r-pretool.js 必须在场（否则断言空输出=空过）");
  const env = { ...process.env, HOME: ISOLATED_HOME, USERPROFILE: ISOLATED_HOME };
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === null) delete env[k];
    else env[k] = v;
  }
  const r = spawnSync(process.execPath, [script], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    timeout: 20_000,
    env,
  });
  return { code: r.status, out: (r.stdout ?? "").trim() };
}

function bashCall(command, cwd) {
  return { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd, session_id: "s" };
}

// scratch 仓 + executing goal（register 硬拒非 git 宿主，ADR-0019 ⇒ 必须 git init）。
function execRepo(prefix, planLines = ["- [N1] 一步", "- [N2] 二步"]) {
  const d = scratch(prefix);
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "a\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "init"]);
  const env = { ...process.env, HOME: ISOLATED_HOME, USERPROFILE: ISOLATED_HOME, LZY_ABLATE_HUMAN_GATE: "1" };
  const run = (args, extra = {}) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd: d, encoding: "utf8", timeout: 60_000, env: { ...env, ...extra } });
  run(["loop", "register", "h3r", "--title", "t"]);
  writeFileSync(join(d, "p.md"), `${planLines.join("\n")}\n`);
  run(["loop", "plan", "p.md"]);
  run(["loop", "start"]);
  return { dir: d, run };
}

const loopDir = (d) => join(d, ".lazyzcode", "loop");
const segmentFile = (d) => join(loopDir(d), "segment.json");
const hitFile = (d) => join(loopDir(d), "h3r-hit.json");

// ── ① 词表单源 ───────────────────────────────────────────────────────────────
test("词表单源：core 读者与 plugin/hooks/h3r-words.json 词序一致（两读者同读一份）", async () => {
  const h3r = await import("../core/h3r.js");
  const disk = JSON.parse(readFileSync(WORDS_FILE, "utf8"));
  const fromDisk = disk.words.map((x) => x.w);
  const r = h3r.loadWordlist();
  assert.equal(r.ok, true, `词表应可读：${JSON.stringify(r)}`);
  assert.deepEqual(r.words, fromDisk, "core 读者与磁盘词序一致");
  assert.deepEqual(h3r.h3rWordlist(), fromDisk, "抛错读者同序");
  assert.equal(fromDisk.length, 13, "词表 13 枚（加词即改判定，须显式记账）");
  assert.ok(disk.words.every((x) => typeof x.src === "string" && x.src.length > 0), "每词带来源");
});

// ── ② 一段一步机器核验 ────────────────────────────────────────────────────────
test("一段一步：唤醒 + 段标下同段第二次 step done 被拒（恢复式报文）", () => {
  const { dir, run } = execRepo("lzy-h3r-oneseg-");
  try {
    const env = { LZY_ABLATE_H3R_ONESTEP: "1", LZY_SEGMENT_ID: "1:seg-1" };
    const first = run(["step", "done", "N1", "--note", "第一步"], env);
    assert.equal(first.status, 0, `首步应过：${first.stdout}${first.stderr}`);
    const second = run(["step", "done", "N2", "--note", "第二步"], env);
    assert.equal(second.status, 1, "同段第二步应被拒");
    assert.match(`${second.stdout}${second.stderr}`, /本段已翻过一步（N1）/);
    assert.match(`${second.stdout}${second.stderr}`, /LZY_SEGMENT_ID/);
    const seg = JSON.parse(readFileSync(segmentFile(dir), "utf8"));
    assert.equal(seg.segmentId, "1:seg-1");
    assert.equal(seg.stepId, "N1");
  } finally {
    cleanup(dir);
  }
});

test("一段一步：休眠（无段标）⇒ 同段两次照常通过，且不写 segment.json", () => {
  const { dir, run } = execRepo("lzy-h3r-onelight-");
  try {
    assert.equal(run(["step", "done", "N1", "--note", "一"]).status, 0);
    assert.equal(run(["step", "done", "N2", "--note", "二"]).status, 0);
    assert.equal(existsSync(segmentFile(dir)), false, "休眠态不留运行态文件");
  } finally {
    cleanup(dir);
  }
});

test("一段一步：跨 run 残留段标不误伤（他 fence 的 segment.json ⇒ 首步照常）", () => {
  const { dir, run } = execRepo("lzy-h3r-onestale-");
  try {
    mkdirSync(loopDir(dir), { recursive: true });
    writeFileSync(segmentFile(dir), JSON.stringify({ segmentId: "99:seg-1", stepId: "N1", at: "2026-01-01T00:00:00Z" }));
    const r = run(["step", "done", "N2", "--note", "新 run 的第一步"], { LZY_ABLATE_H3R_ONESTEP: "1", LZY_SEGMENT_ID: "7:seg-1" });
    assert.equal(r.status, 0, `残留段标不得误伤：${r.stdout}${r.stderr}`);
    assert.equal(JSON.parse(readFileSync(segmentFile(dir), "utf8")).segmentId, "7:seg-1", "新段覆写");
  } finally {
    cleanup(dir);
  }
});

// ── ③ PreToolUse 门原型 ───────────────────────────────────────────────────────
test("钩子：休眠（无开关）⇒ 空输出 exit 0、无标记", () => {
  const d = scratch("lzy-h3r-hookoff-");
  try {
    const r = hook(bashCall("rm -rf build-cache", d), { LZY_SEGMENT_ID: "1:seg-1", LZY_LOOP_DIR: loopDir(d) });
    assert.equal(r.code, 0);
    assert.equal(r.out, "", "休眠零输出（默认行为逐字段同）");
    assert.equal(existsSync(hitFile(d)), false);
  } finally {
    cleanup(d);
  }
});

test("钩子：有关闭但无段标（交互形态）⇒ 不判（车道边界=仅无人值守段）", () => {
  const d = scratch("lzy-h3r-hookinteractive-");
  try {
    const r = hook(bashCall("rm -rf build-cache", d), { LZY_ABLATE_H3R_PRETOOL: "1", LZY_SEGMENT_ID: null, LZY_LOOP_DIR: loopDir(d) });
    assert.equal(r.code, 0);
    assert.equal(r.out, "", "无段标=非 drive 派生 ⇒ 免门");
    assert.equal(existsSync(hitFile(d)), false);
  } finally {
    cleanup(d);
  }
});

test("钩子：唤醒 + 段标 + 命中 ⇒ deny JSON（形状钉死）+ 标记带 segmentId", () => {
  const d = scratch("lzy-h3r-hookhit-");
  try {
    const r = hook(bashCall("cp ~/.config/credentials.json dist/", d), {
      LZY_ABLATE_H3R_PRETOOL: "1",
      LZY_SEGMENT_ID: "3:seg-2",
      LZY_LOOP_DIR: loopDir(d),
    });
    assert.equal(r.code, 0, "deny 走 stdout JSON 非 exit 2");
    const parsed = JSON.parse(r.out);
    const spec = parsed.hookSpecificOutput;
    assert.equal(spec.hookEventName, "PreToolUse", "事件名必须回填（引擎严格校验）");
    assert.equal(spec.permissionDecision, "deny");
    assert.match(spec.permissionDecisionReason, /^H3R_DENY /, "稳定锚供仪器读（R3 警示①）");
    assert.match(spec.additionalContext, /不要改写命令绕过/);
    const marker = JSON.parse(readFileSync(hitFile(d), "utf8"));
    assert.equal(marker.segmentId, "3:seg-2");
    assert.equal(marker.tool, "Bash");
    assert.match(marker.command, /credentials/);
    assert.ok(Array.isArray(marker.matched) && marker.matched.includes("credentials"));
  } finally {
    cleanup(d);
  }
});

test("钩子：唤醒 + 段标 + 干净命令 ⇒ 无输出（不误停）", () => {
  const d = scratch("lzy-h3r-hookclean-");
  try {
    const r = hook(bashCall("npm test -- --test-name-pattern=h3r", d), {
      LZY_ABLATE_H3R_PRETOOL: "1",
      LZY_SEGMENT_ID: "3:seg-2",
      LZY_LOOP_DIR: loopDir(d),
    });
    assert.equal(r.code, 0);
    assert.equal(r.out, "");
    assert.equal(existsSync(hitFile(d)), false);
  } finally {
    cleanup(d);
  }
});

test("钩子：记账面排除（lzy CLI 与提交管道不判）——步标题含词表字样不误伤", () => {
  const d = scratch("lzy-h3r-hookbook-");
  try {
    const env = { LZY_ABLATE_H3R_PRETOOL: "1", LZY_SEGMENT_ID: "3:seg-2", LZY_LOOP_DIR: loopDir(d) };
    const a = hook(bashCall(`node ${CLI} step done N2 --note "执行 rm -rf build-cache/"`, d), env);
    assert.equal(a.out, "", `lzy 记账调用不判：${a.out}`);
    const b = hook(bashCall('git commit -qm "purge: rm -rf build-cache", ', d), env);
    assert.equal(b.out, "", `提交管道不判：${b.out}`);
    const c = hook(bashCall("lzy loop status", d), env);
    assert.equal(c.out, "");
    assert.equal(existsSync(hitFile(d)), false);
  } finally {
    cleanup(d);
  }
});

test("钩子：失败边界——畸形 stdin 静默 exit 0；标记不可写仍 deny", () => {
  const d = scratch("lzy-h3r-hookfail-");
  try {
    const bad = hook("not-json-at-all", { LZY_ABLATE_H3R_PRETOOL: "1", LZY_SEGMENT_ID: "1:seg-1", LZY_LOOP_DIR: loopDir(d) });
    assert.equal(bad.code, 0, "畸形 stdin 不炸（fail-open 由引擎侧承担）");
    assert.equal(bad.out, "");
    // 标记落点不可写：把 LZY_LOOP_DIR 指到一个「文件下面」，mkdir 必失败
    const blocker = join(d, "blocker");
    writeFileSync(blocker, "x\n");
    const r = hook(bashCall("rm -rf build-cache", d), {
      LZY_ABLATE_H3R_PRETOOL: "1",
      LZY_SEGMENT_ID: "1:seg-1",
      LZY_LOOP_DIR: join(blocker, "nested"),
    });
    const spec = JSON.parse(r.out).hookSpecificOutput;
    assert.equal(spec.permissionDecision, "deny", "标记写失败不阻断 deny");
  } finally {
    cleanup(d);
  }
});

// ── ④ 命中标记的 drive 消费（假段注入，家法同 test/drive.contract.test.js） ──────
test("标记消费：本段 segmentId ⇒ 干净收束（因含 PreToolUse + exit 0 + 快照 + 标记被消费）", async () => {
  const { runDrive } = await import("../core/drive.js");
  const { lintHandoffSnapshot } = await import("../core/loop.js");
  const d = scratch("lzy-h3r-consume-");
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "a\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "init"]);
  const env = { ...process.env, HOME: ISOLATED_HOME, USERPROFILE: ISOLATED_HOME, LZY_ABLATE_HUMAN_GATE: "1" };
  const cli = (args, extra = {}) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd: d, encoding: "utf8", timeout: 60_000, env: { ...env, ...extra } });
  cli(["loop", "register", "h3rc", "--title", "t"]);
  writeFileSync(join(d, "p.md"), "- [N1] 一步\n");
  cli(["loop", "plan", "p.md"]);
  cli(["loop", "start"]);
  const line = (x, ...rest) => rest.join(" ");
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(line(a));
  let seenSegmentId = null;
  const run = (x) => {
    seenSegmentId = x.env.LZY_SEGMENT_ID ?? null;
    mkdirSync(loopDir(d), { recursive: true });
    writeFileSync(
      hitFile(d),
      JSON.stringify({ segmentId: seenSegmentId, tool: "Bash", command: "rm -rf build-cache", matched: ["rm -rf"], at: new Date().toISOString() }),
    );
    return { exitCode: 0, stdout: "{}", stderr: "" };
  };
  try {
    const result = await runDrive(
      d,
      { maxSegments: 2 },
      {
        enginePath: "/fake/engine.cjs",
        detectAuth: () => ({ oauth: true, envAuth: false, ok: true }),
        run,
        rollingPoints: 0,
      },
    ).finally(() => {
      console.log = orig;
    });
    const out = lines.join("\n");
    assert.ok(seenSegmentId, "drive 唤醒态注入段标");
    assert.equal(result.ok, true, `命中=干净收束通道：${out}`);
    assert.match(out, /工具调用被拒（PreToolUse/);
    assert.equal(result.handoff != null, true, "带交接快照");
    assert.deepEqual(lintHandoffSnapshot(readFileSync(result.handoff, "utf8")), [], "快照过 7 字段 lint");
    assert.equal(existsSync(hitFile(d)), false, "标记已消费");
  } finally {
    console.log = orig;
    cleanup(d);
  }
});

test("标记消费：他段 segmentId ⇒ 收束因不变且标记被清（不是一行即停的匿名杠杆）", async () => {
  const { runDrive } = await import("../core/drive.js");
  const d = scratch("lzy-h3r-consumeforeign-");
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "a\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "init"]);
  const env = { ...process.env, HOME: ISOLATED_HOME, USERPROFILE: ISOLATED_HOME, LZY_ABLATE_HUMAN_GATE: "1" };
  const cli = (args) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd: d, encoding: "utf8", timeout: 60_000, env });
  cli(["loop", "register", "h3rf", "--title", "t"]);
  writeFileSync(join(d, "p.md"), "- [N1] 一步\n");
  cli(["loop", "plan", "p.md"]);
  cli(["loop", "start"]);
  const step = (d0) => {
    const goal = JSON.parse(readFileSync(join(loopDir(d0), "goal.json"), "utf8"));
    goal.steps = goal.steps.map((s) => ({ ...s, status: "done" }));
    writeFileSync(join(loopDir(d0), "goal.json"), `${JSON.stringify(goal, null, 2)}\n`);
  };
  let call = 0;
  const run = () => {
    call += 1;
    mkdirSync(loopDir(d), { recursive: true });
    writeFileSync(hitFile(d), JSON.stringify({ segmentId: "999:seg-9", tool: "Bash", command: "rm -rf x", matched: ["rm -rf"], at: new Date().toISOString() }));
    if (call === 1) step(d);
    return { exitCode: 0, stdout: "{}", stderr: "" };
  };
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try {
    const result = await runDrive(
      d,
      { maxSegments: 2 },
      { enginePath: "/fake/engine.cjs", detectAuth: () => ({ oauth: true, envAuth: false, ok: true }), run, rollingPoints: 0 },
    ).finally(() => {
      console.log = orig;
    });
    const out = lines.join("\n");
    assert.ok(!/工具调用被拒（PreToolUse/.test(out), `他段标记不得改变收束因：${out}`);
    assert.equal(result.cause, "done");
    assert.equal(existsSync(hitFile(d)), false, "他段标记被清");
  } finally {
    console.log = orig;
    cleanup(d);
  }
});
