import { parseCSV } from "./src/csv.mjs";
let bad = 0;
const r1 = parseCSV("a,b\nc,d");
if (!(r1.length === 2 && r1[0][0] === "a" && r1[1][1] === "d")) { console.error("FAIL basic"); bad++; }
const r2 = parseCSV('"x,y",z');
if (!(r2.length === 1 && r2[0][0] === "x,y" && r2[0][1] === "z")) { console.error("FAIL quoted delimiter"); bad++; }
const r3 = parseCSV("a,");
if (!(r3.length === 1 && r3[0][1] === "")) { console.error("FAIL trailing delimiter"); bad++; }
if (bad > 0) process.exit(1);
console.log("PASS");
