import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeRequired } from "../scripts/ci/required-gate.mjs";

for (const result of ["success", "failure", "cancelled", "skipped", undefined]) {
  test(`required gate: upstream ${result ?? "missing"}`, () => {
    assert.equal(judgeRequired({ a: { result: "success" }, b: { result } }, ["a", "b"]).ok, result === "success");
  });
}
test("required gate rejects absent jobs and an empty requirement set", () => {
  assert.equal(judgeRequired({}, ["a"]).ok, false);
  assert.equal(judgeRequired({}, []).ok, false);
});
