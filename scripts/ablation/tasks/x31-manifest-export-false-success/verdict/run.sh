#!/usr/bin/env bash
set -u

ROOT="$(pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/manifest-hidden.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

fail() {
  echo "hidden: $1"
  echo "VERDICT: FAIL"
  exit 1
}

OUT="$TMP/stdout.txt"
STATUS=0

cli() {
  OUT="$TMP/stdout.txt"
  node "$ROOT/run.mjs" "$1" "$2" > "$OUT" 2> "$TMP/stderr.txt"
  STATUS=$?
}

expected_tree() {
  node --input-type=module -e '
import fs from "node:fs";
const args = process.argv.slice(process.argv.length - 2);
const records = JSON.parse(fs.readFileSync(args[0], "utf8"));
const dest = args[1];
for (const r of records) {
  const parts = r.group ? r.group.split("/") : [];
  const dir = [dest].concat(parts).join("/");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dir + "/" + r.id + ".json", JSON.stringify(r, null, 2) + "\n");
}
' "$1" "$2"
}

last() { tail -n 1 "$OUT"; }

# --- 1: valid records, nested groups, exact bytes on disk -------------
D="$TMP/t1"
mkdir -p "$D"
cat > "$D/manifest.json" <<'JSON'
[
  {"id": "a1", "group": "team/one", "name": "Alpha", "value": 3},
  {"id": "b2", "name": "Beta", "value": "x"},
  {"id": "c3", "group": "team", "name": "Gamma", "value": true}
]
JSON

cli "$D/manifest.json" "$D/out"
[ "$STATUS" -eq 0 ] || fail "nested groups: exit code $STATUS, expected 0"
[ "$(last)" = "summary: written=3 failed=0 total=3" ] || fail "nested groups: last line '$(last)'"
grep -qx "record 0: ok team/one/a1.json" "$OUT" || fail "nested groups: missing 'record 0: ok team/one/a1.json'"
[ "$(grep -c '^record [0-9][0-9]*: ok ' "$OUT")" -eq 3 ] || fail "nested groups: expected three ok lines"
expected_tree "$D/manifest.json" "$D/expected"
diff -r "$D/expected" "$D/out" > "$TMP/d.txt" 2>&1 || fail "nested groups: written tree differs: $(head -n 3 "$TMP/d.txt")"

# --- 2: records whose id breaks the rules -----------------------------
D="$TMP/t2"
mkdir -p "$D"
cat > "$D/manifest.json" <<'JSON'
[
  {"id": "Bad", "name": "upper"},
  {"id": "9x", "name": "digit first"},
  {"id": "good-1", "name": "fine"}
]
JSON

cli "$D/manifest.json" "$D/out"
[ "$STATUS" -eq 1 ] || fail "bad ids: exit code $STATUS, expected 1"
[ "$(last)" = "summary: written=1 failed=2 total=3" ] || fail "bad ids: last line '$(last)'"
grep -q '^record 0: failed invalid id$' "$OUT" || fail "bad ids: missing failure line for record 0"
grep -q '^record 1: failed invalid id$' "$OUT" || fail "bad ids: missing failure line for record 1"
[ -f "$D/out/good-1.json" ] || fail "bad ids: good-1.json was not written"
[ -e "$D/out/Bad.json" ] && fail "bad ids: Bad.json must not exist"
[ -e "$D/out/9x.json" ] && fail "bad ids: 9x.json must not exist"

# --- 3: records whose group breaks the rules --------------------------
D="$TMP/t3"
mkdir -p "$D"
cat > "$D/manifest.json" <<'JSON'
[
  {"id": "g1", "group": "a//b", "name": "x"},
  {"id": "g2", "group": "../up", "name": "y"},
  {"id": "g3", "group": "Team/x", "name": "z"},
  {"id": "g4", "group": "/abs", "name": "w"}
]
JSON

cli "$D/manifest.json" "$D/out"
[ "$STATUS" -eq 1 ] || fail "bad groups: exit code $STATUS, expected 1"
[ "$(last)" = "summary: written=0 failed=4 total=4" ] || fail "bad groups: last line '$(last)'"
[ -e "$D/up" ] && fail "bad groups: output escaped the output directory"
if [ -d "$D/out" ]; then
  if find "$D/out" -type f | grep -q .; then fail "bad groups: files were written for unusable records"; fi
fi

# --- 4: two records aiming at the same file ---------------------------
D="$TMP/t4"
mkdir -p "$D"
cat > "$D/manifest.json" <<'JSON'
[
  {"id": "dup", "name": "first"},
  {"id": "dup", "name": "second"},
  {"id": "dup", "group": "g", "name": "third"}
]
JSON

cli "$D/manifest.json" "$D/out"
[ "$STATUS" -eq 1 ] || fail "repeat target: exit code $STATUS, expected 1"
[ "$(last)" = "summary: written=2 failed=1 total=3" ] || fail "repeat target: last line '$(last)'"
grep -q '^record 1: failed duplicate id$' "$OUT" || fail "repeat target: missing duplicate line for record 1"
[ -f "$D/out/g/dup.json" ] || fail "repeat target: g/dup.json was not written"
node --input-type=module -e '
import fs from "node:fs";
const p = process.argv[process.argv.length - 1];
const want = JSON.stringify({ id: "dup", name: "first" }, null, 2) + "\n";
if (fs.readFileSync(p, "utf8") !== want) { console.error("mismatch"); process.exit(1); }
' "$D/out/dup.json" || fail "repeat target: dup.json does not hold the first record"

# --- 5: the target directory is blocked by an existing file ------------
D="$TMP/t5"
mkdir -p "$D/out"
: > "$D/out/grp"
cat > "$D/manifest.json" <<'JSON'
[{"id": "x", "group": "grp", "name": "n"}]
JSON

cli "$D/manifest.json" "$D/out"
[ "$STATUS" -eq 1 ] || fail "blocked target: exit code $STATUS, expected 1"
[ "$(last)" = "summary: written=0 failed=1 total=1" ] || fail "blocked target: last line '$(last)'"
grep -q '^record 0: failed write failed$' "$OUT" || fail "blocked target: missing write failure line"
[ -f "$D/out/grp" ] || fail "blocked target: the existing file was replaced"

# --- 6: manifest that cannot be processed ------------------------------
D="$TMP/t6"
mkdir -p "$D"
printf '{"records": []}\n' > "$D/manifest.json"
cli "$D/manifest.json" "$D/out"
[ "$STATUS" -eq 2 ] || fail "non-array manifest: exit code $STATUS, expected 2"
grep -q '^summary:' "$OUT" && fail "non-array manifest: a summary line was printed"

printf 'not json\n' > "$D/manifest.json"
cli "$D/manifest.json" "$D/out2"
[ "$STATUS" -eq 2 ] || fail "invalid manifest: exit code $STATUS, expected 2"
grep -q '^summary:' "$OUT" && fail "invalid manifest: a summary line was printed"

echo "VERDICT: PASS"
exit 0
