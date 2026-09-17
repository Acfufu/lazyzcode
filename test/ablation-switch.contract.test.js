// ablation-switch 契约测试（ADR-0015，goal true-ablation-full-flow#N2）：机器层 kill-switch
// 每开关两半——开（恰 "1"）=闸门确被绕过（fixture CLI stdout 为证）、关=与改动前 fixture
// 结果一致（同一 fixture 上拒辞逐字段同，先关后开串行复用一仓）。取值语义钉：缺席/空串/
// "0"/"true" 皆关——开关判定严格 === "1"，防半开半关的脏配置静默混入消融样本。
// 红半约定（N1 钉死）：开关态无法先于改动存在，红半=开关开的 fixture 表面捕获。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");
const SUPPRESS_ENGINE = "/nonexistent-lzy-suppressed-engine";
const HOME = mkdtempSync(join(tmpdir(), "lzy-abl-home-")); // HOME 隔离+引擎抑制（债③家法）

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

function commitAll(cwd, msg) {
  spawnSync("git", ["add", "-A"], { cwd });
  spawnSync("git", ["commit", "-qm", msg], { cwd });
}

// 造一个已取证的 executing goal（N1/F1 done，F1 证据新鲜，树净）。plan 落 .lazyzcode/
// （账本目录不计脏，integrity 闸门口径）；heavy=true 时带 PASS 评审过 HEAVY 采纳门。
function cycle(d, { heavy = false } = {}) {
  assert.equal(
    lzy(["loop", "register", "t", "--title", "t", ...(heavy ? ["--tier", "heavy"] : [])], d).code,
    0,
  );
  writeFileSync(join(d, ".lazyzcode", "plan.md"), "- [N1] x\n- [F1] v\n");
  const adopt = lzy(
    ["loop", "plan", ".lazyzcode/plan.md", ...(heavy ? ["--review", "plan-reviewer: PASS — t"] : [])],
    d,
  );
  assert.equal(adopt.code, 0, adopt.out);
  assert.equal(lzy(["loop", "start"], d).code, 0);
  assert.equal(lzy(["step", "done", "N1", "--note", "x"], d).code, 0);
  assert.equal(lzy(["step", "done", "F1", "--evidence", "绿半"], d).code, 0);
}

test("PLAN_GATE：关=禁词计划拒（逐字段同）；开=TBD 计划可采纳", () => {
  const d = repo("lzy-abl-plan-");
  try {
    assert.equal(lzy(["loop", "register", "t", "--title", "t"], d).code, 0);
    writeFileSync(join(d, ".lazyzcode", "plan.md"), "# 计划\n- [N1] 方案取舍 TBD\n- [F1] 终验\n");
    const off = lzy(["loop", "plan", ".lazyzcode/plan.md"], d);
    assert.equal(off.code, 1);
    assert.match(off.out, /计划未决策完备/);
    assert.match(off.out, /L2/); // 行号精确指向含 TBD 的行
    const on = lzy(["loop", "plan", ".lazyzcode/plan.md"], d, { LZY_ABLATE_PLAN_GATE: "1" });
    assert.equal(on.code, 0, on.out);
    assert.match(on.out, /计划门通过：2 项已采纳（N:1 F:1）/); // 消融面=只跳禁词扫描，清单解析照常
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("TIER_GATE：关=HEAVY 无 PASS 评审拒采纳；开=无评审可采纳", () => {
  const d = repo("lzy-abl-tier-");
  try {
    assert.equal(lzy(["loop", "register", "t", "--title", "t", "--tier", "heavy"], d).code, 0);
    writeFileSync(join(d, ".lazyzcode", "plan.md"), "- [N1] x\n- [F1] v\n");
    const off = lzy(["loop", "plan", ".lazyzcode/plan.md"], d); // 不带 --review
    assert.equal(off.code, 1);
    assert.match(off.out, /HEAVY 目标机器拒：无 PASS 评审不得采纳/);
    const on = lzy(["loop", "plan", ".lazyzcode/plan.md"], d, { LZY_ABLATE_TIER_GATE: "1" });
    assert.equal(on.code, 0, on.out);
    assert.match(on.out, /计划门通过/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("VERIFY：关=过期证据拒 finish；开=放行（范围=doFinishLoop 两处拒绝）", () => {
  const d = repo("lzy-abl-ver-");
  try {
    cycle(d);
    writeFileSync(join(d, "b.txt"), "b\n"); // 取证后代码再提交 → F1 证据过期
    commitAll(d, "change after evidence");
    const off = lzy(["loop", "finish"], d);
    assert.equal(off.code, 1);
    assert.match(off.out, /证据已过期/);
    assert.match(off.out, /F1/);
    const on = lzy(["loop", "finish"], d, { LZY_ABLATE_VERIFY: "1" });
    assert.equal(on.code, 0, on.out);
    assert.match(on.out, /✔✔ 目标完成：t/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("INTEGRITY：关=脏树拒 finish；开=脏树放行", () => {
  const d = repo("lzy-abl-int-");
  try {
    cycle(d);
    writeFileSync(join(d, "junk.txt"), "j\n"); // 未提交杂物 → host 根 dirty（HEAD 未动，证据仍新鲜）
    const off = lzy(["loop", "finish"], d);
    assert.equal(off.code, 1);
    assert.match(off.out, /finish 完整性闸门拒绝（dirty）/);
    assert.match(off.out, /junk\.txt/);
    const on = lzy(["loop", "finish"], d, { LZY_ABLATE_INTEGRITY: "1" });
    assert.equal(on.code, 0, on.out);
    assert.match(on.out, /✔✔ 目标完成：t/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("ATTEST：关=HEAVY finish 无对照记录拒；开=免门放行（终验证明记 null 不伪造）", () => {
  const d = repo("lzy-abl-att-");
  try {
    cycle(d, { heavy: true }); // 全部步骤 done、证据新鲜、树净，唯无 comparator attestation
    const off = lzy(["loop", "finish"], d);
    assert.equal(off.code, 1);
    assert.match(off.out, /HEAVY finish 需对照 attestation 且 MATCH/);
    const on = lzy(["loop", "finish"], d, { LZY_ABLATE_ATTEST: "1" });
    assert.equal(on.code, 0, on.out);
    assert.match(on.out, /✔✔ 目标完成：t/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("取值语义钉：恰 \"1\" 消融，缺席/空串/\"0\"/\"true\" 皆关（防脏配置半开半关）", () => {
  const d = repo("lzy-abl-sem-");
  try {
    assert.equal(lzy(["loop", "register", "t", "--title", "t"], d).code, 0);
    writeFileSync(join(d, ".lazyzcode", "plan.md"), "# 计划\n- [N1] 方案取舍 TBD\n- [F1] 终验\n");
    for (const [label, v] of [["空串", ""], ["0", "0"], ["true", "true"]]) {
      const r = lzy(["loop", "plan", ".lazyzcode/plan.md"], d, { LZY_ABLATE_PLAN_GATE: v });
      assert.equal(r.code, 1, `取值 ${label} 不得消融`);
      assert.match(r.out, /计划未决策完备/);
    }
    const on = lzy(["loop", "plan", ".lazyzcode/plan.md"], d, { LZY_ABLATE_PLAN_GATE: "1" });
    assert.equal(on.code, 0, on.out); // 恰 "1" 才是开
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
