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
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { findEngine } from "./paths.js";

export const HEADLESS_MODES = new Set(["build", "edit", "plan", "yolo"]);
export const HEADLESS_DEFAULT_TIMEOUT_MS = 15 * 60_000;

export class HeadlessError extends Error {}

// headless 认证两态（0.2.0 棒2：drive/doctor/e2e 三面共读一份事实，收敛此前 doctor
// checkHeadless 与 e2e-loop 各自内联的两份重复）。oauth=桌面 login 的凭据文件；
// envAuth=桌面注入的 provider 配置 env（spike §3 认证链）；ok=任一在场。
export function detectHeadlessAuth() {
  const credentials = join(homedir(), ".zcode", "v2", "credentials.json");
  // ADJ-43（0.2.1 五轮双审）：判据须同强度——oauth 腿用 existsSync（目录/0 字节也算），
  // env 腿只判在场不验指向文件（陈旧 env 把应 SKIP 的调用变成硬失败，doctor 还报 ok）。
  const oauth = filePresent(credentials);
  const envFile = process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE || process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE;
  const envAuth = Boolean(envFile) && filePresent(envFile);
  const envStale = Boolean(envFile) && !envAuth; // env 在场但文件缺席：第三态供 doctor 报 warn
  return { oauth, envAuth, envStale, ok: oauth || envAuth };
}

function filePresent(p) {
  try {
    return statSync(p).isFile() && statSync(p).size > 0;
  } catch {
    return false;
  }
}

// workers 入口的 env-auth 判据（单一源，v024-fix-round#N4）：两候选 either-or，且须为
// **非空实文件**（size>0）。ADJ-23（v024 双审）：drive 侧曾内联一份副本并与 detectHeadlessAuth
// 的 env 半漂移两处——首候选短路（第二候选被忽略，违自身「落下一个候选继续判」的注释）、
// 0 字节文件被当有效凭据（headless 侧要求 size>0，两读者结论相反）。
export function envAuthOk() {
  for (const key of ["ZCODE_BUILTIN_PROVIDER_CONFIG_FILE", "ZCODE_PERSONAL_PROVIDER_CONFIG_FILE"]) {
    const v = process.env[key];
    if (v && v.length > 0 && filePresent(v)) return true;
  }
  return false;
}

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
// { ok, exitCode, signal, timedOut, aborted, durationMs, stdout, stderr,
//   response?, sessionId?, usage?, projection?, raw?, error? }
// ok=false 时 error 是一族可操作的恢复式文案（超时/非零退出/JSON 解析/spawn 失败）。
// deps.run 收到 {argv, cwd, env, timeoutMs, launcher, processTree, signal}；默认 argv 不变。
// 返回 {exitCode, signal?, timedOut?, stdout, stderr, spawnError?}（同步或 Promise）。
export function spawnHeadless({
  prompt,
  resume = null,
  mode,
  timeoutMs = HEADLESS_DEFAULT_TIMEOUT_MS,
  cwd = process.cwd(),
  home = null,
  extraEnv = null,
  baseEnv = null,
  launcher = null,
  processTree = false,
  signal = null,
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
  if (processTree && process.platform === "win32") {
    throw new HeadlessError("processTree 需要 POSIX 进程组；Windows 未实现后代回收，拒绝假保证");
  }
  if (launcher && (typeof launcher.command !== "string" || !launcher.command || !Array.isArray(launcher.prefixArgs) || !launcher.prefixArgs.every(x => typeof x === "string"))) {
    throw new HeadlessError("launcher 须为 {command: 非空字符串, prefixArgs: 字符串数组}");
  }
  const engine = enginePath ?? findEngine();
  if (!engine) {
    throw new HeadlessError(
      "引擎未找到——headless 驱动需 ZCode 桌面端安装（LZY_ZCODE_ENGINE 可显式指定 zcode.cjs 路径）",
    );
  }
  const argv = buildArgv({ engine, prompt, resume, mode });
  const env = { ...(baseEnv ?? process.env), ...(extraEnv ?? {}) };
  if (home) {
    env.HOME = home;
    env.USERPROFILE = home;
  }
  const run = deps?.run ?? defaultRun;
  const startedAt = Date.now();
  return Promise.resolve(run({ argv, cwd, env, timeoutMs, launcher, processTree, signal })).then((raw) => {
    const base = {
      exitCode: raw.exitCode,
      signal: raw.signal ?? null,
      timedOut: Boolean(raw.timedOut),
      aborted: Boolean(raw.aborted),
      durationMs: Date.now() - startedAt,
      stdout: String(raw.stdout ?? ""),
      stderr: String(raw.stderr ?? ""),
    };
    if (base.aborted) {
      return { ...base, ok: false, error: "引擎 headless 调用已取消；已回收受管进程，请检查已产生的输出后重试" };
    }
    if (raw.cleanupError) {
      return { ...base, ok: false, error: `引擎进程回收失败：${raw.cleanupError}；请检查残留进程后重试` };
    }
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
      // 引擎 --json 摘要全量原样回传（诊断面用）。渲染面注意（ADJ-52，0.2.1 五轮双审）：
      // 该块来自引擎 stdout，须先剥 ANSI/控制字符再入终端/日志，否则可伪造 CLI 成功行。
      raw: s,
    };
  });
}

