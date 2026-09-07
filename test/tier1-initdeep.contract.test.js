// tier-1 init-deep 契约测试：AGENTS.md 分层审计（core/agentsmd.js 资格谓词+覆盖审计）
// 的纯函数面 + lzy agents-md / lzy doctor 两条真实 stdout 面。fixture 全落 scratch。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditAgentsMd, formatAgentsMd, ROOT_LINE_CAP, CHILD_LINE_CAP } from "../core/agentsmd.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");

function fixture(overrides = {}) {
  const d = mkdtempSync(join(tmpdir(), "lzy-amd-"));
  const w = (rel, body) => {
    const p = join(d, rel);
    mkdirSync(p.slice(0, p.lastIndexOf("/")), { recursive: true });
    writeFileSync(p, body);
  };
  // 根：提及 docs/（声明覆盖）与 api/；plain/ 刻意不提及
  w(
    "AGENTS.md",
    "# map\ndocs/ 文档\napi/ 服务端\n",
  );
  w("api/package.json", "{}\n");
  w("api/AGENTS.md", "# api\n");
  w("docs/a.md", "x\n");
  w("docs/b.md", "x\n");
  w("scripts/package.json", "{}\n"); // 有构建入口、无子文件、未提及 → 缺
  w("plain/a.md", "x\n"); // 无入口、文件少、未提及 → 不够格
  // misc/：41 个直接文件，无入口，未提及 → 按文件数够格 → 缺
  for (let i = 0; i < 41; i += 1) w(`misc/f${i}.txt`, "x\n");
  // 深度边界：depth 4 的目录不被扫描（maxDepth=3 → 根 0，子 1..3）
  w("deep/a/b/c/AGENTS.md", "# too deep to scan\n");
  return d;
}

