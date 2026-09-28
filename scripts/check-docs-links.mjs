#!/usr/bin/env node
// docs 断链/锚点检查器（0.4.0 M5 N3，M4 输入 9①）：docs/**/*.md 的相对链接与同页/跨页
// 锚点存在性。零依赖零网络；外部 http(s)/mailto 跳过；Jekyll front-matter 与代码块内容
// 容忍（不产生伪断链）；_layouts/_includes 等非内容面不扫；Liquid {{ }} 模板占位跳过。
// exit 0=全过；exit 1=断链清单（逐条 文件:行 点名）；exit 2=用法。接 CI docs job 与
// lzy.project.json check 清单（docs-links 项）。
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

function parseArgs(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next != null && !next.startsWith("--")) {
      f[a.slice(2)] = next;
      i += 1;
    } else f[a.slice(2)] = true;
  }
  return f;
}
const f = parseArgs(process.argv.slice(2));
if (f.help === true) {
  console.log("用法: check-docs-links.mjs [--root <docs 所在根，默认 .>]");
  process.exit(0);
}
const ROOT = resolve(typeof f.root === "string" ? f.root : ".");
const DOCS = join(ROOT, "docs");
const SKIP_DIRS = new Set(["_layouts", "_includes", "_site", "node_modules", ".jekyll-cache", ".sass-cache"]);
const BROKEN = [];

// GitHub 风格标题 slug（中文标题保留 CJK 字符、空白折叠为 -）；另收原始小写文本做宽容匹配。
function headingSlugs(text) {
  const slugs = new Set();
  for (const line of text.split("\n")) {
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const raw = m[2].replace(/`/g, "");
    slugs.add(raw.toLowerCase());
    const gh = raw
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s\-_]/gu, "")
      .trim()
      .replace(/\s/g, "-"); // 逐空格替换（GitHub 语义：「Hooks & lifecycle」删 & 留双空格 ⇒ #hooks--lifecycle）
    slugs.add(gh);
  }
  return slugs;
}

// 正文预处理：剥 front-matter 与围栏/行内代码——代码块里的示例链接不是断链。
function stripNonContent(text) {
  const lines = [];
  let inFm = text.startsWith("---");
  let inFence = false;
  for (const [i, line] of text.split("\n").entries()) {
    if (inFm) {
      if (i > 0 && /^---\s*$/.test(line)) inFm = false;
      lines.push("");
      continue;
    }
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      lines.push("");
      continue;
    }
    lines.push(inFence ? "" : line.replace(/`[^`]*`/g, " "));
  }
  return lines;
}

function listMd(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) out.push(...listMd(p));
    } else if (name.endsWith(".md") || name.endsWith(".markdown")) {
      out.push(p);
    }
  }
  return out;
}

const mdFiles = listMd(DOCS);
const anchorCache = new Map();
const anchorsOf = (p) => {
  if (!anchorCache.has(p)) anchorCache.set(p, headingSlugs(readFileSync(p, "utf8")));
  return anchorCache.get(p);
};

for (const file of mdFiles) {
  const rel = relative(ROOT, file).split("\\").join("/");
  const lines = stripNonContent(readFileSync(file, "utf8"));
  const linkRe = /\[[^\]]*\]\(\s*([^)\s]*(?:\s[^)\s]*)*)\s*\)/g;
  for (const [idx, line] of lines.entries()) {
    for (const m of line.matchAll(linkRe)) {
      const target = m[1].trim().split("<")[0].trim();
      if (!target || target.startsWith("http://") || target.startsWith("https://") || target.startsWith("mailto:")) continue;
      if (target.includes("{{") || target.includes("{%")) continue; // Liquid 模板占位
      const [pathPartRaw, ...anchorParts] = target.split("#");
      const anchor = anchorParts.join("#");
      const pathPart = pathPartRaw.trim();
      let dest;
      if (pathPart === "") {
        dest = file; // 纯同页锚点
      } else {
        dest = resolve(dirname(file), decodeURIComponent(pathPart));
        if (!existsSync(dest)) {
          BROKEN.push(`${rel}:${idx + 1} 相对链接目标不存在：${target}`);
          continue;
        }
        try {
          if (statSync(dest).isDirectory()) {
            const idxMd = join(dest, "index.md");
            if (!existsSync(idxMd)) BROKEN.push(`${rel}:${idx + 1} 目录链接缺 index.md：${target}`);
            else if (anchor && !anchorsOf(idxMd).has(anchor.toLowerCase())) BROKEN.push(`${rel}:${idx + 1} 锚点不存在：${target}`);
            continue;
          }
        } catch {
          /* stat 失败已由 existsSync 前置排除 */
        }
        if (!/\.(md|markdown)$/i.test(dest)) continue; // 非文档资产（图片等）只核存在性
      }
      if (anchor && !anchorsOf(dest).has(anchor.toLowerCase())) {
        BROKEN.push(`${rel}:${idx + 1} 锚点不存在：${target}`);
      }
    }
  }
}

if (BROKEN.length > 0) {
  console.error(`[docs-links] 断链 ${BROKEN.length} 条：`);
  for (const b of BROKEN) console.error(`  ✖ ${b}`);
  process.exit(1);
}
console.log(`[docs-links] docs/**/*.md 断链/锚点检查通过（扫描 ${mdFiles.length} 个文件）`);
