#!/usr/bin/env node
// 锁竞争窗探针（0.2.2 棒1#N5，§⑩-4 / R5-OPEN-1）。
//
// 目的：把「等锁等了多久、等到放弃过几次」从不可观测变成可观测，并为 F3 造出五个字段
// 全非零的样本。**在 /tmp scratch 仓里跑**（非宿主根）——不碰宿主仓的账本，也不占用
// 宿主仓的锁。只读宿主仓，只写自己的 scratch。
//
// 两相：
//   A 竞争后获锁——植入一把新鲜锁，400ms 后移除；withLock 在下一轮 50ms 轮询里拿到，
//     记 lock_acquisitions/lock_waits/lock_wait_ms_*。
//   B 等到放弃——植入一把新鲜锁且不移除；withLock 等满 LOCK_WAIT_MS 抛 LoopError，
//     记 lock_timeouts（§⑩-4 的原预注册触发条件就此可读）。
//
// 用法：node scripts/probes/lock-contention.mjs [--json]
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { LOCK_WAIT_MS, loopDir, readMetrics, withLock } from "../../core/loop.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

function scratchRepo() {
  const d = mkdtempSync(join(tmpdir(), "lzy-lockprobe-"));
  const g = (...a) => spawnSync("git", a, { cwd: d, encoding: "utf8" });
  g("init", "-q");
  g("config", "user.email", "probe@lzy");
  g("config", "user.name", "probe");
  writeFileSync(join(d, "seed.txt"), "seed\n");
  g("add", "-A");
  g("commit", "-qm", "seed");
  mkdirSync(loopDir(d), { recursive: true });
  return d;
}

/** 植入一把「刚被别的进程拿住」的锁：owner.json 新鲜 → 等待方按年龄判定不可抢。 */
function plantLock(d) {
  const lock = join(loopDir(d), ".lock");
  mkdirSync(lock, { recursive: true });
  writeFileSync(
    join(lock, "owner.json"),
    `${JSON.stringify({ pid: 999999, token: "probe-holder", at: new Date().toISOString() })}\n`,
  );
  return lock;
}

function snapshot(cwd) {
  const m = readMetrics(cwd) ?? {};
  return {
    lock_acquisitions: m.lock_acquisitions ?? 0,
    lock_waits: m.lock_waits ?? 0,
    lock_wait_ms_total: m.lock_wait_ms_total ?? 0,
    lock_wait_ms_max: m.lock_wait_ms_max ?? 0,
    lock_timeouts: m.lock_timeouts ?? 0,
  };
}

/** 在**另一个进程**里于 delayMs 后移除锁。
 * 不能用进程内 setTimeout：withLock 的等待是 `Atomics.wait`，会阻塞事件循环，
 * 定时器回调永远不会跑 —— 探针第一版就死在这上面（phase A 等满 5s 超时）。 */
function releaseLater(lockPath, delayMs) {
  const code = `setTimeout(() => { try { require("fs").rmSync(${JSON.stringify(lockPath)}, { recursive: true, force: true }); } catch {} }, ${delayMs});`;
  const child = spawn(process.execPath, ["-e", code], { stdio: "ignore", detached: true });
  child.unref();
  return child;
}

async function main() {
  const d = scratchRepo();
  const phases = [];

  // ── A：竞争后获锁 ────────────────────────────────────────────────────────────
  const planted = plantLock(d);
  releaseLater(planted, 400); // 独立进程 400ms 后释放
  const t0 = Date.now();
  withLock(d, () => {});
  phases.push({ phase: "A-contended-acquire", observedHoldMs: Date.now() - t0, after: snapshot(d) });

  // ── B：等到放弃（§⑩-4 预注册触发条件） ──────────────────────────────────────
  plantLock(d); // 刻意不移除：等待方必须等满 LOCK_WAIT_MS 后放弃
  const t1 = Date.now();
  let timeoutError = null;
  try {
    withLock(d, () => {});
  } catch (err) {
    timeoutError = err?.message ?? String(err);
  }
  phases.push({
    phase: "B-timeout",
    observedWaitMs: Date.now() - t1,
    lockWaitMsConstant: LOCK_WAIT_MS,
    error: timeoutError,
    after: snapshot(d),
  });
  // 清掉刻意留下的锁，免得读者以为探针卡死了
  rmSync(join(loopDir(d), ".lock"), { recursive: true, force: true });

  const final = snapshot(d);
  const nonZero = Object.entries(final).filter(([, v]) => v > 0).map(([k]) => k);
  const report = {
    probe: "lock-contention",
    scratch: d,
    repo: repoRoot,
    lockWaitMsConstant: LOCK_WAIT_MS,
    metricsFile: join(loopDir(d), "metrics.json"),
    phases,
    finalCounters: final,
    nonZeroFields: nonZero,
    allFiveNonZero: nonZero.length === 5,
  };
  return report;
}

const report = await main();
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`[lock-probe] scratch=${report.scratch}`);
  for (const p of report.phases) {
    const obs =
      p.phase === "A-contended-acquire"
        ? `实测持锁观测 ${p.observedHoldMs}ms`
        : `实测等待 ${p.observedWaitMs}ms（常量 ${p.lockWaitMsConstant}ms）· 放弃原因：${String(p.error).slice(0, 80)}`;
    console.log(`  ${p.phase}: ${obs}`);
    console.log(`    → ${JSON.stringify(p.after)}`);
  }
  console.log(`[lock-probe] 终态计数 ${JSON.stringify(report.finalCounters)}`);
  console.log(
    `[lock-probe] 非零字段 ${report.nonZeroFields.join(", ")}（五项全非零=${report.allFiveNonZero}）`,
  );
}
