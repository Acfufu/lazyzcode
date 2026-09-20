// 引擎输出面契约（v021-engine-surface#N4，ADR-0021）：lzy→引擎 CLI 的五个触面
// （--version / plugins enable / plugins uninstall / plugins list --json / headless --json）
// 逐面钉行为。背景：0.16.9 的 `plugins list --json` 由对象包封改出裸数组，而本仓该面
// 零测试覆盖，代际漂移直接表现为 status/doctor 的 enabled 行 fail 级误报（退出码被翻）。
// 本文件即该漂移的拦截网。
// win32 雷回避：路径一律 join/绝对路径，不手写分隔符；假引擎经 process.execPath 直跑。
import { test } from "node:test";

// 人权门消融：本文件不测采纳面，仅需 goal 流程不被人权门拦（沿 runtime-kernel 家法）。
process.env.LZY_ABLATE_HUMAN_GATE = "1";

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createEngineCli, findInstalledPlugin, normalizePluginList } from "../core/engine.js";
import { spawnHeadless } from "../core/headless.js";
import { pluginId } from "../core/paths.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const CLI = join(ROOT, "cli", "lzy.js");
const HOME = mkdtempSync(join(tmpdir(), "lzy-engsurface-home-"));
const MANIFEST = JSON.parse(
  readFileSync(join(ROOT, "plugin", ".zcode-plugin", "plugin.json"), "utf8"),
);
const ID = pluginId(MANIFEST); // lazyzcode@lazyzcode-local（勿硬编码）

// 假引擎：按 argv 分派五个面；输出载荷由 env 注入，使同一构件可扮两代包封。
// 落盘在各自 scratch 仓内，不进仓库树。
const FAKE_ENGINE_SRC = `
const argv = process.argv.slice(2);
const fs = require("node:fs");
const out = (s) => process.stdout.write(s);
if (argv[0] === "--version") { out((process.env.FAKE_VERSION ?? "0.16.9") + "\\n"); process.exit(0); }
if (argv[0] === "plugins" && argv[1] === "list") {
  const f = process.env.FAKE_LIST_FILE;
  out(f ? fs.readFileSync(f, "utf8") : "[]");
  process.exit(0);
}
if (argv[0] === "plugins" && argv[1] === "enable") process.exit(Number(process.env.FAKE_ENABLE_EXIT ?? "0"));
if (argv[0] === "plugins" && argv[1] === "uninstall") process.exit(Number(process.env.FAKE_UNINSTALL_EXIT ?? "0"));
if (argv.includes("--json")) { out(process.env.FAKE_HEADLESS_OUT ?? ""); process.exit(Number(process.env.FAKE_HEADLESS_EXIT ?? "0")); }
process.exit(1);
`;

let seq = 0;
function scratch() {
  seq += 1;
  const d = mkdtempSync(join(tmpdir(), `lzy-engsurface-${seq}-`));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@t"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "a\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "init"]);
  const engine = join(d, "fake-engine.cjs");
  writeFileSync(engine, FAKE_ENGINE_SRC);
  return { d, engine };
}

