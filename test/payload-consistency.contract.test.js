// 载荷一致性（0.3.0 M5，主方案 M5「打包/缓存一致」+release-checklist 第 3 步产品化）：
// deployFiles 直接契约（仓 plugin/ 树 ↔ 部署缓存树逐文件 sha256 对表，.mimosa 等点残渣
// 不随部署）；pack dry-run 白名单对表（文件清单只含 cli/ core/ plugin/ + 门面元数据，
// grep 不到 .mimosa/.lazyzcode/docs//sess_）。子进程 HOME 隔离（deployFiles 落点随
// homedir()——同 p3-sweep 家法）；win32 路径用 path 相对化（POSIX split("/") 雷规避）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const CLI = join(ROOT, "cli", "lzy.js");

function sha256(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function walkFiles(dir) {
  const out = [];
  const walk = (p) => {
    for (const name of readdirSync(p).sort()) {
      const full = join(p, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(dir);
  return out;
}

// installer.isDotResidue 同构谓词（相对路径；.zcode-plugin 豁免）——家族对齐勿单方改。
function isDotResidue(rel) {
  return rel.split(/[\\/]/).some((seg) => seg.startsWith(".") && seg !== ".zcode-plugin");
}

test("deployFiles：仓 plugin/ 树与部署缓存逐文件 sha256 对表（点残渣不部署）", () => {
  const HOME = mkdtempSync(join(tmpdir(), "lzy-payload-home-"));
  const probe = join(HOME, "probe.mjs");
  writeFileSync(
    probe,
    `import { readRepoManifest, deployFiles } from ${JSON.stringify(pathToFileURL(join(ROOT, "core", "installer.js")).href)};
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
const dest = await deployFiles(readRepoManifest());
const isDotResidue = (rel) => rel.split(/[\\\\\\\\/]/).some((seg) => seg.startsWith(".") && seg !== ".zcode-plugin");
const walk = (dir) => {
  const out = [];
  const w = (p) => {
    for (const n of readdirSync(p).sort()) {
      const full = join(p, n);
      if (statSync(full).isDirectory()) w(full);
      else out.push(full);
    }
  };
  w(dir);
  return out;
};
const files = walk(dest).map((f) => ({ rel: relative(dest, f), sha256: createHash("sha256").update(readFileSync(f)).digest("hex") }));
writeFileSync(process.argv[2], JSON.stringify({ dest, files }));
`,
  );
  const outFile = join(HOME, "deployed.json");
  const r = spawnSync(process.execPath, [probe, outFile], {
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, HOME, USERPROFILE: HOME },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const { dest, files } = JSON.parse(readFileSync(outFile, "utf8"));
  assert.ok(dest.includes(join("cache", "lazyzcode-local", "lazyzcode")), `落点异常：${dest}`);
  // 仓侧同谓词枚举
  const repoDir = join(ROOT, "plugin");
  const repoFiles = walkFiles(repoDir).map((f) => relative(repoDir, f)).filter((rel) => !isDotResidue(rel));
  const deployedRels = files.map((f) => f.rel);
  assert.equal(deployedRels.length, repoFiles.length, `部署数 ${deployedRels.length} ≠ 仓侧 ${repoFiles.length}`);
  for (const rel of repoFiles) {
    assert.ok(deployedRels.includes(rel), `缓存缺文件：${rel}`);
    const deployed = files.find((f) => f.rel === rel);
    assert.equal(deployed.sha256, sha256(join(repoDir, rel)), `字节不一致：${rel}`);
  }
  // 点残渣确实不随部署（.mimosa 若在仓侧存在）
  const residue = walkFiles(repoDir).map((f) => relative(repoDir, f)).filter(isDotResidue);
  for (const rel of residue) assert.ok(!deployedRels.includes(rel), `点残渣被部署：${rel}`);
});

test("pack dry-run：文件清单白名单对表+外带 grep 三连", () => {
  const r = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
    shell: process.platform === "win32",
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const parsed = JSON.parse(r.stdout);
  // npm ≥12 对象包封 {lazyzcode:{files}}、npm 旧版数组包封——唯一边界归一
  const packObj = Array.isArray(parsed) ? parsed[0] : parsed[Object.keys(parsed)[0]];
  const entries = (packObj.files ?? []).map((f) => f.path);
  assert.ok(entries.length > 10, `pack files=${entries.length}`);
  const OK_TOP = /^(cli\/|core\/|plugin\/)/;
  const OK_META = /^(README\.md|README\.zh-CN\.md|LICENSE|CHANGELOG\.md|package\.json)$/;
  for (const path of entries) {
    const norm = path.split("\\").join("/");
    assert.ok(OK_TOP.test(norm) || OK_META.test(norm), `白名单外文件：${norm}`);
    assert.ok(!norm.includes(".mimosa"), `守卫运行态入包：${norm}`);
    assert.ok(!norm.includes(".lazyzcode"), `循环状态入包：${norm}`);
    assert.ok(!norm.startsWith("docs/"), `docs 入包：${norm}`);
  }
  // checklist 内容层：随包 js/md 无会话标识
  for (const path of entries) {
    const norm = path.split("\\").join("/");
    if (!/\.(js|md)$/.test(norm)) continue;
    const body = readFileSync(join(ROOT, norm), "utf8");
    assert.ok(!body.includes("sess_"), `会话标识随包：${norm}`);
  }
});
