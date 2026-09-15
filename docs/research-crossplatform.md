# 跨平台侦察底稿（Windows/Linux 支持前置）

> 目标 `crossplatform-recon` 产物 · 2026-09-15 · 引擎取证基线：ZCode 桌面 3.12.1（引擎 CLI `--version` 恒 0.16.5，bundle `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`，11MB 单行 minified）。
> 证据口径：引擎源码证据以**字节偏移**指认（offset 随版本漂移，语义以摘录为准）；minified 单行 bundle 的出现计数用 `grep -o | wc -l`（行计数恒 1 不可用）。
> 实证边界：三台 Parallels 测试机均为 **arm64 客户机**（Apple Silicon 宿主）——本文所有 VM 实证仅覆盖 arm64；x64 用户群的结论只能由官方文档声明，不在本机实证范围。

## 1. 引擎钩子 spawn 语义（N1 · 源码取证）

本节回答一个问题：**现有 `hooks.json` 的 `/bin/sh …` 命令行在各平台会怎样被执行。**

### 1.1 事件与清单 schema

- 钩子事件枚举恰为 7 个（offset≈785200，zod `E.enum`）：`SessionStart / UserPromptSubmit / PreToolUse / PermissionRequest / PostToolUse / PostToolUseFailure / Stop`——与 AGENTS.md §3.1 实锤一致。
- 钩子条目 schema 是 `discriminatedUnion("type", …)` 且**两个分支都 `.strict()`**（offset≈785836，摘录）：

```js
E.discriminatedUnion("type",[
  E.object({...xJt, type:E.literal("command"),
    async:E.boolean().optional(),
    shell:E.union([E.literal(!0), Ld]).optional()   // true 或字符串
  }).strict(),
  E.object({...xJt, type:E.literal("process"),
    args:E.array(E.string()).optional()
  }).strict()
])
```

- **schema 无任何平台/os 条件字段**。加上 `.strict()` 拒绝未知字段：**一份 hooks.json 无法声明式地表达「按平台选命令」**——这是启动器设计的硬约束（设计稿 §1 的方案空间由此划定）。
- `command` 型可带 `shell` 字段（`true` 或字符串）；`process` 型 = `command`（作可执行文件）+ 可选 `args[]`，免 shell 直启。

### 1.2 shell 字段的三态解析（offset≈2295436 一带，函数注解语义 `resolveShell…`）

```js
// 摘录（minified 变量名 t=env, r=platform, e=shell 字段值）
function uuo(e,t,r){
  return typeof e=="string" ? e                    // ① 字符串 → 直接当 shell 可执行文件
    : r==="win32" ? Uur(t,"ComSpec","win32") ?? "cmd.exe"   // ② 未设 + win32 → ComSpec → cmd.exe
    : !0                                           // ③ 未设 + 其余 → shell:true（POSIX /bin/sh -c）
}
```

**推论（Windows 断链的引擎级实锤）**：现 hooks.json 五处命令均为 `/bin/sh "${ZCODE_PLUGIN_ROOT}/hooks/run-hook.sh" <script>` 且未设 `shell` 字段 → 在 Windows 上被解析为 **cmd.exe 执行该命令行**；`/bin/sh` 既非 cmd 内建也非可执行 → **每次钩子触发确定性失败**（对应引擎 `hook.run.failed` 面）。POSIX 侧（macOS/Linux）走 `/bin/sh -c`，现状成立。

### 1.3 两种执行形态（offset≈9113890 `createConfiguredHookCallback` 摘录）

```js
case "command":  executionPort.run({command:{mode:"shell",
                   command:k7(r.command,r.plugin,s,cwd), shell:r.shell}, …})
case "process":  executionPort.run({command:{mode:"argv",
                   file:k7(r.command,…), args:(r.args??[]).map(d=>k7(d,…))}, …})
```

