// Text ledger parsing.
//
// A ledger is a newline separated list of records with the shape
//
//   date|amount|memo
//
// The module turns that text into entries whose amounts are integer minor units.

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

export class ParseError extends Error {
  constructor(message, line) {
    super(message);
    this.name = 'ParseError';
    this.line = line === undefined ? null : line;
  }
}

export function parseAmount(text) {
  const value = Number(text);
  if (Number.isNaN(value)) {
    throw new ParseError('amount is not a number: ' + String(text), null);
  }
  return Math.round(value * 100);
}

export function parseLedger(text) {
  const lines = String(text).split('\n');
  const entries = [];
  let total = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const lineNumber = i + 1;
    const line = lines[i].trim();
    if (line === '') {
      continue;
    }

    const parts = line.split('|');
    const date = parts[0];
    const amountText = parts[1];
    const memo = parts[2] === undefined ? '' : parts[2];

    if (!DATE_SHAPE.test(date)) {
      throw new ParseError('unrecognized date: ' + date, lineNumber);
    }

    let amount;
    try {
      amount = parseAmount(amountText);
    } catch (err) {
      throw new Error('unrecognized amount on line ' + lineNumber + ': ' + amountText);
    }

    if (memo === '') {
      throw new ParseError('missing memo', lineNumber);
    }

    entries.push({ date, amount, memo });
    total += amount;
  }

  return { entries, total };
}
