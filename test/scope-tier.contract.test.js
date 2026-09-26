// 范围档（0.3.0 M2，ADR-0025）契约：四问复用判定矩阵——资格前拒/qualification 活体
// （注入检测+原样恢复）/资格后放行且 base 原事实保留/文件与目录条目变化回退/未知新文件
// 回退/清单漂移回退/环境变化回退/损坏回执 fail-closed/无清单配方恒全树档/CLI 复用拒绝面。
// 家法：core 函数进程内直调（快）+ CLI 子进程面（HOME 隔离+引擎抑制）；win32 雷回避
//（join 全程、快照比较走原始 JSON 对象、无分隔符假设）。
import { test } from "node:test";
process.env.LZY_ABLATE_HUMAN_GATE = "1"; // 人权门非本文件被测面
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { judgeReuse, listReceipts, qualifyCheck, reuseRun, runCheck } from "../core/verify.js";
import { loadContract } from "../core/contract.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");
const HOME = mkdtempSync(join(tmpdir(), "lzy-st-home-"));

function lzyIn(d, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: d,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: "/nonexistent-lzy-suppressed", LZY_ABLATE_HUMAN_GATE: "1" },
  });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const MANIFEST = {
  schemaVersion: 1,
  capabilities: {
    check: [
      { id: "dir-check", argv: [process.execPath, "-e", "process.exit(0)"], timeoutMs: 30_000, env: ["TZ"], inputPaths: ["src"] },
      { id: "file-check", argv: [process.execPath, "-e", "process.exit(0)"], timeoutMs: 30_000, inputPaths: ["src/a.txt"] },
      { id: "bare-check", argv: [process.execPath, "-e", "process.exit(0)"], timeoutMs: 30_000 },
    ],
  },
};

function repo(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  mkdirSync(join(d, "src"), { recursive: true });
  writeFileSync(join(d, "src", "a.txt"), "alpha\n");
  writeFileSync(join(d, "src", "b.txt"), "beta\n");
  g(["add", "src"]);
  g(["commit", "-qm", "init"]);
  const reg = lzyIn(d, ["loop", "register", "st", "--title", "t"]);
  if (reg.status !== 0) throw new Error(`register 失败：${reg.out}`);
  writeFileSync(join(d, "p.md"), "- [N1] x\n");
  const plan = lzyIn(d, ["loop", "plan", "p.md"]);
  if (plan.status !== 0) throw new Error(`plan 失败：${plan.out}`);
  lzyIn(d, ["loop", "start"]);
  writeFileSync(join(d, "lzy.project.json"), JSON.stringify(MANIFEST, null, 2));
  return d;
}

