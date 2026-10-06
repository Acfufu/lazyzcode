// 异议原语契约（决策 #44，2026-10-01 grill 四象限拍板；goal orch-discipline#N4）：
// findings 状态机 open→contested 边（书面异议、不改代码、非修复声称）+ contested→
// closed-falsified|open 复判裁决（recheck 须 contestedOf 标记）+ 旧账读侧兼容（contest 键
// 缺席=undefined 容忍）+ 阻塞在场（contested 不解除统一门 findings 子句）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  contestFinding,
  adjudicateContest,
  requestResolve,
  loadFindingsFile,
  listFindings,
  openBlockingFindings,
  findingFingerprint,
  FINDINGS_VERSION,
  FINDING_STATUSES,
  assertFindingsShape,
  relinkFindings,
} from "../core/findings.js";
import { saveFamilyFile } from "../core/queue.js";

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "lzy-contest-"));
  mkdirSync(join(cwd, ".lazyzcode", "findings"), { recursive: true });
  // 0.4.0 形状旧档：无 contest 键（读侧兼容命题的对照面）——saveFamilyFile 家法写盘（带 checksum）
  const fp = findingFingerprint({ severity: "P1", title: "评审员发现的问题", location: "src/a.js:1" });
  const old = {
    slug: "demo",
    aliases: [],
    findings: {
      [fp]: {
        severity: "P1",
        title: "评审员发现的问题",
        location: "src/a.js:1",
        duty: "review.general-correctness",
        status: "open",
        firstSeen: { runId: "demo.a1.r1", attempt: 1, at: "2026-09-28T00:00:00.000Z" },
        lastSeen: { runId: "demo.a1.r1", attempt: 1, at: "2026-09-28T00:00:00.000Z" },
        occurrences: 1,
        invalidFixCount: 0,
        resolveRequest: null,
        closure: null,
        diagnosis: null,
        history: [{ at: "2026-09-28T00:00:00.000Z", kind: "seen", runId: "demo.a1.r1", attempt: 1 }],
      },
    },
  };
  saveFamilyFile(join(cwd, ".lazyzcode", "findings", "demo.json"), old, {
    versionKey: "schemaVersion",
    version: FINDINGS_VERSION,
    label: "发现账本",
    shapeFn: assertFindingsShape,
  });
  const grounds = join(cwd, "grounds.md");
  writeFileSync(grounds, "该发现不成立：位置行是测试夹具非业务代码。\n");
  return { cwd, fp, grounds };
}

const validRecheck = (over = {}) => ({
  runId: "demo.a1.r2",
  valid: true,
  slug: "demo",
  attempt: 1,
  dutyId: "review.general-correctness",
  reportedFingerprints: [],
  isRecheck: true,
  contestedOf: null,
  at: "2026-10-01T12:00:00.000Z",
  ...over,
});

test("旧档（0.4.0 形状、无 contest 键）读侧兼容：list/openBlocking 照读不拒", () => {
  const { cwd, fp } = fixture();
  const rows = listFindings(cwd, "demo");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "open");
  assert.equal(openBlockingFindings(cwd, "demo").length, 1);
  assert.equal(rows[0].fingerprint, fp);
});

test("contest：open→contested，异议书 sha256 入档；contested 态受理重交（0.5.0 M0 F-1）；resolve-request 仍拒", () => {
  const { cwd, fp, grounds } = fixture();
  const r = contestFinding(cwd, "demo", fp, { groundsPath: grounds, note: "by design", at: "2026-10-01T08:00:00.000Z" });
  assert.equal(r.status, "contested");
  const e = loadFindingsFile(cwd, "demo").findings[fp];
  assert.equal(e.status, "contested");
  assert.equal(e.contest.groundsPath, grounds);
  assert.match(e.contest.groundsSha256, /^[0-9a-f]{64}$/);
  assert.equal(e.contest.note, "by design");
  // contested 态重交=恢复通道（0.5.0 M0 评审 F-1：新文书整体置换 contest 记录，历史只追加）
  const grounds2 = join(cwd, "grounds-v2.md");
  writeFileSync(grounds2, "重新提交的异议书正文。\n");
  const r2 = contestFinding(cwd, "demo", fp, { groundsPath: grounds2, at: "2026-10-01T09:00:00.000Z" });
  assert.equal(r2.status, "contested");
  const e2 = loadFindingsFile(cwd, "demo").findings[fp];
  assert.equal(e2.contest.groundsPath, grounds2);
  assert.notEqual(e2.contest.groundsSha256, e.contest.groundsSha256);
  assert.match(e2.history.at(-1).note, /重新提交异议书/);
  // resolve-request 拒（状态机分流：修复声称走 close 通道，重交走 contest）
  assert.throws(() => requestResolve(cwd, "demo", fp, {}), /状态机拒绝：contested 态不受理 resolve-request/);
});

test("contest 缺 --grounds 拒；grounds 文件缺席拒", () => {
  const { cwd, fp } = fixture();
  assert.throws(() => contestFinding(cwd, "demo", fp, {}), /异议书必填/);
  assert.throws(() => contestFinding(cwd, "demo", fp, { groundsPath: join(cwd, "no-such.md") }), /异议书不可读/);
});

