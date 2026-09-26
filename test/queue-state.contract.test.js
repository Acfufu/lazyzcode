// 队列状态机契约测试（0.3.0 M3，主方案 §5.1/拍板 3）：proposed→authorized→ready→
// running→completed 全转移机器执法；未授权提案永不 ready/永不自动执行；deps 环/自指/
// 未知 id 拒；endpoint B/C 拒；计划缺位拒；终态不可逆；取消保留；队列/预算家族 tmp
// 登记（ANY_TMP_SCAN_DIRS 观测面=清扫面同一判据）。
// HOME 隔离+人权门消融（非本文件被测面）；授权批准走 recordAuthorization 显式 API
//（contract.js:206 docstring 许可面）——队列授权门本身零消融、全程真实判定。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addQueueItem,
  cancelQueueItem,
  describeReadiness,
  formatQueueList,
  loadQueue,
  refreshQueue,
  runQueueDispatch,
  saveQueue,
  QueueError,
  showQueueItem,
} from "../core/queue.js";
import { createHash } from "node:crypto";
import { recordAuthorization } from "../core/contract.js";
import { countLoopResidueTmp } from "../core/loop.js";

process.env.LZY_ABLATE_HUMAN_GATE = "1";
const HOME = mkdtempSync(join(tmpdir(), "lzy-qstate-home-"));
process.env.HOME = HOME; // win32 homedir 读 USERPROFILE——双补（债③家法）
process.env.USERPROFILE = HOME;

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");

