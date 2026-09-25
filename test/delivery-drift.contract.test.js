// 交付漂移与读回契约测试（0.3.0 M4，拍板 4/5，V09/V10）：head/base 漂移拒（重建候选指路）；
// PR CLOSED 拒；merge 超时=unknown→readback 分类（merged→done 收束且 merge 调用恰一次，
// 绝不盲目重发；open→intended re-arm）；readback 幂等；push 确定性拒绝=failed/超时=unknown。
// 全 deps 注入——win32 安全。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { recordAuthorization } from "../core/contract.js";
import { bindDeliveryContract } from "../core/loop.js";
import { actDeliveryB, loadIntents, readbackDeliveryB, validateDeliveryContract } from "../core/delivery.js";

const HOME = mkdtempSync(join(tmpdir(), "lzy-ddrift-home-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.LZY_ABLATE_HUMAN_GATE = "1"; // 授权门非本文件被测面（gate 文件已钉）
const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");

const HEAD = "a".repeat(40);
const OTHER = "c".repeat(40);
const MERGE = "b".repeat(40);
const REPO = "Acfufu/lazyzcode";
const opts = { repo: REPO, branch: "v030-m4-delivery", base: "main", head: HEAD, prTitle: "t", prBodyFile: "body.md" };

function lzyIn(d, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: d, encoding: "utf8", timeout: 120_000,
    env: { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: "/nonexistent-lzy-suppressed", LZY_ABLATE_HUMAN_GATE: "1" },
  });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function goalRepo(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "a\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "init"]);
  g(["remote", "add", "origin", `https://github.com/${REPO}.git`]);
  for (const [args, what] of [[["loop", "register", "ddrift", "--title", "t"], "register"], [["loop", "plan", "p.md"], "plan"], [["loop", "start"], "start"]]) {
    if (what === "plan") writeFileSync(join(d, "p.md"), "- [N1] x\n");
    const r = lzyIn(d, args);
    if (r.status !== 0) throw new Error(`${what} 失败：${r.out}`);
  }
  return d;
}

function bindB(d) {
  writeFileSync(join(d, "cb.md"), "task: 交付B\nendpoint: B\nscope: .\nrecipe: none\n\n- [A1] x\n");
  const b = validateDeliveryContract(d, "B", join(d, "cb.md"));
  bindDeliveryContract(d, "B", join(d, "cb.md"), b.hash);
  return b;
}

// 可配置假 gh：prState 决定 view 返回；merge 可超时/拒绝；调用枚举。
function fakeDeps({ seenHead = HEAD, seenBase = "main", prState = "OPEN", mergeTimeout = false, pushCode = 0, pushTimeout = false } = {}) {
  const calls = [];
  let mergeCalledFlag = false;
  const mergeCalled = () => mergeCalledFlag;
  const deps = {
    sleep: () => {},
    gitPush: () => {
      calls.push("git-push");
      return { code: pushCode, stdout: "", stderr: pushCode === 0 ? "Everything up-to-date" : "! [rejected] non-fast-forward", timedOut: pushTimeout, signal: pushTimeout ? "SIGTERM" : null };
    },
    ghApi: (args) => {
      calls.push(args.join(" "));
      if (args[0] === "pr" && args[1] === "view") {
        const mergedNow = prState === "MERGED" || mergeCalled();
        const state = mergedNow ? "MERGED" : prState;
        return { code: 0, stdout: JSON.stringify({ state, headRefOid: seenHead, baseRefName: seenBase, number: 7, url: `https://github.com/${REPO}/pull/7`, mergeCommit: mergedNow ? { oid: MERGE } : null }), stderr: "" };
      }
      if (args[0] === "pr" && args[1] === "merge") {
        mergeCalledFlag = true;
        if (mergeTimeout) return { code: null, signal: "SIGTERM", stdout: "", stderr: "" };
        return { code: 0, signal: null, stdout: "", stderr: "" };
      }
      if (args[0] === "api" && String(args[1] ?? "").includes("check-runs")) {
        return { code: 0, stdout: JSON.stringify([{ name: "ci", status: "COMPLETED", conclusion: "SUCCESS" }]), stderr: "" };
      }
      return { code: 1, stdout: "", stderr: `fake-gh 未匹配：${args.join(" ")}` };
    },
    _calls: calls,
  };
  return deps;
}

const intentOf = (d) => loadIntents(d).intents.find((x) => x.endpoint === "B");
const mergeCalls = (deps) => deps._calls.filter((c) => c.startsWith("pr merge")).length;

test("①head 漂移拒（V09）：意图要求 HEAD，远端 headRefOid 不符→refused+重建候选指路", () => {
  const d = goalRepo("lzy-ddrift-1-");
  try {
    bindB(d);
    const deps = fakeDeps({ seenHead: OTHER });
    assert.throws(() => actDeliveryB(d, opts, deps), /漂移复核拒绝.*新授权/);
    const it = intentOf(d);
    assert.equal(it.status, "refused");
    assert.ok(it.attempts.some((a) => a.method === "drift-check" && /mismatch/.test(a.outcome)));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("②base 漂移拒与 PR CLOSED 拒", () => {
  const d1 = goalRepo("lzy-ddrift-2a-");
  try {
    bindB(d1);
    assert.throws(() => actDeliveryB(d1, opts, fakeDeps({ seenBase: "develop" })), /漂移复核拒绝/);
    assert.equal(intentOf(d1).status, "refused");
  } finally {
    rmSync(d1, { recursive: true, force: true });
  }
  const d2 = goalRepo("lzy-ddrift-2b-");
  try {
    bindB(d2);
    assert.throws(() => actDeliveryB(d2, opts, fakeDeps({ prState: "CLOSED" })), /漂移复核拒绝/);
    assert.equal(intentOf(d2).status, "refused");
  } finally {
    rmSync(d2, { recursive: true, force: true });
  }
});

test("③merge 超时=unknown→readback 见 MERGED→done(observed, closedBy=readback) 且 merge 调用恰一次（不盲目重发，V10）", () => {
  const d = goalRepo("lzy-ddrift-3-");
  try {
    bindB(d);
    const deps = fakeDeps({ mergeTimeout: true });
    assert.throws(() => actDeliveryB(d, opts, deps), /结果未定记 unknown.*绝不重发/);
    assert.equal(intentOf(d).status, "unknown");
    assert.equal(mergeCalls(deps), 1);
    // 读回：远端实际已合并（pr view 返回 MERGED）
    const rb = readbackDeliveryB(d, {}, fakeDeps({ prState: "MERGED" }));
    assert.equal(rb.intent.status, "done");
    assert.equal(rb.intent.observed.mergeSha, MERGE);
    assert.equal(rb.intent.observed.closedBy, "readback");
    assert.equal(mergeCalls(deps), 1, "readback 后 merge 调用数不得增加");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("④readback 幂等：done 后复验仍 done 且刷新 mergeCiState 注记", () => {
  const d = goalRepo("lzy-ddrift-4-");
  try {
    bindB(d);
    actDeliveryB(d, opts, fakeDeps());
    const rb1 = readbackDeliveryB(d, {}, fakeDeps({ prState: "MERGED" }));
    assert.equal(rb1.intent.status, "done");
    const attemptsAfter1 = rb1.intent.attempts.length;
    const rb2 = readbackDeliveryB(d, {}, fakeDeps({ prState: "MERGED" }));
    assert.equal(rb2.intent.status, "done");
    assert.equal(rb2.intent.observed.mergeSha, MERGE);
    assert.ok(rb2.intent.attempts.length >= attemptsAfter1, "attempt 只增不减");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑤readback open→intended re-arm（unknown 态恢复，合并未发生）", () => {
  const d = goalRepo("lzy-ddrift-5-");
  try {
    bindB(d);
    assert.throws(() => actDeliveryB(d, opts, fakeDeps({ mergeTimeout: true })), /unknown/);
    assert.equal(intentOf(d).status, "unknown");
    const rb = readbackDeliveryB(d, {}, fakeDeps({ prState: "OPEN" }));
    assert.equal(rb.intent.status, "intended");
    assert.equal(rb.rearmed, true);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑥push 确定性拒绝=failed（同身份可重试）；push 超时=unknown", () => {
  const d1 = goalRepo("lzy-ddrift-6a-");
  try {
    bindB(d1);
    const deps = fakeDeps({ pushCode: 1 });
    assert.throws(() => actDeliveryB(d1, opts, deps), /git push 失败.*failed/);
    assert.equal(intentOf(d1).status, "failed");
  } finally {
    rmSync(d1, { recursive: true, force: true });
  }
  const d2 = goalRepo("lzy-ddrift-6b-");
  try {
    bindB(d2);
    const deps = fakeDeps({ pushTimeout: true });
    assert.throws(() => actDeliveryB(d2, opts, deps), /git push 超时.*readback/);
    assert.equal(intentOf(d2).status, "unknown");
  } finally {
    rmSync(d2, { recursive: true, force: true });
  }
});
