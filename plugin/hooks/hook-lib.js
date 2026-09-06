// 钩子共享库：自包含（部署到插件缓存后脱离 core/ 运行），只读工作区 .lazyzcode/ 状态。
// 铁律：任何异常都吞掉并输出 {} —— 钩子故障绝不劫持无关会话（spike 3 教训）。
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Stop 续跑预算：引擎硬顶 3 次/会话，且与 ZCode 后台任务通知共享同一池（宪法红线 2）。
// lzy 最多用 2 次，给后台通知预留 1 次。
export const MAX_STOP_CONTINUES = 2;

export function readStdinJson() {
  try {
    const raw = readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function inputCwd(input) {
  return typeof input?.cwd === "string" && input.cwd ? input.cwd : process.cwd();
}

export function inputSessionId(input) {
  return (
    input?.sessionId ??
    input?.session_id ??
    (typeof input?.traceId === "string" ? input.traceId : undefined) ??
    "unknown-session"
  );
}

export function readGoal(cwd) {
  try {
    const goal = JSON.parse(
      readFileSync(join(cwd, ".lazyzcode", "loop", "goal.json"), "utf8"),
    );
    return goal && typeof goal === "object" ? goal : null;
  } catch {
    return null;
  }
}

export function readSessionCounter(cwd, sessionId) {
  try {
    const raw = JSON.parse(
      readFileSync(
        join(cwd, ".lazyzcode", "loop", "sessions", `${sessionId}.json`),
        "utf8",
      ),
    );
    return Number.isInteger(raw?.continues) && raw.continues >= 0 ? raw.continues : 0;
  } catch {
    return 0;
  }
}

export function writeSessionCounter(cwd, sessionId, continues) {
  // 由调用方兜底 try/catch；写失败只损失预算计数精度，不影响会话。
  const dir = join(cwd, ".lazyzcode", "loop", "sessions");
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `${sessionId}.json`);
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(
    tmp,
    `${JSON.stringify({ continues, updatedAt: new Date().toISOString() })}\n`,
    { mode: 0o600 },
  );
  renameSync(tmp, target);
}

export function emit(obj) {
  try {
    process.stdout.write(JSON.stringify(obj ?? {}));
  } catch {
    // 引擎连 stdout 都读不到时，nothing to do；exit 0 放行。
  }
}

export function failOpen() {
  emit({});
  process.exit(0);
}
