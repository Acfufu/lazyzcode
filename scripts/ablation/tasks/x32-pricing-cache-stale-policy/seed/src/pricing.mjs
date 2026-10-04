import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CACHE_VERSION = 1;

function round2(value) {
  return Math.round(value * 100) / 100;
}

function priceOf(product, policy) {
  const discount = policy.discounts?.[product.category] ?? 0;
  return round2(product.basePrice * (1 - discount) * (1 + policy.taxRate));
}

export class Pricing {
  constructor({ dataDir = 'data', cachePath = 'cache/prices.json' } = {}) {
    this.dataDir = dataDir;
    this.productsDir = path.join(dataDir, 'products');
    this.policyPath = path.join(dataDir, 'policy.json');
    this.cachePath = cachePath;
  }

  async readCache() {
    let raw;
    try {
      raw = await readFile(this.cachePath, 'utf8');
    } catch {
      return null;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    if (!parsed || parsed.version !== CACHE_VERSION) return null;
    if (!parsed.prices || typeof parsed.prices !== 'object') return null;
    return parsed.prices;
  }

  async writeCache(prices) {
    await mkdir(path.dirname(this.cachePath), { recursive: true });
    const body = JSON.stringify({ version: CACHE_VERSION, prices }, null, 2) + '\n';
    await writeFile(this.cachePath, body, 'utf8');
  }

  async load() {
    const cached = await this.readCache();
    const policy = JSON.parse(await readFile(this.policyPath, 'utf8'));
    const names = (await readdir(this.productsDir)).filter((name) => name.endsWith('.json')).sort();

    const prices = {};
    const recomputed = [];

    for (const name of names) {
      const product = JSON.parse(await readFile(path.join(this.productsDir, name), 'utf8'));
      if (cached && Object.prototype.hasOwnProperty.call(cached, product.id)) {
        prices[product.id] = cached[product.id];
      } else {
        prices[product.id] = priceOf(product, policy);
        recomputed.push(product.id);
      }
    }

    await this.writeCache(prices);
    return { prices, recomputed };
  }
}
