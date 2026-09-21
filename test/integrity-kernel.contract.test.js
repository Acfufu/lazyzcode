// integrity-kernel 契约测试（v008）：finish 完整性闸门四形态 / 复合指纹+verify 双轨 /
// subjects 面（头声明+add/remove+五拒）/ snapshot+planHash / tier+HEAVY 机器门 /
// finish-report 原子化 / 三显示面 / 缺键容忍 / doctor 疤痕豁免。
// 混合形态：核心行为直调 core/loop.js（快、确定）；CLI 表面走 spawn（隔离 HOME 双 env）。
// doctor spawn 沿 LZY_ZCODE_ENGINE 抑制家法（ratelimit.contract.test.js 先例）；
// win32 雷回避：隔离 HOME/USERPROFILE 双 env、平台分支断言（memory windows-test-mines-families）。
import { test } from "node:test";
// 人权门非本文件被测面（门由 human-gate.contract.test.js 两面钉）——spawn 继承此 env 保采纳畅通
process.env.LZY_ABLATE_HUMAN_GATE = "1";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, sep } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createGit } from "../core/git.js";
import {
  addSubject,
  adoptPlan,
  completeStep,
  finishLoop,
  fingerprintSubjects,
  readGoal,
  registerGoal,
  removeSubject,
  resetLoop,
  setTier,
  startLoop,
  verifyEvidence,
  writeGoalReport,
} from "../core/loop.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");
const SUPPRESS_ENGINE = "/nonexistent-lzy-suppressed-engine";
const HOME = mkdtempSync(join(tmpdir(), "lzy-v008-home-"));
const IS_WIN = process.platform === "win32";

function repo(prefix = "lzy-v008-") {
  const d = mkdtempSync(join(tmpdir(), prefix));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "a\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "init"]);
  return d;
}

function cli(args, cwd) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, HOME, USERPROFILE: HOME },
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const PLAN = "- [N1] x\n- [F1] v\n";
function writePlan(d, body = PLAN, name = "plan.md") {
  const p = join(d, name);
  writeFileSync(p, body);
  return p;
}
function goalJson(d) {
  return JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8"));
}
function cycle(d, { subjects = null, review = null, evidence = "ev" } = {}) {
  // register→plan(可选 subjects 头)→start→N1→F1 取证 的最小全链（每用例自建 scratch，勿共用）。
  // 计划一律置 .lazyzcode/ 内：根上未跟踪计划文件会绊 finish 完整性闸门（0.0.8 语义）。
  registerGoal(d, "t", "title");
  const body = subjects === null ? PLAN : `subjects: ${subjects}\n\n${PLAN}`;
  const p = writePlan(d, body, ".lazyzcode/plan.md");
  adoptPlan(d, p, review ? { review } : {});
  startLoop(d, createGit(d));
  completeStep(d, createGit(d), "N1", { note: "n" });
  completeStep(d, createGit(d), "F1", { evidence });
  return goalJson(d);
}

// ── git.js：headTreeHash、per-root 工厂、integrity 三态原语 ────────────────────
// 0.2.2 棒1#N9：deprecated 别名 treeHash() 已按承诺删除（原注释「一版后删」），本用例
// 原断言「别名与正名同值」——改为钉「正名在、别名已不在」，防它日后被顺手加回来。
test("git: headTreeHash 正名在、deprecated 别名已删；per-root 工厂隔离", () => {
  const d1 = repo();
  const d2 = repo();
  try {
    const h1 = createGit(d1).headTreeHash();
    assert.match(h1, /^[0-9a-f]{40,64}$/);
    assert.equal(createGit(d1).treeHash, undefined, "别名已删，不得回归");
    writeFileSync(join(d2, "a.txt"), "different content → different tree\n");
    spawnSync("git", ["commit", "-qam", "c2"], { cwd: d2 });
    assert.notEqual(createGit(d2).headTreeHash(), h1);
  } finally {
    rmSync(d1, { recursive: true, force: true });
    rmSync(d2, { recursive: true, force: true });
  }
});

test("git: integrity 原语 clean/dirty/missing/error 四态可辨", () => {
  const d = repo();
  const sib = repo("lzy-v008-sib-");
  try {
    assert.equal(createGit(d).integrity().state, "clean");
    writeFileSync(join(d, "uncommitted.txt"), "u\n");
    assert.equal(createGit(d).integrity().state, "dirty");
    mkdirSync(join(d, ".lazyzcode"), { recursive: true });
    writeFileSync(join(d, ".lazyzcode", "ledger"), "x");
    assert.equal(createGit(d).integrity().state, "dirty"); // .lazyzcode/ 豁免不改 dirty 判定，dirty 来自 uncommitted.txt
    // multisession-discipline#N1：dirty 态带命中路径，且 .lazyzcode/ 账本不入列表
    assert.deepEqual(createGit(d).integrity().paths, ["uncommitted.txt"]);
    assert.equal(createGit(join(d, "nope")).integrity().state, "missing");
    // fail-closed：index 成目录（部分 git 版本对垃圾字节 index 自愈恢复，故用目录占位）
    rmSync(join(sib, ".git", "index"));
    mkdirSync(join(sib, ".git", "index"));
    const r = createGit(sib).integrity();
    assert.equal(r.state, "error");
    assert.ok(r.detail && r.detail.length > 0);
    rmSync(join(sib, ".git", "index"), { recursive: true, force: true });
    spawnSync("git", ["reset", "-q", "--hard"], { cwd: sib });
    assert.equal(createGit(sib).integrity().state, "clean");
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(sib, { recursive: true, force: true });
  }
});

