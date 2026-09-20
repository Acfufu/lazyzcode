// lzy update：npm 升包 + 全新子进程 sync（ADR-0012）。
// 自升级核心难点=npm install 整体替换包目录后，运行中进程还持旧代码（import.meta.url
// 指向的磁盘路径已换新）——进程内 sync 即「旧逻辑部署新载荷」。故升包成功后必须 spawn
// 全新 `node <新装路径>/cli/lzy.js sync` 子进程：新进程加载新代码，升级链每环都由当版
// 本执行。npm spawn 沿 engine.js/doctor.js 安全形态（字面量 argv + shell:false；win32
// npm 是 .cmd，CVE-2024-27980 加固下必须显式经 cmd.exe）。对 config.json 零写入。
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const VIEW_TIMEOUT_MS = 30_000;
const ROOT_TIMEOUT_MS = 15_000;
const INSTALL_TIMEOUT_MS = 300_000;
const CHILD_TIMEOUT_MS = 120_000;

const NPM_INSTALL_ARGV = ["install", "-g", "lazyzcode@latest"];
const MANUAL_STEPS = "npm install -g lazyzcode@latest && lzy sync";

// 点分版本比较：数字段按数值、非数字段按字典序、缺段补 0（确定性退化，非完整 semver；
// registry 现状只发纯数字版本）。返回 -1/0/1。
// ADJ-91（0.2.1）：先剥离 -prerelease/+build 段再比——旧实现把 `0.2.1-beta` 的第三段
// 与 `1` 走字符串比较（"1" < "1-beta"），判出 `0.2.1-beta > 0.2.1` 的误导方向警告；
// 语义=预发布不高于同号正式版（剥段后相等 → 0）。
export function compareVersions(a, b) {
  const strip = (v) => String(v).split(/[-+]/)[0];
  const fa = strip(a).split(".");
  const fb = strip(b).split(".");
  const len = Math.max(fa.length, fb.length);
  for (let i = 0; i < len; i++) {
    const x = fa[i] ?? "0";
    const y = fb[i] ?? "0";
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    let c;
    if (nx && ny) {
      c = Math.sign(Number(x) - Number(y));
    } else {
      c = x < y ? -1 : x > y ? 1 : 0;
    }
    if (c !== 0) return c;
  }
  return 0;
}

// npm 缺席判据（ADJ-91，0.2.1）：POSIX 面 ENOENT 就是事实；win32 分支经 cmd.exe 执行，
// npm 不在时拿到的是 cmd 的退出码与「'npm' 不是内部或外部命令 / not recognized」文案，
// r.error.code 不是 ENOENT → 曾被误诊为「网络或 registry 败」。两态同判据同恢复文案。
export function npmMissing(r) {
  if (r?.error?.code === "ENOENT") return true;
  const text = `${r?.stderr ?? ""}${r?.stdout ?? ""}`;
  return /不是内部或外部命令|not recognized as an internal or external command|command not found|不是可运行的程序/i.test(
    text,
  );
}

// 平台分派的默认 runner：npm 走 PATH（POSIX execvp 直解；win32 经 cmd.exe 解析 .cmd），
// node child 直 spawn（process.execPath 绝对路径，三平台通用）。每调用点命令内容均为
// 模块内字面量，无任何用户数据进 argv。
function defaultRun(req) {
  if (req.kind === "npm") {
    const opts = { shell: false, timeout: req.timeout, encoding: "utf8" };
    const r =
      process.platform === "win32"
        ? spawnSync(
            process.env.ComSpec ?? "cmd.exe",
            ["/d", "/s", "/c", ["npm", ...req.argv].join(" ")],
            { ...opts, windowsVerbatimArguments: true },
          )
        : spawnSync("npm", req.argv, opts);
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error };
  }
  // kind === "node"：全新 lzy 子进程（stdio inherit 让真实 sync 输出直达用户）。
  const r = spawnSync(process.execPath, [req.file, ...req.argv], {
    shell: false,
    stdio: "inherit",
    timeout: req.timeout,
  });
  return { status: r.status, stdout: "", stderr: "", error: r.error };
}

function defaultReadGlobalVersion(pkgDir) {
  try {
    return JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version ?? null;
  } catch {
    return null; // 缺席/损坏=视作未安装，走新装继续（恢复式，不阻断）
  }
}

