// 沙盒 provider 白名单 + 明烧落账契约测试（0.5.0，2026-10-02 commandcode 暗烧案收口面）。
// 被测面=core/review.js filterProviderConfig/prepareSandboxProviderConfig（白名单纯函数 +
// env 覆盖落盘）+ runReview 接线（extraEnv 到 spawn / metering.usage 归并 / 全局落账）。
// 家法：纯函数喂 canned 配置（CI 零依赖）+ runReview 全 deps 注入（拍板 11 先例）；落账
// 目录经 HOME 覆盖隔离（queue-metering 先例）——绝不写真实 ~/.zcode/cli/lzy-usage。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import {
  BASELINE_DUTY_ID,
  ReviewPreflightError,
  filterProviderConfig,
  prepareSandboxProviderConfig,
  runReview,
} from "../core/review.js";

const FENCE = (obj) => "```json\n" + JSON.stringify(obj) + "\n```";
const PASS = { duty: BASELINE_DUTY_ID, verdict: "pass", findings: [], summary: "clean" };
const preflightStub = async () => ({ budget: null });

// canned 个人 provider 配置（引擎 providerConfigRules 形状，腿取本机实见六形态）
const RULE = (id, { enabled = true, key = "user_testkey123" } = {}) => ({
  providerId: id,
  providerName: id,
  enabled,
  config: {
    ...(key ? { access: { apiKey: key } } : {}),
    api: { baseUrl: `https://example.invalid/${id}` },
    personalModelIds: null,
    modelOrder: null,
  },
});
const BASE_CONFIG = () => ({
  schemaVersion: 1,
  config: {
    providerConfigRules: {
      providerRules: [
        RULE("oauth-leg", { enabled: true, key: null }), // enabled 无 key（账号腿）→ 剔
        RULE("cmdcode", {}), // enabled+key → 留（providerOrder 首位保序）
        RULE("glm-leg", { enabled: true }), // enabled+key → 留
        RULE("disabled-key", { enabled: false }), // 禁用+key → 剔（key 不得进沙盒）
        RULE("disabled-naked", { enabled: false, key: null }), // 禁用无 key → 剔
      ],
    },
    providerOrder: ["oauth-leg", "cmdcode", "glm-leg", "disabled-key", "missing"],
    modelConfigRules: {
      providerModelRules: [
        { providerId: "cmdcode", modelId: "deepseek/x", config: { enabled: true } },
        { providerId: "disabled-key", modelId: "m/y", config: { enabled: true } }, // 腿被剔→规则陪葬
      ],
      manualProviderModelRules: [{ providerId: "glm-leg", modelId: "glm/z", config: {} }],
    },
  },
});

test("filterProviderConfig：只留 enabled+key 腿、providerOrder 保序重写、modelConfigRules 陪葬过滤", () => {
  const out = filterProviderConfig(BASE_CONFIG());
  assert.ok(out, "合法结构须产出过滤结果");
  const ids = out.config.providerConfigRules.providerRules.map((r) => r.providerId);
  assert.deepEqual(ids, ["cmdcode", "glm-leg"], "剔 OAuth 腿与禁用腿，保序");
  // 被剔腿的 key 不得出现在白名单产物（隔离面的核心：key 暴露面收窄）
  const blob = JSON.stringify(out);
  assert.ok(!blob.includes("disabled-key"), "禁用腿连同 key 整体不进产物");
  assert.deepEqual(out.config.providerOrder, ["cmdcode", "glm-leg"], "providerOrder 重写（含 unknown id 剔除）");
  assert.deepEqual(out.config.modelConfigRules.providerModelRules, [{ providerId: "cmdcode", modelId: "deepseek/x", config: { enabled: true } }]);
  assert.deepEqual(out.config.modelConfigRules.manualProviderModelRules, [{ providerId: "glm-leg", modelId: "glm/z", config: {} }]);
  assert.equal(out.schemaVersion, 1, "config 之外的顶层键原样保留");
});

test("filterProviderConfig：结构不可识别 fail-open 返 null（同旧行为，不新增失败面）", () => {
  assert.equal(filterProviderConfig(null), null);
  assert.equal(filterProviderConfig({}), null);
  assert.equal(filterProviderConfig({ config: {} }), null);
  assert.equal(filterProviderConfig({ config: { providerConfigRules: { providerRules: "not-array" } } }), null);
});