// processTree 仅回收同 POSIX 进程组；自行 setsid 的后代须由 OS 沙盒另行约束。
function defaultRun({ argv, cwd, env, timeoutMs, launcher, processTree, signal }) {
  if (signal?.aborted) return Promise.resolve({ exitCode: null, aborted: true });
  return new Promise((resolvePromise) => {
    const command = launcher?.command ?? process.execPath;
    const args = launcher ? [...launcher.prefixArgs, process.execPath, ...argv] : argv;
    const child = spawn(command, args, { cwd, env, shell: false, detached: processTree });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let spawnError = null;
    let cleanupError = null;
    let cleanupAttempted = false;
    const timers = new Set();
    const later = (fn, ms) => {
      const timer = setTimeout(fn, ms);
      timers.add(timer);
      return timer;
    };
    const destroyStreams = () => {
      child.stdout?.destroy();
      child.stderr?.destroy();
    };
    const kill = () => {
      // exit/close can both run after timeout or cancellation. Never signal a
      // numeric PGID twice: Darwin may report EPERM once only zombies remain,
      // and an exited group's number can eventually belong to another run.
      // A first failure remains visible; repeating an unverified target is not
      // a recovery mechanism.
      if (cleanupAttempted) return;
      cleanupAttempted = true;
      try {
        if (processTree) {
          if (child.pid) process.kill(-child.pid, "SIGKILL");
        } else child.kill("SIGKILL");
      } catch (err) {
        if (err.code !== "ESRCH") cleanupError = err.message;
      }
    };
    const settle = (payload) => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      destroyStreams();
      resolvePromise({ stdout, stderr, timedOut, aborted, ...(spawnError ? { spawnError } : {}), ...(cleanupError ? { cleanupError } : {}), ...payload });
    };
    const onAbort = () => {
      if (settled) return;
      aborted = true;
      kill();
      destroyStreams();
      // 返回不依赖后代持有的 stdio 或引擎自行退出。
      settle({ exitCode: null, signal: "SIGKILL" });
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const deadline = later(() => {
      timedOut = true;
      kill();
      destroyStreams();
      later(() => settle({ exitCode: null, signal: "SIGKILL" }), 1500);
    }, timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    const MAX_STREAM = 8 * 1024 * 1024;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    child.stdout?.on("data", (d) => {
      if (stdout.length >= MAX_STREAM) { stdoutTruncated = true; return; }
      stdout += d;
    });
    child.stderr?.on("data", (d) => {
      if (stderr.length >= MAX_STREAM) { stderrTruncated = true; return; }
      stderr += d;
    });
    const truncation = () => ({
      ...(stdoutTruncated ? { stdoutTruncated: true } : {}),
      ...(stderrTruncated ? { stderrTruncated: true } : {}),
    });
    child.on("error", (err) => {
      spawnError = err?.message ?? String(err);
      if (processTree) kill();
      later(() => settle({ exitCode: null, signal: null }), 50);
    });
    child.on("exit", (code, exitSignal) => {
      clearTimeout(deadline);
      // 正常退出也回收继承 stdio 的同组后代，再给缓冲输出短宽限。
      if (processTree) kill();
      later(() => settle({ exitCode: code, signal: exitSignal ?? null, ...truncation() }), 200);
    });
    child.on("close", (code, exitSignal) => {
      if (processTree) kill();
      settle({ exitCode: code, signal: exitSignal ?? null, ...truncation() });
    });
    // 防止检查与监听之间发生取消。
    if (signal?.aborted) onAbort();
  });
}
