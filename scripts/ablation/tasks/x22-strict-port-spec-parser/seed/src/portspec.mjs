// Port spec parser.
//
// Turns a comma separated list of ports and ranges into a list of [start, end] pairs.

export class PortSpecError extends Error {
  constructor(code, token, detail) {
    super('invalid port spec: ' + detail);
    this.name = 'PortSpecError';
    this.code = code;
    this.token = token;
  }
}

export function parsePortSpec(text) {
  const ranges = [];
  const tokens = String(text).split(',');
  for (const raw of tokens) {
    const token = raw.trim();
    const bounds = token.split('-');
    if (bounds.length > 1) {
      ranges.push([parseInt(bounds[0], 10), parseInt(bounds[1], 10)]);
    } else {
      const value = parseInt(token, 10);
      ranges.push([value, value]);
    }
  }
  return ranges;
}
