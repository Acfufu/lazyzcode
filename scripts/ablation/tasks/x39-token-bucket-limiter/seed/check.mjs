import { createBucket } from "./src/tokenbucket.mjs";
let bad = 0;
const b = createBucket({ capacity: 10, refillPerSec: 2 });
const r1 = b.tryConsume(4, 0);
if (!(r1.allowed && r1.remaining === 6)) { console.error("FAIL consume"); bad++; }
const r2 = b.tryConsume(4, 0);
if (!(r2.allowed && r2.remaining === 2)) { console.error("FAIL consume 2"); bad++; }
if (bad > 0) process.exit(1);
console.log("PASS");