- 两形态的 `command/file/args` 都先经 `k7` 变量插值（offset≈9100949 一带）：`${ZCODE_PLUGIN_ROOT}`→插件根、`${ZCODE_PLUGIN_DATA}`、`${ZCODE_PROJECT_DIR}`；`${ZCODE_SKILL_DIR}` 在无技能上下文时抛 ConfigurationError；会话 ID 类变量**禁止在清单字符串里插值**（抛错），但会经 **env** 注入（见 1.4）。
- `process` 型即「**跨平台直启原语**」：`{"type":"process","command":"node","args":["${ZCODE_PLUGIN_ROOT}/hooks/stop.js"]}` 一份清单三平台语义一致——代价是放弃 shell 层的 node 回退（`node` 解析完全依赖 PATH，见 §3 GUI 启动 PATH 实测与 §4 障碍盘点）。

### 1.4 env 注入与 stdin/stdout（平台中立面）

- 钩子 env（offset≈9100700 一带）：`ZCODE_SESSION_ID`、`ZCODE_PROJECT_DIR`（cwd）、`ZCODE_PLUGIN_ID/NAME/ROOT/DATA`（插件在场时）——与平台无关。
- stdin 为 JSON 载荷、stdout JSON 解析（`parseHookStdout`/`processHookOutput` 注解实证）——协议面平台中立，无跨平台风险点。

### 1.5 引擎自身 Windows/Linux 感知旁证

- `resolvePlatformBinaryName`（offset≈567291）：win32 给捆绑二进制（rg/ugrep/bfs）追加 `.exe`——引擎在 Windows 有完整布署预期。
- `getDefaultEnvironment`（offset≈6207900 一带）：win32 专用 env 白名单（LOCALAPPDATA/SYSTEMROOT/PROCESSOR_ARCHITECTURE…）。
- 浏览器打开命令按平台三分支（offset≈5790800）：darwin `open` / win32 `cmd.exe /c start` / 其余 `xdg-open`。
- 引擎 arch 枚举含 arm64/x64 全集（offset≈432215）——引擎自身无 arm64-only 假设。

## 2. 官方下载面：三平台存在形态（N2）

- **取证面**：`https://zcode.z.ai`（302 → `/cn`），HTTP 200，捕获时点 **2026-09-14T20:03:04Z**，285,931 字节整页快照（副本在证据包）。
- **结论：ZCode 桌面端官方发行覆盖三平台×双架构**，下载页版本 **3.11.2**（58 处；旧版 3.10.1/3.10.2 仍在页面数据中）：

| 平台 | 架构 | 安装包形态（cdn-zcode.z.ai/zcode/electron/releases/3.11.2/…） |
|---|---|---|
| macOS | arm64 / x64 | `ZCode-3.11.2-mac-arm64.dmg` / `…mac-x64.dmg` |
| Windows | **arm64 / x64** | `ZCode-3.11.2-win-arm64.exe` / `…win-x64.exe` |
| Linux | **arm64 / x64** | AppImage / deb / rpm 双架构各三件 |

- 页面内嵌结构化数据按平台分键（`Windows (ARM64)`、`Linux (x64)`、`linux-aarch64.installer_url` 等），每键带 description 与 changelog_url——**官方分发面对 Windows/Linux 的支持是产品级承诺，非社区移植**。
- **对 arm64 实证边界的修正意义**：三平台的 arm64 客户机（本机三 VM 的形态）全部有官方发行包——VM 实证覆盖的是官方支持矩阵的一等象限，非边缘配置；x64 仅该矩阵的另一半，维持「文档声明」口径。
- 观察如实记：本机安装的桌面壳为 3.12.1（更新通道领先于下载页标称 3.11.2）；引擎 bundle `--version` 恒 0.16.5（壳/引擎双版本线，AGENTS.md §3 前言已记）。本底稿引擎取证基于本机 3.12.1 壳内 bundle。


## 3. VM 实探：Windows 11 / Ubuntu（N3）

