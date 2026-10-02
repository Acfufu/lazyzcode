import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function chunkFileName(index) {
  return `chunk-${String(index).padStart(4, '0')}.bin`;
}

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function chunkPath(spoolDir, index) {
  return path.join(spoolDir, chunkFileName(index));
}

export function readJournal(journalPath) {
  if (!fs.existsSync(journalPath)) return [];
  const text = fs.readFileSync(journalPath, 'utf8');
  const records = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '') continue;
    const parts = line.split(' ');
    if (parts.length !== 3) {
      throw new Error(`malformed journal line: ${JSON.stringify(line)}`);
    }
    records.push({ index: Number(parts[0]), bytes: Number(parts[1]), digest: parts[2] });
  }
  return records;
}

export function writeSpool({ sourcePath, spoolDir, chunkSize, journalPath, interruptAfter } = {}) {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error('chunkSize must be a positive integer');
  }
  const data = fs.readFileSync(sourcePath);
  fs.mkdirSync(spoolDir, { recursive: true });
  const journal = journalPath ?? path.join(spoolDir, 'journal.log');
  const total = Math.ceil(data.length / chunkSize);

  const committed = new Set(readJournal(journal).map((record) => record.index));

  let written = 0;
  for (let index = 0; index < total; index += 1) {
    if (committed.has(index)) continue;
    const from = index * chunkSize;
    const to = Math.min(data.length, from + chunkSize);
    const buffer = data.subarray(from, to);
    fs.writeFileSync(chunkPath(spoolDir, index), buffer);
    fs.appendFileSync(journal, `${index} ${buffer.length} ${sha256(buffer)}\n`);
    written += 1;
    if (Number.isInteger(interruptAfter) && written >= interruptAfter) {
      const error = new Error(`spool write interrupted after ${written} chunk(s)`);
      error.code = 'SPOOL_INTERRUPTED';
      throw error;
    }
  }

  return { chunks: total, bytes: data.length };
}

export function assembleSpool({ spoolDir, journalPath, outPath } = {}) {
  const journal = journalPath ?? path.join(spoolDir, 'journal.log');
  const records = readJournal(journal);
  records.sort((a, b) => String(a.index).localeCompare(String(b.index)));
  const parts = records.map((record) => fs.readFileSync(chunkPath(spoolDir, record.index)));
  const buffer = Buffer.concat(parts);
  fs.writeFileSync(outPath, buffer);
  return { chunks: parts.length, bytes: buffer.length };
}
