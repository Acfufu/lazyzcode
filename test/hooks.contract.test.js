// 钩子契约测试：合成 stdin 驱动真实钩子脚本，固化评审轮实证过的行为矩阵。
// 全部经 process.execPath 拉起（不依赖 PATH 上的 node）；不触碰真实 $HOME 与仓库 .lazyzcode/。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const HOOKS = join(ROOT, "plugin", "hooks");

function scratch() {
  return mkdtempSync(join(tmpdir(), "lzy-hooks-"));
}

function goalAt(dir, status = "executing", steps = [{ id: "N1", kind: "N", status: "pending" }]) {
  mkdirSync(join(dir, ".lazyzcode", "loop"), { recursive: true });
  writeFileSync(
    join(dir, ".lazyzcode", "loop", "goal.json"),
    JSON.stringify({ slug: "t", title: "t", status, steps }),
  );
}

function counterAt(dir, sid, continues) {
  mkdirSync(join(dir, ".lazyzcode", "loop", "sessions"), { recursive: true });
  writeFileSync(
    join(dir, ".lazyzcode", "loop", "sessions", `${sid}.json`),
    JSON.stringify({ continues }),
  );
}

function hook(name, input) {
  const r = spawnSync(process.execPath, [join(HOOKS, name)], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    timeout: 20_000,
  });
  return { code: r.status, out: (r.stdout ?? "").trim() };
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

test("stop：预算 0/1 次续跑并计数，第 3 次请求 continue:false（≤2 预留 1）", () => {
  const d = scratch();
  try {
    goalAt(d);
    counterAt(d, "s", 0);
    const inp = { sessionId: "s", cwd: d };
    const o1 = JSON.parse(hook("stop.js", inp).out);
    assert.equal(o1.continue, true);
    assert.match(o1.additionalContext, /1\/2/);
    const o2 = JSON.parse(hook("stop.js", inp).out);
    assert.equal(o2.continue, true);
    assert.match(o2.additionalContext, /2\/2/);
    const o3 = JSON.parse(hook("stop.js", inp).out);
    assert.equal(o3.continue, false); // 评审 R1-1：显式 false，不得省略键
    assert.match(o3.additionalContext, /已用尽/);
    const counter = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "sessions", "s.json"), "utf8"));
    assert.equal(counter.continues, 2);
  } finally {
    cleanup(d);
  }
});

test("stop：空/坏 stdin、缺 sessionId、无目标目录一律 {} 放手（fail-open）", () => {
  const d = scratch();
  const empty = scratch();
  try {
    goalAt(d); // 有在跑目标：坏输入也不得借道续跑（评审 R1-2 反例回归）
    assert.equal(hook("stop.js", "").out, "{}");
    assert.equal(hook("stop.js", "not json").out, "{}");
    assert.equal(hook("stop.js", { cwd: d }).out, "{}"); // 缺 sessionId=没有账本
    assert.equal(hook("stop.js", { sessionId: "x", cwd: empty }).out, "{}"); // 无目标不劫持
  } finally {
    cleanup(d, empty);
  }
});

test("session-start：在跑目标注入下一步，坏 stdin 静默", () => {
  const d = scratch();
  try {
    goalAt(d);
    const ok = hook("session-start.js", { cwd: d });
    assert.equal(ok.code, 0);
    assert.match(JSON.parse(ok.out).additionalContext, /下一步 N1/);
    assert.equal(hook("session-start.js", "{{{").out, "{}");
  } finally {
    cleanup(d);
  }
});

test("trigger：词边界注入矩阵", () => {
  const inject = ["zw 帮我审查", "ulw 继续", "ultrawork now", "ZW 大写", "wz zw", "伊zw语"];
  const silent = ["帮我 pwd 一下", "azw b", "ultraworks", "a_zw b", "", "hello world", "{bad json"];
  for (const p of inject) {
    assert.match(JSON.parse(hook("trigger.js", { prompt: p }).out).additionalContext, /Trigger word/);
  }
  for (const p of silent) {
    assert.equal(hook("trigger.js", { prompt: p }).out, "{}");
  }
});

test("comment-checker：在跑目标提示、终态静默、无目标静默", () => {
  const d = scratch();
  try {
    goalAt(d, "executing", []);
    const inp = { cwd: d, tool_name: "Write", tool_input: { content: "// TODO fix" } };
    assert.match(JSON.parse(hook("comment-checker.js", inp).out).additionalContext, /标记:片段L1 TODO/);
    goalAt(d, "done", []); // 终态 goal.json 仍在盘上：不得永远提示（评审 R4-1）
    assert.equal(hook("comment-checker.js", inp).out, "{}");
    const noGoal = scratch();
    assert.equal(hook("comment-checker.js", { ...inp, cwd: noGoal }).out, "{}");
    cleanup(noGoal);
  } finally {
    cleanup(d);
  }
});

test("comment-checker：上限 5 处列出、总长 ≤300、调试残留、干净内容静默", () => {
  const d = scratch();
  try {
    goalAt(d, "executing", []);
    const ten = Array.from({ length: 10 }, (_, i) => `// line ${i} TODO`).join("\n");
    const out = JSON.parse(
      hook("comment-checker.js", { cwd: d, tool_name: "Write", tool_input: { content: ten } }).out,
    ).additionalContext;
    assert.match(out, /含 10 处/);
    assert.match(out, /及 5 处更多/);
    assert.ok(out.length <= 300);
    const dbg = JSON.parse(
      hook("comment-checker.js", {
        cwd: d,
        tool_name: "Write",
        tool_input: { content: "const v=1;\nconsole.log(v);\ndebugger;" },
      }).out,
    ).additionalContext;
    assert.match(dbg, /调试:片段L2 console\.log/);
    assert.match(dbg, /调试:片段L3 debugger/);
    const clean = hook("comment-checker.js", { cwd: d, tool_name: "Write", tool_input: { content: "const ok=1;" } });
    assert.equal(clean.out, "{}");
  } finally {
    cleanup(d);
  }
});
