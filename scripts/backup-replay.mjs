// P2 N7④：备份恢复重放回归（r3-F2/r4-F2 处置面；P1 试点 scripts/p1-sqlite-pilot/backup-replay.mjs
// 重写指向 core/statedb.js）——建夹具库 → VACUUM INTO 备份 → 删原库（+wal/shm）→ 从备份只读恢复
// → 完整性 + 行数/聚合逐字一致。
// 破坏性守卫（r4-F2）：目标目录已存在 state.sqlite 时拒绝启动（本脚本会删原库）；用法行明示覆盖面。
// 自动检查回路：test/statedb.contract.test.js 备份腿调用本脚本（exit 0 + 回执 ok）。
// 用法：node scripts/backup-replay.mjs [workdir]（缺省=临时目录；workdir 内已存在 state.sqlite=exit 2 拒）
// 退出码：0=全链通过；1=任一步失败（stdout 回执 JSON，stderr 给失败面）；2=破坏性守卫拒。
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openStore, ensureSchema, putQueueItem, setBudget, occupyDispatch, settleDispatch,
  readSnapshot, readBudgetAggregate, backupTo, integrityCheck, stateDbPath,
} from "../core/statedb.js";

const dir = process.argv[2] ?? mkdtempSync(join(tmpdir(), "lzy-backup-replay-"));
const dbPath = stateDbPath(dir);
if (existsSync(dbPath)) {
  // 破坏性守卫：本脚本删除 workdir 内的 state.sqlite（含 -wal/-shm）再从备份恢复——
  // 已有库的目标目录=用户数据，绝不覆盖；显式空目录才可作 workdir。
  console.error(`拒绝：目标目录已存在 state.sqlite（本脚本会删原库做恢复重放，不覆盖既有数据）——${dbPath}`);
  console.error(`用法：node scripts/backup-replay.mjs [workdir]（workdir 须不含 state.sqlite；缺省=临时目录）`);
  process.exit(2);
}
mkdirSync(join(dir, ".lazyzcode"), { recursive: true });
const auth = { slug: "fixture-goal", contractHash: "ab".repeat(32) };
const out = { dir, dbPath, steps: [] };

function fail(step, err) {
  out.steps.push({ step, ok: false, error: `${err?.name ?? "Error"}: ${err?.message ?? err}` });
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}

try {
  const db = openStore(dbPath);
  ensureSchema(db);
  putQueueItem(db, {
    id: "q-bk-1", goalSlug: "fixture-goal", contractHash: auth.contractHash, endpoint: "A",
    state: "authorized", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    title: "备份重放夹具", contractPath: "contracts/fixture.md", planPath: ".lazyzcode/plans/fixture.md",
    deps: [], seq: 1,
  });
  setBudget(db, { pointsLimit: 50, wallLimitMs: 3600000, notes: [{ at: "2026-01-01T00:00:00.000Z", note: "备份重放夹具" }] });
  occupyDispatch(db, { txId: "t-bk-1", itemId: "q-bk-1", goalSlug: "fixture-goal", limits: { wallMs: 600000, points: 5 } });
  const settled = settleDispatch(db, {
    txId: "t-bk-1", segments: [{ sessionId: "s-bk-0", durationMs: 1500 }],
    queryPoints: () => ({ absent: false, unpriced: [], points: 7.5 }),
    itemFinalState: "completed", provenance: "tx:t-bk-1:s-bk-0",
  });
  const before = { snap: readSnapshot(db), agg: readBudgetAggregate(db) };
  out.steps.push({ step: "建库+结算", ok: true, settled, itemState: before.snap.items[0].state, txPhase: before.snap.txs[0].phase });

  const backupPath = join(dir, "backup.sqlite");
  backupTo(db, backupPath);
  db.close();
  out.steps.push({ step: "VACUUM INTO 备份", ok: existsSync(backupPath), backupPath });

  rmSync(dbPath); rmSync(`${dbPath}-wal`, { force: true }); rmSync(`${dbPath}-shm`, { force: true });
  out.steps.push({ step: "删原库（+wal/shm）", ok: !existsSync(dbPath), originalGone: !existsSync(dbPath) });

  const rb = openStore(backupPath, { readOnly: true });
  const integrity = integrityCheck(rb);
  const after = { snap: readSnapshot(rb), agg: readBudgetAggregate(rb) };
  rb.close();

  const sameItems = JSON.stringify(after.snap.items) === JSON.stringify(before.snap.items);
  const sameEvents = JSON.stringify(after.snap.events) === JSON.stringify(before.snap.events);
  const sameAgg = JSON.stringify(after.agg) === JSON.stringify(before.agg);
  out.steps.push({
    step: "只读恢复核验", ok: integrity?.integrity_check === "ok" && sameItems && sameEvents && sameAgg,
    integrity: integrity?.integrity_check, itemCount: after.snap.items.length, eventCount: after.snap.events.length,
    pointsTotal: after.agg.points, sameItems, sameEvents, sameAgg,
  });
  const ok = out.steps.every((s) => s.ok);
  out.ok = ok;
  console.log(JSON.stringify(out, null, 2));
  process.exit(ok ? 0 : 1);
} catch (e) {
  fail("异常", e);
}
