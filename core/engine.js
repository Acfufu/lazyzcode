// 引擎调用层：lzy → ZCode 引擎官方 CLI 的唯一通道（core/ 唯一含 spawn 的文件）。
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
    // 引擎版本（如 "0.16.5"）；引擎不可用返回 null。
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
    // `plugins list --json` 的解析结果；失败返回 null（永不抛，status 侧已有空值兜底）。
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
        return JSON.parse(s.stdout);
      } catch {
        return null;
      }
    },
  };
}

export function findInstalledPlugin(list, id) {
  return Array.isArray(list?.plugins)
    ? (list.plugins.find((p) => p.id === id) ?? null)
    : null;
}
