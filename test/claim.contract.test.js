// 认领制契约测试（ADR-0004）：UPS 触发词认领 / Stop 认领闸门 / 进度振数 / 兼容与卫生。
// fixture 模式与 hooks.contract.test.js 一致：合成 stdin 驱动真实钩子脚本，
// 全部经 process.execPath 拉起，不触碰真实 $HOME 与仓库 .lazyzcode/。
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
  return mkdtempSync(join(tmpdir(), "lzy-claim-"));
}

function goalAt(dir, status = "executing", steps = [{ id: "N1", kind: "N", status: "pending" }]) {
  mkdirSync(join(dir, ".lazyzcode", "loop"), { recursive: true });
  writeFileSync(
    join(dir, ".lazyzcode", "loop", "goal.json"),
    JSON.stringify({ version: 1, slug: "t", title: "t", status, steps }),
  );
}

function sessFile(dir, sid) {
  return join(dir, ".lazyzcode", "loop", "sessions", `${sid}.json`);
}

function claimAt(dir, sid, extra = {}) {
  mkdirSync(join(dir, ".lazyzcode", "loop", "sessions"), { recursive: true });
  writeFileSync(
    sessFile(dir, sid),
    JSON.stringify({ continues: 0, claimedAt: "2026-09-08T00:00:00Z", ...extra }),
  );
}

