// 正式配对执行器契约测试（0.4.0 M5 N6；plan §8 新增 evaluation-runner 测试清单落点）：
// 交错序确定性/预飞拒矩阵/中断恢复标记/完整性拒（journal sha 链）/质量门语义/oracle 子进程。
// 零真会话零网络（oracle 用 bash 夹具命令；预飞用临时绝对路径指向的假清单）。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RP = join(ROOT, "scripts", "evaluation", "run-pairs.mjs");

const { deriveSequence, chainSha, verifyJournalChain, qualityGate, preflight, appendJournal, loadJournal, writeReport } = await import(
  `file://${RP}`
);
const sha256Of = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

describe("①交错序确定性（seed 派生，无 RNG 可重放）", () => {
  const repoTaskIds = { lazyzcode: ["task-a1", "task-b2"], openchamber: ["task-c3", "task-d4"], "zpigeon-ios": ["task-e5", "task-f6"] };
  test("同 seed 双调逐字节等序；36 项覆盖 3 仓×2 任务×3 trial×2 臂；seq 1..36", () => {
    const s1 = deriveSequence(20260927, repoTaskIds);
    const s2 = deriveSequence(20260927, repoTaskIds);
    assert.equal(JSON.stringify(s1), JSON.stringify(s2), "同 seed 序漂移");
    assert.equal(s1.length, 36);
    assert.deepEqual(
      [...new Set(s1.map((x) => `${x.repo}/${x.taskId}/t${x.trial}/${x.arm}`))].length,
      36,
      "覆盖不全（有重复 cell）",
    );
    assert.deepEqual(
      s1.map((x) => x.seq),
      Array.from({ length: 36 }, (_, i) => i + 1),
    );
    const other = deriveSequence(20260928, repoTaskIds);
    assert.notEqual(JSON.stringify(s1), JSON.stringify(other), "不同 seed 序相同（洗牌失效）");
  });
});

