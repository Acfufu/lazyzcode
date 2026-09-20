// drive 全链 E2E 实弹验收（0.2.0 棒2，ADR-0020）：`lzy loop drive` 单唤起内推进一个
// scratch goal 到 done（或预算尽干净收束）。仅限有凭据开发机手动实弹——不在 npm test
// glob 内、CI 永不触网（认证门见下）；真引擎段须真 HOME（凭据 HOME 绑定，headless.js
// 认证链注），scratch 仓在 tmp——隔离的是循环状态非凭据。用法：
// node scripts/headless/e2e-drive.mjs [--mode yolo] [--timeout-minutes 15]
//                                     [--wall-ms 720000] [--max-segments 3] [--keep]
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HEADLESS_MODES, detectHeadlessAuth } from "../../core/headless.js";

const REPO = join(fileURLToPath(import.meta.url), "..", "..", "..");
const CLI = join(REPO, "cli", "lzy.js");
const MARK = "hi-from-drive-e2e";

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const mode = arg("--mode", "yolo");
if (!HEADLESS_MODES.has(mode)) {
  console.error(`[e2e-drive] --mode 非法：${mode}（${[...HEADLESS_MODES].join("|")}）`);
  process.exit(1);
}
const timeoutMs = Number(arg("--timeout-minutes", "15")) * 60_000;
const wallMs = Number(arg("--wall-ms", "720000"));
const maxSegments = Number(arg("--max-segments", "3"));
const keep = process.argv.includes("--keep");

// ── 认证门（缺席=skip 不 fail：CI 不碰；两态事实源=detectHeadlessAuth）────────
const auth = detectHeadlessAuth();
if (!auth.ok) {
  console.log("[e2e-drive] SKIP：无 headless 凭据（无 ~/.zcode/v2/credentials.json 且无 ZCODE_*_PROVIDER_CONFIG_FILE env）——有凭据开发机手动跑，CI 不碰");
  process.exit(0);
}

// ── scratch 仓 + loop 注册→plan（人权门消融 env）→start────────────────────────
const scratch = mkdtempSync(join(tmpdir(), "lzy-drive-e2e-"));
const git = (args) => execFileSync("git", args, { cwd: scratch, encoding: "utf8" });
git(["init", "-q"]);
git(["config", "user.email", "e2e@lazyzcode.local"]);
git(["config", "user.name", "e2e"]);
writeFileSync(join(scratch, "seed.txt"), "seed\n");
git(["add", "seed.txt"]);
git(["commit", "-qm", "init"]);

// 人权门是采纳时点门：注册/采纳由本脚本直调 lzy 完成（消融 env 免批准回合，drive 段
// 不触采纳门）；真引擎段只做 status/step done/finish。
const lzyEnv = { ...process.env, LZY_ABLATE_HUMAN_GATE: "1" };
const lzy = (args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: scratch, encoding: "utf8", env: lzyEnv });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};
const slug = "drive-e2e";
console.log(`[e2e-drive] SCRATCH ${scratch}`);
console.log(`[e2e-drive] AUTH ${auth.oauth ? "oauth(credentials.json)" : "env(桌面注入)"} · wallMs=${wallMs} maxSegments=${maxSegments}`);

let r = lzy(["loop", "register", slug, "--title", "drive E2E live fire"]);
if (r.code !== 0) fail(`register 失败：${r.out}`);
writeFileSync(
  join(scratch, "plan.md"),
  [
    "- [N1] 用 Bash 把标记行写入 response.txt（内容恰好一行：" + MARK + "）",
    `- [F1] cat response.txt 的 stdout 含标记 ${MARK}`,
  ].join("\n") + "\n",
);
r = lzy(["loop", "plan", "plan.md"]);
if (r.code !== 0) fail(`plan 采纳失败（消融 env 下应免人权门）：${r.out}`);
r = lzy(["loop", "start"]);
if (r.code !== 0) fail(`start 失败：${r.out}`);
console.log("[e2e-drive] register→plan→start ✔（基线就绪，交 drive 驱动）");

// ── drive 实弹（真引擎段循环；段间三门+收束由 lzy loop drive 自证）────────────
const started = Date.now();
const drv = spawnSync(
  process.execPath,
  [CLI, "loop", "drive", "--mode", mode, "--wall-ms", String(wallMs), "--max-segments", String(maxSegments)],
  { cwd: scratch, encoding: "utf8", env: { ...process.env, LZY_ABLATE_HUMAN_GATE: "1" }, timeout: timeoutMs + 60_000 },
);
const drvOut = `${drv.stdout ?? ""}${drv.stderr ?? ""}`;
console.log(`[e2e-drive] drive exit=${drv.status} ${Math.round((Date.now() - started) / 1000)}s`);
console.log(drvOut.split("\n").map((l) => `[drive] ${l}`).join("\n"));

// ── 终验断言族 ────────────────────────────────────────────────────────────────
const checks = [];
const segLines = drvOut.split("\n").filter((l) => /\[drive\] 段 \d+/.test(l) || /段 \d+\//.test(l));
checks.push(["段日志在案（≥1 段）", drv.status === 0 ? segLines.length > 0 : false]);
r = lzy(["loop", "status"]);
const done = r.code === 0 && /状态 done/.test(r.out);
const windDown = /收束/.test(drvOut);
checks.push(["goal 终态=done 或收束 banner", done || windDown]);
const attestDir = join(scratch, ".lazyzcode", "attestations");
const attests = existsSync(attestDir) ? readdirSync(attestDir).filter((f) => f.endsWith(".json")) : [];
const handoffMarked = existsSync(join(scratch, ".lazyzcode", "loop", "handoff.json"));
checks.push([`attestation(${attests.length}) 或 handoff 标记在场`, attests.length > 0 || handoffMarked]);
let leaseReleased = false;
const runtimePath = join(scratch, ".lazyzcode", "loop", "runtime.json");
if (existsSync(runtimePath)) {
  try {
    leaseReleased = JSON.parse(readFileSync(runtimePath, "utf8")).activeLease === null;
  } catch {
    leaseReleased = false;
  }
} else {
  leaseReleased = false;
}
checks.push(["runtime.json activeLease=null（lease 已释放）", leaseReleased]);
const markerOk = existsSync(join(scratch, "response.txt")) &&
  readFileSync(join(scratch, "response.txt"), "utf8").includes(MARK);
checks.push([`标记文件在案（${MARK}）`, markerOk]);

let verdict = true;
for (const [label, ok] of checks) {
  console.log(`[e2e-drive] ${ok ? "✔" : "✘"} ${label}`);
  if (!ok) verdict = false;
}
console.log(verdict ? "[e2e-drive] VERDICT PASS（drive 单唤起全链：注册→drive 段循环→done/收束→lease 释放）" : "[e2e-drive] VERDICT FAIL");
if (keep) console.log(`[e2e-drive] scratch 保留：${scratch}`);
else cleanup();
process.exit(verdict ? 0 : 1);

function fail(msg) {
  console.error(`[e2e-drive] ${msg}`);
  if (!keep) cleanup();
  process.exit(1);
}
function cleanup() {
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {}
}