// ── subjects 计划头：正向解析 + 五拒 + allow 豁免 ────────────────────────────
test("subjects 头：多行相对路径→realpath 绝对路径数组；host 不入列", () => {
  const d = repo();
  const sib = repo("lzy-v008-sib-");
  try {
    registerGoal(d, "t", "title");
    const sibName = basename(sib); // 兄弟目录名（同 tmpdir 父级）
    const p = writePlan(d, `subjects: ../${sibName}\n\n${PLAN}`);
    adoptPlan(d, p, {});
    const g = goalJson(d);
    assert.equal(g.subjects.length, 1);
    assert.ok(g.subjects[0].endsWith(sibName));
    assert.ok(isAbsolute(g.subjects[0])); // realpath 绝对路径（POSIX 斜杠 / win32 盘符）
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(sib, { recursive: true, force: true });
  }
});

test("subjects 头四拒：不存在 / 非 git / 头内重复 / 正文杂散行；allow 豁免正测", () => {
  const d = repo();
  const sib = repo("lzy-v008-sib-");
  const sibName = basename(sib);
  try {
    registerGoal(d, "t", "title");
    assert.throws(() => adoptPlan(d, writePlan(d, `subjects: ../no-such-repo\n\n${PLAN}`), {}), /subject 路径不存在/);
    const plainSib = mkdtempSync(join(tmpdir(), "lzy-v008-plain-")); // 兄弟位置的普通目录（非 git）
    try {
      assert.throws(
        () => adoptPlan(d, writePlan(d, `subjects: ../${basename(plainSib)}\n\n${PLAN}`), {}),
        /不是 git 仓库/,
      );
    } finally {
      rmSync(plainSib, { recursive: true, force: true });
    }
    assert.throws(
      () => adoptPlan(d, writePlan(d, `subjects: ../${sibName}\nsubjects: ../${sibName}\n\n${PLAN}`), {}),
      /声明重复路径/,
    );
    assert.throws(
      () => adoptPlan(d, writePlan(d, `${PLAN}\nsubjects: ../${sibName}\n`), {}),
      /孤儿 subjects/,
    );
    const ok = adoptPlan(d, writePlan(d, `${PLAN}\n- 教学示例：subjects: ../${sibName} 语法 <!--lzy:allow-->\n`), {});
    assert.equal(ok.goal.subjects.length, 0);
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(sib, { recursive: true, force: true });
  }
});

