// 异议文书哈希绑定契约（0.5.0 M0，goal v050-m0-instrument · plan-v050 §4 P1 收口）：
// runReview 复判路径（contestedOf）打包前核对异议书字节与登记 groundsSha256——
// 缺席/漂移/超长三类 ReviewPreflightError 前置拒（报文带重新提交指路，不落档不 spawn）；
// 原文一致照常成包（全文随 facts 下传，截断仅影响注入展示）。全替身面（stub 引擎）。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { runReview, BASELINE_DUTY_ID } from "../core/review.js";
import { FINDINGS_VERSION, assertFindingsShape, findingFingerprint, contestFinding } from "../core/findings.js";
import { saveFamilyFile } from "../core/queue.js";

// 沙盒 provider 前置固定为 BUILTIN-only 形态（2026-10-08 显式允许表案）：本文件测 gate/运行时
// 语义，不测 provider 白名单——机器 env 在场会让「允许表为空」前置拒生效，测试须自洽。
delete process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE;


const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const CONTRACT = "task: t\nendpoint: A\nscope: .\nrecipe: none\nbudget-ref: none\n\n- [A1] x\n";
const FENCE = (obj) => "```json\n" + JSON.stringify(obj) + "\n```";
const PASS = { duty: BASELINE_DUTY_ID, verdict: "pass", findings: [], summary: "clean" };

function fixture(groundsBytes) {
  const d = mkdtempSync(join(tmpdir(), "lzy-gbind-"));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@t"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "hello\n");
  writeFileSync(join(d, "contract.md"), CONTRACT);
  const grounds = join(d, "grounds.md");
  writeFileSync(grounds, groundsBytes); // grounds 入初始提交：篡改形态=连篡改一起提交（树净、字节≠登记哈希）
  mkdirSync(join(d, ".lazyzcode", "loop"), { recursive: true });
  mkdirSync(join(d, ".lazyzcode", "findings"), { recursive: true });
  writeFileSync(
    join(d, ".lazyzcode", "loop", "goal.json"),
    JSON.stringify({
      version: 2, slug: "fx", title: "fixture", status: "executing", attempt: 1, tier: "light", risk: "low",
      policy: { schemaVersion: 1 },
      contract: { path: "contract.md", contractHash: "c".repeat(64) }, subjects: [],
      steps: [{ id: "N1", kind: "N", title: "do", status: "done", note: "did", acceptsRefs: [] }],
    }),
  );
  g(["add", "-A"]);
  g(["commit", "-qm", "init"]);
  const fp = findingFingerprint({ severity: "P1", title: "评审员发现的问题", location: "src/a.js:1" });
  saveFamilyFile(
    join(d, ".lazyzcode", "findings", "fx.json"),
    {
      slug: "fx",
      aliases: [],
      findings: {
        [fp]: {
          severity: "P1", title: "评审员发现的问题", location: "src/a.js:1",
          duty: BASELINE_DUTY_ID, status: "open",
          firstSeen: { runId: "fx.a1.r1", attempt: 1, at: "2026-09-28T00:00:00.000Z" },
          lastSeen: { runId: "fx.a1.r1", attempt: 1, at: "2026-09-28T00:00:00.000Z" },
          occurrences: 1, invalidFixCount: 0, resolveRequest: null, closure: null, diagnosis: null,
          history: [{ at: "2026-09-28T00:00:00.000Z", kind: "seen", runId: "fx.a1.r1", attempt: 1 }],
        },
      },
    },
    { versionKey: "schemaVersion", version: FINDINGS_VERSION, label: "发现账本", shapeFn: assertFindingsShape },
  );
  contestFinding(d, "fx", fp, { groundsPath: grounds, note: "fixture" });
  return { d, fp, grounds };
}

