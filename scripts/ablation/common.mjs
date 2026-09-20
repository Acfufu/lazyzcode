// 真消融试跑管线共享库（ADR-0015，goal true-ablation-full-flow#N4）。
// 零依赖（node 内建 + 仓内 core/paths.js）；本目录脚本一律 import 本文件，勿复制漂移。
// 安全形态沿 core/engine.js 家法：可执行恒 process.execPath 或字面量解释器、argv 数组、
// shell:false——本管线永不拼接 shell 字符串。输出根 artifacts/ablation/（gitignored）。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findEngine } from "../../core/paths.js";

export const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");
export const SCRIPTS_DIR = join(REPO_ROOT, "scripts", "ablation");
export const TASKS_DIR = join(SCRIPTS_DIR, "tasks");
// 输出根固定 artifacts/ablation/（gitignored）；LZY_ABLATION_OUT_ROOT 仅供测试隔离覆写，
// 正式跑批永不设置（研究脚本面，非产品配置面）。
export const OUT_ROOT = process.env.LZY_ABLATION_OUT_ROOT || join(REPO_ROOT, "artifacts", "ablation");

// 变体表（预注册冻结，docs/research-ablation-design.md §变体；改动须留 attempt note）：
// install=是否装插件（B 裸引擎不装）；prune=装前从包拷贝里剪掉的 plugin/ 子目录
// （C −文本层：去 skills+agents 留 hooks 与 CLI）；switches=引擎会话 env（恰 "1" 才消融，
// 下沉到 trial 内一切 lzy/钩子 子进程）。
// b2 扩展臂 G/H/I/J（设计 §3 预注册，2026-09-18 增补）——本行即 attempt note。
export const VARIANTS = {
  A: { name: "full-control", install: true, prune: [], switches: {} },
  B: { name: "bare-engine", install: false, prune: [], switches: {} },
  C: { name: "no-text-layer", install: true, prune: ["skills", "agents"], switches: {} },
  D: {
    name: "no-machine-gates",
    install: true,
    prune: [],
    switches: {
      LZY_ABLATE_PLAN_GATE: "1",
      LZY_ABLATE_TIER_GATE: "1",
      LZY_ABLATE_VERIFY: "1",
      LZY_ABLATE_INTEGRITY: "1",
      LZY_ABLATE_ATTEST: "1",
      LZY_ABLATE_HUMAN_GATE: "1",
    },
  },
  E: {
    name: "no-hook-layer",
    install: true,
    prune: [],
    switches: {
      LZY_ABLATE_HOOK_STOP: "1",
      LZY_ABLATE_HOOK_TRIGGER: "1",
      LZY_ABLATE_HOOK_SESSION_START: "1",
      LZY_ABLATE_HOOK_TRIPWIRE: "1",
      LZY_ABLATE_HOOK_COMMENT_CHECKER: "1",
      LZY_ABLATE_HOOK_HUMAN_GATE: "1",
    },
  },
  F: {
    name: "no-integrity-kernel",
    install: true,
    prune: [],
    switches: { LZY_ABLATE_INTEGRITY: "1", LZY_ABLATE_ATTEST: "1" },
  },
  G: {
    name: "no-verify-gate",
    install: true,
    prune: [],
    switches: { LZY_ABLATE_VERIFY: "1" },
  },
  H: {
    name: "no-plan-tier-gates",
    install: true,
    prune: [],
    switches: { LZY_ABLATE_PLAN_GATE: "1", LZY_ABLATE_TIER_GATE: "1" },
  },
  I: { name: "no-roles", install: true, prune: ["agents"], switches: {} },
  J: { name: "tier-heavy-forced", install: true, prune: [], switches: {}, tierHint: "heavy" },
};

// 整包树拷贝排除集（N4 冻结）：防宿主循环态/构建产物泄入 trial 会话。
export const PKG_COPY_EXCLUDE = new Set([".git", ".lazyzcode", "node_modules", "artifacts", "dist"]);

export function resolveEngine() {
  return process.env.LZY_ZCODE_ENGINE || findEngine();
}

// 递归拷贝（cpSync 拒绝「拷进自身子目录」——dest 在 artifacts/ 下必触发；手写遍历，
// 顶级排除集在遍历层生效，artifacts/ 不入队故无自递归）。符号链接按原样重建。
function copyTreeFiltered(src, dest, excludeTop) {
  mkdirSync(dest, { recursive: true });
  for (const ent of readdirSync(src, { withFileTypes: true })) {
    if (excludeTop.has(ent.name)) continue;
    const s = join(src, ent.name);
    const d = join(dest, ent.name);
    const st = lstatSync(s);
    if (st.isSymbolicLink()) {
      try {
        symlinkSync(readlinkSync(s), d);
      } catch {
        // 链接重建失败=跳过（仓库树内无承载语义的链接）
      }
    } else if (st.isDirectory()) {
      copyTreeFiltered(s, d, new Set());
    } else if (st.isFile()) {
      copyFileSync(s, d);
    }
  }
}

// 载荷身份（ADJ-74）：测量仪器必须有 payload provenance——`.stamp` 只记最近 HEAD
// 时，脏树工作会静默复用「已提交树」的旧拷贝，事后无法回答「这批样本量的是哪份载荷」。
// payloadHash = 对源树 cli/ core/ plugin/ 三目录（排除 .mimosa）逐文件
// `"<相对路径>\0<sha256>\n"` 排序串接后的 sha256（与指纹家法同形）；路径分隔符归一为 "/"，
// 使同一份内容在 win32/mac/linux 上得同一个 hash。只读源树，不触网络不写盘。
const PAYLOAD_DIRS = ["cli", "core", "plugin"];
const PAYLOAD_EXCLUDE = new Set([".mimosa"]);

