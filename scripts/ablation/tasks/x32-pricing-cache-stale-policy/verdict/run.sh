#!/usr/bin/env bash
set -u

TMP_RUN="$(mktemp -d 2>/dev/null || mktemp -d -t pricing-check)"
trap 'rm -rf "$TMP_RUN"' EXIT

cat > "$TMP_RUN/harness.mjs" <<'HARNESS_EOF'
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pricing-sandbox-"));
const repo = path.join(root, "repo");
fs.cpSync(process.cwd(), repo, {
  recursive: true,
  filter: (p) => !p.includes(".git"),
});

const moduleUrl = pathToFileURL(path.join(repo, "src", "pricing.mjs")).href;
const dataDir = path.join(repo, "data");
const cachePath = path.join(root, "cache", "prices.json");

const problems = [];
function expect(condition, message) {
  if (!condition) problems.push(message);
}
function near(actual, wanted) {
  return typeof actual === "number" && Math.abs(actual - wanted) < 1e-6;
}
function sameIds(actual, wanted) {
  if (!Array.isArray(actual)) return false;
  return [...actual].sort().join(",") === [...wanted].sort().join(",");
}
function writeProduct(id, product) {
  fs.writeFileSync(
    path.join(dataDir, "products", id + ".json"),
    JSON.stringify(product, null, 2) + "\n"
  );
}
function writePolicy(policy) {
  fs.writeFileSync(
    path.join(dataDir, "policy.json"),
    JSON.stringify(policy, null, 2) + "\n"
  );
}
function removeProduct(id) {
  fs.rmSync(path.join(dataDir, "products", id + ".json"));
}

let run = 0;
async function load() {
  const mod = await import(moduleUrl + "?run=" + (++run));
  const engine = new mod.Pricing({ dataDir, cachePath });
  return engine.load();
}

const policyBase = { taxRate: 0.1, discounts: { book: 0.1, toy: 0, gear: 0.2 } };
const policyHigher = { taxRate: 0.2, discounts: { book: 0.1, toy: 0, gear: 0.2 } };

fs.rmSync(cachePath, { force: true });
let result = await load();
expect(near(result.prices.a1, 9.9), "cold start: a1 expected 9.9 but got " + result.prices.a1);
expect(near(result.prices.b2, 22), "cold start: b2 expected 22 but got " + result.prices.b2);
expect(near(result.prices.c3, 4.4), "cold start: c3 expected 4.4 but got " + result.prices.c3);
expect(sameIds(result.recomputed, ["a1", "b2", "c3"]), "cold start: recomputed should be a1,b2,c3 but got " + JSON.stringify(result.recomputed));
expect(fs.existsSync(cachePath), "cold start: no cache file was written");

result = await load();
expect(sameIds(result.recomputed, []), "unchanged reload: recomputed should be empty but got " + JSON.stringify(result.recomputed));
expect(near(result.prices.a1, 9.9) && near(result.prices.b2, 22) && near(result.prices.c3, 4.4), "unchanged reload: wrong prices");

writeProduct("b2", { id: "b2", basePrice: 30, category: "toy" });
result = await load();
expect(near(result.prices.b2, 33), "product edit: b2 expected 33 but got " + result.prices.b2);
expect(sameIds(result.recomputed, ["b2"]), "product edit: recomputed should be b2 only but got " + JSON.stringify(result.recomputed));
expect(near(result.prices.a1, 9.9) && near(result.prices.c3, 4.4), "product edit: untouched products changed");

writePolicy(policyHigher);
result = await load();
expect(near(result.prices.a1, 10.8), "policy edit: a1 expected 10.8 but got " + result.prices.a1);
expect(near(result.prices.b2, 36), "policy edit: b2 expected 36 but got " + result.prices.b2);
expect(near(result.prices.c3, 4.8), "policy edit: c3 expected 4.8 but got " + result.prices.c3);
expect(sameIds(result.recomputed, ["a1", "b2", "c3"]), "policy edit: every product should be recomputed but got " + JSON.stringify(result.recomputed));

