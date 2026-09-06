// lzy status：全只读检查。启用态以引擎官方 `plugins list --json` 为准（ADR-0001），
// 不读、更不写用户 config.json。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createEngineCli, findInstalledPlugin } from "./engine.js";
import { readGoal } from "./loop.js";
import { findEngine, installPathFor, pluginId } from "./paths.js";
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

  const criticalFail = checks.some((c) => c.state === "fail");
  return { checks, ok: !criticalFail };
}
