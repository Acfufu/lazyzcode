#!/usr/bin/env node
// v050 M1 F2 探针（红绿同源）：计量收口三场景真实表面取证。
// 断言全部按「收口后」绿形书写；改前树跑=红（部分断言失败 exit 1），终树跑=绿（exit 0）。
// HOME 全程隔离（mkdtemp），绝不触真实 ~/.zcode。
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendSandboxUsage, readSandboxUsageLines, formatCost } from "../../../core/cost.js";
import { ReviewPreflightError, filterProviderConfig } from "../../../core/review.js";

const homes = [];
const results = [];
const check = (id, name, fn) => {
  try {
    fn();
    results.push(`PASS ${id} ${name}`);
  } catch (e) {
    results.push(`FAIL ${id} ${name} :: ${e.message.split("\n")[0]}`);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const isolatedHome = () => {
  const home = mkdtempSync(join(tmpdir(), "lzy-m1-f2-home-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  homes.push(home);
  return home;
};
const REC = (runId) => ({
  runId, slug: "f2fx", attempt: 1, validity: { status: "valid" },
  metering: { status: "metered", points: 7, usage: [{ provider: "p", model: "m", inputTokens: 100, cacheReadTokens: 0, outputTokens: 10, points: 7 }] },
});

check("P1", "formatCost 宿主账缺席时沙盒外泄账独立可达", () => {
  isolatedHome();
  appendSandboxUsage("/x/y/f2proj", REC("f2.p1.r1"));
  const out = formatCost("/x/y/f2proj", null);
  assert(out.includes("沙盒外泄账"), "宿主账缺席输出须仍含沙盒外泄账段");
  assert(out.includes("1 运行") || out.includes("1 评审运行"), "落账运行数须可见");
});

check("P2", "filterProviderConfig 结构不可识别 fail-closed", () => {
  isolatedHome();
  let threw = null;
  try {
    filterProviderConfig({});
  } catch (e) {
    threw = e;
  }
  assert(threw !== null, "空结构须拒绝（fail-closed），实测仍返回 " + JSON.stringify(threw === null ? null : null));
  assert(threw instanceof ReviewPreflightError, "拒须为 ReviewPreflightError（实测无抛出）");
  assert(/恢复|修复/.test(threw?.message ?? ""), "报文须带恢复指路");
});

check("P3", "appendSandboxUsage 同 runId 重放幂等（不双算）＋project 为全路径", () => {
  isolatedHome();
  appendSandboxUsage("/x/y/f2proj", REC("f2.p3.r1"));
  appendSandboxUsage("/x/y/f2proj", REC("f2.p3.r1")); // 同 runId 重放
  appendSandboxUsage("/x/y/f2proj", REC("f2.p3.r2")); // 新 runId 照常入账
  const lines = readSandboxUsageLines();
  assert(lines.length === 2, `同 runId 重放后应恰 2 行（r1 去重＋r2），实测 ${lines.length}`);
  const r1 = lines.filter((l) => l.runId === "f2.p3.r1");
  assert(r1.length === 1, "r1 恰一行");
  assert(r1[0].project === "/x/y/f2proj", `project 须为全路径，实测 ${JSON.stringify(r1[0].project)}`);
});

console.log(results.join("\n"));
const fails = results.filter((r) => r.startsWith("FAIL"));
console.log(`[probe-f2] ${results.length - fails.length}/${results.length} pass${fails.length ? "（红半：存在未满足断言）" : "（绿）"}`);
for (const h of homes) if (existsSync(h)) rmSync(h, { recursive: true, force: true });
process.exit(fails.length ? 1 : 0);
