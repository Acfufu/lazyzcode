// docs 断链/锚点检查器契约测试（0.4.0 M5 N3，M4 输入 9①）：子进程驱动
// scripts/check-docs-links.mjs 对临时夹具断言退出码与点名面——零依赖、零网络。
// 结构沿 review-scope.contract.test.js 的 spawnSync 夹具法。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECKER = join(ROOT, "scripts", "check-docs-links.mjs");

function fxDoc(d, rel, text) {
  const p = join(d, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}

function run(d) {
  const r = spawnSync(process.execPath, [CHECKER, "--root", d], { encoding: "utf8", timeout: 60_000 });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("docs-links 检查器", () => {
  test("干净树 exit 0；相对链接与同页锚点成立", () => {
    const d = mkdtempSync(join(tmpdir(), "lzy-doclink-"));
    try {
      fxDoc(d, "docs/a.md", "---\ntitle: x\n---\n# 顶部\n\n[go](b.md) [same](#顶部) [dir](sub/)\n");
      fxDoc(d, "docs/b.md", "# B\n\n## 标题 二\n\ntext\n");
      fxDoc(d, "docs/sub/index.md", "# sub\n");
      const r = run(d);
      assert.equal(r.code, 0, r.out);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
  test("断链相对路径 exit 1 并点名文件与目标", () => {
    const d = mkdtempSync(join(tmpdir(), "lzy-doclink-"));
    try {
      fxDoc(d, "docs/a.md", "[missing](nope.md)\n");
      const r = run(d);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /docs\/a\.md/);
      assert.match(r.out, /nope\.md/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
  test("缺锚点 exit 1 并点名锚", () => {
    const d = mkdtempSync(join(tmpdir(), "lzy-doclink-"));
    try {
      fxDoc(d, "docs/a.md", "[b](b.md#不存在) [self](#也没有)\n");
      fxDoc(d, "docs/b.md", "# B\n");
      const r = run(d);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /不存在/);
      assert.match(r.out, /也没有/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
  test("代码块内伪链接不算数；外部 http 与模板占位跳过", () => {
    const d = mkdtempSync(join(tmpdir(), "lzy-doclink-"));
    try {
      fxDoc(
        d,
        "docs/a.md",
        "```\n[fake](ghost.md)\n```\n\n`[inline](ghost2.md)`\n\n[web](https://example.com/x) [t](mailto:a@b.c) [liq]( {{ site.baseurl }}/x )\n",
      );
      const r = run(d);
      assert.equal(r.code, 0, r.out);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
