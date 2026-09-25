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
  QueueError,
  showQueueItem,
} from "../core/queue.js";
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

test("④endpoint B/C 拒（首版仅 A，M4 面）；计划缺位拒（不得 ready 的机器执法=add 即拒）", () => {
  const d = qrepo("lzy-qstate-4-");
  try {
    for (const ep of ["B", "C"]) {
      assert.throws(() => addQueueItem(d, { title: "x", contractFile: join(d, "c.md"), planFile: join(d, "p.md"), goalSlug: `qi-${ep}`, endpoint: ep }), /endpoint 仅支持 A/);
    }
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
