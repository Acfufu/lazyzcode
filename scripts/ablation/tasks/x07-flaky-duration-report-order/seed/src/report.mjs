import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'data';

const listShards = (target) =>
  readdir(target).then((names) =>
    names.filter((name) => name.endsWith('.json')).map((name) => join(target, name)),
  );

const localStamp = (iso) => new Date(iso).toLocaleString();

const files = await listShards(dir);
const totals = new Map();
let latest = '';

for (const file of files) {
  const shard = JSON.parse(await readFile(file, 'utf8'));
  const label = localStamp(shard.run);
  if (latest === '' || label > latest) {
    latest = label;
  }
  for (const item of shard.results) {
    const row = totals.get(item.test) ?? { count: 0, total: 0 };
    row.count += 1;
    row.total += item.durationMs;
    totals.set(item.test, row);
  }
}

const rows = [...totals.entries()].map(([name, row]) => ({ name, ...row }));
rows.sort((a, b) => b.total - a.total || Math.random() - 0.5);

const out = [];
out.push('REPORT');
out.push(`generated: ${new Date().toISOString()}`);
out.push(`runs: ${files.length}`);
out.push(`latest: ${latest}`);
out.push(`tests: ${rows.length}`);
out.push('--');
for (const row of rows) {
  out.push(`${row.name} ${row.count} ${row.total.toFixed(2)} ${(row.total / row.count).toFixed(2)}`);
}

process.stdout.write(out.join('\n') + '\n');