test("四问 (ii)：qualification 缺席→拒复用（资格前）", () => {
  const d = repo("lzy-st-prequal-");
  try {
    const base = runCheck(d, "dir-check", {});
    assert.equal(base.receipt.exit.code, 0);
    const j = judgeReuse(d, "dir-check", base.receipt.runId);
    assert.equal(j.ok, false);
    assert.match(j.reasons.join("；"), /qualification/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("qualification 活体：目录条目未知新文件注入检测+原样恢复；资格后四问全过放行", () => {
  const d = repo("lzy-st-qual-");
  try {
    const q = qualifyCheck(d, "dir-check", {});
    assert.equal(q.receipt.kind, "qualification");
    assert.equal(q.receipt.injections.length, 1);
    const inj = q.receipt.injections[0];
    assert.equal(inj.entry, "src");
    assert.equal(inj.mode, "unknown-new-file");
    assert.equal(inj.detected, true);
    assert.equal(inj.restored, true);
    assert.equal(readdirSync(join(d, "src")).filter((n) => n.startsWith(".lzy-qualify-probe-")).length, 0, "探针零残留");
    const base = listReceipts(d).find((r) => r.kind === "run" && r.checkId === "dir-check");
    const r = reuseRun(d, "dir-check", base.runId, { note: "资格后复用" });
    assert.equal(r.ok, true, JSON.stringify(r.reasons ?? r));
    assert.equal(r.receipt.kind, "reuse");
    assert.equal(r.receipt.baseRunId, base.runId);
    assert.equal(r.receipt.reuseJudgment.reasons.length, 5, "五问全✔各一条（v031-closeout R0.2 增契约归属问）");
    assert.match(r.receipt.reuseJudgment.reasons.join("；"), /契约归属一致（无契约（null））/, "无契约 goal=null 对 null 放行");
    // base 原时点原事实保留：reuse 回执的 startedAt/exit/artifacts=base 的
    assert.equal(r.receipt.startedAt, base.startedAt);
    assert.deepEqual(r.receipt.exit, base.exit);
    assert.deepEqual(r.receipt.artifacts, base.artifacts);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("四问 (iii) 文件条目：声明输入变化→回退（qualification 的 mutate-file 检测在先）", () => {
  const d = repo("lzy-st-file-");
  try {
    const q = qualifyCheck(d, "file-check", {});
    assert.equal(q.receipt.injections[0].mode, "mutate-file");
    assert.equal(q.receipt.injections[0].detected, true);
    assert.equal(readFileSync(join(d, "src", "a.txt"), "utf8"), "alpha\n", "注入已原样恢复");
    const base = listReceipts(d).find((r) => r.kind === "run" && r.checkId === "file-check");
    writeFileSync(join(d, "src", "a.txt"), "CHANGED\n");
    const j = judgeReuse(d, "file-check", base.runId);
    assert.equal(j.ok, false);
    assert.match(j.reasons.join("；"), /声明输入变化/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("四问 (iii) 目录条目：未知新文件=变化→回退", () => {
  const d = repo("lzy-st-newfile-");
  try {
    qualifyCheck(d, "dir-check", {});
    const base = listReceipts(d).find((r) => r.kind === "run" && r.checkId === "dir-check");
    writeFileSync(join(d, "src", "unknown-new.txt"), "surprise\n");
    const j = judgeReuse(d, "dir-check", base.runId);
    assert.equal(j.ok, false);
    assert.match(j.reasons.join("；"), /声明输入变化/);
    assert.match(j.reasons.join("；"), /unknown-new\.txt/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("四问 (iv) 清单漂移：manifestHash 不符→回退（配方身份变化）", () => {
  const d = repo("lzy-st-drift-");
  try {
    qualifyCheck(d, "dir-check", {});
    const base = listReceipts(d).find((r) => r.kind === "run" && r.checkId === "dir-check");
    const drifted = JSON.parse(JSON.stringify(MANIFEST));
    drifted.capabilities.check.push({ id: "another", argv: [process.execPath, "-e", "process.exit(0)"], timeoutMs: 1000 });
    writeFileSync(join(d, "lzy.project.json"), JSON.stringify(drifted, null, 2));
    const j = judgeReuse(d, "dir-check", base.runId);
    assert.equal(j.ok, false);
    assert.match(j.reasons.join("；"), /清单自 base 执行后已变更/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("四问 (iv) 环境变化：名单变量指纹不符→回退", () => {
  const d = repo("lzy-st-env-");
  const savedTz = process.env.TZ;
  try {
    delete process.env.TZ;
    qualifyCheck(d, "dir-check", {});
    const base = listReceipts(d).find((r) => r.kind === "run" && r.checkId === "dir-check");
    process.env.TZ = "Asia/Shanghai";
    const j = judgeReuse(d, "dir-check", base.runId);
    assert.equal(j.ok, false);
    assert.match(j.reasons.join("；"), /环境指纹变化/);
  } finally {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
    rmSync(d, { recursive: true, force: true });
  }
});

test("损坏回执：复用判定 fail-closed（不静默跳过）", () => {
  const d = repo("lzy-st-corrupt-");
  try {
    const base = runCheck(d, "dir-check", {});
    const dir = join(d, ".lazyzcode", "verify", "st");
    const file = readdirSync(dir).find((n) => /^receipt-.*\.json$/.test(n));
    const p = join(dir, file);
    const obj = JSON.parse(readFileSync(p, "utf8"));
    obj.exit = { code: 0, forged: true };
    writeFileSync(p, JSON.stringify(obj, null, 2));
    assert.throws(() => judgeReuse(d, "dir-check", base.receipt.runId), /校验和不符/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("无 inputPaths 配方：恒全树档，无资格可立", () => {
  const d = repo("lzy-st-bare-");
  try {
    const base = runCheck(d, "bare-check", {});
    assert.equal(base.receipt.inputSnapshot, null);
    const j = judgeReuse(d, "bare-check", base.receipt.runId);
    assert.equal(j.ok, false);
    assert.match(j.reasons.join("；"), /恒全树档/);
    assert.throws(() => qualifyCheck(d, "bare-check", {}), /无 inputPaths/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("CLI 复用拒绝面：--of 不在案 runId→非零退出+恢复指路（拒绝静默复用）", () => {
  const d = repo("lzy-st-cli-");
  try {
    const r = lzyIn(d, ["verify", "reuse", "dir-check", "--of", "r-not-in-case"]);
    assert.equal(r.status, 1);
    assert.match(r.out, /保守回退|不在案/);
    assert.match(r.out, /verify run/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── 归属问（v031-closeout R0.2 第五问）：契约 goal 只认同归属回执 ─────────────────────
// 判据：历史 null（契约启用前）与异契约回执一律不构成有效覆盖；无契约 goal=null 对 null 放行。
test("归属问：契约 goal 上旧 null 回执被拒并指路重验；同归属回执放行（五问全过）", () => {
  const d = repo("lzy-st-own-");
  try {
    // 先无契约采回执（历史 null）
    const base = runCheck(d, "dir-check", {});
    qualifyCheck(d, "dir-check", {});
    // 把契约绑到 goal（夹具状态注入，先例 scripts/v031/inject-txs.mjs）——模拟「契约启用前的旧回执」
    const gp = join(d, ".lazyzcode", "loop", "goal.json");
    const g = JSON.parse(readFileSync(gp, "utf8"));
    const cFile = join(d, "c-own.md");
    writeFileSync(cFile, ["task: own", "endpoint: A", "scope: .", "recipe: none", "", "- [A1] x", ""].join("\n"));
    const { hash } = loadContract(cFile, d);
    g.contract = { path: cFile, contractHash: hash };
    writeFileSync(gp, `${JSON.stringify(g, null, 2)}\n`);
    // 旧 null base + 旧 null qualification ⇒ 归属不符 ⇒ 拒并指路重验
    const j = judgeReuse(d, "dir-check", base.receipt.runId);
    assert.equal(j.ok, false, JSON.stringify(j.reasons));
    assert.match(j.reasons.join("；"), /契约归属不符/);
    assert.match(j.reasons.join("；"), /重验/);
    const r = reuseRun(d, "dir-check", base.receipt.runId);
    assert.equal(r.ok, false, "旧 null 不构成有效覆盖");
    // 同归属重取：run+qualify 都带现行契约哈希 ⇒ 五问全过
    const base2 = runCheck(d, "dir-check", {});
    assert.equal(base2.receipt.contractHash, hash, "新回执绑定现行契约");
    qualifyCheck(d, "dir-check", {});
    const r2 = reuseRun(d, "dir-check", base2.receipt.runId);
    assert.equal(r2.ok, true, JSON.stringify(r2.reasons ?? r2));
    assert.equal(r2.receipt.reuseJudgment.reasons.length, 5);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
