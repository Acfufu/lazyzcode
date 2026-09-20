// 全链 E2E 自驱动验收（0.1.0 棒B，ADR-0017）：headless 原语（core/headless.js）驱动
// 真引擎执行一个 scratch goal loop 的 注册→finish 全链。仅限有凭据开发机手动实弹——
// 不在 npm test glob 内、CI 永不触网（认证门见下）；干净机配方=login 一次+随包 builtin
// 配置（docs/spikes/headless.md §5）。
// 认证链：桌面注入的 ZCODE_*_PROVIDER_CONFIG_FILE env 或 ~/.zcode/v2/credentials.json
// （login OAuth）二有其一即过认证门；都缺席时本脚本 skip（exit 0）不 fail。
// 每发 ≈12k input tokens（spike §6）——目标刻意 trivial，1-2 turn 内收口。
// **本脚本验收的载荷 = 安装缓存载荷**（真凭据 + 真引擎 + 真会话，会话读 cache 不读工作树：
// 跑前请先 `lzy sync`；开跑前有前置对照，见 payload-version.mjs）。
// 用法：node scripts/headless/e2e-loop.mjs [--mode yolo] [--timeout-minutes 15] [--keep]
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnHeadless, HEADLESS_MODES, detectHeadlessAuth } from "../../core/headless.js";
import { checkPayloadCache } from "./payload-version.mjs";

const REPO = join(fileURLToPath(import.meta.url), "..", "..", "..");
const CLI = join(REPO, "cli", "lzy.js");
const MARK = "hi-from-headless-e2e";

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const mode = arg("--mode", "yolo");
if (!HEADLESS_MODES.has(mode)) {
  console.error(`[e2e] --mode 非法：${mode}（${[...HEADLESS_MODES].join("|")}）`);
  process.exit(1);
}
const timeoutMs = Number(arg("--timeout-minutes", "15")) * 60_000;
const keep = process.argv.includes("--keep");

// ── 认证门（缺席=skip 不 fail：本机没凭据不是产品缺陷；两态事实源=detectHeadlessAuth）──
const auth = detectHeadlessAuth();
const oauth = auth.oauth;
if (!auth.ok) {
  console.log("[e2e] SKIP：无 headless 凭据（无 ~/.zcode/v2/credentials.json 且无 ZCODE_*_PROVIDER_CONFIG_FILE env）——有凭据开发机手动跑，CI 不碰");
  process.exit(0);
}

// ── 载荷前置对照（ADJ-41）：真会话读安装缓存载荷，仓内未 sync 时本脚本会验错对象 ────
const payload = checkPayloadCache();
if (payload.status === "missing") {
  console.error(`[e2e] 载荷前置对照失败：${payload.detail}——先跑 \`lzy sync\`（把本仓 plugin/ 部署成缓存载荷）再重跑本脚本`);
  process.exit(1);
}
if (payload.status === "warn") console.warn(`[e2e] 载荷前置对照警告：${payload.detail}（继续跑；verdict 请按此打折扣）`);

let scratch = null;

