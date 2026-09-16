// lzy doctor：本地诊断（宪法决策 #9：完全无遥测，诊断由本地输出承担）。在 status 全套
// 检查之上增加机器自检：node 版本下限、lzy 解析方式、.lazyzcode 状态卫生、平台立场、
// hook 脚本语法自检（spawn 形态沿 engine.js/git.js 安全形态，见 checkHooks）。
// 单项异常 fail-soft=warn，诊断自身故障不翻转退出码。
import { readdirSync, readFileSync, existsSync, realpathSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { collectStatus } from "./status.js";
import { readRepoManifest } from "./installer.js";
import {
  MARKETPLACE,
  PLUGIN_NAME,
  billingDbPath,
  findEngine,
  installPathFor,
  packageRoot,
  pluginsRoot,
  repoPluginDir,
  tasksIndexPath,
  userCliLogDir,
} from "./paths.js";
import { collectRateLimitStats, contentAdvisory, costAdvisory, providerBandAdvisory, scheduleAdvisory, transportAdvisory } from "./ratelimit.js";
import { WATERLINE_POINTS, rollingWaterlinePoints } from "./cost.js";
import { queryHostDb } from "./hostdb.js";
import { auditAgentsMd } from "./agentsmd.js";
import { scanSessionFlags } from "./loop.js";
import { createGit } from "./git.js";

const NODE_MAJOR_FLOOR = 22;

// 项目记忆过期提示阈值（memory-staleness-fingerprint）：地图基点后覆盖域提交数达到该值，
// doctor agents-md 的 ok 行尾追加「地图落后 N 个提交」提示。写死+人工维护口径（无 env、
// 零新增配置面）：warn-only 信息性提示，活动仓长期 >50 属预期读感，调整须另行拍板。
export const STALENESS_HINT_AT = 50;

// 纯帮手（阈值边界可测）：lag 数据沉默（null）或未达阈值 → 空串（ok 行维持原样）。
export function formatStalenessHint(lag, threshold = STALENESS_HINT_AT) {
  if (lag === null || !Number.isFinite(lag) || lag < threshold) return "";
  return ` · 地图落后 ${lag} 个提交（lazyzcode:init-deep 可刷新）`;
}

// 债3（v009 棒2收尾）：CLI 包版本 vs 载荷缓存版本对照——「CLI 新/载荷旧」的 ADR-0012
// 中间态自查面（npm 已升未 sync 时真实会话仍读旧载荷，模型不知道新纪律/新拦门）。
// 三态：CLI 版本在缓存目录集=ok / 不在=warn（带 sync 指路）/ 缓存缺席=skip。fail-soft
// warn-only 家法；版本两侧实读（package.json + 缓存目录枚举），不写死。
function checkPayloadVersion(push) {
  let cliVersion = null;
  try {
    cliVersion = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version ?? null;
  } catch {}
  const cacheBase = join(pluginsRoot(), "cache", MARKETPLACE, PLUGIN_NAME);
  let versions = [];
  try {
    versions = readdirSync(cacheBase).filter((d) => /^\d+\.\d+\.\d+$/.test(d));
  } catch {}
  if (versions.length === 0) {
    push("payload-ver", "skip", `载荷缓存缺席（未安装）——安装后真实会话才读得到载荷${cliVersion ? `（CLI ${cliVersion}）` : ""}`);
    return;
  }
  versions.sort((a, b) => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
  });
  if (cliVersion && versions.includes(cliVersion)) {
    push("payload-ver", "ok", `缓存 [${versions.join(", ")}] · CLI ${cliVersion} 一致`);
  } else {
    push(
      "payload-ver",
      "warn",
      `缓存 [${versions.join(", ")}] 无 CLI ${cliVersion ?? "未知"} 的载荷目录：跑 lzy sync（npm 已升未 sync 时真实会话仍读旧载荷——ADR-0012 中间态自查面）`,
    );
  }
}

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
// 本检查三层判读：启动器（POSIX run-hook / win32 run-hook.cmd，含 nvm/homebrew fallback）能否解析
// → 不可解析=fail；可解析但当前 PATH 无 node → warn（钩子依赖 fallback）；PATH 直解 → ok。
function checkHookNode(push) {
  const win32 = process.platform === "win32";
  const launcher = join(repoPluginDir(), "hooks", win32 ? "run-hook.cmd" : "run-hook");
  let resolved = "";
  try {
    // Node ≥18 对 .cmd/.bat 直接 spawn 抛 EINVAL（CVE-2024-27980 加固），win32 必须显式经
    // cmd.exe（/d 忽略 AutoRun；/s 修引号解析以支持带空格路径，整串加引号走 verbatim 传参）。
    const r = win32
      ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `"${launcher}" --print-node`], {
          shell: false,
          windowsVerbatimArguments: true,
          timeout: 10_000,
          encoding: "utf8",
        })
      : spawnSync("/bin/sh", [launcher, "--print-node"], {
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
    // kill -9 落在 writeGoal/saveDag 与 rename 之间的孤儿 tmp（评审 R2-11；
    // v009-bat1#N2 家族表与 cleanupLoopResidue 的 tmpFamilies 同源：goal.json + dag.json）
    orphanTmp = readdirSync(dir).filter(
      (f) => f.endsWith(".tmp") && (f.startsWith(".goal.json.") || f.startsWith(".dag.json.")),
    ).length;
  } catch {
    orphanTmp = 0;
  }
  if (goalMissing) {
    if (sessions > 0 || orphanTmp > 0) {
      push(
        "state",
        "warn",
        `无进行中目标但有残留（会话文件 ${sessions} 个、孤儿 tmp ${orphanTmp} 个；lzy loop reset 清理）`,
      );
      return;
    }
    // 疤痕巡逻（ADR-0006）：loop/ 目录在而 goal.json 全无的纯空壳——旧版写命令 withLock
    // 的 mkdirSync 遗留（fail-fast 落地后不再新产）。reset 对 null-goal 空壳报「无需 reset」
    // 清不掉目录本身，指引手动 rm -r。与上方残留 warn 分流，不重复告警。
    // salvage/ 存根是有意产物（可回收工件面，status 有读面）——仅剩它的目录不是疤痕。
    let emptyScar = false;
    try {
      const entries = readdirSync(dir); // 能列目录 = 目录在场
      // 目录在场即疤痕（空目录也是残留）；豁免=有意产物/正常残留：salvage/ 存根、
      // metrics.json 放行计数（跨 reset 永续）、空 sessions/（reset 清内容留目录；
      // 非空场景已在上方残留分支分流，走到此处必为空）、snapshots/ 计划快照档案
      // （v008#N7 采纳即快照，reset 不清——照证据报告先例）、dag.json 中央失效 DAG
      // 账本（v009-bat1#N2，跨 reset 常驻，照 metrics.json 先例）
      const EXEMPT = new Set(["salvage", "metrics.json", "sessions", "snapshots", "dag.json"]);
      emptyScar = entries.length === 0 || entries.some((e) => !EXEMPT.has(e));
    } catch {
      emptyScar = false; // 目录缺席 = 真干净
    }
    if (emptyScar) {
      push(
        "state",
        "warn",
        `.lazyzcode/loop/ 空壳疤痕（有目录无 goal.json；reset 会报「无需 reset」清不掉）——手动 rm -r ${dir} 清除`,
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

// 认领检查（ADR-0004 认领制读面）：孤儿双口径——正向：executing goal 零认领=待认领
// （无人值守接管信号，warn）；反向残留（认领文件而无 goal）由 state 检查承担。
// warn/skip only：认领状态是运行形态不是故障，绝不翻转 doctor 退出码（fail-soft 纪律）。
function checkClaims(push, cwd) {
  let goal = null;
  try {
    goal = JSON.parse(readFileSync(join(cwd, ".lazyzcode", "loop", "goal.json"), "utf8"));
  } catch {
    goal = null;
  }
  if (goal?.status !== "executing") {
    push("claims", "skip", "非 executing 或无目标，认领不生效");
    return;
  }
  const { claims, stuck, expired } = scanSessionFlags(cwd);
  const stuckNote = stuck.length > 0 ? `；⚠ stuck ${stuck.length} 个（${stuck.join(" ")}），推进步骤即自愈` : "";
  const expiredNote =
    expired.length > 0 ? `；过期认领 ${expired.length} 个已按 48h TTL 退役（${expired.join(" ")}）` : "";
  if (claims.length > 0) {
    push("claims", "ok", `认领 ${claims.length} 个（${claims.join(" ")}）——Stop 拉回仅限认领会话${stuckNote}${expiredNote}`);
  } else {
    push(
      "claims",
      "warn",
      "待认领（孤儿）：零认领，Stop 拉回维持目录级现状；任一会话发「zw 继续」即认领接管" +
        `${stuckNote}${expiredNote}`,
    );
  }
}

// 水位警戒线诊断（plan-v2 Phase 2-3）：账本/sqlite3/阈值/当前滚动积分的可观测面——
// 钩子侧 fail-open 静默，这里给出「为什么没警戒」的信号。warn/skip only：水位是经验
// 警戒线不是故障，绝不翻转退出码（fail-soft 纪律）。
function checkWaterline(push) {
  const db = billingDbPath();
  if (!existsSync(db)) {
    push("waterline", "skip", `无计费账本（${db}），水位警戒线不可用`);
    return;
  }
  const env = process.env.LZY_WATERLINE_POINTS;
  const threshold = Number(env) || WATERLINE_POINTS;
  const pts = rollingWaterlinePoints();
  if (pts === null) {
    push("waterline", "warn", "sqlite3 缺席或账本不可读——stop 钩子水位警戒将静默跳过（fail-open）");
    return;
  }
  const envNote = env ? `（env 覆盖自 ${WATERLINE_POINTS}）` : "";
  const over = pts > threshold;
  push(
    "waterline",
    over ? "warn" : "ok",
    `近 5h 滚动 ${pts} / 警戒线 ${threshold} 积分${envNote}——` +
      (over ? "已超线，stop 钩子将注入收尾 nudge（5h 窗内一次）" : "未超线"),
  );
}

// orphan-wake 检查（plan-v2 Phase 2-4）：unbound wake automation（App 非会话上下文建，
// target_task_id 空）挂在本仓而目标不 executing、且近 48h 连续成功空转——空转面警示。
// 09-13 挂载全清后常态是 skip；复挂（ADR-0010 开关语义：挂载=开、清空=关）后此行变有用。
// SQL 全字面量，workspace_path/automation_id 过滤在 JS 侧做（污点不入 SQL）。warn/skip
// only：空转烧的是账号额度不是本仓状态，绝不翻转退出码（fail-soft 纪律）。
const ORPHAN_NOOP_RUNS = 3;
// 路径归一：App 存的 workspace_path 与引擎 spawn 的 cwd 可能各带一层符号链接（macOS
// /var→/private/var 实锤），字面相等会漏判——两侧 realpath 后再比（悬垂路径回落原样）。
const normPath = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
function checkOrphanWake(push, cwd) {
  const idx = tasksIndexPath();
  if (!existsSync(idx)) {
    push("orphan-wake", "skip", "无宿主自动化索引库，无 orphan 面可言");
    return;
  }
  const wakes = queryHostDb(
    idx,
    "SELECT automation_id AS id, workspace_path AS wp FROM automations " +
      "WHERE enabled=1 AND lifecycle_status='active' AND target_task_id IS NULL",
  );
  if (wakes === null) {
    push("orphan-wake", "warn", "tasks-index 不可读（sqlite3 缺席或库损坏）——orphan 检查降级");
    return;
  }
  const root = normPath(resolve(cwd));
  const mine = wakes.filter((w) => normPath(w.wp) === root);
  if (mine.length === 0) {
    push("orphan-wake", "skip", `无 unbound wake automation 挂在本仓——挂载=开、清空=关（ADR-0010）`);
    return;
  }
  let executing = false;
  try {
    executing =
      JSON.parse(readFileSync(join(cwd, ".lazyzcode", "loop", "goal.json"), "utf8"))?.status ===
      "executing";
  } catch {}
  if (executing) {
    push("orphan-wake", "ok", `wake 在场 ${mine.length} 颗且目标 executing——正常喂活`);
    return;
  }
  const cutoff = Date.now() - 48 * 3_600_000;
  const runs =
    queryHostDb(
      idx,
      "SELECT automation_id AS aid, outcome, scheduled_at FROM automation_runs ORDER BY scheduled_at DESC LIMIT 200",
    ) ?? [];
  const mineIds = new Set(mine.map((w) => w.id));
  const recent = runs.filter((r) => mineIds.has(r.aid) && Number(r.scheduled_at) >= cutoff);
  const streak = recent.slice(0, ORPHAN_NOOP_RUNS);
  if (streak.length >= ORPHAN_NOOP_RUNS && streak.every((r) => r.outcome === "succeeded")) {
    push(
      "orphan-wake",
      "warn",
      `orphan 空转面：wake ${mine.length} 颗挂本仓但无 executing 目标，近 48h 连续 ${streak.length} 次成功空转——` +
        "喂活目标或清空挂载（复挂配方 plan-v2 报告 §6）",
    );
    return;
  }
  push(
    "orphan-wake",
    "ok",
    `wake 在场 ${mine.length} 颗，目标非 executing，近 48h run ${recent.length} 次（未达连续空转判据）`,
  );
}

// 提交账本巡逻（ADR-0005）：goal 起点后的提交缺 `Goal:` 尾注的比例。
// warn-only：账本是约定纪律，缺指针不阻断任何流程，doctor 可见即可。
export function checkLedger(push, cwd) {
  let goal = null;
  try {
    goal = JSON.parse(readFileSync(join(cwd, ".lazyzcode", "loop", "goal.json"), "utf8"));
  } catch {
    goal = null;
  }
  if (goal?.status !== "executing" || typeof goal.createdAt !== "string" || !goal.createdAt) {
    push("ledger", "skip", "非 executing 或无 goal，提交账本不适用");
    return;
  }
  const git = createGit(cwd);
  const ledger = git ? git.goalLedger(goal.createdAt) : null;
  if (ledger === null) {
    push("ledger", "skip", "git 不可用，账本巡逻跳过");
    return;
  }
  if (ledger.total === 0) {
    push("ledger", "skip", "goal 起点后暂无提交");
    return;
  }
  if (ledger.missing === 0) {
    push("ledger", "ok", `Goal 指针 ${ledger.total}/${ledger.total}（ADR-0005）`);
  } else {
    push(
      "ledger",
      "warn",
      `goal 起点后 ${ledger.total} 条提交、${ledger.missing} 条缺 Goal 指针（补尾注或接受；约定见 ADR-0005）`,
    );
  }
}

function checkPlatform(push) {
  // 平台感知（ADR-0011 三平台支持）：报引擎候选命中态，而非 darwin 二分立场。
  const found = findEngine();
  if (found) {
    push("platform", "ok", `${process.platform} 引擎候选命中：${found}`);
  } else {
    push(
      "platform",
      "warn",
      `引擎未找到（桌面端未装？候选见 paths.js engineCandidates；${process.platform}）`,
    );
  }
}

// AGENTS.md 分层审计巡逻（tier-1 init-deep，ADR-0002）：纯代码资格谓词 + 覆盖审计，
// warn-only 不翻退出码。根文件不存在→skip（不催 adoption，init-deep 技能负责提案）。
// 过期指纹（memory-staleness-fingerprint）：地图基点后覆盖域提交数 ≥ STALENESS_HINT_AT
// 时 ok 行尾追加「地图落后」提示；lag 数据沉默（非 git/无地图提交史）→ 无后缀，绝不拍脑袋。
function checkAgentsMd(push, cwd) {
  let a;
  try {
    a = auditAgentsMd(cwd);
  } catch (err) {
    push("agents-md", "skip", `审计失败（fail-soft）：${err?.message ?? err}`);
    return;
  }
  if (!a.rootExists) {
    push("agents-md", "skip", "根 AGENTS.md 不存在（lazyzcode:init-deep 可生成分层项目记忆）");
    return;
  }
  const coveredPaths = a.dirs
    .filter((d) => d.qualifies && (d.hasChild || d.mentioned))
    .map((d) => d.path);
  let lag = null;
  try {
    lag = createGit(cwd).mapLag(coveredPaths);
  } catch {
    lag = null; // fail-soft：指纹自身故障不给诊断行添后缀
  }
  const hint = formatStalenessHint(lag);
  if (a.missing.length === 0 && a.over.length === 0) {
    const qualifying = a.dirs.filter((d) => d.qualifies).length;
    push("agents-md", "ok", `分层覆盖完整（资格 ${qualifying} · 缺 0 · 超限 0；lzy agents-md 详单）${hint}`);
    return;
  }
  const miss = a.missing.length > 0 ? `缺 ${a.missing.length}（${a.missing.slice(0, 3).join(" ")}${a.missing.length > 3 ? "…" : ""}）` : "缺 0";
  const over = a.over.length > 0 ? `超限 ${a.over.length}（${a.over.slice(0, 2).map((o) => `${o.path} ${o.lines} 行`).join("、")}${a.over.length > 2 ? "…" : ""}）` : "超限 0";
  push("agents-md", "warn", `${miss} · ${over}（lzy agents-md 详单；lazyzcode:init-deep 补齐，草稿先行）`);
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

// 截断标注(goal ratelimit-scan-budget):样本不全时如实声明——warn-only 经验测量的读者
// 须知道结论基于尾部样本。truncatedFiles/bytesSkipped>0=文件尾部截断,timeExceeded=超时中止。
const truncNoteOf = (t) => {
  if (!t || (t.truncatedFiles === 0 && t.bytesSkipped === 0 && !t.timeExceeded)) return null;
  const mb = Math.round(t.bytesSkipped / 1048576);
  return `样本截断${mb > 0 ? `:略头部 ${mb}MB` : ""}${t.timeExceeded ? (mb > 0 ? "+扫描超时" : ":扫描超时") : ""}`;
};

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
    push("transport", "skip", "无引擎日志可扫（传输死亡体检不可用）");
    push("content", "skip", "无引擎日志可扫（内容审核杀流体检不可用）");
    push("schedule", "skip", "无引擎日志——无人值守窗口无从实测，任意时段均可（建议 ≥1h 间隔）");
    return;
  }
  if (stats.rateLimited === 0) {
    const note0 = truncNoteOf(stats.truncation);
    push("rate-limit", "ok", `近 ${stats.spanHours ?? stats.files * 24}h 无账号级限流记录${note0 ? `（${note0}）` : ""}`);
    // 成本档位建议行（成本两件套②「成功即降档」）：纯建议，不进任何谓词/数学；
    // 阈值沿 checkWaterline 同款 env 覆盖口径
    const cst0 = costAdvisory(
      stats,
      rollingWaterlinePoints(),
      Number(process.env.LZY_WATERLINE_POINTS) || WATERLINE_POINTS,
    );
    if (cst0) push("cost", cst0.level, cst0.text);
    // 传输族独立于限流族：无 429 不代表无传输死亡，行照出
    const tr0 = transportAdvisory(stats);
    push("transport", tr0.level, tr0.text);
    // 内容杀流族同款独立：无 429 不代表无内容审核杀流（干净机+纯内容杀流恰是最常见盲区）
    const ct0 = contentAdvisory(stats);
    push("content", ct0.level, ct0.text);
    push("schedule", "skip", "无集中段证据——任意时段均可挂自动化，建议 ≥1h 间隔");
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
  // 渲染优先级：标题 → 阈值句 → 截断标注 → 集中段 → 游程 → 建议行；超 300 字符先砍集中段
  // 再砍游程，建议行永不砍；截断标注列 extra 首位——样本可信度声明优先于细节证据。
  const adviceStr = `；${advice}`;
  const budget = 300 - [...adviceStr].length;
  let detail = head + mid;
  const truncNote = truncNoteOf(stats.truncation);
  if (truncNote) extra.unshift(truncNote);
  for (const piece of extra) {
    if ([...`${detail}；${piece}`].length <= budget) detail += `；${piece}`;
  }
  detail += adviceStr;
  push("rate-limit", "warn", detail);
  // 传输死亡行（ADR-0008）：与限流同源同扫描不重复读日志，只记账不进任何带数学
  const tr = transportAdvisory(stats);
  push("transport", tr.level, tr.text);
  // 内容审核杀流行：与限流同源同扫描不重复读日志，只记账不进任何带数学
  const ct = contentAdvisory(stats);
  push("content", ct.level, ct.text);
  // provider 分桶带行（决策 #21 前置件）：≥2 provider 才出行；同源同扫描零重复读
  const pb = providerBandAdvisory(stats);
  if (pb) push("band-by-provider", pb.level, pb.text);
  // 成本档位建议行（成本两件套②「成功即降档」）：纯建议，不进任何谓词/数学
  const cst = costAdvisory(
    stats,
    rollingWaterlinePoints(),
    Number(process.env.LZY_WATERLINE_POINTS) || WATERLINE_POINTS,
  );
  if (cst) push("cost", cst.level, cst.text);
  // 错峰窗口（无人值守调度，ADR-0003）：与限流体检同源同扫描，不重复读日志
  const adv = scheduleAdvisory(stats);
  if (adv) {
    push("schedule", "warn", `${adv.text}；无人值守唤起建议 ≥1h 间隔（协议见 zw 技能 Unattended 段）`);
  } else {
    push("schedule", "skip", "无集中段证据——任意时段均可挂自动化，建议 ≥1h 间隔");
  }
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
    checkPayloadVersion,
    (p) => checkLoopState(p, cwd),
    (p) => checkClaims(p, cwd),
    (p) => checkWaterline(p),
    (p) => checkOrphanWake(p, cwd),
    (p) => checkLedger(p, cwd),
    checkPlatform,
    (p) => checkAgentsMd(p, cwd),
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
