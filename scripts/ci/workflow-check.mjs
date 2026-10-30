import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const out = resolve(process.argv[2] ?? "artifacts/workflow-check");
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "lzy-workflow-tools-"));
const manifest = JSON.parse(readFileSync(new URL("workflow-tools.json", import.meta.url), "utf8"));
const downloads = [], binaries = {};
try {
  for (const [name, spec] of Object.entries(manifest)) {
    const asset = spec[`${process.platform}-${process.arch}`];
    assert.ok(asset, `unsupported scanner platform: ${process.platform}-${process.arch}`);
    const response = await fetch(asset.url, { signal: AbortSignal.timeout(60_000) });
    assert.ok(response.ok, `download ${name}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    assert.equal(sha256, asset.sha256, `${name} download digest mismatch`);
    const dir = join(scratch, name), archive = join(scratch, `${name}.tar.gz`);
    mkdirSync(dir); writeFileSync(archive, bytes);
    const r = spawnSync("tar", ["-xzf", archive, "-C", dir], { encoding: "utf8", timeout: 60_000 });
    assert.equal(r.status, 0, r.stderr);
    binaries[name] = join(dir, name);
    downloads.push({ name, version: spec.version, ...asset, actualSha256: sha256 });
  }
  writeFileSync(join(out, "downloads.json"), `${JSON.stringify(downloads, null, 2)}\n`);
  const run = (name, args, label) => {
    const r = spawnSync(binaries[name], args, { encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
    writeFileSync(join(out, `${label}.log`), `${r.stdout ?? ""}${r.stderr ?? ""}`);
    console.log(`${label}: exit ${r.status ?? r.signal}\n${r.stdout ?? ""}${r.stderr ?? ""}`);
    return r;
  };
  // Scan actual workflows only. Offline mode keeps fork checks deterministic and token-free.
  const workflows = readdirSync(".github/workflows").filter((file) => /\.ya?ml$/.test(file)).map((file) => join(".github/workflows", file));
  const lint = run("actionlint", workflows, "actionlint");
  const security = run("zizmor", ["--offline", "--no-progress", "--format=json", ".github/workflows"], "zizmor");
  const invalid = join(scratch, "invalid.yml");
  writeFileSync(invalid, 'name: invalid\non: [push]\npermissions: read-all\njobs:\n  bad:\n    needs: nonexistent\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo fixture\n');
  assert.notEqual(run("actionlint", [invalid], "actionlint-counterexample").status, 0, "actionlint did not reject the invalid dependency");
  const unsafe = join(scratch, "unsafe.yml");
  writeFileSync(unsafe, 'name: unsafe\non: [pull_request_target]\npermissions: write-all\njobs:\n  bad:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n');
  const negative = run("zizmor", ["--offline", "--no-progress", "--format=json", unsafe], "zizmor-counterexample");
  assert.ok(negative.status !== 0 && /unpinned-uses|excessive-permissions|artipacked/.test(negative.stdout), "zizmor failed without the expected security finding");
  assert.equal(lint.status, 0, "workflow syntax findings remain");
  assert.equal(security.status, 0, "workflow security findings remain");
  writeFileSync(join(out, "result.json"), JSON.stringify({ result: "PASS", downloads, counterexamples: ["invalid dependency rejected", "unsafe workflow rejected"] }, null, 2));
} catch (error) {
  writeFileSync(join(out, "result.json"), JSON.stringify({ result: "FAIL", downloads, error: error.stack }, null, 2));
  console.error(error.stack); process.exitCode = 1;
} finally { rmSync(scratch, { recursive: true, force: true }); }
