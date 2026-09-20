// 引擎调用层：lzy → ZCode 引擎官方 CLI 的唯一通道（引擎调用唯一 spawn 在本文件；
// status.js 的诊断探测 spawn 沿 git.js 同款安全形态，不属引擎调用）。
// 引擎路径解析在 paths.js（findEngine），本模块只执行：可执行文件恒为当前 node
// （process.execPath，受信常量），每个调用点的子命令数组字面量写死 + shell:false，
// 不存在任何命令拼接形态。对用户 config.json 零写入（ADR-0001）。
// 全部导出为同步函数：调用方（installer/status/lzy）均以同步语义取值。
import { spawnSync } from "node:child_process";

const TIMEOUT_MS = 30_000;
const VERSION_TIMEOUT_MS = 15_000;

const MISSING_ERROR =
  "引擎 zcode.cjs 未找到（可用 LZY_ZCODE_ENGINE 显式指定）";

function settle(r, what) {
  if (r.error) {
    return { ok: false, error: r.error.message, stderr: r.stderr ?? "" };
  }
  if (r.status !== 0) {
    return {
      ok: false,
      error: `引擎命令失败（${what}，exit ${r.status ?? "?"}）：${(
        r.stderr ||
        r.stdout ||
        ""
      ).trim()}`,
      stderr: (r.stderr ?? "").trim(),
    };
  }
  return { ok: true, stdout: r.stdout ?? "" };
}

// 工厂：enginePath 由 paths.js 的 findEngine() 提供；null 时各操作如实报 missing，
// 绝不退化为手写 config。
export function createEngineCli(enginePath) {
  const missing = () => ({ ok: false, missing: true, error: MISSING_ERROR });
  return {
    // 引擎版本（如 "0.16.9"）；引擎不可用返回 null。
    version() {
      if (!enginePath) return null;
      const r = spawnSync(process.execPath, [enginePath, "--version"], {
        shell: false,
        timeout: VERSION_TIMEOUT_MS,
        encoding: "utf8",
      });
      const s = settle(r, "--version");
      return (s.ok && s.stdout.trim()) || null;
    },
    enable(id) {
      if (!enginePath) return missing();
      const r = spawnSync(process.execPath, [enginePath, "plugins", "enable", id], {
        shell: false,
        timeout: TIMEOUT_MS,
        encoding: "utf8",
      });
      return settle(r, "plugins enable");
    },
    uninstall(id) {
      if (!enginePath) return missing();
      const r = spawnSync(
        process.execPath,
        [enginePath, "plugins", "uninstall", id, "--force"],
        { shell: false, timeout: TIMEOUT_MS, encoding: "utf8" },
      );
      return settle(r, "plugins uninstall");
    },
    // `plugins list --json` 的解析结果（已归一，见 normalizePluginList）；
    // 失败返回 null（永不抛，status 侧已有空值兜底）。
    listJson() {
      if (!enginePath) return null;
      const r = spawnSync(
        process.execPath,
        [enginePath, "plugins", "list", "--json"],
        { shell: false, timeout: TIMEOUT_MS, encoding: "utf8" },
      );
      const s = settle(r, "plugins list");
      if (!s.ok) return null;
      try {
        return normalizePluginList(JSON.parse(s.stdout));
      } catch {
        return null;
      }
    },
  };
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// 引擎输出面归一（ADR-0021）：`plugins list --json` 的包封跨代际漂移——0.16.5 出
// 对象 {plugins:[…], diagnostics:[…]}，0.16.9 出裸数组，插件记录本身字段逐字相同。
// 归一收在此唯一边界，调用方（findInstalledPlugin/status.js）不感知代际。
// 返回形状恒为 {plugins:[…], diagnostics:[…]}（对象输入另经 ...raw 透传未知顶层键，
// diagnostics 键由联合结果覆盖）。null 仅在 JSON.parse 失败时给出——标量或对象缺
// plugins 数组一律归一为 {plugins:[]}，让「引擎未列出该插件」仍落 fail 而非降级为 warn。
export function normalizePluginList(raw) {
  const plugins = Array.isArray(raw)
    ? raw
    : isPlainObject(raw) && Array.isArray(raw.plugins)
      ? raw.plugins
      : [];
  const topLevel = isPlainObject(raw) && Array.isArray(raw.diagnostics)
    ? raw.diagnostics.filter(isPlainObject)
    : [];
  // 归属键注入：per-plugin 诊断未自带归属时补上其宿主插件 id，使 status.js 的
  // `d?.plugin === id` 谓词无需改动即可命中。过滤在前——非对象元素一律丢弃，
  // 否则 {...d} 会把字符串展成字符表。
  const perPlugin = plugins.flatMap((p) =>
    isPlainObject(p) && Array.isArray(p.diagnostics)
      ? p.diagnostics
          .filter(isPlainObject)
          .map((d) => ({ ...d, plugin: d.plugin ?? d.pluginId ?? d.id ?? p.id }))
      : [],
  );
  const seen = new Set();
  const diagnostics = [];
  for (const d of [...topLevel, ...perPlugin]) {
    const key = JSON.stringify([d.severity, d.code, d.message, d.plugin ?? ""]);
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push(d);
  }
  const base = isPlainObject(raw) ? { ...raw } : {};
  return { ...base, plugins, diagnostics };
}

export function findInstalledPlugin(list, id) {
  return Array.isArray(list?.plugins)
    ? (list.plugins.find((p) => p.id === id) ?? null)
    : null;
}
