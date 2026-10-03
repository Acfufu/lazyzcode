import { normalizePluginList } from "./src/normalize.mjs";
let bad = 0;
const env = { plugins: [{ name: "a" }, { name: "b" }], revision: 7 };
const gotEnv = normalizePluginList(env);
if (!(Array.isArray(gotEnv) && gotEnv.length === 2 && gotEnv[0].name === "a")) { console.error("FAIL envelope"); bad++; }
const gotBare = normalizePluginList([{ name: "x" }]);
if (!(Array.isArray(gotBare) && gotBare.length === 1 && gotBare[0].name === "x")) { console.error("FAIL bare array"); bad++; }
if (bad > 0) process.exit(1);
console.log("PASS");
