import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const candidate = resolve(process.argv[2]), out = resolve(process.argv[3]);
mkdirSync(out, { recursive: true });
const original = JSON.parse(readFileSync(join(candidate, "manifest.json"), "utf8"));
const results = [];
for (const mode of ["digest", "missing-file", "broken-bin"]) {
  const fixture = mkdtempSync(join(tmpdir(), `lzy-pack-${mode}-`));
  const manifest = structuredClone(original), tgz = join(fixture, manifest.filename);
  copyFileSync(join(candidate, manifest.filename), tgz);
  if (mode === "digest") appendFileSync(tgz, "corrupt acceptance fixture");
  else {
    const unpack = join(fixture, "unpack"); mkdirSync(unpack);
    const extract = spawnSync("tar", ["-xzf", tgz, "-C", unpack], { encoding: "utf8" });
    assert.equal(extract.status, 0, extract.stderr);
    const cli = join(unpack, "package/cli/lzy.js");
    if (mode === "missing-file") {
      rmSync(cli);
      manifest.files = manifest.files.filter(({ path }) => path !== "cli/lzy.js");
    } else {
      writeFileSync(cli, "#!/usr/bin/env node\nprocess.exit(42);\n");
      const entry = manifest.files.find(({ path }) => path === "cli/lzy.js");
      entry.bytes = readFileSync(cli).length;
      entry.sha256 = createHash("sha256").update(readFileSync(cli)).digest("hex");
    }
    // BSD tar otherwise adds AppleDouble xattr members, obscuring the intended bin mutation.
    const pack = spawnSync("tar", ["-czf", tgz, "-C", unpack, "package"], { encoding: "utf8", env: { ...process.env, COPYFILE_DISABLE: "1" } });
    assert.equal(pack.status, 0, pack.stderr);
    const bytes = readFileSync(tgz);
    manifest.sha256 = createHash("sha256").update(bytes).digest("hex");
    manifest.integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  }
  writeFileSync(join(fixture, "manifest.json"), JSON.stringify(manifest));
  const report = join(out, mode);
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("package-smoke.mjs", import.meta.url)), fixture, report], { encoding: "utf8", timeout: 180_000 });
  writeFileSync(join(out, `${mode}.log`), `${r.stdout ?? ""}${r.stderr ?? ""}`);
  const result = JSON.parse(readFileSync(join(report, "result.json"), "utf8"));
  const expected = { digest: /tgz SHA256 mismatch/, "missing-file": /required package file missing: cli\/lzy.js/, "broken-bin": /installed --version/ }[mode];
  assert.ok(r.status !== 0 && expected.test(result.error), `${mode} failed for the wrong reason: ${r.status} ${result.error}`);
  results.push({ mode, status: r.status, expectedFailure: true, error: result.error.split("\n")[0] });
}
writeFileSync(join(out, "counterexamples.json"), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