const deps = {
  preflight: async () => ({ budget: null }),
  spawnHeadless: async ({ cwd, home }) => {
    mkdirSync(join(home, ".zcode", "cli", "rollout"), { recursive: true });
    writeFileSync(join(home, ".zcode", "cli", "rollout", "model-io-sess_gb.jsonl"), JSON.stringify({ tool: { file_path: join(cwd, "a.txt") } }) + "\n");
    return {
      ok: true, exitCode: 0, signal: null, timedOut: false, durationMs: 5,
      stdout: `${FENCE(PASS)}\n${JSON.stringify({ sessionId: "sess_gb", response: FENCE(PASS) })}\n`,
      stderr: "", response: FENCE(PASS), sessionId: "sess_gb",
    };
  },
  querySessionPoints: async () => ({ absent: false, unpriced: [], points: 42 }),
  detectAuth: () => ({ ok: true, envAuth: true }),
  sqliteProbe: () => ({ ok: true }),
};

const GROUNDS = "该发现不成立：位置行是测试夹具非业务代码。\n";

describe("异议文书哈希绑定复判输入（0.5.0 M0）", () => {
  test("对照：原文一致→复判运行 valid 成包", async () => {
    const { d, fp } = fixture(GROUNDS);
    try {
      const res = await runReview(d, { contestedOf: fp, deps });
      assert.equal(res.exitHint, 0);
      assert.equal(res.record.validity.status, "valid");
      assert.equal(res.record.result.verdict, "pass");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("修改→异议书漂移前置拒，报文带重新提交指路", async () => {
    const { d, fp, grounds } = fixture(GROUNDS);
    try {
      writeFileSync(grounds, "被修改过的理由文本，与登记字节不同。\n");
      spawnSync("git", ["add", "-A"], { cwd: d });
      spawnSync("git", ["commit", "-qm", "tamper"], { cwd: d });
      await assert.rejects(
        () => runReview(d, { contestedOf: fp, deps }),
        (err) => /异议书漂移/.test(String(err?.message)) && /lzy finding contest/.test(String(err?.message)),
      );
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("删除→异议书缺席前置拒", async () => {
    const { d, fp, grounds } = fixture(GROUNDS);
    try {
      rmSync(grounds);
      spawnSync("git", ["add", "-A"], { cwd: d });
      spawnSync("git", ["commit", "-qm", "drop"], { cwd: d });
      await assert.rejects(() => runReview(d, { contestedOf: fp, deps }), /异议书缺席/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("改名失效→异议书缺席前置拒", async () => {
    const { d, fp, grounds } = fixture(GROUNDS);
    try {
      rmSync(grounds);
      writeFileSync(join(d, "grounds-moved.md"), GROUNDS);
      spawnSync("git", ["add", "-A"], { cwd: d });
      spawnSync("git", ["commit", "-qm", "move"], { cwd: d });
      await assert.rejects(() => runReview(d, { contestedOf: fp, deps }), /异议书缺席/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("超长→异议书超长前置拒（复判须全文可判；身份仍绑完整原文）", async () => {
    const oversized = ("超长异议书。").repeat(12000) + "\n"; // > AGENTS_CAP(100×1024)
    const { d, fp } = fixture(oversized);
    try {
      await assert.rejects(() => runReview(d, { contestedOf: fp, deps }), /异议书超长/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("恢复通道端到端：漂移前置拒后重新提交异议→复判 valid（0.5.0 M0 评审 F-1：指路必须可执行）", async () => {
    const { d, fp, grounds } = fixture(GROUNDS);
    try {
      writeFileSync(grounds, "被修改过的理由文本。\n");
      spawnSync("git", ["add", "-A"], { cwd: d });
      spawnSync("git", ["commit", "-qm", "tamper"], { cwd: d });
      await assert.rejects(() => runReview(d, { contestedOf: fp, deps }), /异议书漂移.*重新提交/s);
      // 报文指路的动作照做：重新提交（contested 态受理）→ 复判通道打通。
      const fixed = join(d, "grounds-v2.md");
      writeFileSync(fixed, "重新提交的异议书：补充了行号证据，与被驳原文不同。\n");
      spawnSync("git", ["add", "-A"], { cwd: d });
      spawnSync("git", ["commit", "-qm", "recontest"], { cwd: d });
      const { contestFinding: recontest } = await import("../core/findings.js");
      recontest(d, "fx", fp, { groundsPath: fixed, note: "重新提交" });
      const res = await runReview(d, { contestedOf: fp, deps });
      assert.equal(res.exitHint, 0);
      assert.equal(res.record.validity.status, "valid");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
