// attestation 尾注核验行夹具单测（v024-debt-bundle N3 / 债三机器半）：判定优先级四态
// 钉死——全符 ok（含核验条数）/ 悬空 warn 逐条点名 / 零尾注 ok / 目录缺席且零尾注 skip，
// 另钉部分缺配 warn 与 git 缺席 skip 两边界。临时夹具仓+直呼 checkAttestationTrailer
//（同 checkLedger 家法）；不触碰真实仓库 .lazyzcode/。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkAttestationTrailer } from "../core/doctor.js";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

function fixtureRepo(prefix, { trailerHashes = [], attestFiles = [], trailerCase = "upper" } = {}) {
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
    const label = trailerCase === "lower" ? "lzy-attestation" : "Lzy-Attestation";
    g(["commit", "-qm", "close-out", "-m", `${label}: ${h}`]);
  }
  // 目录在场=显式建（attestFiles 空数组 + zero 前缀=空目录，与「目录缺席」是两态）
  if (attestFiles.length > 0 || prefix.includes("zero")) mkdirSync(join(d, ".lazyzcode", "attestations"), { recursive: true });
  for (const content of attestFiles) writeFileSync(join(d, ".lazyzcode", "attestations", `${sha256(content).slice(0, 10)}.json`), content);
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

test("尾注核验四态：零尾注+空目录=ok / +有文件=warn 报数（ADJ-28）；目录缺席且零尾注=skip", () => {
  // ADJ-28（v024-fix-round#N10）：目录有文件而史无尾注原报 ok「无尾注记录」——机器证明已落盘
  // 却无法从提交史回溯，属可操作的事实，改报 warn 并点名文件数。两半都钉。
  const emptyDir = fixtureRepo("lzy-attest-zero-", { attestFiles: [] });
  try {
    const [row] = runCheck(emptyDir);
    assert.equal(row.state, "ok", row.detail);
    assert.match(row.detail, /无尾注记录且目录无文件/);
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
  }
  const withFiles = fixtureRepo("lzy-attest-nofilms-", { attestFiles: ["{}", "{\"a\":1}"] });
  try {
    const [row] = runCheck(withFiles);
    assert.equal(row.state, "warn", row.detail);
    assert.match(row.detail, /现存 2 件机器证明/);
  } finally {
    rmSync(withFiles, { recursive: true, force: true });
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

test("尾注核验边界（ADJ-28）：内容被改动=措辞点两成因；大小写变体尾注不被预过滤吞；目录不可读=warn", () => {
  const content = JSON.stringify({ kind: "LOOP_COMPLETE", n: 7 });
  const tampered = fixtureRepo("lzy-attest-tampered-", {
    trailerHashes: [sha256(content)],
    attestFiles: [`${content} `], // 多一个空格 ⇒ 内容与尾注 sha 不符
  });
  try {
    const [row] = runCheck(tampered);
    assert.equal(row.state, "warn", row.detail);
    assert.match(row.detail, /无\*\*内容相符\*\*的文件/, "不得再报成「没有那个文件」");
    assert.match(row.detail, /已被改动或替换/, "须点出篡改成因");
  } finally {
    rmSync(tampered, { recursive: true, force: true });
  }
  const lower = fixtureRepo("lzy-attest-lower-", { trailerHashes: [sha256(content)], trailerCase: "lower", attestFiles: [content] });
  try {
    const [row] = runCheck(lower);
    assert.equal(row.state, "ok", `小写尾注须与正则同宽被提取：${row.detail}`);
  } finally {
    rmSync(lower, { recursive: true, force: true });
  }
  const unreadable = fixtureRepo("lzy-attest-noread-", { attestFiles: [content] });
  try {
    chmodSync(join(unreadable, ".lazyzcode", "attestations"), 0o000);
    const [row] = runCheck(unreadable);
    // 目录不可读：有尾注时报 warn（且不炸）；无尾注时同走 warn 分支
    assert.equal(row.state, "warn", row.detail);
    assert.match(row.detail, /目录不可读/);
  } finally {
    chmodSync(join(unreadable, ".lazyzcode", "attestations"), 0o755);
    rmSync(unreadable, { recursive: true, force: true });
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
