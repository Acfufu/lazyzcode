<div align="center">

  <img src="docs/assets/logo.svg" alt="LazyZCode" width="120">

  <h1>LazyZCode</h1>

  <p><strong>ZCode 的纪律层。</strong><br />
  计划 → 执行 → 拿证据 → 不做完不停。</p>

  <p>
    <a href="docs/guide/zh.md">文档</a>
    ·
    <a href="#-安装10-分钟">安装</a>
    ·
    <a href="#-cli-命令">命令</a>
    ·
    <a href="#-这是什么">这是什么</a>
  </p>

  <p><a href="README.md">English</a> · 简体中文</p>

  <br />
</div>

> [!NOTE]
> **ZCode 本来就会写代码，LazyZCode 让它把活干完。**
>
> 编码代理擅长开工，也擅长「乐观宣布完工」。解法不是再写一段提示词，而是上一个循环：
> 决策完备的计划门、绑定 git tree hash 的真实表面取证、以及一个把提前停手的代理拉回来的
> Stop 钩子——直到目标可验证地完成。
>
> 同一门纪律，三个节拍：
> **做完**你开的头——带计划门与证据门的目标循环。
> **记住**你建过的东西——分层 `AGENTS.md` 项目记忆。
> **接着走**你不在场的时间——定时唤起只继续已开目标，天然错峰。
>
> ```bash
> npm i -g lazyzcode && lzy install
> ```

## 🚀 安装（10 分钟）

前置：macOS / Windows / Linux、ZCode 桌面端（已登录）、Node ≥ 22、git（证据绑定
tree hash，必需）。三平台引擎布局均已适配探测（macOS 应用包、Linux deb
`/opt/ZCode`、Windows 每用户 `%LOCALAPPDATA%\Programs\ZCode`）。

```bash
npm i -g lazyzcode   # 获得 lzy 命令与插件载荷
lzy install          # 落位引擎缓存 + 注册表 + 启用
lzy doctor           # 本地自检（零遥测）
```

`lzy install` 永不改写你的 `config.json`——启用只走引擎官方 `plugins enable`
（[ADR-0001](docs/adr/0001-installer-enable-via-engine-cli.md)）。

偏好插件市场？在 ZCode 的 `/plugin` 面板里执行
`/plugin marketplace add Acfufu/lazyzcode`，再从中安装 **lazyzcode**——与官方
市场同一条引擎代码路径，ref 钉发布 tag。市场路只装插件层（技能/钩子/代理）；
`lzy` CLI 仍来自 npm，因此 `npm i -g lazyzcode` 仍是推荐的完整安装。

### 开跑第一个目标循环

在任意项目目录新开一个 ZCode 会话，第一条消息输入：

```
zw 帮我实现 <你的目标>
```

`zw` 触发词注入完整编排协议：模型注册目标 → 写决策完备计划（HEAVY 目标强制过
plan-reviewer 评审门，并显性申报已知未知、每条带证伪途径；步骤自带指针、可为
不在场的接管者独立执行）→ 逐步执行 → 对每个终验项在真实表面取证（绑定
`git rev-parse HEAD^{tree}`）→ finish 前逐项做证据对照、`lzy loop finish`
通过才算完成。中途停手会被 Stop 钩子拉回（每会话至多 2 次续跑）。

### 验证装好了

```bash
lzy status           # 快速体检；退出码 0 = 无 fail 级检查
lzy doctor           # 深度本地诊断，全程离线
```

### 之后的路

第一个目标循环是整个产品的缩影。它身后还有两个节拍：

1. **记住你建过的东西。** 在成熟项目里跑 `lazyzcode:init-deep` 技能，草拟分层
   `AGENTS.md` 项目地图——草稿先行，你点头才写盘。`lzy agents-md` 审计覆盖
   缺口；`lzy doctor` 的 `agents-md` 行巡逻采纳情况（warn-only）。
2. **接着走你不在场的时间。** 在引擎自带自动化里挂一个唤起，prompt 写
   `zw 继续（无人值守：…）`。无人值守会话只继续已开目标——绝不自立新目标——
   `lzy doctor` 的 `schedule` 行从你的实测限流时段反推错峰窗口，再对照平台计价
   高峰表（UTC+8、人工维护）标注重叠并给出计价安全窗。

