#!/usr/bin/env bash
set -u
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/full_check.mjs" <<'JSEOF'
import { pathToFileURL } from "node:url";
const { createBucket } = await import(pathToFileURL(process.cwd() + "/src/tokenbucket.mjs").href);
let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log("FAIL " + name + " got=" + g + " want=" + w); }
}
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.log("FAIL " + name); } }
function thr(name, fn, code) {
  try { fn(); fail++; console.log("FAIL " + name + " (no throw)"); }
  catch (e) {
    if (!code) { pass++; return; }
    if ((e.code === code) || (e.constructor && e.constructor.name === code)) pass++;
    else { fail++; console.log("FAIL " + name + " wrong error " + (e.code || e.constructor.name)); }
  }
}
// 基础消耗
{
  const b = createBucket({ capacity: 10, refillPerSec: 2 });
  eq("consume 4 @0", b.tryConsume(4, 0), { allowed: true, remaining: 6 });
  eq("consume 4 @0 again", b.tryConsume(4, 0), { allowed: true, remaining: 2 });
  eq("consume 3 @0 denied", b.tryConsume(3, 0), { allowed: false, remaining: 2 });
  eq("refill 1s later available", b.available(1000), 4);
  eq("consume 4 @1000 ok", b.tryConsume(4, 1000).allowed, true);
}
// 容量截断
{
  const b = createBucket({ capacity: 5, refillPerSec: 1 });
  eq("idle to cap", b.available(100000), 5);
  eq("consume at cap", b.tryConsume(5, 100000), { allowed: true, remaining: 0 });
  eq("refill from 0", b.available(101000), 1);
}
{
  const b = createBucket({ capacity: 5, refillPerSec: 1, initial: 99 });
  eq("initial clamped", b.available(0), 5);
}
// initial 语义
{
  const b = createBucket({ capacity: 10, refillPerSec: 0, initial: 3 });
  eq("initial 3 consume 3", b.tryConsume(3, 0), { allowed: true, remaining: 0 });
  eq("no refill denied", b.tryConsume(1, 60000), { allowed: false, remaining: 0 });
}
// nextAvailableAt
{
  const b = createBucket({ capacity: 10, refillPerSec: 2, initial: 0 });
  eq("nat exact", b.nextAvailableAt(4, 0), 2000);
  eq("nat rounding up", b.nextAvailableAt(1, 0), 500);
  eq("nat affordable now", createBucket({ capacity: 10, refillPerSec: 2 }).nextAvailableAt(1, 0), 0);
}
{
  const b = createBucket({ capacity: 4, refillPerSec: 0, initial: 0 });
  eq("nat infinite without refill", b.nextAvailableAt(1, 0), Infinity);
}
// TypeError 面
{
  const b = createBucket({ capacity: 4, refillPerSec: 2 });
  thr("consume 0 tokens", () => b.tryConsume(0, 0), "TypeError");
  thr("consume fractional", () => b.tryConsume(1.5, 0), "TypeError");
  thr("consume negative", () => b.tryConsume(-1, 0), "TypeError");
  thr("nat fractional", () => b.nextAvailableAt(0.5, 0), "TypeError");
  thr("capacity invalid", () => createBucket({ capacity: 0 }), "TypeError");
  thr("capacity negative", () => createBucket({ capacity: -1 }), "TypeError");
  thr("refill negative", () => createBucket({ capacity: 4, refillPerSec: -1 }), "TypeError");
  thr("initial negative", () => createBucket({ capacity: 4, initial: -1 }), "TypeError");
}
// 时间回退
{
  const b = createBucket({ capacity: 10, refillPerSec: 2 });
  b.tryConsume(1, 1000);
  thr("time backwards", () => b.tryConsume(1, 500), "TypeError");
}
// 长闲后截断 + 连续消耗序列
{
  const b = createBucket({ capacity: 3, refillPerSec: 1, initial: 0 });
  eq("idle cap 3", b.tryConsume(3, 1000000), { allowed: true, remaining: 0 });
  eq("quarter sec denied", b.tryConsume(1, 1000250), { allowed: false, remaining: 0.25 });
  eq("full sec refill", b.tryConsume(1, 1001000), { allowed: true, remaining: 0 });
  eq("immediate again denied", b.tryConsume(1, 1001000), { allowed: false, remaining: 0 });
  eq("nat after debit", b.nextAvailableAt(1, 1001000), 1002000);
}
console.log("SCORE " + pass + "/" + (pass + fail));
if (fail > 0) { console.log("VERDICT: FAIL"); process.exit(1); }
console.log("VERDICT: PASS");
JSEOF
node "$TMP/full_check.mjs"
