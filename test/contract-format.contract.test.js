// 契约格式扩展（0.3.1 棒1，ADR-0030 §一.A）契约：交付动作面结构键的解析/校验/兼容。
// 家法：零 spawn、直调 core（本文件受测面=parseContract/loadContract 纯函数面）。
// 注意：头部结构键须在 A 验收项之前（前导块语义）——本文件夹具统一 keys 先、A 项后。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContract, parseContract } from "../core/contract.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function scratchContract(body) {
  const d = mkdtempSync(join(tmpdir(), "lzy-cfmt-"));
  const p = join(d, "c.md");
  writeFileSync(p, body);
  return { d, p };
}

const HEAD = "task: t\nendpoint: A\nscope: .\n";
const withKeys = (extra, ep = "A") =>
  (ep === "A" ? HEAD : `task: t\nendpoint: ${ep}\nscope: .\n`) + extra + "- [A1] a\n";

test("①交付面新键解析（B 面五键 + C 面三键 + page 重复键累积）", () => {
  const { d, p } = scratchContract(
    withKeys(
      [
        "repo: Acfufu/lazyzcode",
        "base: main",
        "branch: v031-bat1",
        "pr-title: 0.3.1 棒1 交付",
        "pr-body: docs/pr-body.md",
        "expect-marker: v0.3.1",
        "content-url: https://acfufu.github.io/lazyzcode/",
        "page: /",
        "page: /guide/zh.html",
        "page: /adr/0030-delivery-orchestration-bridge.html",
      ].join("\n") + "\n",
      "C",
    ),
  );
  const c = loadContract(p, d);
  assert.equal(c.repo, "Acfufu/lazyzcode");
  assert.equal(c.base, "main");
  assert.equal(c.branch, "v031-bat1");
  assert.equal(c.prTitle, "0.3.1 棒1 交付");
  assert.equal(c.prBody, "docs/pr-body.md");
  assert.equal(c.expectMarker, "v0.3.1");
  assert.equal(c.contentUrl, "https://acfufu.github.io/lazyzcode/");
  assert.deepEqual(c.pages, ["/", "/guide/zh.html", "/adr/0030-delivery-orchestration-bridge.html"]);
});

test("②旧契约逐字兼容（v030-m4-contract-B/C 兼容夹具：新字段 null/[]、旧字段不变）", () => {
  const b = loadContract(join(ROOT, "docs", "spikes", "v030-m4-contract-B.md"), ROOT);
  assert.equal(b.endpoint, "B");
  assert.equal(b.recipe, "none");
  assert.equal(b.scopeRaw[0], ".");
  assert.equal(b.acceptances.length, 3);
  assert.equal(b.repo, null);
  assert.equal(b.base, null);
  assert.equal(b.branch, null);
  assert.equal(b.prTitle, null);
  assert.equal(b.prBody, null);
  assert.equal(b.expectMarker, null);
  assert.equal(b.contentUrl, null);
  assert.deepEqual(b.pages, []);
  const c = loadContract(join(ROOT, "docs", "spikes", "v030-m4-contract-C.md"), ROOT);
  assert.equal(c.endpoint, "C");
  assert.equal(c.acceptances.length, 3);
  assert.equal(c.repo, null);
  assert.equal(c.expectMarker, null);
  assert.deepEqual(c.pages, []);
});

test("③未知键照拒（含近似键态：pagess/pr-titles）+ 正文中键不入解析", () => {
  assert.throws(() => parseContract(withKeys("pagess: /x\n"), ROOT), /契约结构键不认识：pagess/);
  assert.throws(() => parseContract(withKeys("pr-titles: x\n"), ROOT), /契约结构键不认识：pr-titles/);
  const c = parseContract(withKeys("") + "正文提到 repo: x/y 只是散文\n", ROOT);
  assert.equal(c.repo, null);
});

test("④单值新键重复拒（repo/base/branch/pr-title/pr-body/expect-marker/content-url 各自）", () => {
  for (const k of ["repo", "base", "branch", "pr-title", "pr-body", "expect-marker", "content-url"]) {
    const v = k === "repo" ? "a/b" : k === "content-url" ? "https://a.b/" : "x";
    assert.throws(
      () => parseContract(withKeys(`${k}: ${v}\n${k}: ${v}\n`), ROOT),
      new RegExp(`契约结构键重复：${k}`),
      `${k} 重复应拒`,
    );
  }
  const ok = parseContract(withKeys("page: /a\npage: /b\n"), ROOT);
  assert.deepEqual(ok.pages, ["/a", "/b"]);
});

test("⑤形状校验：repo=owner/name、page 以 / 起、content-url http(s)、非空值", () => {
  assert.throws(() => parseContract(withKeys("repo: lazyzcode\n"), ROOT), /契约 repo 非法：lazyzcode/);
  assert.throws(() => parseContract(withKeys("repo: a/b/c\n"), ROOT), /契约 repo 非法：a\/b\/c/);
  assert.throws(() => parseContract(withKeys("page: guide/zh.html\n"), ROOT), /契约 page 非法：guide\/zh.html/);
  assert.throws(() => parseContract(withKeys("content-url: ftp://a.b/\n"), ROOT), /契约 content-url 非法/);
  assert.throws(() => parseContract(withKeys("branch:\n"), ROOT), /契约 branch 为空/);
  const c = parseContract(withKeys("repo: Acfufu/lazyzcode\n"), ROOT);
  assert.equal(c.repo, "Acfufu/lazyzcode");
});
