import { parseLedger, ParseError } from './src/ledger.mjs';

let failures = 0;

function scenario(name, fn) {
  try {
    fn();
    console.log('ok   ' + name);
  } catch (err) {
    failures += 1;
    console.log('FAIL ' + name + ' :: ' + (err && err.message ? err.message : String(err)));
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function rejects(fn, message) {
  try {
    fn();
  } catch (err) {
    if (err instanceof ParseError) {
      return;
    }
    throw new Error(message + ' (raised ' + (err && err.name) + ' instead of ParseError)');
  }
  throw new Error(message + ' (nothing was raised)');
}

scenario('well formed ledger is parsed', () => {
  const result = parseLedger('2024-01-01|10.00|rent\n2024-01-15|-2.50|coffee\n');
  assert(result.entries.length === 2, 'expected 2 entries, got ' + result.entries.length);
  assert(result.entries[0].amount === 1000, 'first amount');
  assert(result.entries[1].amount === -250, 'second amount');
  assert(result.total === 750, 'total');
});

scenario('blank lines are skipped', () => {
  const result = parseLedger('\n2024-01-01|1.00|a\n\n   \n2024-01-02|2.00|b\n');
  assert(result.entries.length === 2, 'expected 2 entries, got ' + result.entries.length);
  assert(result.total === 300, 'total');
});

scenario('non numeric amount is rejected', () => {
  rejects(() => parseLedger('2024-01-01|abc|memo\n'), 'non numeric amount');
});

scenario('empty amount is rejected', () => {
  rejects(() => parseLedger('2024-01-01||memo\n'), 'empty amount');
});

scenario('extra field is rejected', () => {
  rejects(() => parseLedger('2024-01-01|1.00|memo|extra\n'), 'extra field');
});

scenario('impossible date is rejected', () => {
  rejects(() => parseLedger('2023-99-99|1.00|memo\n'), 'impossible date');
});

console.log(failures === 0 ? 'all checks passed' : failures + ' check(s) failed');
process.exit(failures === 0 ? 0 : 1);
