// 安装器：cache 落位 + 注册表幂等追加 + 经引擎官方 CLI 启用（ADR-0001）。
// 对 config.json 零写入；enable 环节失败时降级为打印官方命令（指引式回退）。
import { createHash, randomUUID } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { createEngineCli } from "./engine.js";
import {
  MARKETPLACE,
  findEngine,
  installPathFor,
  pluginId,
  registryPath,
  repoManifestPath,
  repoPluginDir,
} from "./paths.js";

export function readRepoManifest() {
  return JSON.parse(readFileSync(repoManifestPath(), "utf8"));
}

function sha256File(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function readRegistry() {
  try {
    const reg = JSON.parse(readFileSync(registryPath(), "utf8"));
    return {
      version: reg.version ?? 1,
      plugins: Array.isArray(reg.plugins) ? reg.plugins : [],
    };
  } catch {
    return { version: 1, plugins: [] };
  }
}

function writeRegistryAtomic(reg) {
  const target = registryPath();
  mkdirSync(dirname(target), { recursive: true });
  const tmp = join(
    dirname(target),
    `.${basename(target)}.${process.pid}.${Date.now()}.tmp`,
  );
  writeFileSync(tmp, `${JSON.stringify(reg, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, target);
}

function registryEntry(manifest, installPath) {
  const id = pluginId(manifest);
  const now = new Date().toISOString();
  const prev = readRegistry().plugins.find((p) => p.id === id);
  return {
    id,
    name: manifest.name,
    marketplace: MARKETPLACE,
    version: manifest.version,
    installPath,
    installedAt: prev?.installedAt ?? now,
    updatedAt: now,
    scope: "user",
    source: {
      source: "url",
      type: "zip",
      url: `file://${repoPluginDir()}`,
      sha256: sha256File(repoManifestPath()),
      path: manifest.name,
    },
    cacheTransactionId: prev?.cacheTransactionId ?? randomUUID(),
  };
}

export function upsertRegistryEntry(manifest, installPath) {
  const reg = readRegistry();
  const entry = registryEntry(manifest, installPath);
  reg.plugins = [...reg.plugins.filter((p) => p.id !== entry.id), entry];
  writeRegistryAtomic(reg);
  return entry;
}

export function findRegistryEntry(manifest) {
  const id = pluginId(manifest);
  return readRegistry().plugins.find((p) => p.id === id) ?? null;
}

export function removeFromRegistry(id) {
  const reg = readRegistry();
  const before = reg.plugins.length;
  reg.plugins = reg.plugins.filter((p) => p.id !== id);
  writeRegistryAtomic(reg);
  return reg.plugins.length < before;
}

// 把仓库 plugin/ 载荷整目录部署到引擎缓存（也是 lzy sync 的热重载原语）。
export function deployFiles(manifest) {
  const dest = installPathFor(manifest);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(repoPluginDir(), dest, { recursive: true });
  return dest;
}

const MANUAL_ENABLE_HINT = (id) =>
  `请手动执行官方命令完成启用：\n  zcode plugins enable ${id}\n` +
  `(或直接用引擎：node "$LZY_ZCODE_ENGINE" plugins enable ${id})`;

export async function install() {
  const manifest = readRepoManifest();
  const id = pluginId(manifest);
  const dest = deployFiles(manifest);
  upsertRegistryEntry(manifest, dest);

  let enabled = false;
  let note = null;
  const result = createEngineCli(findEngine()).enable(id);
  if (result.ok) {
    enabled = true;
  } else {
    note = result.error ?? "启用命令失败";
  }

  return {
    id,
    version: manifest.version,
    installPath: dest,
    enabled,
    note: enabled ? null : `${note ?? ""}\n${MANUAL_ENABLE_HINT(id)}`,
  };
}

export async function sync() {
  const manifest = readRepoManifest();
  const dest = deployFiles(manifest);
  upsertRegistryEntry(manifest, dest);
  return { id: pluginId(manifest), version: manifest.version, installPath: dest };
}

export async function uninstall() {
  const manifest = readRepoManifest();
  const id = pluginId(manifest);
  const steps = [];

  let engineRemoved = false;
  const result = createEngineCli(findEngine()).uninstall(id);
  engineRemoved = result.ok;
  if (!result.ok) {
    steps.push(`官方卸载未成功：${result.error ?? result.stderr ?? ""}`);
  }

  const stillRegistered = findRegistryEntry(manifest) !== null;
  if (stillRegistered) {
    removeFromRegistry(id);
    steps.push("已从注册表移除（回退路径）");
  }
  if (!engineRemoved) {
    steps.push(
      `可选清理：官方命令可一并移除 config 中的启用残留\n  zcode plugins uninstall ${id} --force`,
    );
  }
  rmSync(installPathFor(manifest), { recursive: true, force: true });

  return { id, engineRemoved, fallbackUsed: stillRegistered || !engineRemoved, steps };
}
