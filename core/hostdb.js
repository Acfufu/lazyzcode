// 只读宿主 sqlite 查询（plan-v2 Phase 2-2/2-4）：与 core/git.js 同一安全形态——可执行为
// 字面量 "sqlite3"，argv 全字面量数组 + shell:false + 超时。loop.js 本体保持零 spawn 纪律
// （见 loop.js 头注），本文件是 plan-v2 报告 §4-2 明示豁免的唯一新增 spawn 面：`lzy loop cost`
// 的计费账本与 doctor 的 orphan-wake 检查共用。缺席（ENOENT）/超时/非零退出/坏 JSON 一律
// 返回 null（调用面自行降级为 skip/提示行，绝不抛）。
import { existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";

// 具名常量人工维护，沿 SCAN_TIME_BUDGET_MS 先例：账本查询是聚合 SQL，正常毫秒级；
// 10s 覆盖冷启动大库，超时按降级处理而非挂死诊断面。
export const HOSTDB_TIMEOUT_MS = 10_000;

function sqliteJson(dbArg, sql) {
  try {
    const r = spawnSync("sqlite3", ["-readonly", "-json", dbArg, sql], {
      shell: false,
      timeout: HOSTDB_TIMEOUT_MS,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.error || r.status !== 0 || typeof r.stdout !== "string") return null;
    const out = r.stdout.trim();
    if (!out) return []; // 空结果集：-json 对零行输出空串
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ── WAL 静寂回退（0.4.0 M4 N10 缺陷批）：引擎自建的账本是 **WAL** 库；连接干净关闭后
// SQLite 会移除 -wal/-shm，此后 `sqlite3 -readonly` 恒拒（SQLITE_CANTOPEN 14：
// 只读连接既不能创建 -shm 也不能跑恢复）。0.4.0 M2 计量缝的隔离子账本读取面正是撞在此
// ——真引擎会话恒 metering-absent（隔离夹具从未真跑引擎，两半都只见过 delete 日志模式的
// 桩库，故 CI 全绿而真实面全盲）。
// 回退判据**只在库静寂时成立**：-wal 缺席或零字节 = 主库文件已是权威内容（干净关闭已
// checkpoint），此时以 `file:<path>?immutable=1` 只读打开（immutable 声明文件不变，SQLite
// 跳过 WAL/-shm 协商）——语义与 -readonly 同为**零写入**，账本文件字节不动。
// -wal 有内容（活写者/未 checkpoint）时不回退：immutable 会静默读旧快照，宁降级返回 null。
function walQuiescent(dbPath) {
  const wal = `${dbPath}-wal`;
  if (!existsSync(wal)) return true;
  try {
    return statSync(wal).size === 0;
  } catch {
    return false;
  }
}

export function queryHostDb(dbPath, sql) {
  const direct = sqliteJson(dbPath, sql);
  if (direct !== null) return direct;
  if (!walQuiescent(dbPath)) return null;
  return sqliteJson(`file:${dbPath}?immutable=1`, sql);
}
