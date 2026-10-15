// 分级保证契约测试（ADR-0038 修订节，2026-10-11 拍板 C）：os-sandbox tier 须双条件
// （Seatbelt 探针过∧个人 key 腿在场）；缺一自动降级 app-layer（0.5.0 形态），运行档
// isolation {level, backend} 如实记档；配置错误（env 在场不可读）仍 fail-closed 拒不降级。
// 红半=artifacts/review-tiering-20261011/red-half.json（现行码 OAuth-only 落 invalid 档）。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { runReview, BASELINE_DUTY_ID, ReviewPreflightError } from "../core/review.js";
import { testReviewSandbox } from "./helpers/review-sandbox-stub.js";

const evidence = resolve(".omo/evidence/review-isolation-tier");
mkdirSync(evidence, { recursive: true });

const PASS = { duty: BASELINE_DUTY_ID, verdict: "pass", findings: [], summary: "clean" };
const fence = (obj) => "```json\n" + JSON.stringify(obj) + "\n```";
const metered = async () => ({ absent: false, unpriced: [], points: 0.5, usage: [] });
const noLedger = () => false; // a1.r12 F-1：测试不写真实用量账本

function fixture() {
  const d = mkdtempSync(join(tmpdir(), "lzy-tier-"));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@t"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "hello\n");
  mkdirSync(join(d, ".lazyzcode", "loop"), { recursive: true });
  writeFileSync(join(d, ".lazyzcode", "loop", "goal.json"), JSON.stringify({ version: 2, slug: "tier", title: "t", status: "executing", attempt: 1, tier: "light", risk: "low", policy: { schemaVersion: 1 }, contract: null, subjects: [], steps: [] }));
  g(["add", "-A"]);
  g(["commit", "-qm", "i"]);
  return d;
}

// 可观测 spawn 替身：捕获收到的 args（tier 断言面），转录写入 findTranscript 命中路径
function observingSpawn() {
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    const { cwd, home } = args;
    mkdirSync(join(home, ".zcode", "cli", "rollout"), { recursive: true });
    writeFileSync(join(home, ".zcode", "cli", "rollout", "model-io-sess_tier.jsonl"), JSON.stringify({ tool: { file_path: join(cwd, "a.txt") } }) + "\n");
    return { ok: true, exitCode: 0, signal: null, timedOut: false, durationMs: 5, stdout: fence(PASS) + "\n" + JSON.stringify({ sessionId: "sess_tier", response: fence(PASS) }) + "\n", stderr: "", response: fence(PASS), sessionId: "sess_tier" };
  };
  return { calls, fn };
}

function setPersonalEnv(value) {
  const prev = process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE;
  if (value === undefined) delete process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE;
  else process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = value;
  return () => {
    if (prev === undefined) delete process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE;
    else process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = prev;
  };
}

test("OAuth-only（无个人 key 腿）自动落 app-layer tier：无 Seatbelt/launcher，运行档如实记档", async () => {
  const d = fixture();
  const restore = setPersonalEnv(undefined);
  const { calls, fn } = observingSpawn();
  try {
    const r = await runReview(d, { deps: { preflight: async () => ({ budget: null }), spawnHeadless: fn, querySessionPoints: metered, appendUsage: noLedger } });
    assert.equal(r.record.isolation.level, "app-layer");
    assert.equal(r.record.isolation.backend, null);
    assert.equal(r.record.sandbox, null); // 无沙盒面（0.5.0 形态）
    assert.equal(r.record.validity.status, "valid");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].launcher, undefined); // 无 Seatbelt 包装
    assert.equal(calls[0].baseEnv, undefined); // 不换基环境（宿主 env 继承＝envAuth 通道）
    assert.equal(calls[0].processTree, undefined);
    assert.equal(calls[0].extraEnv, null); // provider env 缺席＝BUILTIN/OAuth env 继承（0.5.0 同形）
    assert.ok(r.record.transcript); // 非 B 级转录定位（findTranscript 分支）命中
    writeFileSync(join(evidence, "app-layer-record.json"), JSON.stringify({ isolation: r.record.isolation, sandbox: r.record.sandbox, validity: r.record.validity, metering: r.record.metering.status }, null, 2));
  } finally {
    restore();
    rmSync(d, { recursive: true, force: true });
  }
});

test("deps.prepareSandbox 注入＝os-sandbox tier：isolation 记注入 backend，sandbox 面在档", async () => {
  const d = fixture();
  const restore = setPersonalEnv(undefined); // 宿主 shell 可能带着个人 provider env——测试显式钉空
  const { calls, fn } = observingSpawn();
  try {
    const r = await runReview(d, { deps: { preflight: async () => ({ budget: null }), spawnHeadless: fn, querySessionPoints: metered, prepareSandbox: testReviewSandbox, appendUsage: noLedger } });
    assert.equal(r.record.isolation.level, "os-sandbox");
    assert.equal(r.record.isolation.backend, "injected");
    assert.ok(r.record.sandbox && r.record.sandbox.level === "test");
    assert.equal(r.record.validity.status, "valid");
  } finally {
    restore();
    rmSync(d, { recursive: true, force: true });
  }
});

test("有 key 腿但无 OS 后端 → app-layer tier（不再拒启动；key 配置仍以 env 透传隔离 HOME）", async () => {
  const d = fixture();
  const cfgPath = join(mkdtempSync(join(tmpdir(), "lzy-tier-cfg-")), "personal-provider.json"); // 仓外——进仓即脏树拒
  writeFileSync(cfgPath, JSON.stringify({ config: { providerConfigRules: { providerRules: [{ providerId: "tier-leg", enabled: true, config: { apiKey: "synthetic-key-not-real", api: { baseUrl: "https://api.example.invalid/v1" } } }] } } }));
  const prevAllow = process.env.LZY_SANDBOX_PROVIDERS;
  process.env.LZY_SANDBOX_PROVIDERS = "tier-leg";
  const restore = setPersonalEnv(cfgPath);
  const { calls, fn } = observingSpawn();
  try {
    const r = await runReview(d, {
      deps: {
        preflight: async () => ({ budget: null }),
        spawnHeadless: fn,
        querySessionPoints: metered,
        sandboxCapability: () => ({ available: false, backend: null, detail: "fixture: 无 OS 后端" }),
      },
    });
    assert.equal(r.record.isolation.level, "app-layer");
    assert.equal(r.record.sandbox, null);
    assert.equal(r.record.validity.status, "valid");
    assert.equal(typeof calls[0].extraEnv?.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE, "string"); // 白名单副本进隔离 HOME（0.5.0 既有行为）
    assert.ok(!calls[0].extraEnv.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE.includes("personal-provider.json")); // 副本非原路径
  } finally {
    restore();
    if (prevAllow === undefined) delete process.env.LZY_SANDBOX_PROVIDERS;
    else process.env.LZY_SANDBOX_PROVIDERS = prevAllow;
    rmSync(d, { recursive: true, force: true });
    rmSync(join(cfgPath, ".."), { recursive: true, force: true });
  }
});

test("provider env 在场但不可读仍 fail-closed 拒（不降级 app-layer）", async () => {
  const d = fixture();
  const restore = setPersonalEnv(join(d, "nonexistent-provider.json"));
  try {
    await assert.rejects(
      () => runReview(d, { deps: { preflight: async () => ({ budget: null }), spawnHeadless: observingSpawn().fn, querySessionPoints: metered } }),
      (e) => e instanceof ReviewPreflightError && e.reason === "provider-config-unreadable",
    );
  } finally {
    restore();
    rmSync(d, { recursive: true, force: true });
  }
});
