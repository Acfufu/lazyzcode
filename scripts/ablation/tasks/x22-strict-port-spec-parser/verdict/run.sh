#!/usr/bin/env bash
set -u

REPO_ROOT="$(pwd)"
export REPO_ROOT

TMP_DIR="$(mktemp -d)" || { echo "VERDICT: FAIL"; exit 1; }
trap 'rm -rf "$TMP_DIR"' EXIT

cat > "$TMP_DIR/contract.mjs" <<'CONTRACT_EOF'
import { pathToFileURL } from 'node:url';

const root = process.env.REPO_ROOT;
const problems = [];

let mod = null;
try {
  mod = await import(pathToFileURL(root + '/src/portspec.mjs').href);
} catch (err) {
  console.log('FAIL - cannot import src/portspec.mjs: ' + (err && err.message));
  process.exit(1);
}

const parsePortSpec = mod.parsePortSpec;
const PortSpecError = mod.PortSpecError;

if (typeof PortSpecError !== 'function') problems.push('PortSpecError is not exported');
if (typeof parsePortSpec !== 'function') problems.push('parsePortSpec is not exported as a function');
const runnable = typeof parsePortSpec === 'function';

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) problems.push(label + ': expected ' + b + ', got ' + a);
}

function okSpec(input, expected, label) {
  if (!runnable) return;
  let result;
  try {
    result = parsePortSpec(input);
  } catch (err) {
    problems.push(label + ': unexpected throw (' + (err && err.message) + ')');
    return;
  }
  eq(result, expected, label);
}

function badSpec(input, code, label, token) {
  if (!runnable) return;
  let err = null;
  try {
    parsePortSpec(input);
  } catch (e) {
    err = e;
  }
  if (!err) {
    problems.push(label + ': expected a throw with code ' + code);
    return;
  }
  if (!(err instanceof Error)) {
    problems.push(label + ': thrown value is not an Error instance');
    return;
  }
  if (err.name !== 'PortSpecError') {
    problems.push(label + ': error name is ' + err.name);
    return;
  }
  if (typeof PortSpecError === 'function' && !(err instanceof PortSpecError)) {
    problems.push(label + ': error is not an instance of the exported PortSpecError');
  }
  if (err.code !== code) {
    problems.push(label + ': expected code ' + code + ', got ' + err.code);
    return;
  }
  if (token !== undefined && err.token !== token) {
    problems.push(label + ': expected token ' + JSON.stringify(token) + ', got ' + JSON.stringify(err.token));
  }
}

// valid specs
okSpec('80', [[80, 80]], 'single port');
okSpec(' 443 , 80 ', [[80, 80], [443, 443]], 'whitespace and unsorted input');
okSpec('1', [[1, 1]], 'lowest port');
okSpec('65535', [[65535, 65535]], 'highest port');
okSpec('00001', [[1, 1]], 'padded number inside digit limit');
okSpec('0080-0090', [[80, 90]], 'padded range bounds');
okSpec('80 - 90', [[80, 90]], 'spaces around hyphen');
okSpec('\t80\t-\t90\t', [[80, 90]], 'tabs around hyphen');
okSpec('80-80', [[80, 80]], 'degenerate range');
okSpec('80-90,85-95', [[80, 95]], 'overlapping ranges');
okSpec('80-90,91-100', [[80, 100]], 'touching ranges');
okSpec('80,80,80', [[80, 80]], 'duplicate tokens');
okSpec('80-90, 5-10, 11-12', [[5, 12], [80, 90]], 'merge plus reorder');
okSpec('100-200,1-50,60,55-58', [[1, 50], [55, 58], [60, 60], [100, 200]], 'sorting and gaps');
okSpec('1000,1000-1010', [[1000, 1010]], 'port touching a range start');
okSpec('80-90,92-100', [[80, 90], [92, 100]], 'real gap is not merged');

// malformed specs
badSpec('', 'EMPTY', 'empty spec', null);
badSpec('    ', 'EMPTY', 'whitespace-only spec', null);
badSpec(80, 'TYPE', 'non-string argument', null);
badSpec(null, 'TYPE', 'null argument', null);
badSpec('80,', 'TOKEN', 'trailing comma', '');
badSpec(',80', 'TOKEN', 'leading comma', '');
badSpec('80,,443', 'TOKEN', 'doubled comma', '');
badSpec('abc', 'TOKEN', 'letters', 'abc');
badSpec('80a', 'TOKEN', 'trailing letters', '80a');
badSpec('1e3', 'TOKEN', 'exponent notation', '1e3');
badSpec('0x50', 'TOKEN', 'hex notation', '0x50');
badSpec('+80', 'TOKEN', 'plus sign', '+80');
badSpec('80.5', 'TOKEN', 'decimal point', '80.5');
badSpec('\u0668\u0660', 'TOKEN', 'non-ascii digits', '\u0668\u0660');
badSpec('00000080', 'TOKEN', 'too many digits', '00000080');
badSpec('9'.repeat(60), 'TOKEN', 'absurdly long number');
badSpec('0', 'OUT_OF_RANGE', 'zero port', '0');
badSpec('65536', 'OUT_OF_RANGE', 'one above the maximum', '65536');
badSpec('99999', 'OUT_OF_RANGE', 'five-digit value above the maximum', '99999');
badSpec('0-10', 'OUT_OF_RANGE', 'range starting at zero', '0-10');
badSpec('65000-70000', 'OUT_OF_RANGE', 'range bound above the maximum', '65000-70000');
badSpec('90-80', 'RANGE', 'descending range', '90-80');
badSpec('80-', 'RANGE', 'missing end bound', '80-');
badSpec('-80', 'RANGE', 'missing start bound', '-80');
badSpec('80-90-100', 'RANGE', 'too many hyphens', '80-90-100');
badSpec('8 0-90', 'RANGE', 'space inside a bound', '8 0-90');
badSpec('80-9x', 'RANGE', 'non-numeric end bound', '80-9x');
badSpec('--', 'RANGE', 'hyphens only', '--');
badSpec('-', 'RANGE', 'lone hyphen', '-');

if (problems.length > 0) {
  for (const problem of problems) console.log('FAIL - ' + problem);
  console.log(problems.length + ' contract problem(s)');
  process.exit(1);
}
console.log('all contract checks passed');
process.exit(0);
CONTRACT_EOF

if node "$TMP_DIR/contract.mjs"; then
  echo "VERDICT: PASS"
  exit 0
fi
echo "VERDICT: FAIL"
exit 1