test("资格谓词与覆盖审计：入口/文件数/提及三路，缺口与深度边界", () => {
  const d = fixture();
  try {
    const a = auditAgentsMd(d);
    assert.equal(a.rootExists, true);
    const byPath = Object.fromEntries(a.dirs.map((x) => [x.path, x]));
    // 入口路：够格 + 有子文件 = 覆盖
    assert.equal(byPath["api"].qualifies, true);
    assert.equal(byPath["api"].hasManifest, true);
    assert.equal(byPath["api"].hasChild, true);
    // 文件数路：>40 直接文件即够格
    assert.equal(byPath["misc"].qualifies, true);
    assert.equal(byPath["misc"].hasManifest, false);
    // 提及路：docs/ 被根提及 → 够格且被根覆盖（无需子文件）
    assert.equal(byPath["docs"].qualifies, true);
    assert.equal(byPath["docs"].mentioned, true);
    assert.equal(byPath["docs"].hasChild, false);
    // 不够格：plain/ 无入口、文件少、未提及
    assert.equal(byPath["plain"].qualifies, false);
    // 缺口：够格且既无子文件也未被提及
    assert.deepEqual([...a.missing].sort(), ["misc", "scripts"]);
    // 深度边界：depth ≤3 的目录在界内（deep/、deep/a/、deep/a/b/），depth 4 的 c 不被扫描
    assert.equal(a.dirs.some((x) => x.path === "deep/a/b/c"), false);
    assert.equal(a.dirs.some((x) => x.path === "deep/a/b"), true);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("行数软上限：根超 ROOT_LINE_CAP、子超 CHILD_LINE_CAP 各自入账", () => {
  const d = fixture();
  try {
    writeFileSync(join(d, "AGENTS.md"), `${Array.from({ length: ROOT_LINE_CAP + 1 }, (_, i) => `l${i}`).join("\n")}\n`);
    writeFileSync(join(d, "api", "AGENTS.md"), `${Array.from({ length: CHILD_LINE_CAP + 1 }, (_, i) => `l${i}`).join("\n")}\n`);
    const a = auditAgentsMd(d);
    assert.deepEqual(a.over.map((o) => o.path).sort(), ["AGENTS.md", "api/AGENTS.md"]);
    assert.match(formatAgentsMd(a), /超限 2/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("无根文件：rootExists=false，format 走 init-deep 指引文案", () => {
  const d = mkdtempSync(join(tmpdir(), "lzy-amd2-"));
  try {
    mkdirSync(join(d, "api"), { recursive: true });
    writeFileSync(join(d, "api", "package.json"), "{}\n");
    const a = auditAgentsMd(d);
    assert.equal(a.rootExists, false);
    assert.equal(a.dirs.length, 0);
    assert.match(formatAgentsMd(a), /init-deep/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("lzy agents-md：缺口退出码 1 + 详单行；补齐后退出码 0", () => {
  const d = fixture();
  const home = mkdtempSync(join(tmpdir(), "lzy-amd-home-"));
  try {
    const run = (args) => spawnSync(process.execPath, [CLI, ...args], {
      cwd: d, encoding: "utf8", timeout: 60_000, env: { ...process.env, HOME: home },
    });
    const r1 = run(["agents-md"]);
    assert.equal(r1.status, 1);
    assert.match(r1.stdout, /缺 2/);
    assert.match(r1.stdout, /scripts\//);
    assert.match(r1.stdout, /misc\//);
    // 补齐 scripts/（子文件）→ misc 仍缺
    writeFileSync(join(d, "scripts", "AGENTS.md"), "# scripts\n");
    const r2 = run(["agents-md"]);
    assert.match(r2.stdout, /缺 1/);
    assert.equal(r2.status, 1); // misc 仍缺
    // 根地图提及 misc/ → 根覆盖，退出码 0
    writeFileSync(join(d, "AGENTS.md"), "# map\ndocs/ 文档\napi/ 服务端\nplain/ 杂物\nmisc/ 生成物\n");
    const r3 = run(["agents-md"]);
    assert.equal(r3.status, 0);
    assert.match(r3.stdout, /覆盖完整|缺 0/);
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor agents-md 行：warn（有缺口）/ ok（覆盖完整）/ skip（无根文件）三态", () => {
  const mk = () => mkdtempSync(join(tmpdir(), "lzy-amd-doc-"));
  const home = mkdtempSync(join(tmpdir(), "lzy-amd-doc-home-"));
  const line = (stdout) => (stdout ?? "").split("\n").find((l) => /^\s*\S\s+agents-md\s/.test(l));
  try {
    // warn：fixture 有缺口
    const d1 = fixture();
    try {
      const r = spawnSync(process.execPath, [CLI, "doctor"], {
        cwd: d1, encoding: "utf8", timeout: 120_000, env: { ...process.env, HOME: home },
      });
      const l = line(`${r.stdout ?? ""}${r.stderr ?? ""}`);
      assert.ok(l, "doctor 输出应含 agents-md 行");
      assert.match(l, /⚠/);
      assert.match(l, /缺 2/);
    } finally {
      rmSync(d1, { recursive: true, force: true });
    }
    // ok：根提及全部够格目录
    const d2 = mk();
    try {
      writeFileSync(join(d2, "AGENTS.md"), "# map\napi/ 服务\n");
      mkdirSync(join(d2, "api"), { recursive: true });
      writeFileSync(join(d2, "api", "package.json"), "{}\n");
      const r = spawnSync(process.execPath, [CLI, "doctor"], {
        cwd: d2, encoding: "utf8", timeout: 120_000, env: { ...process.env, HOME: home },
      });
      const l = line(`${r.stdout ?? ""}${r.stderr ?? ""}`);
      assert.ok(l);
      assert.match(l, /✔/);
      assert.match(l, /覆盖完整/);
    } finally {
      rmSync(d2, { recursive: true, force: true });
    }
    // skip：无根文件
    const d3 = mk();
    try {
      const r = spawnSync(process.execPath, [CLI, "doctor"], {
        cwd: d3, encoding: "utf8", timeout: 120_000, env: { ...process.env, HOME: home },
      });
      const l = line(`${r.stdout ?? ""}${r.stderr ?? ""}`);
      assert.ok(l);
      assert.match(l, /➖/);
      assert.match(l, /不存在/);
    } finally {
      rmSync(d3, { recursive: true, force: true });
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
