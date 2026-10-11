import { existsSync, mkdirSync, writeFileSync, readFileSync, realpathSync, lstatSync, readdirSync, unlinkSync, rmSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { startReviewProxy } from "./review-proxy.js";

const BACKEND = "/usr/bin/sandbox-exec";
const CREDENTIAL_FILES = ["provider-config.sandbox.json", "builtin-config.sandbox.json"];
const MARKER = "sandbox-cleanup.json";
export class ReviewSandboxError extends Error {}

export function reviewSandboxCapability({ platform = process.platform } = {}) {
  if (platform !== "darwin") return { available: false, backend: null, detail: "受控评审 OS 沙盒暂只支持 macOS；当前平台拒绝裸启动（可在支持的 macOS 环境评审）" };
  const r = spawnSync(BACKEND, ["-p", "(version 1)(deny default)(allow process*)(allow file-read*)(allow sysctl-read)", "/usr/bin/true"], { encoding: "utf8", timeout: 3000, env: { PATH: "/usr/bin:/bin" } });
  return r.status === 0 ? { available: true, backend: "macos-seatbelt", detail: "Seatbelt 启动探针通过；评审必须经受限文件策略与 endpoint 代理" } : { available: false, backend: "macos-seatbelt", detail: "Seatbelt 不可用或宿主拒绝嵌套沙盒；受控评审拒绝裸启动，检查 macOS 运行环境" };
}

export function reviewEnvironment({ home, proxyUrl, providerEnv = {}, source = process.env }) {
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, NODE_ENV: "production", HOME: home, USERPROFILE: home };
  for (const key of ["LANG", "LC_ALL", "LC_CTYPE", "TZ", "TERM"]) if (source[key] && /^[\w.@/+:-]+$/.test(source[key])) env[key] = source[key];
  for (const [key, subdir] of Object.entries({ TMPDIR: "tmp", TMP: "tmp", TEMP: "tmp", XDG_CONFIG_HOME: "config", XDG_CACHE_HOME: "cache", XDG_DATA_HOME: "data", XDG_STATE_HOME: "state" })) {
    env[key] = join(home, subdir);
    mkdirSync(env[key], { recursive: true, mode: 0o700 });
  }
  for (const key of ["ZCODE_PERSONAL_PROVIDER_CONFIG_FILE", "ZCODE_BUILTIN_PROVIDER_CONFIG_FILE"]) if (providerEnv[key]) env[key] = providerEnv[key];
  for (const key of ["ZCODE_HTTP_PROXY", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) env[key] = proxyUrl;
  for (const key of ["ZCODE_NO_PROXY", "NO_PROXY", "no_proxy"]) env[key] = "";
  return env;
}

// The copied builtin release supplies public templates, never an unrelated account provider.
export function prepareReviewProviderRuntime(home, providerEnv = {}, builtinPath = process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE) {
  const personalPath = providerEnv?.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE;
  if (!personalPath) throw new ReviewSandboxError("OS 隔离评审需要显式允许的个人 API provider；OAuth/BUILTIN-only 不能替代隔离认证，配置 LZY_SANDBOX_PROVIDERS 后重跑");
  const personal = JSON.parse(readFileSync(personalPath, "utf8"));
  const rules = personal?.config?.providerConfigRules?.providerRules;
  if (!Array.isArray(rules) || rules.length === 0) throw new ReviewSandboxError("隔离 provider 配置无可用 API 腿");
  const ids = new Set(rules.map(r => r.providerId));
  const emptyModels = { modelRules: [], modelApiRules: [], providerSiteRules: [], templateModelRules: [], builtinProviderModelRules: [] };
  let builtin = { schemaVersion: 1, revision: 0, config: { providerConfigRules: { templateRules: [], providerRules: [] }, modelConfigRules: emptyModels } };
  if (builtinPath) {
    try { builtin = JSON.parse(readFileSync(builtinPath, "utf8")); } catch { throw new ReviewSandboxError("BUILTIN 模板配置不可读，拒绝透传真实配置路径"); }
    if (!Array.isArray(builtin?.config?.providerConfigRules?.templateRules) || !Array.isArray(builtin?.config?.providerConfigRules?.providerRules)) throw new ReviewSandboxError("BUILTIN 模板配置结构不可识别，拒绝未约束透传");
  }
  const sourceRules = builtin.config.providerConfigRules;
  const builtinRules = sourceRules.providerRules.filter(r => ids.has(r.providerId));
  const templateIds = new Set([...rules, ...builtinRules].map(r => r.templateId).filter(Boolean));
  // Preserve only public defaults. Authentication comes exclusively from the selected PERSONAL copy.
  const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
  const publicRule = rule => {
    const config = pick(rule.config, ["group", "logo", "access", "api", "builtinModelIds", "visibility"]);
    if (config.logo && typeof config.logo === "object") config.logo = pick(config.logo, ["type", "key"]);
    if (config.access && typeof config.access === "object") {
      config.access = pick(config.access, ["type", "accountType", "mode", "entitled"]);
    }
    if (config.api && typeof config.api === "object") {
      config.api = pick(config.api, ["type", "baseUrl"]);
    }
    const fields = pick(rule, ["providerId", "templateId", "providerName", "enabled", "templateNameMap"]);
    if (fields.templateNameMap && typeof fields.templateNameMap === "object") fields.templateNameMap = pick(fields.templateNameMap, ["zh-CN", "en-US"]);
    return { ...fields, config };
  };
  const templates = sourceRules.templateRules.filter(t => templateIds.has(t.templateId)).map(publicRule);
  const endpoints = rules.map(r => {
    const base = builtinRules.find(b => b.providerId === r.providerId);
    const personalTemplate = templates.find(t => t.templateId === r.templateId);
    const baseTemplate = templates.find(t => t.templateId === base?.templateId);
    const endpoint = r.config?.api?.baseUrl ?? personalTemplate?.config?.api?.baseUrl ?? base?.config?.api?.baseUrl ?? baseTemplate?.config?.api?.baseUrl;
    if (typeof endpoint !== "string" || !endpoint.trim()) throw new ReviewSandboxError("允许的 provider 缺少可解析 API endpoint；补齐 api.baseUrl 或对应 BUILTIN 模板后重跑");
    return endpoint;
  });
  const models = builtin.config.modelConfigRules ?? emptyModels;
  const copy = { schemaVersion: builtin.schemaVersion, revision: builtin.revision, config: {
    providerConfigRules: { templateRules: templates, providerRules: builtinRules.map(publicRule) },
    modelConfigRules: { ...Object.fromEntries(Object.keys(emptyModels).map(key => [key, Array.isArray(models[key]) ? models[key] : []])), templateModelRules: (models.templateModelRules ?? []).filter(r => templateIds.has(r.templateId)), builtinProviderModelRules: (models.builtinProviderModelRules ?? []).filter(r => ids.has(r.providerId)) },
  } };
  const builtinCopy = join(home, "builtin-config.sandbox.json");
  writeFileSync(builtinCopy, JSON.stringify(copy), { mode: 0o600 });
  return { providerEnv: { ...providerEnv, ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: builtinCopy }, endpoints };
}

function quotedPath(path) {
  if (/[\x00-\x1f\x7f]/.test(path)) throw new ReviewSandboxError("沙盒路径含控制字符，拒绝生成策略");
  return JSON.stringify(path);
}

export function seatbeltPolicy({ home, candidateDir, inputPath, enginePath, policyPath, proxyPort }) {
  const engineRoot = realpathSync(dirname(enginePath));
  const userHome = realpathSync(homedir());
  if (engineRoot === "/" || engineRoot === userHome || userHome.startsWith(`${engineRoot}${sep}`)) throw new ReviewSandboxError("引擎运行目录过宽（根目录或用户 HOME 祖先），请将自定义引擎放在专用安装目录");
  const reads = ["/System", "/usr/lib", "/usr/share", "/usr/bin", "/bin", engineRoot, realpathSync(candidateDir), realpathSync(home)];
  const literals = ["/", "/dev/null", "/dev/urandom", "/private/etc/localtime", realpathSync(process.execPath), realpathSync(inputPath), resolve(policyPath)];
  if (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535) throw new ReviewSandboxError("沙盒代理端口非法");
  return `(version 1)\n(deny default)\n(allow process-exec process-fork)\n(allow sysctl-read)\n(allow file-read-metadata)\n(allow mach-lookup (global-name "com.apple.system.logger") (global-name "com.apple.trustd.agent"))\n(allow file-read* ${reads.map(p => `(subpath ${quotedPath(p)})`).join(" ")} ${literals.map(p => `(literal ${quotedPath(p)})`).join(" ")})\n(allow file-write* (subpath ${quotedPath(realpathSync(home))}) (literal "/dev/null"))\n(allow network-outbound (remote ip "localhost:${proxyPort}"))\n`;
}

// Register before the first credential write. SIGKILL recovery is observable, not immediate cleanup.
export function registerReviewCleanup(runDir) {
  writeFileSync(join(runDir, MARKER), JSON.stringify({ version: 1, ownerPid: process.pid, state: "pending", at: new Date().toISOString() }), { mode: 0o600 });
}

export function cleanupReviewSandbox(runDir) {
  const errors = [];
  try {
    const home = join(runDir, "home");
    if (existsSync(home)) {
      if (!lstatSync(home).isDirectory() || realpathSync(home) !== join(realpathSync(runDir), "home")) throw new ReviewSandboxError("隔离 HOME 路径变化，拒绝跟随链接清理");
      for (const name of CREDENTIAL_FILES) {
        try { unlinkSync(join(home, name)); } catch (e) { if (e.code !== "ENOENT") errors.push(`${name}:${e.code ?? "failed"}`); }
      }
      try { rmSync(join(home, "tmp"), { force: true, recursive: true }); } catch (e) { errors.push(`tmp:${e.code ?? "failed"}`); }
    }
  } catch (e) { errors.push(e instanceof ReviewSandboxError ? e.message : `home:${e.code ?? "failed"}`); }
  const result = { version: 1, ownerPid: process.pid, state: errors.length ? "failed" : "clean", errors, at: new Date().toISOString() };
  try { writeFileSync(join(runDir, MARKER), JSON.stringify(result), { mode: 0o600 }); } catch (e) { result.state = "failed"; result.errors.push(`marker:${e.code ?? "failed"}`); }
  return result;
}

export function reviewSandboxResidues(cwd) {
  const root = join(cwd, ".lazyzcode", "review"); const found = [];
  if (!existsSync(root)) return found;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^.+\.a\d+\.r\d+$/.test(entry.name)) continue;
    const dir = join(root, entry.name); const markerPath = join(dir, MARKER);
    if (!existsSync(markerPath)) continue;
    try {
      const marker = JSON.parse(readFileSync(markerPath, "utf8"));
      let active = false;
      if (Number.isInteger(marker.ownerPid) && marker.ownerPid > 0) { try { process.kill(marker.ownerPid, 0); active = true; } catch (e) { active = e.code !== "ESRCH"; } }
      const credentials = CREDENTIAL_FILES.filter(name => existsSync(join(dir, "home", name)));
      if (marker.state !== "clean" || credentials.length) found.push({ runId: entry.name, active, state: marker.state, credentials });
    } catch { found.push({ runId: entry.name, active: null, state: "unreadable", credentials: [] }); }
  }
  return found;
}