// 工厂：测试注入 { run, readGlobalVersion } 即可全 fake 驱动，不触网不碰真实 prefix。
export function createUpdater(deps = {}) {
  const run = deps.run ?? defaultRun;
  const readGlobalVersion = deps.readGlobalVersion ?? defaultReadGlobalVersion;

  const npmReq = (argv, what, timeout) => ({ kind: "npm", argv, what, timeout });

  async function update() {
    // 1) 探测已发布版本（也是 npm 在场性检查）。
    const view = await run(npmReq(["view", "lazyzcode", "version"], "npm view", VIEW_TIMEOUT_MS));
    if (npmMissing(view)) {
      return {
        code: 1,
        action: "failed",
        lines: [
          `✖ npm 未找到（update 只调你环境已有的 npm）——手动两步完成升级：`,
          `  ${MANUAL_STEPS}`,
        ],
      };
    }
    if (view.status !== 0) {
      return {
        code: 1,
        action: "failed",
        lines: [
          "✖ 无法探测已发布版本（网络或 registry）——本地未做任何改动：",
          (view.stderr || view.stdout || "").trim(),
        ],
      };
    }
    const published = (view.stdout ?? "").trim();

    // 2) 定位全局安装并读本地版本（缺席=新装继续）。
    const rootReq = await run(npmReq(["root", "-g"], "npm root -g", ROOT_TIMEOUT_MS));
    if (rootReq.status !== 0 || rootReq.error) {
      return {
        code: 1,
        action: "failed",
        lines: npmMissing(rootReq)
          ? [
              `✖ npm 未找到（update 只调你环境已有的 npm）——手动两步完成升级：`,
              `  ${MANUAL_STEPS}`,
            ]
          : [
              "✖ 无法定位 npm 全局目录——本地未做任何改动：",
              (rootReq.stderr || rootReq.stdout || "").trim(),
            ],
      };
    }
    const globalRoot = (rootReq.stdout ?? "").trim();
    const pkgDir = join(globalRoot, "lazyzcode");
    const installed = readGlobalVersion(pkgDir);

    // 3) 比较：同则免装；本地更新则 warn 后仍装已发布 latest。
    const lines = [`本地 ${installed ?? "（未安装）"} · 已发布 ${published}`];
    if (installed !== null && installed === published) {
      lines.push(`✔ 已是最新（${published}）`);
      return { code: 0, action: "up-to-date", lines };
    }
    if (installed !== null && compareVersions(installed, published) > 0) {
      lines.push(`⚠ 本地全局版本 ${installed} 高于已发布 ${published}（开发期？）——仍将安装已发布的 latest`);
    }

    // 4) npm 升包。失败=什么都没换掉，无中间态。
    const inst = await run(npmReq(NPM_INSTALL_ARGV, "npm install", INSTALL_TIMEOUT_MS));
    if (inst.status !== 0 || inst.error) {
      return {
        code: 1,
        action: "failed",
        lines: [
          `✖ npm 升级失败（${installed ?? "未安装"} → ${published} 未发生）——手动两步：`,
          (inst.stderr || inst.stdout || inst.error?.message || "").trim(),
          `  ${MANUAL_STEPS}`,
        ],
      };
    }

    // 5) ADR-0012：全新子进程从新装路径跑 sync（本进程代码已旧，绝不进程内 sync）。
    const childEntry = join(pkgDir, "cli", "lzy.js");
    if (!existsSync(childEntry)) {
      return {
        code: 1,
        action: "midstate",
        lines: midstateLines(installed, published, `新装路径未找到 ${childEntry}`),
      };
    }
    const child = await run({ kind: "node", file: childEntry, argv: ["sync"], timeout: CHILD_TIMEOUT_MS });
    if (child.status !== 0 || child.error) {
      return { code: 1, action: "midstate", lines: midstateLines(installed, published, "sync 子进程失败") };
    }

    lines.push(`✔ 已升级 ${installed ?? "（新装）"} → ${published}，sync 已由新装子进程执行`);
    lines.push("已开启的会话不受影响；新会话生效。");
    return { code: 0, action: "updated", lines };
  }

  const midstateLines = (installed, published, why) => [
    `⚠ 中间态：npm 已升级 ${installed ?? "（未安装）"} → ${published}，但 sync 未跑（${why}）——当前会话仍用旧版。`,
    `  手动补一步即可收敛：lzy sync`,
  ];

  return { update };
}