async function main() {
  // ── scratch 仓 + loop 注册→plan→start（宿主 CLI 直调，防全局 lzy 旧版影子）──────
  scratch = mkdtempSync(join(tmpdir(), "lzy-headless-e2e-"));
  const git = (args) => execFileSync("git", args, { cwd: scratch, encoding: "utf8" });
  git(["init", "-q"]);
  git(["config", "user.email", "e2e@lazyzcode.local"]);
  git(["config", "user.name", "e2e"]);
  writeFileSync(join(scratch, "seed.txt"), "seed\n");
  git(["add", "seed.txt"]);
  git(["commit", "-qm", "init"]);

  const lzy = (args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: scratch, encoding: "utf8" });
    return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  };
  const slug = "headless-e2e";
  console.log(`[e2e] SCRATCH ${scratch}`);
  console.log(`[e2e] AUTH ${oauth ? "oauth(credentials.json)" : "env(桌面注入)"} · 载荷 ${payload.status === "ok" ? payload.detail : `${payload.status}（继续）`}`);

  let r = lzy(["loop", "register", slug, "--title", "headless E2E self-drive"]);
  if (r.code !== 0) fail(`register 失败：${r.out}`);
  const planPath = join(scratch, "plan.md");
  writeFileSync(
    planPath,
    [
      "- [N1] 用 Bash 把标记行写入 response.txt（内容恰好一行：" + MARK + "）",
      `- [F1] cat response.txt 的 stdout 含标记 ${MARK}`,
    ].join("\n") + "\n",
  );
  // ── 人权门两回合（0.1.1 goal1，ADR-0018）：回合一=真用户批准消息过引擎 UPS ──────
  r = lzy(["loop", "plan", "plan.md"]);
  if (r.code === 0) fail("人权门未生效：无批准采纳竟成功（ADR-0018 门缺席？）");
  const shortCode = (r.out.match(/短码 ([0-9a-f]{8})/) ?? [])[1];
  if (!shortCode) fail(`人权门拒报文无短码：${r.out}`);
  console.log(`[e2e] 人权门拒 ✔（pending 短码 ${shortCode}）——回合一：真用户批准消息`);
  const approve = await spawnHeadless({ prompt: `批准 ${shortCode}`, mode, timeoutMs, cwd: scratch });
  console.log(`[e2e] approve ok=${approve.ok} sessionId=${approve.sessionId ?? "—"}`);
  if (!approve.ok) fail(`批准回合失败：${approve.error}`);
  // L2 证据：批准记录必须在盘面（引擎注入的 UPS 写入，非模型转述）。
  const approvalFiles = existsSync(join(scratch, ".lazyzcode", "loop", "approvals"))
    ? readdirSync(join(scratch, ".lazyzcode", "loop", "approvals")).filter((f) => f.endsWith(".json"))
    : [];
  if (approvalFiles.length === 0) fail("批准回合后 approvals/ 无记录——引擎 UPS 路径未生效");
  console.log(`[e2e] approval record ✔ ${approvalFiles.join(", ")}`);
  // 状态归一（批准回合内模型可能已自行采纳/开跑甚至一口气 finish——trivial 计划下
  // yolo 模型会照上下文把循环推到底）：done=直接进终验；否则无 planHash 重采纳（记录
  // 在位应过）、仍 planning 则 start；两者幂等容忍。
  r = lzy(["loop", "plan", "plan.md"]);
  const goalNow = readGoal();
  if (goalNow.status === "done") {
    console.log("[e2e] 批准回合模型已自行驱动至 done（trivial 计划+yolo 上下文），跳过归一与驱动回合");
  } else {
    if (!goalNow.planHash) fail(`批准后采纳仍未过：${r.out}`);
    r = lzy(["loop", "start"]);
    if (r.code !== 0 && !/executing/.test(r.out)) fail(`start 失败：${r.out}`);
    console.log("[e2e] loop registered/plan(human-gated)/start ✔（基线就绪，交 headless 驱动）");
  }

  // ── headless 驱动（自包含 prompt：不依赖对话史——交接状态全在盘面， zw 协议同款）──
  const prompt = [
    `你在 ${scratch} 目录驱动 LazyZCode 目标循环（slug=${slug}，状态已 executing）。`,
    `lzy CLI 必须用仓内路径调用：node ${CLI} <args>（全局 lzy 可能是旧版影子，勿用）。`,
    `现在执行：`,
    `1. 运行 node ${CLI} loop status 核实状态。`,
    `2. 用 Bash 写 response.txt：内容恰好一行 ${MARK}。`,
    `3. node ${CLI} step done N1 --note "wrote marker"。`,
    `4. node ${CLI} step done F1 --evidence "$(cat response.txt)"。`,
    `5. node ${CLI} loop finish（应打印 ✔✔ 目标完成）。`,
    `全部用工具真实执行，不要问询；结束前打印一行 FINAL: <finish 命令的退出码>。`,
  ].join("\n");

  if (goalNow.status !== "done") {
    const started = Date.now();
    const res = await spawnHeadless({ prompt, mode, timeoutMs, cwd: scratch });
    console.log(`[e2e] headless ok=${res.ok} exit=${res.exitCode} ${Math.round((Date.now() - started) / 1000)}s sessionId=${res.sessionId ?? "—"}`);
    if (res.response) console.log(`[e2e] response 尾部：${res.response.slice(-200).replace(/\n+/g, " ⏎ ")}`);
    if (!res.ok) fail(`headless 调用失败：${res.error}`);
  }

  // ── 终验：loop done + attestation 在场（LOOP_COMPLETE 机器证明）────────────────
  r = lzy(["loop", "status"]);
  const done = r.code === 0 && /状态 done/.test(r.out);
  console.log(`[e2e] loop status done=${done}`);
  const attestDir = join(scratch, ".lazyzcode", "attestations");
  const attests = existsSync(attestDir) ? readdirSync(attestDir).filter((f) => f.endsWith(".json")) : [];
  const attested = attests.length > 0;
  console.log(`[e2e] attestation ${attested ? attests.join(", ") : "缺席"}`);
  const verdict = done && attested && approvalFiles.length > 0;
  console.log(verdict ? "[e2e] VERDICT PASS（headless 自驱动全链：注册→人权门批准→执行→finish→attestation）" : "[e2e] VERDICT FAIL");
  if (keep) console.log(`[e2e] scratch 保留：${scratch}`);
  return verdict ? 0 : 1;
}

// goal.json 读取走 fail 通道：裸 JSON.parse 在异常路径会绕过清理直退（ADJ-40 同族）。
function readGoal() {
  const p = join(scratch, ".lazyzcode", "loop", "goal.json");
  let raw;
  try {
    raw = readFileSync(p, "utf8");
  } catch {
    fail(`goal.json 不可读：${p}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    fail(`goal.json 解析失败：${p} — ${e?.message ?? e}`);
  }
}

function fail(msg) {
  throw new Error(msg);
}

function cleanup() {
  if (!scratch) return;
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {}
}

// 主体包 try/finally（ADJ-40）：scratch 建好后任何异常/失败路径都必须清理，唯一例外是
// --keep（保留现场给人看）。fail() 走 throw 而非 process.exit——后者会跳过 finally。
let exitCode = 0;
try {
  exitCode = await main();
} catch (e) {
  console.error(`[e2e] ${e?.message ?? e}`);
  exitCode = 1;
} finally {
  if (!keep) cleanup();
}
process.exit(exitCode);
