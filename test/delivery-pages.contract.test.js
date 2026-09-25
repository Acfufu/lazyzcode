// 交付 Pages 面契约测试（0.3.0 M4，拍板 7，V11）：B 前置（mergeSha 缺席拒）；构建对齐轮询
// 预算（15s×≤10，sleep 注入零延迟）；errored 即拒；HTTPS 200∧expect-marker 判据（缺失/非 200
// 如实 failed 不假绿）；readback C 迟来事实收束 done/未对齐原状。全 deps 注入——win32 安全。
import { test } from "node:test";
process.env.LZY_ABLATE_HUMAN_GATE = "1"; // 授权门非本文件被测面
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bindDeliveryContract } from "../core/loop.js";
import { actDeliveryB, actDeliveryC, loadIntents, readbackDeliveryC, validateDeliveryContract } from "../core/delivery.js";

const HOME = mkdtempSync(join(tmpdir(), "lzy-dpages-home-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");

const HEAD = "a".repeat(40);
const MERGE = "b".repeat(40);
const OLD = "9".repeat(40);
const REPO = "Acfufu/lazyzcode";
const MARKER = "v030-m4-delivery-report";
const bOpts = { repo: REPO, branch: "v030-m4-delivery", base: "main", head: HEAD, prTitle: "t", prBodyFile: "body.md" };

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
  for (const [args, what] of [[["loop", "register", "dpages", "--title", "t"], "register"], [["loop", "plan", "p.md"], "plan"], [["loop", "start"], "start"]]) {
    if (what === "plan") writeFileSync(join(d, "p.md"), "- [N1] x\n");
    const r = lzyIn(d, args);
    if (r.status !== 0) throw new Error(`${what} 失败：${r.out}`);
  }
  writeFileSync(join(d, "cb.md"), "task: B\nendpoint: B\nscope: .\nrecipe: none\n\n- [A1] x\n");
  writeFileSync(join(d, "cc.md"), "task: C\nendpoint: C\nscope: .\nrecipe: none\n\n- [A1] x\n");
  const b = validateDeliveryContract(d, "B", join(d, "cb.md"));
  const c = validateDeliveryContract(d, "C", join(d, "cc.md"));
  bindDeliveryContract(d, "B", join(d, "cb.md"), b.hash);
  bindDeliveryContract(d, "C", join(d, "cc.md"), c.hash);
  return d;
}

// 假 gh（B 链全绿用）+假 curl。pagesCommit 可变（驱动对齐/未对齐/errored 形态）。
function fakeDeps({ pagesCommit = OLD, pagesStatus = "built", httpStatus = 200, body = `<html>${MARKER}</html>` } = {}) {
  const calls = [];
  const deps = {
    sleep: () => {},
    gitPush: () => ({ code: 0, stdout: "", stderr: "" }),
    ghApi: (args) => {
      calls.push(args.join(" "));
      if (args[0] === "pr" && args[1] === "view") {
        const merged = calls.some((c) => c.startsWith("pr merge"));
        return { code: 0, stdout: JSON.stringify({ state: merged ? "MERGED" : "OPEN", headRefOid: HEAD, baseRefName: "main", number: 7, url: "u", mergeCommit: merged ? { oid: MERGE } : null }), stderr: "" };
      }
      if (args[0] === "pr" && args[1] === "merge") {
        return { code: 0, signal: null, stdout: "", stderr: "" };
      }
      if (args[0] === "api" && String(args[1] ?? "").includes("check-runs")) {
        return { code: 0, stdout: JSON.stringify([{ name: "ci", status: "COMPLETED", conclusion: "SUCCESS" }]), stderr: "" };
      }
      if (args[0] === "api" && String(args[1] ?? "").includes("pages/builds/latest")) {
        return { code: 0, stdout: JSON.stringify({ status: pagesStatus, commit: pagesCommit }), stderr: "" };
      }
      return { code: 1, stdout: "", stderr: `fake-gh 未匹配：${args.join(" ")}` };
    },
    curlGet: (url) => {
      calls.push(`curl ${url}`);
      if (httpStatus !== 200) return { code: 0, stdout: `nopeHTTPSTATUS:${httpStatus}`, stderr: "" };
      return { code: 0, stdout: `${body}HTTPSTATUS:${httpStatus}`, stderr: "" };
    },
    _calls: calls,
  };
  return deps;
}

const cOpts = { repo: REPO, expectMarker: MARKER };
const intentC = (d) => loadIntents(d).intents.find((x) => x.endpoint === "C");

