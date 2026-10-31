import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { repository, triagePath, positiveId, boundedBody, sha256, validateDiagnosis } from "./triage-lib.mjs";

export const prompt = readFileSync(new URL("triage-prompt.txt", import.meta.url), "utf8");
export const promptHash = sha256(prompt);

export function prepareRequest(packet, config) {
  assert.equal(config.enabled, true, "model configuration disabled");
  assert.equal(config.protocol, "chat-completions");
  assert.equal(config.compatibilityVerified, true, "provider token bound and protocol must be verified before enabling");
  const endpoint = new URL(config.endpoint);
  assert.ok(endpoint.protocol === "https:" && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash && !endpoint.port, "invalid model HTTPS endpoint");
  assert.equal(endpoint.pathname.endsWith("/chat/completions"), true);
  assert.match(config.model, /^[A-Za-z0-9._:/-]{1,120}$/);
  assert.match(config.pricingCheckedAt, /^\d{4}-\d{2}-\d{2}$/);
  const age = Date.now() - Date.parse(config.pricingCheckedAt);
  assert.ok(age >= -86400_000 && age <= 30 * 86400_000, "model pricing review expired");
  for (const key of ["inputUsdPerMillion", "outputUsdPerMillion"]) assert.ok(Number.isFinite(config[key]) && config[key] > 0, "model prices required");
  assert.equal(config.tokenBound, "utf8-bytes-plus-4096");
  assert.ok(Number.isSafeInteger(config.maxCompletionTokens) && config.maxCompletionTokens >= 512 && config.maxCompletionTokens <= 4096);
  assert.ok(packet.evidence.length > 0, "no evidence; refusing model call");
  const input = JSON.stringify(packet);
  assert.ok(Buffer.byteLength(input) <= 80 * 1024, "model input byte limit");
  // Requires a verified byte-level tokenizer and <=4096 tokens of message framing.
  // No retries: reserve the entire request's upper bound even if the provider times out.
  const inputTokenBound = Buffer.byteLength(prompt) + Buffer.byteLength(input) + 4096;
  const reservedUsd = (inputTokenBound * config.inputUsdPerMillion + config.maxCompletionTokens * config.outputUsdPerMillion) / 1e6;
  assert.ok(reservedUsd <= 0.50, "request exceeds US$0.50 worst-case reservation");
  return { endpoint: endpoint.href, inputTokenBound, reservedUsd, inputHash: sha256(input),
    body: { model: config.model, messages: [{ role: "system", content: prompt }, { role: "user", content: input }],
      max_completion_tokens: config.maxCompletionTokens, response_format: { type: "json_object" }, stream: false } };
}

export async function pilotAllowance(api, currentId, currentAttempt) {
  const workflow = await api(`/repos/${repository}/actions/workflows/ci-triage.yml`);
  assert.equal(workflow.path, triagePath);
  const current = await api(`/repos/${repository}/actions/runs/${positiveId(currentId)}`);
  assert.equal(current.id, positiveId(currentId)); assert.equal(current.workflow_id, workflow.id);
  assert.equal(current.path, triagePath); assert.equal(current.repository?.full_name, repository);
  assert.equal(current.run_attempt, positiveId(currentAttempt));
  assert.equal(current.run_attempt, 1, "paid reruns forbidden; dispatch a new diagnosis");
  assert.equal(current.head_branch, "main"); assert.equal(current.event, "workflow_dispatch");
  const attempts = positiveId(current.run_number);
  // run_number increases for each new workflow run and is unaffected by reruns.
  // Unlike counting retained history, deleting an old run cannot replenish this limit.
  assert.ok(attempts <= 20, "pilot exhausted: 20 dispatches reserve US$10; maintenance review required");
  return { workflowId: workflow.id, attempts, maxAttempts: 20, reservedPerAttemptUsd: 0.50, lifetimeReservedUsd: attempts * 0.50 };
}

export async function analyze(packet, config, key, receipt, fetcher = fetch) {
  assert.ok(typeof key === "string" && key.length > 0, "TRIAGE_MODEL_API_KEY missing");
  const request = prepareRequest(packet, config);
  assert.ok(receipt.pilot?.attempts > 0 && receipt.pilot.attempts <= 20, "pilot allowance required");
  Object.assign(receipt, { status: "REQUESTED", requests: 1, modelRequested: config.model, promptHash,
    inputHash: request.inputHash, reservedUsd: request.reservedUsd, inputTokenBound: request.inputTokenBound,
    pricing: { inputUsdPerMillion: config.inputUsdPerMillion, outputUsdPerMillion: config.outputUsdPerMillion, checkedAt: config.pricingCheckedAt },
    usage: null, costUsd: null, accounting: "Full reservation retained until a validated usage response is available." });
  // Persist the reservation before any request. A lost/invalid response never means zero cost.
  receipt.persist?.();
  const response = await fetcher(request.endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(120_000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(request.body) });
  receipt.httpStatus = response.status;
  assert.ok(response.ok, `model HTTP ${response.status}`);
  const value = JSON.parse((await boundedBody(response, 128 * 1024)).toString("utf8"));
  receipt.modelReported = value.model ?? null;
  const usage = value.usage;
  assert.ok(usage && Number.isSafeInteger(usage.prompt_tokens) && usage.prompt_tokens > 0 &&
    Number.isSafeInteger(usage.completion_tokens) && usage.completion_tokens >= 0, "model usage missing/invalid");
  receipt.usage = { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens };
  receipt.costUsd = (usage.prompt_tokens * config.inputUsdPerMillion + usage.completion_tokens * config.outputUsdPerMillion) / 1e6;
  receipt.persist?.();
  assert.ok(usage.prompt_tokens <= request.inputTokenBound && usage.completion_tokens <= config.maxCompletionTokens, "provider exceeded verified token bounds");
  assert.equal(value.model, config.model, "response model differs from reviewed model");
  assert.equal(value.choices?.length, 1, "one completion required");
  const choice = value.choices[0];
  assert.equal(choice.finish_reason, "stop", "incomplete model response");
  assert.ok(!choice.message?.tool_calls && !choice.message?.function_call, "model attempted tool call");
  const diagnosis = validateDiagnosis(JSON.parse(choice.message.content), packet);
  receipt.accounting = "Usage validated; listed prices used without cache discounts.";
  receipt.status = "ANALYZED";
  return diagnosis;
}
