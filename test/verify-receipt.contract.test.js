// 受控执行回执（0.3.0 M2，主方案 §4.1）契约：回执全字段/超时击杀/argv shell 串拒/
// 工件 sha256 对照/篡改 fail-closed/原始输出与摘要分离/家族 tmp 登记（reset 清 tmp 不清
// 回执本体）/checkId 与清单缺席拒绝面。
// 家法：真子进程 CLI（HOME 隔离+引擎抑制）、win32 雷回避（join 全程、无分隔符假设）；
// 超时击杀面 win32 的 SIGTERM 模拟语义未核——win32 跳过并如实注记（计划 Known unknowns 3：
// CI 矩阵轮真值补核，本地只钉机制语义）。
import { test } from "node:test";
process.env.LZY_ABLATE_HUMAN_GATE = "1"; // 人权门非本文件被测面
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listReceipts } from "../core/verify.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");
const HOME = mkdtempSync(join(tmpdir(), "lzy-vr-home-"));

function lzyIn(d, args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: d,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: "/nonexistent-lzy-suppressed", LZY_ABLATE_HUMAN_GATE: "1", ...extraEnv },
  });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function repo(prefix, manifestObj) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "seed\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "init"]);
  const reg = lzyIn(d, ["loop", "register", "vr", "--title", "t"]);
  if (reg.status !== 0) throw new Error(`register 失败：${reg.out}`);
  writeFileSync(join(d, "p.md"), "- [N1] x\n");
  const plan = lzyIn(d, ["loop", "plan", "p.md"]);
  if (plan.status !== 0) throw new Error(`plan 失败：${plan.out}`);
  lzyIn(d, ["loop", "start"]);
  if (manifestObj) writeFileSync(join(d, "lzy.project.json"), JSON.stringify(manifestObj, null, 2));
  return d;
}

const verifyDir = (d) => join(d, ".lazyzcode", "verify");
const FAST_OK = {
  schemaVersion: 1,
  capabilities: { check: [{ id: "ok", argv: [process.execPath, "-e", "console.log('hello-raw'); process.exit(0)"], timeoutMs: 30_000 }] },
};