function qrepo(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "a\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "init"]);
  // 项目就绪最小清单（ready 六查之一：lzy.project.json 在场且可校验）
  writeFileSync(
    join(d, "lzy.project.json"),
    JSON.stringify({ schemaVersion: 1, capabilities: { check: [{ id: "smoke", argv: ["node", "-e", "process.exit(0)"], timeoutMs: 30000 }] } }),
  );
  writeFileSync(join(d, "c.md"), "task: queue item\nendpoint: A\nscope: .\nrecipe: none\n\n- [A1] 完成\n");
  writeFileSync(join(d, "p.md"), "- [N1] x\n- [F1] marker\naccepts: A1\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "fixture"]); // finish 完整性闸门要求树净——夹具文件先落提交
  return d;
}

const itemState = (d, id) => loadQueue(d).items.find((x) => x.id === id).state;

test("①add→proposed；未授权提案永不 ready（授权缺席=首因），批准落账后 refresh→authorized→ready", () => {
  const d = qrepo("lzy-qstate-1-");
  try {
    const it = addQueueItem(d, { title: "第一项", contractFile: join(d, "c.md"), planFile: join(d, "p.md"), goalSlug: "qi-one" });
    assert.equal(it.state, "proposed");
    // 未授权：refresh 不转 authorized；readiness 首因=授权无效（未授权提案不自动执行）
    refreshQueue(d);
    assert.equal(itemState(d, "q1"), "proposed");
    const r1 = describeReadiness(d, loadQueue(d).items[0]);
    assert.equal(r1.ready, false);
    assert.match(r1.reasons[0], /授权无效/);
    // 批准（真实批准记录，(slug, contractHash) 绑定）→ refresh 两连转
    recordAuthorization(d, { kind: "approval", slug: "qi-one", contractHash: it.contractHash, sessionId: "test-up", at: new Date().toISOString() });
    refreshQueue(d);
    assert.equal(itemState(d, "q1"), "ready"); // 授权✓+计划✓+deps✓+清单✓+预算∞+租约闲
    const r2 = describeReadiness(d, loadQueue(d).items[0]);
    assert.equal(r2.ready, true);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("②撤回→blocked(authorization)；重新批准→恢复 authorized→ready（恢复路径诚实）", () => {
  const d = qrepo("lzy-qstate-2-");
  try {
    const it = addQueueItem(d, { title: "第二项", contractFile: join(d, "c.md"), planFile: join(d, "p.md"), goalSlug: "qi-two" });
    recordAuthorization(d, { kind: "approval", slug: "qi-two", contractHash: it.contractHash, sessionId: "test-up", at: new Date().toISOString() });
    refreshQueue(d);
    assert.equal(itemState(d, "q1"), "ready");
    recordAuthorization(d, { kind: "withdrawal", slug: "qi-two", contractHash: it.contractHash, sessionId: "test-down", at: new Date().toISOString() });
    refreshQueue(d);
    assert.equal(itemState(d, "q1"), "blocked");
    assert.match(loadQueue(d).items[0].blockedReason, /^authorization/);
    // 重新批准=fresh approval record → authorized→ready
    recordAuthorization(d, { kind: "approval", slug: "qi-two", contractHash: it.contractHash, sessionId: "test-up2", at: new Date().toISOString() });
    refreshQueue(d);
    assert.equal(itemState(d, "q1"), "ready");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("③deps：未知 id/自指一律拒（add 即拒）；深链合法（经 add 不可能成环——新 id 尚无入边，环检查为防御面）", () => {
  const d = qrepo("lzy-qstate-3-");
  try {
    addQueueItem(d, { title: "a", contractFile: join(d, "c.md"), planFile: join(d, "p.md"), goalSlug: "qi-a" });
    assert.throws(() => addQueueItem(d, { title: "b", contractFile: join(d, "c.md"), planFile: join(d, "p.md"), goalSlug: "qi-b", deps: ["q99"] }), /未知条目/);
    // 自指：新条目将是 q2，deps q2=自指
    assert.throws(() => addQueueItem(d, { title: "b", contractFile: join(d, "c.md"), planFile: join(d, "p.md"), goalSlug: "qi-b", deps: ["q2"] }), /未知条目|自指/);
    // 深链合法：q2 deps q1，q3 deps q2
    addQueueItem(d, { title: "b", contractFile: join(d, "c.md"), planFile: join(d, "p.md"), goalSlug: "qi-b", deps: ["q1"] });
    addQueueItem(d, { title: "c", contractFile: join(d, "c.md"), planFile: join(d, "p.md"), goalSlug: "qi-c", deps: ["q2"] });
    assert.deepEqual(loadQueue(d).items.map((x) => x.id), ["q1", "q2", "q3"]);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("④endpoint 矩阵四态（0.3.1 棒1 改写；旧拒语「endpoint 仅支持 A」已退役）", () => {
  // 旧态对照记录（评审 R2-MF-5 申报）：改前此断言为 /endpoint 仅支持 A/ 且 B/C 全拒
  // （core/queue.js:351-353 拒语「B/C 外部交付归 M4」）。0.3.1 棒1 起矩阵化：
  // A⇒禁交付契约 / B⇒须 B / C⇒须 B∧C；另加 endpoint 与主契约交叉校验。
  const d = qrepo("lzy-qstate-4-");
  try {
    const w = (name, body) => {
      writeFileSync(join(d, name), body);
      return join(d, name);
    };
    const bDeliv = w("cb.md", "task: B 交付\nendpoint: B\nscope: .\nrepo: Acfufu/lazyzcode\nbase: main\nbranch: v031\npr-title: t\n\n- [A1] x\n");
    const cDeliv = w("cc.md", "task: C 交付\nendpoint: C\nscope: .\nrepo: Acfufu/lazyzcode\nexpect-marker: v0.3.1\n\n- [A1] x\n");
    const cB = w("c-main-b.md", "task: main B\nendpoint: B\nscope: .\nrecipe: none\n\n- [A1] x\n");
    const cC = w("c-main-c.md", "task: main C\nendpoint: C\nscope: .\nrecipe: none\n\n- [A1] x\n");
    const plan = join(d, "p.md");
    // ①B 有契约过（主契约 endpoint=B 交叉一致）
    const itB = addQueueItem(d, { title: "x", contractFile: cB, planFile: plan, goalSlug: "qi-b", endpoint: "B", delivery: { B: bDeliv } });
    assert.equal(itB.endpoint, "B");
    assert.equal(itB.delivery.B.hash.length, 64);
    // ②B 无契约拒
    assert.throws(() => addQueueItem(d, { title: "x", contractFile: cB, planFile: plan, goalSlug: "qi-b2", endpoint: "B" }), /endpoint B 须声明 --delivery-b/);
    // ③C 缺 B 拒；C 有 B∧C 过
    assert.throws(() => addQueueItem(d, { title: "x", contractFile: cC, planFile: plan, goalSlug: "qi-c0", endpoint: "C", delivery: { C: cDeliv } }), /endpoint C 须同时声明/);
    const itC = addQueueItem(d, { title: "x", contractFile: cC, planFile: plan, goalSlug: "qi-c1", endpoint: "C", delivery: { B: bDeliv, C: cDeliv } });
    assert.ok(itC.delivery.B && itC.delivery.C);
    // ④A 带契约拒；交叉校验不符拒
    assert.throws(() => addQueueItem(d, { title: "x", contractFile: join(d, "c.md"), planFile: plan, goalSlug: "qi-a1", endpoint: "A", delivery: { B: bDeliv } }), /endpoint A 不得声明交付契约/);
    assert.throws(() => addQueueItem(d, { title: "x", contractFile: cB, planFile: plan, goalSlug: "qi-x1", endpoint: "A" }), /endpoint 与主契约不一致/);
    // ⑤计划缺位拒（不得 ready 的机器执法=add 即拒）
    assert.throws(() => addQueueItem(d, { title: "x", contractFile: join(d, "c.md"), planFile: null, goalSlug: "qi-nop" }), /计划缺位/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑤终态不可逆：completed/failed/cancelled 拒再取消；cancel 保留工件（goal 树零触碰）", () => {
  const d = qrepo("lzy-qstate-5-");
  try {
    addQueueItem(d, { title: "x", contractFile: join(d, "c.md"), planFile: join(d, "p.md"), goalSlug: "qi-x" });
    cancelQueueItem(d, "q1", "测试取消");
    assert.equal(itemState(d, "q1"), "cancelled");
    assert.throws(() => cancelQueueItem(d, "q1", "再取消"), /终态/);
    assert.throws(() => cancelQueueItem(d, "q1", "三取消"), /终态/);
    // 工件保留：goal 树/清单/计划文件零触碰
    assert.ok(existsSync(join(d, "lzy.project.json")));
    assert.ok(existsSync(join(d, "p.md")));
    assert.ok(!existsSync(join(d, ".lazyzcode", "loop", "goal.json"))); // 从未注册
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑥CLI 接线：queue list/show 面活体（批准→ready 全链经 CLI 可见）+show 事务账零条", () => {
  const d = qrepo("lzy-qstate-6-");
  try {
    const env = { ...process.env };
    const run = (args) => spawnSync(process.execPath, [CLI, ...args], { cwd: d, encoding: "utf8", env });
    addQueueItem(d, { title: "CLI 项", contractFile: join(d, "c.md"), planFile: join(d, "p.md"), goalSlug: "qi-cli" });
    const it = loadQueue(d).items[0];
    recordAuthorization(d, { kind: "approval", slug: "qi-cli", contractHash: it.contractHash, sessionId: "test-up", at: new Date().toISOString() });
    const lst = run(["queue", "list"]);
    assert.equal(lst.status, 0);
    assert.match(lst.stdout, /q1\s+ready/);
    const sh = run(["queue", "show", "q1"]);
    assert.equal(sh.status, 0);
    assert.match(sh.stdout, /"state": "ready"/);
    assert.match(sh.stdout, /派发事务 0 条/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑦家族 tmp 登记：queue/ 与 budget/ 顶层孤儿 tmp 进 doctor 计数（ANY_TMP_SCAN_DIRS 观测面）", () => {
  const d = qrepo("lzy-qstate-7-");
  try {
    addQueueItem(d, { title: "x", contractFile: join(d, "c.md"), planFile: join(d, "p.md"), goalSlug: "qi-tmp" });
    const before = countLoopResidueTmp(d);
    mkdirSync(join(d, ".lazyzcode", "queue"), { recursive: true });
    mkdirSync(join(d, ".lazyzcode", "budget"), { recursive: true });
    writeFileSync(join(d, ".lazyzcode", "queue", ".queue.json.999.123.tmp"), "x");
    writeFileSync(join(d, ".lazyzcode", "budget", ".ledger.json.999.123.tmp"), "x");
    const after = countLoopResidueTmp(d);
    assert.equal(after - before, 2);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑧list 文本面：未授权项标注未就绪首因；预算视图行渲染", () => {
  const d = qrepo("lzy-qstate-8-");
  try {
    addQueueItem(d, { title: "x", contractFile: join(d, "c.md"), planFile: join(d, "p.md"), goalSlug: "qi-l" });
    const out = formatQueueList(d);
    assert.match(out, /q1\s+proposed/);
    assert.match(out, /授权无效/);
    assert.match(out, /队列 1 项/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── 0.3.1 棒1（ADR-0030 §一.C/G）：HEAVY 入队门 / risk 车道门 / 契约必填键矩阵 ──
test("⑨HEAVY 门：无 PASS 拒、含 REVISE 拒、缺 planHash 拒；齐备通过且字段落盘", () => {
  const d = qrepo("lzy-qstate-9-");
  try {
    const plan = join(d, "p.md");
    const hash = createHash("sha256").update(readFileSync(plan)).digest("hex");
    const base = { title: "h", contractFile: join(d, "c.md"), planFile: plan, goalSlug: "qh", tier: "heavy" };
    assert.throws(() => addQueueItem(d, { ...base, planHash: hash }), /HEAVY 条目须带计划评审 PASS/);
    assert.throws(
      () => addQueueItem(d, { ...base, planReview: "plan-reviewer: VERDICT: REVISE — x", planHash: hash }),
      /判决非 PASS 形态/,
    );
    assert.throws(() => addQueueItem(d, { ...base, planReview: "plan-reviewer: PASS — ok" }), /须带计划哈希/);
    const it = addQueueItem(d, { ...base, planReview: "plan-reviewer: PASS — 零警告", planHash: hash });
    assert.equal(it.tier, "heavy");
    assert.equal(it.planHash, hash);
    assert.match(it.planReview, /PASS/);
    // 旧 item（light 缺省）字段落盘=light/low/无评审
    const it2 = addQueueItem(d, { title: "l", contractFile: join(d, "c.md"), planFile: plan, goalSlug: "ql" });
    assert.equal(it2.tier, "light");
    assert.equal(it2.risk, "low");
    assert.equal(it2.planReview, null);
    assert.equal(it2.delivery, null);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑩risk 车道门：high/restricted 入队即拒；low/med 通过", () => {
  const d = qrepo("lzy-qstate-10-");
  try {
    const plan = join(d, "p.md");
    for (const r of ["high", "restricted"]) {
      assert.throws(
        () => addQueueItem(d, { title: "x", contractFile: join(d, "c.md"), planFile: plan, goalSlug: `qr-${r}`, risk: r }),
        /risk 仅支持 low\|med.*HIGH\+ 不入无人值守车道/,
      );
    }
    const it = addQueueItem(d, { title: "x", contractFile: join(d, "c.md"), planFile: plan, goalSlug: "qr-med", risk: "med" });
    assert.equal(it.risk, "med");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑪交付契约必填键矩阵：B 缺 pr-title 拒、C 缺 expect-marker 拒（对齐动作面硬要求）", () => {
  const d = qrepo("lzy-qstate-11-");
  try {
    const plan = join(d, "p.md");
    const w = (n, b) => {
      writeFileSync(join(d, n), b);
      return join(d, n);
    };
    const cB = w("c-main-b.md", "task: main B\nendpoint: B\nscope: .\nrecipe: none\n\n- [A1] x\n");
    const badB = w("cb-bad.md", "task: B\nendpoint: B\nscope: .\nrepo: Acfufu/lazyzcode\nbase: main\nbranch: v\n\n- [A1] x\n"); // 缺 pr-title
    assert.throws(
      () => addQueueItem(d, { title: "x", contractFile: cB, planFile: plan, goalSlug: "qb", endpoint: "B", delivery: { B: badB } }),
      /B 交付契约缺队列承载必填键：pr-title/,
    );
    const cC = w("c-main-c.md", "task: main C\nendpoint: C\nscope: .\nrecipe: none\n\n- [A1] x\n");
    const goodB = w("cb-ok.md", "task: B\nendpoint: B\nscope: .\nrepo: Acfufu/lazyzcode\nbase: main\nbranch: v\npr-title: t\n\n- [A1] x\n");
    const badC = w("cc-bad.md", "task: C\nendpoint: C\nscope: .\nrepo: Acfufu/lazyzcode\n\n- [A1] x\n"); // 缺 expect-marker
    assert.throws(
      () => addQueueItem(d, { title: "x", contractFile: cC, planFile: plan, goalSlug: "qc", endpoint: "C", delivery: { B: goodB, C: badC } }),
      /C 交付契约缺队列承载必填键：expect-marker/,
    );
    // endpoint 面错配（B 契约文件传给 C 槽）由 validateDeliveryContract 拦
    assert.throws(
      () => addQueueItem(d, { title: "x", contractFile: cC, planFile: plan, goalSlug: "qc2", endpoint: "C", delivery: { B: goodB, C: goodB } }),
      /C 交付契约无效.*endpoint 不匹配/,
    );
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑫形状矩阵写侧同判（手改防御两层）：文件级=校验和恒拒；对象级=saveQueue 形状门拒", () => {
  const d = qrepo("lzy-qstate-12-");
  try {
    const plan = join(d, "p.md");
    const it = addQueueItem(d, { title: "x", contractFile: join(d, "c.md"), planFile: plan, goalSlug: "qz" });
    const p = join(d, ".lazyzcode", "queue", "queue.json");
    // 第一层：直接手改文件 → 校验和不符恒拒（合法手改不存在的机器证据）
    const raw = readFileSync(p, "utf8");
    writeFileSync(p, raw.replace('"endpoint": "A"', '"endpoint": "B"'));
    assert.throws(() => loadQueue(d), /校验和不符/);
    writeFileSync(p, raw); // 复原
    // 第二层：对象级变异经写侧形状门拒（assertItem 矩阵；防绕过 API 的写入）
    const h64 = "a".repeat(64);
    const expectBad = (mutate, re) => {
      const q = loadQueue(d);
      const target = q.items.find((x) => x.id === it.id);
      mutate(target);
      assert.throws(() => saveQueue(d, q), re);
    };
    expectBad((i2) => { i2.endpoint = "A"; i2.delivery = { B: { path: "cb.md", hash: h64 } }; }, /endpoint A 不得声明 delivery/);
    expectBad((i2) => { i2.endpoint = "B"; i2.delivery = null; }, /缺 delivery\.B/);
    expectBad((i2) => { i2.endpoint = "C"; i2.delivery = { B: { path: "cb.md", hash: h64 } }; }, /endpoint C 须 delivery\.B∧C/);
    expectBad((i2) => { i2.tier = "huge"; }, /tier 不识别/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
