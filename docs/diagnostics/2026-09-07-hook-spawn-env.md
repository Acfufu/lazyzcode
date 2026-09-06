# 诊断记录：引擎钩子 spawn 环境与 ZCode shell PATH（2026-09-07）

- 触发：用户由「ZCode Bash 工具里 `lzy`/`node` 均不在 PATH」的观察出发，要求排查；延伸 concern——
  hooks.json 若裸 `node` 调用，引擎 spawn 钩子的 env 一旦无 node，四钩子是否静默全灭。
- 结论先行：**concern 成立（分支 A 实锤）**。引擎以自身 env 直接 spawn 钩子命令；该 env 的 PATH
  随 ZCode.app 启动方式而变，GUI 直启场景无 nvm/node → 裸 `node` ENOENT → 四钩子静默全灭，
  且失败在引擎侧，钩子 JS 内的 fail-open 无从触发。已落地启动器加固（见「处置」）。

## 1 · 事实链（全部 file:line / 活体命令输出可复核）

1. **ZCode Bash 工具 PATH 无 node 的根因是「shell 快照」硬编码**，不是 zsh rc 链问题：
   - nvm 初始化在 `~/.zshenv:4-8`（全部 zsh 含非交互都 source），实测 `zsh -c 'echo $PATH'` 首项即 nvm bin；
   - 但 Bash 工具实跑 `/bin/zsh -c . '<snapshot>.sh'`，快照**最后一行**硬编码
     `export PATH='/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:…ZCode tools'`，
     把 nvm bin 与 `~/.local/bin` 全部抹掉；
   - 该 9 项 PATH 无 `/System/Cryptexes/App/usr/bin`（`/etc/paths` 必含项）→ **不是 login shell
     path_helper 的产物** → 快照 PATH 即引擎进程 env PATH 的写照 → **引擎 env 无 nvm/node**。
2. **`lzy` 不在 PATH 的直接原因是从未全局安装**：各 nvm 版本 `lib/node_modules` 无 lazyzcode，
   `/usr/local/bin`、`/opt/homebrew/bin`、全局 bin 目录均无 lzy shim；`package.json` bin 字段具备
   条件但未执行过 `npm i -g`。与 PATH 断链是两个独立问题。
3. **钩子命令裸 `node`**：hooks.json（修复前）四条命令均为
   `node "${ZCODE_PLUGIN_ROOT}/hooks/<script>"`；引擎 `shell:!0` 计数为 0（zcode.cjs grep 实锤），
   命令按 argv 解析后以引擎自身 env 直接 spawn（env 合并 `ZCODE_PLUGIN_ROOT` 等，源码 :1786/:2551）。
4. **本会话活体信号（2026-09-07，GUI 直启场景）**：
   - 首条用户消息含 `zw` 触发词，但未见 UserPromptSubmit 注入（该通道 2026-09-06 MVP 活体验收过可达）；
   - 探针实验：向缓存 hooks.json 追加两条 PostToolUse 探针（裸 node / 绝对路径 node）后 Write 触发，
     产物 `/tmp/lzy-zw-probe.jsonl` **未产生**（引擎在会话启动时缓存钩子配置，中途改 hooks.json 本会话不可见，
     故本探针无法在本会话直触钩子；归档：`.lazyzcode/evidence/probe.jsonl`）；
   - 含 TODO 的 Write 触发后亦无 comment-checker 注入（辅助信号；PostToolUse 注入可达性本就只有
     代码级证据）。
5. **2026-09-06 MVP 验收时钩子能跑**（Stop 拉回 1/2→2/2 活体）→ 当时 ZCode.app 是从带 nvm PATH 的
   终端环境启动。**引擎 env 随启动方式而变**由此两日对照成立。

## 2 · 处置（分支 A 落地）

- `plugin/hooks/run-hook.sh`：`/bin/sh` 直启（/bin/sh 恒在）；`command -v node` 优先，
  fallback 扫 `$HOME/.nvm/versions/node/*/bin/node`（取最高）→ `/opt/homebrew/bin/node` →
  `/usr/local/bin/node`；彻底落空记一行 `/tmp/lzy-hook-launcher.log` 后 exit 0 放行（fail-open 纪律不破）。
- hooks.json 四条命令改走启动器；`lzy doctor` 增 `hook-node` 检查（启动器解析失败=fail、
  仅靠 fallback=warn、PATH 直解=ok）。
- 活体复验路径：重开 ZCode 会话（新会话装载新 hooks.json）→ `lzy doctor` 看 hook-node 行；
  GUI 直启下 SessionStart/触发词应恢复工作。

## 3 · 用户环境建议（非产品缺陷部分）

- Bash 工具 PATH 受快照硬编码限制属宿主行为，本项目不修改宿主；`node …/cli/lzy.js` 直调形态
  不受影响（本文档所有 lzy 命令即此形态）。
- 要 `lzy` 进 PATH：`npm i -g lazyzcode`（发布后）——npm 全局 bin 若在 nvm 下，建议顺手
  软链进 `/usr/local/bin`（`ln -s "$(npm prefix -g)/bin/lzy" /usr/local/bin/lzy` 或等价方式），
  因为快照 PATH 不含 nvm bin。
- 用户侧即刻缓解钩子问题：从终端启动 ZCode.app（继承完整 env），或把 node 软链进
  `/usr/local/bin`。

## 4 · 勘误附注（同日另一会话的引擎日志审计，证据更强）

平行会话（sess_1dfc6a1c）从引擎 CLI 日志独立实锤了同一根因，且证据更硬：

- 引擎 cli 日志自 **2026-09-05T19:35Z** 起累计 **895+ 次 `hook.run.failed`**（lazyzcode 511 +
  mimosa 384），exit 127（`node: command not found`）、约 5ms 瞬败，横跨 20+ 会话与引擎重启；
- 钩子命令执行形态为 `mode:"shell"` → `/bin/sh -c "node …"`，子进程继承 GUI 最小 PATH，
  nvm 不在其中 → **zw 四钩子在真实会话从未执行成功**（fail-open 把这件事掩盖了）；
- 由此修正本文 §1.5 的措辞：不是「09-06 验收当天恰好从终端启动所以能跑」，而是 MVP 验收的
  触发词「活体」实为**手动 `[$zw]` 技能调用**（非钩子注入）、契约测试系直接 node 拉起（绕过引擎）；
  09-06/09-07 两日对照应理解为「终端启动的会话钩子可用、GUI 启动的会话全灭」的混合呈现。
- 处置不变：`run-hook.sh` 启动器即该会话提议的 launch.sh 方案的落地实现；活体复验口径升级为
  「重开会话后 zw 触发词注入恢复 + 引擎日志不再刷 hook.run.failed + `lzy doctor` hook-node 行」。

