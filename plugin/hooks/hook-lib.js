// 钩子共享库：自包含（部署到插件缓存后脱离 core/ 运行），只读工作区 .lazyzcode/ 状态。
// 铁律：任何异常都吞掉并输出 {} —— 钩子故障绝不劫持无关会话（spike 3 教训）。
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

// Stop 续跑预算：引擎硬顶 3 次/会话，且与 ZCode 后台任务通知共享同一池（宪法红线 2）。
// lzy 最多用 2 次，给后台通知预留 1 次。
export const MAX_STOP_CONTINUES = 2;

// 返回 null = 无 stdin / 坏 JSON（调用方必须 failOpen，不得当 {} 继续走业务）；
// 返回 {} = 引擎确实发来了空对象，属合法输入。
export function readStdinJson() {
  try {
    const raw = readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function inputCwd(input) {
  return typeof input?.cwd === "string" && input.cwd ? input.cwd : process.cwd();
}

// 没有可信 sessionId 就没有预算账目：返回 undefined，由续跑类钩子 failOpen（评审 R1-2）。
export function inputSessionId(input) {
  return (
    input?.sessionId ??
    input?.session_id ??
    (typeof input?.traceId === "string" ? input.traceId : undefined)
  );
}

// sessionId 消毒后再拼状态文件名：含 / 或 .. 的输入会逸出 sessions/ 目录
// （评审 R1-3；引擎供 UUID 属不可达路径，此为纵深防御）。
export function sanitizeSessionId(sessionId) {
  return String(sessionId)
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 128);
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
        join(cwd, ".lazyzcode", "loop", "sessions", `${sanitizeSessionId(sessionId)}.json`),
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
  const target = join(dir, `${sanitizeSessionId(sessionId)}.json`);
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(
    tmp,
    `${JSON.stringify({ continues, updatedAt: new Date().toISOString() })}\n`,
    { mode: 0o600 },
  );
  renameSync(tmp, target);
}

// Stop 计数器读改写的轻量互斥（评审 R1-4）：mkdir 原子锁 + 5s 过期抢；
// 等待约 2s 仍拿不到就无锁放行——钩子纪律是绝不阻断会话，宁损预算精度不损可用性。
const SESSION_LOCK_STALE_MS = 5_000;
const SESSION_LOCK_WAIT_MS = 2_000;

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function withSessionLock(cwd, sessionId, fn) {
  const sessionsDir = join(cwd, ".lazyzcode", "loop", "sessions");
  const lock = join(sessionsDir, `.lock-${sanitizeSessionId(sessionId)}`);
  let held = false;
  const deadline = Date.now() + SESSION_LOCK_WAIT_MS;
  try {
    mkdirSync(sessionsDir, { recursive: true });
  } catch {
    // 目录造不出来（只读盘等）：无锁放行
  }
  for (;;) {
    try {
      mkdirSync(lock); // 无 recursive：已存在时 EEXIST，这是锁的原子核心
      held = true;
      break;
    } catch (err) {
      if (err?.code !== "EEXIST") break; // 非占用类失败：无锁放行
      let ageMs = 0;
      try {
        ageMs = Date.now() - statSync(join(lock, "owner")).mtimeMs;
      } catch {
        ageMs = 0; // owner 还没写完 = 刚加的锁，继续等
      }
      if (ageMs > SESSION_LOCK_STALE_MS) {
        try {
          rmSync(lock, { recursive: true, force: true });
        } catch {
          break;
        }
        continue;
      }
      if (Date.now() > deadline) break; // 等待超时：无锁放行（预算精度损失可接受）
      sleepMs(25);
    }
  }
  try {
    if (held) writeFileSync(join(lock, "owner"), `${process.pid}\n`, { mode: 0o600 });
    return fn();
  } finally {
    if (held) {
      try {
        rmSync(lock, { recursive: true, force: true });
      } catch {}
    }
  }
}

export function emit(obj) {
  const str = JSON.stringify(obj ?? {});
  try {
    // fd 1 直写：同步刷出，Windows 管道异步写截断风险不复存在（评审 R1-5①）。
    writeSync(1, str);
  } catch {
    try {
      process.stdout.write(str);
    } catch {
      // 引擎连 stdout 都读不到时，nothing to do。
    }
  }
}

export function failOpen() {
  emit({});
  process.exit(0);
}
