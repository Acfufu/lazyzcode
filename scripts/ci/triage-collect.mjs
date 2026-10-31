import assert from "node:assert/strict";
import { readReportZip } from "./triage-zip.mjs";
import { repository, ciPath, positiveId, fullSha, validateRun, freshness, redact, sha256 } from "./triage-lib.mjs";

const failed = (item) => ["failure", "cancelled", "timed_out", "action_required", "startup_failure"].includes(item.conclusion);
const artifactPattern = /^(?:tests-(?:ubuntu|windows|macos)-latest|docs-links|sqlite-floor|package-build|package-smoke-(?:ubuntu|windows|macos)-latest-(?:24|24\.0\.0)|docs-build|workflow-check)-(\d+)$/;

export async function collect(api, runId, requestedAttempt, secrets = []) {
  positiveId(runId);
  const latest = await api(`/repos/${repository}/actions/runs/${runId}`);
  const attempt = positiveId(requestedAttempt || latest.run_attempt);
  const run = await api(`/repos/${repository}/actions/runs/${runId}/attempts/${attempt}`);
  const workflow = await api(`/repos/${repository}/actions/workflows/ci.yml`);
  validateRun(run, workflow, runId, attempt);
  assert.ok(Array.isArray(run.pull_requests) && run.pull_requests.length <= 1, "ambiguous PR association");
  const source = { repository, workflowId: workflow.id, workflowPath: ciPath, runId: run.id, attempt,
    event: run.event, conclusion: run.conclusion, headSha: fullSha(run.head_sha),
    url: `https://github.com/${repository}/actions/runs/${run.id}/attempts/${attempt}`, pr: null };
  if (run.event === "pull_request") {
    const pr = run.pull_requests[0];
    assert.ok(pr, "missing PR association");
    source.pr = { number: positiveId(pr.number), head: fullSha(pr.head.sha), base: fullSha(pr.base.sha) };
  }
  const packet = { schemaVersion: 1, source, createdAt: new Date().toISOString(), jobs: [], evidence: [],
    checkouts: [], limitations: [], freshness: await freshness(api, source) };
  const jobs = await api(`/repos/${repository}/actions/runs/${run.id}/attempts/${attempt}/jobs?per_page=100`);
  assert.ok(jobs.total_count <= 100 && jobs.jobs.length === jobs.total_count, "incomplete job listing");
  assert.equal(new Set(jobs.jobs.map((job) => job.id)).size, jobs.jobs.length, "duplicate jobs");
  let textBytes = 0;
  const add = (entry) => {
    const artifactLimit = entry.kind !== "job-log" && packet.evidence.length >= 24;
    if (artifactLimit || packet.evidence.length >= 40 || textBytes >= 64 * 1024) { packet.limitations.push("Evidence selection reached its input limit."); return; }
    const clean = redact(entry.text, secrets);
    const bytes = Buffer.from(clean); const text = bytes.subarray(0, Math.min(2048, 64 * 1024 - textBytes)).toString("utf8");
    textBytes += Buffer.byteLength(text);
    packet.evidence.push({ ...entry, id: `e${packet.evidence.length + 1}`, text, truncated: entry.truncated || bytes.length > Buffer.byteLength(text), sha256: sha256(text) });
  };
  const failing = jobs.jobs.filter(failed);
  for (const job of jobs.jobs) {
    positiveId(job.id); assert.equal(job.run_id, run.id); assert.equal(job.run_attempt, attempt); assert.equal(job.head_sha, run.head_sha);
    packet.jobs.push({ id: job.id, name: redact(job.name, secrets).slice(0, 200), conclusion: job.conclusion,
      failedSteps: (job.steps ?? []).filter(failed).map((step) => ({ number: step.number, name: redact(step.name, secrets).slice(0, 200), conclusion: step.conclusion })),
      url: `https://github.com/${repository}/actions/runs/${run.id}/job/${job.id}` });
  }
  const listing = await api(`/repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`);
  assert.ok(listing.total_count <= 100 && listing.artifacts.length === listing.total_count, "incomplete artifact listing");
  const reports = listing.artifacts.filter((artifact) => artifactPattern.exec(artifact.name)?.[1] === String(attempt));
  assert.equal(new Set(reports.map((a) => a.name)).size, reports.length, "ambiguous report artifacts");
  assert.ok(reports.length <= 12, "too many report artifacts");
  let downloads = 0;
  for (const artifact of reports) {
    positiveId(artifact.id);
    assert.equal(artifact.workflow_run?.id, run.id); assert.equal(artifact.workflow_run?.head_sha, run.head_sha);
    if (artifact.expired || Date.parse(artifact.expires_at) <= Date.now()) { packet.limitations.push(`Artifact ${artifact.id} expired.`); continue; }
    if (!Number.isFinite(artifact.size_in_bytes) || artifact.size_in_bytes > 5 * 1024 * 1024 || downloads + artifact.size_in_bytes > 20 * 1024 * 1024) {
      packet.limitations.push(`Artifact ${artifact.id} omitted by download limit.`); continue;
    }
    try {
      const bytes = await api(`/repos/${repository}/actions/artifacts/${artifact.id}/zip`, true);
      downloads += bytes.length; assert.ok(downloads <= 20 * 1024 * 1024, "total download limit");
      const members = readReportZip(bytes), validDirectories = new Set();
      for (const member of members.filter((m) => /(^|\/)identity\.json$/.test(m.name))) {
        const meta = JSON.parse(member.text);
        assert.equal(meta.repository, repository); assert.equal(String(meta.runId), String(run.id));
        assert.equal(String(meta.attempt), String(attempt)); assert.equal(meta.event, source.event);
        if (source.pr) { assert.equal(meta.prHead, source.pr.head); assert.equal(meta.prBase, source.pr.base); }
        else assert.equal(meta.checkoutSha, source.headSha);
        const directory = member.name.slice(0, -"identity.json".length);
        validDirectories.add(directory);
        packet.checkouts.push({ artifactId: artifact.id, directory, sha: fullSha(meta.checkoutSha), tree: fullSha(meta.checkoutTree), provenance: "untrusted CI report; identity fields matched" });
      }
      for (const member of members) {
        const directory = member.name.slice(0, member.name.lastIndexOf("/") + 1);
        if (!validDirectories.has(directory)) continue;
        if (/(^|\/)events\.jsonl$/.test(member.name)) {
          for (const [index, line] of member.text.split("\n").entries()) {
            if (!line.trim()) continue;
            const event = JSON.parse(line);
            if (event.type === "test:fail" && !event.data?.skip) add({ kind: "test-failure", artifactId: artifact.id, member: member.name, line: index + 1, text: line });
          }
        } else if (/(^|\/)result\.json$/.test(member.name)) {
          const result = JSON.parse(member.text);
          assert.equal(String(result.runId), String(run.id)); assert.equal(String(result.attempt), String(attempt));
          if (result.exitCode !== 0) add({ kind: "check-result", artifactId: artifact.id, member: member.name,
            text: JSON.stringify({ exitCode: result.exitCode, signal: result.signal, hasReports: result.hasReports, summaries: result.summaries }) });
        }
      }
    } catch (error) { packet.limitations.push(`Artifact ${artifact.id} unavailable or rejected: ${redact(error.message, secrets).slice(0, 160)}`); }
  }
  if (!packet.checkouts.length) packet.limitations.push("Actual checkout SHA/tree unavailable; run head SHA does not establish a tested merge tree.");
  // Artifact identity is self-reported. Neither it nor a model claim overrides API job identity.
  if (new Set(packet.checkouts.map((c) => `${c.sha}/${c.tree}`)).size > 1) packet.limitations.push("Conflicting checkout identities in untrusted reports.");
  for (const job of failing.slice(0, 5)) {
    try {
      const bytes = await api(`/repos/${repository}/actions/jobs/${job.id}/logs`, true);
      const lines = bytes.toString("utf8").split("\n"), markers = [];
      for (let i = 0; i < lines.length; i++) if (/##\[error\]|AssertionError|not ok |error:|timed? ?out|exception|cancelled/i.test(lines[i])) markers.push(i);
      const anchors = [...new Set([markers[0], markers.at(-1), lines.length - 1].filter((v) => v !== undefined))];
      // Separate windows prevent setup text from consuming the failure/tail allocation.
      for (const anchor of anchors) {
        const start = Math.max(0, anchor - 2), end = Math.min(lines.length, anchor + 4);
        add({ kind: "job-log", jobId: job.id, failedStepNumbers: (job.steps ?? []).filter(failed).map((s) => s.number),
          url: `https://github.com/${repository}/actions/runs/${run.id}/job/${job.id}`, truncated: end - start < lines.length || lines.slice(start, end).some((line) => line.length > 600),
          text: lines.slice(start, end).map((line, i) => `L${start + i + 1}: ${line.slice(0, 600)}`).join("\n") });
      }
    } catch (error) { packet.limitations.push(`Job ${job.id} log unavailable: ${redact(error.message, secrets).slice(0, 160)}`); }
  }
  if (failing.length > 5) packet.limitations.push("Only the first five failing jobs' logs were selected.");
  if (!packet.evidence.length) packet.limitations.push("No diagnostic evidence available; model must not be called.");
  packet.limitations = [...new Set(packet.limitations)].slice(0, 32);
  packet.freshness = await freshness(api, source);
  return JSON.parse(JSON.stringify(packet, (_key, value) => typeof value === "string" ? redact(value, secrets) : value));
}
