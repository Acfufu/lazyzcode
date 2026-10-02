// Turns a human readable size string into a byte count.
//
// This is the first version that was good enough for the happy path; it is a
// lot more forgiving than the contract it is supposed to implement.

const MULTIPLIERS = {
  B: 1,
  KB: 1000,
  MB: 1000 ** 2,
  GB: 1000 ** 3,
  TB: 1000 ** 4,
  KIB: 1024,
  MIB: 1024 ** 2,
  GIB: 1024 ** 3,
  TIB: 1024 ** 4,
};

const SHAPE = /^([0-9.]+)\s*([a-z]*)$/i;

export function parseByteSize(input) {
  const text = String(input).trim();

  if (text.length === 0) {
    throw new Error('size must not be empty');
  }

  const match = SHAPE.exec(text);
  if (match === null) {
    throw new Error(`cannot read size: ${text}`);
  }

  const amount = Number.parseFloat(match[1]);
  const unit = (match[2] || 'b').toUpperCase();
  const multiplier = MULTIPLIERS[unit];

  if (multiplier === undefined) {
    throw new Error(`unknown unit: ${match[2]}`);
  }

  return Math.round(amount * multiplier);
}
