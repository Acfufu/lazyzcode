// drive 完成路径契约测试（0.5.0 M1 N6/N7）：段提示词义务指引钉面（gate explain→review
// run/qualify/reuse/reassess→对照门→finish；不可满足=义务阻塞标记）、classifyCause 收束因
// 具名分类（A2 落地面：记账不裁决，只分类不改门语义）、义务阻塞段自报立即干净收束。
// HOME 隔离+引擎抑制+deps.run 假引擎（drive.contract 家法），CI 零触网。
import { test } from "node:test";
// 人权门非本文件被测面——spawn 继承此 env 保任意采纳畅通
process.env.LZY_ABLATE_HUMAN_GATE = "1";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runDrive, composeSegmentPrompt, classifyCause } from "../core/drive.js";
import { loadRuntime } from "../core/runtime.js";
import { lintHandoffSnapshot } from "../core/loop.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");
const SUPPRESS_ENGINE = "/nonexistent-lzy-suppressed-engine";
const HOME = mkdtempSync(join(tmpdir(), "lzy-driveprompt-home-"));

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

function lzy(args, cwd) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE },
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function executingRepo(prefix) {
  const d = repo(prefix);
  lzy(["loop", "register", "dp", "--title", "t"], d);
  writeFileSync(join(d, "p.md"), "- [N1] x\n");
  const plan = lzy(["loop", "plan", "p.md"], d);
  if (plan.code !== 0) throw new Error(`plan 失败：${plan.out}`);
  lzy(["loop", "start"], d);
  return d;
}

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
  run: run ?? (() => ({ exitCode: 0, stdout: JSON.stringify({ sessionId: "sess-stub" }), stderr: "" })),
  querySessionPoints: () => ({ absent: false, unpriced: [], points: 0 }),
  ...extra,
});

// ── N6：段提示词义务指引 ──
test("composeSegmentPrompt：finish 步带义务满足路径（gate explain 读数→评审/复用/复判指路→不可满足=义务阻塞标记）", () => {
  const prompt = composeSegmentPrompt("/x/y/repo", "cli/lzy.js");
  assert.match(prompt, /gate explain/, "先读义务面");
  assert.match(prompt, /review run/, "评审义务满足指路");
  assert.match(prompt, /qualify\/reuse/, "复用腿指路");
  assert.match(prompt, /policy reassess/, "义务复判指路");
  assert.match(prompt, /attest comparator/, "收尾对照门仍在");
  assert.match(prompt, /loop finish/, "finish 收官仍在");
  assert.match(prompt, /\[drive\] 义务阻塞：/, "不可满足=诚实停止标记行（drive 具名收束的输入）");
  assert.match(prompt, /不伪造回执、不绕门/, "降阶满足边界（A2 三禁语义的提示词面）");
  assert.match(prompt, /绝不注册新目标/, "既有红线保持");
});

// ── N7：classifyCause 具名分类 ──
test("classifyCause：既有收束因全集逐类映射（枚举字面量先例，读面按因分类）", () => {
  assert.equal(classifyCause("done"), "done");
  assert.equal(classifyCause("义务阻塞（review.general-correctness）"), "obligation-blocked");
  assert.equal(classifyCause("预算尽（墙钟预算超顶）"), "budget-exhausted");
  assert.equal(classifyCause("积分预算尽（本任务逐段计量 400 ≥ 积分硬顶 400）"), "budget-exhausted");
  assert.equal(classifyCause("墙钟预算尽"), "budget-exhausted");
  assert.equal(classifyCause("无推进（stuck，连续 2 段零推进）"), "no-progress");
  assert.equal(classifyCause("段数尽（8 段）"), "segments-exhausted");
  assert.equal(classifyCause("段间门拒（x）"), "gate");
  assert.equal(classifyCause("段间内部错误（h3r-hit 消费）：y"), "gate");
  assert.equal(classifyCause("目标已非本 drive 的 executing 目标（slug/状态换代：a/done）"), "handover");
  assert.equal(classifyCause("工具调用被拒（PreToolUse 高危命令）：命中 z"), "tool-denied");
  assert.equal(classifyCause("merge-conflict"), "merge-conflict");
  assert.equal(classifyCause("段失败（exit=1）"), "segment-failed");
  assert.equal(classifyCause("内部错误：循环无显式收束因退出"), "other");
  assert.equal(classifyCause(null), "other");
});

// ── N7：义务阻塞段自报 → 立即干净收束（绝不写 done）──
test("义务阻塞：段响应带 [drive] 义务阻塞 标记 → EXIT=0 干净收束+快照过 lint+快照带具名类", async () => {
  const d = executingRepo("lzy-driveprompt-ob-");
  const run = () => ({
    exitCode: 0,
    // 引擎 --json 面：响应文本在 summary.response 字段（headless.js 解析契约）
    stdout: JSON.stringify({
      sessionId: "sess-ob",
      response: "段内已尽力：评审 runner 不可用，义务无法在本段满足。\n[drive] 义务阻塞：review.general-correctness",
    }),
    stderr: "",
  });
  try {
    const { result, lines } = await captureStdout(() => runDrive(d, { maxSegments: 4 }, passDeps(run)));
    assert.equal(result.ok, true, lines);
    assert.match(lines, /义务阻塞（review\.general-correctness）/, "收束因具名（段自报义务 id 透传）");
    assert.doesNotMatch(lines, /✔ goal done/, "义务阻塞绝不写 done");
    assert.match(lines, /handoff 快照：.+（复归：zw 继续）/, "干净收束带快照");
    const marker = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "handoff.json"), "utf8"));
    assert.ok(existsSync(marker.snapshot), "handoff 标记在场");
    const snap = readFileSync(marker.snapshot, "utf8");
    assert.deepEqual(lintHandoffSnapshot(snap), [], "快照过 7 字段 lint");
    assert.match(snap, /obligation-blocked/, "快照携带具名收束类（classifyCause）");
    assert.match(snap, /义务阻塞/, "收束因原文在场");
    assert.equal(loadRuntime(d).activeLease, null, "lease 已释放");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