脚手架的力量有外部佐证：Anthropic 报告其模型在 Prove2Me 脚手架上用 11 天
形式化了费马大定理，而 3 个消费级订阅 3 天即证 Vinogradov 三素数定理——
放大产出的不是模型本身，是那份对的外架。lazyzcode 是同一思路在软件工程里
的样子。

### 卸载

```bash
lzy uninstall        # 优先走引擎官方 plugins uninstall
```

## ⚡ CLI 命令

| 命令 | 用法 | 作用 |
| --- | --- | --- |
| `install` | `lzy install` | 插件载荷落位引擎缓存 + 注册表 + 启用（只走官方路径；`config.json` 零写入） |
| `sync` | `lzy sync [--watch]` | 改完代码热重载载荷；`--watch` 持续监听 |
| `status` | `lzy status` | 快速体检；退出码 0 = 无 fail 级检查（warn/skip 不影响） |
| `doctor` | `lzy doctor` | 全量诊断——见下 |
| 目标循环 | `lzy loop register <slug> --title "…"` → `lzy loop plan <计划.md>` → `lzy loop start` → `lzy step done <ID> --evidence …` → `lzy loop finish` | 状态机：注册 → 计划门 → 执行 → 证据 → 终验门 |
| 步级认领 | `lzy loop claim [<id>] [--release]` | 同目标多工人的匿名步级认领：48h 互斥、按计划 `deps:` 依赖边做阻塞校验、`step done` 自动释放；无参列可认领集 |
| 证据包 | `lzy loop export` | 重导出证据包（`<slug>.report.md`）；`finish` 时亦自动归档 |
| 交接 | `lzy loop handoff --snapshot <文件>` | 登记干净交接——下个 Stop 放行一次，不消耗续跑预算 |
| 跨仓清单 | `lzy loop list [--root <目录>]` | 只读扫同级仓的目标循环（状态/进度/认领/新鲜度/存根）；匿名放行计数跨 reset 永续 |
| 目标谱系 | `lzy loop history` | 只读并集证据包 ∪ salvage 存根 ∪ git 尾注——每个历史目标的状态、提交数与最近活动 |
| 积分报表 | `lzy loop cost` | 引擎本地计费账本折积分（常设系数+带日期促销 overlay；目标归因简化 OR+人工复核行；只读） |
| `agents-md` | `lzy agents-md` | 项目记忆审计：够格目录与覆盖缺口 |
| `uninstall` | `lzy uninstall` | 删除已部署缓存与注册表条目 |

### `lzy doctor` 都查什么

引擎与安装状态、启用标志、钩子语法自检（worker 内 vm 解析，含 `hooks.json`
注册校验）、node 版本下限、`hook-node` 解析（启动器的 node 回退链——POSIX
nvm/homebrew、Windows nvm-windows/Program Files，专治 GUI 直启场景）、`lzy`
PATH shim、`.lazyzcode/` 状态卫生、平台提示、GLM
套餐限流压力（近 2 日引擎日志只读扫描：去重后的 429 回合、判死回合、最长连撞、
经验并发带——warn-only，不翻退出码）、传输死亡回合独立分族计数（`transport`：
请求未达服务端类故障如 ENETDOWN，绝不进并发带数学）、内容审核杀流独立分族计数
（`content`：provider 内容审核中途杀流如 1301——原地重试必复现，绝不进并发带数学）、
按 provider 分桶带行（`band-by-provider`：完成侧净桶×429 脏桶，窗内有 429 且
≥2 provider 才出行——自身无 429 的行如实标注「无脏面样本」）与模型档位建议行（`cost`：零限流窗+低滚动水位建议常规目标试轻量档——
纯建议文本，不进谓词数学）、项目记忆采纳审计
（`agents-md`，warn-only，含地图落后提示：基点后覆盖域 ≥50 提交即提醒重跑
init-deep）、进行中目标的认领巡逻（`claims`：谁认领了它、
stuck 停拉标记、零认领孤儿提示——warn-only），
提交账本覆盖率（`ledger`：goal 起点后缺 `Goal:` 尾注的提交——warn-only）、水位行（`waterline`：
近 5h 滚动积分对比自参照警戒线，sqlite3 缺席时如实报降级原因）与本仓 unbound wake 的
空转巡逻（`orphan-wake`，无挂载即 skip），以及
无人值守的错峰窗口建议（`schedule`，实测集中段反推并对照声明式计价高峰表核对
重叠——数据沉默时 skip，绝不拍脑袋）。全程本地、零遥测、
零新增配置面。