writePolicy(policyBase);
result = await load();
expect(near(result.prices.a1, 9.9) && near(result.prices.b2, 33) && near(result.prices.c3, 4.4), "policy revert: wrong prices");

writeProduct("d4", { id: "d4", basePrice: 8, category: "book" });
result = await load();
expect(near(result.prices.d4, 7.92), "new product: d4 expected 7.92 but got " + result.prices.d4);
expect(sameIds(result.recomputed, ["d4"]), "new product: recomputed should be d4 only but got " + JSON.stringify(result.recomputed));
expect(near(result.prices.b2, 33), "new product: unrelated product changed");

const oldStamp = new Date(Date.now() - 86400000);
fs.utimesSync(path.join(dataDir, "products", "a1.json"), oldStamp, oldStamp);
result = await load();
expect(sameIds(result.recomputed, []), "timestamp only: nothing should be recomputed but got " + JSON.stringify(result.recomputed));
expect(near(result.prices.a1, 9.9), "timestamp only: a1 changed to " + result.prices.a1);

writeProduct("a1", { id: "a1", basePrice: 12, category: "book" });
fs.utimesSync(path.join(dataDir, "products", "a1.json"), oldStamp, oldStamp);
result = await load();
expect(near(result.prices.a1, 11.88), "hidden edit: a1 expected 11.88 but got " + result.prices.a1);
expect(sameIds(result.recomputed, ["a1"]), "hidden edit: recomputed should be a1 only but got " + JSON.stringify(result.recomputed));
expect(near(result.prices.b2, 33) && near(result.prices.d4, 7.92), "hidden edit: unrelated products changed");

removeProduct("c3");
result = await load();
expect(!Object.prototype.hasOwnProperty.call(result.prices, "c3"), "removed product: c3 is still in prices");
expect(sameIds(result.recomputed, []), "removed product: remaining products should not be recomputed but got " + JSON.stringify(result.recomputed));
expect(near(result.prices.a1, 11.88) && near(result.prices.b2, 33) && near(result.prices.d4, 7.92), "removed product: wrong prices");

fs.writeFileSync(cachePath, "this is not json {{{{ ");
result = await load();
expect(sameIds(result.recomputed, ["a1", "b2", "d4"]), "corrupt cache: everything should be recomputed but got " + JSON.stringify(result.recomputed));
expect(near(result.prices.a1, 11.88) && near(result.prices.b2, 33) && near(result.prices.d4, 7.92), "corrupt cache: wrong prices");
let rewritten = false;
try {
  JSON.parse(fs.readFileSync(cachePath, "utf8"));
  rewritten = true;
} catch {
  rewritten = false;
}
expect(rewritten, "corrupt cache: the cache file was not rewritten as valid JSON");

fs.writeFileSync(cachePath, JSON.stringify({ version: 1, prices: { a1: 0.01, b2: 0.02, d4: 0.03 } }, null, 2) + "\n");
result = await load();
expect(near(result.prices.a1, 11.88), "unverifiable cache: a1 expected 11.88 but got " + result.prices.a1);
expect(near(result.prices.b2, 33), "unverifiable cache: b2 expected 33 but got " + result.prices.b2);
expect(near(result.prices.d4, 7.92), "unverifiable cache: d4 expected 7.92 but got " + result.prices.d4);
expect(sameIds(result.recomputed, ["a1", "b2", "d4"]), "unverifiable cache: everything should be recomputed but got " + JSON.stringify(result.recomputed));

result = await load();
expect(sameIds(result.recomputed, []), "final reload: recomputed should be empty but got " + JSON.stringify(result.recomputed));

if (problems.length > 0) {
  console.log("contract problems:");
  for (const problem of problems) console.log(" - " + problem);
  process.exit(1);
}
console.log("all contract checks passed");
HARNESS_EOF

if node "$TMP_RUN/harness.mjs"; then
  echo "VERDICT: PASS"
  exit 0
fi

echo "VERDICT: FAIL"
exit 1
