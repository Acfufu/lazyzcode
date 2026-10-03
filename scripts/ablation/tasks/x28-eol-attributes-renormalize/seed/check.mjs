import { plan } from "./src/eol.mjs";
const rules = [{ pattern: ".md", eol: "lf" }];
const out = plan(
  [
    { path: "a.md", content: "crlf line\r\n" },
    { path: "b.md", content: "clean\nlines\n" },
  ],
  rules,
);
let bad = 0;
if (out[0].action !== "rewrite") { console.error("FAIL crlf not flagged"); bad++; }
if (out[1].action !== "ok") { console.error("FAIL clean file flagged"); bad++; }
if (bad > 0) process.exit(1);
console.log("PASS");
