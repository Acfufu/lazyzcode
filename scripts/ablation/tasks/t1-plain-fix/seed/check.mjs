// Visible check for lib/textwrap.js — `node check.mjs` must print PASS.
import { wrap } from "./lib/textwrap.js";

let fails = 0;
function eq(name, got, want) {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? "ok" : "FAIL"} ${name}`);
  if (!ok) console.log(`  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
}

eq("basic wrap at 10", wrap("the quick brown fox", 10), "the quick\nbrown fox");
eq("no wrap needed", wrap("hello world", 20), "hello world");
eq("empty input", wrap("", 10), "");

console.log(fails === 0 ? "PASS" : `FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
