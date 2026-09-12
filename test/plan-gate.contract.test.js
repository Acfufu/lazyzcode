// 计划门契约测试：「已知未知」段与门禁词黑名单的语义钉子三枚（goal ablation-confidence N4）。
// 已知未知段是纪律特性（HEAVY 强制申报假设+证伪途径，见 zw SKILL.md Plan 节与 docs/ablation.md），
// 不是未决事项——但段也不是法外之地：悬而未决的决策（TBD/待定…）在段内仍要被拦。
// 钉 3 是黑名单语义回归钉：UNDECIDED_RE 永不得收「未知」二字，否则特性名自身都过不了门。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");

function repo() {
  const d = mkdtempSync(join(tmpdir(), "lzy-plangate-"));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "a\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "init"]);
  return d;
}

const ISOLATED_HOME = mkdtempSync(join(tmpdir(), "lzy-pg-home-")); // HOME 隔离(goal ratelimit-scan-budget):不读真实引擎日志

function lzy(args, cwd) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", timeout: 60_000, env: { ...process.env, HOME: ISOLATED_HOME } });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function planAt(dir, body) {
  writeFileSync(join(dir, "plan.md"), body);
  return "plan.md";
}

function register(dir, slug) {
  assert.equal(lzy(["loop", "register", slug, "--title", "t"], dir).code, 0);
}

test("钉1：含已知未知段的计划原样过门，清单项解析不受段干扰", () => {
  const d = repo();
  try {
    register(d, "ku-pass");
    const body = [
      "# 计划",
      "## 步骤",
      "- [N1] 落地 A",
      "- [F1] 取证 A",
      "## 已知未知",
      "- 假设 X 成立；证伪途径：跑 Y，若输出 Z 则推翻并回炉 N1",
      "",
    ].join("\n");
    const r = lzy(["loop", "plan", planAt(d, body)], d);
    assert.equal(r.code, 0);
    assert.match(r.out, /计划门通过：2 项已采纳（N:1 F:1）/); // 段内散文行不得混入清单
    const s = lzy(["loop", "status"], d);
    assert.match(s.out, /N1/);
    assert.match(s.out, /F1/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("钉2：已知未知段内出现门禁词仍按行号拒（段不是法外之地）", () => {
  const d = repo();
  try {
    register(d, "ku-guard");
    const body = [
      "# 计划",
      "- [N1] 落地 A",
      "## 已知未知",
      "- 认证方案取舍 TBD；证伪途径：无（这正是悬而未决处，应回评审门而非写进段里）",
    ].join("\n");
    const r = lzy(["loop", "plan", planAt(d, body)], d);
    assert.equal(r.code, 1);
    assert.match(r.out, /计划未决策完备/);
    assert.match(r.out, /L4/); // 行号精确指向段内那一行
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("钉3：「已知未知」四字自身过门——未知二字永不入禁词表（黑名单语义回归钉）", () => {
  const d = repo();
  try {
    register(d, "ku-name");
    // 标题与段标题双双含「未知」：谁往 UNDECIDED_RE 里加「未知」，这两行先炸
    const body = ["# 计划", "- [N1] 已知未知段落地", "## 已知未知", "- 无（扫过 zw SKILL.md Plan 节与最近两轮评审记录，暂无未证伪前提）"].join("\n");
    const r = lzy(["loop", "plan", planAt(d, body)], d);
    assert.equal(r.code, 0);
    const s = lzy(["loop", "status"], d);
    assert.match(s.out, /已知未知段落地/); // 项标题带「未知」字样仍完整入库
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
