// 钩子共享库：自包含（部署到插件缓存后脱离 core/ 运行），只读工作区 .lazyzcode/ 状态。
// 铁律：任何异常都吞掉并输出 {} —— 钩子故障绝不劫持无关会话（spike 3 教训）。
// 注入确定性不变量（pisper-absorption#N1）：additionalContext 注入文本必须确定性——
// 同一会话状态同字节输出：禁时间戳/随机数/不稳定迭代序进入注入文本；注入只追加、不改写既有对话。
// 依据：GLM prompt cache 逐字节前缀比对，注入模板抖动=缓存全 miss 静默变贵（缓存折扣进 lzy loop cost 口径）。
// 契约钉：test/hooks.contract.test.js「六钩子确定性钉」同状态双跑逐字节一致。
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

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
// traceId 回退已删除（V021-ADJ-67）：traceId 语义是「每次进程运行」而非每会话（headless
// spike 实测同 sessionId 返回新 traceId），一旦它成为唯一键，Stop 的 ≤2 预算会在每次
// resume 后重新起算——恰是红线 #2 预留位的静默失效形态。缺 sessionId 即不记账。
export function inputSessionId(input) {
  return input?.sessionId ?? input?.session_id;
}

// 注入文本净化（V021-ADJ-66）：goal.json（工作区可控数据）的 slug/title/步标题在拼进
// additionalContext 前必须过此函数——宿主把 additionalContext 当宿主指导注入，模型对它的
// 信任级别高于读到的仓库内容，原样插入即「工作区数据伪装成宿主提示」。
// 三道：①剥 ANSI CSI 转义（须先于控制字符处理，否则 ESC 被替换成空格后参数串残留为可见
// 文本；沿 core/ratelimit.js providerId 剥控制字符先例）；②控制字符（含 \n \r \t）折为空格、
// 连续空白折叠——换行折叠是硬要求：多行文本能在注入面伪造出额外提示行；③截断 ≤max 字符
// （单段长度帽）。同输入逐字节确定（无时间戳/无随机），注入确定性不变量不受影响。
export function sanitizeInjectText(value, max = 200) {
  const s =
    typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
  return s
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "") // ANSI CSI 序列
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ") // C0/C1 控制字符（含换行/制表）→ 空格
    .replace(/\s+/g, " ") // 连续空白（含全角空格等 \s 族）折叠
    .trim()
    .slice(0, max);
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

// 债 E 诊断专用（ADR-0018 修正案）：从 startDir 逐级上溯，返回最近一个含
// .lazyzcode/loop/goal.json 的祖先目录绝对路径；未命中返 null。
// 边界三条：①只读——仅 existsSync，零写盘、零状态解析，**不得**被任何写面或状态
// 解析复用（ADR-0006 严格 cwd 就地语义不变，状态解析永不 walk-up）；②纯提示——只验
// 路径存在性，不验 goal 状态与 pending，故可能点名一个已完成/无 pending 的祖先目标
// （合法态，本函数不追求精确）；③进程内零新语义——不缓存、不落盘。
export function probeHostRoot(startDir, maxDepth = 8) {
  try {
    let dir = resolve(startDir);
    for (let i = 0; i <= maxDepth; i += 1) {
      if (existsSync(join(dir, ".lazyzcode", "loop", "goal.json"))) return dir;
      const parent = dirname(dir);
      if (parent === dir) return null; // 已到文件系统根（win32 盘根同判据，不手写分隔符）
      dir = parent;
    }
    return null;
  } catch {
    return null;
  }
}

// 会话状态全量读取（ADR-0004 认领制）：已知字段缺省兜底，未知字段原样保留（合并写不丢）。
// lastDoneCount=null 语义=「首拉」（下次拉回起才开始计振）。
export function readSessionState(cwd, sessionId) {
  const state = {
    continues: 0,
    claimedAt: null,
    stallCount: 0,
    lastDoneCount: null,
    stuck: false,
    standdown: null, // 旁观声明旗标（ADR-0009 修订节）：true=会话已声明不参与本目标
  };
  try {
    const raw = JSON.parse(
      readFileSync(
        join(cwd, ".lazyzcode", "loop", "sessions", `${sanitizeSessionId(sessionId)}.json`),
        "utf8",
      ),
    );
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      Object.assign(state, raw);
      state.continues =
        Number.isInteger(raw.continues) && raw.continues >= 0 ? raw.continues : 0;
      state.claimedAt =
        typeof raw.claimedAt === "string" && raw.claimedAt ? raw.claimedAt : null;
      state.stallCount =
        Number.isInteger(raw.stallCount) && raw.stallCount >= 0 ? raw.stallCount : 0;
      state.lastDoneCount =
        Number.isInteger(raw.lastDoneCount) && raw.lastDoneCount >= 0
          ? raw.lastDoneCount
          : null;
      state.stuck = raw.stuck === true;
      state.standdown = raw.standdown === true ? true : null; // 只认 true；缺键/他值=null（零迁移）
    }
  } catch {
    // 文件缺失/损坏 = 全缺省（损坏 JSON 记 0，与预算口径一致）
  }
  return state;
}

