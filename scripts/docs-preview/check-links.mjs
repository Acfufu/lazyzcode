// Crawls the built site (default dist/) and verifies every local link
// resolves to a built page or file. Prints "pages: N local links: M broken: K"
// and exits 1 when any link is broken.
// Usage: node check-links.mjs [distDir]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const root = path.resolve(process.argv[2] || path.join(REPO, "dist"));
// same source of truth as build.mjs: baseurl lives in docs/_config.yml
const config = fs.readFileSync(path.join(REPO, "docs", "_config.yml"), "utf8");
const BASE = config.match(/^baseurl:\s*(.+)$/m)?.[1].trim() ?? "";

const pages = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith(".html")) pages.push(p);
  }
})(root);

let local = 0;
const broken = [];
for (const p of pages) {
  const html = fs.readFileSync(p, "utf8");
  const url = path.relative(root, p).replace(/index\.html$/, "");
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const h = m[1];
    if (/^(https?:|mailto:|#)/.test(h)) continue;
    local++;
    const clean = decodeURIComponent(h.split("#")[0]);
    const abs = clean.startsWith("/")
      ? path.join(root, clean.replace(new RegExp(`^${BASE}`), ""))
      : path.resolve(path.dirname(p), clean);
    const hit = fs.existsSync(abs) &&
      (fs.statSync(abs).isFile() || fs.existsSync(path.join(abs, "index.html")));
    if (!hit) broken.push(`${url || "/"} -> ${h}`);
  }
}
console.log(`pages: ${pages.length} local links: ${local} broken: ${broken.length}`);
broken.forEach((b) => console.log(`  BROKEN ${b}`));
process.exit(broken.length ? 1 : 0);
