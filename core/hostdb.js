// 只读宿主 sqlite 查询（plan-v2 Phase 2-2/2-4）：与 core/git.js 同一安全形态——可执行为
// 字面量 "sqlite3"，argv 全字面量数组 + shell:false + 超时。loop.js 本体保持零 spawn 纪律
// （见 loop.js 头注），本文件是 plan-v2 报告 §4-2 明示豁免的唯一新增 spawn 面：`lzy loop cost`
// 的计费账本与 doctor 的 orphan-wake 检查共用。缺席（ENOENT）/超时/非零退出/坏 JSON 一律
// 返回 null（调用面自行降级为 skip/提示行，绝不抛）。
import { spawnSync } from "node:child_process";

// 具名常量人工维护，沿 SCAN_TIME_BUDGET_MS 先例：账本查询是聚合 SQL，正常毫秒级；
// 10s 覆盖冷启动大库，超时按降级处理而非挂死诊断面。
export const HOSTDB_TIMEOUT_MS = 10_000;

export function queryHostDb(dbPath, sql) {
  try {
    const r = spawnSync("sqlite3", ["-readonly", "-json", dbPath, sql], {
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
