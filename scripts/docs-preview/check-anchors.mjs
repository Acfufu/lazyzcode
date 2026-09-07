// Verifies sidebar anchor integrity on the BUILT guide pages (end to end:
// markdown headings -> GFM slugs -> built HTML ids must match nav hrefs).
// Prints "en 18/18" / "zh 18/18" lines and exits 1 on any mismatch.
// Usage: node check-anchors.mjs [distDir]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const root = path.resolve(process.argv[2] || path.join(REPO, "dist"));
const decode = (s) => decodeURIComponent(s);

let failures = 0;
for (const lang of ["en", "zh"]) {
  const file = path.join(root, "guide", lang, "index.html");
  if (!fs.existsSync(file)) {
    console.log(`${lang} 0/0 (missing ${path.relative(REPO, file)})`);
    failures++;
    continue;
  }
  const html = fs.readFileSync(file, "utf8");
  const navHrefs = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => decode(m[1]));
  const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => decode(m[1])));
  const navHrefsUnique = [...new Set(navHrefs)];
  const ok = navHrefsUnique.filter((h) => ids.has(h));
  const broken = navHrefsUnique.filter((h) => !ids.has(h));
  console.log(`${lang} ${ok.length}/${navHrefsUnique.length}${broken.length ? " BROKEN: " + broken.join(", ") : ""}`);
  if (broken.length || ok.length === 0) failures++;
}
process.exit(failures ? 1 : 0);