取证通道：`prlctl exec`（宿主 Parallels）；逐字输出副本在证据包（`vm/windows-probes.txt`、`vm/ubuntu-probes.txt`）。时点 2026-09-15T04:1xZ。**钩子活体触发不在本轮**（装插件属实现棒），本节只记布局与 env 事实。

### 3.1 客户机清单与通道实录

| VM（prlctl 名） | 状态 | exec 通道 | 客户机架构实证 |
|---|---|---|---|
| `Windows 11` | running | ✔ 通 | `echo %PROCESSOR_ARCHITECTURE%` → `ARM64`（ver 10.0.26200） |
| `Ubuntu Linux aarch64` | stopped→started | ✔ 通 | `uname -m` → `aarch64`（Ubuntu 26.04.1 LTS） |
| `Ubuntu Linux arm64` | running | ✖ 拒（"Unable to open new session…latest Parallels Tools"） | 未探——并列如实记录，主证据由 aarch64 台承担 |
| `macOS 26` | stopped | 未用（宿主本身 macOS，出圈） | — |

通道怪癖如实记：prlctl exec 对带引号/空格的 `sh -c "…"` 有分词（只吃下一 token），全程改用单 token 命令直跑；exec 会话以 SYSTEM/root 身份运行，`~` 解析到系统档案（Windows doctor 输出 `C:\WINDOWS\system32\config\systemprofile\...` 即此象），GUI 用户会话的 PATH 只能更全、不能更窄。

### 3.2 双平台事实矩阵

| 事实 | Windows 11 (ARM64) | Ubuntu 26.04 (aarch64) |
|---|---|---|
| node | ✔ `C:\Tools\node\node.exe` v22.23.2，PATH 可解析（`where node`） | ✔ `/bin/node` v22.23.2（系统级，GUI 会话必得） |
| npm | ✔ 10.9.8 | ✔ 10.9.8（prefix `/usr/local`） |
| ZCode 桌面端 | 未装（新机；`where zcode` 空、`%LOCALAPPDATA%\Programs` 空） | 未装（`which zcode` 空、`/opt` 空） |
| `npm i -g lazyzcode` | ✔ added 1 package (20s)；npm 生成双 shim `lzy` + `lzy.cmd` | ✔ 装入 `/usr/local/lib/node_modules/lazyzcode`；symlink shim `/usr/local/bin/lzy` |
| `lzy doctor` | payload/hooks/node/state ✔；**hook-node ✖**（启动器链全落空）；platform ⚠ win32 | payload/hooks/node ✔；**hook-node ✔**（「PATH node 可用；启动器兜底解析：/bin/node」）；platform ⚠ linux |
| 引擎落位（免安装取证） | 官方 win-arm64.exe 为 NSIS 安装器（CLI 免装不可列；落位探查留实现棒装后实测） | deb 布局实测：**`/opt/ZCode/resources/glm/zcode.cjs`**（12,615,227B）+ `.node-bundle-meta.json`（`"runtime":"electron-node"`）+ 捆绑 `packages/`（zcode-guide-plugin）与 `tools/ripgrep|bfs|ugrep`；GUI 入口 `usr/share/applications/zcode.desktop` |

### 3.3 关键推论

1. **引擎布局同构**：macOS `<app>/Contents/Resources/glm/zcode.cjs` ≅ Linux `/opt/ZCode/resources/glm/zcode.cjs`——`engineCandidates()` 的多平台扩展是**纯数据表问题**（每 OS 一条常量路径），非架构改动。Windows 路径形态待实现棒装后实测（electron 惯例 `%LOCALAPPDATA%\Programs\zcode\resources\glm\zcode.cjs` 一类，不入正表）。
2. **两 VM 的 node 都是系统级安装且 v22.23.2 与本机同版**——`type:"process"` 直启原语（§1.3）在这两台上的 PATH 前提成立；macOS GUI 启动场景仍需启动器兜底（2026-09-07 事故形态）。
3. **PATHEXT 探针**（Windows，%TEMP% 内可逆）：`cmd.exe /c <无扩展名完整路径>` 对 `run-hook` → `run-hook.cmd` 孪生自动解析，引号两形态皆通——**一行 hooks.json 命令跨双平台**的启动器形态在引擎原语上成立（方案对比见设计稿 §1 方案 C′）。


