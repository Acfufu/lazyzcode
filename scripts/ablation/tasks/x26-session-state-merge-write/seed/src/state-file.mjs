// Broken: replaces the whole file with the patch — concurrent fields vanish,
// and the write is not atomic.
import { writeFileSync } from "node:fs";
export function mergeWrite(filePath, patch) {
  writeFileSync(filePath, JSON.stringify(patch));
  return patch;
}
