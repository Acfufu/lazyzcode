// swe1 声称完成判读契约（docs/reviews/2026-swe1-preregistration.md §指标）：
// detectClaimMarker 的宽松/严格两口径、大小写敏感、末个标记行胜出、角色过滤由调用方承担。
// 零依赖零网络零引擎（node:test 家法）；本文件不读账号状态（债 G 家法）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectClaimMarker } from "../scripts/ablation/extract-metrics.mjs";

const SLUG = "x07-strict-ledger-line-parser";

test("末个标记行胜出且宽松口径 claimed=true", () => {
  const texts = [
    "working on it…\nTASK COMPLETE: some-other-task",
    "done.\nTASK COMPLETE: x07-strict-ledger-line-parser",
  ];
  const d = detectClaimMarker(texts, SLUG);
  assert.equal(d.claimed, true);
  assert.equal(d.value, "x07-strict-ledger-line-parser");
  assert.equal(d.slugMatch, true);
});

test("slug 拼错：claimed 仍 true（宽松），slugMatch=false（严格审计位）", () => {
  const d = detectClaimMarker(["all finished\nTASK COMPLETE: x07-strict-ledger-parser"], SLUG);
  assert.equal(d.claimed, true);
  assert.equal(d.slugMatch, false);
});

test("小写 task complete 不是标记（大小写敏感，预注册字面量）", () => {
  const d = detectClaimMarker(["i am done, task complete: x07-strict-ledger-line-parser"], SLUG);
  assert.equal(d.claimed, false);
  assert.equal(d.value, null);
});

test("标记行内嵌句中不命中（须行首可选空白起头）", () => {
  const d = detectClaimMarker(["the line TASK COMPLETE: x was quoted in my summary"], SLUG);
  assert.equal(d.claimed, false);
});

test("空/null 文本与空 slug：不炸且 claimed=false / slugMatch=false", () => {
  assert.deepEqual(detectClaimMarker([], SLUG), { claimed: false, value: null, slugMatch: false });
  assert.equal(detectClaimMarker([null, undefined, ""], SLUG).claimed, false);
  const noSlug = detectClaimMarker(["\tTASK COMPLETE: anything"], "");
  assert.equal(noSlug.claimed, true);
  assert.equal(noSlug.slugMatch, false);
});

test("多行文本中标记行在行中段也可命中（^ 多行旗标）", () => {
  const d = detectClaimMarker(["summary:\n- a\n- b\nTASK COMPLETE: x09-foo-bar-baz\n (trailing)"], "x09-foo-bar-baz");
  assert.equal(d.claimed, true);
  assert.equal(d.value, "x09-foo-bar-baz");
});
