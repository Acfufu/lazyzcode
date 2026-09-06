// 发布面契约：版本一致、bin 可装载、零 npm 依赖、files 排除守卫残留、CI 在场。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");

test("package.json：版本三方一致 + MIT + 零依赖 + files 排除 .mimosa + bin shebang", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const manifest = JSON.parse(
    readFileSync(join(ROOT, "plugin", ".zcode-plugin", "plugin.json"), "utf8"),
  );
  assert.equal(pkg.version, manifest.version);
  const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
  assert.ok(changelog.includes(pkg.version), "CHANGELOG 应含当前版本");
  assert.equal(pkg.license, "MIT");
  assert.ok(!("dependencies" in pkg), "零 npm 依赖是宣称卖点，不得破");
  assert.ok(!("devDependencies" in pkg));
  assert.ok(pkg.files.some((f) => f.includes(".mimosa")), "files 必须显式排除 .mimosa");
  const binPath = join(ROOT, pkg.bin.lzy);
  assert.ok(existsSync(binPath));
  assert.ok(readFileSync(binPath, "utf8").startsWith("#!/usr/bin/env node"));
});

test("git 跟踪文件不含 .mimosa 残留", () => {
  const r = spawnSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0);
  const tracked = (r.stdout ?? "").split("\n").filter(Boolean);
  assert.ok(tracked.length > 10);
  assert.ok(tracked.every((f) => !f.includes(".mimosa")), `泄漏：${tracked.filter((f) => f.includes(".mimosa"))}`);
});

test("CI 骨架在场且声明零依赖测试命令", () => {
  const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(ci, /node-version/);
  assert.match(ci, /node --test/);
});
