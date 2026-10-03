// Broken: reads the entire file, then computes flags. On big logs this blows
// both the read budget and the wall clock.
import { readFileSync, statSync } from "node:fs";
export function scanTail(filePath, options) {
  if (!options || typeof options.maxBytes !== "number" || typeof options.deadlineMs !== "number") {
    throw new TypeError("maxBytes and deadlineMs are required");
  }
  const text = readFileSync(filePath, "utf8");
  const size = statSync(filePath).size;
  return { text, truncated: size > options.maxBytes, readBytes: size };
}