function collectFiles(root, dir, rel, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // 目录缺席（如 C 变体剪枝后的 plugin/skills）不算载荷面
  }
  for (const ent of entries) {
    if (PAYLOAD_EXCLUDE.has(ent.name)) continue;
    const abs = join(dir, ent.name);
    const relChild = rel ? `${rel}/${ent.name}` : ent.name;
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) continue; // 链接不承载载荷内容（同 copyTreeFiltered 立场）
    if (st.isDirectory()) collectFiles(root, abs, relChild, out);
    else if (st.isFile()) out.push({ rel: `${root}/${relChild}`, abs });
  }
}

// pkgDir 省略时取仓内源树（REPO_ROOT 在三目录下）；传变体已装配的 pkg 即得该变体的载荷指纹。
export function computePayloadHash(pkgDir = REPO_ROOT) {
  const files = [];
  for (const sub of PAYLOAD_DIRS) collectFiles(sub, join(pkgDir, sub), "", files);
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const parts = files.map((f) => `${f.rel}\0${createHash("sha256").update(readFileSync(f.abs)).digest("hex")}\n`);
  return { hash: createHash("sha256").update(parts.join("")).digest("hex"), files: files.length };
}

// 源树脏判：三载荷目录里有 tracked 改动（或被删的 tracked 文件）即 true；非 git 仓=null。
// 未跟踪文件不计（构建产物/临时文件不影响「已提交树 vs 工作树」的载荷身份判断）。
export function payloadTreeDirty() {
  const r = spawnSync("git", ["status", "--porcelain", "--", ...PAYLOAD_DIRS], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    shell: false,
    timeout: 30_000,
  });
  if (r.error || r.status !== 0) return null;
  return (r.stdout ?? "").trim().length > 0;
}

// 变体包拷贝（带 stamp 缓存）。复用判据（ADJ-74）= head 相同 ∧ prune 相同 ∧ payloadHash
// 相同 ∧ 工作树干净；任一不满足即重建。脏树（dirty=true/不可判）**总是重建**——工作树内容
// 构建出的载荷不等于任何已提交树，复用旧拷贝就是身份失真，代价只是每次多拷一次包。
export function ensureVariantPkg(variant, { rebuild = false } = {}) {
  const def = VARIANTS[variant];
  if (!def) throw new Error(`未知变体：${variant}（合法：${Object.keys(VARIANTS).join("/")}）`);
  const stampPath = join(OUT_ROOT, "_pkg", variant, ".stamp");
  let head = "";
  {
    const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8", shell: false });
    head = r.status === 0 ? r.stdout.trim() : null;
  }
  const dirty = head === null ? true : payloadTreeDirty() !== false; // null（非 git/查询失败）从保守：算脏
  const payloadHash = computePayloadHash().hash;
  const dest = join(OUT_ROOT, "_pkg", variant, "pkg");
  const stamp = JSON.stringify({ head, dirty, payloadHash, variant, prune: def.prune, at: new Date().toISOString() });
  if (!rebuild && !dirty && existsSync(stampPath) && existsSync(dest)) {
    try {
      const prev = JSON.parse(readFileSync(stampPath, "utf8"));
      if (prev.head === head && prev.payloadHash === payloadHash && JSON.stringify(prev.prune) === JSON.stringify(def.prune)) {
        return dest;
      }
    } catch {
      // 旧格式/损坏 stamp（0.2.0 前的 {head,variant,prune}）→ 落到重建路径，不静默复用
    }
  }
  rmSync(join(OUT_ROOT, "_pkg", variant), { recursive: true, force: true });
  mkdirSync(join(OUT_ROOT, "_pkg", variant), { recursive: true });
  copyTreeFiltered(REPO_ROOT, dest, PKG_COPY_EXCLUDE);
  for (const sub of def.prune) {
    rmSync(join(dest, "plugin", sub), { recursive: true, force: true });
  }
  writeFileSync(stampPath, stamp);
  return dest;
}

// trial 目录五类工件面的标准落点（F2/F4 检查同口径）。
export function trialPaths(trialId) {
  const dir = join(OUT_ROOT, trialId);
  return {
    dir,
    scratch: join(dir, "scratch"),
    home: join(dir, "home"),
    engineStdout: join(dir, "engine-stdout.txt"),
    engineSummary: join(dir, "engine-summary.json"),
    lazyzcodeTree: join(dir, "lazyzcode-tree"),
    gitLog: join(dir, "git-log.txt"),
    rollout: join(dir, "rollout.jsonl"),
    metrics: join(dir, "metrics.json"),
    verdictStdout: join(dir, "verdict-stdout.txt"),
  };
}

export const ARTIFACT_NAMES = [
  "engine-stdout.txt",
  "engine-summary.json",
  "lazyzcode-tree",
  "git-log.txt",
  "rollout.jsonl",
  "metrics.json",
];

export function writeJsonIfAbsentMkdir(p, obj) {
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`);
}

// 引擎 --json 末尾单摘要对象（headless spike §2）：自尾向前找以 "{" 起的候选起点，
// 从该行到末尾整体 JSON.parse——引擎实际 pretty-print 多行（pilot 实测），单行解析会
// 全盲。找不到含 sessionId 的对象返回 null（调用方如实记账，绝不伪造摘要）。
export function parseEngineSummary(stdout) {
  const lines = (stdout ?? "").split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim().startsWith("{")) continue;
    try {
      const o = JSON.parse(lines.slice(i).join("\n").trim());
      if (typeof o?.sessionId === "string") return o;
    } catch {
      // 候选起点不成完整对象（其后另有输出）→ 继续向前
    }
  }
  return null;
}
