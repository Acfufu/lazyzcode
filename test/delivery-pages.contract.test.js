// 交付 Pages 面契约测试（0.3.0 M4，拍板 7，V11）：B 前置（mergeSha 缺席拒）；构建对齐轮询
// 预算（15s×≤10，sleep 注入零延迟）；errored 即拒；HTTPS 200∧expect-marker 判据（缺失/非 200
// 如实 failed 不假绿）；观察参数重瞄（marker/URL 校正=attempt 记录，交付身份 repo/mergeSha
// 漂移仍拒）；readback C 迟来事实收束 done/未对齐原状。全 deps 注入——win32 安全。
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

// 假 gh（B 链全绿用）+假 curl。pagesCommit/pagesStatus/body 可变（驱动各形态）。
function fakeDeps({ pagesCommit = OLD, pagesStatus = "built", httpStatus = 200, body = `<html>${MARKER}</html>` } = {}) {
  const calls = [];
  const deps = {
    sleep: () => {},
    gitPush: () => ({ code: 0, stdout: "", stderr: "" }),
    ghApi: (args) => {
      calls.push(args.join(" "));
      if (args[0] === "pr" && args[1] === "view") {
        const merged = calls.some((x) => x.startsWith("pr merge"));
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
    assert.equal(deps._calls.filter((x) => x.includes("pages")).length, 0);
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
    assert.equal(deps._calls.filter((x) => x.includes("pages/builds/latest")).length, 10, "轮询预算=10 次");
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

test("⑥观察参数重瞄：failed 后以校正 marker/URL 重 act→done 且 attempt 记录前后值；本次抓取须用重瞄后 URL（内存对象同步）", async () => {
  const d = goalRepo("lzy-dpages-6-");
  try {
    await doneB(d);
    assert.throws(() => actDeliveryC(d, cOpts, fakeDeps({ pagesCommit: MERGE, body: "<html>旧内容</html>" })), /marker=MISSING/);
    assert.equal(intentC(d).status, "failed");
    // 假 curl 按 URL 区分 body：旧 URL 无标记、重瞄后 URL 才有——钉死「用重瞄后 URL 抓取」
    const bodies = { "https://old.example/": "<html>旧内容</html>", "https://new.example/": "<html>M4 报告页标题</html>" };
    const seenUrls = [];
    const deps = fakeDeps({ pagesCommit: MERGE });
    deps.curlGet = (url) => {
      seenUrls.push(url);
      return { code: 0, stdout: `${bodies[url] ?? "???"}HTTPSTATUS:200`, stderr: "" };
    };
    const r = actDeliveryC(d, { repo: REPO, expectMarker: "M4 报告页标题", contentUrl: "https://new.example/" }, deps);
    assert.equal(r.intent.status, "done");
    assert.equal(r.intent.target.expectMarker, "M4 报告页标题");
    assert.equal(r.intent.target.contentUrl, "https://new.example/");
    assert.deepEqual(seenUrls, ["https://new.example/"], "重瞄后必须以新 URL 抓取");
    const reAim = r.intent.attempts.filter((a) => a.method === "re-aim");
    assert.equal(reAim.length, 1);
    assert.match(reAim[0].detail, /v030-m4-delivery-report/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑦C 交付身份漂移拒：repo 不符→身份漂移（观察参数豁免不波及身份键）", async () => {
  const d = goalRepo("lzy-dpages-7-");
  try {
    await doneB(d);
    assert.throws(() => actDeliveryC(d, cOpts, fakeDeps({ pagesCommit: MERGE, body: "<html>旧内容</html>" })), /marker=MISSING|内容核验拒绝/);
    assert.equal(intentC(d).status, "failed");
    assert.throws(() => actDeliveryC(d, { repo: "other/repo", expectMarker: "M4 报告页标题" }, fakeDeps({ pagesCommit: MERGE })), /身份漂移/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── 0.3.1 棒1（债 M4-4，ADR-0030 §一.A/B）：多页核验 + 契约取值面 ──
// 逐 URL 假 curl（多页三态驱动）；契约声明 repo/expect-marker/page 后 act 空参数可跑（无人值守面）。
function bindCRich(d, extraLines) {
  const body = `task: C rich\nendpoint: C\nscope: .\nrecipe: none\n${extraLines.join("\n")}\n\n- [A1] x\n`;
  writeFileSync(join(d, "cc-rich.md"), body);
  const v = validateDeliveryContract(d, "C", join(d, "cc-rich.md"));
  bindDeliveryContract(d, "C", join(d, "cc-rich.md"), v.hash);
  return v;
}

function depsByUrl(map, { pagesCommit = MERGE, pagesStatus = "built" } = {}) {
  const deps = fakeDeps({ pagesCommit, pagesStatus });
  const seen = [];
  deps.curlGet = (url) => {
    seen.push(url);
    const v = map[url];
    if (v == null) return { code: 0, stdout: `HTTPSTATUS:404`, stderr: "" };
    return { code: 0, stdout: `${v}HTTPSTATUS:200`, stderr: "" };
  };
  deps._seen = seen;
  return deps;
}

test("⑧多页全过：契约 page 声明 + 空参数 act（契约取值）→ 逐页 200∧marker → done，observed.pages 明细与 URL 拼接在场", async () => {
  const d = goalRepo("lzy-dpages-8-");
  try {
    await doneB(d);
    bindCRich(d, ["repo: Acfufu/lazyzcode", "expect-marker: v0.3.1", "page: /guide/zh.html", "page: /adr/index.html"]);
    const deps = depsByUrl({
      "https://acfufu.github.io/lazyzcode/": "<html>v0.3.1</html>",
      "https://acfufu.github.io/lazyzcode/guide/zh.html": "<html>v0.3.1 中文</html>",
      "https://acfufu.github.io/lazyzcode/adr/index.html": "<html>ADR v0.3.1</html>",
    });
    const r = actDeliveryC(d, {}, deps); // 空参数：repo/expect-marker/pages 全来自契约
    assert.equal(r.intent.status, "done");
    assert.deepEqual(deps._seen, [
      "https://acfufu.github.io/lazyzcode/",
      "https://acfufu.github.io/lazyzcode/guide/zh.html",
      "https://acfufu.github.io/lazyzcode/adr/index.html",
    ]);
    assert.equal(r.pages.length, 3);
    assert.ok(r.pages.every((p) => p.ok));
    assert.equal(r.intent.observed.pages.length, 3);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑨单页 404 拒：失败页清单在场、intent failed（不假绿）", async () => {
  const d = goalRepo("lzy-dpages-9-");
  try {
    await doneB(d);
    bindCRich(d, ["repo: Acfufu/lazyzcode", "expect-marker: v0.3.1", "page: /guide/zh.html", "page: /missing.html"]);
    const deps = depsByUrl({
      "https://acfufu.github.io/lazyzcode/": "<html>v0.3.1</html>",
      "https://acfufu.github.io/lazyzcode/guide/zh.html": "<html>v0.3.1</html>",
      // /missing.html → 默认 404
    });
    assert.throws(() => actDeliveryC(d, {}, deps), /失败页=\/missing\.html/);
    assert.equal(intentC(d).status, "failed");
    const last = intentC(d).attempts.at(-1);
    assert.match(last.detail, /\/missing\.html\(http=404/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑩单页 200 缺 marker 拒：失败页标记 MISSING", async () => {
  const d = goalRepo("lzy-dpages-10-");
  try {
    await doneB(d);
    bindCRich(d, ["repo: Acfufu/lazyzcode", "expect-marker: v0.3.1", "page: /stale.html"]);
    const deps = depsByUrl({
      "https://acfufu.github.io/lazyzcode/": "<html>v0.3.1</html>",
      "https://acfufu.github.io/lazyzcode/stale.html": "<html>旧内容</html>",
    });
    assert.throws(() => actDeliveryC(d, {}, deps), /失败页=\/stale\.html/);
    assert.match(intentC(d).attempts.at(-1).detail, /\/stale\.html\(http=200 marker=MISSING\)/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑪缺省 pages=仅站点根（单页行为逐字：curl 只打站点根一次，URL 与旧实现一致）", async () => {
  const d = goalRepo("lzy-dpages-11-");
  try {
    await doneB(d);
    bindCRich(d, ["repo: Acfufu/lazyzcode", "expect-marker: v0.3.1"]); // 无 page:
    const deps = depsByUrl({ "https://acfufu.github.io/lazyzcode/": "<html>v0.3.1</html>" });
    const r = actDeliveryC(d, {}, deps);
    assert.equal(r.intent.status, "done");
    assert.deepEqual(deps._seen, ["https://acfufu.github.io/lazyzcode/"]);
    assert.equal(r.pages.length, 1);
    assert.equal(r.pages[0].path, "/");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
