// 交付授权门契约测试（0.3.0 M4，拍板 2/3/9）：无授权拒且零外部调用；仅 B 缺 C 拒（合并
// 前置=双授权）；recordAuthorization（测试写者，contract.js:204 家法）批准后全链放行至
// done；done 恒拒再执行；撤回后拒；LZY_ABLATE_HUMAN_GATE 消融缝 stamped；request 绑定
// 落 contractPending 三字段+beginAct 门过即清 pending。全 deps 注入（gh/gitPush 假件）——
// win32 安全；批准/撤回的真实用户消息面由 delivery-hook.contract.test.js spawn 真钩子钉。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAuthorizations, recordAuthorization } from "../core/contract.js";
import { bindDeliveryContract } from "../core/loop.js";
import { actDeliveryB, deliveryStatus, loadIntents, validateDeliveryContract } from "../core/delivery.js";

const HOME = mkdtempSync(join(tmpdir(), "lzy-dgate-home-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");

const HEAD = "a".repeat(40);
const MERGE = "b".repeat(40);
const REPO = "Acfufu/lazyzcode";

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
  const r1 = lzyIn(d, ["loop", "register", "dgate", "--title", "t"]);
  if (r1.status !== 0) throw new Error(`register 失败：${r1.out}`);
  writeFileSync(join(d, "p.md"), "- [N1] x\n");
  const r2 = lzyIn(d, ["loop", "plan", "p.md"]);
  if (r2.status !== 0) throw new Error(`plan 失败：${r2.out}`);
  const r3 = lzyIn(d, ["loop", "start"]);
  if (r3.status !== 0) throw new Error(`start 失败：${r3.out}`);
  return d;
}

function bindBoth(d, { withC = true } = {}) {
  writeFileSync(join(d, "cb.md"), "task: 交付B\nendpoint: B\nscope: .\nrecipe: none\n\n- [A1] x\n");
  const b = validateDeliveryContract(d, "B", join(d, "cb.md"));
  bindDeliveryContract(d, "B", join(d, "cb.md"), b.hash);
  let c = null;
  if (withC) {
    writeFileSync(join(d, "cc.md"), "task: 交付C\nendpoint: C\nscope: .\nrecipe: none\n\n- [A1] x\n");
    c = validateDeliveryContract(d, "C", join(d, "cc.md"));
    bindDeliveryContract(d, "C", join(d, "cc.md"), c.hash);
  }
  return { b, c };
}

