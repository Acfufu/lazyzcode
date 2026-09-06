// lzy status：全只读检查。启用态以引擎官方 `plugins list --json` 为准（ADR-0001）；
// 对用户 config.json 永不写入——只读诊断段（codegraph 探测）允许读它。
// 诊断探测 spawn 沿 git.js 安全形态：可执行为字面量常量、argv 字面量、shell:false。
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createEngineCli, findInstalledPlugin } from "./engine.js";
import { readGoal } from "./loop.js";
import {
  findEngine,
  installPathFor,
  pluginId,
  userCliConfigPath,
} from "./paths.js";
import { findRegistryEntry, readRepoManifest } from "./installer.js";

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

  const entry = findRegistryEntry(manifest);
  if (!entry) {
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

  const cacheManifest = join(installPathFor(manifest), ".zcode-plugin", "plugin.json");
  push(
    "files",
    existsSync(cacheManifest) ? "ok" : "fail",
    existsSync(cacheManifest) ? "缓存载荷完整" : "缓存缺 manifest（运行 lzy sync）",
  );

  if (engineVersion) {
    const list = eng.listJson();
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
    const diags = (list?.diagnostics ?? []).filter((d) =>
      JSON.stringify(d).includes(id),
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
