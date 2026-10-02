#!/usr/bin/env bash
set -u
# Verifies the full behaviour of the document build tool.
set -u

ROOT="$(pwd)"
WORK="$(mktemp -d)"
STATUS=0

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

fail() { printf 'FAIL: %s\n' "$1"; STATUS=1; }

fresh() {
  local dir="$WORK/$1"
  rm -rf "$dir"
  mkdir -p "$dir"
  cp -R "$ROOT/." "$dir/" 2>/dev/null
  printf '%s' "$dir"
}

run() {
  local dir="$1"
  shift
  ( cd "$dir" && node build.mjs "$@" ) >"$WORK/stdout.txt" 2>"$WORK/stderr.txt"
}

tree() {
  ( cd "$1" 2>/dev/null && find . -mindepth 1 | LC_ALL=C sort )
}

snapshot() {
  ( cd "$1" 2>/dev/null && find . -mindepth 1 | LC_ALL=C sort | while IFS= read -r p; do
      if [ -f "$p" ]; then
        printf '%s %s\n' "$p" "$(cksum < "$p")"
      else
        printf '%s DIR\n' "$p"
      fi
    done )
}

want="$(printf './alpha.txt\n./beta.txt')"

# A. explicit output directory, exact tree, untouched sources, clean repository
d="$(fresh base)"
src_before="$(tree "$d/src")"
root_before="$(cd "$d" && ls -A | LC_ALL=C sort)"
run "$d" --out out1
code=$?
if [ "$code" -ne 0 ]; then fail "A: build exited $code"; fi
got="$(tree "$d/out1")"
if [ "$got" != "$want" ]; then fail "A: unexpected output tree: $got"; fi
a="$(cat "$d/out1/alpha.txt" 2>/dev/null)"
if [ "$a" != "$(printf 'TITLE ONE\nBODY LINE TWO')" ]; then fail "A: alpha.txt content mismatch"; fi
b="$(cat "$d/out1/beta.txt" 2>/dev/null)"
if [ "$b" != 'SECOND DOCUMENT' ]; then fail "A: beta.txt content mismatch"; fi
src_after="$(tree "$d/src")"
if [ "$src_before" != "$src_after" ]; then fail "A: source directory was modified"; fi
root_after="$(cd "$d" && ls -A | LC_ALL=C sort)"
root_expect="$( { printf '%s\n' "$root_before"; printf 'out1\n'; } | LC_ALL=C sort -u )"
if [ "$root_after" != "$root_expect" ]; then fail "A: repository polluted: $root_after"; fi

# B. default output directory
d="$(fresh default)"
run "$d"
code=$?
if [ "$code" -ne 0 ]; then fail "B: default build exited $code"; fi
got="$(tree "$d/public")"
if [ "$got" != "$want" ]; then fail "B: default output tree: $got"; fi

# C. leftovers from an earlier run must be removed
d="$(fresh stray)"
mkdir -p "$d/out2/.stage/deep"
printf 'junk\n' > "$d/out2/.stage/deep/x.txt"
printf 'junk\n' > "$d/out2/alpha.txt.part"
printf 'junk\n' > "$d/out2/old.txt"
printf 'junk\n' > "$d/out2/.build-manifest.json"
run "$d" --out out2
code=$?
if [ "$code" -ne 0 ]; then fail "C: build exited $code"; fi
got="$(tree "$d/out2")"
if [ "$got" != "$want" ]; then fail "C: leftovers not cleaned: $got"; fi

# D. a failed build must leave the output directory untouched
d="$(fresh atomic)"
mkdir -p "$d/docs/keep"
printf 'keep me\n' > "$d/docs/keep/note.txt"
printf 'stale\n' > "$d/docs/old.txt"
: > "$d/src/empty.md"
before="$(snapshot "$d/docs")"
run "$d" --out docs
code=$?
after="$(snapshot "$d/docs")"
if [ "$code" -eq 0 ]; then fail "D: build accepted an empty source"; fi
if [ ! -s "$WORK/stderr.txt" ]; then fail "D: no diagnostic on stderr"; fi
if [ "$before" != "$after" ]; then fail "D: output directory changed after a failed build"; fi
if [ ! -f "$d/src/empty.md" ]; then fail "D: source file was removed"; fi

# E. no sources at all
d="$(fresh nosrc)"
rm -f "$d"/src/*.md
run "$d" --out out4
code=$?
if [ "$code" -ne 0 ]; then fail "E: build exited $code with no sources"; fi
if [ ! -d "$d/out4" ]; then fail "E: output directory missing"; fi
got="$(tree "$d/out4")"
if [ -n "$got" ]; then fail "E: output directory not empty: $got"; fi

# F. rendering edge cases and non-markdown files in src
d="$(fresh render)"
printf 'mixed case\r\nsecond line\r\n' > "$d/src/mix.md"
printf 'no trailing newline' > "$d/src/bare.md"
printf 'ignored\n' > "$d/src/notes.txt"
run "$d" --out out5
code=$?
if [ "$code" -ne 0 ]; then fail "F: build exited $code"; fi
got="$(tree "$d/out5")"
wantf="$(printf './alpha.txt\n./bare.txt\n./beta.txt\n./mix.txt')"
if [ "$got" != "$wantf" ]; then fail "F: output tree: $got"; fi
m="$(cat "$d/out5/mix.txt" 2>/dev/null)"
if [ "$m" != "$(printf 'MIXED CASE\nSECOND LINE')" ]; then fail "F: mix.txt content mismatch"; fi
n="$(cat "$d/out5/bare.txt" 2>/dev/null)"
if [ "$n" != 'NO TRAILING NEWLINE' ]; then fail "F: bare.txt content mismatch"; fi

# G. the output location is an ordinary file
d="$(fresh outfile)"
printf 'i am a file\n' > "$d/out-target"
root_before="$(cd "$d" && ls -A | LC_ALL=C sort)"
run "$d" --out out-target
code=$?
if [ "$code" -eq 0 ]; then fail "G: build accepted a file as the output path"; fi
if [ "$(cat "$d/out-target" 2>/dev/null)" != 'i am a file' ]; then fail "G: output path file was damaged"; fi
root_after="$(cd "$d" && ls -A | LC_ALL=C sort)"
if [ "$root_before" != "$root_after" ]; then fail "G: repository polluted: $root_after"; fi

# H. running twice gives the same result
d="$(fresh twice)"
run "$d" --out out6
c1=$?
t1="$(snapshot "$d/out6")"
run "$d" --out out6
c2=$?
t2="$(snapshot "$d/out6")"
if [ "$c1" -ne 0 ] || [ "$c2" -ne 0 ]; then fail "H: repeated build failed ($c1, $c2)"; fi
if [ "$t1" != "$t2" ]; then fail "H: repeated build changed the output"; fi

if [ "$STATUS" -eq 0 ]; then
  printf 'VERDICT: PASS\n'
  exit 0
fi
printf 'VERDICT: FAIL\n'
exit 1
