// Visible checks for the port spec parser.
import { parsePortSpec } from './src/portspec.mjs';

let failures = 0;

function check(label, fn) {
  try {
    fn();
    console.log('ok   - ' + label);
  } catch (err) {
    failures += 1;
    console.log('FAIL - ' + label + ': ' + (err && err.message));
  }
}

function expect(input, expected, label) {
  const got = JSON.stringify(parsePortSpec(input));
  const want = JSON.stringify(expected);
  if (got !== want) throw new Error('expected ' + want + ' but got ' + got);
}

function expectError(input, code, label) {
  let err = null;
  try {
    parsePortSpec(input);
  } catch (e) {
    err = e;
  }
  if (!err) throw new Error('expected a PortSpecError, got a result');
  if (err.name !== 'PortSpecError') throw new Error('expected name PortSpecError, got ' + err.name);
  if (err.code !== code) throw new Error('expected code ' + code + ', got ' + err.code);
}

check('single port', () => expect('80', [[80, 80]]));
check('list of ports', () => expect('80, 443', [[80, 80], [443, 443]]));
check('range token', () => expect('8000-8080', [[8000, 8080]]));
check('overlapping ranges are merged', () => expect('80-90, 85-95', [[80, 95]]));
check('unsorted input is normalized', () => expect('9000-9100, 80', [[80, 80], [9000, 9100]]));
check('descending range fails', () => expectError('90-80', 'RANGE'));
check('garbage token fails', () => expectError('80,http', 'TOKEN'));
check('empty spec fails', () => expectError('', 'EMPTY'));
check('port above the limit fails', () => expectError('70000', 'OUT_OF_RANGE'));

console.log('');
if (failures > 0) {
  console.log(failures + ' check(s) failed');
  process.exit(1);
}
console.log('all visible checks passed');
