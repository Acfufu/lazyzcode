#!/usr/bin/env node
// 汇总面（ADR-0015，goal true-ablation-full-flow#N4）：对一批 trial 做账本完备性报告
// （F4 的机器口径：N/N trials 五类工件齐全、metrics 零缺字段、ledger 行数核对）+
// 方向性签名表（变体×任务：按格计数的 verdict/假完成/脏429 分层，同格分歧标 ⚠）。
// 只读工件与账本，绝不改跑结果。
//
// CLI：node scripts/ablation/aggregate.mjs --batch b1
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
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

  // 方向性签名表：行=变体，列=任务。**按格聚合（ADJ-86）**：旧实现是 Map last-wins，
  // 同格多 rep 只剩最后一跑——分歧格（C×delta r1 fail / r2 pass / r3 fail）在表上完全
  // 不可见，而「重复之间不一致」恰是 n 小实验里最该看见的信号。现按格计数显示 n/总：
  //   ✓过 ✗挂 ◉假完成（finish 达成且 verdict 挂）?=void 或 verdict 缺席
  //   格内 verdict 不一致标 ⚠；d=脏 429 分层标记（带命中 rep 数）
  const byCell = new Map();
  for (const l of doneLedger) {
    const key = `${l.variant}|${l.task}`;
    let c = byCell.get(key);
    if (!c) {
      c = { total: 0, pass: 0, fail: 0, voidish: 0, fake: 0, dirty: 0 };
      byCell.set(key, c);
    }
    c.total++;
    if (l.verdict === "pass") c.pass++;
    else if (l.verdict === "fail") c.fail++;
    else c.voidish++;
    if (l.fakeComplete) c.fake++;
    if (l.dirty429) c.dirty++;
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
    lines.push(`签名表（n/总 计数：✓过 ✗挂 ◉假完成 ?=void/缺席 ⚠=同格分歧 d=脏429）：`);
    lines.push(`  ${"variant".padEnd(8)}${tasks.join("\t")}`);
    for (const v of variants) {
      const cells = tasks.map((t) => {
        const c = byCell.get(`${v}|${t}`);
        if (!c) return "-";
        // 曾判过的格取组内主判：假完成优先（预注册核心信号），其次 pass/fail 谁占多；
        // 平票或 pass/fail 并存 → ⚠（绝不把分歧压成单值）。全 void/缺席 → ?。
        const decided = c.pass + c.fail;
        let mark;
        let divergent = false;
        if (c.fake > 0) mark = "◉";
        else if (decided === 0) mark = "?";
        else if (c.pass > 0 && c.fail > 0) {
          mark = c.pass > c.fail ? "✓" : "✗";
          divergent = true;
        } else mark = c.fail > 0 ? "✗" : "✓";
        if (c.voidish > 0 && decided > 0) divergent = true; // 部分 rep 是 void，同格不可比
        const warn = divergent ? "⚠" : "";
        const dirt = c.dirty > 0 ? `d${c.dirty}` : "";
        return `${c.total > 1 ? `${decided}/${c.total} ` : ""}${mark}${warn}${dirt}`;
      });
      lines.push(`  ${v.padEnd(8)}${cells.join("\t")}`);
    }
  }
  return { lines, report: lines.join("\n"), trials, ledger, completeCount: complete.length };
}

if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
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
