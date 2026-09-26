// 0.3.1 棒1 端到端预演 harness（N9①）：在夹具仓内以「真 CLI 状态面 + 夹具驱动 + 假外部二进制」
// 跑通 queue×delivery 桥全链，并把结论以 JSON 打到 stdout（F1 证据的载体之一）。
// 用法：node scripts/v031/queue-bridge-e2e.mjs <fixtureDir> [--merge-fails]
// 说明：drive 段为夹具驱动（真实模型段不在本 goal 的 F 面——外部模型调用归 M2/M3 试点面）；
//       gh/curl 以可执行假件经 LZY_GH_BIN/LZY_CURL_BIN 注入（delivery.js 文档化注入口）。
import { writeFileSync, readFileSync, mkdirSync, chmodSync } from "node:fs";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const CLI = join(REPO, "cli", "lzy.js");
const d = process.argv[2];
const mergeFails = process.argv.includes("--merge-fails");
const page404 = process.argv.includes("--page-404");
const markerMissing = process.argv.includes("--marker-missing");
if (!d) throw new Error("用法：queue-bridge-e2e.mjs <fixtureDir> [--merge-fails]");

// head 用夹具真实 HEAD（漂移复核要求 headRefOid==意图 headSha；act B 的 head=工作区 HEAD）
const HEAD = spawnSync("git", ["rev-parse", "HEAD"], { cwd: d, encoding: "utf8" }).stdout.trim();
const MERGE = "b".repeat(40);

// 假 gh（状态经 state 文件跨调用保持：merge 前 OPEN/后 MERGED；check-runs 恒绿；pages 对齐）。
// 假件落 HOME 隔离区（夹具树外——finish 完整性闸门要求 host 树净，杂物不得进被测树）。
const fakeDir = join(process.env.HOME ?? "/tmp", ".v031-fakes", basename(d));
mkdirSync(fakeDir, { recursive: true });
const ghState = join(fakeDir, "gh-state.json");
writeFileSync(ghState, JSON.stringify({ merged: false }));
const fakeGh = join(fakeDir, "fake-gh.mjs");
writeFileSync(
  fakeGh,
  `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const stateFile = ${JSON.stringify(ghState)};
const a = process.argv.slice(2).join(" ");
const st = JSON.parse(readFileSync(stateFile, "utf8"));
const out = (o) => { process.stdout.write(JSON.stringify(o)); process.exit(0); };
if (a.startsWith("pr list")) out([]);
if (a.startsWith("pr view")) out({ state: st.merged ? "MERGED" : "OPEN", headRefOid: "${HEAD}", baseRefName: "main", number: 7, url: "u", mergeCommit: st.merged ? { oid: "${MERGE}" } : null });
if (a.startsWith("pr create")) out({ number: 7 });
if (a.startsWith("pr merge")) { if (${mergeFails}) { process.stderr.write("not mergeable"); process.exit(1); } st.merged = true; writeFileSync(stateFile, JSON.stringify(st)); out({}); }
if (a.includes("check-runs")) out([{ name: "ci", status: "COMPLETED", conclusion: "SUCCESS" }]);
if (a.includes("pages/builds/latest")) out({ status: "built", commit: "${MERGE}" });
process.stderr.write("fake-gh 未匹配：" + a); process.exit(1);
`,
);
chmodSync(fakeGh, 0o755);
// 假 curl：站点根与 /guide/ 均 200 ∧ 含标记
const fakeCurl = join(fakeDir, "fake-curl.mjs");
writeFileSync(
  fakeCurl,
  `#!/usr/bin/env node
const url = process.argv[process.argv.length - 1];
const isGuide = url.endsWith("/guide/") || url.endsWith("/guide");
if (isGuide && ${page404 ? "true" : "false"}) { process.stdout.write("HTTPSTATUS:404"); process.exit(0); }
const body = isGuide ? (${markerMissing ? '"<html>stale guide</html>"' : '"<html>v0.3.1 guide</html>"'}) : "<html>v0.3.1</html>";
process.stdout.write(body + "HTTPSTATUS:200");
`,
);
chmodSync(fakeCurl, 0o755);

process.env.LZY_GH_BIN = fakeGh;
process.env.LZY_CURL_BIN = fakeCurl;

const { runQueueDispatch, loadQueue, loadDispatch, loadLedger } = await import(join(REPO, "core", "queue.js"));
const { loadIntents } = await import(join(REPO, "core", "delivery.js"));

const env = { ...process.env };
const fakeDrive = {
  enginePath: "/fixture-drive",
  detectAuth: () => ({ ok: true }),
  drive: async (cwd, opts) => {
    spawnSync(process.execPath, [CLI, "step", "done", "N1"], { cwd, encoding: "utf8", env });
    spawnSync(process.execPath, [CLI, "step", "done", "F1", "--evidence", "bridge-e2e-fixture"], { cwd, encoding: "utf8", env });
    opts.segmentRecords.push({ sessionId: "sess-e2e", durationMs: 7, exitCode: 0, endedAt: new Date().toISOString() });
    return { ok: true, cause: "fixture-drive" };
  },
};

const r = await runQueueDispatch(d, {}, fakeDrive);
const item = loadQueue(d)?.items?.[0] ?? null;
const intents = (loadIntents(d)?.intents ?? []).filter((x) => x.origin?.itemId === item?.id);
const summary = {
  dispatch: r,
  item: item ? { id: item.id, state: item.state, endpoint: item.endpoint, completedEndpoint: item.completedEndpoint, blockedReason: item.blockedReason } : null,
  intents: intents.map((x) => ({ id: x.id, ep: x.endpoint, status: x.status, origin: x.origin, mergeSha: x.observed?.mergeSha ?? null, pages: x.observed?.pages?.map((p) => p.path) ?? null, attempts: x.attempts.map((a) => `${a.method}/${a.outcome}${a.detail ? `:${String(a.detail).slice(0, 90)}` : ""}`) })),
  txs: (loadDispatch(d)?.txs ?? []).map((t) => ({ txId: t.txId, phase: t.phase, note: t.note })),
  deliveryWall: (loadLedger(d)?.entries ?? []).filter((e) => String(e.dedupKey).endsWith(":delivery")).map((e) => ({ dedupKey: e.dedupKey, ms: e.ms, note: e.note })),
};
console.log(JSON.stringify(summary, null, 2));
