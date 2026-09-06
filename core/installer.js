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
import { basename, dirname, join, relative } from "node:path";
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
  let raw;
  try {
    raw = readFileSync(registryPath(), "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return { version: 1, plugins: [] };
    throw err; // 损坏/无权限：必须上抛。空表回写会抹掉注册表里其他插件的条目（评审 R3-1）。
  }
  const reg = JSON.parse(raw);
  return {
    version: reg.version ?? 1,
    plugins: Array.isArray(reg.plugins) ? reg.plugins : [],
  };
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

// 除 updatedAt 外逐字段等值（评审 R3-7：语义幂等升格为字节幂等，重复 install 不再漂移注册表）。
function entryEquals(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (k === "updatedAt") continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  }
  return true;
}

export function upsertRegistryEntry(manifest, installPath) {
  const reg = readRegistry();
  const entry = registryEntry(manifest, installPath);
  const prev = reg.plugins.find((p) => p.id === entry.id);
  if (prev && entryEquals(prev, entry)) return prev; // 全等即跳过重写：注册表字节不漂移
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

// 守卫运行态（.mimosa/）与系统杂物（.DS_Store）不得进缓存；.zcode-plugin 是清单目录必须保留。
function isDotResidue(rel) {
  return rel
    .split(/[\\/]/)
    .some((seg) => seg.startsWith(".") && seg !== ".zcode-plugin");
}

// 把仓库 plugin/ 载荷整目录部署到引擎缓存（也是 lzy sync 的热重载原语）。
// 先落同父 tmp 再整体换装：并发会话不会看到 rm→cp 空窗里的半份载荷（评审 R3-3）。
export function deployFiles(manifest) {
  const dest = installPathFor(manifest);
  const parent = dirname(dest);
  mkdirSync(parent, { recursive: true });
  const tmp = join(parent, `.${basename(dest)}.${process.pid}.${Date.now()}.tmp`);
  try {
    cpSync(repoPluginDir(), tmp, {
      recursive: true,
      filter: (src) => !isDotResidue(relative(repoPluginDir(), src)),
    });
    rmSync(dest, { recursive: true, force: true });
    renameSync(tmp, dest);
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
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

  // 先读记录再删账：缓存路径用注册表里的 installPath——manifest 版本可能已变，
  // 按 manifest 推导会删错版本、留下孤儿（评审 R3-5）。注册表损坏时 readRegistry 上抛=拒绝在账目不明时动文件。
  const entry = findRegistryEntry(manifest);
  if (entry) {
    removeFromRegistry(id);
    steps.push("已从注册表移除");
  }
  if (!engineRemoved) {
    steps.push(
      `可选清理：官方命令可一并移除 config 中的启用残留\n  zcode plugins uninstall ${id} --force`,
    );
  }
  rmSync(entry?.installPath ?? installPathFor(manifest), { recursive: true, force: true });

  // installed=是否真有安装物被动过：cli 头行按事实给 ✔/➖，不再无中生有打绿勾（评审 R3-8）。
  const installed = Boolean(entry) || engineRemoved;
  return { id, engineRemoved, installed, fallbackUsed: entry !== null || !engineRemoved, steps };
}
