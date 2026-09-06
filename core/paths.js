// 路径定位：引擎 zcode.cjs、ZCode CLI 插件根、注册表、仓库内插件载荷。
// P0 只覆盖 macOS 布局；其他平台由 lzy status 明确报「未找到」，绝不盲猜。
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, platform } from "node:os";

export const MARKETPLACE = "lazyzcode-local";
export const PLUGIN_NAME = "lazyzcode";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function repoPluginDir() {
  return join(packageRoot, "plugin");
}

export function repoManifestPath() {
  return join(repoPluginDir(), ".zcode-plugin", "plugin.json");
}

export function cliRoot() {
  return join(homedir(), ".zcode", "cli");
}

export function pluginsRoot() {
  return join(cliRoot(), "plugins");
}

export function registryPath() {
  return join(pluginsRoot(), "installed_plugins.json");
}

export function userCliConfigPath() {
  return join(cliRoot(), "config.json");
}

// 引擎 cli 日志目录（每日 zcode-YYYY-MM-DD.jsonl，现存保留约 7 天）——只读扫描面，
// 供 doctor 的限流体检用。
export function userCliLogDir() {
  return join(cliRoot(), "log");
}

// hook 脚本枚举：路径解析归本模块（doctor.js 只拿结果列表作 spawn 参数，污点不跨文件）。
export function hookScriptPaths(rootDir) {
  try {
    return readdirSync(join(rootDir, "hooks"))
      .filter((f) => f.endsWith(".js"))
      .map((f) => join(rootDir, "hooks", f));
  } catch {
    return [];
  }
}

export function engineCandidates() {
  const fromEnv = process.env.LZY_ZCODE_ENGINE;
  // env 设置即整体替换默认候选：让「引擎缺失→手动启用回退」路径可被测试触达（评审 R3-9）。
  if (fromEnv) return [fromEnv];
  if (platform() === "darwin") {
    return ["/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs"];
  }
  return [];
}

export function findEngine() {
  for (const p of engineCandidates()) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function pluginId(manifest) {
  return `${manifest.name ?? PLUGIN_NAME}@${MARKETPLACE}`;
}

export function installPathFor(manifest) {
  // manifest 字段直入 join 前先校验：version 缺失此前是 TypeError、name 含 / 可逸出
  // cache 目录——都换成清晰报错（评审 R1-5②）。
  const name = manifest?.name ?? PLUGIN_NAME;
  const version = manifest?.version;
  const OK_RE = /^[A-Za-z0-9._-]+$/;
  if (typeof name !== "string" || !OK_RE.test(name)) {
    throw new Error(`manifest.name 不合法：${JSON.stringify(name) ?? "（缺失）"}（仅限字母数字._-）`);
  }
  if (typeof version !== "string" || !OK_RE.test(version)) {
    throw new Error(`manifest.version 不合法：${JSON.stringify(version) ?? "（缺失）"}（仅限字母数字._-）`);
  }
  return join(pluginsRoot(), "cache", MARKETPLACE, name, version);
}

export { packageRoot };
