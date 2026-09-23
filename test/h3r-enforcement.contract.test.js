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
  // ADJ-28（v023 双审）：默认剔除残留开关/段标——休眠用例不得随宿主消融 shell 假红
  //（评审活体复现：LZY_ABLATE_H3R_PRETOOL=1 环境下「休眠（无开关）」用例挂）。
  // 需要开/关两半的用例显式传值（null 仍=剔除）。
  for (const k of ["LZY_ABLATE_H3R_GATE", "LZY_ABLATE_H3R_PRETOOL", "LZY_ABLATE_H3R_ONESTEP", "LZY_ABLATE_HOOK_H3R_PRETOOL", "LZY_SEGMENT_ID", "LZY_LOOP_DIR"]) {
    delete env[k];
  }
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

// 非命中契约：exit 0 且**无判定输出**。`{}`（hook-lib failOpen 形态，comment-checker 先例）
// 与空输出都是合法静默；**有 hookSpecificOutput 才算判定**——断言钉这个语义，别钉字节。
function assertSilent(r, label = "") {
  assert.equal(r.code, 0, `${label} 应 exit 0：${r.out}`);
  const parsed = r.out === "" ? {} : JSON.parse(r.out);
  assert.equal(parsed.hookSpecificOutput, undefined, `${label} 非命中不得有判定：${r.out}`);
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
  // ADJ-28（v023 双审）：同 hook() 家法——CLI 面用例默认剔除残留开关/段标
  for (const k of ["LZY_ABLATE_H3R_GATE", "LZY_ABLATE_H3R_PRETOOL", "LZY_ABLATE_H3R_ONESTEP", "LZY_ABLATE_HOOK_H3R_PRETOOL", "LZY_SEGMENT_ID", "LZY_LOOP_DIR"]) {
    delete env[k];
  }
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
  assert.equal(fromDisk.length, 15, "词表 15 枚（ADJ-41 补 push -f / id_ed25519；加词即改判定，须显式记账）");
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
test("钩子：休眠（无开关）⇒ 无判定输出、无标记", () => {
  const d = scratch("lzy-h3r-hookoff-");
  try {
    const r = hook(bashCall("rm -rf build-cache", d), { LZY_SEGMENT_ID: "1:seg-1", LZY_LOOP_DIR: loopDir(d) });
    assertSilent(r, "休眠");
    assert.equal(existsSync(hitFile(d)), false);
  } finally {
    cleanup(d);
  }
});

test("钩子：有关闭但无段标（交互形态）⇒ 不判（车道边界=仅无人值守段）", () => {
  const d = scratch("lzy-h3r-hookinteractive-");
  try {
    const r = hook(bashCall("rm -rf build-cache", d), { LZY_ABLATE_H3R_PRETOOL: "1", LZY_SEGMENT_ID: null, LZY_LOOP_DIR: loopDir(d) });
    assertSilent(r, "无段标=非 drive 派生");
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

test("钩子：唤醒 + 段标 + 干净命令 ⇒ 不误停（无判定输出）", () => {
  const d = scratch("lzy-h3r-hookclean-");
  try {
    const r = hook(bashCall("npm test -- --test-name-pattern=h3r", d), {
      LZY_ABLATE_H3R_PRETOOL: "1",
      LZY_SEGMENT_ID: "3:seg-2",
      LZY_LOOP_DIR: loopDir(d),
    });
    assertSilent(r, "干净命令");
    assert.equal(existsSync(hitFile(d)), false);
  } finally {
    cleanup(d);
  }
});

test("钩子：记账面排除（lzy CLI 与提交管道不判）——步标题含词表字样不误伤", () => {
  const d = scratch("lzy-h3r-hookbook-");
  try {
    const env = { LZY_ABLATE_H3R_PRETOOL: "1", LZY_SEGMENT_ID: "3:seg-2", LZY_LOOP_DIR: loopDir(d) };
    assertSilent(hook(bashCall(`node ${CLI} step done N2 --note "执行 rm -rf build-cache/"`, d), env), "lzy 记账调用");
    assertSilent(hook(bashCall('git commit -qm "purge: rm -rf build-cache"', d), env), "提交管道");
    assertSilent(hook(bashCall("lzy loop status", d), env), "裸 lzy");
    assert.equal(existsSync(hitFile(d)), false);
  } finally {
    cleanup(d);
  }
});

test("钩子：失败边界——畸形 stdin 静默；标记不可写仍 deny", () => {
  const d = scratch("lzy-h3r-hookfail-");
  try {
    const bad = hook("not-json-at-all", { LZY_ABLATE_H3R_PRETOOL: "1", LZY_SEGMENT_ID: "1:seg-1", LZY_LOOP_DIR: loopDir(d) });
    assertSilent(bad, "畸形 stdin 不炸");
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
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(" "));
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
  const savedOne = process.env.LZY_ABLATE_H3R_ONESTEP;
  const savedPre = process.env.LZY_ABLATE_H3R_PRETOOL;
  process.env.LZY_ABLATE_H3R_ONESTEP = "1";
  process.env.LZY_ABLATE_H3R_PRETOOL = "1";
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
    if (savedOne === undefined) delete process.env.LZY_ABLATE_H3R_ONESTEP;
    else process.env.LZY_ABLATE_H3R_ONESTEP = savedOne;
    if (savedPre === undefined) delete process.env.LZY_ABLATE_H3R_PRETOOL;
    else process.env.LZY_ABLATE_H3R_PRETOOL = savedPre;
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
    goal.status = "done"; // 终态由 status 判（同 drive.contract 的 markAllSteps{finish:true} 家法）
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
  const savedPre = process.env.LZY_ABLATE_H3R_PRETOOL;
  process.env.LZY_ABLATE_H3R_PRETOOL = "1"; // 消费路径的唤醒开关（他段标记的处置同受它管）
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
    if (savedPre === undefined) delete process.env.LZY_ABLATE_H3R_PRETOOL;
    else process.env.LZY_ABLATE_H3R_PRETOOL = savedPre;
    cleanup(d);
  }
});

// ── ④ v023-fix-round N2（ADJ-05/06/22/41）：isBookkeeping 收窄 / 引号路径 / 段标形状 / 词表缺口 ──
test("N2/ADJ-05：复合命令以记账动词打头不再整行免检（元字符护栏）", () => {
  const d = scratch("lzy-n2-compound-");
  try {
    const env = { LZY_ABLATE_H3R_PRETOOL: "1", LZY_SEGMENT_ID: "3:seg-2", LZY_LOOP_DIR: loopDir(d) };
    const r = hook(bashCall("git status && rm -rf build-cache", d), env);
    assert.equal(r.code, 0, r.out);
    const parsed = r.out === "" ? {} : JSON.parse(r.out);
    assert.equal(
      parsed.hookSpecificOutput?.permissionDecision,
      "deny",
      `复合命令不得借记账头免检（ADJ-05 探针原形）：${r.out}`,
    );
    assert.ok(existsSync(hitFile(d)), "命中标记照常落盘");
  } finally {
    cleanup(d);
  }
});

test("N2/ADJ-06：引号路径的 lzy.js 记账调用仍走排除通道（win32 含空格用户名形态）", () => {
  const d = scratch("lzy-n2-quoted-");
  try {
    const env = { LZY_ABLATE_H3R_PRETOOL: "1", LZY_SEGMENT_ID: "3:seg-2", LZY_LOOP_DIR: loopDir(d) };
    assertSilent(
      hook(bashCall('node "/Users/Wei Ming/tools/lazyzcode/cli/lzy.js" step done N1 --note "rm -rf 见计划"', d), env),
      "引号路径记账调用（ADJ-06：\\S* 无法跨空格 ⇒ 排除通道静默失效）",
    );
    assertSilent(
      hook(bashCall('node "C:\\\\tools\\\\my lzy\\\\lzy.js" step done N1 --note "见计划"', d), env),
      "win32 反斜杠引号路径同形",
    );
  } finally {
    cleanup(d);
  }
});

test("N2/ADJ-22：段标形状校验——畸形段标按无段标处置（残留 env 不激活门）", () => {
  const d = scratch("lzy-n2-shapehook-");
  try {
    const r = hook(bashCall("rm -rf build-cache", d), {
      LZY_ABLATE_H3R_PRETOOL: "1",
      LZY_SEGMENT_ID: "residual-junk",
      LZY_LOOP_DIR: loopDir(d),
    });
    assertSilent(r, "畸形段标=非 drive 派生（形状不符不判）");
    assert.equal(existsSync(hitFile(d)), false);
  } finally {
    cleanup(d);
  }
});

// ── ⑤ v024-debt-bundle N1：命令层门解析面根解（分段+词元序列匹配，ADR-0022 升格触发件）──
// 红绿对照钉三形：误报清理形（子串语义命中、词元语义必须干净——改前跑本组即红半取证）；
// 保留命中形（改前改后都必须 deny，既有覆盖零回退）；契约冻结形（matched 保形 / H3R_DENY
// 首词 / detail 纯加字段，core/drive.js 与 scripts/ablation/common.mjs 零改动可续读）。
const N1_ENV = (d) => ({ LZY_ABLATE_H3R_PRETOOL: "1", LZY_SEGMENT_ID: "3:seg-2", LZY_LOOP_DIR: loopDir(d) });

test("N1 解析面：词元边界序列——子串误报形必须干净（改前=红半取证）", () => {
  const d = scratch("lzy-n1-tokenfalse-");
  try {
    for (const [cmd, why] of [
      ['grep "ssh keys" authorized_hosts', "双词形 ssh key 吃进 ssh keys 的子串（§N1 点名误报形）"],
      ["echo npm publish-dry", "npm publish 吃进 publish-dry 的子串（§N1 点名误报形）"],
      ["echo ssh keys ls", "无引号复数同形"],
      ["git push --dry-run origin main", "防回退护栏：--dry-run 非强推非发布"],
    ]) {
      assertSilent(hook(bashCall(cmd, d), N1_ENV(d)), `${why}：${cmd}`);
    }
    assert.equal(existsSync(hitFile(d)), false, "误报形不得留命中标记");
  } finally {
    cleanup(d);
  }
});

test("N1 解析面：词表 15 词正例各一改前改后都命中（覆盖零回退）", () => {
  const d = scratch("lzy-n1-positives-");
  try {
    const cases = [
      ["rm -rf build-cache", "rm -rf"],
      ["rm -r old-dir", "rm -r "],
      ["rmdir empty-dir", "rmdir "],
      ["shred secret.txt", "shred "],
      ["truncate -s 0 big.log", "truncate "],
      ["cp credentials.json backup/", "credentials"],
      ["cat .env", ".env"],
      ["cat ~/.ssh/id_rsa", "id_rsa"],
      ["cat ~/.ssh/id_ed25519", "id_ed25519"],
      ['cp "client ssh key" backup/', "ssh key"],
      ["npm publish", "npm publish"],
      ["git push --force origin main", "--force"],
      ["git push -f origin main", "push -f"],
      ["chmod 600 ~/.ssh/id_rsa", "chmod "],
      ["chown root:root /var/log/app", "chown "],
    ];
    for (const [cmd, word] of cases) {
      const r = hook(bashCall(cmd, d), N1_ENV(d));
      assert.equal(r.code, 0, r.out);
      const parsed = r.out === "" ? {} : JSON.parse(r.out);
      assert.equal(parsed.hookSpecificOutput?.permissionDecision, "deny", `正例须命中：${cmd} ⇒ ${r.out}`);
      const marker = JSON.parse(readFileSync(hitFile(d), "utf8"));
      assert.ok(Array.isArray(marker.matched) && marker.matched.includes(word), `matched 保形且含原词「${word}」：${JSON.stringify(marker.matched)}`);
      rmSync(hitFile(d), { force: true });
    }
    const r = hook(bashCall("Git Push -F origin main", d), N1_ENV(d));
    const parsed = r.out === "" ? {} : JSON.parse(r.out);
    assert.equal(parsed.hookSpecificOutput?.permissionDecision, "deny", "大小写归一保留（非小写形态一枚）");
  } finally {
    cleanup(d);
  }
});

test("N1 解析面：复合元字符非豁免形照旧命中（分段后各段独立判）", () => {
  const d = scratch("lzy-n1-compound-");
  try {
    for (const cmd of [
      "cat a | shred b",
      "echo hi && rm -rf build-cache",
      "echo $(rm -rf build-cache)",
      "git status; chmod 777 /etc/hosts",
    ]) {
      const r = hook(bashCall(cmd, d), N1_ENV(d));
      const parsed = r.out === "" ? {} : JSON.parse(r.out);
      assert.equal(parsed.hookSpecificOutput?.permissionDecision, "deny", `复合形须命中：${cmd} ⇒ ${r.out}`);
      rmSync(hitFile(d), { force: true });
    }
  } finally {
    cleanup(d);
  }
});

test("N1 解析面：契约冻结——matched 保形 / H3R_DENY 首词 / detail 纯加字段（rm 族目标抽取）", () => {
  const d = scratch("lzy-n1-freeze-");
  try {
    const r = hook(bashCall("rm -rf build-cache dist", d), N1_ENV(d));
    const parsed = JSON.parse(r.out);
    const spec = parsed.hookSpecificOutput;
    assert.match(spec.permissionDecisionReason, /^H3R_DENY /, "稳定首词冻结（仪器锚）");
    assert.match(spec.permissionDecisionReason, /rm -rf/, "命中词仍在理由内");
    const marker = JSON.parse(readFileSync(hitFile(d), "utf8"));
    assert.ok(Array.isArray(marker.matched) && typeof marker.matched[0] === "string", "matched 保持字符串数组（drive.js takeH3rHit 零改动可读）");
    assert.ok(marker.detail, "detail 加字段在场");
    assert.equal(marker.detail.parse.ok, true);
    assert.ok(Array.isArray(marker.detail.segments) && marker.detail.segments.length > 0);
    assert.ok(marker.detail.segments.some((s) => s.hits.includes("rm -rf")), "分段命中词结构化");
    const seg = marker.detail.segments.find((s) => s.hits.includes("rm -rf"));
    assert.ok(Array.isArray(seg.targets) && seg.targets.includes("build-cache") && seg.targets.includes("dist"), `rm 族删除目标词元抽取：${JSON.stringify(seg.targets)}`);
  } finally {
    cleanup(d);
  }
});

test("N1 解析面：解析歧义 fail-closed——不平衡引号/括号/反引号 ⇒ deny（改前=红半取证）", () => {
  const d = scratch("lzy-n1-ambiguous-");
  try {
    for (const [cmd, why] of [
      ['echo "unclosed', "双引号不平衡"],
      ["echo 'unclosed", "单引号不平衡"],
      ["echo $(date", "命令替换括号不平衡"],
      ["echo `date", "反引号不平衡"],
    ]) {
      const r = hook(bashCall(cmd, d), N1_ENV(d));
      const parsed = r.out === "" ? {} : JSON.parse(r.out);
      assert.equal(parsed.hookSpecificOutput?.permissionDecision, "deny", `${why} 保守拦截：${cmd} ⇒ ${r.out}`);
      assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /^H3R_DENY /);
      const marker = JSON.parse(readFileSync(hitFile(d), "utf8"));
      assert.equal(marker.detail.parse.ok, false, `detail.parse 记歧义：${cmd}`);
      rmSync(hitFile(d), { force: true });
    }
    // 对照：平衡的子壳/替换形不得误判为解析歧义（(rm -rf x) 靠词元切分照常命中）
    const ok = hook(bashCall("(rm -rf build-cache)", d), N1_ENV(d));
    const okParsed = JSON.parse(ok.out);
    assert.equal(okParsed.hookSpecificOutput.permissionDecision, "deny");
    const marker = JSON.parse(readFileSync(hitFile(d), "utf8"));
    assert.equal(marker.detail.parse.ok, true, "平衡括号不误报歧义");
  } finally {
    cleanup(d);
  }
});

test("N2/ADJ-41：词表缺口三形——短旗标强推 / ed25519 私钥名 / 空白逃逸（对照半区在案）", () => {
  const d = scratch("lzy-n2-words-");
  try {
    const env = { LZY_ABLATE_H3R_PRETOOL: "1", LZY_SEGMENT_ID: "3:seg-2", LZY_LOOP_DIR: loopDir(d) };
    for (const [cmd, why] of [
      ["git push -f origin main", "短旗标强推（src 自称覆盖强推但 -f 漏出）"],
      ["cat ~/.ssh/id_ed25519 >> ~/.ssh/authorized_keys", "ed25519 私钥名（id_rsa 同族漏出）"],
      ["rm\t-rf build-cache", "制表符空白逃逸（双空格/制表符绕过子串）"],
      ["git push  -f origin main", "双空格逃逸"],
    ]) {
      const r = hook(bashCall(cmd, d), env);
      assert.equal(r.code, 0, r.out);
      const parsed = r.out === "" ? {} : JSON.parse(r.out);
      assert.equal(parsed.hookSpecificOutput?.permissionDecision, "deny", `${why}：${cmd} ⇒ ${r.out}`);
    }
    // 对照半区：普通 push 静默；--force-with-lease 被 --force 子串覆盖命中 deny——
    // 这是词表 src 注记明文的粗子串语义（已知过匹配，deny 方向安全），照设计钉住。
    assertSilent(hook(bashCall("git push origin main", d), env), "普通 push");
    const fw = hook(bashCall("git push --force-with-lease origin main", d), env);
    const fwParsed = fw.out === "" ? {} : JSON.parse(fw.out);
    assert.equal(fwParsed.hookSpecificOutput?.permissionDecision, "deny", "--force 子串覆盖 --force-with-lease（词表 src 记账的过匹配，照设计）");
  } finally {
    cleanup(d);
  }
});

// ── N1 解析面四修（v024-fix-round#N6，ADJ-06/07/08/09）──────────────────────
// 四条=改前态实测的机械绕过/误停（红半：artifacts/v024-fix-round/F3-red.txt 四对照 0/4）。
const WAKE = { LZY_ABLATE_H3R_PRETOOL: "1", LZY_SEGMENT_ID: "424242:seg-1" };

test("N1/ADJ-06：段数不截断——第 9 段起的高危词照旧命中（改前：.slice(0,8) 静默放行）", () => {
  const cmd = [...Array(8)].map((_, i) => `echo s${i + 1}`).concat("rm -rf /tmp/lzy-probe").join(" && ");
  const r = hook(bashCall(cmd, "/tmp"), WAKE);
  assert.match(r.out, /H3R_DENY/, "9 段复合（第 9 段含 rm -rf）必须命中");
});

test("N1/ADJ-07：记账前缀 + 换行复合不再整行免检（改前：元字符类漏 \\n）", () => {
  const r = hook(bashCall("git status\nrm -rf /tmp/lzy-probe", "/tmp"), WAKE);
  assert.match(r.out, /H3R_DENY/, "换行是 shell 分隔符，记账豁免不得整行放行");
});

test("N1/ADJ-08：引号配对扫描——合法撇号引号不误停、未闭合仍 fail-closed（改前：合计奇偶）", () => {
  assertSilent(hook(bashCall(`echo "it's fine"`, "/tmp"), WAKE), "合法引号命令");
  assert.match(hook(bashCall(`echo "abc`, "/tmp"), WAKE).out, /H3R_DENY/, "未闭合引号仍须 fail-closed");
});

test("N1/ADJ-09：词中引号不再劈词（shell 忠实流；改前：引号即切分点 ⇒ 字节等价逃逸）", () => {
  assert.match(hook(bashCall(`npm pub"lish" --tag next`, "/tmp"), WAKE).out, /H3R_DENY/, "npm pub\\\"lish\\\"");
  assert.match(hook(bashCall(`git push --for"ce" origin main`, "/tmp"), WAKE).out, /H3R_DENY/, "git push --for\\\"ce\\\"");
  // 反向：引号藏词形态（流 A 命中）不回归
  assert.match(hook(bashCall(`cat "ssh key"`, "/tmp"), WAKE).out, /H3R_DENY/, "双词形藏词仍命中");
});
