import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { collect } from "./triage-collect.mjs";
import { analyze, pilotAllowance, promptHash, prepareRequest } from "./triage-model.mjs";
import { githubClient, freshness, redact, sha256, summary, fullSha } from "./triage-lib.mjs";

const [runId, outArg, attempt] = process.argv.slice(2);
const out = resolve(outArg ?? "artifacts/ci-triage");
mkdirSync(out, { recursive: true });
const secrets = [process.env.GH_TOKEN, process.env.TRIAGE_MODEL_API_KEY];
const save = (name, value) => writeFileSync(join(out, name), `${JSON.stringify(value, (_key, field) => typeof field === "string" ? redact(field, secrets) : field, 2)}\n`);
const receipt = { schemaVersion: 1, kind: "advisory-ci-triage", status: "STARTED", startedAt: new Date().toISOString(),
  controllerSha: process.env.GITHUB_SHA ?? null, controllerRunId: process.env.GITHUB_RUN_ID ?? null,
  controllerAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null, promptHash, requests: 0, usage: null, diagnosis: null };
receipt.persist = () => save("diagnosis.json", receipt);
try {
  assert.ok(runId, "usage: node scripts/ci/triage.mjs <run-id> [output-dir] [attempt]");
  if (process.env.GITHUB_ACTIONS === "true") {
    assert.equal(process.env.GITHUB_REPOSITORY, "Acfufu/lazyzcode");
    assert.equal(process.env.GITHUB_REF, "refs/heads/main");
    assert.equal(process.env.GITHUB_EVENT_NAME, "workflow_dispatch");
    fullSha(process.env.GITHUB_SHA);
  }
  const api = githubClient(process.env.GH_TOKEN);
  const packet = await collect(api, runId, attempt, secrets);
  save("input.json", packet);
  receipt.source = packet.source; receipt.freshness = packet.freshness;
  receipt.inputHash = sha256(JSON.stringify(packet)); receipt.limitations = packet.limitations;
  if (process.env.TRIAGE_ENABLE_MODEL !== "true") {
    receipt.status = "COLLECTED";
    receipt.modelStatus = "NOT_RUN: collection-only mode";
  } else {
    receipt.status = "BLOCKED";
    const config = JSON.parse(readFileSync(new URL("../../.github/ci-triage-model.json", import.meta.url), "utf8"));
    prepareRequest(packet, config);
    assert.equal(process.env.GITHUB_ACTIONS, "true", "paid model calls require serialized Actions pilot accounting");
    receipt.pilot = await pilotAllowance(api, process.env.GITHUB_RUN_ID, process.env.GITHUB_RUN_ATTEMPT);
    receipt.diagnosis = await analyze(packet, config, process.env.TRIAGE_MODEL_API_KEY, receipt);
  }
  receipt.freshness = await freshness(api, packet.source);
  receipt.status = receipt.diagnosis ? "ANALYZED" : "COLLECTED";
  receipt.candidateStatus = receipt.freshness.historical || receipt.freshness.attemptDrift ? "HISTORICAL" : "CURRENT_AT_RECHECK";
} catch (error) {
  receipt.status = receipt.requests ? "FAILED" : "BLOCKED";
  receipt.error = redact(error.message, secrets).slice(0, 400);
  process.exitCode = 1;
} finally {
  receipt.finishedAt = new Date().toISOString();
  receipt.persist();
  const rendered = summary(receipt, secrets);
  writeFileSync(join(out, "summary.md"), rendered);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, rendered);
  console.log(`CI triage: ${receipt.status}; ${receipt.requests} model request(s).`);
}
