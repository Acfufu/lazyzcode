import { existsSync, readFileSync, writeFileSync } from "node:fs";

export function loadState(statePath) {
  if (!existsSync(statePath)) {
    return null;
  }
  return JSON.parse(readFileSync(statePath, "utf8"));
}

export function saveState(statePath, committed) {
  writeFileSync(statePath, `${JSON.stringify({ version: 1, committed })}\n`);
}
