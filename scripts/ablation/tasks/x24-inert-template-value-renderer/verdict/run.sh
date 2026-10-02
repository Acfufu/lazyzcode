#!/usr/bin/env bash
set -u
# Full verification for the template renderer.
set -u

ROOT="$(pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/render-verify.XXXXXX")"
T="$WORK/template.txt"
D="$WORK/data.json"
OUT="$WORK/out.txt"
ERR="$WORK/err.txt"
EXP="$WORK/expected.txt"

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

PASSED=0
FAILED=0
STATUS=0

ok() { PASSED=$((PASSED + 1)); }

bad() {
  FAILED=$((FAILED + 1))
  printf 'failed: %s\n' "$1" >&2
}

run() {
  node "$ROOT/render.mjs" "$T" "$D" >"$OUT" 2>"$ERR"
  STATUS=$?
}

expect_stdout() {
  local name="$1"
  local expected="$2"
  if [ "$STATUS" -ne 0 ]; then
    bad "$name: exit $STATUS (expected 0); stderr: $(head -c 120 "$ERR" | tr '\n' ' ')"
    return
  fi
  printf '%s' "$expected" > "$EXP"
  if cmp -s "$EXP" "$OUT"; then
    ok
  else
    bad "$name: stdout mismatch; got $(od -c "$OUT" | head -4 | tr '\n' ' ')"
  fi
}

expect_error() {
  local name="$1"
  if [ "$STATUS" -ne 2 ]; then
    bad "$name: exit $STATUS (expected 2)"
    return
  fi
  if [ -s "$OUT" ]; then
    bad "$name: stdout should be empty on error"
    return
  fi
  case "$(cat "$ERR")" in
    "error: "*) ok ;;
    *) bad "$name: stderr should start with 'error: '" ;;
  esac
}

# --- plain substitution ---------------------------------------------------
cat > "$T" <<'EOF'
hello {{name}}
EOF
cat > "$D" <<'EOF'
{"name": "world"}
EOF
run
expect_stdout "plain substitution" $'hello world\n'

# --- conditional with a taken branch --------------------------------------
cat > "$T" <<'EOF'
@if flag
yes {{n}}
@else
no
@endif
EOF
cat > "$D" <<'EOF'
{"flag": 1, "n": 7}
EOF
run
expect_stdout "taken branch" $'yes 7\n'

# --- a value cannot inject @else ------------------------------------------
cat > "$T" <<'EOF'
@if show
A {{note}}
@else
B
@endif
EOF
cat > "$D" <<'EOF'
{"show": true, "note": "x\n@else\nB2"}
EOF
run
expect_stdout "value cannot inject @else" $'A x\n@else\nB2\n'

# --- a value cannot open a block ------------------------------------------
cat > "$T" <<'EOF'
START
{{note}}
END
EOF
cat > "$D" <<'EOF'
{"note": "p\n@if drop", "drop": false}
EOF
run
expect_stdout "value cannot open a block" $'START\np\n@if drop\nEND\n'

# --- a value cannot close a block early -----------------------------------
cat > "$T" <<'EOF'
@if on
first {{v}}
last
@endif
after
EOF
cat > "$D" <<'EOF'
{"on": true, "v": "x\n@endif\nafter-injected"}
EOF
run
expect_stdout "value cannot close a block" $'first x\n@endif\nafter-injected\nlast\nafter\n'

# --- inserted text is not re-expanded -------------------------------------
cat > "$T" <<'EOF'
a={{a}}
EOF
cat > "$D" <<'EOF'
{"a": "{{b}}", "b": "BOOM"}
EOF
run
expect_stdout "no re-expansion" $'a={{b}}\n'

# --- prototype names are not keys -----------------------------------------
cat > "$T" <<'EOF'
@if toString
LEAK
@endif
done
EOF
cat > "$D" <<'EOF'
{"x": 1}
EOF
run
expect_stdout "prototype name is not a key" $'done\n'