function lzy(args, s, env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: s.d,
    encoding: "utf8",
    timeout: 120_000,
    env: {
      ...process.env,
      HOME,
      USERPROFILE: HOME,
      LZY_ZCODE_ENGINE: s.engine,
      ...env,
    },
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

// 写一份 plugins list 载荷文件，返回其路径（假引擎照读照吐——含畸形 JSON 原样）。
function listFixture(s, raw, tag) {
  const p = join(s.d, `list-${tag}.json`);
  writeFileSync(p, typeof raw === "string" ? raw : JSON.stringify(raw));
  return p;
}

const REC = (over = {}) => ({
  id: ID,
  enabled: true,
  skillCount: 2,
  commandRootCount: 0,
  hookDetails: [{}, {}, {}, {}, {}],
  diagnostics: [],
  ...over,
});

const enabledLine = (out) => out.split("\n").find((l) => l.includes("enabled")) ?? "";

function cleanup(s) {
  rmSync(s.d, { recursive: true, force: true });
}

test("① 归一：两包封同 plugins 数组 → 同归一结果（等价性核心）", () => {
  const rec = REC();
  assert.deepEqual(normalizePluginList([rec]), normalizePluginList({ plugins: [rec] }));
});

test("①b 归一：对象输入透传未知顶层键；缺 plugins 数组/标量 → plugins 空而非 null", () => {
  const out = normalizePluginList({ plugins: [], diagnostics: [], thirdKey: 7 });
  assert.equal(out.thirdKey, 7); // ...raw 透传，旧代际第三键不被吞
  assert.deepEqual(normalizePluginList({ a: 1 }).plugins, []);
  assert.deepEqual(normalizePluginList("hello").plugins, []);
  assert.deepEqual(normalizePluginList(null).plugins, []);
});

test("② 裸数组包封（引擎 0.16.9 形状）→ enabled 行 ok 且渲染计数", () => {
  const s = scratch();
  try {
    const r = lzy(["status"], s, { FAKE_LIST_FILE: listFixture(s, [REC()], "bare") });
    const line = enabledLine(r.out);
    assert.ok(line.includes("✔"), `裸数组应 ok，实得：${line}`);
    assert.ok(line.includes("skills:2"));
    assert.ok(line.includes("hooks:5"));
  } finally {
    cleanup(s);
  }
});

test("③ 对象包封（引擎 0.16.5 形状）→ 同一行逐字相同（跨代等价钉）", () => {
  const s = scratch();
  try {
    const bare = lzy(["status"], s, {
      FAKE_LIST_FILE: listFixture(s, [REC()], "b1"),
    });
    const obj = lzy(["status"], s, {
      FAKE_LIST_FILE: listFixture(s, { plugins: [REC()], diagnostics: [] }, "o1"),
    });
    assert.equal(enabledLine(bare.out), enabledLine(obj.out));
  } finally {
    cleanup(s);
  }
});

test("④ 每插件 diagnostics 展平后按归属命中并渲染", () => {
  const s = scratch();
  try {
    const d = { severity: "warn", code: "C1", message: "per-plugin diag" };
    const r = lzy(["status"], s, {
      FAKE_LIST_FILE: listFixture(s, [REC({ diagnostics: [d] })], "pdiag"),
    });
    assert.ok(r.out.includes("per-plugin diag"), r.out);
    assert.ok(r.out.includes("C1"));
  } finally {
    cleanup(s);
  }
});

test("⑤ 顶层 diagnostics（旧形状）仍渲染", () => {
  const s = scratch();
  try {
    const d = { severity: "warn", code: "C2", message: "top-level diag", plugin: ID };
    const r = lzy(["status"], s, {
      FAKE_LIST_FILE: listFixture(s, { plugins: [REC()], diagnostics: [d] }, "tdiag"),
    });
    assert.ok(r.out.includes("top-level diag"), r.out);
  } finally {
    cleanup(s);
  }
});

test("⑥ 同一诊断同时在顶层与插件内 → 只渲染一次（去重钉）", () => {
  const s = scratch();
  try {
    const d = { severity: "warn", code: "C3", message: "dup diag", plugin: ID };
    const r = lzy(["status"], s, {
      FAKE_LIST_FILE: listFixture(s, { plugins: [REC({ diagnostics: [d] })], diagnostics: [d] }, "dup"),
    });
    const hits = r.out.split("dup diag").length - 1;
    assert.equal(hits, 1, `应恰渲染一次，实得 ${hits} 次：${r.out}`);
  } finally {
    cleanup(s);
  }
});

test("⑦ 非对象 diagnostics 元素被丢弃且不炸（字符展表回归钉）", () => {
  const s = scratch();
  try {
    const r = lzy(["status"], s, {
      FAKE_LIST_FILE: listFixture(s, [REC({ diagnostics: ["oops", 42, null] })], "junk"),
    });
    const line = enabledLine(r.out);
    assert.ok(line.includes("✔"), `不应因垃圾诊断炸掉 enabled 行：${line}`);
    assert.ok(!/undefined|\[object/.test(r.out), r.out);
    assert.deepEqual(normalizePluginList([{ id: "x", diagnostics: ["oops"] }]).diagnostics, []);
  } finally {
    cleanup(s);
  }
});

test("⑧ 标量 JSON → enabled 仍 fail（fail-loud 不降级钉）", () => {
  const s = scratch();
  try {
    const r = lzy(["status"], s, { FAKE_LIST_FILE: listFixture(s, '"hello"', "scalar") });
    const line = enabledLine(r.out);
    assert.ok(line.includes("✖"), `标量输入应落 fail（非 warn），实得：${line}`);
  } finally {
    cleanup(s);
  }
});

test("⑨ --version 面：假引擎版本串被解析并透出", () => {
  const s = scratch();
  try {
    const r = lzy(["doctor"], s, { FAKE_VERSION: "9.9.9" });
    assert.ok(r.out.includes("9.9.9"), r.out.slice(0, 400));
  } finally {
    cleanup(s);
  }
});

test("⑩ plugins enable 面：退出 0→ok；非零→ok:false 带 stderr 摘录", () => {
  const s = scratch();
  try {
    const engOk = createEngineCli(s.engine);
    assert.equal(engOk.enable("x").ok, true, JSON.stringify(engOk.enable("x")));
    const prev = process.env.FAKE_ENABLE_EXIT;
    process.env.FAKE_ENABLE_EXIT = "3";
    const r = createEngineCli(s.engine).enable("x");
    if (prev === undefined) delete process.env.FAKE_ENABLE_EXIT;
    else process.env.FAKE_ENABLE_EXIT = prev;
    assert.equal(r.ok, false);
    assert.match(r.error, /plugins enable/);
  } finally {
    cleanup(s);
  }
});

test("⑪ plugins uninstall 面：退出 0→ok；非零→ok:false", () => {
  const s = scratch();
  try {
    assert.equal(createEngineCli(s.engine).uninstall("x").ok, true);
    const prev = process.env.FAKE_UNINSTALL_EXIT;
    process.env.FAKE_UNINSTALL_EXIT = "4";
    const r = createEngineCli(s.engine).uninstall("x");
    if (prev === undefined) delete process.env.FAKE_UNINSTALL_EXIT;
    else process.env.FAKE_UNINSTALL_EXIT = prev;
    assert.equal(r.ok, false);
    assert.match(r.error, /plugins uninstall/);
  } finally {
    cleanup(s);
  }
});

test("⑫ headless --json 摘要：对象接受、数组拒绝（既有防御不得放宽）", async () => {
  const s = scratch();
  try {
    process.env.FAKE_HEADLESS_OUT = JSON.stringify({ response: "hi", sessionId: "s1" });
    const ok = await spawnHeadless({
      prompt: "p",
      mode: "yolo",
      enginePath: s.engine,
      timeoutMs: 30_000,
      home: HOME,
    });
    assert.equal(ok.ok, true, JSON.stringify(ok).slice(0, 300));
    assert.equal(ok.sessionId, "s1");

    process.env.FAKE_HEADLESS_OUT = JSON.stringify([{ response: "hi" }]);
    const bad = await spawnHeadless({
      prompt: "p",
      mode: "yolo",
      enginePath: s.engine,
      timeoutMs: 30_000,
      home: HOME,
    });
    assert.equal(bad.ok, false);
    assert.match(String(bad.error), /非 JSON 对象形态/);
  } finally {
    delete process.env.FAKE_HEADLESS_OUT;
    cleanup(s);
  }
});

test("⑬ 畸形 JSON → listJson null（status 落 warn 不炸）", () => {
  const s = scratch();
  try {
    const r = lzy(["status"], s, {
      FAKE_LIST_FILE: listFixture(s, "{not json at all", "broken"),
    });
    const line = enabledLine(r.out);
    // 解析失败 → listJson null → status 落 warn（⚠）；引擎缺席才是 skip（➖，见 ⑬b）。
    assert.ok(line.includes("⚠"), `解析失败应降级为 warn 而非崩：${line}`);
    assert.ok(line.includes("启用态未知"));
    // 进程内直调须自带夹具 env（假引擎按 env 读载荷），否则读到默认 "[]"。
    process.env.FAKE_LIST_FILE = listFixture(s, "{not json at all", "broken2");
    const inProc = createEngineCli(s.engine).listJson();
    delete process.env.FAKE_LIST_FILE;
    assert.equal(inProc, null);
  } finally {
    cleanup(s);
  }
});

test("⑬b 引擎缺席 → listJson null，status enabled 行 skip 不炸", () => {
  const s = scratch();
  try {
    const r = lzy(["status"], s, { LZY_ZCODE_ENGINE: "/nonexistent-lzy-engine" });
    const line = enabledLine(r.out);
    assert.ok(line.includes("➖"), line);
  } finally {
    cleanup(s);
  }
});

test("归一器：findInstalledPlugin 契约未被改动（两包封下同判定）", () => {
  const rec = REC();
  const viaBare = normalizePluginList([rec]);
  const viaObj = normalizePluginList({ plugins: [rec], diagnostics: [] });
  assert.equal(findInstalledPlugin(viaBare, ID)?.id, ID);
  assert.equal(findInstalledPlugin(viaObj, ID)?.id, ID);
  assert.equal(findInstalledPlugin(viaBare, "other@x"), null);
});

test("收尾：模块级隔离 HOME 清理", () => {
  // 模块级 HOME 与 scratch 仓均建在 tmpdir；此处仅确认未污染仓库树。
  mkdirSync(HOME, { recursive: true });
  assert.ok(HOME.startsWith(tmpdir()));
  assert.ok(!HOME.startsWith(ROOT));
});

// ADJ-60/64（0.2.1）：enabled 行的两个新增判读面——逐钩子可运行性（引擎已在
// hookDetails[].runnable 给出，权限位类部署缺陷此前不可见）与形状漂移的独立措辞
//（「输出面不识别」不再指向修不好的 lzy install）。
test("ADJ-60：hookDetails[].runnable=false → enabled 行降为 warn 并点名钩子", () => {
  const s = scratch();
  try {
    const rec = REC({
      hookDetails: [
        { name: "Stop", runnable: true },
        { name: "UserPromptSubmit", runnable: false },
        { name: "PostToolUse", runnable: false },
      ],
    });
    const r = lzy(["status"], s, { FAKE_LIST_FILE: listFixture(s, [rec], "runnable") });
    const line = enabledLine(r.out);
    assert.ok(line.includes("⚠"), `runnable=false 应 warn：${line}`);
    assert.match(line, /2 个钩子 runnable=false/);
    assert.match(line, /UserPromptSubmit/);
    // 全 true=ok（零语义变化）
    const ok = lzy(["status"], s, {
      FAKE_LIST_FILE: listFixture(s, [REC({ hookDetails: [{ name: "Stop", runnable: true }] })], "runnable-ok"),
    });
    assert.ok(enabledLine(ok.out).includes("✔"), enabledLine(ok.out));
  } finally {
    cleanup(s);
  }
});

test("ADJ-64：形状漂移（非数组且无 plugins 数组）→ 独立措辞，不指 lzy install", () => {
  const s = scratch();
  try {
    const drift = lzy(["status"], s, { FAKE_LIST_FILE: listFixture(s, { data: { plugins: [REC()] } }, "drift") });
    const line = enabledLine(drift.out);
    assert.ok(line.includes("✖"), `fail-loud 不降级：${line}`);
    assert.match(line, /输出面不识别|形状漂移/);
    assert.doesNotMatch(line, /运行 lzy install/, "不再指向修不好的动作（ADR-0021 教训）");
    // 归一器的形状标志：两代形状真；四种漂移假（包封位移/键改名/id 列表/非对象元素）
    assert.equal(normalizePluginList([]).shapeRecognized, true);
    assert.equal(normalizePluginList({ plugins: [] }).shapeRecognized, true);
    for (const bad of [{ data: { plugins: [] } }, { plugins: { 0: {} } }, ["id"], [null]]) {
      assert.equal(normalizePluginList(bad).shapeRecognized, false, JSON.stringify(bad).slice(0, 40));
    }
    // 真「未列出」（形状认识但记录不在）仍指 lzy install
    const missing = lzy(["status"], s, { FAKE_LIST_FILE: listFixture(s, [], "missing") });
    assert.match(enabledLine(missing.out), /运行 lzy install/);
  } finally {
    cleanup(s);
  }
});

// ADJ-92（0.2.1）：--version 的载荷括注改为实测——缓存/注册表读不到时去括注（指向 doctor），
// 与 CLI 版本不同则点名差异。
test("ADJ-92：--version 括注按实测载荷版本给出（隔离 HOME 无缓存=去断言）", () => {
  const s = scratch();
  try {
    const r = lzy(["--version"], s, { FAKE_VERSION: "9.9.9" });
    assert.match(r.out, /^lzy \d+\.\d+\.\d+/);
    assert.match(r.out, /引擎 9\.9\.9/);
    assert.match(r.out, /载荷版本未实测.*payload-ver/, "读不到载荷=不做无校验断言");
  } finally {
    cleanup(s);
  }
});