test("回执全字段与原始输出分离（工件 sha256 可对照）", () => {
  const d = repo("lzy-vr-shape-", FAST_OK);
  try {
    const r = lzyIn(d, ["verify", "run", "ok", "--note", "形状冒烟"]);
    assert.equal(r.status, 0, r.out);
    const receipts = listReceipts(d);
    assert.equal(receipts.length, 1);
    const rc = receipts[0];
    for (const k of ["schemaVersion", "kind", "slug", "runId", "checkId", "acceptanceIds", "contractHash", "candidate", "recipe", "inputSnapshot", "envFingerprint", "startedAt", "endedAt", "exit", "artifacts", "summary", "baseRunId"]) {
      assert.ok(k in rc, `回执缺字段 ${k}`);
    }
    assert.equal(rc.kind, "run");
    assert.equal(rc.exit.code, 0);
    assert.match(rc.summary, /形状冒烟/);
    assert.ok(rc.candidate.headSha && /^[0-9a-f]{40,64}$/.test(rc.candidate.headSha), "候选 HEAD 在案");
    assert.ok(rc.recipe.manifestHash && /^[0-9a-f]{64}$/.test(rc.recipe.manifestHash), "清单哈希入档");
    // 原始输出与人工摘要分离：raw log 在场且含真实 stdout；回执 JSON 不内联原始输出正文
    const rawPath = join(verifyDir(d), rc.slug, "raw", `${rc.runId}.log`);
    assert.ok(existsSync(rawPath), "raw log 在场");
    assert.match(readFileSync(rawPath, "utf8"), /hello-raw/);
    assert.ok(!JSON.stringify(rc).includes("--- stdout ---"), "原始输出正文不内联进回执（分离保存——raw 分节标记只存在于 raw log）");
    const art = rc.artifacts.find((a) => a.path.includes("/raw/") || a.path.includes("\\raw\\"));
    assert.ok(art, "raw 工件入 artifacts");
    assert.equal(art.sha256, createHash("sha256").update(readFileSync(rawPath)).digest("hex"), "工件 sha256 与盘上文件一致");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

const itNotWin = process.platform === "win32" ? test.skip : test;
itNotWin("超时击杀：SIGTERM 后回执如实记 timeout（非零退出）", () => {
  const d = repo("lzy-vr-timeout-", {
    schemaVersion: 1,
    capabilities: { check: [{ id: "slow", argv: [process.execPath, "-e", "setTimeout(()=>{}, 60000)"], timeoutMs: 800 }] },
  });
  try {
    const r = lzyIn(d, ["verify", "run", "slow"]);
    assert.equal(r.status, 1, `超时须非零退出：${r.out}`);
    assert.match(r.out, /超时击杀/);
    const rc = listReceipts(d)[0];
    assert.equal(rc.exit.timeout, true, `exit 须记 timeout：${JSON.stringify(rc.exit)}`);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("argv shell 串：执行面拒绝（清单校验先行，不落到 spawn）", () => {
  const d = repo("lzy-vr-shell-", {
    schemaVersion: 1,
    capabilities: { check: [{ id: "sh", argv: "echo hello" }] },
  });
  try {
    const r = lzyIn(d, ["verify", "run", "sh"]);
    assert.equal(r.status, 1);
    assert.match(r.out, /argv 须为字符串数组/);
    assert.equal(listReceipts(d).length, 0, "拒绝面不产生回执");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("篡改回执字节：读面 fail-closed（校验和不符），CLI 非零退出", () => {
  const d = repo("lzy-vr-tamper-", FAST_OK);
  try {
    assert.equal(lzyIn(d, ["verify", "run", "ok"]).status, 0);
    const dir = join(verifyDir(d), "vr");
    const file = readdirSync(dir).find((n) => /^receipt-.*\.json$/.test(n));
    const p = join(dir, file);
    const obj = JSON.parse(readFileSync(p, "utf8"));
    obj.summary = "伪造的新摘要";
    writeFileSync(p, JSON.stringify(obj, null, 2));
    assert.throws(() => listReceipts(d), /校验和不符/, "core 读面 fail-closed");
    const r = lzyIn(d, ["verify", "list"]);
    assert.equal(r.status, 1, "CLI 读面非零退出");
    assert.match(r.out, /校验和不符/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("checkId 不在 check 类→拒并枚举在案；清单缺席→拒带指路", () => {
  const d = repo("lzy-vr-missing-", FAST_OK);
  const d2 = repo("lzy-vr-nomanifest-");
  try {
    const r = lzyIn(d, ["verify", "run", "nope"]);
    assert.equal(r.status, 1);
    assert.match(r.out, /不在 check 类配方中（在案：ok）/);
    const r2 = lzyIn(d2, ["verify", "run", "ok"]);
    assert.equal(r2.status, 1);
    assert.match(r2.out, /项目清单缺席/);
    assert.match(r2.out, /discover/);
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(d2, { recursive: true, force: true });
  }
});

test("家族 tmp 登记：reset 清 verify/ 顶层孤儿 tmp，回执本体保留（loop/ 外家族）", () => {
  const d = repo("lzy-vr-tmp-", FAST_OK);
  try {
    assert.equal(lzyIn(d, ["verify", "run", "ok"]).status, 0);
    mkdirSync(verifyDir(d), { recursive: true });
    writeFileSync(join(verifyDir(d), ".receipt-999-x.tmp"), "orphan");
    const r = lzyIn(d, ["loop", "reset"]);
    assert.equal(r.status, 0, r.out);
    assert.ok(!existsSync(join(verifyDir(d), ".receipt-999-x.tmp")), "孤儿 tmp 被清扫（ANY_TMP_SCAN_DIRS 登记且 tmp 落家族根）");
    assert.equal(listReceipts(d).length, 1, "回执本体不被 reset 清");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── 契约绑定（v031-closeout R0.2）：四类回执 contractHash == 登记值；无契约如实 null ──────
// 改前反例见 scripts/v031/closeout-qa.mjs --case receipt-binding（红半：四类全 null）；
// 本用例钉改后语义，含 reuse 的契约归属执法（v 问）与 qualification 同归属筛选。
const CONTRACT_BODY = ["task: vr-own", "endpoint: A", "scope: .", "recipe: none", "", "- [A1] x", ""].join("\n");

test("契约绑定：四类回执 contractHash 严格等于 goal.contract.contractHash；无契约 goal 如实 null", () => {
  const d = repo("lzy-vr-own-", {
    schemaVersion: 1,
    capabilities: { check: [{ id: "dir-check", argv: [process.execPath, "-e", "process.exit(0)"], timeoutMs: 30_000, env: ["TZ"], inputPaths: ["a.txt"] }] },
  });
  try {
    // 无契约期（repo() 已 register+plan+start 无契约）：回执如实 null，不猜测归属
    assert.equal(lzyIn(d, ["verify", "run", "dir-check"]).status, 0);
    assert.equal(listReceipts(d).find((r) => r.kind === "run").contractHash, null, "无契约 legacy 记录如实保留 null");
    // 转契约 goal：重置槽后带 --contract 重注册（消融放行采纳）
    assert.equal(lzyIn(d, ["loop", "reset"]).status, 0);
    writeFileSync(join(d, "c.md"), CONTRACT_BODY);
    const reg = lzyIn(d, ["loop", "register", "vr", "--title", "t", "--contract", "c.md"]);
    assert.equal(reg.status, 0, reg.out);
    assert.equal(lzyIn(d, ["loop", "plan", "p.md"]).status, 0);
    assert.equal(lzyIn(d, ["loop", "start"]).status, 0);
    const goalHash = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8")).contract.contractHash;
    assert.match(goalHash, /^[0-9a-f]{64}$/);
    // 四类回执
    assert.equal(lzyIn(d, ["verify", "run", "dir-check", "--accepts", "A1"]).status, 0);
    assert.equal(lzyIn(d, ["verify", "qualify", "dir-check"]).status, 0);
    const base = listReceipts(d).filter((r) => r.kind === "run").findLast(() => true);
    assert.equal(lzyIn(d, ["verify", "reuse", "dir-check", "--of", base.runId]).status, 0);
    const fakeGh = join(d, "fake-gh.mjs");
    writeFileSync(
      fakeGh,
      "#!/usr/bin/env node\nconst a = process.argv.slice(2).join(' ');\nif (a.includes('check-runs')) { process.stdout.write(JSON.stringify([{ name: 'ci', conclusion: 'success', details_url: 'u' }])); process.exit(0); }\nprocess.exit(1);\n",
    );
    chmodSync(fakeGh, 0o755);
    const ci = lzyIn(d, ["verify", "ci", "--repo", "Acfufu/lazyzcode"], { LZY_GH_BIN: fakeGh });
    assert.equal(ci.status, 0, ci.out);
    const recs = listReceipts(d);
    for (const k of ["run", "qualification", "reuse", "ci"]) {
      const r = recs.filter((x) => x.kind === k).findLast(() => true);
      assert.ok(r, `缺 ${k} 回执`);
      assert.equal(r.contractHash, goalHash, `${k} 回执契约绑定=登记值`);
    }
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
