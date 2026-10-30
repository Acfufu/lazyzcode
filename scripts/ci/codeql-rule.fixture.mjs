// Isolated non-executed CodeQL acceptance fixture. Never merge.
import http from "node:http";
import { exec } from "node:child_process";
export function createUnsafeFixture() {
  return http.createServer((request, response) => {
    exec(request.url ?? "", (_error, stdout) => response.end(stdout));
  });
}
