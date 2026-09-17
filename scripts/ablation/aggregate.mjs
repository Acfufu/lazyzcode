#!/usr/bin/env node
// 汇总面（ADR-0015，goal true-ablation-full-flow#N4）：对一批 trial 做账本完备性报告
// （F4 的机器口径：N/N trials 五类工件齐全、metrics 零缺字段、ledger 行数核对）+
// 方向性签名表（变体×任务：verdict/假完成/脏429 分层）。只读工件与账本，绝不改跑结果。
//
// CLI：node scripts/ablation/aggregate.mjs --batch b1
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { argv, exit } from "node:process";
import { join } from "node:path";
import { ARTIFACT_NAMES, OUT_ROOT } from "./common.mjs";
import { missingMetricKeys } from "./extract-metrics.mjs";

export function aggregate(batch) {
  const batchDir = join(OUT_ROOT, batch);
  const ledgerPath = join(batchDir, "ledger.jsonl");
  const ledger = existsSync(ledgerPath)
    ? readFileSync(ledgerPath, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return { trialId: "?", status: "corrupt-line" };
          }
        })
    : [];

  const trials = [];
  for (const entry of readdirSync(OUT_ROOT)) {
    if (!entry.startsWith(`${batch}-`)) continue;
    const dir = join(OUT_ROOT, entry);
    const missingArtifacts = ARTIFACT_NAMES.filter((n) => !existsSync(join(dir, n)));
    let metrics = null;
    let missingFields = null;
    try {
      metrics = JSON.parse(readFileSync(join(dir, "metrics.json"), "utf8"));
      missingFields = missingMetricKeys(metrics);
    } catch {
      missingFields = ["metrics.json 不可读/缺席"];
    }
    trials.push({ trialId: entry, missingArtifacts, missingFields, metrics });
  }

  const complete = trials.filter((t) => t.missingArtifacts.length === 0 && t.missingFields.length === 0);
  const doneLedger = ledger.filter((l) => l.status === "done");

  // 方向性签名表：行=变体，列=任务；✓=verdict pass，✗=verdict fail，◉=假完成
  // （finish 达成且 verdict 挂——预注册核心信号），d=dirty429 分层标记。
  const byCell = new Map();
  for (const l of doneLedger) {
    const key = `${l.variant}|${l.task}`;
    byCell.set(key, { verdict: l.verdict, fakeComplete: l.fakeComplete, dirty429: l.dirty429 });
  }
  const variants = [...new Set(doneLedger.map((l) => l.variant))].sort();
  const tasks = [...new Set(doneLedger.map((l) => l.task))];

  const lines = [];
  lines.push(`batch=${batch} trials=${trials.length} 工件+metrics 完备=${complete.length}/${trials.length} ledger 行=${ledger.length}（done=${doneLedger.length}）`);
  for (const t of trials) {
    if (t.missingArtifacts.length || t.missingFields.length) {
      lines.push(`  ✗ ${t.trialId}：缺工件 [${t.missingArtifacts.join(",") || "-"}] 缺字段 [${t.missingFields.join(",") || "-"}]`);
    }
  }
  if (variants.length > 0) {
    lines.push(`签名表（✓过 ✗挂 ◉假完成 d=脏429）：`);
    lines.push(`  ${"variant".padEnd(8)}${tasks.join("\t")}`);
    for (const v of variants) {
      const cells = tasks.map((t) => {
        const c = byCell.get(`${v}|${t}`);
        if (!c) return "-";
        const base = c.fakeComplete ? "◉" : c.verdict === "pass" ? "✓" : c.verdict === "fail" ? "✗" : "?";
        return c.dirty429 ? `${base}d` : base;
      });
      lines.push(`  ${v.padEnd(8)}${cells.join("\t")}`);
    }
  }
  return { lines, report: lines.join("\n"), trials, ledger, completeCount: complete.length };
}

if (import.meta.url === `file://${argv[1]}`) {
  try {
    const i = argv.indexOf("--batch");
    const batch = i !== -1 ? argv[i + 1] : "b1";
    const r = aggregate(batch);
    console.log(r.report);
    exit(0);
  } catch (e) {
    console.error(`[aggregate] ${e?.message ?? e}`);
    exit(2);
  }
}
