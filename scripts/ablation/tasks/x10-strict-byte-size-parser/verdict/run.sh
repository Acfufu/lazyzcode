#!/usr/bin/env bash
set -u
# Full contract verification for the byte-size tools.
# Read-only with respect to the repository: scratch files live in a temp dir.

set -u

REPO_ROOT="$(pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/bytesize-check.XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

status=0

fail() {
  status=1
  echo "FAIL: $1"
}

cat > "$WORK/module-check.mjs" <<'NODE_SCRIPT'
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

async function main() {
  const repoRoot = process.env.REPO_ROOT;
  let failures = 0;

  function describe(value) {
    try {
      const text = JSON.stringify(value);
      return text === undefined ? String(value) : text;
    } catch {
      return String(value);
    }
  }

  function report(message) {
    failures += 1;
    console.log(`FAIL: ${message}`);
  }

  let parseByteSize;
  try {
    const url = pathToFileURL(join(repoRoot, 'src', 'parse-size.mjs')).href;
    const loaded = await import(url);
    parseByteSize = loaded.parseByteSize;
  } catch (error) {
    console.log(`FAIL: cannot import src/parse-size.mjs (${error && error.message})`);
    return 1;
  }

  if (typeof parseByteSize !== 'function') {
    console.log('FAIL: parseByteSize is not exported as a function');
    return 1;
  }

  function expectValue(input, expected) {
    let actual;
    try {
      actual = parseByteSize(input);
    } catch (error) {
      report(`${describe(input)} threw ${error && error.name}: expected ${expected}`);
      return;
    }
    if (typeof actual !== 'number' || !Object.is(actual, expected)) {
      report(`${describe(input)} returned ${String(actual)}: expected ${expected}`);
    }
  }

  function expectThrows(input, errorName) {
    let actual;
    try {
      actual = parseByteSize(input);
    } catch (error) {
      if (!(error instanceof Error)) {
        report(`${describe(input)}: thrown value is not an Error`);
        return;
      }
      if (error.name !== errorName) {
        report(`${describe(input)} threw ${error.name}: expected ${errorName}`);
      }
      return;
    }
    report(`${describe(input)} returned ${String(actual)}: expected ${errorName}`);
  }

  const valueCases = [
    ['1 B', 1],
    ['1KB', 1000],
    ['1 KB', 1000],
    ['1 KiB', 1024],
    ['2.5 MB', 2500000],
    ['0.5 KiB', 512],
    ['0.001 KB', 1],
    ['0 B', 0],
    ['3 TiB', 3298534883328],
    ['  12 GiB  ', 12884901888],
    ['1024 B', 1024],
    ['1.5 KB', 1500],
    ['9007199254740991 B', 9007199254740991],
  ];

  const syntaxCases = [
    '',
    '   ',
    '1024',
    'KB',
    '1 kb',
    '1 kib',
    '1 KIB',
    '1 XB',
    '1 KB!',
    '1  KB',
    '1\tKB',
    '01 KB',
    '00 B',
    '-1 B',
    '+1 KB',
    '1e3 B',
    '1.5 B',
    '1.0001 KB',
    '.5 KB',
    '1. KB',
    '1.KB',
    '1,5 KB',
    '1 KB extra',
  ];

  const rangeCases = [
    '9007199254740992 B',
    '9007.2 TB',
    '1.001 KiB',
    '999999999999999999999999 TB',
    '9007199254740991.001 KB',
  ];

  const typeCases = [1024, 0, null, undefined, true, {}, [], 10n, new String('1 KB')];

  for (const [input, expected] of valueCases) {
    expectValue(input, expected);
  }
  for (const input of syntaxCases) {
    expectThrows(input, 'SyntaxError');
  }
  for (const input of rangeCases) {
    expectThrows(input, 'RangeError');
  }
  for (const input of typeCases) {
    expectThrows(input, 'TypeError');
  }

  return failures;
}

const failures = await main();

if (failures > 0) {
  console.log(`${failures} module check failure(s)`);
  process.exitCode = 1;
} else {
  console.log('module checks: ok');
}
NODE_SCRIPT

if ! REPO_ROOT="$REPO_ROOT" node "$WORK/module-check.mjs"; then
  fail "parseByteSize does not match the full contract"
fi

run_cli() {
  local errfile="$1"
  shift
  ( cd "$REPO_ROOT" && node src/cli.mjs "$@" ) 2>"$errfile"
}

# valid arguments
err_valid="$WORK/err-valid.txt"
out_valid=$(run_cli "$err_valid" 1KB "2.5 MB")
code_valid=$?
if [ "$code_valid" -ne 0 ]; then
  fail "cli exited with $code_valid for valid arguments"
fi
if [ "$out_valid" != "1000
2500000" ]; then
  fail "cli stdout for valid arguments: [$out_valid]"
fi

# mixed valid and malformed arguments
err_mixed="$WORK/err-mixed.txt"
out_mixed=$(run_cli "$err_mixed" 1KB bogus)
code_mixed=$?
if [ "$code_mixed" -ne 2 ]; then
  fail "cli exited with $code_mixed for a malformed argument (expected 2)"
fi
if [ -n "$out_mixed" ]; then
  fail "cli wrote to stdout although an argument was malformed: [$out_mixed]"
fi
if [ ! -s "$err_mixed" ]; then
  fail "cli wrote no error message for the malformed argument"
fi

# no arguments
err_none="$WORK/err-none.txt"
out_none=$(run_cli "$err_none")
code_none=$?
if [ "$code_none" -ne 2 ]; then
  fail "cli exited with $code_none without arguments (expected 2)"
fi
if [ -n "$out_none" ]; then
  fail "cli wrote to stdout without arguments: [$out_none]"
fi
if [ ! -s "$err_none" ]; then
  fail "cli wrote no usage line without arguments"
fi

# out of range argument
err_range="$WORK/err-range.txt"
out_range=$(run_cli "$err_range" "9007199254740992 B")
code_range=$?
if [ "$code_range" -ne 2 ]; then
  fail "cli exited with $code_range for an out of range size (expected 2)"
fi
if [ -n "$out_range" ]; then
  fail "cli wrote to stdout for an out of range size: [$out_range]"
fi

if [ "$status" -eq 0 ]; then
  echo "VERDICT: PASS"
  exit 0
fi

echo "VERDICT: FAIL"
exit 1
