// headless 驱动原语（0.1.0 棒B，ADR-0017；前置件=docs/spikes/headless.md 解锁判定）：
// 以 headless 一等形态驱动引擎（--prompt/--json/--resume/--mode），供全链 E2E 自驱动
// 验收（scripts/headless/e2e-loop.mjs）与 0.2.0 无人值守 runtime 使用。无人值守语义
// （budget/lease/fencing/wake 集成）全留 0.2.0——本原语只封装「一次 headless 调用」的
// 进程契约，不做任何循环编排。
// 安全形态沿 core/engine.js 与 core/update.js 家法：字面量 argv 数组 + shell:false；
// --mode 显式必填不设默认（spike 实测 --prompt 缺省 yolo——自驱动必须显式选模式）；
// --max-turns 已从引擎 CLI 面移除（旧代 help 列出但解析器拒收一切形态；0.16.9
// 字面量×0，spike §6 + 0.16.9 复核增注），墙钟预算
// 是唯一兜底（超时 SIGKILL；null/0 守卫沿 scripts/ablation/spawn-engine.mjs b1 事故
// 教训）。认证链（spike §3）：HOME 隔离换绑时认证 env（ZCODE_BUILTIN/PERSONAL_PROVIDER_
// CONFIG_FILE）随 env 透传；无 env 时引擎读 ~/.zcode/v2/credentials.json（login OAuth，
// 凭据是 HOME 绑定的——换绑 HOME 会失凭据，E2E 走真 HOME 或显式 env 注入）。
// 本模块零业务编排；错误用 HeadlessError（渲染口径与 LoopError/DagError 同）。
import { spawn } from "node:child_process";
import { findEngine } from "./paths.js";

export const HEADLESS_MODES = new Set(["build", "edit", "plan", "yolo"]);
export const HEADLESS_DEFAULT_TIMEOUT_MS = 15 * 60_000;

export class HeadlessError extends Error {}

function assertTimeoutMs(timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new HeadlessError(
      `墙钟预算非法：${timeoutMs}（须正整数毫秒）——0/null 不放行：无预算的 headless 调用会无限挂起（b1 事故教训）`,
    );
  }
}

function buildArgv({ engine, prompt, resume, mode }) {
  const argv = [engine];
  if (resume) argv.push("--resume", resume);
  argv.push("--prompt", prompt, "--json", "--mode", mode);
  return argv;
}

function parseJsonSummary(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return { ok: false, reason: "引擎无 stdout（--json 摘要缺席）" };
  try {
    const obj = JSON.parse(text);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      return { ok: false, reason: "引擎 stdout 非 JSON 对象形态（--json 摘要缺席？）" };
    }
    return { ok: true, summary: obj };
  } catch {
    return { ok: false, reason: `引擎 stdout 非 JSON（--json 摘要应末尾单对象；输出前 200 字符：${text.slice(0, 200)}）` };
  }
}

// 一次 headless 调用。返回（Promise）：
// { ok, exitCode, signal, timedOut, durationMs, stdout, stderr,
//   response?, sessionId?, usage?, projection?, raw?, error? }
// ok=false 时 error 是一族可操作的恢复式文案（超时/非零退出/JSON 解析/spawn 失败）。
// deps.run 可注入供离线契约测试（update.js 先例）：收到 {argv, cwd, env, timeoutMs}，
// 返回 {exitCode, signal?, timedOut?, stdout, stderr, spawnError?}（同步或 Promise）。
export function spawnHeadless({
  prompt,
  resume = null,
  mode,
  timeoutMs = HEADLESS_DEFAULT_TIMEOUT_MS,
  cwd = process.cwd(),
  home = null,
  extraEnv = null,
  enginePath = null,
  deps = null,
} = {}) {
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new HeadlessError("headless 调用缺 prompt（非空字符串）");
  }
  if (!HEADLESS_MODES.has(mode)) {
    throw new HeadlessError(`--mode 显式必填不设默认（--prompt 缺省 yolo，自驱动必须显式选模式）：收到 ${JSON.stringify(mode) ?? "undefined"}，合法 ${[...HEADLESS_MODES].join("|")}`);
  }
  assertTimeoutMs(timeoutMs);
  const engine = enginePath ?? findEngine();
  if (!engine) {
    throw new HeadlessError(
      "引擎未找到——headless 驱动需 ZCode 桌面端安装（LZY_ZCODE_ENGINE 可显式指定 zcode.cjs 路径）",
    );
  }
  const argv = buildArgv({ engine, prompt, resume, mode });
  const env = { ...process.env, ...(extraEnv ?? {}) };
  if (home) {
    env.HOME = home;
    env.USERPROFILE = home;
  }
  const run = deps?.run ?? defaultRun;
  return Promise.resolve(run({ argv, cwd, env, timeoutMs })).then((raw) => {
    const base = {
      exitCode: raw.exitCode,
      signal: raw.signal ?? null,
      timedOut: Boolean(raw.timedOut),
      stdout: String(raw.stdout ?? ""),
      stderr: String(raw.stderr ?? ""),
    };
    if (raw.spawnError) {
      return { ...base, ok: false, error: `引擎进程启动失败：${raw.spawnError}（headless 契约见 docs/spikes/headless.md）` };
    }
    if (base.timedOut) {
      return {
        ...base,
        ok: false,
        error: `墙钟预算 ${Math.round(timeoutMs / 1000)}s 耗尽，进程已 SIGKILL（--max-turns 已移除〔0.16.9 面上无此旗标〕，墙钟是唯一预算）——拆小任务或提高 timeoutMs；已产生的 stdout 附在原字段`,
      };
    }
    if (base.exitCode !== 0) {
      return {
        ...base,
        ok: false,
        error: `引擎 headless 调用非零退出（exit ${base.exitCode}${base.signal ? ` · signal ${base.signal}` : ""}）。stderr 尾部：${base.stderr.slice(-300) || "（无）"}`,
      };
    }
    const parsed = parseJsonSummary(base.stdout);
    if (!parsed.ok) {
      return { ...base, ok: false, error: `--json 摘要解析失败：${parsed.reason}` };
    }
    const s = parsed.summary;
    return {
      ...base,
      ok: true,
      response: typeof s.response === "string" ? s.response : null,
      sessionId: typeof s.sessionId === "string" ? s.sessionId : null,
      usage: s.usage ?? null,
      projection: s.projection ?? null,
      raw: s,
    };
  });
}

function defaultRun({ argv, cwd, env, timeoutMs }) {
  return new Promise((resolvePromise) => {
    // node 直跑引擎（spike §1：node v24 直跑 zcode.cjs；engine.js 同款）——argv[0]=引擎
    // 路径作为 node 的首参，绝不直跑引擎文件（非可执行位 EACCES）。
    const child = spawn(process.execPath, argv, { cwd, env, shell: false });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let spawnError = null;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {}
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      stdout += d;
    });
    child.stderr?.on("data", (d) => {
      stderr += d;
    });
    child.on("error", (err) => {
      spawnError = err?.message ?? String(err);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        exitCode: code,
        signal: signal ?? null,
        timedOut,
        stdout,
        stderr,
        ...(spawnError ? { spawnError } : {}),
      });
    });
    // 防御兜底：个别平台 spawn 失败后 close 可能迟到——error 后短窗补结算，Promise 永不挂。
    child.on("error", () => {
      setTimeout(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise({
          exitCode: null,
          signal: null,
          timedOut,
          stdout,
          stderr,
          spawnError: spawnError ?? "进程启动失败",
        });
      }, 50).unref();
    });
  });
}