export function recoverReviewSandbox(cwd, runId) {
  if (typeof runId !== "string" || !/^[-\w.]+\.a\d+\.r\d+$/.test(runId)) throw new ReviewSandboxError("评审运行 ID 非法");
  const root = join(cwd, ".lazyzcode", "review"); const dir = join(root, runId);
  if (!lstatSync(dir).isDirectory() || realpathSync(dir) !== join(realpathSync(root), runId)) throw new ReviewSandboxError("评审目录不是直接目录，拒绝清理");
  const marker = JSON.parse(readFileSync(join(dir, MARKER), "utf8"));
  if (marker.version !== 1 || !Number.isInteger(marker.ownerPid) || marker.ownerPid <= 0) throw new ReviewSandboxError("清理凭据不可识别，拒绝猜测恢复");
  try { process.kill(marker.ownerPid, 0); } catch (e) { if (e.code === "ESRCH") return cleanupReviewSandbox(dir); throw e; }
  throw new ReviewSandboxError("运行所有者仍在场，拒绝清理活动评审");
}

export async function createReviewSandbox({ runDir, candidateDir, inputPath, home, enginePath, providerEnv = {}, endpoints }) {
  const capability = reviewSandboxCapability();
  if (!capability.available) throw new ReviewSandboxError(capability.detail);
  if (!enginePath || !existsSync(enginePath)) throw new ReviewSandboxError("引擎缺席，不能生成 OS 隔离策略");
  const proxy = await startReviewProxy({ endpoints });
  try {
    const policyPath = join(runDir, "sandbox.sb");
    writeFileSync(policyPath, seatbeltPolicy({ home, candidateDir, inputPath, enginePath, policyPath, proxyPort: proxy.port }), { mode: 0o600 });
    return {
      headless: { baseEnv: reviewEnvironment({ home, proxyUrl: proxy.url, providerEnv }), launcher: { command: BACKEND, prefixArgs: ["-f", policyPath] }, processTree: true },
      metadata: { level: "B", backend: capability.backend, endpoints: proxy.endpoints, processCleanup: "posix-process-group", fileMetadataVisible: true },
      stats: proxy.stats,
      close: () => proxy.close(),
    };
  } catch (e) { await proxy.close(); throw e; }
}
