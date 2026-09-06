// lzy doctor：本地诊断（宪法决策 #9：完全无遥测，诊断由本地输出承担）。在 status 全套
// 检查之上增加机器自检：node 版本下限、lzy 解析方式、.lazyzcode 状态卫生、平台立场、
// hook 脚本语法自检（spawn 形态沿 engine.js/git.js 安全形态，见 checkHooks）。
// 单项异常 fail-soft=warn，诊断自身故障不翻转退出码。
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { collectStatus } from "./status.js";
import { readRepoManifest } from "./installer.js";
import { installPathFor, packageRoot, repoPluginDir, userCliLogDir } from "./paths.js";
import { collectRateLimitStats } from "./ratelimit.js";

const NODE_MAJOR_FLOOR = 20;

function checkHooks(push) {
  let cacheHooksDir = null;
  try {
    cacheHooksDir = join(installPathFor(readRepoManifest()), "hooks");
  } catch {
    cacheHooksDir = null; // 缓存未安装：只检仓库份，install 状态由 status 报告
  }
  const repoHooksDir = join(repoPluginDir(), "hooks");
  const dirs = [repoHooksDir, ...(cacheHooksDir ? [cacheHooksDir] : [])];
  // 语法解析在 worker 内用 vm.SourceTextModule 仅 parse 不执行（见 cli/syntax-check-worker.js）；
  // spawn 沿安全形态：可执行为字面量，argv 为字面量旗标 + 静态常量路径，shell:false。
  // 可执行用 process.execPath 而非 PATH 上的 "node"（评审 R3-10：PATH 被污染/无 node 时自检不再无谓降级，
  // 与 engine.js 自家纪律一致）。
  const r = spawnSync(
    process.execPath,
    ["--experimental-vm-modules", join(packageRoot, "cli", "syntax-check-worker.js"), ...dirs],
    { shell: false, timeout: 30_000, encoding: "utf8" },
  );
  if (r.error) {
    push("hooks", "warn", `语法自检未跑（fail-soft）：${r.error.message}`);
    return;
  }
  let broken = [];
  try {
    broken = JSON.parse(r.stdout ?? "[]");
  } catch {
    push("hooks", "warn", "语法自检输出不可解析（fail-soft）");
    return;
  }
  const pretty = broken.map((b) => `${basename(b.file)}（${b.reason}）`);
  if (dirs.every((d) => !existsHookDir(d))) {
    push("hooks", "warn", "仓库与缓存均无 hook 目录可检");
  } else if (pretty.length > 0) {
    push("hooks", "warn", `${pretty.length} 个脚本语法自检未过：${pretty.join("；")}`);
  } else {
    push("hooks", "ok", `语法自检 ok（检 ${dirs.length} 处：仓库${cacheHooksDir ? " + 缓存" : ""}）`);
  }
}

function existsHookDir(dir) {
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

function checkNode(push) {
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= NODE_MAJOR_FLOOR) {
    push("node", "ok", `v${process.versions.node}（engines 下限 >=${NODE_MAJOR_FLOOR}）`);
  } else {
    push("node", "fail", `v${process.versions.node} 低于 engines 下限 >=${NODE_MAJOR_FLOOR}（升级 node）`);
  }
}

