// tier-1 无人值守契约测试：scheduleAdvisory（错峰窗口纯函数）+ doctor schedule 行
// 三条真实路径（集中段→warn 建议窗口 / 无集中段→skip / 无日志→skip）。
// fixture 全落 scratch HOME，绝不触碰真实 ~/.zcode。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scheduleAdvisory } from "../core/ratelimit.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");

test("scheduleAdvisory：集中段对侧 8h 窗口；跨午夜集中段；无集中段→null", () => {
  // 集中段 0–3 → 净弧 3–24，窗口 (3+6)%24=9 → 09–17
  const a = scheduleAdvisory({ concentration: { startHour: 0, endHour: 3, sharePct: 70, turns: 50 } });
  assert.equal(a.startHour, 9);
  assert.equal(a.endHour, 17);
  assert.match(a.text, /建议自动化窗口：本地 09:00–17:00/);
  assert.match(a.text, /避开实测集中段 00:00–03:00/);
  // 跨午夜集中段 22–1 → 净弧 1–24，窗口 (1+6)%24=7 → 07–15
  const b = scheduleAdvisory({ concentration: { startHour: 22, endHour: 1, sharePct: 80, turns: 30 } });
  assert.equal(b.startHour, 7);
  assert.equal(b.endHour, 15);
  // 无集中段证据：null（doctor 走 skip，不捏窗口）
  assert.equal(scheduleAdvisory({}), null);
  assert.equal(scheduleAdvisory(null), null);
});

// ── doctor 真实 stdout 面 ───────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, "0");
const line = (stdout, name) => (stdout ?? "").split("\n").find((l) => new RegExp(`^\\s*\\S\\s+${name}\\s`).test(l));
const home = () => mkdtempSync(join(tmpdir(), "lzy-sched-home-"));

function writeLog(dir, lines) {
  mkdirSync(dir, { recursive: true });
  const now = new Date();
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  writeFileSync(join(dir, `zcode-${date}.jsonl`), lines.join("\n") + "\n");
  return date;
}

// 本地时刻 → ISO（集中段按本地小时归桶）
const localTs = (h, min) => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate(), h, min, 0).toISOString();
};

test("doctor schedule：集中段 fixture → warn 建议窗口行（与 rate-limit 同源同扫描）", () => {
  const h = home();
  const d = mkdtempSync(join(tmpdir(), "lzy-sched-repo-"));
  try {
    // 集中段三门槛：本地 10–12 时窗内 started ≥100、去重回合 ≥10、份额 ≥60%
    const lines = [];
    for (const hr of [2, 3, 4]) {
      for (let i = 0; i < 3; i += 1) {
        lines.push(JSON.stringify({ timestamp: localTs(hr, 0), sessionId: `clean${hr}-${i}`, event: "model.request.started" }));
      }
    }
    let t = 0;
    for (const hr of [10, 11, 12]) {
      for (let i = 0; i < 40; i += 1) {
        lines.push(JSON.stringify({ timestamp: localTs(hr, 0), sessionId: `s${hr}-${i}`, event: "model.request.started" }));
      }
      for (let i = 0; i < 4; i += 1) {
        t += 1;
        lines.push(JSON.stringify({
          timestamp: localTs(hr, 30), sessionId: `s${hr}-${i}`, turnId: `t${t}`,
          event: "model.request.failed", context: { reason: "rate_limited", attempt: 1, maxAttempts: 11 },
        }));
      }
    }
    writeLog(join(h, ".zcode", "cli", "log"), lines);
    const r = spawnSync(process.execPath, [CLI, "doctor"], {
      cwd: d, encoding: "utf8", timeout: 120_000, env: { ...process.env, HOME: h },
    });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    const sched = line(out, "schedule");
    assert.ok(sched, "doctor 输出应含 schedule 行");
    assert.match(sched, /建议自动化窗口：本地 19:00–03:00/); // 集中段 10–13 → 净弧中央 8h
    assert.match(sched, /≥1h 间隔/);
    assert.ok(line(out, "rate-limit"), "rate-limit 行仍应在");
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(h, { recursive: true, force: true });
  }
});

test("doctor schedule：无集中段→skip；无日志→skip（不捏窗口）", () => {
  // 有 429 但无集中段证据
  const h1 = home();
  const d1 = mkdtempSync(join(tmpdir(), "lzy-sched-r1-"));
  try {
    writeLog(join(h1, ".zcode", "cli", "log"), [
      JSON.stringify({
        timestamp: new Date(Date.now() - 5 * 60_000).toISOString(), sessionId: "s1",
        event: "model.request.failed", context: { reason: "rate_limited", attempt: 1, maxAttempts: 11 },
      }),
    ]);
    const r = spawnSync(process.execPath, [CLI, "doctor"], {
      cwd: d1, encoding: "utf8", timeout: 120_000, env: { ...process.env, HOME: h1 },
    });
    const sched = line(`${r.stdout ?? ""}${r.stderr ?? ""}`, "schedule");
    assert.ok(sched);
    assert.match(sched, /➖/);
    assert.match(sched, /无集中段证据/);
  } finally {
    rmSync(d1, { recursive: true, force: true });
    rmSync(h1, { recursive: true, force: true });
  }
  // 无日志
  const h2 = home();
  const d2 = mkdtempSync(join(tmpdir(), "lzy-sched-r2-"));
  try {
    const r = spawnSync(process.execPath, [CLI, "doctor"], {
      cwd: d2, encoding: "utf8", timeout: 120_000, env: { ...process.env, HOME: h2 },
    });
    const sched = line(`${r.stdout ?? ""}${r.stderr ?? ""}`, "schedule");
    assert.ok(sched);
    assert.match(sched, /无引擎日志/);
  } finally {
    rmSync(d2, { recursive: true, force: true });
    rmSync(h2, { recursive: true, force: true });
  }
});