test("adjudicate upheld：recheck 不再报该指纹 → closed-falsified（closure.contested=true）", () => {
  const { cwd, fp, grounds } = fixture();
  contestFinding(cwd, "demo", fp, { groundsPath: grounds, at: "2026-10-01T08:00:00.000Z" });
  const r = adjudicateContest(cwd, "demo", fp, {
    upheld: true,
    basis: "复判同职责独立会话未再报——发现不成立",
    recheck: validRecheck({ contestedOf: fp }),
  });
  assert.equal(r.status, "closed-falsified");
  assert.equal(r.closure.contested, true);
  assert.equal(openBlockingFindings(cwd, "demo").length, 0);
});

test("adjudicate rejected：recheck 仍报该指纹 → 维持 open（contest 记录保留）", () => {
  const { cwd, fp, grounds } = fixture();
  contestFinding(cwd, "demo", fp, { groundsPath: grounds, at: "2026-10-01T08:00:00.000Z" });
  const r = adjudicateContest(cwd, "demo", fp, {
    upheld: false,
    basis: "复判仍报——异议驳回",
    recheck: validRecheck({ contestedOf: fp, reportedFingerprints: [fp] }),
  });
  assert.equal(r.status, "open");
  const e = loadFindingsFile(cwd, "demo").findings[fp];
  assert.equal(e.status, "open");
  assert.ok(e.contest, "contest 记录保留");
  // 历史含 contested 与 contest-rejected 两事件
  const kinds = e.history.map((h) => h.kind);
  assert.ok(kinds.includes("contested") && kinds.includes("contest-rejected"));
});

test("adjudicate 机械拒面：非 contestedOf 运行/仍报却 upheld/不再报却 rejected/非 recheck/时序", () => {
  const { cwd, fp, grounds } = fixture();
  contestFinding(cwd, "demo", fp, { groundsPath: grounds, at: "2026-10-01T08:00:00.000Z" });
  assert.throws(
    () => adjudicateContest(cwd, "demo", fp, { upheld: true, basis: "x", recheck: validRecheck({ contestedOf: null }) }),
    /非本发现异议复判/,
  );
  assert.throws(
    () => adjudicateContest(cwd, "demo", fp, { upheld: true, basis: "x", recheck: validRecheck({ contestedOf: fp, reportedFingerprints: [fp] }) }),
    /异议不能裁成立/,
  );
  assert.throws(
    () => adjudicateContest(cwd, "demo", fp, { upheld: false, basis: "x", recheck: validRecheck({ contestedOf: fp }) }),
    /异议不能裁驳回/,
  );
  assert.throws(
    () => adjudicateContest(cwd, "demo", fp, { upheld: true, basis: "x", recheck: validRecheck({ contestedOf: fp, isRecheck: false }) }),
    /非复核运行/,
  );
  assert.throws(
    () => adjudicateContest(cwd, "demo", fp, { upheld: true, basis: "x", recheck: validRecheck({ contestedOf: fp, valid: false }) }),
    /非 valid/,
  );
  assert.throws(
    () => adjudicateContest(cwd, "demo", fp, { upheld: true, basis: "x", recheck: validRecheck({ contestedOf: fp, at: "2020-01-01T00:00:00.000Z" }) }),
    /时序不符/,
  );
  // 状态机：adjudicate 后（closed）再裁拒
  adjudicateContest(cwd, "demo", fp, { upheld: true, basis: "x", recheck: validRecheck({ contestedOf: fp }) });
  assert.throws(
    () => adjudicateContest(cwd, "demo", fp, { upheld: true, basis: "x", recheck: validRecheck({ contestedOf: fp }) }),
    /状态机拒绝：closed-falsified 态不受理 adjudicate/,
  );
});

test("contested 阻塞在场：openBlockingFindings 含 contested（异议不解除统一门拦截）", () => {
  const { cwd, fp, grounds } = fixture();
  contestFinding(cwd, "demo", fp, { groundsPath: grounds, at: "2026-10-01T08:00:00.000Z" });
  const open = openBlockingFindings(cwd, "demo");
  assert.equal(open.length, 1);
  assert.equal(open[0].status, "contested");
});

test("FINDING_STATUSES 含 contested 且 FINDINGS_VERSION 保持 1（additive 不 bump）", () => {
  assert.ok(FINDING_STATUSES.includes("contested"));
  assert.equal(FINDINGS_VERSION, 1);
});

test("别名闭包：relink 改名后旧 slug 账上的 contested 发现对现行 slug 可读（阻塞发现 55c34e6b 修复面）", () => {
  const { cwd, fp, grounds } = fixture();
  contestFinding(cwd, "demo", fp, { groundsPath: grounds, at: "2026-10-01T08:00:00.000Z" });
  // 改名：demo → demo2（relink 后查询按 demo2 也须并集读到旧账条目）
  relinkFindings(cwd, "demo", "demo2");
  const rows = listFindings(cwd, "demo2", { includeClosed: true });
  const hit = rows.find((x) => x.fingerprint === fp);
  assert.ok(hit, "改名后经闭包读可见");
  assert.equal(hit.status, "contested");
  assert.equal(hit.originSlug, "demo", "originSlug 随行（close/adjudicate 落旧账）");
});