// 钩子命令由引擎以自身 env 直接 spawn，其 PATH 未必解析得到 node（2026-09-07 探针实锤：
// GUI 直启场景引擎 env 无 nvm，裸 `node` ENOENT → 四钩子静默全灭，且钩子侧 fail-open 无从触发）。
// 本检查三层判读：启动器（run-hook.sh，含 nvm/homebrew fallback）能否解析 → 不可解析=fail；
// 可解析但当前 PATH 无 node → warn（钩子依赖 fallback）；PATH 直解 → ok。
function checkHookNode(push) {
  const launcher = join(repoPluginDir(), "hooks", "run-hook.sh");
  let resolved = "";
  try {
    const r = spawnSync("/bin/sh", [launcher, "--print-node"], {
      shell: false,
      timeout: 10_000,
      encoding: "utf8",
    });
    resolved = (r.stdout ?? "").trim();
  } catch {}
  if (!resolved) {
    push(
      "hook-node",
      "fail",
      "钩子 node 完全不可解析（PATH 与启动器 fallback 均落空）——钩子将静默失效；装好 node 后重跑 lzy doctor",
    );
    return;
  }
  const pathNode = spawnSync("node", ["--version"], {
    shell: false,
    timeout: 10_000,
    encoding: "utf8",
  });
  const pathOk = !pathNode.error && pathNode.status === 0;
  if (pathOk) {
    push("hook-node", "ok", `PATH node 可用；启动器兜底解析：${resolved}`);
  } else {
    push(
      "hook-node",
      "warn",
      `当前 PATH 无 node，钩子依赖启动器 fallback 解析：${resolved}（引擎 env PATH 若同样缺失，此兜底即生命线）`,
    );
  }
}

function checkLzyPath(push) {
  const entry = process.argv[1] ?? "";
  const isShim = basename(entry) === "lzy" && /[/\\]bin[/\\]/.test(entry);
  if (isShim) {
    push("lzy-path", "ok", `PATH shim：${entry}`);
  } else {
    push("lzy-path", "skip", `node 直调（${entry || "stdin"}）；npm i -g lazyzcode 可获得 PATH shim`);
  }
}

function checkLoopState(push, cwd) {
  const dir = join(cwd, ".lazyzcode", "loop");
  let goal = null;
  let goalMissing = false;
  try {
    goal = JSON.parse(readFileSync(join(dir, "goal.json"), "utf8"));
  } catch (err) {
    if (err?.code === "ENOENT") goalMissing = true;
    else {
      push("state", "warn", `.lazyzcode/loop/goal.json 不可解析（${err.message}）；lzy loop reset 可清理`);
      return;
    }
  }
  let sessions = 0;
  let orphanTmp = 0;
  try {
    sessions = readdirSync(join(dir, "sessions")).filter((f) => f.endsWith(".json")).length;
  } catch {
    sessions = 0;
  }
  try {
    // kill -9 落在 writeGoal 与 rename 之间的孤儿 tmp（评审 R2-11）
    orphanTmp = readdirSync(dir).filter((f) => f.startsWith(".goal.json.") && f.endsWith(".tmp")).length;
  } catch {
    orphanTmp = 0;
  }
  if (goalMissing) {
    if (sessions > 0 || orphanTmp > 0) {
      push(
        "state",
        "warn",
        `无进行中目标但有残留（会话计数 ${sessions} 个、孤儿 tmp ${orphanTmp} 个；lzy loop reset 清理）`,
      );
    } else {
      push("state", "ok", "无目标循环状态（干净）");
    }
    return;
  }
  if (orphanTmp > 0) {
    push(
      "state",
      "warn",
      `goal ${goal?.slug ?? "?"} 在场但有 ${orphanTmp} 个孤儿 tmp（kill -9 残留；lzy loop reset 清理）；会话计数 ${sessions} 个`,
    );
    return;
  }
  push("state", "ok", `goal ${goal?.slug ?? "?"} 在场（status/loop status 详查）；会话计数 ${sessions} 个`);
}

function checkPlatform(push) {
  if (process.platform === "darwin") {
    push("platform", "ok", "macOS 布局受支持");
  } else {
    push("platform", "warn", `macOS-only 立场：${process.platform} 的引擎定位未支持（paths.js 绝不盲猜）`);
  }
}