test("subjects 包含关系拒：host 子目录与父目录均拒（尾分隔符判定）", () => {
  const d = repo();
  try {
    registerGoal(d, "t", "title");
    mkdirSync(join(d, "sub"));
    spawnSync("git", ["init", "-q"], { cwd: join(d, "sub") });
    spawnSync("git", ["commit", "-qm", "init", "--allow-empty"], { cwd: join(d, "sub") });
    assert.throws(() => adoptPlan(d, writePlan(d, "subjects: ./sub\n\n" + PLAN), {}), /包含关系/);
    assert.throws(() => adoptPlan(d, writePlan(d, `subjects: ${tmpdir()}\n\n${PLAN}`), {}), /包含关系/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── 指纹：稳定性/变化敏感/missing 参与/集合敏感/非 git host=null ──────────────
test("fingerprintSubjects：同态稳定、单根变化敏感、集合变化敏感、missing 参与、host 非 git=null", () => {
  const d = repo();
  const sib = repo("lzy-v008-sib-");
  try {
    const fp0 = fingerprintSubjects(d, []);
    assert.equal(fp0, fingerprintSubjects(d, [])); // 稳定
    assert.match(fp0, /^[0-9a-f]{64}$/);
    const sibName = basename(sib);
    const sibPath = join(tmpdir(), sibName);
    const fp1 = fingerprintSubjects(d, [sibPath]);
    assert.notEqual(fp1, fp0); // 集合变化敏感
    const g = (args, cwd = sib) => spawnSync("git", args, { cwd, encoding: "utf8" });
    writeFileSync(join(sib, "b.txt"), "b\n");
    g(["add", "b.txt"]);
    g(["commit", "-qm", "c2"]);
    assert.notEqual(fingerprintSubjects(d, [sibPath]), fp1); // 单根变化敏感
    const keep = join(tmpdir(), `keep-${sibName}`);
    renameSync(sib, keep);
    const fpMissing = fingerprintSubjects(d, [sibPath]);
    assert.notEqual(fpMissing, fp1); // missing 参与（变值）
    renameSync(keep, sib);
    const noGit = mkdtempSync(join(tmpdir(), "lzy-v008-nogit-"));
    try {
      assert.equal(fingerprintSubjects(noGit, []), null); // host 非 git 仓=未绑定语义
    } finally {
      rmSync(noGit, { recursive: true, force: true });
    }
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(sib, { recursive: true, force: true });
  }
});

// ── add/removeSubject：闸门、校验镜像、幂等、不在集合拒、CLI 面 ──────────────
test("addSubject/removeSubject：planning 拒、校验镜像、幂等去重、不在集合拒、remove 后证据过期", () => {
  const d = repo();
  const sib = repo("lzy-v008-sib-");
  const sibPath = join(tmpdir(), basename(sib));
  try {
    registerGoal(d, "t", "title");
    adoptPlan(d, writePlan(d), {});
    assert.throws(() => addSubject(d, sibPath), /planning/); // 仅 executing
    startLoop(d, createGit(d));
    const r1 = addSubject(d, sibPath);
    assert.equal(r1.added, true);
    assert.equal(goalJson(d).subjects.length, 1);
    const r2 = addSubject(d, sibPath);
    assert.equal(r2.added, false); // 幂等
    assert.throws(() => addSubject(d, join(tmpdir(), "no-such")), /不存在/); // 校验镜像采纳门
    completeStep(d, createGit(d), "N1", { note: "n" });
    completeStep(d, createGit(d), "F1", { evidence: "ev" });
    assert.equal(verifyEvidence(d, createGit(d)).stale.length, 0); // 取证在 subject 加入后 → fresh
    removeSubject(d, sibPath);
    assert.equal(goalJson(d).subjects.length, 0);
    const v = verifyEvidence(d, createGit(d));
    assert.equal(v.stale.length, 1); // 集合变化→指纹变→F1 过期
    assert.throws(() => removeSubject(d, sibPath), /不在 subject 集合/);
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(sib, { recursive: true, force: true });
  }
});

test("ADJ-16：remove 匹配=解析后路径相等——镜像尾形态不误删；根缺失+非 realpath 形态可删且返回被删条目", () => {
  const d = repo();
  const sib = repo("lzy-v008-sib-");
  const mirrorRoot = mkdtempSync(join(tmpdir(), "lzy-adj16-mirror-"));
  // 非 realpath 形态（macOS：tmpdir() 的 /var… 与存储 realpath 的 /private/var… 分叉；
  // linux/win32 两形态相同，本腿退化为「根缺失 + 归一形态相等」——无平台分支断言）。
  const sibForm = join(tmpdir(), basename(sib));
  const sibReal = realpathSync(sib);
  try {
    registerGoal(d, "t", "title");
    adoptPlan(d, writePlan(d), {});
    startLoop(d, createGit(d));
    addSubject(d, sibForm);
    const stored = goalJson(d).subjects[0];
    assert.equal(stored, sibReal, "存储形态=realpath 归一");
    // ① 镜像尾形态不误删：另一个真实目录，其绝对路径以 subject 真实路径为尾（Time Machine/
    // rsync 备份镜像的现实形态）。旧实现的无门槛 `rp.endsWith(e)` 分支会命中并删掉真条目。
    // win32 分支：绝对路径必带盘符，另一真实目录的绝对路径不可能以它结尾（旧分支在该平台
    // 天然不可达）——改取路径段拼接的合法形态，两平台同判「不在集合」。
    const mirror = IS_WIN
      ? join(mirrorRoot, ...sibReal.split(sep).filter((s) => s && !/^[A-Za-z]:$/.test(s)))
      : join(mirrorRoot, sibReal);
    mkdirSync(mirror, { recursive: true });
    assert.throws(() => removeSubject(d, mirror), /不在 subject 集合/);
    assert.equal(goalJson(d).subjects.length, 1, "镜像路径不得误删真 subject");
    // ② 根缺失 + 非 realpath 形态可删（旧实现在此反不触发：/private 前缀差的上一字符是 e
    // 非 /，分隔符边界后缀匹配永假）——两侧走同一归一口径（最深存在祖先 realpath + 缺失尾部）。
    rmSync(sib, { recursive: true, force: true });
    const r = removeSubject(d, sibForm);
    assert.equal(r.removed, stored, "返回值=被删条目本身（非入参派生路径）");
    assert.equal(goalJson(d).subjects.length, 0);
    assert.throws(() => removeSubject(d, sibForm), /不在 subject 集合/);
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(sib, { recursive: true, force: true });
    rmSync(mirrorRoot, { recursive: true, force: true });
  }
});

test("CLI subject 面：add/remove/list + planning 态拒文案", () => {
  const d = repo();
  const sib = repo("lzy-v008-sib-");
  const sibPath = join(tmpdir(), basename(sib));
  try {
    assert.equal(cli(["loop", "register", "t", "--title", "x"], d).code, 0);
    assert.match(cli(["loop", "subject", "add", sibPath], d).out, /planning/);
    writePlan(d);
    assert.equal(cli(["loop", "plan", "plan.md"], d).code, 0);
    assert.equal(cli(["loop", "start"], d).code, 0);
    assert.match(cli(["loop", "subject", "add", sibPath], d).out, /subject 已加入/);
    assert.match(cli(["loop", "subject", "add", sibPath], d).out, /幂等跳过/);
    assert.match(cli(["loop", "subject", "list"], d).out, /subjects（1 项）/);
    const rm = cli(["loop", "subject", "remove", sibPath], d);
    assert.match(rm.out, /subject 已移除/);
    // ADJ-16：成功文案指向被删条目本身（存储 realpath 形态），不再报入参派生路径
    assert.ok(rm.out.includes(realpathSync(sib)), `文案须指向被删条目：${rm.out}`);
    assert.match(cli(["loop", "subject", "list"], d).out, /subjects：空/);
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(sib, { recursive: true, force: true });
  }
});

// ── 证据复合指纹 + verify 双轨 + 每树行 + 三显示面 ───────────────────────────
test("新证据对象带 fingerprint 不带 treeHash（schema 切换钉）；verify 指纹主轨", () => {
  const d = repo();
  try {
    cycle(d);
    const f1 = goalJson(d).steps.find((s) => s.id === "F1");
    assert.match(f1.evidence.fingerprint, /^[0-9a-f]{64}$/);
    assert.equal("treeHash" in f1.evidence, false); // 停写
    const v = verifyEvidence(d, createGit(d));
    assert.equal(v.fresh.length, 1);
    assert.match(v.fingerprint, /^[0-9a-f]{64}$/);
    spawnSync("git", ["add", "a.txt"], { cwd: d }); // 内容变更后提交 → 指纹变
    writeFileSync(join(d, "a.txt"), "a2\n");
    spawnSync("git", ["commit", "-qam", "c2"], { cwd: d });
    const v2 = verifyEvidence(d, createGit(d));
    assert.equal(v2.stale.length, 1); // 指纹主轨过期
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("legacy 双轨：仅带 treeHash 的旧证据回退单树比对（与 0.0.7 全同）", () => {
  const d = repo();
  try {
    cycle(d);
    const gp = join(d, ".lazyzcode", "loop", "goal.json");
    const g = goalJson(d);
    const cur = createGit(d).headTreeHash();
    g.steps.find((s) => s.id === "F1").evidence = { text: "legacy", treeHash: cur, at: new Date().toISOString() };
    writeFileSync(gp, JSON.stringify(g));
    const v = verifyEvidence(d, createGit(d));
    assert.equal(v.fresh.length, 1); // 单树比对=fresh
    writeFileSync(join(d, "a.txt"), "a3\n");
    spawnSync("git", ["commit", "-qam", "c3"], { cwd: d });
    const v2 = verifyEvidence(d, createGit(d));
    assert.equal(v2.stale.length, 1); // 单树比对=stale
    // legacy 显示面：tree 短码且无「未绑定」回归
    assert.match(cli(["loop", "status"], d).out, /证据@[0-9a-f]{10}/);
    const rep = writeGoalReport(d, createGit(d), readGoal(d));
    assert.match(readFileSync(join(d, rep.path), "utf8"), /- 证据 @ tree [0-9a-f]{10}/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("verify CLI：复合指纹短码行 + 每树 head/脏态行（missing 如实点名）", () => {
  const d = repo();
  const sib = repo("lzy-v008-sib-");
  try {
    cycle(d, { subjects: `../${basename(sib)}` });
    const out = cli(["loop", "verify"], d).out;
    assert.match(out, /复合指纹 [0-9a-f]{10}/);
    const treeLines = out.split("\n").filter((l) => /^\s*树 /.test(l));
    assert.equal(treeLines.length, 2); // host + subject
    assert.match(treeLines[0], /(clean|DIRTY)/);
    assert.match(treeLines[1], /clean/); // 兄弟仓净
    rmSync(sib, { recursive: true, force: true });
    const out2 = cli(["loop", "verify"], d).out;
    assert.match(out2, /树\s+missing/); // missing 如实点名（哈希列空）
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(sib, { recursive: true, force: true });
  }
});

test("三显示面指纹短码：step done 回显/status/exportReport；无「未绑定」回归", () => {
  const d = repo();
  try {
    registerGoal(d, "t", "title");
    adoptPlan(d, writePlan(d, PLAN, ".lazyzcode/plan.md"), {});
    startLoop(d, createGit(d));
    const stepOut = cli(["step", "done", "N1", "--note", "n"], d).out;
    assert.doesNotMatch(stepOut, /未绑定/); // N 项无证据面不受影响
    const fOut = cli(["step", "done", "F1", "--evidence", "ev"], d).out;
    assert.match(fOut, /证据已绑定 指纹 [0-9a-f]{10}/);
    assert.match(cli(["loop", "status"], d).out, /指纹@[0-9a-f]{10}/);
    cli(["loop", "finish"], d); // 净树过闸门
    const report = readFileSync(join(d, ".lazyzcode", "evidence", "t.report.md"), "utf8");
    assert.match(report, /- 证据 @ 指纹 [0-9a-f]{10}/);
    assert.doesNotMatch(report, /未绑定/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── finish 完整性闸门：四形态 + 文案 + metrics ────────────────────────────────
test("finish 第四拒：host 脏分支（文案命中 host 根）+ metrics 计数", () => {
  const d = repo();
  try {
    cycle(d);
    for (const n of ["dirty1.txt", "dirty2.txt", "dirty3.txt", "dirty4.txt"]) {
      writeFileSync(join(d, n), "d\n");
    }
    let dirtyMsg = "";
    assert.throws(
      () => finishLoop(d, createGit(d)),
      (e) => {
        dirtyMsg = e.message;
        return /完整性闸门拒绝（dirty）：host/.test(e.message);
      },
    );
    // multisession-discipline#N1：列命中路径前 3 条 + 超出计数 + 两分句（.gitignore / 多会话归因）
    assert.match(dirtyMsg, /命中：dirty1\.txt、dirty2\.txt、dirty3\.txt 等 4 处/);
    assert.match(dirtyMsg, /\.gitignore/);
    assert.match(dirtyMsg, /另一个会话/);
    const m = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "metrics.json"), "utf8"));
    assert.equal(m.finish_reject_dirty, 1);
    assert.equal(m.finish_attempts, 1);
    for (const n of ["dirty1.txt", "dirty2.txt", "dirty3.txt", "dirty4.txt"]) {
      rmSync(join(d, n));
    }
    finishLoop(d, createGit(d)); // 清障后过
    assert.equal(goalJson(d).status, "done");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("finish 第四拒：subject 脏（HEAD 不变指纹 fresh）与 missing（重取穿越被杀）与 fail-closed", () => {
  const d = repo();
  let sib = repo("lzy-v008-sib-");
  const sibPath = join(tmpdir(), basename(sib));
  try {
    cycle(d, { subjects: `../${basename(sib)}` }); // subject 在取证前入列
    // ① subject 脏：指纹 fresh，闸门拒且点名 subject 根
    writeFileSync(join(sib, "dirty.txt"), "d\n");
    assert.throws(() => finishLoop(d, createGit(d)), new RegExp(`完整性闸门拒绝（dirty）：subject.*${sibPath.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    rmSync(join(sib, "dirty.txt")); // 未跟踪文件 git checkout 不清，直接删
    // ② missing：根改名→missing 时重取 F 证据（指纹含 missing 仍 fresh）→finish 拒 missing（穿越杀招）
    const keep = join(tmpdir(), `keep2-${basename(sib)}`);
    renameSync(sib, keep);
    completeStep(d, createGit(d), "F1", { evidence: "rebound while missing" });
    const v = verifyEvidence(d, createGit(d));
    assert.equal(v.fresh.length, 1); // 指纹含 "missing" 与重算一致=新鲜（穿越形态在场）
    assert.throws(() => finishLoop(d, createGit(d)), /完整性闸门拒绝（missing）：subject/);
    renameSync(keep, sib);
    completeStep(d, createGit(d), "F1", { evidence: "rebound after restore" }); // 复原后重取（stale 先发规避）
    // ③ fail-closed：index 成目录→git status 非零→error 分支带原始报错
    rmSync(join(sib, ".git", "index"));
    mkdirSync(join(sib, ".git", "index"));
    assert.throws(() => finishLoop(d, createGit(d)), /完整性闸门拒绝（error）：subject/);
    rmSync(join(sib, ".git", "index"), { recursive: true, force: true });
    spawnSync("git", ["reset", "-q", "--hard"], { cwd: sib });
    // ④ 修复后重取证→过
    completeStep(d, createGit(d), "F1", { evidence: "final ev" });
    finishLoop(d, createGit(d));
    assert.equal(goalJson(d).status, "done");
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(sib, { recursive: true, force: true });
  }
});

// ── finish-report 原子化 ─────────────────────────────────────────────────────
test("writeReport 失败不置 done（目录占位注入，POSIX+win32 通杀）；成功后报告状态行=done", () => {
  const d = repo();
  try {
    cycle(d);
    const dest = join(d, ".lazyzcode", "evidence", "t.report.md");
    mkdirSync(dest, { recursive: true }); // 目标路径成目录 → tmp rename 失败（EISDIR/ENOTEMPTY）
    assert.throws(() => finishLoop(d, createGit(d), { writeReport: (o) => writeGoalReport(o.cwd, o.git, o.goal) }), /归档失败/);
    assert.equal(goalJson(d).status, "executing"); // 不落盘不置 done
    const err = cli(["loop", "finish"], d).out;
    assert.match(err, /归档失败.*重跑 finish/); // 恢复式文案
    rmSync(dest, { recursive: true, force: true });
    assert.equal(cli(["loop", "finish"], d).code, 0);
    const report = readFileSync(dest, "utf8");
    assert.match(report, /^- 状态 done /m); // 归档报告状态行=done（内存先置再渲染）
    const tmps = readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8"); // 无 .tmp 残留在 evidence/（rename 成功）
    assert.equal(existsSync(join(d, ".lazyzcode", "evidence", ".t.report.md")), false);
    assert.ok(tmps.length > 0);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ADJ-07（0.2.1 五轮双审·部分成立）：写序「先证后态」为有意设计，但失败窗内报告状态行
// （done）与 goal.json（executing）互相矛盾——报文点名中间态与闭合动作，报告状态行下另起
// 一行注记写盘序；重跑 finish 即闭合（本用例逐条活体钉住）。
test("ADJ-07：closeAttempt 失败窗三件一致——报文带闭合动作、报告注记在场、重跑 finish 闭合", () => {
  const d = repo();
  try {
    cycle(d); // N1/F1 全 done（报告由 CLI 面 writer 落盘，同 writeReport 注入用例轨）
    const ap = join(d, ".lazyzcode", "loop", "attempt.json");
    assert.ok(existsSync(ap), "世系账本注册即在场");
    rmSync(ap);
    mkdirSync(ap); // 目录占位注入（POSIX+win32 通杀，同 writeReport 注入法）→ 世系读 EISDIR
    const r = cli(["loop", "finish"], d);
    assert.equal(r.code, 1);
    assert.match(r.out, /世系收口失败（finish 未置 done，状态保持 executing）/);
    assert.match(r.out, /报告\/attestation 已在盘/);
    assert.match(r.out, /重跑 lzy loop finish 完成状态提交即可闭合/);
    assert.equal(goalJson(d).status, "executing", "状态未提交（先证后态写序不变）");
    // 失败窗盘面：报告（状态行=done）与终验 attestation 已在，goal.json 仍 executing
    const report = readFileSync(join(d, ".lazyzcode", "evidence", "t.report.md"), "utf8");
    assert.match(report, /^- 状态 done /m);
    assert.match(report, /写盘序：LOOP_COMPLETE 证明先于状态提交/);
    assert.match(report, /若本行 done 而 goal\.json 仍 executing，重跑 lzy loop finish 即可闭合/);
    assert.equal(readdirSync(join(d, ".lazyzcode", "attestations")).filter((f) => f.endsWith(".json")).length, 1);
    // 闭合：按报文指路清障（删除重建）后重跑 finish——幂等续完，状态提交
    rmSync(ap, { recursive: true, force: true });
    assert.equal(cli(["loop", "finish"], d).code, 0);
    assert.equal(goalJson(d).status, "done");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── snapshot+planHash：三方一致、不可变、复采纳 warn 双臂、篡改 warn ──────────
test("snapshot 三方一致（planHash==sha256(快照)==review.planHash）且改原计划文不变", () => {
  const d = repo();
  try {
    registerGoal(d, "t", "title");
    const p = writePlan(d);
    adoptPlan(d, p, { review: "plan-reviewer: VERDICT: PASS — ok" });
    const g = goalJson(d);
    const snap = readFileSync(join(d, ".lazyzcode", "loop", "snapshots", "t.md"));
    const h = createHash("sha256").update(snap).digest("hex");
    assert.equal(g.planHash, h);
    assert.equal(g.review.planHash, h);
    writeFileSync(p, PLAN.replace("x", "CHANGED"));
    const g2 = goalJson(d);
    assert.equal(g2.planHash, h); // 不可变：改原文件三者不动
    assert.equal(g2.review.planHash, h);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("复采纳 warn 双臂：无 --review 与同串 --review 均警；新评审静默且重快照", () => {
  const d = repo();
  try {
    registerGoal(d, "t", "title");
    const p = writePlan(d, PLAN, "plan-a.md");
    const a1 = adoptPlan(d, p, { review: "plan-reviewer: VERDICT: PASS — v1" });
    assert.equal(a1.warnings.length, 0);
    // 同串臂先行（无评审采纳会把 review 置空，插在中间会使同串臂测不到）：改文+逐字同串 → warn
    const p2 = writePlan(d, PLAN.replace("x", "y"), "plan-b.md");
    assert.equal(adoptPlan(d, p2, { review: "plan-reviewer: VERDICT: PASS — v1" }).warnings.length, 1);
    // 无 --review 臂：改文不带评审 → warn
    const p3 = writePlan(d, PLAN.replace("x", "z"), "plan-c.md");
    assert.equal(adoptPlan(d, p3, {}).warnings.length, 1);
    // 新评审 → 静默且重快照
    const p4 = writePlan(d, PLAN.replace("x", "w"), "plan-d.md");
    const a4 = adoptPlan(d, p4, { review: "plan-reviewer: VERDICT: PASS — v2 fresh" });
    assert.equal(a4.warnings.length, 0); // 新评审 → 静默
    const snap = readFileSync(join(d, ".lazyzcode", "loop", "snapshots", "t.md"), "utf8");
    assert.match(snap, /\[N1\] w/); // 重快照=新内容
    assert.equal(a4.goal.planHash, createHash("sha256").update(snap).digest("hex"));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("status 快照行：复核一致 → 篡改 warn；planHash 缺席静默（0.0.8 前 goal 容忍）", () => {
  const d = repo();
  try {
    registerGoal(d, "t", "title");
    adoptPlan(d, writePlan(d), {});
    assert.match(cli(["loop", "status"], d).out, /快照 [0-9a-f]{10} · 复核一致/);
    appendFileSync(join(d, ".lazyzcode", "loop", "snapshots", "t.md"), "tampered\n");
    assert.match(cli(["loop", "status"], d).out, /⚠ sha256 不符（疑篡改）/);
    const gp = join(d, ".lazyzcode", "loop", "goal.json");
    const g = goalJson(d);
    delete g.planHash;
    writeFileSync(gp, JSON.stringify(g));
    assert.doesNotMatch(cli(["loop", "status"], d).out, /快照 [0-9a-f]{10}/); // 缺席=静默不查
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("reset 后快照留存 + salvage 存根快照指针（在场/缺席两分支）+ doctor 疤痕巡逻豁免", () => {
  const d = repo();
  try {
    registerGoal(d, "t", "title");
    adoptPlan(d, writePlan(d), {});
    resetLoop(d, createGit(d));
    assert.ok(existsSync(join(d, ".lazyzcode", "loop", "snapshots", "t.md"))); // reset 不清
    const stub = readFileSync(join(d, ".lazyzcode", "loop", "salvage", "t.md"), "utf8");
    assert.match(stub, /计划快照：\.lazyzcode\/loop\/snapshots\/t\.md/); // 指针行
    // 缺席分支：手剥 planHash 后 reset 无指针行
    registerGoal(d, "t2", "title");
    const p2 = writePlan(d, PLAN, "p2.md");
    adoptPlan(d, p2, {});
    const gp = join(d, ".lazyzcode", "loop", "goal.json");
    const g = goalJson(d);
    delete g.planHash;
    writeFileSync(gp, JSON.stringify(g));
    resetLoop(d, createGit(d));
    const stub2 = readFileSync(join(d, ".lazyzcode", "loop", "salvage", "t2.md"), "utf8");
    assert.doesNotMatch(stub2, /计划快照/);
    // doctor 疤痕巡逻豁免 snapshots：reset 后（goal 已清、snapshots 目录在场）doctor 无疤痕警
    const dr = spawnSync(process.execPath, [CLI, "doctor"], {
      cwd: d,
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, HOME: d, USERPROFILE: d, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE },
    });
    const out = `${dr.stdout ?? ""}${dr.stderr ?? ""}`;
    assert.doesNotMatch(out, /空壳疤痕/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── tier：register 面、机器门、子命令、缺键容忍 ──────────────────────────────
test("tier register 面：--tier heavy 持久化、bogus 拒、大小写归一", () => {
  const d = repo();
  try {
    registerGoal(d, "a", "x", { tier: "heavy" });
    assert.equal(goalJson(d).tier, "heavy");
    assert.throws(() => registerGoal(d, "b", "x", { tier: "bogus" }), /tier 不合法/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
  const d2 = repo();
  try {
    registerGoal(d2, "a", "x", { tier: "HEAVY" }); // 大小写归一
    assert.equal(goalJson(d2).tier, "heavy");
    assert.equal(cli(["loop", "register", "z", "--title", "x", "--tier", "bogus"], d2).code, 1);
  } finally {
    rmSync(d2, { recursive: true, force: true });
  }
});

test("HEAVY 机器门：无 review 拒 / --force 拒 / UNVERIFIED 串拒 / PASS 过；LIGHT 行为不变", () => {
  const d = repo();
  try {
    registerGoal(d, "h", "x", { tier: "heavy" });
    const p = writePlan(d);
    assert.throws(() => adoptPlan(d, p, {}), /HEAVY 目标机器拒：无 PASS 评审不得采纳（未带 --review）/) ;
    assert.throws(() => adoptPlan(d, p, { force: true }), /机器拒/); // --force 不越过
    assert.throws(() => adoptPlan(d, p, { review: "looks fine, no marker" }), /判决 UNVERIFIED/);
    adoptPlan(d, p, { review: "plan-reviewer: VERDICT: PASS — ok" }); // PASS 过
    const d2 = repo();
    try {
      registerGoal(d2, "l", "x"); // light 默认
      adoptPlan(d2, writePlan(d2), {}); // 无 review 照常采纳
    } finally {
      rmSync(d2, { recursive: true, force: true });
    }
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("tier 子命令：单向（反向 LoopError）、同值 no-op、大小写归一、升级 warn、CLI 面", () => {
  const d = repo();
  try {
    registerGoal(d, "t", "x");
    adoptPlan(d, writePlan(d), {});
    startLoop(d, createGit(d));
    const r = setTier(d, "HEAVY"); // 大小写归一
    assert.equal(r.changed, true);
    assert.equal(goalJson(d).tier, "heavy");
    assert.ok(r.warn && /从未过评审门/.test(r.warn)); // review 非 PASS → warn
    const r2 = setTier(d, "heavy");
    assert.equal(r2.changed, false); // 同值 no-op
    assert.throws(() => setTier(d, "light"), /只升不降/); // 反向拒
    assert.throws(() => setTier(d, "bogus"), /tier 不合法/);
    const out = cli(["loop", "tier", "light"], d).out;
    assert.match(out, /只升不降/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("缺键容忍：无 tier/subjects 键按 light/空集显示与计算（0.0.7 goal 兼容）", () => {
  const d = repo();
  try {
    registerGoal(d, "t", "x");
    adoptPlan(d, writePlan(d, PLAN, ".lazyzcode/plan.md"), {});
    const gp = join(d, ".lazyzcode", "loop", "goal.json");
    const g = goalJson(d);
    delete g.tier;
    delete g.subjects;
    writeFileSync(gp, JSON.stringify(g));
    const out = cli(["loop", "status"], d).out;
    assert.match(out, /tier light · risk low · subjects 0 项/);
    startLoop(d, createGit(d));
    completeStep(d, createGit(d), "N1", { note: "n" });
    completeStep(d, createGit(d), "F1", { evidence: "ev" }); // 缺键归一：指纹按 [] 计算不炸
    const v = verifyEvidence(d, createGit(d));
    assert.equal(v.fresh.length, 1);
    finishLoop(d, createGit(d)); // 闸门入口 `?? []` 归一不炸
    assert.equal(goalJson(d).status, "done");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── CLI 读面 ─────────────────────────────────────────────────────────────────
test("未知子命令清单含 subject/tier；status 正向 tier/subjects/快照行", () => {
  const d = repo();
  try {
    const out = cli(["loop", "bogus"], d).out;
    assert.match(out, /subject/);
    assert.match(out, /tier/);
    registerGoal(d, "t", "x");
    adoptPlan(d, writePlan(d), {});
    const st = cli(["loop", "status"], d).out;
    assert.match(st, /快照 [0-9a-f]{10} · 复核一致/);
    assert.match(st, /tier light · risk low · subjects 0 项/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("worktree-as-subject：兄弟 worktree 接受 + 脏态按根隔离 + 提交即指纹耦变", () => {
  // multisession-discipline#N4：结清 v008 计划已知未知 #3（worktree 派工时 subject 指向
  // worktree 根即可——指纹按根隔离、共享对象库不串扰脏态判定）。
  const host = repo();
  const wtBase = mkdtempSync(join(tmpdir(), "lzy-v008-wt-"));
  const wt = join(wtBase, "wt");
  try {
    const g = (args, cwd = host) => spawnSync("git", args, { cwd, encoding: "utf8" });
    cycle(host); // executing 态
    const r = g(["worktree", "add", "-b", "wt-branch", wt]);
    assert.equal(r.status, 0, `git worktree add 失败：${r.stderr}`);

    // ① 兄弟 worktree 作 subject：接受（在宿主树外的独立树根）
    assert.equal(addSubject(host, wt).added, true);
    assert.equal(goalJson(host).subjects.length, 1);

    // ② 脏态按根隔离：worktree 内未提交改动只脏该根，宿主保持 clean
    writeFileSync(join(wt, "wip.txt"), "w\n");
    assert.equal(createGit(wt).integrity().state, "dirty");
    assert.deepEqual(createGit(wt).integrity().paths, ["wip.txt"]);
    assert.equal(createGit(host).integrity().state, "clean");

    // ③ 提交即耦变：worktree 头树变 → 复合指纹变，而宿主头树不动（声明=纳入判据）
    const before = fingerprintSubjects(host, goalJson(host).subjects);
    const hostHead = createGit(host).headTreeHash();
    g(["add", "-A"], wt);
    g(["commit", "-qm", "wt commit"], wt);
    const after = fingerprintSubjects(host, goalJson(host).subjects);
    assert.notEqual(after, before);
    assert.equal(createGit(host).headTreeHash(), hostHead);
    assert.equal(createGit(wt).integrity().state, "clean");
  } finally {
    rmSync(host, { recursive: true, force: true });
    rmSync(wtBase, { recursive: true, force: true });
  }
});