// 有状态假 gh：pr view 在 merge 调用前 OPEN/后 MERGED；check-runs 恒绿；调用枚举入 _calls。
function fakeDeps({ prState = "OPEN", headSha = HEAD, base = "main", mergeTimeout = false, mergeRejects = false } = {}) {
  const calls = [];
  let merged = false;
  const deps = {
    sleep: () => {},
    gitPush: () => {
      calls.push("git-push");
      return { code: 0, stdout: "", stderr: "" };
    },
    ghApi: (args) => {
      calls.push(args.join(" "));
      if (args[0] === "pr" && args[1] === "view") {
        const state = merged ? "MERGED" : prState;
        return { code: 0, stdout: JSON.stringify({ state, headRefOid: headSha, baseRefName: base, number: 7, url: `https://github.com/${REPO}/pull/7`, mergeCommit: merged ? { oid: MERGE } : null }), stderr: "" };
      }
      if (args[0] === "pr" && args[1] === "merge") {
        if (mergeTimeout) return { code: null, signal: "SIGTERM", stdout: "", stderr: "" };
        if (mergeRejects) return { code: 1, signal: null, stdout: "", stderr: "Pull request is not mergeable" };
        merged = true;
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

const opts = { repo: REPO, branch: "v030-m4-delivery", base: "main", head: HEAD, prTitle: "t", prBodyFile: "body.md" };
const goalJson = (d) => JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8"));

test("①无授权 act B 拒且零外部调用（零 gh/零 push——授权门在任何外部动作之前）", () => {
  const d = goalRepo("lzy-dgate-1-");
  try {
    bindBoth(d);
    const deps = fakeDeps();
    assert.throws(() => actDeliveryB(d, opts, deps), /交付授权门拒绝.*缺 B/);
    assert.equal(deps._calls.length, 0, `应零调用，实得：${deps._calls.join("|")}`);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("②仅 B 授权（C 未绑定）拒合并——自动发布链前置（V09）", () => {
  const d = goalRepo("lzy-dgate-2-");
  try {
    const { b } = bindBoth(d, { withC: false });
    recordAuthorization(d, { kind: "approval", slug: "dgate", contractHash: b.hash, sessionId: "t", at: new Date().toISOString() });
    const deps = fakeDeps();
    assert.throws(() => actDeliveryB(d, opts, deps), /缺 C（未绑定 delivery 契约）/);
    assert.equal(deps._calls.length, 0);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("③C 绑定但未批准同拒；B∧C 双批准后全链 done（mergeSha=读回权威+CI 绿+attempts 枚举）", () => {
  const d = goalRepo("lzy-dgate-3-");
  try {
    const { b, c } = bindBoth(d);
    recordAuthorization(d, { kind: "approval", slug: "dgate", contractHash: b.hash, sessionId: "t", at: new Date().toISOString() });
    const deps = fakeDeps();
    assert.throws(() => actDeliveryB(d, opts, deps), /缺 C（/);
    assert.equal(deps._calls.length, 0);
    recordAuthorization(d, { kind: "approval", slug: "dgate", contractHash: c.hash, sessionId: "t", at: new Date().toISOString() });
    const r = actDeliveryB(d, opts, deps);
    assert.equal(r.intent.status, "done");
    assert.equal(r.intent.observed.mergeSha, MERGE);
    assert.equal(r.intent.observed.mergeCiState, "green");
    assert.equal(r.intent.observed.closedBy, "act");
    const methods = r.intent.attempts.map((a) => a.method);
    for (const m of ["declare", "act-begin", "push", "pr-resolve", "ci-head", "merge"]) {
      assert.ok(methods.includes(m), `attempts 缺 ${m}：${methods.join(",")}`);
    }
    assert.ok(deps._calls.some((x) => x.includes("--match-head-commit")), "merge 须绑 HEAD");
    assert.equal(r.intent.ablated, undefined, "非消融路径不得打 ablated 戳");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("④done 恒拒再执行（防重复交付，V10）——零新调用", () => {
  const d = goalRepo("lzy-dgate-4-");
  try {
    const { b, c } = bindBoth(d);
    recordAuthorization(d, { kind: "approval", slug: "dgate", contractHash: b.hash, sessionId: "t", at: new Date().toISOString() });
    recordAuthorization(d, { kind: "approval", slug: "dgate", contractHash: c.hash, sessionId: "t", at: new Date().toISOString() });
    const deps = fakeDeps();
    actDeliveryB(d, opts, deps);
    const afterFirst = deps._calls.length;
    assert.throws(() => actDeliveryB(d, opts, deps), /已 done.*绝不重复执行/);
    assert.equal(deps._calls.length, afterFirst, "done 后不得有任何新外部调用");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑤撤回 B 后 act 拒（后到者赢）——撤回对下一受控动作生效（V02 交付面）", () => {
  const d = goalRepo("lzy-dgate-5-");
  try {
    const { b, c } = bindBoth(d);
    recordAuthorization(d, { kind: "approval", slug: "dgate", contractHash: b.hash, sessionId: "t", at: new Date().toISOString() });
    recordAuthorization(d, { kind: "approval", slug: "dgate", contractHash: c.hash, sessionId: "t", at: new Date().toISOString() });
    recordAuthorization(d, { kind: "withdrawal", slug: "dgate", contractHash: b.hash, sessionId: "t", at: new Date(Date.now() + 1000).toISOString() });
    const deps = fakeDeps();
    assert.throws(() => actDeliveryB(d, opts, deps), /缺 B/);
    assert.equal(deps._calls.length, 0);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑥消融缝 LZY_ABLATE_HUMAN_GATE=1：无授权放行至假链 done+ablated 戳如实记账", () => {
  const d = goalRepo("lzy-dgate-6-");
  const prev = process.env.LZY_ABLATE_HUMAN_GATE;
  process.env.LZY_ABLATE_HUMAN_GATE = "1";
  try {
    bindBoth(d);
    const deps = fakeDeps();
    const r = actDeliveryB(d, opts, deps);
    assert.equal(r.intent.status, "done");
    assert.equal(r.intent.ablated, true, "消融路径须打 ablated 戳");
    assert.ok(r.intent.attempts.some((a) => /ablated/.test(a.detail ?? "")), "attempt 须带 ablated 注记");
  } finally {
    if (prev === undefined) delete process.env.LZY_ABLATE_HUMAN_GATE;
    else process.env.LZY_ABLATE_HUMAN_GATE = prev;
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑦request 绑定面：contractPending 三字段落位+beginAct 门过即清 pending（拍板 2）", () => {
  const d = goalRepo("lzy-dgate-7-");
  const prev = process.env.LZY_ABLATE_HUMAN_GATE;
  try {
    const { b } = bindBoth(d, { withC: false });
    const goal = goalJson(d);
    assert.equal(goal.contractPending.contractHash, b.hash);
    assert.equal(goal.contractPending.contractPath, join(d, "cb.md"));
    assert.ok(goal.contractPending.requestedAt);
    assert.equal(goal.delivery.B.hash, b.hash);
    // 消融放行（绕授权门）→ 链走完 → beginAct 已清 pending
    process.env.LZY_ABLATE_HUMAN_GATE = "1";
    const r = actDeliveryB(d, opts, fakeDeps());
    assert.equal(r.intent.status, "done");
    assert.equal(goalJson(d).contractPending, null, "门过后 pending 应清");
  } finally {
    if (prev === undefined) delete process.env.LZY_ABLATE_HUMAN_GATE;
    else process.env.LZY_ABLATE_HUMAN_GATE = prev;
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑧status 读面：契约×授权×意图三面投影", () => {
  const d = goalRepo("lzy-dgate-8-");
  try {
    const { b } = bindBoth(d, { withC: false });
    const s1 = deliveryStatus(d);
    assert.equal(s1.contracts.B.bound, true);
    assert.equal(s1.contracts.B.authorized, false);
    assert.equal(s1.contracts.C.bound, false);
    recordAuthorization(d, { kind: "approval", slug: "dgate", contractHash: b.hash, sessionId: "t", at: new Date().toISOString() });
    assert.equal(deliveryStatus(d).contracts.B.authorized, true);
    assert.equal(deliveryStatus(d).intents.length, 0);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑨授权账本形状回归：approval 记录侧写（slug+hash 绑定）", () => {
  const d = goalRepo("lzy-dgate-9-");
  try {
    const { b } = bindBoth(d, { withC: false });
    recordAuthorization(d, { kind: "approval", slug: "dgate", contractHash: b.hash, sessionId: "t", at: new Date().toISOString() });
    const recs = loadAuthorizations(d).filter((r) => r.contractHash === b.hash);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].kind, "approval");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑩follow-up 合并流：head1 done 后以新 head2 act=开新意图（旧意图永存），同 head2 重 act=done 恒拒", () => {
  const d = goalRepo("lzy-dgate-10-");
  try {
    const { b, c } = bindBoth(d);
    for (const h of [b.hash, c.hash]) recordAuthorization(d, { kind: "approval", slug: "dgate", contractHash: h, sessionId: "t", at: new Date().toISOString() });
    const r1 = actDeliveryB(d, opts, fakeDeps());
    assert.equal(r1.intent.status, "done");
    assert.equal(r1.intent.observed.mergeSha, MERGE);
    const HEAD2 = "d".repeat(40);
    const r2 = actDeliveryB(d, { ...opts, head: HEAD2 }, fakeDeps({ headSha: HEAD2 }));
    assert.equal(r2.intent.id, "d2", "新身份=新意图");
    assert.equal(r2.intent.status, "done");
    const intents = loadIntents(d).intents.filter((x) => x.endpoint === "B");
    assert.equal(intents.length, 2, "两条 B 意图并存");
    assert.equal(intents[0].observed.mergeSha, MERGE, "旧意图事实不动");
    assert.throws(() => actDeliveryB(d, { ...opts, head: HEAD2 }, fakeDeps({ headSha: HEAD2 })), /已 done/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑪前链已合并+新 HEAD：read-back-authority 须核对 headRefOid==意图 HEAD，否则 create 新 PR（d5 缺陷回归钉）", () => {
  const d = goalRepo("lzy-dgate-11-");
  try {
    const { b, c } = bindBoth(d);
    for (const h of [b.hash, c.hash]) recordAuthorization(d, { kind: "approval", slug: "dgate", contractHash: h, sessionId: "t", at: new Date().toISOString() });
    const HEAD2 = "e".repeat(40);
    const MERGE2 = "f".repeat(40);
    const calls = [];
    let created = false;
    let mergedNow = false;
    const deps = {
      sleep: () => {},
      gitPush: () => { calls.push("git-push"); return { code: 0, stdout: "", stderr: "" }; },
      ghApi: (args) => {
        calls.push(args.join(" "));
        if (args[0] === "pr" && args[1] === "list") return { code: 0, stdout: "[]", stderr: "" };
        if (args[0] === "pr" && args[1] === "view") {
          if (!created) return { code: 0, stdout: JSON.stringify({ state: "MERGED", headRefOid: HEAD, baseRefName: "main", number: 2, url: "u2", mergeCommit: { oid: MERGE } }), stderr: "" };
          const st = mergedNow ? "MERGED" : "OPEN";
          return { code: 0, stdout: JSON.stringify({ state: st, headRefOid: HEAD2, baseRefName: "main", number: 3, url: "u3", mergeCommit: mergedNow ? { oid: MERGE2 } : null }), stderr: "" };
        }
        if (args[0] === "pr" && args[1] === "create") { created = true; return { code: 0, signal: null, stdout: "", stderr: "" }; }
        if (args[0] === "pr" && args[1] === "merge") { mergedNow = true; return { code: 0, signal: null, stdout: "", stderr: "" }; }
        if (args[0] === "api" && String(args[1] ?? "").includes("check-runs")) return { code: 0, stdout: JSON.stringify([{ name: "ci", status: "COMPLETED", conclusion: "SUCCESS" }]), stderr: "" };
        return { code: 1, stdout: "", stderr: "no match" };
      },
      _calls: calls,
    };
    const r = actDeliveryB(d, { ...opts, head: HEAD2 }, deps);
    assert.equal(r.intent.status, "done");
    assert.equal(r.intent.observed.mergeSha, MERGE2, "mergeSha=新 PR 的合并事实");
    assert.ok(calls.some((x) => x.startsWith("pr create")), "必须 create 新 PR 而非误判前链已合并");
    assert.equal(loadIntents(d).intents.filter((x) => x.endpoint === "B").length, 1, "同意图内完成");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
