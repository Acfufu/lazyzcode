// Broken: replaces the whole file with the patch.
import { writeFileSync } from "node:fs";
export function mergeWrite(filePath, patch) {
  writeFileSync(filePath, JSON.stringify(patch));
  return patch;
}