## 4. 本仓安装链障碍盘点（N4）

逐点 file:line；「✔ 跨平台安全」=纯 node fs/常量 API，「✖ POSIX 绑定」=Windows/Linux 断链点：

| 位点 | 现状 | 判读 |
|---|---|---|
| `core/paths.js:70-74` `engineCandidates()` | 非 darwin 返回空数组（env `LZY_ZCODE_ENGINE` 整体替换除外） | ✖ macOS 外引擎定位全空——doctor platform 行 warn 的根因；多平台候选表是实现棒核心改动点 |
| `core/paths.js:22` `cliRoot()` | `join(homedir(), ".zcode", "cli")` | ✔ homedir 跨平台；Windows 实测解析正常（§3 doctor 输出） |
| `core/engine.js:41-63` | 引擎 spawn 全部 `spawnSync(process.execPath, [enginePath, …], {shell:false})` | ✔ 无 shell、无 PATH 依赖——三平台安全形态，跨平台无需改动 |
| `core/installer.js:49-54` | `cpSync/mkdirSync/writeFileSync(mode 0o600)/renameSync` | ✔ 纯 fs API；`mode 0o600` 为 POSIX 语义（Windows 忽略，权限面记一句即可） |
| `core/doctor.js:102` hook-node 检查 | `spawnSync("/bin/sh", [launcher, "--print-node"], …)` | ✖ 检查器自身硬编码 `/bin/sh`——Windows 上检查必败（§3 Windows doctor ✖ hook-node 直接归因）；Linux 正常（§3 Ubuntu ✔） |
| `plugin/hooks/hooks.json` 五处 | `/bin/sh "${ZCODE_PLUGIN_ROOT}/hooks/run-hook.sh" <script>` | ✖ 运行时主断链：Windows 由 cmd.exe 解释（§1.2），`/bin/sh` 不存在→每触发必败 |
| `plugin/hooks/run-hook.sh:31-33` | 失败日志硬编码 `/tmp/lzy-hook-launcher.log`；nvm/homebrew 回退链 | ✖ 整体 POSIX 绑定（Windows 需对偶 `.cmd` 启动器；日志路径随平台） |
| `package.json:46` test script | `node --test "test/**/*.test.js"`（glob 交 node 自解析） | ⚠ Windows glob/路径分隔符语义需 CI 实证（实现棒 CI matrix 腿的第一雷区，`test-runner-glob` 记忆在案） |
| `.github/workflows/ci.yml:17` | `TZ: Asia/Shanghai` env 钉 | ✔ env 形态跨平台可用（scheduleAdvisory 断言依赖） |
| 测试引擎探测抑制 | `LZY_ZCODE_ENGINE` 抑制值散布 2 个测试文件 | ✔ env 形态跨平台可用 |

盘点结论：**lzy 自身（安装器/引擎调用/诊断）跨平台基础良好**——真正的断链只有三处：引擎候选表（paths.js）、钩子启动器（hooks.json+run-hook.sh+doctor hook-node 检查）、CI 腿缺席。前者是数据表扩展，中者是设计稿 §1 的主题，后者是发布机械件。


## 5. 口径声明

- 本底稿只陈述事实与证据；方案对比、成本分层与推荐见 `docs/design-crossplatform.md`。
- 「支持 3 平台」的验收语义（三 VM 实证 + CI matrix 全硬）与拍板记录见 `docs/adr/0011-crossplatform-support-in-006.md`。
