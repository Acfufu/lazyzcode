// lzy status：全只读检查。启用态以引擎官方 `plugins list --json` 为准（ADR-0001）；
// 对用户 config.json 永不写入——只读诊断段（codegraph 探测）允许读它。
// 诊断探测 spawn 沿 git.js 安全形态：可执行为字面量常量、argv 字面量、shell:false。
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createEngineCli, findInstalledPlugin } from "./engine.js";
import { createGit } from "./git.js";
import { handoffPath, readGoal, readMetrics } from "./loop.js";
import { findRegistryEntry, readRepoManifest, sha256File } from "./installer.js";
import {
  findEngine,
  installPathFor,
  pluginId,
  repoPluginDir,
  userCliConfigPath,
} from "./paths.js";

// 载荷相对路径清单（跳过点残留，对齐 deployFiles 的 isDotResidue 语义；.zcode-plugin 保留）。
function payloadFiles(root) {
  const out = [];
  const walk = (rel) => {
    let entries;
    try {
      entries = readdirSync(join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (r.split("/").some((seg) => seg.startsWith(".") && seg !== ".zcode-plugin")) continue;
      if (e.isDirectory()) walk(r);
      else out.push(r);
    }
  };
  walk("");
  return out;
}

// 返回 {checks: [{name, state, detail}], ok}
// state: "ok" | "fail" | "warn" | "skip"
export async function collectStatus() {
  const checks = [];
  const push = (name, state, detail) => checks.push({ name, state, detail });

  let manifest = null;
  try {
    manifest = readRepoManifest();
    push("payload", "ok", `仓库插件清单 ${manifest.name}@${manifest.version}`);
  } catch (err) {
    push("payload", "fail", `仓库 plugin/ 清单不可读：${err.message}`);
    return { checks, ok: false };
  }

  const id = pluginId(manifest);

  const enginePath = findEngine();
  const eng = createEngineCli(enginePath);
  const engineVersion = eng.version();
  push(
    "engine",
    engineVersion ? "ok" : "warn",
    engineVersion ?? (enginePath ? "引擎命令不可用" : "引擎 zcode.cjs 未找到"),
  );

  // 注册表损坏时 readRegistry 上抛：诊断如实报 fail，绝不降级成「未安装」误导重装。
  let entry = null;
  let registryBroken = false;
  try {
    entry = findRegistryEntry(manifest);
  } catch (err) {
    registryBroken = true;
    push("install", "fail", `注册表不可读（${err.message}）——修复或删除后重跑 lzy install`);
  }
  if (registryBroken) {
    // 检查行已推送；不再读取 entry
  } else if (!entry) {
    push("install", "fail", `注册表无 ${id}（先运行 lzy install）`);
  } else if (entry.version !== manifest.version) {
    push(
      "install",
      "warn",
      `注册表版本 ${entry.version} ≠ 仓库版本 ${manifest.version}（运行 lzy sync）`,
    );
  } else {
    push("install", "ok", `${id} @ ${entry.installPath}`);
  }

  // 缓存载荷核验：逐文件 sha256 内容比对。路径集合比对对「文件在而内容过期」结构性失明
  // （2026-09-09 事故：认领制后缓存未重装，status 照报一致）；现算不记 manifest——
  // sync 时落 hash 记录与缓存同源，对仓库前进同样漏报。读失败按不一致计（fail-open）。
  const cacheRoot = installPathFor(manifest);
  if (!existsSync(join(cacheRoot, ".zcode-plugin", "plugin.json"))) {
    push("files", "fail", "缓存缺 manifest（运行 lzy sync）");
  } else {
    const repoDir = repoPluginDir();
    const repoFiles = payloadFiles(repoDir);
    const cacheList = payloadFiles(cacheRoot);
    const cacheSet = new Set(cacheList);
    const missing = repoFiles.filter((f) => !cacheSet.has(f));
    const extra = cacheList.filter((f) => !repoFiles.includes(f)); // 缓存多余=手改/残留（R3-2 同类）
    const mismatched = [];
    for (const f of repoFiles) {
      if (!cacheSet.has(f)) continue; // 缺失已单独计数
      try {
        if (sha256File(join(repoDir, f)) !== sha256File(join(cacheRoot, f))) mismatched.push(f);
      } catch {
        mismatched.push(f); // 任一侧不可读：按不一致降级，单文件权限不炸整个 status
      }
    }
    const dirtyHint =
      repoFiles.length > 0 && createGit(process.cwd()).dirty()
        ? "；仓库有未提交改动，先提交再 sync（sync 原样复制工作树）"
        : "";
    if (repoFiles.length === 0) {
      push("files", "warn", "仓库载荷为空，无从核验");
    } else if (missing.length > 0) {
      push(
        "files",
        "warn",
        `缓存缺 ${missing.length} 个文件（如 ${missing.slice(0, 3).join(" ")}；运行 lzy sync${dirtyHint}）`,
      );
    } else if (mismatched.length + extra.length > 0) {
      const samples = [...mismatched, ...extra].slice(0, 3).join(" ");
      push(
        "files",
        "warn",
        `缓存载荷与仓库不一致（内容差异 ${mismatched.length}、缓存多余 ${extra.length}，如 ${samples}；运行 lzy sync${dirtyHint}）`,
      );
    } else {
      push("files", "ok", `缓存载荷与仓库逐文件 sha256 一致（${repoFiles.length} 文件）`);
    }
  }

  if (engineVersion) {
    const list = eng.listJson();
    if (!list) {
      push("enabled", "warn", "引擎 plugins list 调用失败，启用态未知（重试或检查引擎日志）");
    } else {
      const record = findInstalledPlugin(list, id);
      if (!record) {
        push("enabled", "fail", "引擎未列出该插件（运行 lzy install）");
      } else if (!record.enabled) {
        push("enabled", "fail", "已安装但未启用（运行 lzy install 或 plugins enable）");
      } else {
        push(
          "enabled",
          "ok",
          `[enabled] skills:${record.skillCount ?? 0} commands:${record.commandRootCount ?? 0} hooks:${(record.hookDetails ?? []).length}`,
        );
      }
    }
    // 归属判定：结构化字段精确等值优先，兜底带引号整串包含（裸子串会误捕他人插件诊断，评审 R3-12）。
    const quotedId = JSON.stringify(id);
    const diags = (list?.diagnostics ?? []).filter(
      (d) =>
        d?.plugin === id ||
        d?.pluginId === id ||
        d?.id === id ||
        (Array.isArray(d?.plugins) && d.plugins.includes(id)) ||
        JSON.stringify(d).includes(quotedId),
    );
    if (diags.length > 0) {
      push(
        "diagnostics",
        "warn",
        diags.map((d) => `[${d.severity}] ${d.code}: ${d.message}`).join("; "),
      );
    }
  } else {
    push("enabled", "skip", "无法判定（引擎调用层不可用）");
  }

  const goal = readGoal(process.cwd());
  if (!goal || goal.status === "abandoned") {
    push("loop", "skip", "本目录无进行中的目标循环（lzy loop register 开始）");
  } else {
    const done = goal.steps.filter((s) => s.status === "done").length;
    push(
      "loop",
      goal.status === "done" ? "ok" : "warn",
      `${goal.slug} · ${goal.status} · ${done}/${goal.steps.length} 步`,
    );
  }
  // 交接读面（ADR-0009）置于 goal 分支之外：标记残留与放行计数恰在无 goal 时最该可见
  // （跨 reset 永续的计数，回收主时刻=回看使用率时刻）。标记在场=warn 仅为可见性（不翻退出码）；
  // 计数差值非损失（reset 清理/坏标记丢弃/化石标记都只登记不消费）。
  try {
    const marker = JSON.parse(readFileSync(handoffPath(process.cwd()), "utf8"));
    push("handoff", "warn", `交接标记在场（快照 ${marker.snapshot ?? "?"}）——下个 Stop 将放行`);
  } catch {} // 无标记=常态，静默
  const metrics = readMetrics(process.cwd());
  if (metrics) {
    push(
      "handoff-usage",
      "ok",
      `登记 ${metrics.registered ?? 0} · 消费 ${metrics.consumed ?? 0}（差值=reset 清理/坏标记，非损失）`,
    );
  }

  // 可选资产：codegraph 代码索引。缺席=skip（不翻转退出码），可用性分 MCP 配置与 CLI 两路。
  const cfgPath = userCliConfigPath();
  let mcpConfigured = false;
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    mcpConfigured = Boolean(cfg?.mcp?.servers?.codegraph);
  } catch {
    mcpConfigured = false; // config 缺失/不可读不属故障，按未配置处理
  }
  const cliProbe = spawnSync("codegraph", ["--version"], {
    shell: false,
    timeout: 10_000,
    encoding: "utf8",
  });
  const cliOk = !cliProbe.error && cliProbe.status === 0;
  const cliVersion = String(cliProbe.stdout ?? "").trim();
  if (mcpConfigured && cliOk) {
    push("codegraph", "ok", `MCP 已配置（${cfgPath}）+ CLI 可用${cliVersion ? `（${cliVersion}）` : ""}`);
  } else if (mcpConfigured) {
    push("codegraph", "ok", `MCP 已配置（${cfgPath}）；CLI 不在 PATH（MCP 工具仍可用）`);
  } else if (cliOk) {
    push("codegraph", "ok", `CLI 可用${cliVersion ? `（${cliVersion}）` : ""}；用户级 MCP 未配置`);
  } else {
    push("codegraph", "skip", "codegraph 未配置（可选资产，跳过）");
  }

  const criticalFail = checks.some((c) => c.state === "fail");
  return { checks, ok: !criticalFail };
}