## 使用内置工作流

LazyZCode 该按它实际装了什么来评价：一个插件——两个技能（`zw`、`init-deep`）、
五个钩子、三只只读代理——和一个 `lzy` CLI。

### 1. 触发词注入编排协议

| 触发词 | 触发位置 |
| --- | --- |
| `zw` | 仅句首 |
| `lazyzcode:zw` | 任意位置；全角冒号 `：` 亦可 |
| `ulw` / `ultrawork` | 任意位置，词边界 |

注入是条件的：发起则进入编排，仅提及（「`zw` 触发词是怎么实现的？」）则静默、
直接回答问题本身。

### 2. 目标循环是主干

- **计划门。** 计划是 N/F 清单（`- [N1] …` 实现项、`- [F1] …` 终验项）。待定项
  （TBD）直接拒绝，计划必须决策完备；HEAVY 目标还要过 plan-reviewer：判决
  `REVISE` 拒绝采纳，`--force` 不越过。
- **证据门。** 每个 F 项都要真实表面证据（CLI stdout、HTTP 返回、截图），绑定
  `git rev-parse HEAD^{tree}`——先提交再取证。代码一变证据即过期，`finish`
  拦下过期证据，要求在当前代码上重新取证。
- **有界的续跑。** 循环开着时，Stop 钩子每会话至多请求 2 次续跑——引擎的 3 次
  共享池给后台任务通知预留 1 次。计数按 sessionId 隔离；钩子任何异常一律
  fail-open，绝不劫持无关会话。

循环状态在 `.lazyzcode/`（`loop/goal.json`、`plans/`），与宿主 `.zcode/` 划清
边界。已完成的循环用 `lzy loop reset` 腾位。

### 3. 纪律角色骑在 ZCode 原生子代理上

三只只读角色随插件 `agents/` 目录分发，引擎自动发现：

| 角色 | 用途 |
| --- | --- |
| `lazyzcode:explorer` | 计划前侦察；大仓库可走 codegraph 索引 |
| `lazyzcode:plan-reviewer` | 计划评审门（决策完备性、隐藏风险、F 项真实表面） |
| `lazyzcode:qa-executor` | 真实表面取证；Web 面可用 ego-browser/curl |

用 Agent 工具以角色作 `subagent_type` 派发——子代理只读、按固定输出契约干活：

```jsonc
Agent({ "subagent_type": "lazyzcode:explorer", "prompt": "TASK: 梳理 auth 流程全链路。" })
```

### 4. 轻提示钩子，不是唠叨

`comment-checker` 盯着 Edit/Write 落盘内容里的 `TODO`/`FIXME`/`XXX`/`HACK`
标记与调试残留（`console.log`、`console.debug`、`debugger`），经 `additionalContext` 轻提示——
只提示不阻断、每次事件至多 5 处、且只在有开放目标循环的工作区生效。
SessionStart 重注入循环现状，新会话接着上次干。

### 5. 项目记忆喂给计划门

`lazyzcode:init-deep` 草拟仓库的分层 `AGENTS.md` 地图（根 + 够格子目录）。
写盘前必经你点头；已有文件只给补丁建议；密钥与本机路径不碰。ZCode 原生读取
`AGENTS.md`，地图免费搭进此后每个会话——HEAVY 规划在花计划门之前先看它。
`lzy agents-md` 列出够格目录与覆盖缺口。

### 6. 无人值守，在轨道上

