#!/usr/bin/env node
// M3 四格/逐对差值生成器（goal v050-m3-reval#N8）：从 run-pairs report.json＋journal 生成
// 具名工件 quadrants.json——四格计数（按臂）、逐对差值、产品标准判读输入面。
// 机械生成，不判读：结论性判读（主门/产品标准）在 M3 报告文字层，本工件只落数。
//
// 用法：
//   node scripts/v050/quadrants.mjs --journal <journal.jsonl> [--report <report.json>] --out <quadrants.json>
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const arg = {};
for (let i = 2; i < process.argv.length; i += 2) arg[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const journalPath = arg.journal;
const outPath = arg.out;
if (!journalPath || !outPath) {
  console.error("用法: quadrants.mjs --journal <journal.jsonl> [--report <report.json>] --out <quadrants.json>");
  process.exit(2);
}

// journal（append-only 尝试账）：按 seq 取末行=现行（supersede 语义与 run-pairs 报告层一致）
const lines = readFileSync(journalPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const latest = new Map();
for (const e of lines) {
  const rec = typeof e.line === "string" ? JSON.parse(e.line) : e.record ?? e.line;
  if (rec?.seq != null) latest.set(rec.seq, rec);
}
const runs = [...latest.values()].sort((a, b) => a.seq - b.seq);

// 四格判定（per-leg）：oraclePassed × goalDone；status 非 ok 的腿如实携带 status
const quadrantOf = (r) => {
  if (r.oraclePassed === true && r.goalDone === true) return "correct-done";
  if (r.oraclePassed === true && r.goalDone === false) return "correct-not-done";
  if (r.oraclePassed === false && r.goalDone === true) return "wrong-done";
  if (r.oraclePassed === false && r.goalDone === false) return "wrong-not-done";
  return "unjudged";
};
const byArm = { old: {}, new: {} };
for (const arm of ["old", "new"]) {
  const rs = runs.filter((r) => r.arm === arm);
  const q = { "correct-done": 0, "correct-not-done": 0, "wrong-done": 0, "wrong-not-done": 0, unjudged: 0 };
  for (const r of rs) q[quadrantOf(r)] += 1;
  byArm[arm] = {
    legs: rs.length,
    quadrants: q,
    statusTally: rs.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {}),
    points: rs.reduce((s, r) => s + (r.points ?? 0), 0),
    pointsMissing: rs.filter((r) => r.points == null).map((r) => r.seq),
    meteringTally: rs.reduce((m, r) => ((m[r.metering] = (m[r.metering] ?? 0) + 1), m), {}),
  };
}

// 逐对差值（(repo,taskId,trial) 对，old vs new；缺臂如实标 absent）
const pairKey = (r) => `${r.repo}/${r.taskId}::t${r.trial}`;
const pairsMap = new Map();
for (const r of runs) {
  const k = pairKey(r);
  if (!pairsMap.has(k)) pairsMap.set(k, { pair: k, repo: r.repo, taskId: r.taskId, trial: r.trial });
  const p = pairsMap.get(k);
  p[r.arm] = {
    seq: r.seq, status: r.status, oraclePassed: r.oraclePassed, goalDone: r.goalDone,
    points: r.points, metering: r.metering, resumed: Boolean(r.resumed), judge: r.oracleJudge ?? null,
  };
}
const pairs = [...pairsMap.values()].map((p) => ({
  ...p,
  delta: p.old && p.new
    ? {
        oracleAgree: p.old.oraclePassed === p.new.oraclePassed,
        goalDoneDelta: (p.new.goalDone === true ? 1 : 0) - (p.old.goalDone === true ? 1 : 0),
        pointsDelta: p.old.points != null && p.new.points != null ? Number((p.new.points - p.old.points).toFixed(4)) : null,
      }
    : { absentArm: p.old ? "new" : "old" },
}));
pairs.sort((a, b) => a.pair.localeCompare(b.pair));

// 产品标准判读输入面（不判读，只落数）
const newRuns = runs.filter((r) => r.arm === "new");
const productStandard = {
  newArmLegs: newRuns.length,
  newArmGoalDone: newRuns.filter((r) => r.goalDone === true).length,
  newArmFalseCompletions: newRuns.filter((r) => r.goalDone === true && r.oraclePassed === false).map((r) => r.seq),
  nonDoneLegs: runs.filter((r) => r.goalDone !== true).map((r) => ({
    seq: r.seq, arm: r.arm, status: r.status, resumed: Boolean(r.resumed), failNote: r.failNote ?? null, note: r.note ?? null,
  })),
  missingMetering: runs.filter((r) => r.points == null).map((r) => ({ seq: r.seq, arm: r.arm, metering: r.metering, status: r.status })),
  pointsByArm: { old: byArm.old.points, new: byArm.new.points },
};

// 尝试账：被取代行（同 seq 多行）
const attemptCounts = new Map();
for (const e of lines) {
  const rec = typeof e.line === "string" ? JSON.parse(e.line) : e.record ?? e.line;
  if (rec?.seq != null) attemptCounts.set(rec.seq, (attemptCounts.get(rec.seq) ?? 0) + 1);
}
const attempts = [...attemptCounts.entries()].filter(([, n]) => n > 1).map(([seq, n]) => ({ seq, rows: n }));

let reportNote = null;
if (arg.report && existsSync(arg.report)) {
  const rep = JSON.parse(readFileSync(arg.report, "utf8"));
  reportNote = {
    conclusion: rep?.report?.conclusion ?? null,
    qualificationEligible: rep?.qualification?.eligible ?? null,
    qualityGateMet: rep?.qualityGate?.met ?? null,
    totals: rep?.totals ?? null,
  };
}

const out = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sources: {
    journal: journalPath,
    journalLines: lines.length,
    journalSha256: createHash("sha256").update(readFileSync(journalPath)).digest("hex"),
    report: arg.report && existsSync(arg.report) ? arg.report : null,
  },
  legsRegistered: runs.length,
  byArm,
  pairs,
  productStandard,
  attemptsSuperseded: attempts,
  reportNote,
};
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(`[quadrants] 现行腿 ${runs.length}（journal ${lines.length} 行，重跑对 ${attempts.length}）→ ${outPath}`);
console.log(`[quadrants] old: ${JSON.stringify(byArm.old.quadrants)} / new: ${JSON.stringify(byArm.new.quadrants)}`);
console.log(`[quadrants] pointsByArm old=${byArm.old.points.toFixed(2)} new=${byArm.new.points.toFixed(2)} · 缺计量 ${productStandard.missingMetering.length}`);
