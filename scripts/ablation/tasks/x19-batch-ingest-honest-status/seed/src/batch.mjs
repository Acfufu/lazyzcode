import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseRecords, toRecord } from "./records.mjs";

export async function runBatch(text, outDir) {
  const parsed = parseRecords(text);
  await mkdir(outDir, { recursive: true });

  let written = 0;
  for (const fields of parsed) {
    const record = toRecord(fields);
    const body = JSON.stringify(record) + "\n";
    await writeFile(join(outDir, `${record.id}.json`), body, "utf8");
    written += 1;
  }

  return { ok: true, written, rejected: 0 };
}