async function doneB(d) {
  const r = actDeliveryB(d, bOpts, fakeDeps());
  assert.equal(r.intent.status, "done");
}

test("①B 前置：B 意图缺席→act C 拒且零调用", () => {
  const d = goalRepo("lzy-dpages-1-");
  try {
    const deps = fakeDeps();
    assert.throws(() => actDeliveryC(d, cOpts, deps), /C 面前置不满足/);
    assert.equal(deps._calls.filter((c) => c.includes("pages")).length, 0);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("②Pages 预算内未对齐（latest 仍旧 commit）→failed 如实（V11 不假绿）", async () => {
  const d = goalRepo("lzy-dpages-2-");
  try {
    await doneB(d);
    const deps = fakeDeps({ pagesCommit: OLD });
    assert.throws(() => actDeliveryC(d, cOpts, deps), /Pages 构建未在预算内对齐.*readback C 可复验/);
    assert.equal(intentC(d).status, "failed");
    assert.equal(deps._calls.filter((c) => c.includes("pages/builds/latest")).length, 10, "轮询预算=10 次");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("③Pages 构建 errored→即拒；对齐+marker→done（http 200 判据入 observed）", async () => {
  const d1 = goalRepo("lzy-dpages-3a-");
  try {
    await doneB(d1);
    assert.throws(() => actDeliveryC(d1, cOpts, fakeDeps({ pagesStatus: "errored", pagesCommit: MERGE })), /Pages 构建失败/);
    assert.equal(intentC(d1).status, "failed");
  } finally {
    rmSync(d1, { recursive: true, force: true });
  }
  const d2 = goalRepo("lzy-dpages-3b-");
  try {
    await doneB(d2);
    const deps = fakeDeps({ pagesCommit: MERGE });
    const r = actDeliveryC(d2, cOpts, deps);
    assert.equal(r.intent.status, "done");
    assert.equal(r.intent.observed.http.markerFound, true);
    assert.equal(r.intent.observed.pagesBuild.commit, MERGE);
    assert.ok(r.intent.observed.http.url.startsWith("https://acfufu.github.io/lazyzcode"));
  } finally {
    rmSync(d2, { recursive: true, force: true });
  }
});

test("④HTTP 非 200 与 marker 缺失各如实 failed", async () => {
  const d1 = goalRepo("lzy-dpages-4a-");
  try {
    await doneB(d1);
    assert.throws(() => actDeliveryC(d1, cOpts, fakeDeps({ pagesCommit: MERGE, httpStatus: 404 })), /Pages 内容核验拒绝/);
    assert.equal(intentC(d1).status, "failed");
  } finally {
    rmSync(d1, { recursive: true, force: true });
  }
  const d2 = goalRepo("lzy-dpages-4b-");
  try {
    await doneB(d2);
    assert.throws(() => actDeliveryC(d2, cOpts, fakeDeps({ pagesCommit: MERGE, body: "<html>旧内容</html>" })), /marker=MISSING/);
    assert.equal(intentC(d2).status, "failed");
  } finally {
    rmSync(d2, { recursive: true, force: true });
  }
});

test("⑤readback C：迟来事实（对齐+marker）把 failed 收束为 done；未对齐=原状+如实 attempt", async () => {
  const d1 = goalRepo("lzy-dpages-5a-");
  try {
    await doneB(d1);
    assert.throws(() => actDeliveryC(d1, cOpts, fakeDeps({ pagesCommit: OLD })), /构建未在预算内对齐/);
    assert.equal(intentC(d1).status, "failed");
    const rb = readbackDeliveryC(d1, cOpts, fakeDeps({ pagesCommit: MERGE }));
    assert.equal(rb.intent.status, "done");
    assert.equal(rb.intent.observed.closedBy, "readback");
  } finally {
    rmSync(d1, { recursive: true, force: true });
  }
  const d2 = goalRepo("lzy-dpages-5b-");
  try {
    await doneB(d2);
    assert.throws(() => actDeliveryC(d2, cOpts, fakeDeps({ pagesCommit: OLD })), /构建未在预算内对齐/);
    const rb = readbackDeliveryC(d2, cOpts, fakeDeps({ pagesCommit: OLD }));
    assert.equal(rb.aligned, false);
    assert.equal(intentC(d2).status, "failed");
  } finally {
    rmSync(d2, { recursive: true, force: true });
  }
});
