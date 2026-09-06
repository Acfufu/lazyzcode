// 路径定位：引擎 zcode.cjs、ZCode CLI 插件根、注册表、仓库内插件载荷。
// P0 只覆盖 macOS 布局；其他平台由 lzy status 明确报「未找到」，绝不盲猜。
import { existsSync } from "node:fs";
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

export function engineCandidates() {
  const fromEnv = process.env.LZY_ZCODE_ENGINE;
  const list = [];
  if (fromEnv) list.push(fromEnv);
  if (platform() === "darwin") {
    list.push("/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs");
  }
  return list;
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
  return join(
    pluginsRoot(),
    "cache",
    MARKETPLACE,
    manifest.name ?? PLUGIN_NAME,
    manifest.version,
  );
}

export { packageRoot };