引擎自带自动化可以定时唤起新会话，prompt 写 `zw 继续（无人值守：…）`。唤起
协议是只继续：绝不注册新目标、绝不采纳计划——决策完备门永远留给人。约束来自
续跑预算、429 判死、串行子代理、≥1 小时间隔；`lzy doctor` 的 `schedule` 行从
实测限流集中时段反推错峰窗口，并对照声明式计价高峰表核对重叠。

### 排障速查

- **`[1302] 速率限制`（GLM 套餐）：** 账号级并发限流。`lzy doctor` 的
  `rate-limit` 行给出实测压力与经验边界；目标循环一次只跑一个、并行主会话宜少；
  被 429 判死后等数分钟再 `zw 继续`——状态在 `.lazyzcode/` 不丢。
- **钩子全无反应：** 十有八九是引擎钩子环境里没有 `node`（从 Dock 直启
  ZCode.app 的常见场景）。`lzy doctor` 的 `hook-node` 行给判定；插件自带
  `run-hook` 启动器自动兜底（POSIX 走 nvm/homebrew；Windows 经 `run-hook.cmd`
  孪生走 nvm-windows/Program Files）。详见
  [docs/diagnostics/2026-09-07-hook-spawn-env.md](docs/diagnostics/2026-09-07-hook-spawn-env.md)。
- **`lzy: command not found`：** 全局安装（`npm i -g lazyzcode`），或
  `node <仓库>/cli/lzy.js …` 直调。

## 💤 这是什么

