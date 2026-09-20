// 路径定位：引擎 zcode.cjs、ZCode CLI 插件根、注册表、仓库内插件载荷。
// 引擎候选按平台数据表（darwin/linux 实测布局，win32 候选见 engineCandidates）；候选全空由
// lzy status 明确报「未找到」，绝不盲猜。
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

// 引擎计费账本（plan-v2 Phase 2-2）——只读扫描面，供 `lzy loop cost` 积分折算用。
// 缺文件=无账本，读面自行降级（绝不写入）。
export function billingDbPath() {
  return join(cliRoot(), "db", "db.sqlite");
}

// 宿主自动化索引库（plan-v2 Phase 2-4）——注意不在 cliRoot() 下（v2/ 与 cli/ 平级），
// 独立 join；供 doctor 的 orphan-wake 检查只读 JOIN automations/automation_runs。
export function tasksIndexPath() {
  return join(homedir(), ".zcode", "v2", "tasks-index.sqlite");
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

// 各平台引擎候选路径（ADR-0011 三平台支持）：全部为实测布局，绝不盲猜——
// darwin: /Applications/ZCode.app（实测本机）；linux: /opt/ZCode（deb 布局实测，recon §3.2）；
// win32: %LOCALAPPDATA%\Programs\ZCode（per-user NSIS 实测，recon §3.2 + goal N5 落位实测）。
export function engineCandidates() {
  const fromEnv = process.env.LZY_ZCODE_ENGINE;
  // env 设置即整体替换默认候选：让「引擎缺失→手动启用回退」路径可被测试触达（评审 R3-9）。
  if (fromEnv) return [fromEnv];
  if (platform() === "darwin") {
    return ["/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs"];
  }
  if (platform() === "linux") {
    return ["/opt/ZCode/resources/glm/zcode.cjs"];
  }
  if (platform() === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return [join(localAppData, "Programs", "ZCode", "resources", "glm", "zcode.cjs")];
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
  // ADJ-61（0.2.1 五轮双审）：`/^[A-Za-z0-9._-]+$/` 放行纯点段——{name:"..",version:".."}
  // 使 dest===pluginsRoot()，deployFiles 随即 rmSync 整棵插件缓存树（威胁模型正是
  // 「装别人给的插件」）。显式排除纯点段。
  const OK_RE = /^[A-Za-z0-9._-]+$/;
  const isDotSegment = (v) => /^\.+$/.test(v);
  if (typeof name !== "string" || !OK_RE.test(name) || isDotSegment(name)) {
    throw new Error(`manifest.name 不合法：${JSON.stringify(name) ?? "（缺失）"}（仅限字母数字._-，且不得为 . 或 ..）`);
  }
  if (typeof version !== "string" || !OK_RE.test(version) || isDotSegment(version)) {
    throw new Error(`manifest.version 不合法：${JSON.stringify(version) ?? "（缺失）"}（仅限字母数字._-，且不得为 . 或 ..）`);
  }
  return join(pluginsRoot(), "cache", MARKETPLACE, name, version);
}

export { packageRoot };