test("prepareSandboxProviderConfig：env 在场→白名单落盘隔离 home 并返回覆盖 env；env 缺席/不可读→null", () => {
  const home = mkdtempSync(join(tmpdir(), "lzy-sbx-home-"));
  const dir = mkdtempSync(join(tmpdir(), "lzy-sbx-cfg-"));
  const saved = process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE;
  try {
    // env 缺席 → null（BUILTIN-only 机器零新增失败面）
    delete process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE;
    assert.equal(prepareSandboxProviderConfig(home), null);
    // env 在场 → 专属配置落 home 内、只含白名单腿
    const realPath = join(dir, "provider_config.json");
    writeFileSync(realPath, JSON.stringify(BASE_CONFIG()));
    process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = realPath;
    const env = prepareSandboxProviderConfig(home);
    assert.ok(env && env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE.startsWith(home), "覆盖路径须在隔离 home 内");
    const filtered = JSON.parse(readFileSync(env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE, "utf8"));
    assert.deepEqual(
      filtered.config.providerConfigRules.providerRules.map((r) => r.providerId),
      ["cmdcode", "glm-leg"],
    );
    // 非 JSON 文件 → fail-open null
    writeFileSync(realPath, "not-json{");
    assert.equal(prepareSandboxProviderConfig(home), null);
  } finally {
    if (saved === undefined) delete process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE;
    else process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = saved;
    rmSync(home, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prepareSandboxProviderConfig：白名单为空=前置型拒（no-sandbox-provider，零消耗不 spawn）", () => {
  const home = mkdtempSync(join(tmpdir(), "lzy-sbx-home-"));
  const dir = mkdtempSync(join(tmpdir(), "lzy-sbx-cfg-"));
  const saved = process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE;
  try {
    const realPath = join(dir, "provider_config.json");
    writeFileSync(realPath, JSON.stringify({
      schemaVersion: 1,
      config: { providerConfigRules: { providerRules: [RULE("oauth-leg", { enabled: true, key: null })] }, providerOrder: ["oauth-leg"] },
    }));
    process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = realPath;
    assert.throws(
      () => prepareSandboxProviderConfig(home),
      (e) => e instanceof ReviewPreflightError && e.reason === "no-sandbox-provider",
    );
  } finally {
    if (saved === undefined) delete process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE;
    else process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = saved;
    rmSync(home, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── runReview 接线（deps 注入家法，review-runtime 同构 fixture） ──

const CONTRACT = "task: t\nendpoint: A\nscope: .\nrecipe: none\nbudget-ref: none\n\n- [A1] x\n";

function fixture({ attempt = 1 } = {}) {
  const d = mkdtempSync(join(tmpdir(), "lzy-sbx-run-"));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@t"]);
  g(["config", "user.name", "t"]);
  g(["config", "core.autocrlf", "false"]);
  writeFileSync(join(d, "a.txt"), "hello\n");
  writeFileSync(join(d, "contract.md"), CONTRACT);
  mkdirSync(join(d, ".lazyzcode", "loop"), { recursive: true });
  writeFileSync(
    join(d, ".lazyzcode", "loop", "goal.json"),
    JSON.stringify({
      version: 2, slug: "fx", title: "fixture", status: "executing", attempt, tier: "light", risk: "low",
      policy: { schemaVersion: 1 },
      contract: { path: "contract.md", contractHash: "c".repeat(64) }, subjects: [],
      steps: [{ id: "N1", kind: "N", title: "do", status: "done", note: "did", acceptsRefs: [] }],
    }),
  );
  g(["add", "-A"]);
  g(["commit", "-qm", "init"]);
  return d;
}

const METERED_WITH_USAGE = {
  absent: false,
  unpriced: [],
  points: 42,
  usage: [
    { provider: "new-provider", model: "deepseek/deepseek-v4.1-flash", inputTokens: 100, cacheReadTokens: 50, outputTokens: 7, points: 41.8 },
    { provider: "new-provider", model: "deepseek/deepseek-v4.1-flash", inputTokens: 10, cacheReadTokens: 0, outputTokens: 0, points: 0.2 }, // 跨会话同行
  ],
};

test("runReview 接线：白名单 extraEnv 进 spawn、metering.usage 跨会话归并落档、全局落账落 HOME 隔离目录", async () => {
  const home = mkdtempSync(join(tmpdir(), "lzy-sbx-home-"));
  const cfgDir = mkdtempSync(join(tmpdir(), "lzy-sbx-cfg-"));
  const ledgerHome = mkdtempSync(join(tmpdir(), "lzy-sbx-ledger-"));
  const savedEnv = process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE;
  const savedHome = process.env.HOME;
  const d = fixture();
  try {
    const realPath = join(cfgDir, "provider_config.json");
    writeFileSync(realPath, JSON.stringify(BASE_CONFIG()));
    process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = realPath;
    process.env.HOME = ledgerHome; // sandboxUsageDir()=~/.zcode/cli/lzy-usage → 落隔离 HOME
    process.env.USERPROFILE = ledgerHome;

    let capturedSpawnArgs = null;
    const stubSpawn = async ({ cwd, home: sandboxHome, extraEnv }) => {
      capturedSpawnArgs = { cwd, home: sandboxHome, extraEnv };
      mkdirSync(join(sandboxHome, ".zcode", "cli", "rollout"), { recursive: true });
      writeFileSync(
        join(sandboxHome, ".zcode", "cli", "rollout", "model-io-sess_sbx.jsonl"),
        JSON.stringify({ tool: { file_path: join(cwd, "a.txt") } }) + "\n",
      );
      return {
        ok: true, exitCode: 0, signal: null, timedOut: false, durationMs: 5,
        stdout: FENCE(PASS) + "\n" + JSON.stringify({ sessionId: "sess_sbx", response: FENCE(PASS) }) + "\n",
        stderr: "", response: FENCE(PASS), sessionId: "sess_sbx",
      };
    };
    const deps = {
      preflight: preflightStub,
      spawnHeadless: stubSpawn,
      querySessionPoints: async () => ({ ...METERED_WITH_USAGE, usage: [...METERED_WITH_USAGE.usage] }),
      detectAuth: () => ({ ok: true, envAuth: true }),
      sqliteProbe: () => ({ ok: true }),
    };
    const res = await runReview(d, { deps });
    // ① 白名单 extraEnv 真到 spawn 面，指向隔离 home 内文件，内容只含白名单腿
    assert.ok(capturedSpawnArgs, "spawn 替身须被调用");
    assert.ok(capturedSpawnArgs.extraEnv?.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE?.startsWith(capturedSpawnArgs.home), "覆盖 env 须指向隔离 home 内白名单文件");
    const sandboxCfg = JSON.parse(readFileSync(capturedSpawnArgs.extraEnv.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE, "utf8"));
    assert.deepEqual(sandboxCfg.config.providerConfigRules.providerRules.map((r) => r.providerId), ["cmdcode", "glm-leg"]);
    // ② metering.usage 跨会话归并（同 provider/model 两行 → 一组，tokens 求和、points 求和）
    assert.equal(res.record.metering.status, "metered");
    assert.deepEqual(res.record.metering.usage, [
      { provider: "new-provider", model: "deepseek/deepseek-v4.1-flash", inputTokens: 110, cacheReadTokens: 50, outputTokens: 7, points: 42 },
    ]);
    // ③ 全局落账：一行 review 账，usage 与运行档一致（HOME 已隔离——绝不碰真实账本）
    const ledgerDir = join(ledgerHome, ".zcode", "cli", "lzy-usage");
    const files = readdirSync(ledgerDir).filter((f) => f.endsWith(".jsonl"));
    assert.equal(files.length, 1, "落账月文件恰一");
    const line = JSON.parse(readFileSync(join(ledgerDir, files[0]), "utf8").split("\n")[0]);
    assert.equal(line.kind, "review");
    assert.equal(line.project, basename(d));
    assert.equal(line.runId, res.record.runId);
    assert.equal(line.points, 42);
    assert.deepEqual(line.usage, res.record.metering.usage);
  } finally {
    if (savedEnv === undefined) delete process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE;
    else process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = savedEnv;
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedHome === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = savedHome;
    rmSync(d, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    rmSync(cfgDir, { recursive: true, force: true });
    rmSync(ledgerHome, { recursive: true, force: true });
  }
});

test("runReview：计量 stub 无 usage（旧形状）→ metering 面不产 usage、零落账（向后兼容）", async () => {
  const ledgerHome = mkdtempSync(join(tmpdir(), "lzy-sbx-ledger-"));
  const savedHome = process.env.HOME;
  const d = fixture();
  try {
    process.env.HOME = ledgerHome;
    process.env.USERPROFILE = ledgerHome;
    delete process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE; // BUILTIN-only 机器形状
    const deps = {
      preflight: preflightStub,
      spawnHeadless: async ({ cwd, home: sandboxHome }) => {
        mkdirSync(join(sandboxHome, ".zcode", "cli", "rollout"), { recursive: true });
        writeFileSync(join(sandboxHome, ".zcode", "cli", "rollout", "model-io-sess_sbx.jsonl"), JSON.stringify({ tool: { file_path: join(cwd, "a.txt") } }) + "\n");
        return {
          ok: true, exitCode: 0, signal: null, timedOut: false, durationMs: 5,
          stdout: FENCE(PASS) + "\n" + JSON.stringify({ sessionId: "sess_sbx", response: FENCE(PASS) }) + "\n",
          stderr: "", response: FENCE(PASS), sessionId: "sess_sbx",
        };
      },
      querySessionPoints: async () => ({ absent: false, unpriced: [], points: 42 }), // 旧形状（无 usage）
      detectAuth: () => ({ ok: true, envAuth: true }),
      sqliteProbe: () => ({ ok: true }),
    };
    const res = await runReview(d, { deps });
    assert.equal(res.record.metering.status, "metered");
    assert.deepEqual(res.record.metering.usage, [], "旧形状 stub → usage 恒在场但为空（不凭空造组）");
    // 落账目录不建（sandboxLedgerLine null → 零写）
    assert.equal(existsSync(join(ledgerHome, ".zcode", "cli", "lzy-usage")), false, "无 usage 不落账不建目录");
  } finally {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedHome === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = savedHome;
    rmSync(d, { recursive: true, force: true });
    rmSync(ledgerHome, { recursive: true, force: true });
  }
});