**LazyZCode** 把 [lazycodex](https://github.com/code-yeongyu/lazycodex) 的
纪律层工作流打包成 ZCode 原生插件 + 轻量 CLI。

相当于 [LazyVim](https://github.com/LazyVim/LazyVim) 之于
[lazy.nvim](https://github.com/folke/lazy.nvim)——只是换成了 ZCode。

骨架是纪律：计划门、证据绑定的完成、有界续跑预算。ZCode 本来就带
skills/hooks/agents 机器，LazyZCode 是让它们把活干完的那层工作流。

## 🧩 你会得到什么

| 特性 | 说明 |
| --- | --- |
| 🎯 **目标循环** | 注册 → 计划 → 执行 → 验证的 CLI 状态机，会话重启不丢状态 |
| 🚧 **计划门** | 只收决策完备的计划；TBD 拒绝；HEAVY 计划强制过评审门（`REVISE` 拒绝采纳） |
| 🔬 **证据纪律** | F 项证据绑 git tree hash；过期证据过不了 `finish` |
| 📦 **证据包** | `--evidence-file` 附件（哈希绑定的副本）与 `lzy loop export`——`finish` 自动归档 `<slug>.report.md` |
| 🗂️ **项目记忆** | `init-deep` 草拟分层 `AGENTS.md` 地图；人点头才写盘，`lzy agents-md` 审计缺口 |
| 🌙 **无人值守** | 定时唤起只继续已开目标、绝不立新目标；错峰窗口来自 `lzy doctor schedule`（限流实测 ∩ 计价高峰对照） |
| 🪝 **有界续跑** | Stop 钩子把代理拉回来，每会话至多 2 次，与后台通知公平分享预算 |
| ⌨️ **触发词** | `zw` / `lazyzcode:zw` / `ulw` / `ultrawork`，分层匹配，提及 ≠ 发起 |
| 🕵️ **只读代理** | explorer / plan-reviewer / qa-executor，引擎自动发现 |
| 💬 **comment-checker** | TODO/调试残留轻提示；不阻断 |
| 🩺 **`lzy doctor`** | 离线体检，含 hook-node 解析与限流压力 |
| 🔒 **隐私与红线** | 零遥测；`lzy` 永不改写你的 `config.json` |

## 🆚 只有 LazyZCode 做到的十件事

截至 2026 年 9 月，ZCode 官方市场 19 个插件里没有一个纪律层——所以这里不放
竞品对照表，只说清两件事：只有 LazyZCode 提供的能力，和我们唯一还没建的能力。

| # | 只有这里 | 一句话 |
| --- | --- | --- |
| 1 | **tree-hash 证据绑定** | F 项证据绑 `git rev-parse HEAD^{tree}`——代码一变，旧证据按构造即过期 |
| 2 | **引擎内 Stop 拉回** | 把懒停的活拉回来：每会话至多 2 次续跑，引擎 3 次共享池给后台通知预留 1 次 |
| 3 | **交接放行** | 七字段交接快照让代理干净收尾——下个 Stop 放行一次，不消耗续跑预算 |
| 4 | **认领制多会话隔离** | 拉回只作用于认领了目标的会话，同仓旁路会话绝不被劫持；步级认领协调多工人并行 |
| 5 | **限流实测分诊** | `lzy doctor` 只读扫你自己的引擎日志：去重 429 回合、经验并发带、对照计价高峰表的错峰窗口 |
| 6 | **失败分族，拒绝 unknown** | 传输死亡（请求未达服务端）与内容审核杀流（流中掐断、原地重试必复现）分族计数，绝不进并发数学 |
| 7 | **已知未知，强制申报** | HEAVY 计划必须申报 1–3 条未验证前提、各带证伪途径——写「无」也要一行说明扫过哪里 |
| 8 | **带过期指纹的项目记忆** | `init-deep` 草拟分层 `AGENTS.md` 地图；提交滞后信号提示地图已落后 |
| 9 | **不可强越的评审门** | `REVISE` 判决拒绝采纳计划，`--force` 不越过 |
| 10 | **零遥测成宪** | 诊断全在本地、零新增配置面、不向任何地方回传 |

**我们唯一承认的差距：** 自我演化循环（工作流改进它自己的纪律）尚未建设——
按长期项记档，不提前上马。

## 🧠 为什么「完成」需要证据

别惊讶 LazyZCode 拒绝庆祝。计划里的勾是主张，真实表面证据才是事实。所以 F 项
必须先指名取证的表面（某条 CLI 的 stdout、某个 HTTP 返回、一张截图）；所以证据
要绑 `git rev-parse HEAD^{tree}`（提交的内容快照——代码一变，旧证据按构造即
过期）；所以 `lzy loop finish` 重查新鲜度，而不是相信一段总结。测试全绿不是
证据；一次测试运行只是众多表面中的一个。

同样的哲学也定了续跑预算。ZCode 给每会话 3 次 stop-continuation，且与后台任务
通知共享；LazyZCode 的 Stop 钩子每会话至多花 2 次，任何异常 fail-open——循环
是把懒停的活拉回来，不是把会话困住。

## 🏗️ 架构

LazyZCode = 一个插件（纪律层）+ 一个 CLI（循环状态机）。零 npm 依赖、
Node ≥ 22、纯 ESM。

```
lazyzcode/
├── plugin/   → lazyzcode 插件：skills/zw + skills/init-deep、hooks/（5 个，经 run-hook 启动器）、agents/（3 只）
├── core/     → 共享逻辑：loop、installer、doctor、ratelimit、agentsmd、engine、git、paths、status
├── cli/      → lzy 入口（cli/lzy.js）+ 语法检查 worker
├── test/     → 契约测试（node:test 零依赖）+ GitHub Actions（node 22/24）
└── docs/     → 调研底稿、ADR、五轮评审、诊断记录
```

设计准绳：**Skill > MCP > Tool > Hook。** 离线了也无所谓的放技能文本，钩子是
最后手段。安装器只装插件——启用走引擎官方 `plugins enable`，你的 `config.json`
永远不被碰。

### 已知限制

- 平台支持（ADR-0011）：macOS / Windows / Linux 三平台支持；三平台引擎布局均已
  实测，分发矩阵按 arm64 实证（Windows 11 / Ubuntu ARM 虚拟机活体）——x64 覆盖
  以官方下载矩阵文档声明。
- headless（`--prompt`）驱动引擎需要桌面端注入的模型凭据；机制已由探针验证，
  活体 headless 验收顺延。

## 📄 License

MIT——见 [LICENSE](LICENSE)。

命名与工作流受 [lazycodex](https://github.com/code-yeongyu/lazycodex)（MIT）
启发；结构与安装器模式在其许可证范围内借用并注明出处。
[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)（OmO）为
SUL-1.0：只学思想，不搬代码与文本。
