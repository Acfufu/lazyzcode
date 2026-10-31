import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const repository = "Acfufu/lazyzcode";
export const releaseWorkflow = ".github/workflows/release-candidate.yml";
export const smokeTargets = [
  ["ubuntu-latest", "24", "linux"], ["windows-latest", "24", "win32"],
  ["macos-latest", "24", "darwin"], ["ubuntu-latest", "24.0.0", "linux"],
];
export const digest = (bytes, algorithm = "sha256", encoding = "hex") => createHash(algorithm).update(bytes).digest(encoding);
export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
export function releaseTag(tag) {
  assert.match(tag, /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "expected a release tag v<version>");
  return tag.slice(1);
}
export function fullSha(sha) {
  assert.match(sha, /^[0-9a-f]{40}$/, "expected a full commit SHA");
  return sha;
}
export function apiClient(token = process.env.GH_TOKEN) {
  return async (path) => {
    assert.ok(path.startsWith(`/repos/${repository}/`), "unexpected API repository");
    const response = await fetch(`https://api.github.com${path}`, {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(30_000), redirect: "error",
    });
    assert.ok(response.ok, `GitHub API ${path}: HTTP ${response.status}`);
    return response.json();
  };
}
export async function resolveRelease(api, tag) {
  releaseTag(tag);
  const ref = await api(`/repos/${repository}/git/ref/tags/${tag}`);
  assert.equal(ref.ref, `refs/tags/${tag}`);
  const tagObjectSha = fullSha(ref.object.sha);
  let object = ref.object;
  for (let depth = 0; object.type === "tag" && depth < 5; depth++) {
    const annotated = await api(`/repos/${repository}/git/tags/${fullSha(object.sha)}`);
    object = annotated.object;
  }
  assert.equal(object.type, "commit", "tag must resolve to a commit within five hops");
  return { tag, tagObjectSha, sha: fullSha(object.sha) };
}
export async function canonicalCi(api, sha) {
  fullSha(sha);
  const workflow = await api(`/repos/${repository}/actions/workflows/ci.yml`);
  assert.equal(workflow.path, ".github/workflows/ci.yml");
  assert.equal(workflow.state, "active");
  // Do not filter by success: a newer failed or in-progress run supersedes an old green.
  const listing = await api(`/repos/${repository}/actions/workflows/${workflow.id}/runs?branch=main&event=push&head_sha=${sha}&per_page=100`);
  assert.ok(listing.total_count > 0 && listing.total_count <= 100, "no unambiguous canonical main CI for this SHA");
  assert.equal(listing.workflow_runs.length, listing.total_count, "incomplete CI listing");
  const latest = [...listing.workflow_runs].sort((a, b) => b.id - a.id)[0];
  const run = await api(`/repos/${repository}/actions/runs/${latest.id}`);
  assert.equal(run.head_sha, sha, "CI SHA mismatch");
  assert.equal(run.workflow_id, workflow.id, "CI workflow mismatch");
  assert.equal(run.path, workflow.path);
  assert.equal(run.event, "push");
  assert.equal(run.head_branch, "main");
  assert.equal(run.repository.full_name, repository);
  assert.equal(run.head_repository.full_name, repository);
  assert.equal(run.status, "completed", "canonical CI is not completed");
  assert.equal(run.conclusion, "success", "canonical CI is not successful");
  assert.ok(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0);
  const jobs = await api(`/repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
  assert.equal(jobs.jobs.length, jobs.total_count, "incomplete CI jobs");
  const gate = jobs.jobs.filter((job) => job.name === "CI Required");
  assert.equal(gate.length, 1, "exactly one CI Required job is required");
  assert.equal(gate[0].head_sha, sha);
  assert.equal(gate[0].status, "completed");
  assert.equal(gate[0].conclusion, "success");
  return { runId: String(run.id), attempt: String(run.run_attempt), workflowId: workflow.id, sha, url: run.html_url, gateJobId: gate[0].id };
}
export async function trustedSource(api, tag) {
  const source = await resolveRelease(api, tag);
  const comparison = await api(`/repos/${repository}/compare/${source.sha}...main`);
  assert.ok(["ahead", "identical"].includes(comparison.status), "release commit is not in main history");
  assert.equal(comparison.merge_base_commit.sha, source.sha, "release commit is not a main ancestor");
  return { ...source, repository, ci: await canonicalCi(api, source.sha) };
}
export function assertSameSource(expected, current) {
  for (const key of ["repository", "tag", "tagObjectSha", "sha"]) assert.equal(current[key], expected[key], `source ${key} drifted`);
  for (const key of ["runId", "attempt", "workflowId", "sha", "gateJobId"]) assert.equal(current.ci[key], expected.ci[key], `canonical CI ${key} drifted`);
}
export function validateVersions(root, source) {
  const pkg = readJson(join(root, "package.json"));
  const plugin = readJson(join(root, "plugin/.zcode-plugin/plugin.json"));
  const entries = readJson(join(root, ".claude-plugin/marketplace.json")).plugins.filter((entry) => entry.name === "lazyzcode");
  assert.equal(entries.length, 1);
  const market = entries[0];
  assert.equal(pkg.name, "lazyzcode");
  for (const version of [pkg.version, plugin.version, market.version]) assert.equal(version, releaseTag(source.tag), "release version triad/tag mismatch");
  assert.equal(market.source.source, "github");
  assert.equal(market.source.repo, repository);
  assert.equal(market.source.path, "plugin");
  assert.equal(market.source.ref, source.tag, "marketplace ref/tag mismatch");
  if (market.source.sha !== undefined) assert.equal(market.source.sha, source.sha, "marketplace sha shadows tag");
  return pkg.version;
}
export function validateManifest(dir, source) {
  const manifest = readJson(join(dir, "manifest.json"));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.kind, "unpublished-ci-candidate");
  assert.equal(manifest.name, "lazyzcode");
  assert.equal(manifest.version, releaseTag(source.tag));
  assert.equal(manifest.repository, repository);
  assert.equal(manifest.event, "workflow_dispatch");
  assert.equal(manifest.checkoutSha, source.sha, "package SHA mismatch");
  fullSha(manifest.checkoutTree);
  assert.match(manifest.runId, /^\d+$/);
  assert.match(manifest.attempt, /^\d+$/);
  assert.equal(manifest.filename, `lazyzcode-${manifest.version}.tgz`);
  const bytes = readFileSync(join(dir, manifest.filename));
  assert.equal(digest(bytes), manifest.sha256, "tgz SHA256 mismatch");
  assert.equal(`sha512-${digest(bytes, "sha512", "base64")}`, manifest.integrity, "tgz SRI mismatch");
  return manifest;
}
export function validateSmoke(manifest, reports) {
  assert.equal(reports.length, smokeTargets.length, "four installation results required");
  for (const [os, node, platform] of smokeTargets) {
    const matches = reports.filter((entry) => entry.os === os && entry.node === node);
    assert.equal(matches.length, 1, `missing or duplicate installation target ${os}/${node}`);
    const report = matches[0].result;
    assert.equal(report.result, "PASS", `${os}/${node} did not pass`);
    assert.equal(report.platform, platform);
    if (node === "24.0.0") assert.equal(report.node, "v24.0.0");
    else assert.match(report.node, /^v24\./);
    for (const key of ["repository", "event", "runId", "attempt", "checkoutSha", "checkoutTree"]) assert.equal(report[key], manifest[key], `smoke ${key} differs`);
    assert.equal(report.candidateCheckoutSha, manifest.checkoutSha);
    assert.equal(report.candidateCheckoutTree, manifest.checkoutTree);
    assert.equal(report.candidateSha256, manifest.sha256);
    assert.equal(report.candidateIntegrity, manifest.integrity);
    assert.equal(report.candidateVersion, manifest.version);
  }
}
export function verifyReleaseFiles(dir, tag, sha, now = Date.now()) {
  releaseTag(tag); fullSha(sha);
  const release = readJson(join(dir, "release.json"));
  assert.equal(release.schemaVersion, 1);
  assert.equal(release.kind, "manual-release-candidate");
  assert.equal(release.source.tag, tag);
  assert.equal(release.source.sha, sha, "unexpected release SHA");
  assert.equal(release.source.repository, repository);
  assert.ok(Number.isFinite(Date.parse(release.createdAt)) && Date.parse(release.createdAt) <= now, "invalid creation time");
  assert.ok(Date.parse(release.expiresAt) > now && Date.parse(release.expiresAt) <= Date.parse(release.createdAt) + 30 * 86400_000, "release artifact expired or invalid expiry");
  assert.equal(digest(readFileSync(join(dir, "manifest.json"))), release.manifestSha256, "manifest digest mismatch");
  const manifest = validateManifest(dir, release.source);
  assert.equal(manifest.runId, release.runId);
  assert.equal(manifest.attempt, release.attempt);
  assert.equal(manifest.checkoutTree, release.source.tree);
  const reports = smokeTargets.map(([os, node]) => ({ os, node, result: readJson(join(dir, "smoke", `${os}-${node}.json`)) }));
  for (const report of reports) assert.equal(digest(readFileSync(join(dir, "smoke", `${report.os}-${report.node}.json`))), release.smokeSha256[`${report.os}-${report.node}`], "smoke receipt digest mismatch");
  validateSmoke(manifest, reports);
  assert.deepEqual(readdirSync(dir).sort(), [manifest.filename, "manifest.json", "release.json", "smoke"].sort(), "unexpected release bundle members");
  return { release, manifest };
}
export function artifactName(tag, runId, attempt) {
  releaseTag(tag);
  assert.match(String(runId), /^\d+$/); assert.match(String(attempt), /^\d+$/);
  return `release-candidate-${tag}-${runId}-${attempt}`;
}
export function validateArtifact(artifact, run, tag, now = Date.now()) {
  assert.equal(run.event, "workflow_dispatch");
  assert.equal(run.head_branch, "main");
  assert.equal(run.path, releaseWorkflow);
  assert.equal(run.repository.full_name, repository);
  assert.equal(run.head_repository.full_name, repository);
  assert.equal(run.status, "completed"); assert.equal(run.conclusion, "success");
  assert.equal(artifact.name, artifactName(tag, run.id, run.run_attempt));
  assert.equal(artifact.expired, false, "GitHub artifact expired");
  assert.ok(Date.parse(artifact.expires_at) > now, "GitHub artifact expired");
  assert.equal(artifact.workflow_run.id, run.id);
  assert.equal(artifact.workflow_run.head_sha, run.head_sha, "artifact controller SHA mismatch");
}
