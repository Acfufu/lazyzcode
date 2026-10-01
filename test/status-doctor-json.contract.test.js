// 观察面 JSON 契约（决策 #46，2026-10-01 grill；goal orch-discipline#N5）：
// status/doctor --json = 合法 JSON + schemaVersion 键；版本纪律=schemaVersion 只增不改、
// 未知字段消费者必须忽略、缺席字段不置 null（checks 条目仅 name/state/detail 三键）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli", "lzy.js");
const NODE = process.execPath;

function runJson(args, timeoutMs = 120_000) {
  const p = spawnSync(NODE, [CLI, ...args], { encoding: "utf8", shell: false, timeout: timeoutMs });
  return p;
}

function assertJsonContract(parsed, command) {
  assert.equal(parsed.schemaVersion, 1, "schemaVersion=1（现行唯一版）");
  assert.equal(parsed.command, command);
  assert.equal(typeof parsed.ok, "boolean");
  assert.ok(Array.isArray(parsed.checks) && parsed.checks.length > 0);
  for (const c of parsed.checks) {
    assert.equal(Object.keys(c).length, 3, "checks 条目恰 name/state/detail 三键（缺席不置 null）");
    assert.equal(typeof c.name, "string");
    assert.ok(["ok", "fail", "warn", "skip"].includes(c.state), `state 枚举：${c.state}`);
    assert.equal(typeof c.detail, "string");
  }
}

test("status --json：合法 JSON+契约形状（schemaVersion/command/ok/checks）", () => {
  const p = runJson(["status", "--json"]);
  // 退出码与宿主安装态相关（洁净 CI 容器无插件=fail 级合法）——本契约只断言输出形状，
  // 不断言退出码（阻塞发现 2d1ef623：硬断言 0 使 CI 洁净环境必败）。
  assert.ok(p.status === 0 || p.status === 1, `status 退出码 0/1（实得 ${p.status}）：${p.stderr?.slice(0, 200)}`);
  const parsed = JSON.parse(p.stdout); // 非法 JSON 直接抛=契约失败
  assertJsonContract(parsed, "status");
});

test("doctor --json：合法 JSON+契约形状", () => {
  const p = runJson(["doctor", "--json"]);
  assert.ok(p.status === 0 || p.status === 1, `doctor 退出码 0/1（环境相关 fail 级合法；实得 ${p.status}）`);
  const parsed = JSON.parse(p.stdout);
  assertJsonContract(parsed, "doctor");
});

test("文本面（无 --json）不含 schemaVersion——契约不泄漏进人读面", () => {
  const p = runJson(["status"]);
  assert.ok(!p.stdout.includes("schemaVersion"));
  assert.ok(p.stdout.includes("lzy status"));
});

test("未知旗标容忍是消费者侧规则（本仓消费者=契约测试只读三键）——缺席字段不置 null 断言", () => {
  const p = runJson(["status", "--json"]);
  const parsed = JSON.parse(p.stdout);
  // 顶层键集冻结（只增不改的现行基线：新增字段允许，本版恰四键）
  assert.deepEqual(Object.keys(parsed).sort(), ["checks", "command", "ok", "schemaVersion"]);
});
