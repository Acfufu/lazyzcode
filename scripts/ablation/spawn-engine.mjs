#!/usr/bin/env node
// 引擎 headless 单发驱动（ADR-0015，goal true-ablation-full-flow#N4）。
// 形态沿 headless spike §7：node <engine> --prompt … --json [--resume …]
// [--mode …]；HOME/USERPROFILE 双换隔离；认证 env（ZCODE_*_PROVIDER_CONFIG_FILE，桌面注入）
// 经 process.env 展开自动转发；墙钟 alarm=SIGKILL（spike 用 perl alarm，Node 侧用定时器等价）。
// 消融开关 env 由调用方并入 extraEnv（变体 D/E/F 的开关须随引擎进程下沉到 trial 内一切
// lzy/钩子 子进程），基线两枚人权门开关见 BASE_ABLATE_ENV。PATH 可经 pathEnv 前置（变体
// CLI shim，ADJ-81）；安全形态：argv 数组 + shell:false，无任何命令拼接。
//
// CLI：node scripts/ablation/spawn-engine.mjs --home <dir> --cwd <dir> [--prompt-file <f>]
//        [--resume <sessId>] [--mode <m>] [--timeout-ms <n>] [--switch K=V …] [--path-env <PATH>]
// 库：  import { spawnEngine } from "./spawn-engine.mjs"
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";
import { resolveEngine } from "./common.mjs";

const DEFAULT_TIMEOUT_MS = 15 * 60_000;

// 基线消融 env（ADJ-82）：人权门（ADR-0018）自 0.1.1 起没有真人批准通道就会硬拒计划采纳
// ——headless trial 内不存在「真实用户消息」，A/B/C/F/G/H/I/J 臂一律卡在 `lzy loop plan`，
// 该管线整个不可复跑。故人权门在管线内**全域一致消融**（所有臂同权，不构成臂间差异）；
// 该门本身（含申批记录落地）由 `scripts/headless/e2e-loop.mjs` 的真批准路径单独覆盖——
// 消融不等于免检。新增任何机器门时须同步评估它在 headless 下的可越过性（见设计 §试跑纪律）。
export const BASE_ABLATE_ENV = {
  LZY_ABLATE_HUMAN_GATE: "1",
  LZY_ABLATE_HOOK_HUMAN_GATE: "1",
};

export async function spawnEngine({
  home,
  cwd,
  prompt,
  resume = null,
  mode = "yolo", // spike §6：--prompt 缺省即 yolo——自驱动面必须显式选模式，不静默
  timeoutMs = DEFAULT_TIMEOUT_MS,
  extraEnv = {},
  pathEnv = null, // 变体 CLI shim 前置后的 PATH（ADJ-81）；null=继承父进程 PATH
  engine = null,
} = {}) {
  const enginePath = engine || resolveEngine();
  if (!enginePath) return { ok: false, error: "引擎未找到（LZY_ZCODE_ENGINE 可显式指定）", stdout: "", stderr: "", killed: false };
  if (!prompt) throw new Error("spawnEngine：prompt 必填");
  // null/0/非数一律回默认：调用链（run-batch 不带 --timeout-ms）会把 null 显式传进来，
  // 而 setTimeout(fn, null)=0ms 立即 SIGKILL（b1 首发事故：18 条 0 秒假 trial）。
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  // 无 --max-turns：0.16.5 的 --help 列了它但解析器实拒（pilot 校准探针实测，三种形态
  // 全 Unknown option——help 文案滞后家族）。预算上限=墙钟 alarm 唯一兜底（预注册缓解，
  // 设计文档 §8 条目2）；β 题 leg1 的「必断」由短墙钟承担（legs.json timeoutMs）。
  const args = [enginePath];
  if (resume) args.push("--resume", resume);
  args.push("--prompt", prompt, "--json", "--mode", mode);
  // env 组装序：基线消融（全臂同权）→ HOME/USERPROFILE 双换隔离 → 变体开关 → PATH 前置。
  // 变体开关在基线之后合并（D/E 臂自带 HUMAN_GATE 开关时同值覆盖，无行为差）。
  const env = { ...process.env, ...BASE_ABLATE_ENV, HOME: home, USERPROFILE: home, ...extraEnv };
  if (pathEnv) env.PATH = pathEnv;
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd, env, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    const alarm = setTimeout(() => {
      child.kill("SIGKILL"); // 墙钟 alarm：预算耗尽强杀，绝不悬挂整批
    }, timeout);
    child.on("close", (code, signal) => {
      clearTimeout(alarm);
      resolve({ ok: code === 0 && signal === null, code, signal, stdout, stderr, killed: signal === "SIGKILL" });
    });
    child.on("error", (err) => {
      clearTimeout(alarm);
      resolve({ ok: false, error: err.message, stdout, stderr, killed: false });
    });
  });
}

// —— CLI 面（探针/单发调试用；正式批量走 run-trial/run-batch）——
function parseCliArgs(argv) {
  const out = { switches: {} };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--home") out.home = argv[++i];
    else if (a === "--cwd") out.cwd = argv[++i];
    else if (a === "--prompt-file") out.promptFile = argv[++i];
    else if (a === "--resume") out.resume = argv[++i];
    else if (a === "--mode") out.mode = argv[++i];
    else if (a === "--timeout-ms") out.timeoutMs = Number(argv[++i]);
    else if (a === "--path-env") out.pathEnv = argv[++i];
    else if (a === "--switch") {
      const [k, v] = String(argv[++i]).split("=");
      out.switches[k] = v ?? "1";
    } else throw new Error(`未知参数：${a}`);
  }
  return out;
}

if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  try {
    const a = parseCliArgs(argv);
    if (!a.home || !a.cwd || !a.promptFile) {
      console.error("用法：--home <dir> --cwd <dir> --prompt-file <f> [--resume <sessId>] [--mode m] [--timeout-ms n] [--switch K=V] [--path-env PATH]");
      exit(2);
    }
    const r = await spawnEngine({
      home: a.home,
      cwd: a.cwd,
      prompt: readFileSync(a.promptFile, "utf8"),
      resume: a.resume,
      mode: a.mode,
      timeoutMs: a.timeoutMs,
      extraEnv: a.switches,
      pathEnv: a.pathEnv ?? null,
    });
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
    console.error(`[spawn-engine] exit=${r.code ?? "?"} signal=${r.signal ?? "-"} killed=${r.killed}`);
    exit(r.ok ? 0 : 1);
  } catch (e) {
    console.error(`[spawn-engine] ${e?.message ?? e}`);
    exit(2);
  }
}
