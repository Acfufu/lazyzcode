# 跨平台支持设计稿（全安装链 · 0.0.6）

> 目标 `crossplatform-recon` 产物 · 2026-09-15 · 事实依据全部引自 `docs/research-crossplatform.md`（下称「底稿 §n」）；拍板记录见 `docs/adr/0011-crossplatform-support-in-006.md`。
> 结论先行：**推荐方案 C′（无扩展名对偶启动器）+ 引擎候选表数据扩展 + doctor 行平台感知**——零 schema 改动、macOS 行为不变、Windows/Linux 断链全接；实现量集中在启动器孪生与 CI 腿。

## 1. 钩子启动器（主断链）

**约束**（底稿 §1.1）：钩子 schema 两分支均 `.strict()` 且**无平台条件字段**——一份 hooks.json 无法声明式按平台分支；`command` 型的 `shell` 字段未设时 POSIX 走 `/bin/sh -c`、win32 走 `ComSpec ?? cmd.exe`（§1.2）。

| 方案 | 形态 | 判决 | 成本 |
|---|---|---|---|
| A 每平台清单分支 | hooks.json 加 per-OS 字段 | **否决**——被引擎 schema 否决（strict 拒未知字段），且引擎不可改 | — |
| B `type:"process"` 直启 | `{"command":"node","args":["${ZCODE_PLUGIN_ROOT}/hooks/<s>.js"]}` | 可行但险：放弃 shell 层 node 兜底，macOS GUI 启动 PATH 无 node 即全灭（2026-09-07 事故形态回归）；Windows/Linux 现 VM 事实成立但非全用户保证 | 低（改动小）/风险中 |
| **C′ 对偶启动器（推荐）** | command 改 `"${ZCODE_PLUGIN_ROOT}/hooks/run-hook" <script.js>`（去 `/bin/sh` 前缀）；`run-hook`（无扩展名 POSIX sh，现 run-hook.sh 内容）+ `run-hook.cmd`（Windows 批处理孪生） | POSIX：shell:true 经 sh 执行 `run-hook`（exec 位+shebang）；Windows：cmd.exe **PATHEXT 自动解析 `.cmd` 孪生**（§3.3 探针实证，引号两形态皆通）；一行清单双平台、schema 不动、macOS 语义不变 | 中 |
| D 双注册 | 同事件挂 sh/cmd 两条 command | **否决**——每次触发一条必败，`hook.run.failed` 噪音污染诊断面（895+ 条全灭事故的读面教训） | — |

**C′ 细节**：
- `run-hook.cmd` 的 node 解析链（对齐 run-hook.sh 家法）：`where node` → `%APPDATA%\nvm\*\node.exe` → `C:\Program Files\nodejs\node.exe` → 全落空记日志后 `exit 0` 放行（fail-open 契约不变）；日志文件随平台（`%TEMP%\lzy-hook-launcher.log`）。
- `run-hook.sh` 保留一个过渡期：doctor 的 hook-node 检查（`core/doctor.js:102` 硬编码 `/bin/sh`）与既有测试引用它——实现棒同步切到 `run-hook` 后再退役，避免双改面耦合。
- `npm pack` 的 exec 位保留需在实现棒活体验证（tar 权限位理论保留，未实证不入正表）。
- 残余风险：cmd.exe 的引号/参数展开边角（如路径含空格与 `%`）需 VM 活体验收——已在 §4 验收映射钉住。

## 2. lzy 安装器路径面

- **引擎候选表**（`core/paths.js:70-74`，底稿 §4 ✖ #1）：纯数据表扩展——darwin 保持现值；linux 增 `/opt/ZCode/resources/glm/zcode.cjs`（deb 布局实测，底稿 §3.2）；win32 增 electron 惯例候选序列（`%LOCALAPPDATA%\Programs\zcode\…` 一类，**装后实测才入正表**）；`LZY_ZCODE_ENGINE` env 整体替换语义三平台不变。成本：低。
- **安装器与引擎调用链**：零改动——`core/engine.js` 全部 `spawnSync(process.execPath, …, {shell:false})`、`core/installer.js` 纯 fs API，三平台安全形态（底稿 §4 ✔ 行）；`mode 0o600` 在 Windows 被忽略，文档记一句即可。
- **npm 分发**：双平台试装已实证（底稿 §3.2 矩阵），shim 形态差异（`lzy.cmd`）已被 doctor `lzy-path` 行覆盖，零改动。
- **doctor hook-node 检查**（`core/doctor.js:102`）：随 C′ 平台感知——win32 直接探测 `run-hook.cmd --print-node` 或 `where node`，POSIX 走新 `run-hook`。成本：低。

## 3. doctor platform 行升级方案

现状（`core/doctor.js:377-382`）：非 darwin 一律 warn「macOS-only 立场」。升级：按平台报告 `engineCandidates()` 命中态——命中=ok+引擎路径；全空=warn「引擎未找到（桌面端未装？）」；「macOS-only」措辞退役。原拍板「doctor platform 行立场不动」随 ADR-0011 一并修订。成本：低。

## 4. 实现棒切分与验收映射（0.0.6 硬验收=三 VM 实证+CI matrix 全硬，ADR-0011）

1. **launcher C′**：hooks.json + `run-hook`/`run-hook.cmd` + doctor hook-node 平台感知 + 测试（含 npm pack exec 位、cmd 引号边角的 VM 活体）。
2. **候选表+platform 行**：paths.js 数据表 + doctor platform 升级 + guide/README 措辞（含 x64 文档声明口径）。
3. **三 VM 活体**：三平台安装→钩子真实触发（引擎注册 hooks:5 面读数）→`lzy loop` 全链走通；Windows 桌面端落位实测补 §3.2 空格。
4. **CI matrix**：先治测试雷（node --test Windows glob 语义、路径分隔符断言、TZ 钉已 ✔）再开 windows-latest/ubuntu-latest 腿。
5. **发布机械件**：§⑦ 第 7 项流程照抄，平台支持声明入 release notes。

## 5. 与 ADR-0011 的互指

本稿给「怎么做」；ADR-0011 记「为何 0.0.6 做、验收线与 arm64 边界」。实现拍板（0.0.7+ 免除条款、x64 实测与否）若推翻本稿推荐，以新 ADR 为准。
