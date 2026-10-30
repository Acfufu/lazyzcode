import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, basename, sep, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { identity } from "./identity.mjs";
import { runNpm } from "./npm.mjs";

const candidate = resolve(process.argv[2]);
const out = resolve(process.argv[3] ?? "artifacts/package-smoke");
mkdirSync(out, { recursive: true });
const run = identity();
let evidence = { ...run, result: "FAIL" };
const members = (root) => {
  const result = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name), st = lstatSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) result.push(relative(root, p).split("\\").join("/"));
      else throw new Error(`Unsupported installed member: ${p}`);
    }
  };
  walk(root);
  return result.sort();
};
try {
  const manifest = JSON.parse(readFileSync(join(candidate, "manifest.json"), "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.kind, "unpublished-ci-candidate");
  assert.equal(manifest.checkoutSha, run.checkoutSha, "candidate is from another checkout");
  assert.equal(manifest.checkoutTree, run.checkoutTree, "candidate is from another tree");
  assert.equal(manifest.repository, run.repository, "candidate repository differs");
  assert.equal(manifest.runId, run.runId, "candidate run differs");
  assert.equal(manifest.attempt, run.attempt, "candidate attempt differs; rerun the complete workflow");
  assert.equal(manifest.filename, basename(manifest.filename));
  assert.match(manifest.filename, /^[A-Za-z0-9._-]+\.tgz$/);
  const tgz = join(candidate, manifest.filename), bytes = readFileSync(tgz);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.sha256, "tgz SHA256 mismatch");
  assert.equal(`sha512-${createHash("sha512").update(bytes).digest("base64")}`, manifest.integrity, "tgz SRI mismatch");
  const required = ["package.json", "cli/lzy.js", "core/installer.js", "plugin/.zcode-plugin/plugin.json"];
  for (const path of required) assert.ok(manifest.files.some((file) => file.path === path), `required package file missing: ${path}`);
  assert.equal(manifest.name, "lazyzcode");
  const sandbox = mkdtempSync(join(tmpdir(), "lzy-package-smoke-"));
  const smokeHome = join(sandbox, "home"), prefix = join(sandbox, "prefix"), work = join(sandbox, "work"), cache = join(sandbox, "cache");
  for (const p of [smokeHome, prefix, work, cache]) mkdirSync(p);
  const userConfig = join(sandbox, "npmrc");
  writeFileSync(userConfig, "");
  const globalConfig = join(sandbox, "global-npmrc");
  writeFileSync(globalConfig, "");
  const env = { ...process.env, HOME: smokeHome, USERPROFILE: smokeHome, XDG_CONFIG_HOME: join(smokeHome, ".config"), XDG_CACHE_HOME: join(smokeHome, ".cache"), XDG_DATA_HOME: join(smokeHome, ".local/share"), APPDATA: join(smokeHome, "AppData/Roaming"), LOCALAPPDATA: join(smokeHome, "AppData/Local"), NPM_CONFIG_CACHE: cache, NPM_CONFIG_USERCONFIG: userConfig, NPM_CONFIG_GLOBALCONFIG: globalConfig, NPM_CONFIG_UPDATE_NOTIFIER: "false", LZY_ZCODE_ENGINE: join(sandbox, "no-zcode-engine") };
  writeFileSync(join(out, "npm-install.log"), runNpm(["install", "--global", "--prefix", prefix, tgz, "--ignore-scripts", "--no-audit", "--no-fund", "--offline"], { cwd: work, env }));
  const installed = join(prefix, process.platform === "win32" ? "node_modules/lazyzcode" : "lib/node_modules/lazyzcode");
  assert.deepEqual(members(installed), manifest.files.map((file) => file.path).sort(), "installed package member set differs");
  for (const file of manifest.files) {
    assert.match(file.path, /^(?:cli\/|core\/|plugin\/|package\.json$|LICENSE$|README(?:\.zh-CN)?\.md$|CHANGELOG\.md$)/);
    assert.ok(!file.path.split("/").some((part) => ["..", "."].includes(part)), "unsafe package member");
    assert.equal(createHash("sha256").update(readFileSync(join(installed, file.path))).digest("hex"), file.sha256, `installed file mismatch: ${file.path}`);
  }
  const pkg = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  assert.equal(pkg.version, manifest.version);
  assert.equal(pkg.bin.lzy, "cli/lzy.js");
  const bin = join(prefix, process.platform === "win32" ? "lzy.cmd" : "bin/lzy");
  assert.ok(existsSync(bin), "installed executable missing");
  const invoke = (flag) => {
    assert.ok(["--version", "--help"].includes(flag));
    assert.ok(!/["%\r\n]/.test(bin), "bin path cannot be represented safely in cmd.exe");
    const r = process.platform === "win32"
      ? spawnSync(`"${bin}" ${flag}`, [], { cwd: work, env, shell: true, encoding: "utf8", timeout: 30_000 })
      : spawnSync(bin, [flag], { cwd: work, env, encoding: "utf8", timeout: 30_000 });
    writeFileSync(join(out, `${flag.slice(2)}.log`), `${r.stdout ?? ""}${r.stderr ?? ""}`);
    assert.equal(r.status, 0, `installed ${flag}: ${r.stdout} ${r.stderr}`);
    return r.stdout;
  };
  assert.ok(invoke("--version").includes(`lzy ${manifest.version}`));
  assert.ok(invoke("--help").includes("lzy"));
  const probe = join(work, "deployed.mjs"), deployed = join(work, "deployed.json");
  writeFileSync(probe, `import {readRepoManifest,deployFiles} from ${JSON.stringify(pathToFileURL(join(installed, "core/installer.js")).href)};\nimport {writeFileSync} from 'node:fs';\nwriteFileSync(process.argv[2],JSON.stringify({dest:deployFiles(readRepoManifest())}));\n`);
  const r = spawnSync(process.execPath, [probe, deployed], { cwd: work, env, encoding: "utf8", timeout: 30_000 });
  assert.equal(r.status, 0, `installed installer: ${r.stdout} ${r.stderr}`);
  const { dest } = JSON.parse(readFileSync(deployed, "utf8"));
  assert.ok(dest.startsWith(smokeHome + sep), "deployment escaped isolated home");
  const payload = manifest.files.filter((file) => file.path.startsWith("plugin/") && !file.path.slice(7).split("/").some((part) => part.startsWith(".") && part !== ".zcode-plugin"));
  assert.deepEqual(members(dest), payload.map((file) => file.path.slice(7)).sort(), "deployed payload member set differs");
  for (const file of payload) assert.equal(createHash("sha256").update(readFileSync(join(dest, file.path.slice(7)))).digest("hex"), file.sha256, `deployed file mismatch: ${file.path}`);
  assert.equal(existsSync(join(smokeHome, ".zcode/cli/config.json")), false, "offline deployment wrote user config");
  evidence = { ...evidence, result: "PASS", candidateSha256: manifest.sha256, candidateIntegrity: manifest.integrity, candidateVersion: manifest.version, candidateCheckoutSha: manifest.checkoutSha, candidateCheckoutTree: manifest.checkoutTree, installed, bin, smokeHome, payloadFiles: payload.length, installedFiles: manifest.files.length };
} catch (error) {
  evidence.error = error.stack;
  process.exitCode = 1;
  console.error(error.stack);
} finally {
  writeFileSync(join(out, "result.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
}