describe("②journal sha 链与完整性拒", () => {
  const line = (o) => JSON.stringify(o);
  function buildChain(records) {
    let prev = "0".repeat(64);
    return records.map((r) => {
      const raw = line(r);
      const sha = chainSha(prev, raw);
      prev = sha;
      return { raw, sha };
    });
  }
  test("好链通过；删行/改行/插行必拒（V14 删一条结果 report 必拒）", () => {
    const chain = buildChain([{ seq: 1, status: "ok" }, { seq: 2, status: "ok" }, { seq: 3, status: "timeout" }]);
    assert.equal(verifyJournalChain(chain).ok, true);
    assert.equal(verifyJournalChain([chain[0], chain[2]]).ok, false, "删行未拒");
    const tampered = [...chain];
    tampered[1] = { ...chain[1], raw: line({ seq: 2, status: "ok", tampered: true }) };
    assert.equal(verifyJournalChain(tampered).ok, false, "改行未拒");
    assert.equal(verifyJournalChain([]).ok, true, "空链应通过");
  });
  test("appendJournal 落盘后 loadJournal 可验；篡改盘面后 verify 拒", () => {
    const d = mkdtempSync(join(tmpdir(), "lzy-rpj-"));
    try {
      appendJournal(d, { seq: 1, status: "ok", points: 3 });
      appendJournal(d, { seq: 2, status: "timeout", points: 0 });
      let j = loadJournal(d);
      assert.equal(j.lines.length, 2);
      assert.equal(verifyJournalChain(j.lines).ok, true);
      const env = JSON.parse(readFileSync(j.path, "utf8").trim().split("\n")[0]);
      env.line = env.line.replace('"points":3', '"points":999'); // 记录被改写、信封 sha 保持原值 ⇒ 链必拒
      const rest = readFileSync(j.path, "utf8").trim().split("\n").slice(1).join("\n");
      writeFileSync(j.path, `${JSON.stringify(env)}\n${rest}\n`);
      j = loadJournal(d);
      assert.equal(verifyJournalChain(j.lines).ok, false, "盘面篡改未拒");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("③质量门语义（§9.2）", () => {
  const mk = (over) => ({ repo: "r", taskId: "t1", trial: 1, arm: "new", status: "ok", oraclePassed: true, goalDone: true, ...over });
  test("全绿且严格改善 ⇒ met；新臂错误完成 ⇒ 拒；打平 ⇒ 尚无证据；2/3 不足 ⇒ 拒", () => {
    const base = [1, 2, 3].map((t) => mk({ arm: "old", trial: t, oraclePassed: t <= 2, goalDone: t <= 2 }));
    const fresh = [1, 2, 3].map((t) => mk({ arm: "new", trial: t, oraclePassed: true, goalDone: true }));
    assert.equal(qualityGate([...base, ...fresh]).met, true);
    const bad = [...base, ...fresh.map((r, i) => (i === 0 ? mk({ trial: 1, oraclePassed: false, goalDone: true }) : r))];
    const q1 = qualityGate(bad);
    assert.equal(q1.met, false);
    assert.ok(q1.reasons.some((r) => r.includes("错误完成")), q1.reasons.join("|"));
    const same = [...base, ...base.map((r) => mk({ arm: "new", trial: r.trial, oraclePassed: r.oraclePassed, goalDone: r.goalDone }))];
    const q2 = qualityGate(same);
    assert.equal(q2.met, false);
    assert.ok(q2.reasons.some((r) => r.includes("尚无质量收益证据")), q2.reasons.join("|"));
    const thin = [...base, ...fresh.map((r, i) => (i < 2 ? mk({ ...r, oraclePassed: false }) : r))];
    const q3 = qualityGate(thin);
    assert.equal(q3.met, false);
    assert.ok(q3.reasons.some((r) => r.includes("≥2/3")), q3.reasons.join("|"));
  });
});

describe("④oracle 子进程（判据命令在夹具内执行，实现方不读内容）", () => {
  test("全过 exit 0；含失败 exit 1；result JSON 逐 check 记录", () => {
    const d = mkdtempSync(join(tmpdir(), "lzy-orc-"));
    try {
      writeFileSync(join(d, "a.txt"), "x\n");
      const oracleOk = join(d, "oracle-ok.json");
      writeFileSync(
        oracleOk,
        JSON.stringify({ task: "t", checks: [{ id: "c1", kind: "cmd", command: "test -f a.txt", expect: "" }, { id: "c2", kind: "cmd", command: "echo marker-777", expect: "marker-777" }] }),
      );
      const out1 = join(d, "r1.json");
      const x1 = spawnSync(process.execPath, [RP, "--eval-oracle", oracleOk, "--eval-cwd", d, "--eval-out", out1], { encoding: "utf8", timeout: 60_000 });
      assert.equal(x1.status, 0, x1.stderr);
      const r1 = JSON.parse(readFileSync(out1, "utf8"));
      assert.equal(r1.passed, true);
      assert.equal(`${r1.checksPassed}/${r1.checksTotal}`, "2/2");
      const oracleBad = join(d, "oracle-bad.json");
      writeFileSync(oracleBad, JSON.stringify({ task: "t", checks: [{ id: "c1", kind: "cmd", command: "test -f a.txt", expect: "" }, { id: "c2", kind: "cmd", command: "false", expect: "" }, { id: "c3", kind: "cmd", command: "echo hello", expect: "absent-token" }] }));
      const out2 = join(d, "r2.json");
      const x2 = spawnSync(process.execPath, [RP, "--eval-oracle", oracleBad, "--eval-cwd", d, "--eval-out", out2], { encoding: "utf8", timeout: 60_000 });
      assert.equal(x2.status, 1);
      const r2 = JSON.parse(readFileSync(out2, "utf8"));
      assert.equal(r2.passed, false);
      assert.equal(`${r2.checksPassed}/${r2.checksTotal}`, "1/3");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  // N9 仪面缺陷红绿（goal v040-m5-eval-release）：①$FIXTURE 未注入（密封判据全部引用
  // $FIXTURE 指向物化仓，旧实现 spawn 无 env ⇒ bash 展开空串 `cd /packages/web`——批内
  // oracle-result.json 存证）②「exit code 0 AND … contains M」结构化判据句被当字面子串
  // （prose 永不在输出中原样出现 ⇒ 全批 oracle 恒 false）。
  test("FIXTURE 注入物化仓；结构化 expect（exit code 0 + contains 标记）机械解析", () => {
    const d = mkdtempSync(join(tmpdir(), "lzy-orc2-"));
    try {
      const oracleFx = join(d, "oracle-fixture.json");
      writeFileSync(
        oracleFx,
        JSON.stringify({
          task: "t",
          checks: [
            { id: "fixture-injection", kind: "cli", command: `test "$(cd "$FIXTURE" && pwd -P)" = "$(pwd -P)" || { echo "FIXTURE-WRONG:[$FIXTURE]"; exit 9; }\necho FIXTURE-MARKER-OK`, expect: "exit code 0 AND stdout contains FIXTURE-MARKER-OK" },
            { id: "structured-bare-marker", kind: "cli", command: "echo HELLO-MARKER-88", expect: "exit code 0 AND stdout contains HELLO-MARKER-88" },
            { id: "structured-quoted-marker", kind: "cli", command: 'echo "build: TEST SUCCEEDED-XYZ"', expect: 'exit code 0 AND build log contains "TEST SUCCEEDED-XYZ" AND prose conditions' },
            { id: "structured-fail-when-marker-absent", kind: "cli", command: "echo nothing-relevant", expect: "exit code 0 AND stdout contains ABSENT-MARKER-99" },
          ],
        }),
      );
      const out = join(d, "r.json");
      const x = spawnSync(process.execPath, [RP, "--eval-oracle", oracleFx, "--eval-cwd", d, "--eval-out", out], { encoding: "utf8", timeout: 60_000 });
      const r = JSON.parse(readFileSync(out, "utf8"));
      const byId = Object.fromEntries(r.checks.map((c) => [c.id, c]));
      assert.equal(byId["fixture-injection"].ok, true, JSON.stringify(byId["fixture-injection"]));
      assert.equal(byId["structured-bare-marker"].ok, true, JSON.stringify(byId["structured-bare-marker"]));
      assert.equal(byId["structured-quoted-marker"].ok, true, JSON.stringify(byId["structured-quoted-marker"]));
      assert.equal(byId["structured-fail-when-marker-absent"].ok, false, "标记缺席必须仍判 fail");
      assert.equal(x.status, 1, "含失败 check 的 oracle 整体 exit 1");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("⑤预飞拒矩阵（fail-closed）", () => {
  function sealedFixture() {
    const base = mkdtempSync(join(tmpdir(), "lzy-pf-"));
    const sealedRoot = join(base, "sealed");
    const taskDir = join(sealedRoot, "lazyzcode", "task-1");
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, "brief.md"), "brief content\n");
    writeFileSync(join(taskDir, "defect-spec.md"), "defect\n");
    writeFileSync(join(taskDir, "oracle.json"), JSON.stringify({ task: "task-1", checks: [] }));
    const manifestJson = join(sealedRoot, "MANIFEST.json");
    writeFileSync(manifestJson, JSON.stringify({ schemaVersion: 1, generatedAt: "t", sealedBy: "x", repos: { lazyzcode: { snapshotCommit: "0".repeat(40), tasks: [{ id: "lazyzcode/task-1", briefSha256: sha256Of(join(taskDir, "brief.md")), defectSpecSha256: sha256Of(join(taskDir, "defect-spec.md")), oracleSha256: sha256Of(join(taskDir, "oracle.json")) }] } }, seed: 1 }));
    const manifestsDir = join(base, "manifests");
    mkdirSync(manifestsDir, { recursive: true });
    const repoManifest = join(manifestsDir, "m0-freeze-lazyzcode.json");
    writeFileSync(repoManifest, JSON.stringify({ schemaVersion: 1, budget: { wallMsPerRun: 1000, pointsPerRun: 10 } }));
    const index = join(base, "index.json");
    writeFileSync(index, JSON.stringify({ schemaVersion: 1, manifests: { lazyzcode: repoManifest }, evalSet: { sealedRoot, files: 4, manifestSha256: sha256Of(manifestJson) } }));
    const tgzB = join(base, "b.tgz");
    const tgzC = join(base, "c.tgz");
    writeFileSync(tgzB, "baseline bytes");
    writeFileSync(tgzC, "candidate bytes");
    return { base, index, sealedRoot, manifestJson, tgzB, tgzC, repoManifest };
  }
  const goodCwd = () => {
    const d = mkdtempSync(join(tmpdir(), "lzy-pf-cwd-"));
    mkdirSync(join(d, ".lazyzcode", "loop", "snapshots"), { recursive: true });
    writeFileSync(join(d, ".lazyzcode", "loop", "goal.json"), JSON.stringify({ slug: "fx", status: "executing" }));
    writeFileSync(join(d, ".lazyzcode", "loop", "snapshots", "fx.md"), "# plan\n");
    return d;
  };
  const args = (fx, over = {}) => ({ manifest: fx.index, baseline: fx.tgzB, candidate: fx.tgzC, out: join(fx.base, "out"), "source-lazyzcode": ROOT, ...over });

  test("基态：包/sealed/task sha/授权齐备 ⇒ 预飞通过并冻结 36 序", () => {
    const fx = sealedFixture();
    const cwd = goodCwd();
    try {
      // 冻结提交可达性：sealed 里 snapshotCommit 用真 lazyzcode HEAD
      const head = spawnSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
      const sealed = JSON.parse(readFileSync(fx.manifestJson, "utf8"));
      sealed.repos.lazyzcode.snapshotCommit = head;
      writeFileSync(fx.manifestJson, JSON.stringify(sealed));
      const idx = JSON.parse(readFileSync(fx.index, "utf8"));
      idx.evalSet.manifestSha256 = sha256Of(fx.manifestJson);
      writeFileSync(fx.index, JSON.stringify(idx));
      const r = preflight(args(fx), { cwd });
      assert.equal(r.blocked, undefined, `基态被拒：${r.blocked}`);
      assert.equal(r.batch.sequence.length, 6, "1 仓×1 任务×3 trial×2 臂=6");
      assert.equal(r.batch.auth.slug, "fx");
      assert.ok(r.batch.packages.candidate.sha256);
    } finally {
      rmSync(fx.base, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });
  test("拒面：包缺席/sealed sha 不符/task 文件 sha 不符/缺冻结提交/授权缺席", () => {
    const fx = sealedFixture();
    const cwd = goodCwd();
    try {
      const realHead = spawnSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
      const sealed0 = JSON.parse(readFileSync(fx.manifestJson, "utf8"));
      sealed0.repos.lazyzcode.snapshotCommit = realHead;
      writeFileSync(fx.manifestJson, JSON.stringify(sealed0));
      const idx0 = JSON.parse(readFileSync(fx.index, "utf8"));
      idx0.evalSet.manifestSha256 = sha256Of(fx.manifestJson);
      writeFileSync(fx.index, JSON.stringify(idx0));
      assert.match(preflight(args(fx, { baseline: join(fx.base, "nope.tgz") }), { cwd }).blocked, /--baseline 包缺席/);
      const badIdx = JSON.parse(readFileSync(fx.index, "utf8"));
      badIdx.evalSet.manifestSha256 = "f".repeat(64);
      const badIdxPath = join(fx.base, "index-bad.json");
      writeFileSync(badIdxPath, JSON.stringify(badIdx));
      assert.match(preflight(args(fx, { manifest: badIdxPath }), { cwd }).blocked, /封存 MANIFEST sha256 不符/);
      // 授权缺席（cwd 无 goal；须在篡改 task 文件之前——预飞检查序 task sha 先于授权）
      const noGoal = mkdtempSync(join(tmpdir(), "lzy-pf-nogoal-"));
      assert.match(preflight(args(fx), { cwd: noGoal }).blocked, /原始授权标记缺席/);
      rmSync(noGoal, { recursive: true, force: true });
      writeFileSync(join(fx.sealedRoot, "lazyzcode", "task-1", "brief.md"), "tampered\n");
      assert.match(preflight(args(fx), { cwd }).blocked, /封存任务文件 sha 不符/);
    } finally {
      rmSync(fx.base, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("⑥report 完整性拒（包/环境/journal 三面）", () => {
  test("链断拒；包字节改拒；齐备时输出 §9.2 结论行", () => {
    const d = mkdtempSync(join(tmpdir(), "lzy-rep-"));
    try {
      const tgzB = join(d, "b.tgz");
      const tgzC = join(d, "c.tgz");
      writeFileSync(tgzB, "b");
      writeFileSync(tgzC, "c");
      const batch = {
        batchId: "fx",
        packages: { baseline: { path: tgzB, sha256: sha256Of(tgzB) }, candidate: { path: tgzC, sha256: sha256Of(tgzC) } },
        env: { node: process.version },
      };
      appendJournal(d, { seq: 1, repo: "r", taskId: "t", trial: 1, arm: "old", status: "ok", oraclePassed: true, goalDone: true });
      appendJournal(d, { seq: 2, repo: "r", taskId: "t", trial: 1, arm: "new", status: "ok", oraclePassed: true, goalDone: true });
      const ok = writeReport(d, batch, loadJournal(d).lines.map((l) => l.record).filter(Boolean));
      assert.equal(ok.refused, false);
      assert.match(ok.report.conclusion, /质量收益证据|质量门满足/);
      // 包改动 → 拒
      writeFileSync(tgzC, "c-tampered");
      const ref1 = writeReport(d, batch, []);
      assert.equal(ref1.refused, true);
      assert.equal(ref1.integrity.packagesMatch, false);
      // 链断 → 拒
      writeFileSync(join(d, "journal.jsonl"), `${JSON.stringify({ sha: "0".repeat(64), line: JSON.stringify({ seq: 9 }) })}\n`);
      const ref2 = writeReport(d, batch, []);
      assert.equal(ref2.refused, true);
      assert.equal(ref2.integrity.journalChain, false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
