// risk_axis 契约测试（0.2.0 棒1，ADR-0020；§⑮ Q5 拍板）：risk_class 落盘面——register
// 持久化/非法值拒/大小写归一/缺省 low/setRisk 只升不降/同值 no-op/HIGH+ 升档 warn、
// status 读面行、缺键容忍读法（旧 goal.json 无 risk 字段=additive）。CLI 真实表面绿半归
// F1 终批取证，本文件钉模块与 CLI 双面行为。HOME 隔离+引擎抑制（债③家法）。
import { test } from "node:test";
process.env.LZY_ABLATE_HUMAN_GATE = "1";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readGoal, registerGoal, setRisk } from "../core/loop.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");
const SUPPRESS_ENGINE = "/nonexistent-lzy-suppressed-engine";
const HOME = mkdtempSync(join(tmpdir(), "lzy-risk-home-"));

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

function lzy(args, cwd, env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE, ...env },
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

test("register 落盘 risk：缺省 low/非法值拒/大小写归一", () => {
  const d = repo("lzy-risk-reg-");
  try {
    const g1 = registerGoal(d, "t1", "t", {});
    assert.equal(g1.risk, "low");
    assert.throws(() => registerGoal(d, "t1b", "t", { risk: "bogus" }), /risk 不合法/);
    // 归一：清槽后大写 MED 落盘为 med
    spawnSync("node", [CLI, "loop", "reset"], { cwd: d, env: { ...process.env, HOME } });
    const g2 = registerGoal(d, "t1", "t", { risk: "MED" });
    assert.equal(g2.risk, "med");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("setRisk 只升不降+同值 no-op+HIGH/RESTRICTED 升档 warn；缺键容忍", () => {
  const d = repo("lzy-risk-tier-");
  try {
    registerGoal(d, "t", "t", {});
    // 旧形 goal.json 摘除 risk 字段=缺键容忍读法
    const p = join(d, ".lazyzcode", "loop", "goal.json");
    const g0 = JSON.parse(readFileSync(p, "utf8"));
    delete g0.risk;
    writeFileSync(p, JSON.stringify(g0, null, 2));
    assert.equal(readGoal(d).risk ?? "low", "low");
    // med → high → warn；high → restricted → warn；restricted → low 拒；同值 no-op
    assert.throws(() => setRisk(d, "bogus"), /risk 不合法/);
    const r1 = setRisk(d, "med");
    assert.equal(r1.warn, null);
    const r2 = setRisk(d, "HIGH");
    assert.match(r2.warn, /SUSPENDED_RISK/);
    const r3 = setRisk(d, "restricted");
    assert.match(r3.warn, /硬禁/);
    assert.throws(() => setRisk(d, "low"), /只升不降/);
    const r4 = setRisk(d, "restricted");
    assert.equal(r4.changed, false);
    assert.equal(readGoal(d).risk, "restricted");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("CLI 面：register --risk 落盘/status 读面 risk 行/lzy loop risk 拒降档原文", () => {
  const d = repo("lzy-risk-cli-");
  try {
    let r = lzy(["loop", "register", "t", "--title", "t", "--risk", "high"], d);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /risk high/);
    r = lzy(["loop", "status"], d);
    assert.match(r.out, /risk high/);
    r = lzy(["loop", "risk", "low"], d);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /只升不降/);
    r = lzy(["loop", "risk", "restricted"], d);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /RESTRICTED：硬禁/);
    r = lzy(["loop", "risk", "bogus"], d);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /risk 不合法/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
