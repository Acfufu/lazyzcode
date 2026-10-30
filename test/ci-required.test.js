import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeRequired } from "../scripts/ci/required-gate.mjs";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("..", import.meta.url));
const wrapper = join(root, "scripts/ci/run-checks.mjs");

for (const result of ["success", "failure", "cancelled", "skipped", undefined]) {
  test(`required gate: upstream ${result ?? "missing"}`, () => {
    assert.equal(judgeRequired({ a: { result: "success" }, b: { result } }, ["a", "b"]).ok, result === "success");
  });
}
test("required gate rejects absent jobs and an empty requirement set", () => {
  assert.equal(judgeRequired({}, ["a"]).ok, false);
  assert.equal(judgeRequired({}, []).ok, false);
});

test("recorded script preserves exit 7 and retains identity, output and result", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "lzy-ci-script-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fixture = join(dir, "failure.mjs"), out = join(dir, "out");
  writeFileSync(fixture, 'console.error("fixture probe failure");process.exit(7);');
  const r = spawnSync(process.execPath, [wrapper, out, "--script", fixture], { cwd: root, encoding: "utf8", timeout: 30_000 });
  assert.equal(r.status, 7, r.stdout + r.stderr);
  assert.equal(JSON.parse(readFileSync(join(out, "result.json"))).exitCode, 7);
  assert.match(JSON.parse(readFileSync(join(out, "identity.json"))).checkoutSha, /^[a-f0-9]{40}$/);
  assert.match(readFileSync(join(out, "command.log"), "utf8"), /fixture probe failure/);
});

test("recorded test failure stays red with JUnit and a named skip reason", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "lzy-ci-tests-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fixture = join(dir, "failure.test.mjs"), out = join(dir, "out");
  writeFileSync(fixture, 'import {test} from "node:test";test("intentional failure",()=>{throw new Error("fixture failure")});test("named skip",{skip:"fixture capability absent"},()=>{});');
  const r = spawnSync(process.execPath, [wrapper, out, fixture], { cwd: root, encoding: "utf8", timeout: 30_000 });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const result = JSON.parse(readFileSync(join(out, "result.json")));
  assert.equal(result.exitCode, 1);
  assert.ok(result.skips.some(({ name, reason }) => name === "named skip" && reason === "fixture capability absent"));
  assert.match(readFileSync(join(out, "junit.xml"), "utf8"), /failure/);
  assert.match(readFileSync(join(out, "tests.log"), "utf8"), /fixture failure/);
});