# --- unknown placeholder in emitted text ----------------------------------
cat > "$T" <<'EOF'
v={{nope}}
EOF
cat > "$D" <<'EOF'
{"x": 1}
EOF
run
expect_error "unknown placeholder is an error"

# --- prototype name as a placeholder --------------------------------------
cat > "$T" <<'EOF'
v={{toString}}
EOF
cat > "$D" <<'EOF'
{"x": 1}
EOF
run
expect_error "prototype placeholder is an error"

# --- a dead branch is not resolved ----------------------------------------
cat > "$T" <<'EOF'
@if off
{{missing}}
@endif
tail
EOF
cat > "$D" <<'EOF'
{"off": false}
EOF
run
expect_stdout "dead branch is not resolved" $'tail\n'

# --- structure is checked even in a dead branch ---------------------------
cat > "$T" <<'EOF'
@if off
@bogus
@endif
tail
EOF
cat > "$D" <<'EOF'
{"off": false}
EOF
run
expect_error "unknown directive in a dead branch"

# --- unsupported value type -----------------------------------------------
cat > "$T" <<'EOF'
v={{obj}}
EOF
cat > "$D" <<'EOF'
{"obj": {"a": 1}}
EOF
run
expect_error "object value is an error"

# --- scalar formatting ----------------------------------------------------
cat > "$T" <<'EOF'
{{a}}|{{b}}|{{c}}|{{d}}|{{e}}
EOF
cat > "$D" <<'EOF'
{"a": 0, "b": -0, "c": 1.5, "d": true, "e": null}
EOF
run
expect_stdout "scalar formatting" $'0|0|1.5|true|\n'

# --- braces outside the placeholder grammar are literal -------------------
cat > "$T" <<'EOF'
a {{}} b {{ x y }} c {{k}} d
EOF
cat > "$D" <<'EOF'
{"k": "K"}
EOF
run
expect_stdout "literal braces" $'a {{}} b {{ x y }} c K d\n'

# --- spaced placeholder ---------------------------------------------------
cat > "$T" <<'EOF'
x={{ key }}
EOF
cat > "$D" <<'EOF'
{"key": "V"}
EOF
run
expect_stdout "spaced placeholder" $'x=V\n'

# --- inline directive-looking text is harmless ----------------------------
cat > "$T" <<'EOF'
note: {{note}}
EOF
cat > "$D" <<'EOF'
{"note": "@endif"}
EOF
run
expect_stdout "inline @endif is text" $'note: @endif\n'

# --- nothing emitted ------------------------------------------------------
cat > "$T" <<'EOF'
@if a
hidden
@endif
EOF
cat > "$D" <<'EOF'
{"a": false}
EOF
run
expect_stdout "empty output" ''

# --- template without a final newline -------------------------------------
printf 'one\ntwo' > "$T"
printf '%s' '{}' > "$D"
run
expect_stdout "template without trailing newline" $'one\ntwo\n'

# --- directive errors -----------------------------------------------------
printf '@else\n' > "$T"
printf '%s' '{}' > "$D"
run
expect_error "@else without @if"

printf '@endif\n' > "$T"
printf '%s' '{}' > "$D"
run
expect_error "@endif without @if"

cat > "$T" <<'EOF'
@if a
x
@else
y
@else
z
@endif
EOF
cat > "$D" <<'EOF'
{"a": true}
EOF
run
expect_error "duplicate @else"

cat > "$T" <<'EOF'
@if a
x
EOF
cat > "$D" <<'EOF'
{"a": true}
EOF
run
expect_error "unclosed @if"

cat > "$T" <<'EOF'
@include secret.txt
EOF
cat > "$D" <<'EOF'
{}
EOF
run
expect_error "unknown directive is an error"

# --- data must be an object -----------------------------------------------
printf 'x\n' > "$T"
printf '%s' '[1,2]' > "$D"
run
expect_error "array data is an error"

if [ "$FAILED" -eq 0 ]; then
  printf 'VERDICT: PASS\n'
  exit 0
fi

printf 'VERDICT: FAIL\n'
exit 1
