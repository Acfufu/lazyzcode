import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pricing } from './src/pricing.mjs';

const work = mkdtempSync(path.join(tmpdir(), 'pricing-check-'));
const dataDir = path.join(work, 'data');
const cachePath = path.join(work, 'cache', 'prices.json');
cpSync(path.join(import.meta.dirname, 'data'), dataDir, { recursive: true });

const problems = [];
const expect = (condition, message) => {
  if (!condition) problems.push(message);
};
const near = (actual, wanted) => typeof actual === 'number' && Math.abs(actual - wanted) < 1e-6;
const ids = (list) => (Array.isArray(list) ? [...list].sort().join(',') : String(list));

const first = await new Pricing({ dataDir, cachePath }).load();
expect(near(first.prices.a1, 9.9), 'a1 should be 9.9, got ' + first.prices.a1);
expect(near(first.prices.b2, 22), 'b2 should be 22, got ' + first.prices.b2);
expect(near(first.prices.c3, 4.4), 'c3 should be 4.4, got ' + first.prices.c3);
expect(ids(first.recomputed) === 'a1,b2,c3', 'the first load should compute every product, got ' + ids(first.recomputed));
expect(existsSync(cachePath), 'no cache file was written to ' + cachePath);

const second = await new Pricing({ dataDir, cachePath }).load();
expect(ids(second.recomputed) === '', 'an unchanged reload should reuse every cached price, got ' + ids(second.recomputed));
expect(
  near(second.prices.a1, 9.9) && near(second.prices.b2, 22) && near(second.prices.c3, 4.4),
  'cached prices changed on the second load'
);

writeFileSync(
  path.join(dataDir, 'products', 'b2.json'),
  JSON.stringify({ id: 'b2', basePrice: 30, category: 'toy' }, null, 2) + '\n'
);

const third = await new Pricing({ dataDir, cachePath }).load();
expect(near(third.prices.b2, 33), 'b2 should be 33 after its base price changes, got ' + third.prices.b2);
expect(ids(third.recomputed) === 'b2', 'only b2 should be recomputed, got ' + ids(third.recomputed));
expect(near(third.prices.a1, 9.9), 'a1 should still be served from the cache, got ' + third.prices.a1);

rmSync(work, { recursive: true, force: true });

if (problems.length > 0) {
  console.log('CHECK FAILED');
  for (const problem of problems) console.log(' - ' + problem);
  process.exit(1);
}

console.log('CHECK PASSED');
