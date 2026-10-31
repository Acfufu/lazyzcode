import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  repository, canonicalCi, trustedSource, assertSameSource, resolveRelease, validateVersions,
  validateSmoke, verifyReleaseFiles, validateArtifact, artifactName, smokeTargets, digest,
} from "../scripts/ci/release-lib.mjs";

const sha = "a".repeat(40), tree = "b".repeat(40), other = "c".repeat(40);
const tag = "v1.2.3";
const run = {
  id: 10, workflow_id: 20, path: ".github/workflows/ci.yml", event: "push", head_branch: "main", head_sha: sha,
  repository: { full_name: repository }, head_repository: { full_name: repository },
  status: "completed", conclusion: "success", run_attempt: 2, html_url: "https://github.com/Acfufu/lazyzcode/actions/runs/10",
};
function fakeApi(overrides = {}) {
  const routes = {
    [`/git/ref/tags/${tag}`]: { ref: `refs/tags/${tag}`, object: { type: "commit", sha } },
    [`/compare/${sha}...main`]: { status: "ahead", merge_base_commit: { sha } },
    "/actions/workflows/ci.yml": { id: 20, path: run.path, state: "active" },
    [`/actions/workflows/20/runs?branch=main&event=push&head_sha=${sha}&per_page=100`]: { total_count: 1, workflow_runs: [run] },
    "/actions/runs/10": run,
    "/actions/runs/10/attempts/2/jobs?per_page=100": { total_count: 1, jobs: [{ id: 30, name: "CI Required", head_sha: sha, status: "completed", conclusion: "success" }] },
    ...overrides,
  };
  return async (path) => {
    assert.ok(path.startsWith(`/repos/${repository}`));
    const key = path.slice(`/repos/${repository}`.length);
    assert.ok(Object.hasOwn(routes, key), `unexpected request ${path}`);
    return structuredClone(routes[key]);
  };
}
test("trusted source resolves the exact release commit and canonical main attempt", async () => {
  const source = await trustedSource(fakeApi(), tag);
  assert.equal(source.sha, sha); assert.equal(source.ci.attempt, "2");
  assert.equal(source.ci.gateJobId, 30);
});
test("annotated tags peel to commits; retagging the same commit still invalidates the proof", async () => {
  const source = await trustedSource(fakeApi(), tag);
  const current = await trustedSource(fakeApi({
    [`/git/ref/tags/${tag}`]: { ref: `refs/tags/${tag}`, object: { type: "tag", sha: other } },
    [`/git/tags/${other}`]: { object: { type: "commit", sha } },
  }), tag);
  assert.equal(current.sha, sha);
  assert.throws(() => assertSameSource(source, current), /tagObjectSha drifted/);
  const retargeted = await resolveRelease(fakeApi({ [`/git/ref/tags/${tag}`]: { ref: `refs/tags/${tag}`, object: { type: "commit", sha: other } } }), tag);
  assert.throws(() => assertSameSource(source, { ...current, ...retargeted }), /drifted/);
});
for (const [name, patch] of Object.entries({
  "wrong SHA": { head_sha: other }, "PR event": { event: "pull_request" },
  "wrong branch": { head_branch: "dev" }, "wrong workflow": { workflow_id: 21 },
  "foreign source": { head_repository: { full_name: "someone/fork" } },
  failed: { conclusion: "failure" }, cancelled: { conclusion: "cancelled" }, pending: { status: "in_progress" },
})) test(`canonical CI rejects ${name}`, async () => {
  await assert.rejects(() => canonicalCi(fakeApi({ "/actions/runs/10": { ...run, ...patch } }), sha));
});
test("latest run failure cannot be replaced with an earlier success", async () => {
  const latest = { ...run, id: 11, conclusion: "failure" };
  await assert.rejects(() => canonicalCi(fakeApi({
    [`/actions/workflows/20/runs?branch=main&event=push&head_sha=${sha}&per_page=100`]: { total_count: 2, workflow_runs: [run, latest] },
    "/actions/runs/11": latest,
  }), sha), /not successful/);
});
test("a green latest main SHA cannot substitute for the requested SHA", async () => {
  await assert.rejects(() => canonicalCi(fakeApi({
    [`/actions/workflows/20/runs?branch=main&event=push&head_sha=${sha}&per_page=100`]: { total_count: 0, workflow_runs: [] },
  }), sha), /no unambiguous canonical/);
});
test("missing/skipped CI Required, incomplete results, and non-main ancestry fail closed", async () => {
  for (const jobs of [[], [{ name: "CI Required", head_sha: sha, status: "completed", conclusion: "skipped" }]]) {
    await assert.rejects(() => canonicalCi(fakeApi({ "/actions/runs/10/attempts/2/jobs?per_page=100": { total_count: jobs.length, jobs } }), sha));
  }
  await assert.rejects(() => trustedSource(fakeApi({ [`/compare/${sha}...main`]: { status: "diverged", merge_base_commit: { sha: other } } }), tag), /not in main/);
  await assert.rejects(() => canonicalCi(fakeApi({ "/actions/runs/10/attempts/2/jobs?per_page=100": { total_count: 2, jobs: [] } }), sha), /incomplete/);
});
test("a new canonical attempt invalidates an earlier source proof", async () => {
  const source = await trustedSource(fakeApi(), tag);
  assert.throws(() => assertSameSource(source, { ...source, ci: { ...source.ci, attempt: "3" } }), /attempt drifted/);
});

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "lzy-release-contract-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const put = (name, object) => writeFileSync(join(dir, name), JSON.stringify(object));
  const manifest = {
    schemaVersion: 1, kind: "unpublished-ci-candidate", name: "lazyzcode", version: "1.2.3", filename: "lazyzcode-1.2.3.tgz",
    repository, event: "workflow_dispatch", runId: "40", attempt: "1", checkoutSha: sha, checkoutTree: tree,
    sha256: digest("fixture bytes"), integrity: `sha512-${digest("fixture bytes", "sha512", "base64")}`,
  };
  writeFileSync(join(dir, manifest.filename), "fixture bytes"); put("manifest.json", manifest);
  mkdirSync(join(dir, "smoke"));
  const reports = smokeTargets.map(([os, node, platform]) => ({ os, node, result: {
    ...manifest, platform, node: node === "24" ? "v24.22.1" : "v24.0.0", result: "PASS",
    candidateSha256: manifest.sha256, candidateIntegrity: manifest.integrity, candidateVersion: manifest.version,
    candidateCheckoutSha: sha, candidateCheckoutTree: tree,
  } }));
  const smokeSha256 = {};
  for (const { os, node, result } of reports) {
    put(`smoke/${os}-${node}.json`, result);
    smokeSha256[`${os}-${node}`] = digest(readFileSync(join(dir, `smoke/${os}-${node}.json`)));
  }
  const now = Date.parse("2026-10-31T00:00:00Z");
  const release = {
    schemaVersion: 1, kind: "manual-release-candidate", source: { repository, tag, sha, tree, tagObjectSha: sha },
    runId: "40", attempt: "1", controllerSha: other,
    createdAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 86400_000).toISOString(),
    manifestSha256: digest(readFileSync(join(dir, "manifest.json"))), smokeSha256,
  };
  put("release.json", release);
  return { dir, manifest, reports, release, now, put };
}
test("sealed bundle binds all four results and rejects wrong SHA, expiry and corruption", (t) => {
  const f = fixture(t);
  assert.equal(verifyReleaseFiles(f.dir, tag, sha, f.now).manifest.sha256, f.manifest.sha256);
  assert.throws(() => verifyReleaseFiles(f.dir, tag, other, f.now), /unexpected release SHA/);
  assert.throws(() => verifyReleaseFiles(f.dir, tag, sha, f.now + 31 * 86400_000), /expired/);
  writeFileSync(join(f.dir, f.manifest.filename), "tampered");
  assert.throws(() => verifyReleaseFiles(f.dir, tag, sha, f.now), /tgz SHA256 mismatch/);
});
test("report mutation and manifest mutation invalidate sealed receipt hashes", (t) => {
  const f = fixture(t);
  f.put("smoke/ubuntu-latest-24.json", { result: "PASS" });
  assert.throws(() => verifyReleaseFiles(f.dir, tag, sha, f.now), /smoke receipt digest/);
  f.put("manifest.json", { ...f.manifest, checkoutSha: other });
  assert.throws(() => verifyReleaseFiles(f.dir, tag, sha, f.now), /manifest digest/);
});
test("smoke results reject omitted, duplicate, skipped, foreign-run and wrong-floor receipts", (t) => {
  const { manifest, reports } = fixture(t);
  for (const mutation of [
    (r) => r.pop(), (r) => { r[0] = r[1]; }, (r) => { r[0].result.result = "SKIP"; },
    (r) => { r[0].result.runId = "39"; }, (r) => { r[0].result.attempt = "2"; },
    (r) => { r[3].result.node = "v24.22.1"; }, (r) => { r[0].result.candidateSha256 = "wrong"; },
  ]) {
    const changed = structuredClone(reports); mutation(changed);
    assert.throws(() => validateSmoke(manifest, changed));
  }
});
test("downloaded artifact rejects expiry, wrong attempt, PR, and foreign controller", () => {
  const workflowRun = { ...run, path: ".github/workflows/release-candidate.yml", event: "workflow_dispatch" };
  const artifact = { name: artifactName(tag, run.id, run.run_attempt), expired: false, expires_at: "2099-01-01T00:00:00Z", workflow_run: { id: run.id, head_sha: run.head_sha } };
  validateArtifact(artifact, workflowRun, tag);
  for (const changed of [ { ...artifact, expired: true }, { ...artifact, expires_at: "2020-01-01" }, { ...artifact, name: artifactName(tag, run.id, 1) }, { ...artifact, workflow_run: { id: 11, head_sha: sha } } ]) {
    assert.throws(() => validateArtifact(changed, workflowRun, tag));
  }
  assert.throws(() => validateArtifact(artifact, { ...workflowRun, event: "pull_request" }, tag));
});
test("version triad, marketplace ref, and a shadowing sha must agree with the tag", (t) => {
  const { dir, put } = fixture(t);
  mkdirSync(join(dir, "plugin/.zcode-plugin"), { recursive: true }); mkdirSync(join(dir, ".claude-plugin"));
  put("package.json", { name: "lazyzcode", version: "1.2.3" });
  put("plugin/.zcode-plugin/plugin.json", { version: "1.2.3" });
  const entry = { name: "lazyzcode", version: "1.2.3", source: { source: "github", repo: repository, path: "plugin", ref: tag } };
  put(".claude-plugin/marketplace.json", { plugins: [entry] });
  assert.equal(validateVersions(dir, { tag, sha }), "1.2.3");
  for (const source of [{ ...entry.source, ref: "v1.2.2" }, { ...entry.source, sha: other }]) {
    put(".claude-plugin/marketplace.json", { plugins: [{ ...entry, source }] });
    assert.throws(() => validateVersions(dir, { tag, sha }));
  }
});
