// Visible check for lib/cases.js — `node check.mjs` must print PASS.
import { toCamel, toSnake, toKebab, toConstant } from "./lib/cases.js";

let fails = 0;
function eq(name, got, want) {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? "ok" : "FAIL"} ${name}`);
  if (!ok) console.log(`  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
}

eq("camel", toCamel("hello world"), "helloWorld");
eq("snake", toSnake("Hello World"), "hello_world");
eq("kebab", toKebab("Hello World"), "hello-world");
eq("constant", toConstant("hello world"), "HELLO_WORLD");

console.log(fails === 0 ? "PASS" : `FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
