// Builds the docs site from docs/ into dist/ (gitignored), emulating the
// Jekyll /docs GitHub Pages build: guide/home layouts, includes, pretty
// permalinks, relative-.md-link rewriting, GFM heading slugs.
// Usage: npm run build  (in scripts/docs-preview, after npm install)
import { marked } from "marked";
import { gfmHeadingId } from "marked-gfm-heading-id";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(REPO, "docs");
const OUT = process.env.DOCS_OUT || path.join(REPO, "dist");
const config = fs.readFileSync(path.join(SRC, "_config.yml"), "utf8");
const grab = (key) => config.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1].trim();
const BASE = grab("baseurl");
const SITE = { title: grab("title"), description: grab("description"), url: grab("url") };

marked.use(gfmHeadingId({ prefix: "" }));

const read = (p) => fs.readFileSync(p, "utf8");
const layout = (n) => read(path.join(SRC, "_layouts", n));
const include = (n) => read(path.join(SRC, "_includes", n));

// mirrors the defaults map in docs/_config.yml
const PAGES = {
  "guide/en.md": { lang: "en", title: "Documentation", layout: "guide", description: "Install LazyZCode and run your first goal loop in ZCode — plan gate, evidence bound to git tree hashes, trigger words, hooks, and the full lzy CLI reference." },
  "guide/zh.md": { lang: "zh", title: "文档", layout: "guide", description: "安装 LazyZCode，在 ZCode 里跑通第一个目标循环——计划门、绑 tree hash 的证据、触发词、钩子与 lzy CLI 全参考。" },
  "developers/en.md": { lang: "en", title: "For developers", layout: "page", description: "How LazyZCode works under the hood — the plugin payload, hooks, discipline agents, and the lzy CLI internals, plus how to extend and contribute." },
  "developers/zh.md": { lang: "zh", title: "开发者视角", layout: "page", description: "LazyZCode 的底层机制——插件载荷、钩子、纪律角色与 lzy CLI 内部，以及如何扩展与贡献。" },
  "index.md": { layout: "home" },
};

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith(".") || e.name.startsWith("_")) return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p;
  });
}

const sitePathOf = (rel) => (rel === "index.md" ? "/" : "/" + rel.replace(/\.md$/, "") + "/");

function rewriteMdLinks(html, rel) {
  // jekyll-relative-links emulation: relative .md hrefs -> absolute baseurl pretty paths
  const fromDir = path.posix.dirname(sitePathOf(rel));
  return html.replace(/(href=")([^"#]+?\.md)(#[^"]*)?(")/g, (m, open, href, hash, close) => {
    const target = path.posix.normalize(path.posix.join(fromDir, href)).replace(/\.md$/, "") + "/";
    return `${open}${BASE}${target}${hash ?? ""}${close}`;
  });
}

function liquid(tpl, page, content) {
  // order matters: includes expand first so their internals flow through the
  // later stages (same as Jekyll, where includes are rendered in place)
  let out = tpl.replace(/{% include ([\w.-]+\.html) %}/g, (_, n) => include(n));
  out = out.replace(/{% if page.lang == 'zh' %}([\s\S]*?){% else %}([\s\S]*?){% endif %}/g,
    (_, zh, en) => (page.lang === "zh" ? zh : en));
  const vars = {
    "page.lang": page.lang ?? "en",
    "page.title": page.title ?? SITE.title,
    "page.url": page.url ?? "/",
    "site.title": SITE.title,
    "site.description": SITE.description,
    "site.url": SITE.url,
    "site.baseurl": BASE,
    content,
  };
  out = out.replace(/\{\{\s*page\.title\s*\|\s*default:\s*site\.title\s*\}\}/g, page.title ?? SITE.title);
  out = out.replace(/\{\{\s*page\.description\s*\|\s*default:\s*site\.description\s*\}\}/g, page.description ?? SITE.description);
  out = out.replace(/\{\{\s*page\.lang\s*\|\s*default:\s*'en'\s*\}\}/g, page.lang ?? "en");
  return out.replace(/\{\{\s*([a-z.]+)\s*\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

let built = 0;
for (const file of walk(SRC)) {
  const rel = path.relative(SRC, file);
  if (!rel.endsWith(".md")) continue;
  const meta = { ...(PAGES[rel] ?? { layout: "bare", title: path.basename(rel, ".md") }), url: sitePathOf(rel) };
  const body = rewriteMdLinks(marked.parse(read(file)), rel);
  let html;
  if (meta.layout === "guide" || meta.layout === "page") html = liquid(layout(`${meta.layout}.html`), meta, body);
  else if (meta.layout === "home") html = liquid(layout("home.html"), meta, body);
  else html = liquid(layout("bare.html"), meta, body);
  const outPath = rel === "index.md"
    ? path.join(OUT, "index.html")
    : path.join(OUT, rel.replace(/\.md$/, ""), "index.html");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  built++;
}

fs.cpSync(path.join(SRC, "assets"), path.join(OUT, "assets"), { recursive: true });
if (fs.existsSync(path.join(SRC, "reports"))) fs.cpSync(path.join(SRC, "reports"), path.join(OUT, "reports"), { recursive: true });
// Jekyll copies root-level static files verbatim; mirror the ones we ship
for (const f of ["llms.txt", "sitemap.xml", "robots.txt"]) {
  if (fs.existsSync(path.join(SRC, f))) fs.copyFileSync(path.join(SRC, f), path.join(OUT, f));
}
console.log(`built ${built} pages -> ${path.relative(REPO, OUT)}`);
