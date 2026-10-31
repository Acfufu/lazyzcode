import assert from "node:assert/strict";
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  apiClient, repository, trustedSource, assertSameSource, validateVersions, validateManifest,
  validateSmoke, verifyReleaseFiles, artifactName, validateArtifact, smokeTargets, digest, readJson,
} from "./release-lib.mjs";

const [command, ...args] = process.argv.slice(2);
let api;
const save = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const run = (bin, argv, options = {}) => {
  const result = spawnSync(bin, argv, { encoding: "utf8", timeout: 180_000, maxBuffer: 8 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `${bin} failed: ${result.error?.message ?? ""}\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  return result.stdout.trim();
};
const installation = (dir, tag, sha, out) => run(process.execPath, [fileURLToPath(new URL("package-smoke.mjs", import.meta.url)), dir, out, "--release", tag, sha]);

async function verifyLive(dir, tag, sha) {
  const verified = verifyReleaseFiles(dir, tag, sha);
  assertSameSource(verified.release.source, await trustedSource(api, tag));
  const workflowRun = await api(`/repos/${repository}/actions/runs/${verified.release.runId}`);
  const listing = await api(`/repos/${repository}/actions/runs/${workflowRun.id}/artifacts?per_page=100`);
  assert.equal(listing.artifacts.length, listing.total_count, "incomplete release artifact listing");
  const matches = listing.artifacts.filter((artifact) => artifact.name === artifactName(tag, workflowRun.id, workflowRun.run_attempt));
  assert.equal(matches.length, 1, "release artifact is missing or ambiguous");
  validateArtifact(matches[0], workflowRun, tag);
  assert.equal(String(workflowRun.run_attempt), verified.release.attempt, "release run attempt drifted");
  assert.equal(workflowRun.head_sha, verified.release.controllerSha);
  // Local hashes alone do not authenticate a receipt: compare against the exact live artifact.
  const reference = mkdtempSync(join(tmpdir(), "lzy-release-reference-"));
  try {
    run("gh", ["run", "download", String(workflowRun.id), "--repo", repository, "--name", matches[0].name, "--dir", reference]);
    for (const file of ["release.json", "manifest.json", verified.manifest.filename, ...smokeTargets.map(([os, node]) => `smoke/${os}-${node}.json`)]) {
      assert.ok(readFileSync(join(dir, file)).equals(readFileSync(join(reference, file))), `local bundle differs from GitHub artifact: ${file}`);
    }
  } finally { rmSync(reference, { recursive: true, force: true }); }
  return verified;
}

try {
  let token = process.env.GH_TOKEN;
  if (!token && process.env.GITHUB_ACTIONS !== "true") token = run("gh", ["auth", "token"]);
  api = apiClient(token);
  if (command === "prepare") {
    assert.equal(args.length, 2, "prepare <tag> <proof.json>");
    if (process.env.GITHUB_ACTIONS === "true") {
      assert.equal(process.env.GITHUB_REPOSITORY, repository);
      assert.equal(process.env.GITHUB_EVENT_NAME, "workflow_dispatch");
      assert.equal(process.env.GITHUB_REF, "refs/heads/main", "dispatch must use main");
    }
    const source = await trustedSource(api, args[0]);
    save(resolve(args[1]), source);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `sha=${source.sha}\ntag=${source.tag}\n`);
    console.log(JSON.stringify(source, null, 2));
  } else if (command === "check-source") {
    assert.equal(args.length, 2, "check-source <source-dir> <proof.json>");
    const root = resolve(args[0]), source = readJson(args[1]);
    assert.equal(run("git", ["rev-parse", "HEAD"], { cwd: root }), source.sha, "checkout SHA mismatch");
    assert.equal(run("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root }), "", "release source is dirty");
    validateVersions(root, source);
    assertSameSource(source, await trustedSource(api, source.tag));
    console.log(`Validated frozen source ${source.tag}@${source.sha}`);
  } else if (command === "seal") {
    assert.equal(args.length, 3, "seal <proof.json> <candidate-dir> <smoke-artifacts-dir>");
    const source = readJson(args[0]), dir = resolve(args[1]), reportsDir = resolve(args[2]);
    assertSameSource(source, await trustedSource(api, source.tag));
    const manifest = validateManifest(dir, source);
    assert.equal(manifest.runId, process.env.GITHUB_RUN_ID);
    assert.equal(manifest.attempt, process.env.GITHUB_RUN_ATTEMPT);
    assert.equal(process.env.GITHUB_REF, "refs/heads/main");
    const smokeSha256 = {};
    mkdirSync(join(dir, "smoke"));
    const reports = smokeTargets.map(([os, node]) => {
      const path = join(reportsDir, `release-smoke-${os}-${node}-${manifest.attempt}`, "result.json");
      const bytes = readFileSync(path);
      smokeSha256[`${os}-${node}`] = digest(bytes);
      copyFileSync(path, join(dir, "smoke", `${os}-${node}.json`));
      return { os, node, result: JSON.parse(bytes) };
    });
    validateSmoke(manifest, reports);
    const now = Date.now();
    save(join(dir, "release.json"), {
      schemaVersion: 1, kind: "manual-release-candidate", source: { ...source, tree: manifest.checkoutTree },
      controllerSha: process.env.GITHUB_SHA, runId: manifest.runId, attempt: manifest.attempt,
      createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 30 * 86400_000).toISOString(),
      manifestSha256: digest(readFileSync(join(dir, "manifest.json"))), smokeSha256,
    });
    verifyReleaseFiles(dir, source.tag, source.sha);
    const name = artifactName(source.tag, manifest.runId, manifest.attempt);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `artifact=${name}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `## Manual release candidate\n\nTag: ${source.tag}\n\nSource: ${source.sha}\n\nCanonical CI: ${source.ci.url} (attempt ${source.ci.attempt})\n\nSHA256: ${manifest.sha256}\n\nIntegrity: ${manifest.integrity}\n\nFour isolated installation checks passed. Artifact: ${name} (30 days). No npm publication performed.\n`);
    console.log(name);
  } else if (command === "download") {
    assert.equal(args.length, 4, "download <run-id> <tag> <expected-full-sha> <empty-dir>");
    const [runId, tag, sha, target] = args;
    assert.match(runId, /^\d+$/);
    const dir = resolve(target);
    mkdirSync(dir, { recursive: true });
    assert.equal(readdirSync(dir).length, 0, "download directory must be empty");
    const workflowRun = await api(`/repos/${repository}/actions/runs/${runId}`);
    const listing = await api(`/repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`);
    assert.equal(listing.artifacts.length, listing.total_count, "incomplete release artifact listing");
    const name = artifactName(tag, runId, workflowRun.run_attempt);
    const artifacts = listing.artifacts.filter((artifact) => artifact.name === name);
    assert.equal(artifacts.length, 1, "release artifact missing or ambiguous");
    validateArtifact(artifacts[0], workflowRun, tag);
    run("gh", ["run", "download", runId, "--repo", repository, "--name", name, "--dir", dir]);
    const { manifest } = await verifyLive(dir, tag, sha);
    console.log(`Verified original tgz: ${join(dir, manifest.filename)}\nSHA256: ${manifest.sha256}\nRun verify immediately before publishing; never repack.`);
  } else if (command === "verify") {
    assert.equal(args.length, 3, "verify <candidate-dir> <tag> <expected-full-sha>");
    const [target, tag, sha] = args, dir = resolve(target);
    const { manifest } = await verifyLive(dir, tag, sha);
    const report = `${dir}-manual-smoke`;
    console.log(installation(dir, tag, sha, report));
    console.log(`Verified original tgz: ${join(dir, manifest.filename)}\nSHA256: ${manifest.sha256}\nIntegrity: ${manifest.integrity}`);
  } else if (command === "registry") {
    assert.equal(args.length, 4, "registry <candidate-dir> <tag> <expected-full-sha> <dist-tag>");
    const [target, tag, sha, distTag] = args, dir = resolve(target);
    assert.match(distTag, /^[A-Za-z][A-Za-z0-9._-]*$/);
    const { manifest, release } = await verifyLive(dir, tag, sha);
    const get = async (url) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000), redirect: "error" });
      assert.ok(response.ok, `registry read failed: HTTP ${response.status}`);
      return response;
    };
    const metadata = await (await get(`https://registry.npmjs.org/lazyzcode/${manifest.version}`)).json();
    const tags = await (await get("https://registry.npmjs.org/-/package/lazyzcode/dist-tags")).json();
    assert.equal(metadata.name, manifest.name); assert.equal(metadata.version, manifest.version);
    assert.equal(tags[distTag], manifest.version, "registry dist-tag differs");
    assert.equal(metadata.dist.integrity, manifest.integrity, "registry integrity differs");
    const url = new URL(metadata.dist.tarball);
    assert.equal(url.origin, "https://registry.npmjs.org");
    const bytes = Buffer.from(await (await get(url)).arrayBuffer());
    assert.equal(digest(bytes), manifest.sha256, "registry tarball SHA256 differs");
    assert.equal(`sha512-${digest(bytes, "sha512", "base64")}`, manifest.integrity);
    assert.equal(digest(bytes, "sha1"), metadata.dist.shasum, "registry shasum differs");
    const out = `${dir}-registry`;
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, manifest.filename), bytes);
    // The downloaded bytes are equal to the original tested tgz. Install that identical file via
    // the sealed bundle to retain its source identity, file manifest and payload assertions.
    console.log(installation(dir, tag, sha, join(out, "smoke")));
    save(join(out, "registry.json"), { result: "PASS", checkedAt: new Date().toISOString(), source: release.source, version: metadata.version, distTag, dist: metadata.dist, sha256: digest(bytes), installation: readJson(join(out, "smoke/result.json")) });
    console.log(`Registry bytes and isolated installation verified: ${out}`);
  } else {
    throw new Error("Expected prepare, check-source, seal, download, verify or registry (see docs/release-checklist.md)");
  }
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
}
