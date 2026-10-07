// F3 红绿探针（0.5.0 M2 / goal v050-m2-freeze）：收束分类读面三件。
// ①classifyCause 补族：workers 六族＋单工人两漏族 ≠ other（收束串原文不动），
//   done/义务阻塞/预算尽/merge-conflict 主干族回归不变；
// ②status --json 读面：metrics.json 带 cause:* 计数时 checks 含 handoff-causes 行
//   （ok＋分族计数 detail；schemaVersion=1、顶层四键不动）；
// ③doctor --json 读面：同一行经 collectStatus 内嵌同样在场。
// 用法：node scripts/v050/probes/f3-cause-readface.mjs [树根]（缺省=本仓根；
//   红半传 0.4.1 发布包展开目录）。exit 1=存在未满足断言（红），0=全绿。
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const ROOT = resolve(process.argv[2] ? process.argv[2] : join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".."));
const { classifyCause } = await import(`file://${join(ROOT, "core", "drive.js")}`);

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failures += 1;
    console.log(`FAIL - ${name}: ${e?.message ?? e}`);
  }
};
const need = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// ── ①classifyCause 补族（workers 六族＋单工人两漏族）────────────────────
const WORKERS_FAMILIES = [
  ["装配失败（3 波工人返回非零）", "segment-failed"],
  ["工人段失败（exit=1）：seg-2", "segment-failed"],
  ["整合验证前置读失败：x", "segment-failed"],
  ["整合验证执行失败：x", "segment-failed"],
  ["整合验证失败（gate explain 缺口）", "segment-failed"],
  ["波间心跳失败（worker-1）", "segment-failed"],
  ["段间心跳失败（seg-3）：超时", "segment-failed"],
  ["波间门拒（波 2 收口门）：发现未清", "gate"],
  ["finish 失败（exit=2）：义务门拒", "gate"],
  ["高危步停摆（H3R：步 N5 超时未决）", "gate"],
  ["波数尽（4 波）", "segments-exhausted"],
];
check("classifyCause：workers 六族＋单工人两漏族全部具名（≠other）", () => {
  for (const [s, want] of WORKERS_FAMILIES) {
    assert.equal(classifyCause(s), want, `「${s}」→ ${classifyCause(s)} ≠ ${want}`);
  }
});
check("classifyCause：主干族回归不变", () => {
  assert.equal(classifyCause("done"), "done");
  assert.equal(classifyCause("义务阻塞（review.general-correctness）"), "obligation-blocked");
  assert.equal(classifyCause("预算尽（墙钟预算超顶）"), "budget-exhausted");
  assert.equal(classifyCause("波数尽之外的单工人段数尽（8 段）"), "segments-exhausted");
  assert.equal(classifyCause("merge-conflict"), "merge-conflict");
  assert.equal(classifyCause("史前未知收束因 xyz"), "other");
});

// ── ②③status/doctor --json 读面（fixture 仓）──────────────────────────
const d = mkdtempSync(join(tmpdir(), "lzy-f3-"));
mkdirSync(join(d, ".lazyzcode", "loop"), { recursive: true });
writeFileSync(
  join(d, ".lazyzcode", "loop", "metrics.json"),
  `${JSON.stringify({ registered: 2, consumed: 1, "cause:gate": 2, "cause:segment-failed": 1 }, null, 2)}\n`,
);

const runJson = (args) => spawnSync(process.execPath, [join(ROOT, "cli", "lzy.js"), ...args], { cwd: d, encoding: "utf8", shell: false, timeout: 120_000 });

check("status --json：handoff-causes 行在场（ok＋分族计数）", () => {
  const p = runJson(["status", "--json"]);
  const parsed = JSON.parse(p.stdout);
  const row = parsed.checks.find((c) => c.name === "handoff-causes");
  need(row, `handoff-causes 行缺席（实有：${parsed.checks.map((c) => c.name).join(",")}）`);
  assert.equal(row.state, "ok");
  assert.ok(row.detail.includes("gate×2") && row.detail.includes("segment-failed×1"), `分族计数不符：${row.detail}`);
});
check("status --json：契约不破（schemaVersion=1＋顶层四键＋三键 checks）", () => {
  const p = runJson(["status", "--json"]);
  const parsed = JSON.parse(p.stdout);
  assert.equal(parsed.schemaVersion, 1);
  assert.deepEqual(Object.keys(parsed).sort(), ["checks", "command", "ok", "schemaVersion"]);
  for (const c of parsed.checks) assert.deepEqual(Object.keys(c).sort(), ["detail", "name", "state"]);
});
check("doctor --json：handoff-causes 行在场（collectStatus 内嵌）", () => {
  const p = runJson(["doctor", "--json"]);
  const parsed = JSON.parse(p.stdout);
  const row = parsed.checks.find((c) => c.name === "handoff-causes");
  need(row, `doctor 面 handoff-causes 行缺席`);
  assert.equal(row.state, "ok");
});

rmSync(d, { recursive: true, force: true });

console.log(failures === 0 ? "F3 probe: ALL GREEN" : `F3 probe: ${failures} assertion(s) failed`);
process.exit(failures === 0 ? 0 : 1);
