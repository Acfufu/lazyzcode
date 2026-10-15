// P1 N2：备份恢复重放（F6 表面）——建夹具库 → VACUUM INTO 备份 → 删原库 → 从备份只读恢复 → 完整性+行数一致
// 用法：node scripts/p1-sqlite-pilot/backup-replay.mjs [workdir]
// 退出码：0=全链通过；1=任一步失败（stdout 回执 JSON，stderr 给失败面）。
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openStore, ensureSchema, putQueueItem, setBudget, occupyDispatch, settleDispatch,
  readSnapshot, readBudgetAggregate, backupTo, integrityCheck, stateDbPath,
} from "./statedb.mjs";

const dir = process.argv[2] ?? mkdtempSync(join(tmpdir(), "lzy-p1-backup-"));
const dbPath = stateDbPath(dir);
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
