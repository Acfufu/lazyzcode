import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const repository = "Acfufu/lazyzcode";
export const ciPath = ".github/workflows/ci.yml";
export const triagePath = ".github/workflows/ci-triage.yml";
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const positiveId = (value) => { assert.match(String(value), /^[1-9]\d{0,14}$/); assert.ok(Number.isSafeInteger(Number(value))); return Number(value); };
export const fullSha = (value) => { assert.match(value, /^[a-f0-9]{40}$/); return value; };
export function redact(value, secrets = []) {
  let text = String(value);
  for (const secret of secrets.filter((v) => typeof v === "string" && v.length > 3)) text = text.split(secret).join("[REDACTED]");
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{10,}|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{10,})\b/g, "[REDACTED]")
    .replace(/((?:authorization|api[_-]?key|access[_-]?token|password|secret)\s*[=:]\s*)(?:Bearer\s+)?[^\s,;]+/gi, "$1[REDACTED]");
}
export async function boundedBody(response, limit) {
  const reader = response.body?.getReader();
  assert.ok(reader, "response body missing");
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; assert.ok(size <= limit, "response exceeds byte limit"); chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}
export function githubClient(token, fetcher = fetch) {
  const deadline = AbortSignal.timeout(180_000);
  return async (path, download = false) => {
    assert.ok(path.startsWith(`/repos/${repository}/`) && !path.includes(".."), "unexpected API path");
    const options = { redirect: "manual", signal: AbortSignal.any([deadline, AbortSignal.timeout(30_000)]) };
    let response = await fetcher(`https://api.github.com${path}`, { ...options, headers: {
      Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}),
    } });
    if (download && response.status === 302) {
      const url = new URL(response.headers.get("location"));
      assert.ok(url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") &&
        [".blob.core.windows.net", ".actions.githubusercontent.com"].some((suffix) => url.hostname.endsWith(suffix)), "untrusted download redirect");
      // Credentials are intentionally absent on the signed storage request.
      response = await fetcher(url.href, options);
    }
    assert.ok(response.ok, `GitHub API HTTP ${response.status}`);
    const bytes = await boundedBody(response, download ? 5 * 1024 * 1024 : 2 * 1024 * 1024);
    return download ? bytes : JSON.parse(bytes.toString("utf8"));
  };
}
export function validateRun(run, workflow, runId, attempt) {
  assert.equal(run.id, positiveId(runId), "wrong run ID");
  assert.equal(run.repository?.full_name, repository, "foreign repository");
  assert.equal(run.head_repository?.full_name, repository, "fork source unsupported");
  assert.equal(workflow.path, ciPath); assert.equal(run.workflow_id, workflow.id, "wrong workflow ID");
  assert.equal(run.path, ciPath); assert.equal(run.run_attempt, positiveId(attempt), "wrong attempt");
  assert.equal(run.status, "completed", "run still in progress");
  assert.ok(["failure", "cancelled", "timed_out", "action_required", "startup_failure"].includes(run.conclusion), "run is not a failure/cancellation");
  assert.ok((run.event === "push" && run.head_branch === "main") || run.event === "pull_request", "unsupported event/branch");
  fullSha(run.head_sha);
}
export async function freshness(api, source) {
  const latest = await api(`/repos/${repository}/actions/runs/${source.runId}`);
  assert.equal(latest.repository?.full_name, repository);
  assert.equal(latest.workflow_id, source.workflowId); assert.equal(latest.head_sha, source.headSha);
  const result = { latestAttempt: latest.run_attempt, attemptDrift: latest.run_attempt !== source.attempt, historical: false };
  if (source.pr) {
    const pr = await api(`/repos/${repository}/pulls/${source.pr.number}`);
    assert.equal(pr.base?.repo?.full_name, repository);
    assert.equal(pr.head?.repo?.full_name, repository, "fork PR unsupported");
    result.currentPrHead = fullSha(pr.head.sha);
    result.historical = pr.state !== "open" || pr.head.sha !== source.pr.head || pr.base.sha !== source.pr.base;
  } else {
    result.currentMain = fullSha((await api(`/repos/${repository}/git/ref/heads/main`)).object.sha);
    result.historical = result.currentMain !== source.headSha;
  }
  return result;
}
export function validateDiagnosis(value, packet) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), ["facts", "hypotheses", "limitations", "status"].sort());
  assert.ok(["hypotheses", "insufficient_evidence"].includes(value.status));
  const text = (v, limit = 2000) => { assert.ok(typeof v === "string" && v.length > 0 && v.length <= limit, "invalid diagnosis text"); };
  const evidence = (refs) => {
    assert.ok(Array.isArray(refs) && refs.length > 0 && refs.length <= 5, "evidence references required");
    for (const ref of refs) {
      assert.deepEqual(Object.keys(ref).sort(), ["id", "quote"]);
      const source = packet.evidence.find((entry) => entry.id === ref.id);
      text(ref.quote, 500); assert.ok(source && source.text.includes(ref.quote), "invented evidence reference/quote");
    }
  };
  assert.ok(Array.isArray(value.facts) && value.facts.length <= 8);
  for (const fact of value.facts) { assert.deepEqual(Object.keys(fact).sort(), ["evidence", "statement"]); text(fact.statement); evidence(fact.evidence); }
  assert.ok(Array.isArray(value.hypotheses) && value.hypotheses.length <= 3);
  for (const h of value.hypotheses) {
    assert.deepEqual(Object.keys(h).sort(), ["confidence", "evidence", "expectedResult", "missingEvidence", "nextCheck", "statement"].sort());
    for (const key of ["statement", "missingEvidence", "nextCheck", "expectedResult"]) text(h[key]);
    assert.ok(["low", "medium", "high"].includes(h.confidence)); evidence(h.evidence);
  }
  assert.ok(value.status !== "hypotheses" || value.hypotheses.length > 0);
  assert.ok(value.status !== "insufficient_evidence" || value.hypotheses.length === 0);
  assert.ok(Array.isArray(value.limitations) && value.limitations.length <= 8);
  value.limitations.forEach((v) => text(v));
  return value;
}
export function summary(receipt, secrets = []) {
  const escaped = JSON.stringify(receipt, (_key, value) => typeof value === "string" ? redact(value, secrets) : value, 2)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `## CI failure diagnosis (advisory)\n\nModel statements require human verification. Suggested checks were not executed.\n\n<pre>${escaped}</pre>\n`;
}