// 账号级限流体检：扫引擎 cli 日志（近 2 日）统计 429 压力与经验并发带，warn-only 不翻转
// 退出码。事实底稿与口径见 docs/research-glm-plan-rate-limit.md。
function fmtLocal(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 游程人读化：120 分钟以内报分钟，以上折小时
function fmtRunMin(min) {
  if (min < 120) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}

async function checkRateLimit(push) {
  const logDir = userCliLogDir();
  let stats;
  try {
    stats = await collectRateLimitStats(logDir);
  } catch (err) {
    push("rate-limit", "warn", `限流体检故障（fail-soft）：${err?.message ?? err}`);
    return;
  }
  if (!stats.available) {
    push("rate-limit", "skip", `无引擎日志可扫（${logDir}）`);
    return;
  }
  if (stats.rateLimited === 0) {
    push("rate-limit", "ok", `近 ${stats.spanHours ?? stats.files * 24}h 无账号级限流记录`);
    return;
  }
  // 三分支渲染：经验带连贯 / 单边证据（不连贯） / 无活跃面证据（band=null）。
  // 只测不嘱：建议行数字只取实测边界（maxClean），无实测时无数字；固定「≤3」类处方已废除。
  const unit = stats.caliber === "turn" ? "回合" : "次首撞";
  const spanH = stats.spanHours ?? stats.files * 24;
  const head =
    `近 ${spanH}h 账号限流 ${stats.turns} ${unit}` +
    `（失败请求 ${stats.rateLimited} 次、判死 ${stats.fatal}、最近 ${fmtLocal(stats.lastAt)}）`;
  let mid;
  let advice;
  const extra = [];
  if (stats.band && stats.band.coherent) {
    mid =
      `；经验带：≤${stats.band.maxClean} 会话同开安全、≥${stats.band.minDirty} 即撞线；` +
      `并发按套餐分级（Max>Pro>Lite）`;
    advice = `建议目标循环一次一个、活跃主会话 ≤${stats.band.maxClean} 为宜、判死后等数分钟再 zw 继续`;
  } else if (stats.band) {
    const contrast =
      stats.band.maxClean > 0
        ? `实测 ${stats.band.maxClean} 会话同开未撞线、${stats.band.minDirty} 会话也撞线（分钟级活跃为下界）`
        : `实测 ${stats.band.minDirty} 会话也撞线（分钟级活跃为下界，无净活跃对照）`;
    mid = `；无固定并发阈值：${contrast}，有效边界随套餐与时段浮动`;
    if (stats.concentration) {
      const c = stats.concentration;
      const p2 = (n) => String(n).padStart(2, "0");
      extra.push(
        `撞线集中在本地 ${p2(c.startHour)}:00–${p2(c.endHour)}:00（占 ${Math.max(1, Math.round(c.sharePct / 10))} 成）`
      );
    }
    if (stats.longestRunMin > 0) extra.push(`最长连撞 ${fmtRunMin(stats.longestRunMin)}`);
    advice = `建议目标循环一次一个、活跃主会话宜少并错开集中时段、判死后等数分钟再 zw 继续`;
  } else {
    mid = `；日志缺并发活跃记录，无法估计并发边界`;
    advice = `建议目标循环一次一个、活跃主会话宜少、判死后等数分钟再 zw 继续`;
  }
  // 渲染优先级：标题 → 阈值句 → 集中段 → 游程 → 建议行；超 300 字符先砍集中段再砍游程，建议行永不砍
  const adviceStr = `；${advice}`;
  const budget = 300 - [...adviceStr].length;
  let detail = head + mid;
  for (const piece of extra) {
    if ([...`${detail}；${piece}`].length <= budget) detail += `；${piece}`;
  }
  detail += adviceStr;
  push("rate-limit", "warn", detail);
}

export async function collectDoctor(cwd = process.cwd()) {
  const checks = [];
  const push = (name, state, detail) => checks.push({ name, state, detail });

  try {
    const base = await collectStatus();
    checks.push(...base.checks);
  } catch (err) {
    push("status", "warn", `status 基础检查不可用：${err.message}`);
  }

  const steps = [
    checkHooks,
    checkNode,
    checkHookNode,
    checkLzyPath,
    (p) => checkLoopState(p, cwd),
    checkPlatform,
    (p) => checkRateLimit(p),
  ];
  for (const step of steps) {
    try {
      await step(push);
    } catch (err) {
      push("doctor", "warn", `自检项故障（fail-soft）：${err?.message ?? err}`);
    }
  }

  const criticalFail = checks.some((c) => c.state === "fail");
  return { checks, ok: !criticalFail };
}
