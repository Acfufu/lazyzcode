// Visible surface checks — prints PASS only when every section passes.
import { slug } from "./lib/slug.js";
import { pad } from "./lib/pad.js";

let bad = 0;
function eq(section, name, got, want) {
  const ok = got === want;
  if (!ok) {
    console.log(`FAIL ${section}/${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    bad++;
  }
}
function call(fn) {
  try {
    return fn();
  } catch {
    return "<error>";
  }
}

// slug section — current contract (hyphen separator)
eq("slug", "basic", call(() => slug("  Hello   World  ")), "hello-world");
eq("slug", "single", call(() => slug("FIX")), "fix");
eq("slug", "tabs", call(() => slug("a\t\tb")), "a-b");

// pad section
eq("pad", "basic", call(() => pad("ab", 5, ".")), "ab...");
eq("pad", "exact", call(() => pad("abc", 3, "0")), "abc");
eq("pad", "empty-str", call(() => pad("", 2, "0")), "00");
eq("pad", "over-long", call(() => pad("abcd", 2, ".")), "abcd");
eq("pad", "default-space", call(() => pad("a", 3)), "a  ");

if (bad > 0) {
  console.log(`FAIL (${bad} check(s) failing)`);
  process.exit(1);
}
console.log("PASS");
