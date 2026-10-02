#!/usr/bin/env bash
set -u

ROOT="$(pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/notespack.XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

fail() {
  echo "FAIL: $1"
  echo "VERDICT: FAIL"
  exit 1
}

command -v node >/dev/null 2>&1 || fail "node is not available"

TREE="$WORK/tree"
mkdir -p "$TREE"
cp -R "$ROOT/." "$TREE/" >/dev/null 2>&1 || fail "could not copy the project for testing"
rm -rf "$TREE/dist" "$TREE/.git" "$TREE/node_modules"

build() {
  ( cd "$TREE" && node pack.mjs ) >/dev/null 2>&1
}

list_dist() {
  ( cd "$TREE" && find dist -type f 2>/dev/null ) | sort
}

dist_snapshot() {
  ( cd "$TREE" && find dist -type f -exec cksum {} + 2>/dev/null ) | sort
}

outside_snapshot() {
  ( cd "$TREE" && find . -path ./dist -prune -o -print ) | sort
  ( cd "$TREE" && find . -path ./dist -prune -o -type f -exec cksum {} + ) | sort
}

BASELINE="$(outside_snapshot)"

EXPECTED_ALL="dist/index.json
dist/intro.md
dist/notes/archive/old.md
dist/notes/todo.txt"

build || fail "running 'node pack.mjs' did not succeed"

ACTUAL="$(list_dist)"
[ "$ACTUAL" = "$EXPECTED_ALL" ] || fail "dist/ does not hold exactly the packed documents
--- expected ---
$EXPECTED_ALL
--- actual ---
$ACTUAL"

cmp -s "$TREE/dist/intro.md" "$TREE/src/intro.md" || fail "dist/intro.md is not a copy of its source"
cmp -s "$TREE/dist/notes/todo.txt" "$TREE/src/notes/todo.txt" || fail "dist/notes/todo.txt is not a copy of its source"
cmp -s "$TREE/dist/notes/archive/old.md" "$TREE/src/notes/archive/old.md" || fail "dist/notes/archive/old.md is not a copy of its source"

node --input-type=module -e '
import fs from "node:fs";
import path from "node:path";
const dir = process.argv[process.argv.length - 1];
const names = ["intro.md", "notes/archive/old.md", "notes/todo.txt"];
let index;
try {
  index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
} catch (err) {
  console.error("index.json is not valid JSON: " + err.message);
  process.exit(1);
}
if (index === null || typeof index !== "object" || Array.isArray(index)) {
  console.error("index.json is not an object");
  process.exit(1);
}
const keys = Object.keys(index).sort();
if (keys.join("|") !== names.slice().sort().join("|")) {
  console.error("index.json lists: " + keys.join(", "));
  process.exit(1);
}
for (const name of names) {
  const size = fs.statSync(path.join(dir, name)).size;
  if (index[name] !== size) {
    console.error("index.json size for " + name + " is " + index[name] + ", expected " + size);
    process.exit(1);
  }
}
' "$TREE/dist" || fail "dist/index.json does not describe the packed documents"

DIST_BEFORE="$(dist_snapshot)"
build || fail "the second build did not succeed"
DIST_AFTER="$(dist_snapshot)"
[ "$DIST_BEFORE" = "$DIST_AFTER" ] || fail "running the build twice changed the contents of dist/"

OUTSIDE_AFTER="$(outside_snapshot)"
[ "$BASELINE" = "$OUTSIDE_AFTER" ] || fail "the build created, changed or removed entries outside dist/"

rm -f "$TREE/src/notes/todo.txt"
build || fail "the build failed after a source document was removed"

ACTUAL="$(list_dist)"
EXPECTED_REMOVED="dist/index.json
dist/intro.md
dist/notes/archive/old.md"
[ "$ACTUAL" = "$EXPECTED_REMOVED" ] || fail "dist/ still holds output whose source is gone
--- expected ---
$EXPECTED_REMOVED
--- actual ---
$ACTUAL"

node --input-type=module -e '
import fs from "node:fs";
import path from "node:path";
const dir = process.argv[process.argv.length - 1];
const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
const keys = Object.keys(index).sort();
if (keys.join("|") !== "intro.md|notes/archive/old.md") {
  console.error("index.json lists: " + keys.join(", "));
  process.exit(1);
}
' "$TREE/dist" || fail "dist/index.json still lists documents that no longer exist"

rm -f "$TREE/src/notes/archive/old.md"
build || fail "the build failed after a nested source document was removed"

[ ! -e "$TREE/dist/notes" ] || fail "dist/ kept a folder that no longer has any source document"

ACTUAL="$(list_dist)"
EXPECTED_EMPTY="dist/index.json
dist/intro.md"
[ "$ACTUAL" = "$EXPECTED_EMPTY" ] || fail "dist/ does not match the current sources
--- expected ---
$EXPECTED_EMPTY
--- actual ---
$ACTUAL"

echo "VERDICT: PASS"
exit 0
