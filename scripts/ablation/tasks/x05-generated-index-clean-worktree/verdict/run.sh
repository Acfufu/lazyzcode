#!/usr/bin/env bash
set -u
# Full contract check for the content index builder. Read-only with respect to the repo.
set -u

ROOT="$(pwd)"
TOOL="$ROOT/tools/build-index.mjs"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/index-hidden.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

fail() {
  echo "reason: $1"
  echo "VERDICT: FAIL"
  exit 1
}

run_tool() {
  ( cd "$1" && node "$TOOL" ) >"$WORK/stdout.txt" 2>"$WORK/stderr.txt"
}

file_list() {
  ( cd "$1" && find . -type f | sed 's|^\./||' | LC_ALL=C sort )
}

check_files() {
  file_list "$1" > "$WORK/actual.txt"
  if ! cmp -s "$2" "$WORK/actual.txt"; then
    fail "unexpected file set in $1: [$(tr '\n' ' ' < "$WORK/actual.txt")]"
  fi
}

# --- A: success path, user files kept, scratch cleaned ----------------------
A="$WORK/a"
mkdir -p "$A/content"
printf '%s\n' 'alpha body' > "$A/content/a.md"
printf '%s\n' 'beta body' > "$A/content/Beta.md"
printf '%s\n' 'gamma body' > "$A/content/alpha.md"
printf '%s\n' 'not a source' > "$A/content/ignore.txt"
printf '%s\n' 'scratch' > "$A/content/z.tmp"

run_tool "$A" || fail "success path exited nonzero: $(cat "$WORK/stderr.txt")"
[ -f "$A/out/index.md" ] || fail "out/index.md was not created"

printf '%s\n' '- Beta.md' '- a.md' '- alpha.md' > "$WORK/expected_index.txt"
cmp -s "$WORK/expected_index.txt" "$A/out/index.md" || fail "out/index.md has the wrong content"

printf '%s\n' 'content/Beta.md' 'content/a.md' 'content/alpha.md' 'content/ignore.txt' 'content/z.tmp' 'out/index.md' > "$WORK/expected_a.txt"
check_files "$A" "$WORK/expected_a.txt"

# --- A2: second run is idempotent -------------------------------------------
run_tool "$A" || fail "second run exited nonzero"
cmp -s "$WORK/expected_index.txt" "$A/out/index.md" || fail "second run changed out/index.md"
check_files "$A" "$WORK/expected_a.txt"

# --- B: failing run preserves the previous output ---------------------------
B="$WORK/b"
mkdir -p "$B/content"
printf '%s\n' 'one' > "$B/content/one.md"
run_tool "$B" || fail "preparation run failed"
cp "$B/out/index.md" "$WORK/b_before.md"
mkdir -p "$B/content/broken.md"
run_tool "$B"
rc=$?
[ "$rc" -ne 0 ] || fail "a *.md directory should make the run fail"
cmp -s "$WORK/b_before.md" "$B/out/index.md" || fail "a failing run damaged out/index.md"
printf '%s\n' 'content/one.md' 'out/index.md' > "$WORK/expected_b.txt"
check_files "$B" "$WORK/expected_b.txt"

# --- C: invalid UTF-8 source is rejected ------------------------------------
C="$WORK/c"
mkdir -p "$C/content"
printf '%s\n' 'ok' > "$C/content/ok.md"
printf '\377\376\375\n' > "$C/content/junk.md"
run_tool "$C"
rc=$?
[ "$rc" -ne 0 ] || fail "an invalid UTF-8 source should make the run fail"
printf '%s\n' 'content/junk.md' 'content/ok.md' > "$WORK/expected_c.txt"
check_files "$C" "$WORK/expected_c.txt"

# --- D: stale scratch from an interrupted run is cleared --------------------
D="$WORK/d"
mkdir -p "$D/content" "$D/.build/tmp-old"
printf '%s\n' 'x' > "$D/content/x.md"
printf '%s\n' 'leftover' > "$D/.build/tmp-old/scratch.txt"
run_tool "$D" || fail "run with a stale scratch directory exited nonzero"
printf '%s\n' 'content/x.md' 'out/index.md' > "$WORK/expected_d.txt"
check_files "$D" "$WORK/expected_d.txt"

# --- E: no matching entries produces an empty index -------------------------
E="$WORK/e"
mkdir -p "$E/content"
run_tool "$E" || fail "empty content directory exited nonzero"
[ -f "$E/out/index.md" ] || fail "empty content directory produced no out/index.md"
[ ! -s "$E/out/index.md" ] || fail "empty content directory should produce an empty out/index.md"
printf '%s\n' 'out/index.md' > "$WORK/expected_e.txt"
check_files "$E" "$WORK/expected_e.txt"

# --- F: missing content directory fails cleanly -----------------------------
F="$WORK/f"
mkdir -p "$F"
run_tool "$F"
rc=$?
[ "$rc" -ne 0 ] || fail "missing content directory should make the run fail"
: > "$WORK/expected_empty.txt"
check_files "$F" "$WORK/expected_empty.txt"

echo "VERDICT: PASS"
exit 0
