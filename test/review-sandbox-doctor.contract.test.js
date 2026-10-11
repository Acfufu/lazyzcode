import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import * as doctor from "../core/doctor.js";
import { reviewSandboxCapability } from "../core/review-sandbox.js";

const evidence = resolve(".omo/evidence/review-sandbox-doctor");
mkdirSync(evidence, { recursive: true });
const cli = resolve("cli/lzy.js");

function check(capability, residues) {
  const rows = [];
  assert.equal(typeof doctor.checkReviewSandbox, "function");
  doctor.checkReviewSandbox((name, state, detail) => rows.push({ name, state, detail }), evidence, {
    capability: () => capability,
    residues: () => residues,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "review-sandbox");
  return rows[0];
}

test("backend availability and unsupported platform are independent of other headless checks", () => {
  const supported = check({ available: true, backend: "macos-seatbelt", detail: "probe passed" }, []);
  assert.equal(supported.state, "ok");
  assert.match(supported.detail, /独立评审.*B/);
  const unsupported = check(reviewSandboxCapability({ platform: "win32" }), []);
  assert.equal(unsupported.state, "warn");
  assert.match(unsupported.detail, /裸启动/);
  assert.doesNotMatch(unsupported.detail, /所有.*headless.*不可用/);
  writeFileSync(join(evidence, "capability-cases.json"), JSON.stringify({ supported, unsupported }, null, 2));
});

test("active pending owner is normal; failed, dead pending and unknown require recovery", () => {
  const available = { available: true, backend: "test-only", detail: "fixture" };
  const active = check(available, [{ runId: "active.a0.r1", active: true, state: "pending", credentials: ["provider-config.sandbox.json"] }]);
  assert.equal(active.state, "ok");
  assert.doesNotMatch(active.detail, /lzy review cleanup/);
  const cases = [
    { runId: "failed.a0.r1", active: true, state: "failed", credentials: [] },
    { runId: "dead.a0.r1", active: false, state: "pending", credentials: ["provider-config.sandbox.json"] },
    { runId: "unknown.a0.r1", active: null, state: "unreadable", credentials: [] },
  ].map(residue => {
    const row = check(available, [residue]);
    assert.equal(row.state, "warn");
    assert.ok(row.detail.includes(`lzy review cleanup ${residue.runId}`));
    assert.doesNotMatch(row.detail, /provider-config\.sandbox\.json/);
    return row;
  });
  writeFileSync(join(evidence, "residue-cases.json"), JSON.stringify({ active, cases }, null, 2));
});

test("real doctor CLI JSON exposes dead-owner residue without reading or printing credential contents", () => {
  const cwd = join(evidence, "fixture-project");
  const home = join(evidence, "fixture-home");
  const runId = "fixture.a0.r1";
  const runDir = join(cwd, ".lazyzcode", "review", runId);
  mkdirSync(join(runDir, "home"), { recursive: true });
  mkdirSync(home, { recursive: true });
  const secret = "SYNTHETIC_CREDENTIAL_MUST_NOT_PRINT";
  writeFileSync(join(runDir, "home", "provider-config.sandbox.json"), secret);
  writeFileSync(join(runDir, "sandbox-cleanup.json"), JSON.stringify({ version: 1, ownerPid: 2147483647, state: "pending" }));
  const result = spawnSync(process.execPath, [cli, "doctor", "--json"], {
    cwd, encoding: "utf8", timeout: 30000,
    env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, LZY_ZCODE_ENGINE: join(home, "disabled-engine.cjs") },
  });
  writeFileSync(join(evidence, "doctor-cli.stdout.json"), result.stdout);
  writeFileSync(join(evidence, "doctor-cli.stderr.txt"), result.stderr || "(empty stderr)\n");
  assert.equal(result.error, undefined);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.schemaVersion, 1);
  const row = parsed.checks.find(x => x.name === "review-sandbox");
  assert.ok(row, "review-sandbox check must exist in real CLI JSON");
  assert.equal(row.state, "warn");
  assert.match(row.detail, /lzy review cleanup fixture\.a0\.r1/);
  assert.equal(result.stdout.includes(secret), false);
  assert.equal(row.detail.includes(runDir), false);
  assert.equal(readFileSync(join(runDir, "home", "provider-config.sandbox.json"), "utf8"), secret, "doctor is read-only");
  writeFileSync(join(evidence, "doctor-cli-observable.json"), JSON.stringify({ exitCode: result.status, schemaVersion: parsed.schemaVersion, row, secretOmitted: true, credentialPreserved: true }, null, 2));
});