function hook(name, input, cwd) {
  const r = spawnSync(process.execPath, [join(HOOKS, name)], {
    input: JSON.stringify(input),
    encoding: "utf8",
    timeout: 20_000,
    ...(cwd ? { cwd } : {}),
  });
  return { code: r.status, out: (r.stdout ?? "").trim() };
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

// ── 认领写入（trigger.js） ─────────────────────────────────────────────────

test("trigger：三触发形态命中且 executing → 写 claimedAt 且注入不受损", () => {
  for (const prompt of ["zw 继续", "用 lazyzcode:zw 跑", "ulw push on"]) {
    const d = scratch();
    try {
      goalAt(d);
      const o = JSON.parse(hook("trigger.js", { prompt, cwd: d, session_id: `s-${prompt.length}` }).out);
      assert.match(o.additionalContext, /Trigger word detected/);
      const st = JSON.parse(readFileSync(sessFile(d, `s-${prompt.length}`), "utf8"));
      assert.equal(typeof st.claimedAt === "string" && st.claimedAt.length > 0, true);
    } finally {
      cleanup(d);
    }
  }
});

test("trigger：无 goal / planning 态 / 缺 sessionId → 注入照常、零认领残留", () => {
  const withGoal = scratch();
  const empty = scratch();
  try {
    goalAt(withGoal, "planning");
    for (const [dir, sid] of [
      [empty, "sE"],
      [withGoal, "sP"],
      [withGoal, undefined],
    ]) {
      const o = JSON.parse(hook("trigger.js", { prompt: "zw fix", cwd: dir, session_id: sid }).out);
      assert.match(o.additionalContext, /Trigger word detected/); // 注入无条件执行
    }
    let leftovers = 0;
    try {
      leftovers = readFileSync(sessFile(empty, "sE"), "utf8").length + readFileSync(sessFile(withGoal, "sP"), "utf8").length;
    } catch {
      leftovers = 0; // 文件不存在 = 预期
    }
    assert.equal(leftovers, 0);
  } finally {
    cleanup(withGoal, empty);
  }
});

test("trigger：非触发词（句中 zw）→ {} 静默且不写认领", () => {
  const d = scratch();
  try {
    goalAt(d);
    assert.equal(hook("trigger.js", { prompt: "what is zw anyway", cwd: d, session_id: "sM" }).out, "{}");
    assert.throws(() => readFileSync(sessFile(d, "sM"), "utf8"), { code: "ENOENT" });
  } finally {
    cleanup(d);
  }
});

test("trigger 分级（ADR-0004 修正案）：句中别名只注入不认领，句首 ultrawork 照写认领", () => {
  const d = scratch();
  try {
    goalAt(d);
    // specimen：正文「对比 /ulw 的写法」曾被全谱匹配误认领、Stop 拉回致盲真主会话——
    // 修正后注入照常（通知全谱不变），claimedAt 不写。
    const o = JSON.parse(hook("trigger.js", { prompt: "对比 /ulw 的写法", cwd: d, session_id: "sMid" }).out);
    assert.match(o.additionalContext, /Trigger word detected/);
    assert.throws(() => readFileSync(sessFile(d, "sMid"), "utf8"), { code: "ENOENT" });
    const o2 = JSON.parse(hook("trigger.js", { prompt: "ultrawork fix the bug", cwd: d, session_id: "sInit" }).out);
    assert.match(o2.additionalContext, /Trigger word detected/);
    const st = JSON.parse(readFileSync(sessFile(d, "sInit"), "utf8"));
    assert.equal(typeof st.claimedAt === "string" && st.claimedAt.length > 0, true);
  } finally {
    cleanup(d);
  }
});

// ── 认领闸门（stop.js） ────────────────────────────────────────────────────

test("stop：空集=现状（无 sessions 目录仍拉回）", () => {
  const d = scratch();
  try {
    goalAt(d);
    const o = JSON.parse(hook("stop.js", { sessionId: "sX", cwd: d }).out);
    assert.equal(o.continue, true);
  } finally {
    cleanup(d);
  }
});

test("stop：认领集非空——旁路会话放手、认领会话被拉、多认领并存皆可拉", () => {
  const d = scratch();
  try {
    goalAt(d);
    claimAt(d, "sA");
    claimAt(d, "sC");
    assert.equal(hook("stop.js", { sessionId: "sB", cwd: d }).out, "{}"); // 旁路静默
    assert.equal(JSON.parse(hook("stop.js", { sessionId: "sA", cwd: d }).out).continue, true);
    assert.equal(JSON.parse(hook("stop.js", { sessionId: "sC", cwd: d }).out).continue, true);
  } finally {
    cleanup(d);
  }
});

test("stop：仅振数文件（无 claimedAt）不算认领 → 仍算空集=现状", () => {
  const d = scratch();
  try {
    goalAt(d);
    mkdirSync(join(d, ".lazyzcode", "loop", "sessions"), { recursive: true });
    writeFileSync(sessFile(d, "sM"), JSON.stringify({ continues: 1, stallCount: 1, lastDoneCount: 0 }));
    const o = JSON.parse(hook("stop.js", { sessionId: "sOther", cwd: d }).out);
    assert.equal(o.continue, true); // 现状口径：任何会话仍可被拉
  } finally {
    cleanup(d);
  }
});

// ── 进度振数（stop.js） ────────────────────────────────────────────────────

test("stop：首拉只记快照不计振；有推进 stall/stuck 自愈", () => {
  const d = scratch();
  try {
    goalAt(d, "executing", [
      { id: "N1", kind: "N", status: "pending" },
      { id: "N2", kind: "N", status: "pending" },
    ]);
    const inp = { sessionId: "s", cwd: d };
    JSON.parse(hook("stop.js", inp).out); // 首拉
    let st = JSON.parse(readFileSync(sessFile(d, "s"), "utf8"));
    assert.equal(st.lastDoneCount, 0);
    assert.equal(st.stallCount, 0);
    claimAt(d, "s"); // 模拟既有认领 + stuck 残留
    writeFileSync(sessFile(d, "s"), JSON.stringify({ continues: 1, claimedAt: "x", stallCount: 2, stuck: true, lastDoneCount: 0 }));
    goalAt(d, "executing", [
      { id: "N1", kind: "N", status: "done" },
      { id: "N2", kind: "N", status: "pending" },
    ]); // 推进：doneCount 0→1（仍留 pending 步骤，保持拉回主路径）
    JSON.parse(hook("stop.js", inp).out);
    st = JSON.parse(readFileSync(sessFile(d, "s"), "utf8"));
    assert.equal(st.stallCount, 0);
    assert.equal(st.stuck, false);
    assert.equal(st.lastDoneCount, 1);
    assert.equal(st.claimedAt, "x"); // 合并写不丢认领
  } finally {
    cleanup(d);
  }
});

// ── 兼容与卫生（hook-lib 直测 + 钩子串联） ─────────────────────────────────

test("hook-lib：损坏 JSON 计 0、listClaims 排除 .lock/.tmp 且目录缺失→空集", async () => {
  const lib = await import(join(HOOKS, "hook-lib.js"));
  const d = scratch();
  try {
    assert.deepEqual(lib.listClaims(d), []); // 目录不存在
    mkdirSync(join(d, ".lazyzcode", "loop", "sessions"), { recursive: true });
    writeFileSync(join(d, ".lazyzcode", "loop", "sessions", "broken.json"), "{oops");
    writeFileSync(join(d, ".lazyzcode", "loop", "sessions", "x.123.tmp"), "{}");
    mkdirSync(join(d, ".lazyzcode", "loop", "sessions", ".lock-x"));
    writeFileSync(sessFile(d, "ok"), JSON.stringify({ continues: -7, claimedAt: "z" }));
    assert.deepEqual(lib.listClaims(d), ["ok"]); // 损坏/非 .json 一律排除
    assert.equal(lib.readSessionCounter(d, "broken-x"), 0); // 损坏 → 0
    const st = lib.readSessionState(d, "broken-x");
    assert.equal(st.continues, 0);
    assert.equal(st.claimedAt, null);
    assert.equal(st.stuck, false);
  } finally {
    cleanup(d);
  }
});

test("兼容：旧格式 {continues} 文件经认领与预算写后字段双向保留", () => {
  const d = scratch();
  try {
    goalAt(d);
    mkdirSync(join(d, ".lazyzcode", "loop", "sessions"), { recursive: true });
    writeFileSync(sessFile(d, "s"), JSON.stringify({ continues: 1 })); // 认领制之前的旧文件
    hook("trigger.js", { prompt: "zw 继续", cwd: d, session_id: "s" });
    let st = JSON.parse(readFileSync(sessFile(d, "s"), "utf8"));
    assert.equal(typeof st.claimedAt === "string", true); // 认领写入
    assert.equal(st.continues, 1); // 旧计数不丢
    const o = JSON.parse(hook("stop.js", { sessionId: "s", cwd: d }).out);
    assert.equal(o.continue, true);
    assert.match(o.additionalContext, /2\/2/); // 旧计数被接续（1→2），非从 0 重来
    st = JSON.parse(readFileSync(sessFile(d, "s"), "utf8"));
    assert.equal(typeof st.claimedAt === "string", true); // 预算写后认领仍在
  } finally {
    cleanup(d);
  }
});
