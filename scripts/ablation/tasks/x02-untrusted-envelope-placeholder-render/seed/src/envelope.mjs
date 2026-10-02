export class EnvelopeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EnvelopeError';
  }
}

const OPEN_MARKER = '--- headers ---';
const BODY_MARKER = '--- body ---';
const HEADER_LINE = /^([a-z][a-z0-9_-]*): (.*)$/;
const PLACEHOLDER = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;

const decodeHeaderValue = (raw) => raw.replace(/\\n/g, '\n').replace(/\\\\/g, '\\');

export const parseDocument = (text) => {
  const src = String(text);
  const open = src.indexOf(OPEN_MARKER);
  if (open === -1) throw new EnvelopeError('missing header marker');
  const split = src.lastIndexOf(BODY_MARKER);
  if (split === -1 || split < open) throw new EnvelopeError('missing body marker');
  const headers = new Map();
  for (const line of src.slice(open + OPEN_MARKER.length, split).split('\n')) {
    const match = HEADER_LINE.exec(line);
    if (match === null) continue;
    headers.set(match[1], decodeHeaderValue(match[2]));
  }
  return { headers, body: src.slice(split + BODY_MARKER.length) };
};

export const expandPlaceholders = (text, vars) => {
  const table = vars ?? {};
  let out = String(text);
  for (let pass = 0; pass < 8; pass += 1) {
    const next = out.replace(PLACEHOLDER, (whole, name) => (
      name in table ? String(table[name]) : whole
    ));
    if (next === out) break;
    out = next;
  }
  return out;
};

export const renderDocument = (text, vars = {}) => {
  const { headers, body } = parseDocument(text);
  const title = headers.get('title') ?? '';
  const priority = Number.parseInt(headers.get('priority') ?? '0', 10);
  return {
    title: expandPlaceholders(title, vars),
    priority,
    body: expandPlaceholders(body, vars),
  };
};
