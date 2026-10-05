#!/usr/bin/env bash
set -u
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/full_check.mjs" <<'JSEOF'
import { pathToFileURL } from "node:url";
const { parseCSV, toCSV } = await import(pathToFileURL(process.cwd() + "/src/csv.mjs").href);
const TABLE = [["basic 2x2","a,b\nc,d",{},[["a","b"],["c","d"]]],["trailing newline no empty row","a,b\n",{},[["a","b"]]],["no trailing newline","a,b",{},[["a","b"]]],["quoted delimiter","\"x,y\",z",{},[["x,y","z"]]],["quoted newline literal","\"a\nb\",c",{},[["a\nb","c"]]],["doubled quote inside","\"a\"\"b\",c",{},[["a\"b","c"]]],["quote not at field start literal","x\"a,y",{},[["x\"a","y"]]],["spaces preserved"," a , b ",{},[[" a "," b "]]],["empty middle field","a,,c",{},[["a","","c"]]],["trailing delimiter empty last","a,",{},[["a",""]]],["lone CR separator","a\rb",{},[["a"],["b"]]],["CRLF separator","a\r\nb",{},[["a"],["b"]]],["quoted CRLF literal","\"a\r\nb\",c",{},[["a\r\nb","c"]]],["BOM stripped","﻿a,b",{},[["a","b"]]],["comment line dropped","#c\na,b",{"comment":"#"},[["a","b"]]],["comment middle line","a\n#x\nb",{"comment":"#"},[["a"],["b"]]],["no comment by default","#c\na,b",{},[["#c"],["a","b"]]],["skipEmptyLines on","a\n\nb",{"skipEmptyLines":true},[["a"],["b"]]],["skipEmptyLines off default","a\n\nb",{},[["a"],[""],["b"]]],["quoted empty also skipped","\"\"\nb",{"skipEmptyLines":true},[["b"]]],["semicolon delimiter","a;b",{"delimiter":";"},[["a","b"]]],["single-quote char","'a,b'",{"quote":"'"},[["a,b"]]],["backslash escape quote","\"a\\\"b\",c",{"escape":"backslash"},[["a\"b","c"]]],["backslash escapes next char literally","\"a\\nb\",c",{"escape":"backslash"},[["anb","c"]]],["backslash mode no doubling","\"a\"\"b\"",{"escape":"backslash"},[["a\"b\""]]],["chars after closing quote append","\"x\"y,z",{},[["xy","z"]]],["empty text","",{},[[""]]],["empty text skipEmptyLines","",{"skipEmptyLines":true},[]],["delimiter must be single char","",{"delimiter":""},"TypeError"],["delimiter must be single char 2","",{"delimiter":".."},"TypeError"],["quote must be single char","",{"quote":"ab"},"TypeError"],["quoted then delimiter","\"x\",y",{},[["x","y"]]],["CRLF file","a,b\r\nc,d\r\n",{},[["a","b"],["c","d"]]],["trailing quote doubling","\"abc\"\"\"",{},[["abc\""]]]];
const OUT = [["plain join",[["a","b"],["c","d"]],{},"a,b\nc,d"],["quote on delimiter",[["x,y"]],{},"\"x,y\""],["quote doubling",[["a\"b"]],{},"\"a\"\"b\""],["quote on newline",[["a\nb"]],{},"\"a\nb\""],["spaces not quoted",[[" a "]],{}," a "],["backslash mode",[["a\"b"]],{"escape":"backslash"},"\"a\\\"b\""],["empty rows",[],{},""],["roundtrip tricky",[["x,y","q\"q","n\nn"]],{},"\"x,y\",\"q\"\"q\",\"n\nn\""]];
let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log("FAIL " + name + " got=" + g + " want=" + w); }
}
function thr(name, fn, code) {
  try { fn(); fail++; console.log("FAIL " + name + " (no throw)"); }
  catch (e) {
    if (!code) { pass++; return; }
    if ((e.code === code) || (e instanceof Error && e.name === code) || (e.constructor && e.constructor.name === code)) pass++;
    else { fail++; console.log("FAIL " + name + " wrong error " + (e.code || e.constructor.name)); }
  }
}
for (const [name, text, opts, want] of TABLE) {
  if (want === "TypeError") thr(name, () => parseCSV(text, opts), "TypeError");
  else eq(name, parseCSV(text, opts), want);
}
for (const [name, rows, opts, want] of OUT) eq(name, toCSV(rows, opts), want);
const RT = [["x,y", 'q"q', "n\nn"]];
eq("roundtrip reparse", parseCSV(toCSV(RT)), RT);
console.log("SCORE " + pass + "/" + (pass + fail));
if (fail > 0) { console.log("VERDICT: FAIL"); process.exit(1); }
console.log("VERDICT: PASS");
JSEOF
node "$TMP/full_check.mjs"
