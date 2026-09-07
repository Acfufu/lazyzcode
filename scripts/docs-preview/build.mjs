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
const SITE = { title: grab("title"), description: grab("description") };

marked.use(gfmHeadingId({ prefix: "" }));

const read = (p) => fs.readFileSync(p, "utf8");
const layout = (n) => read(path.join(SRC, "_layouts", n));
const include = (n) => read(path.join(SRC, "_includes", n));

// mirrors the defaults map in docs/_config.yml
const PAGES = {
  "guide/en.md": { lang: "en", title: "Documentation", layout: "guide" },
  "guide/zh.md": { lang: "zh", title: "文档", layout: "guide" },
  "developers/en.md": { lang: "en", title: "For developers", layout: "page" },
  "developers/zh.md": { lang: "zh", title: "开发者视角", layout: "page" },
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
  let out = tpl.replace(/{% if page.lang == 'zh' %}([\s\S]*?){% else %}([\s\S]*?){% endif %}/g,
    (_, zh, en) => (page.lang === "zh" ? zh : en));
  out = out.replace(/{% include (nav-en|nav-zh)\.html %}/g, (_, n) => include(`${n}.html`));
  const vars = {
    "page.lang": page.lang ?? "en",
    "page.title": page.title ?? SITE.title,
    "site.title": SITE.title,
    "site.description": SITE.description,
    "site.baseurl": BASE,
    content,
  };
  out = out.replace(/\{\{\s*page\.title\s*\|\s*default:\s*site\.title\s*\}\}/g, page.title ?? SITE.title);
  out = out.replace(/\{\{\s*page\.lang\s*\|\s*default:\s*'en'\s*\}\}/g, page.lang ?? "en");
  return out.replace(/\{\{\s*([a-z.]+)\s*\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

const bareShell = (title, content) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<link rel="stylesheet" href="${BASE}/assets/docs.css"></head>
<body><div class="wrap layout" style="grid-template-columns:1fr"><main class="content">${content}</main></div></body></html>`;

let built = 0;
for (const file of walk(SRC)) {
  const rel = path.relative(SRC, file);
  if (!rel.endsWith(".md")) continue;
  const meta = PAGES[rel] ?? { layout: "bare", title: path.basename(rel, ".md") };
  const body = rewriteMdLinks(marked.parse(read(file)), rel);
  let html;
  if (meta.layout === "guide" || meta.layout === "page") html = liquid(layout(`${meta.layout}.html`), meta, body);
  else if (meta.layout === "home") html = liquid(layout("home.html"), meta, body);
  else html = bareShell(meta.title, body);
  const outPath = rel === "index.md"
    ? path.join(OUT, "index.html")
    : path.join(OUT, rel.replace(/\.md$/, ""), "index.html");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  built++;
}

fs.cpSync(path.join(SRC, "assets"), path.join(OUT, "assets"), { recursive: true });
if (fs.existsSync(path.join(SRC, "reports"))) fs.cpSync(path.join(SRC, "reports"), path.join(OUT, "reports"), { recursive: true });
console.log(`built ${built} pages -> ${path.relative(REPO, OUT)}`);
