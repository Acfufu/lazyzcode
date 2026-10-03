#!/usr/bin/env bash
set -u
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/full_check.mjs" <<'JSEOF'
import { pathToFileURL } from "node:url";
const { plan } = await import(pathToFileURL(process.cwd() + "/src/eol.mjs").href);
let bad = 0;
function ok(name, cond) { if (!cond) { console.log("FAIL " + name); bad++; } }
const rules = [
  { pattern: ".md", eol: "lf" },
  { pattern: ".bat", eol: "crlf" },
  { pattern: ".png", eol: null },
  { pattern: "special.md", eol: "crlf" },
];

const files = [
  { path: "keep.md", content: "a\nb\n" },
  { path: "fix.md", content: "a\r\nb\n" },
  { path: "deep/dir/fix.md", content: "x\r\n" },
  { path: "win.bat", content: "a\nb" },
  { path: "ok.bat", content: "a\r\nb\r\n" },
  { path: "img.png", content: "a\r\nb\n\r" },
  { path: "norule.txt", content: "a\r\n\r\n" },
  { path: "empty.md", content: "" },
  { path: "lone.md", content: "a\rb\n" },
  { path: "pkg/special.md", content: "a\nb\n" },
  { path: "nul.md", content: "a\0b\r\n" },
];
const out = plan(files, rules);
ok("same length & order", out.length === files.length && out.every((o, i) => o.path === files[i].path));
const byPath = Object.fromEntries(out.map((o) => [o.path, o.action]));
ok("keep.md ok", byPath["keep.md"] === "ok");
ok("fix.md rewrite", byPath["fix.md"] === "rewrite");
ok("suffix match in subdir", byPath["deep/dir/fix.md"] === "rewrite");
ok("win.bat rewrite (lf vs crlf target)", byPath["win.bat"] === "rewrite");
ok("ok.bat ok", byPath["ok.bat"] === "ok");
ok("binary rule never rewritten", byPath["img.png"] === "ok");
ok("no rule never rewritten", byPath["norule.txt"] === "ok");
ok("empty ok", byPath["empty.md"] === "ok");
ok("lone CR rewrite", byPath["lone.md"] === "rewrite");
ok("last matching rule wins", byPath["pkg/special.md"] === "rewrite");
ok("nul.md rewrite", byPath["nul.md"] === "rewrite");

// purity: inputs not mutated
const f1 = [{ path: "p.md", content: "a\r\n" }];
const r1 = [{ pattern: ".md", eol: "lf" }];
const snapshot = JSON.stringify([f1, r1]);
plan(f1, r1);
ok("inputs unmutated", JSON.stringify([f1, r1]) === snapshot);

ok("empty rules -> all ok", plan([{ path: "a.md", content: "\r\n\r" }], []).every((o) => o.action === "ok"));
if (bad > 0) { console.log("VERDICT: FAIL"); process.exit(1); }
console.log("VERDICT: PASS");
JSEOF
node "$TMP/full_check.mjs"
