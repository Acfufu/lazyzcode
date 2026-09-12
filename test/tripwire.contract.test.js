// 空转绊线契约（ADR-0009 同批，incident-guardrails#N6）：合成 stdin 驱动真实 tripwire.js，
// 固化 TTL 连击/warned 一次/isInterrupt 豁免/多写方合并/防御性 matcher 的行为矩阵。
// 不触碰真实 $HOME 与仓库 .lazyzcode/；全部经 process.execPath 拉起。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const HOOK = join(ROOT, "plugin", "hooks", "tripwire.js");

function scratch() {
  const d = mkdtempSync(join(tmpdir(), "lzy-trip-"));
  mkdirSync(join(d, ".lazyzcode", "loop", "sessions"), { recursive: true });
  writeFileSync(
    join(d, ".lazyzcode", "loop", "goal.json"),
    JSON.stringify({ slug: "t", title: "t", status: "executing", steps: [{ id: "N1", kind: "N", status: "pending" }] }),
  );
  return d;
}

function failureInput(cwd, sessionId, tool = "mcp__codegraph__codegraph_explore", extra = {}) {
  return {
    session_id: sessionId,
    cwd,
    tool_name: tool,
    tool_input: { projectPath: "/x", query: "q" },
    error: "Tool execution timed out after 30000ms",
    error_details: { message: "Tool execution timed out after 30000ms", type: "tool_timeout" },
    is_interrupt: false,
    ...extra,
  };
}

function run(input) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(input),
    encoding: "utf8",
    timeout: 20_000,
  });
  return { code: r.status, out: (r.stdout ?? "").trim() };
}

function stateAt(dir, sid) {
  return JSON.parse(readFileSync(join(dir, ".lazyzcode", "loop", "sessions", `${sid}.json`), "utf8"));
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

test("绊线：同工具两连败告警一次（warned 置位），三败不重复告警", () => {
  const d = scratch();
  try {
    assert.equal(run(failureInput(d, "s")).out, "{}"); // 首败只计数
    const o2 = JSON.parse(run(failureInput(d, "s")).out); // 二败达阈值
    assert.match(o2.additionalContext, /连续失败 2 次/);
    assert.match(o2.additionalContext, /search_tools/); // 指路窄查询激活（pisper-absorption#N2）
    assert.match(o2.additionalContext, /activate_domain/);
    assert.match(o2.additionalContext, /lzy loop handoff/);
    assert.ok(o2.additionalContext.length <= 300);
    const st = stateAt(d, "s");
    assert.equal(st.toolFail.count, 2);
    assert.equal(st.toolFail.warned, true);
    assert.equal(run(failureInput(d, "s")).out, "{}"); // 三败：同窗不重复
    assert.equal(stateAt(d, "s").toolFail.count, 3); // 计数继续、warned 保持
    assert.equal(stateAt(d, "s").toolFail.warned, true);
  } finally {
    cleanup(d);
  }
});

test("绊线：TTL 过期重臂——11 分钟前的旧败不累计，重新两连败再告警", () => {
  const d = scratch();
  try {
    assert.equal(run(failureInput(d, "s")).out, "{}");
    // 手拨时钟：把上次失败时间拨回 11 分钟前
    const st = stateAt(d, "s");
    st.toolFail.lastAt = Date.now() - 11 * 60 * 1000;
    writeFileSync(join(d, ".lazyzcode", "loop", "sessions", "s.json"), JSON.stringify(st));
    assert.equal(run(failureInput(d, "s")).out, "{}"); // 过期归零：本次是第 1 败
    assert.equal(stateAt(d, "s").toolFail.count, 1);
    const o = JSON.parse(run(failureInput(d, "s")).out); // 第 2 败：重新达阈值
    assert.match(o.additionalContext, /连续失败 2 次/);
  } finally {
    cleanup(d);
  }
});

test("绊线：is_interrupt（用户手动取消）不计数不告警；非 MCP 工具不计数（防御 matcher 失配）", () => {
  const d = scratch();
  try {
    assert.equal(run(failureInput(d, "s", "mcp__codegraph__codegraph_explore", { is_interrupt: true })).out, "{}");
    assert.equal(run({ ...failureInput(d, "s", "Bash"), tool_name: "Bash" }).out, "{}");
    // 两条豁免路径都不写盘：状态文件根本不产生（比「字段 undefined」更严格的契约）
    const stPath = join(d, ".lazyzcode", "loop", "sessions", "s.json");
    assert.equal(existsSync(stPath), false);
  } finally {
    cleanup(d);
  }
});

test("绊线：toolFail 合并不覆盖既有会话键（continues/claimedAt 幸存，评审 N6 钉）", () => {
  const d = scratch();
  try {
    writeFileSync(
      join(d, ".lazyzcode", "loop", "sessions", "s.json"),
      JSON.stringify({ continues: 1, claimedAt: "2026-09-10T00:00:00.000Z", stallCount: 1 }),
    );
    run(failureInput(d, "s"));
    run(failureInput(d, "s"));
    const st = stateAt(d, "s");
    assert.equal(st.continues, 1);
    assert.equal(st.claimedAt, "2026-09-10T00:00:00.000Z");
    assert.equal(st.stallCount, 1);
    assert.equal(st.toolFail.count, 2);
  } finally {
    cleanup(d);
  }
});

test("绊线：换工具覆盖单槽（count 归 1 不告警，窄起步语义）", () => {
  const d = scratch();
  try {
    run(failureInput(d, "s")); // tool A 第 1 败
    const o = JSON.parse(run(failureInput(d, "s", "mcp__filesystem__read_text_file")).out);
    assert.equal(o.additionalContext, undefined); // 换工具：新槽第 1 败
    assert.equal(stateAt(d, "s").toolFail.tool, "mcp__filesystem__read_text_file");
    assert.equal(stateAt(d, "s").toolFail.count, 1);
  } finally {
    cleanup(d);
  }
});

test("绊线：无目标/非 executing 一律 {} 静默（goal 闸门对齐 comment-checker）", () => {
  const d = scratch();
  const done = scratch();
  try {
    rmSync(join(d, ".lazyzcode", "loop", "goal.json")); // 无目标
    assert.equal(run(failureInput(d, "s")).out, "{}");
    writeFileSync(
      join(done, ".lazyzcode", "loop", "goal.json"),
      JSON.stringify({ slug: "t", title: "t", status: "done", steps: [] }),
    );
    assert.equal(run(failureInput(done, "s")).out, "{}"); // done 态不再提示（R4-1 同款）
  } finally {
    cleanup(d, done);
  }
});
