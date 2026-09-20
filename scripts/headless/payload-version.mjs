// headless E2E 前置检查（0.2.1 修复轮 ADJ-41）：两脚本驱动的是**真引擎 + 真会话**，
// 而真会话读的是**安装缓存载荷**（~/.zcode/cli/plugins/cache/<市场>/lazyzcode/<版本>/），
// 不是本仓工作树——仓内改了代码而没 sync，E2E 验的是旧载荷，verdict 会指向不存在的东西。
// 本文件是 `lzy doctor` payload-ver 检查（core/doctor.js checkPayloadVersion）的轻量版：
// 只做「缓存目录里有没有本仓 manifest 的这一版」目录级对照，不做注册表/内容级抽样
// （那两层归 doctor；此处目标只是让 E2E 开跑前不静默量错载荷）。零依赖，只读。
//
// 三态（调用方语义，ADR-0012 中间态自查面）：
//   ok      = 缓存目录含本仓 manifest 版本 → 放行（附缓存版本清单供人核对）
//   missing = 缓存有本插件但无本仓这版 → 调用方 fail 并提示 lzy sync
//   warn    = 缓存不可读/插件未装 → 调用方打印一行警告后继续（未装不是本脚本的错）
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MARKETPLACE, PLUGIN_NAME, pluginsRoot, repoManifestPath } from "../../core/paths.js";

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

// 市场名候选：先本仓注册市场（lazyzcode-local），再扫 cache/ 下全部市场目录——市场 B 路
// 安装的市场名不同（doctor 同款顾虑，ADJ-37），硬编码单一市场名会漏判成「未装」。
export function scanPayloadCache(marketplace = MARKETPLACE, root = pluginsRoot()) {
  const cacheRoot = join(root, "cache");
  let markets;
  try {
    markets = readdirSync(cacheRoot);
  } catch {
    // cache/ 缺席=引擎从未装过任何插件（干净机）→ 目录扫描面为空，但下面的显式本仓市场
    // 路径仍要试（老布局可能没有 cache/ 层，属探测而非假设）
    markets = [];
  }
  const candidates = [...new Set([marketplace, ...markets])];
  const byMarket = {};
  const all = new Set();
  for (const m of candidates) {
    let vs = [];
    try {
      vs = readdirSync(join(cacheRoot, m, PLUGIN_NAME)).filter((d) => SEMVER_RE.test(d));
    } catch {
      vs = []; // 该市场下没有本插件（或不可读）：不当错误，只当无候选
    }
    if (vs.length > 0) {
      byMarket[m] = vs;
      for (const v of vs) all.add(v);
    }
  }
  return { cacheRoot, byMarket, versions: [...all].sort() };
}

export function checkPayloadCache({ marketplace = MARKETPLACE, root = pluginsRoot(), manifestPath = repoManifestPath() } = {}) {
  const scanned = scanPayloadCache(marketplace, root);
  let repoVersion = null;
  try {
    repoVersion = JSON.parse(readFileSync(manifestPath, "utf8")).version ?? null;
  } catch {
    return { status: "warn", detail: `本仓 manifest 不可读（${manifestPath}）——前置对照跳过`, cacheRoot: scanned.cacheRoot, versions: scanned.versions };
  }
  if (!repoVersion) {
    return { status: "warn", detail: `本仓 manifest 无 version 字段（${manifestPath}）——前置对照跳过`, cacheRoot: scanned.cacheRoot, versions: scanned.versions };
  }
  if (scanned.versions.length === 0) {
    return { status: "warn", detail: `载荷缓存缺席（${scanned.cacheRoot} 下未找到 ${PLUGIN_NAME}/<版本>）——未装插件或缓存不可读`, cacheRoot: scanned.cacheRoot, versions: [] };
  }
  if (scanned.versions.includes(repoVersion)) {
    return { status: "ok", detail: `缓存 [${scanned.versions.join(", ")}] · 本仓 ${repoVersion} 在场`, cacheRoot: scanned.cacheRoot, versions: scanned.versions, repoVersion };
  }
  return {
    status: "missing",
    detail: `缓存 [${scanned.versions.join(", ")}] 无本仓载荷 ${repoVersion}——真会话将加载旧载荷`,
    cacheRoot: scanned.cacheRoot,
    versions: scanned.versions,
    repoVersion,
  };
}
