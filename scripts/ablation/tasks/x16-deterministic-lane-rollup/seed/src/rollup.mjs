import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadRuns(dir) {
  const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
  const runs = [];
  for (const name of files) {
    const text = readFileSync(join(dir, name), 'utf8');
    runs.push(JSON.parse(text));
  }
  return runs;
}

export function buildReport(runs) {
  const grouped = new Map();
  for (const run of runs) {
    if (!grouped.has(run.lane)) grouped.set(run.lane, []);
    grouped.get(run.lane).push(run);
  }

  const lanes = [];
  for (const [lane, list] of grouped) {
    const ok = list.filter((run) => run.status === 'ok').length;
    const totalMs = list.reduce((sum, run) => sum + run.ms, 0);
    const order = list
      .slice()
      .sort((a, b) => b.ms - a.ms)
      .map((run) => run.id);
    lanes.push({
      lane,
      runs: list.length,
      ok,
      failed: list.length - ok,
      totalMs,
      order,
    });
  }

  lanes.sort((a, b) => a.lane.localeCompare(b.lane));

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    lanes,
  };
}

export function reportFor(dir) {
  return buildReport(loadRuns(dir));
}