export function readSessionCounter(cwd, sessionId) {
  return readSessionState(cwd, sessionId).continues;
}

// 读-合-写：只动 patch 里给的字段，claimedAt 等其余字段原样保留。
// 由调用方兜底 try/catch；写失败只损失记账精度，不影响会话。
export function writeSessionState(cwd, sessionId, patch) {
  const dir = join(cwd, ".lazyzcode", "loop", "sessions");
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `${sanitizeSessionId(sessionId)}.json`);
  let merged = {};
  try {
    const raw = JSON.parse(readFileSync(target, "utf8"));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) merged = raw;
  } catch {
    // 无文件/损坏 = 从干净状态起写
  }
  Object.assign(merged, patch ?? {});
  if (!Number.isInteger(merged.continues) || merged.continues < 0) merged.continues = 0;
  merged.updatedAt = new Date().toISOString();
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(merged)}\n`, { mode: 0o600 });
  renameSync(tmp, target);
}

export function writeSessionCounter(cwd, sessionId, continues) {
  writeSessionState(cwd, sessionId, { continues });
}

// 认领集（ADR-0004）：认领谓词=会话文件含 claimedAt 字段——文件存在≠认领，
// 纯振数文件（stop 侧给未认领会话记 stall 用）不算认领。认领 TTL（plan-v2 Phase 2-5）：
// claimedAt 超 48h=死亡会话认领，不计入——canonical=core/loop.js CLAIM_TTL_MS，
// 本副本随 hook 部署自包含（incMetrics 同款双份纪律）。
export const CLAIM_TTL_MS = 48 * 60 * 60 * 1000;

export function listClaims(cwd) {
  const dir = join(cwd, ".lazyzcode", "loop", "sessions");
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return []; // 目录不存在 = 空认领集（资格制下=无人可拉，ADR-0004 修正案四）
  }
  const claims = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue; // 连 .lock-<sid> 目录与 .pid.tmp 一起排除
    try {
      const raw = JSON.parse(readFileSync(join(dir, name), "utf8"));
      if (raw && typeof raw === "object" && typeof raw.claimedAt === "string" && raw.claimedAt) {
        const at = Date.parse(raw.claimedAt);
        if (Number.isFinite(at) && Date.now() - at > CLAIM_TTL_MS) continue; // 过期认领不算
        claims.push(name.slice(0, -".json".length));
      }
    } catch {
      // 损坏文件不算认领
    }
  }
  return claims;
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
        // owner 缺席（mkdir 与写 owner 之间被强杀）= 无法从 owner 求年龄；回退用锁目录
        // 自身 mtime（V021-ADJ-59）——否则 ageMs 恒 0，锁永不回收，此后该会话每 Stop
        // 白等 SESSION_LOCK_WAIT_MS 才无锁放行。目录也 stat 不到（并发已回收）= 0。
        try {
          ageMs = Date.now() - statSync(lock).mtimeMs;
        } catch {
          ageMs = 0;
        }
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

// ── 放行计数（可观测面）：consumed=Stop 侧实际放行次数。目录级匿名（只有计数，
// 无会话身份，ADR-0009）；跨 reset 永续。无锁读-合-写近似计数（≥ 语义）：多会话
// 同窗 Stop 可丢增量，观测面可接受。契约：永不抛——计数失败绝不影响放行主路径。
// 与 core/loop.js 的 incMetrics 同形（hook-lib 部署后脱离 core/ 自包含，readGoal 先例）。
export function incMetrics(cwd, field) {
  try {
    const p = join(cwd, ".lazyzcode", "loop", "metrics.json");
    let m = {};
    try {
      const raw = JSON.parse(readFileSync(p, "utf8"));
      if (raw && typeof raw === "object" && !Array.isArray(raw)) m = raw;
    } catch {
      // 无文件/损坏 = 从零起计
    }
    m[field] = (typeof m[field] === "number" && Number.isInteger(m[field]) ? m[field] : 0) + 1;
    m.updatedAt = new Date().toISOString();
    mkdirSync(dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(m, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, p);
    return m;
  } catch {
    return null;
  }
}
