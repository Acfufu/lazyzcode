// attestation 尾注核验行夹具单测（v024-debt-bundle N3 / 债三机器半）：判定优先级四态
// 钉死——全符 ok（含核验条数）/ 悬空 warn 逐条点名 / 零尾注 ok / 目录缺席且零尾注 skip，
// 另钉部分缺配 warn 与 git 缺席 skip 两边界。临时夹具仓+直呼 checkAttestationTrailer
//（同 checkLedger 家法）；不触碰真实仓库 .lazyzcode/。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkAttestationTrailer } from "../core/doctor.js";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

function fixtureRepo(prefix, { trailerHashes = [], attestFiles = [] } = {}) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "a\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "init"]);
  for (const h of trailerHashes) {
    writeFileSync(join(d, `b-${h.slice(0, 6)}.txt`), `${h}\n`);
    g(["add", "."]);
    g(["commit", "-qm", "close-out", "-m", `Lzy-Attestation: ${h}`]);
  }
  if (attestFiles.length > 0) {
    mkdirSync(join(d, ".lazyzcode", "attestations"), { recursive: true });
    for (const content of attestFiles) writeFileSync(join(d, ".lazyzcode", "attestations", `${sha256(content).slice(0, 10)}.json`), content);
  }
  return d;
}

const runCheck = (d) => {
  const rows = [];
  checkAttestationTrailer((name, state, detail) => rows.push({ name, state, detail }), d);
  return rows;
};

test("尾注核验四态：全符=ok 含核验条数", () => {
  const content = JSON.stringify({ kind: "LOOP_COMPLETE", n: 1 });
  const d = fixtureRepo("lzy-attest-full-", { trailerHashes: [sha256(content)], attestFiles: [content] });
  try {
    const [row] = runCheck(d);
    assert.equal(row.name, "attest-trailer");
    assert.equal(row.state, "ok", row.detail);
    assert.match(row.detail, /1\/1.*全符/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("尾注核验四态：尾注在场而目录缺席=悬空 warn 逐条点名", () => {
  const d = fixtureRepo("lzy-attest-dangling-", { trailerHashes: [sha256("x"), sha256("y")] });
  try {
    const [row] = runCheck(d);
    assert.equal(row.state, "warn", row.detail);
    assert.match(row.detail, /悬空尾注 2 条/);
    assert.match(row.detail, /目录缺席/);
    for (const h of [sha256("x"), sha256("y")]) assert.ok(row.detail.includes(h.slice(0, 8)), `逐条点名含 ${h.slice(0, 8)}：${row.detail}`);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("尾注核验四态：零尾注+目录在场=ok 无尾注记录；目录缺席且零尾注=skip", () => {
  const withDir = fixtureRepo("lzy-attest-zero-", { attestFiles: ["{}"] });
  try {
    const [row] = runCheck(withDir);
    assert.equal(row.state, "ok", row.detail);
    assert.match(row.detail, /无尾注记录/);
  } finally {
    rmSync(withDir, { recursive: true, force: true });
  }
  const bare = fixtureRepo("lzy-attest-skip-");
  try {
    const [row] = runCheck(bare);
    assert.equal(row.state, "skip", row.detail);
    assert.match(row.detail, /两态皆空/);
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
});

test("尾注核验边界：部分缺配=warn 点名缺哪条；非 git 目录=skip 不炸", () => {
  const hit = JSON.stringify({ kind: "LOOP_COMPLETE", n: 1 });
  const d = fixtureRepo("lzy-attest-partial-", { trailerHashes: [sha256(hit), sha256("gone")], attestFiles: [hit] });
  try {
    const [row] = runCheck(d);
    assert.equal(row.state, "warn", row.detail);
    assert.match(row.detail, /2 条中 1 条/);
    assert.ok(row.detail.includes(sha256("gone").slice(0, 8)), `点名缺失短码：${row.detail}`);
    assert.ok(!row.detail.includes(sha256(hit).slice(0, 8)), `在场尾注不点名：${row.detail}`);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
  const empty = mkdtempSync(join(tmpdir(), "lzy-attest-nogit-"));
  try {
    const [row] = runCheck(empty);
    assert.equal(row.state, "skip", row.detail);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});
