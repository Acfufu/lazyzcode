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
// 返回形状恒为 {plugins:[…], diagnostics:[…], shapeRecognized}（对象输入另经 ...raw 透传
// 未知顶层键，diagnostics 键由联合结果覆盖）。null 仅在 JSON.parse 失败时给出。
// shapeRecognized（ADJ-64，0.2.1）：数组 / {plugins:[…]} 为真，其余为假——把「引擎输出面
// 不认识」与「插件确实不在列表」分开（旧实现把四种形状漂移 {data:{plugins}}/{plugins:{0:…}}/
// ["id"]/键改名 与「真的没装」折叠成同一个空数组，用户被指向修不好的 `lzy install`；
// 0.16.9 裸数组事故是同一族的先例）。未识别形状由 status/doctor 出独立措辞（核对引擎代际）。
export function normalizePluginList(raw) {
  const rawList = Array.isArray(raw)
    ? raw
    : isPlainObject(raw) && Array.isArray(raw.plugins)
      ? raw.plugins
      : null;
  // 信封认识（数组 / {plugins:[…]}）**且**内容可用（空数组，或至少一条对象记录）——
  // 非空而无一条对象记录（[null] / ["id"] 这类「将来只出 id 列表」漂移）同判不认识：
  // 旧实现会把它们折叠成「插件确实不在列表」，指向修不好的 lzy install。
  const shapeRecognized = rawList !== null && (rawList.length === 0 || rawList.some(isPlainObject));
  // ADJ-53（0.2.1 五轮双审）：diagnostics 侧「非对象元素一律丢弃」的纪律同样施加到
  // plugins 本体——`[null]` 等 JSON 常见 miss 位曾使 findInstalledPlugin 取属性即抛，
  // `lzy status` 整体崩、doctor 丢全部基础检查（status.js 调用点不在 try 内）。
  const plugins = (rawList ?? []).filter(isPlainObject);
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
  return { ...base, plugins, diagnostics, shapeRecognized };
}

export function findInstalledPlugin(list, id) {
  return Array.isArray(list?.plugins)
    ? (list.plugins.find((p) => p.id === id) ?? null)
    : null;
}
