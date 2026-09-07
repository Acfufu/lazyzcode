// AGENTS.md 分层项目记忆的确定性骨架（tier-1 init-deep，ADR-0002）。
// 角色分配：模型=提案者（plugin/skills/init-deep 产草稿）、人=批准者（草稿先行），
// 本模块=执法者（资格谓词+覆盖审计，纯代码可判、两次跑结果一致），doctor/CI=巡逻队。
// 事实源：ZCode 引擎原生逐级读 AGENTS.md（多源合并 + 100KB 注入截断）——分层与行数
// 上限是防截断的结构手段，子目录文件被引擎自动合并，无需任何配置。
// 本模块零 spawn，全部同步语义。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

// 行数软上限（防 100KB 截断；skill 文本与检查共用同一口径）。根上限对齐本仓宪法
// §9.2 的 150 行预算口径；子目录地图应当更短。
export const ROOT_LINE_CAP = 150;
export const CHILD_LINE_CAP = 40;
// 资格谓词：直接文件数超过此值即有资格（无构建入口的纯内容大目录，如 docs/）
export const FILE_COUNT_QUALIFIER = 40;
// 扫描深度：根=0，子目录至多 3 层（与上游 lazycodex 默认一致；对话可覆盖，无旗标）
export const MAX_DEPTH = 3;

// 独立工作单元的构建入口（文件存在性判定，确定性）
const BUILD_MANIFESTS = new Set([
  "package.json", "go.mod", "Cargo.toml", "Makefile", "pyproject.toml",
  "requirements.txt", "Gemfile", "pom.xml", "build.gradle", "build.gradle.kts",
  "meson.build", "CMakeLists.txt", "composer.json",
]);
// 永不进入的目录（依赖/产物/VCS/宿主状态）
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".lazyzcode", ".zcode", "dist", "build", "out",
  "target", "vendor", ".venv", "__pycache__", ".next", ".cache", "coverage",
]);

function listEntries(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

// 行数口径与 wc -l 一致：末尾换行不折算成第 N+1 行空行（否则 150 行预算的文件被误报 151）
const countLines = (text) => {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.length;
};

// 根 AGENTS.md 对目录的「提及」判定：仓库地图式写法 `<name>/`（带斜杠才算目录提及，
// 避免把普通单词误判成提及）。提及=根文件声明覆盖，不再要求子文件。
function rootMentions(rootText) {
  const names = new Set();
  for (const m of rootText.matchAll(/([A-Za-z0-9._-]+)\//g)) names.add(m[1]);
  return names;
}

function childFileLines(dir) {
  try {
    return countLines(readFileSync(join(dir, "AGENTS.md"), "utf8"));
  } catch {
    return null;
  }
}

// 资格谓词：①直含构建入口 ②直接文件数 > FILE_COUNT_QUALIFIER ③根 AGENTS.md 提及。
// 三者任一即「有资格」；提及同时意味着覆盖（根文件声明管了它）。
function qualifies({ hasManifest, fileCount, mentioned }) {
  return hasManifest || fileCount > FILE_COUNT_QUALIFIER || mentioned;
}

// 扫描 + 审计一次完成；不修改任何文件（提案面归技能，本模块只读）。
export function auditAgentsMd(root, { maxDepth = MAX_DEPTH } = {}) {
  const result = {
    rootExists: false,
    rootLines: 0,
    dirs: [], // { path, hasManifest, manifest, fileCount, mentioned, qualifies, hasChild, childLines }
    missing: [], // 有资格且既无子文件也未被根提及
    over: [], // { path, lines, cap } 行数超软上限
  };
  let rootText = null;
  try {
    rootText = readFileSync(join(root, "AGENTS.md"), "utf8");
  } catch {
    return result;
  }
  result.rootExists = true;
  result.rootLines = countLines(rootText);
  if (result.rootLines > ROOT_LINE_CAP) result.over.push({ path: "AGENTS.md", lines: result.rootLines, cap: ROOT_LINE_CAP });
  const mentions = rootMentions(rootText);

  const walk = (dir, rel, depth) => {
    const entries = listEntries(dir);
    if (!entries) return;
    const subdirs = [];
    const files = [];
    for (const e of entries) {
      if (e.name.startsWith(".")) continue; // 隐藏目录整族跳过（VCS/宿主状态/依赖点目录）
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) subdirs.push(e.name);
      } else {
        files.push(e.name);
      }
    }
    const manifest = files.find((f) => BUILD_MANIFESTS.has(f)) ?? null;
    if (rel) {
      const hasChild = existsSync(join(dir, "AGENTS.md"));
      const childLines = hasChild ? childFileLines(dir) : null;
      const info = {
        path: rel,
        hasManifest: manifest !== null,
        manifest,
        fileCount: files.length,
        mentioned: mentions.has(basename(rel)),
        qualifies: false,
        hasChild,
        childLines,
      };
      info.qualifies = qualifies(info);
      result.dirs.push(info);
      if (info.qualifies && !hasChild && !info.mentioned) result.missing.push(info.path);
      if (hasChild && childLines !== null && childLines > CHILD_LINE_CAP) {
        result.over.push({ path: `${rel}/AGENTS.md`, lines: childLines, cap: CHILD_LINE_CAP });
      }
    }
    if (depth >= maxDepth) return;
    for (const name of subdirs) {
      walk(join(dir, name), rel ? `${rel}/${name}` : name, depth + 1);
    }
  };
  walk(root, "", 0);
  return result;
}

// 人读详单：lzy agents-md 与 doctor agents-md 共用同一口径。
export function formatAgentsMd(a) {
  if (!a.rootExists) return "根 AGENTS.md 不存在（lazyzcode:init-deep 可生成分层项目记忆）";
  const qualifying = a.dirs.filter((d) => d.qualifies);
  const covered = qualifying.filter((d) => d.hasChild || d.mentioned).length;
  const lines = [
    `根 AGENTS.md ${a.rootLines} 行（上限 ${ROOT_LINE_CAP}）· 资格目录 ${qualifying.length} · 覆盖 ${covered} · 缺 ${a.missing.length} · 超限 ${a.over.length}`,
  ];
  for (const d of qualifying) {
    const how = d.hasChild ? "子文件在" : d.mentioned ? "根地图覆盖" : "缺";
    const why = d.hasManifest
      ? `构建入口 ${d.manifest}`
      : d.fileCount > FILE_COUNT_QUALIFIER
        ? `${d.fileCount} 个文件`
        : d.mentioned
          ? "根提及"
          : "—";
    lines.push(`  ${d.hasChild || d.mentioned ? "✔" : "✖"} ${d.path}/  ${how}（${why}${d.childLines !== null ? `，${d.childLines} 行` : ""}）`);
  }
  for (const o of a.over) lines.push(`  ⚠ ${o.path} ${o.lines} 行 > 上限 ${o.cap}`);
  if (a.missing.length > 0) lines.push(`  缺口处置：补子目录 AGENTS.md，或在根文件仓库地图提及 <dir>/（显式声明由根覆盖）`);
  return lines.join("\n");
}
