#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { runBatch } from "../src/batch.mjs";

const [inputPath, outDir] = process.argv.slice(2);

if (!inputPath || !outDir) {
  console.error("usage: node bin/ingest-batch.mjs <inputFile> <outDir>");
  process.exit(2);
}

let text = "";
try {
  text = await readFile(inputPath, "utf8");
} catch (err) {
  console.error("cannot read input file: " + inputPath);
  process.exit(2);
}

const result = await runBatch(text, outDir);
console.log(JSON.stringify(result));
