// 交付状态机契约测试（0.3.0 M4，拍板 1/4/8）：intents.json 校验和四层 fail-closed+单调护栏；
// 状态机转移表全矩阵（done 恒终/acting·unknown 先读回/failed·refused 重试）；delivery 契约
// endpoint 匹配校验；check-runs 裁决矩阵；siteUrl 构造；status 读面。全 core 注入面，
// 无外部 spawn——win32 安全。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DELIVERY_VERSION,
  assertTransition,
  checkRunsVerdict,
  deliveryStatus,
  loadIntents,
  saveIntents,
  siteUrlOf,
  validateDeliveryContract,
} from "../core/delivery.js";

function scratch(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("①intents 读写回环+校验和四层 fail-closed（ENOENT=缺席/JSON 损坏/校验和不符/版本不识别）", () => {
  const d = scratch("lzy-dstate-1-");
  try {
    assert.equal(loadIntents(d), null, "家族缺位=缺席（非错误）");
    saveIntents(d, { lastSeq: 1, intents: [{ id: "d1", endpoint: "B", kind: "merge-chain", target: { repo: "o/r" }, plannedArgv: [], status: "intended", attempts: [], observed: null, createdAt: "t", updatedAt: "t" }] });
    const s = loadIntents(d);
    assert.equal(s.lastSeq, 1);
    assert.equal(s.intents[0].id, "d1");
    const p = join(d, ".lazyzcode", "delivery", "intents.json");
    // JSON 损坏
    writeFileSync(p, "{not json");
    assert.throws(() => loadIntents(d), /JSON 解析失败/);
    // 校验和不符（内容改、checksum 未随）——损坏文件手工修复（写护栏拒覆写不可读账本，
    // saveIntents 不通；writeFileSync 直接落合法字节）
    const good = { schemaVersion: DELIVERY_VERSION, lastSeq: 1, intents: [{ id: "d1", endpoint: "B", kind: "merge-chain", target: { repo: "o/r" }, plannedArgv: [], status: "intended", attempts: [], observed: null, createdAt: "t", updatedAt: "t" }] };
    const goodWithChecksum = { ...good, checksum: createHash("sha256").update(JSON.stringify(good)).digest("hex") };
    writeFileSync(p, JSON.stringify(goodWithChecksum));
    assert.doesNotThrow(() => loadIntents(d));
    const obj = JSON.parse(readFileSync(p, "utf8"));
    obj.intents[0].status = "done";
    writeFileSync(p, JSON.stringify(obj));
    assert.throws(() => loadIntents(d), /校验和不符/);
    // 版本不识别（重算合法校验和但版本错）
    const payload = JSON.parse(readFileSync(p, "utf8"));
    delete payload.checksum;
    payload.schemaVersion = 999;
    writeFileSync(p, JSON.stringify({ ...payload, checksum: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }));
    assert.throws(() => loadIntents(d), /版本不兼容/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("②单调写护栏：lastSeq 回退拒落盘", () => {
  const d = scratch("lzy-dstate-2-");
  try {
    saveIntents(d, { lastSeq: 5, intents: [] });
    assert.throws(() => saveIntents(d, { lastSeq: 4, intents: [] }), /单调|lastSeq/);
    saveIntents(d, { lastSeq: 6, intents: [] });
    assert.equal(loadIntents(d).lastSeq, 6);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("③状态机转移表全矩阵：合法通路+非法转移拒（done 恒终）", () => {
  const legal = [
    ["intended", "acting"], ["acting", "done"], ["acting", "failed"], ["acting", "refused"], ["acting", "unknown"],
    ["unknown", "done"], ["unknown", "intended"], ["unknown", "failed"],
    ["failed", "acting"], ["failed", "intended"], ["refused", "acting"], ["refused", "intended"],
    ["intended", "done"], ["intended", "failed"], // readback 观察外部事实
    ["failed", "done"], ["refused", "done"], // 迟来事实（他因已合并/既成事实）经读回收束
  ];
  for (const [a, b] of legal) assert.doesNotThrow(() => assertTransition(a, b), `${a}→${b} 应合法`);
  const illegal = [
    ["done", "acting"], ["done", "intended"], ["done", "unknown"], ["done", "failed"],
    ["intended", "unknown"], ["unknown", "acting"], ["unknown", "refused"],
  ];
  for (const [a, b] of illegal) assert.throws(() => assertTransition(a, b), `${a}→${b} 应拒`);
});

test("④delivery 契约校验：endpoint 匹配过/不匹配拒/坏文件拒/版本常量", () => {
  const d = scratch("lzy-dstate-4-");
  try {
    writeFileSync(join(d, "cb.md"), "task: t\nendpoint: B\nscope: .\nrecipe: none\n\n- [A1] x\n");
    writeFileSync(join(d, "cc.md"), "task: t\nendpoint: C\nscope: .\nrecipe: none\n\n- [A1] x\n");
    const b = validateDeliveryContract(d, "B", join(d, "cb.md"));
    assert.match(b.hash, /^[0-9a-f]{64}$/);
    assert.equal(b.task, "t");
    assert.throws(() => validateDeliveryContract(d, "C", join(d, "cb.md")), /endpoint 不匹配/);
    assert.throws(() => validateDeliveryContract(d, "B", join(d, "cc.md")), /endpoint 不匹配/);
    assert.throws(() => validateDeliveryContract(d, "B", join(d, "缺.md")), /契约无效|不可读/);
    assert.equal(DELIVERY_VERSION, 1);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑤check-runs 裁决矩阵：零 run=未开始/全绿/有败/未完", () => {
  assert.deepEqual(checkRunsVerdict([]), { present: false, completed: false, ok: false, bad: [], pending: 0 });
  const ok = checkRunsVerdict([{ name: "a", status: "COMPLETED", conclusion: "SUCCESS" }, { name: "b", status: "COMPLETED", conclusion: "NEUTRAL" }]);
  assert.equal(ok.ok, true);
  const bad = checkRunsVerdict([{ name: "a", status: "COMPLETED", conclusion: "FAILURE" }]);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.bad, ["a:FAILURE"]);
  const pend = checkRunsVerdict([{ name: "a", status: "IN_PROGRESS", conclusion: null }]);
  assert.equal(pend.completed, false);
  assert.equal(pend.pending, 1);
});

test("⑥siteUrlOf：slug 小写构造+非法 slug 拒", () => {
  assert.equal(siteUrlOf("Acfufu/lazyzcode"), "https://acfufu.github.io/lazyzcode/");
  assert.throws(() => siteUrlOf("nonsense"), /repo slug 非法/);
});

test("⑦status 读面：无 goal 目录=静默对象不抛", () => {
  const d = scratch("lzy-dstate-7-");
  try {
    const s = deliveryStatus(d);
    assert.equal(s.goal, null);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
