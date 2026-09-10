# LazyZCode 文档

[English](en.md) · **简体中文**

ZCode 纪律层的完整指南：计划 → 执行 → 拿证据 → 不做完不停。

| | |
| --- | --- |
| **安装** | [安装](#安装) · [推荐环境](#推荐环境) |
| **上手** | [概览](#概览) · [第一个目标循环](#第一个目标循环) · [常见问题](#常见问题) |
| **触发与协议** | [触发词](#触发词) · [zw 协议](#zw-协议) · [目标循环命令](#目标循环命令) |
| **概念** | [计划门](#计划门) · [证据纪律](#证据纪律) · [续跑预算](#续跑预算) · [纪律角色](#纪律角色) · [钩子与生命周期](#钩子与生命周期) · [限流纪律](#限流纪律) |
| **参考** | [CLI 参考](#cli-参考) · [诊断](#诊断) · [状态与配置](#状态与配置) · [兼容性与限制](#兼容性与限制) |

---

## 安装

一个包装好 LazyZCode 的两半：`lazyzcode:zw` 插件（技能/钩子/角色）和 `lzy`
CLI（目标循环状态机）。

### 前置条件

- **macOS** —— LazyZCode 目前只做 macOS 的引擎布局探测；其他平台明确报
  「未找到」，绝不盲猜。
- **ZCode 桌面端**，已安装并登录。LazyZCode 跑在 ZCode *里面*，没有单独的登录。
- **Node.js ≥ 20** —— 任意在维护的 LTS。nvm 或 Homebrew 装的都行：当引擎的钩子
  环境里没有 `node` 时，插件自带的启动器会扫这两个位置（见
  [钩子与生命周期](#钩子与生命周期)）。
- **git** —— 证据绑定用 `git rev-parse HEAD^{tree}`，干活的项目必须是 git 仓库。

### 安装

```bash
npm i -g lazyzcode
lzy install
```

`lzy install` 做三件事：插件载荷落位引擎插件缓存、写入 LazyZCode 自己的注册表
条目、经引擎官方 `plugins enable` 启用插件。它**永不改写你的 `config.json`**
——启用只走引擎自己的 CLI（[ADR-0001](../adr/0001-installer-enable-via-engine-cli.md)）。

### 验证装好了

```bash
lzy status   # 快速体检；退出码 0 = 无 fail 级检查
lzy doctor   # 深度本地诊断（零遥测）
```

新开一个 ZCode 会话，在提示词开头输入 `zw`——编排引导应当到达，模型首行应显示
`**ZW** engaged — LIGHT tier`（或 HEAVY）。

### 卸载

```bash
lzy uninstall
```

删除已部署缓存与注册表条目，优先走引擎官方 `plugins uninstall` 路径。

## 推荐环境

| 项 | 建议 | 说明 |
| --- | --- | --- |
| 操作系统 | **macOS** | 当下唯一做了引擎布局探测的平台。 |
| ZCode | 桌面端，已登录 | 钩子与插件都经桌面端引擎装载。 |
| Node.js | ≥ 20，nvm 或 Homebrew | `lzy doctor` 的 `hook-node` 检查会告诉你钩子实际走哪条解析路径。 |
| 项目 | git 仓库 | 证据绑定要求存在提交；F 项证据在提交**之后**取证。 |
| 启动方式 | 均可 | 终端启动或 Dock 直启都行；Dock 场景由 `run-hook.sh` 启动器兜底。 |

## 概览

LazyZCode 装四样东西：

1. **一个插件**（`lazyzcode:zw`），技能文本承载完整编排协议——triage、tier
   选择、计划、执行、证据规则。
2. **五个钩子**，接在引擎生命周期上：SessionStart（重注入循环状态）、
   UserPromptSubmit（触发词）、PostToolUse（注释轻提示）、PostToolUseFailure
   （同工具失败绊线）、Stop（有界续跑）。
3. **三只只读代理**：`lazyzcode:explorer`、`lazyzcode:plan-reviewer`、
   `lazyzcode:qa-executor`。
4. **一个 CLI**（`lzy`），把目标循环实现为可跨会话存续的状态机：注册 → 计划门
   → 执行 → 证据 → 终验门。

心智模型：计划里的勾是*主张*，真实表面证据才是*事实*。LazyZCode 的职责是让代理
把主张兑换成事实——并在它试图提前停手时把它拉回来。

## 第一个目标循环

在项目目录新开一个 ZCode 会话，输入：

```
zw 实现一个带测试的 CSV 导出接口
```

接下来会发生什么：

1. UserPromptSubmit 钩子命中句首的 `zw`，注入编排引导。
2. 模型宣告 `**ZW** engaged — <tier> tier`，并对任务做 triage（见
   [zw 协议](#zw-协议)）。
3. 用 CLI 注册目标（`lzy loop register …`），把计划文件写进
   `.lazyzcode/plans/`。
4. 计划过计划门采纳——HEAVY 计划必须先过 `lazyzcode:plan-reviewer`。
5. 模型逐步执行，每完成一步调 `lzy step done <ID>`。F 项必须带绑定当前
   tree hash 的 `--evidence`。
6. `lzy loop finish` 跑终验门：全部步骤 done、全部证据新鲜。此时目标才算完成。

循环开着时模型想停手，Stop 钩子会拉回——每会话至多 2 次。中断后（包括被限流
判死）恢复，发一句 `zw 继续` 即可；`.lazyzcode/` 里的循环状态原封不动。

循环完成后腾位，跑 `lzy loop reset`。

## 常见问题

**LazyZCode 的状态放哪？**
项目内的 `.lazyzcode/`（循环状态、计划、归档证据）。有意与 ZCode 自己的
`.zcode/` 划清边界。不想提交就加进 `.gitignore`。

**会偷偷上报数据吗？**
不会。零遥测。`lzy doctor` 报告的一切都从你本地的文件与引擎日志算出来。

**会写我的 `config.json` 吗？**
永不。启用走引擎官方 `plugins enable`；安装器只部署文件、写 LazyZCode 自己的
注册表。

**我的 `zw` 为什么没触发？**
匹配是分层的：裸 `zw` 只在提示词句首触发。句中 `zw` 被忽略（这是特性——
「检查一下 zw 的钩子」是提问不是发起）。任意位置用显式全名 `lazyzcode:zw`，
或 `ulw`/`ultrawork`（词边界）。

**`lzy loop finish` 为什么拒了我的证据？**
证据绑定取证当时所在提交的 tree hash。取证后又改了代码，证据按构造即过期——
先提交，再 `lzy step done <ID> --evidence …` 重新取证。

**撞上 `[1302] 速率限制`，是 LazyZCode 坏了吗？**
不是——那是 GLM 套餐的账号级并发限流。`lzy doctor` 的 `rate-limit` 行给出实测
压力与建议会话预算。见[限流纪律](#限流纪律)。

**钩子全无反应。**
多半是引擎启动时 PATH 里没有 `node`（从 Dock 直启 ZCode.app 的常见场景）。
自带的 `run-hook.sh` 启动器会自动兜底 nvm/Homebrew；`lzy doctor` 的
`hook-node` 行告诉你它解析到了什么。详见
[docs/diagnostics/2026-09-07-hook-spawn-env.md](../diagnostics/2026-09-07-hook-spawn-env.md)。

**能同时跑两个目标循环吗？**
每个项目目录一个循环。已完成的循环会占位，直到 `lzy loop reset` 清掉。

**能只用 CLI 不装插件（或反过来）吗？**
可以。CLI 到哪都能用；插件需要引擎。两者齐用效果最好——钩子和技能文本驱动
纪律，CLI 落实纪律。

## 触发词

| 触发词 | 触发位置 | 示例 |
| --- | --- | --- |
| `zw` | **仅句首**（允许前导空白） | `zw 修一下那个抖动的测试` |
| `lazyzcode:zw` | 任意位置；全角冒号 `：` 亦可 | `讲讲 lazyzcode:zw 是干嘛的`* |
| `ulw` / `ultrawork` | 任意位置，词边界 | `ultrawork 把这个重构做掉` |
| `/zw` 或 Skill 工具 | 显式调用 | — |

\* 这个示例**不会**进入循环——它是*提及*。注入是条件的：发起则进入协议，仅提及
则忽略并直接回答问题（「Mention ≠ invocation」）。`zwift`、`azw`、句中
`zw` 永不触发。

## zw 协议

注入的技能文本（`plugin/skills/zw/SKILL.md`）定义模型遵守的契约：

1. **开场**精确输出 `**ZW** engaged — <LIGHT|HEAVY> tier`。
2. **Triage 定级。** LIGHT 用于小而收敛、低风险的活（1–2 项计划、单 F 项）。
   HEAVY 用于多文件特性、架构、任何有风险或含糊的任务——先侦察再逐步计划。
   LIGHT → HEAVY 随时可升；**永不降级。**
3. 用 CLI **注册**目标。
4. 用 N/F 清单**写计划**（见[计划门](#计划门)）。
5. 逐步**执行**，落提交、调 `lzy step done <ID>` 带注记——F 项带证据。
6. 在真实表面**取证**（见[证据纪律](#证据纪律)）。
7. 过 CLI 终验门**收口**（见[目标循环命令](#目标循环命令)）。

协议还带行为红线（不伪造证据、不无声弃坑）和下面的限流规则。

## 目标循环命令

```
lzy loop register <slug> --title "…"    # 进入 planning
lzy loop plan <文件> [--review "…"] [--force]
lzy loop start                          # 记录基线 tree hash
lzy step done <ID> [--note "…"] [--evidence "…"]
lzy loop status                         # 进度、下一步、证据新鲜度
lzy loop verify                         # 证据时效审计（退出码 1 = 过期/未绑定）
lzy loop finish                         # 终验门
lzy loop handoff --snapshot <文件>       # 登记干净交接；下个 Stop 放行一次
lzy loop list [--root <目录>]           # 只读扫同级仓的目标循环
lzy loop abandon | lzy loop reset       # 放弃 / 清状态
```

- `lzy loop plan` 解析 N/F 清单并拒绝待定（TBD）项。评审判决用
  `--review "plan-reviewer: PASS …"` 传入；HEAVY 目标没有 PASS 评审拒绝采纳，
  `REVISE` 判决即使 `--force` 也不越过。
- `lzy loop start` 冻结基线 tree hash；漂移对照它报告。
- F 项的 `lzy step done` 不带 `--evidence` 会被拒。带新证据重跑即重绑定
  （标记 ↻ 重取证）。
- `lzy loop verify` 是终验门的只审计变体（证据过期/未绑定/无目标时退出码 1）。
- `lzy loop handoff --snapshot <文件>` 登记干净交接：下个 Stop 一次性消费标记并
  放行，不消耗续跑预算（目标保持 executing，状态在盘）。快照须已存在且 24h 内
  有改动——没有真实快照的交接不受理；`lzy loop reset`/`abandon` 会清扫残留标记。
  每次登记与消费会在 `.lazyzcode/loop/metrics.json` 累加匿名计数
  （`registered`/`consumed`，无会话身份）；计数跨 reset 永续，
  在 `lzy status`/`lzy loop status` 可见。
- `lzy loop list` 是只读诊断：扫一级同级目录（默认锚=当前目录的父目录，含自身；
  `--root` 可覆盖），打印各仓的目标 slug、状态、步骤进度、认领、新鲜度与存根。
  单个仓状态文件读不出不炸全局——该行显示「版本不符」。
- `lzy loop abandon` 放弃但留档；`lzy loop reset` 清状态（含会话计数与孤儿
  临时文件），下一个循环才能开。

## 计划门

计划是带两类条目的 markdown 清单：

```markdown
- [N1] 在 src/api/export.ts 实现导出接口
- [N2] 实现 CSV 序列化与引号转义规则
- [F1] `curl localhost:3000/export` 返回 200 且可按 CSV 解析（qa-executor）
```

- **N 项**（实现项）描述工作。
- **F 项**（终验项）指名一个**真实表面**和将在其上取的证据。没有 F 项的计划
  过不了门。
- 计划必须**决策完备**：无 TBD、无「回头再定」。待定项在采纳时即被拒。
  （若计划确实需要这个字面量，行级 `<!--lzy:allow-->` 标记可豁免。）
- HEAVY 目标还要经 `--review` 记录一条 **plan-reviewer PASS**。评审者核查决策
  完备性、隐藏风险、以及每个 F 项是否指名了可取证的表面。`REVISE` 拒绝采纳
  ——`--force` 不越过；只有重新评审能救。

## 已知未知

决策完备指「没有悬而未决的抉择」，不是「没有未验证的前提」。HEAVY 计划因此
以一节显性的**已知未知**收尾：列 1–3 条计划默默依赖的假设，每条带**证伪
途径**——什么信号证明它错、怎么查。写「无」可以，但须一行说明扫过哪里。

这节与计划门互补而非放松：它陈述的是未验证前提，不是推迟的决策——门照样
逐行扫描全节，段内出现真正的 TBD 与任何其他行一样被拒。评审者对照隐藏风险
审它：每条是否可证伪、「无」是否可信？

## 证据纪律

- 证据来自**真实表面**：某条 CLI 的 stdout、某个 HTTP 返回、一张截图——不是
  模型自己的总结，也不只是「测试全绿」（测试运行只是众多表面之一）。
- 证据绑定 `git rev-parse HEAD^{tree}`——当前提交的内容快照。**先提交，再
  取证。** 未提交的改动不算数。
- 代码一变，旧证据*按构造*过期。终验门重查新鲜度，拒绝过期与未绑定证据。
- 取证产物（截图/响应转储）用 `--evidence-file` 随证据入账：`lzy` 复制进
  `.lazyzcode/evidence/` 并绑定 sha256（每 F 项 ≤4 个）；`lzy loop finish`
  自动归档证据包到 `.lazyzcode/evidence/<slug>.report.md`，`lzy loop export`
  随时重导出。
- `lazyzcode:qa-executor` 代理为此而生：派它去跑取证，并原样报告它实际观察到
  的东西——命令与原始输出。它的天职是对抗证据造假。
- **证据对照（comparator）**。存在性与新鲜度是机器门；证据是否真的**证明了**
  断言所言，没有 CLI 读得懂语义——所以 HEAVY 目标 finish 前派 `qa-executor`
  做对照：逐 F 项把断言对着已取证据判，`不匹配`就回去真重取证（或诚实修计划）。
  证了一个差一点的定理，仍然不等于证了那一个。

## 续跑预算

ZCode 给每会话一个 **3** 次 stop-continuation 的共享池，后台任务通知也从这里
扣。LazyZCode 的 Stop 钩子每会话至多花 **2** 次，有意预留 1 次。计数按
`sessionId` 隔离（曾有一个全局计数的探针劫持了无关会话——这条约束现在是结构性的）。
钩子任何异常一律 **fail-open**：循环绝不困住不属于它的会话；预算花完后用户的
明确停止永远赢。

SessionStart 重注入循环状态，新会话接着上一个停下的地方干。

## 项目记忆

对一个没人画过地图的代码库做 HEAVY 规划，是在浪费计划门。`lazyzcode:init-deep`
——插件的第二个技能——构建**分层项目记忆**：一张根 `AGENTS.md` 地图，加上
够格子目录的分层地图（构建入口、直接文件数 > 40 的目录、根文件已提及的目录）。
ZCode 原生读取 `AGENTS.md`，地图免费搭进每一个未来会话——不需要任何钩子。

技能的契约是保守的：先出草稿，你点头才写盘；已有文件只给补丁建议、绝不覆盖；
不写密钥、不写本机路径。它只动 `AGENTS.md` 这一层——个人教训在 zw 收尾时归
宿主原生 memory。

`lzy agents-md` 列出够格目录与覆盖缺口；`lzy doctor` 的 `agents-md` 行巡逻
采纳情况（warn-only：没有根地图的仓库是 skip，不催）。HEAVY 规划在有地图时
先看地图。

## 无人值守

无人值守就是同一个目标循环挂上日程。引擎自带自动化以 `zw 继续（无人值守：…）`
唤起新会话；唤起节奏天然错峰——`lzy doctor` 的 `schedule` 行从你实测的限流
集中时段反推对侧 8 小时窗口（日志数据支撑时才给）。

护栏是结构性的，不是口头承诺：无人值守会话**只继续已开的目标**——绝不注册
新目标、绝不写或采纳计划，因为决策完备门需要人。没有可继续的目标就干净退出；
唤起本身受续跑预算、429 判死、串行子代理、≥1 小时间隔约束。

## 纪律角色

三只只读角色随插件 `agents/` 目录分发，引擎自动发现。用 Agent 工具以角色作
`subagent_type` 派发：

| 角色 | 用途 |
| --- | --- |
| `lazyzcode:explorer` | 计划前侦察：摸清相关代码区，用 `file:line` 证据回答规划者的问题。大仓库可走 codegraph 索引。 |
| `lazyzcode:plan-reviewer` | 计划评审门：审计决策完备性、N/F 合法性、F 项真实表面、隐藏风险。返回 `VERDICT: PASS` 或 `VERDICT: REVISE`。 |
| `lazyzcode:qa-executor` | 证据执行：在真实表面跑一项 F 项验证，原样报告实际观察——命令与原始输出。对抗证据造假。 |

三只全部只读：不改代码，其价值在于结论来自仓库本身，而非主代理的假设。

## 钩子与生命周期

| 钩子 | 事件 | 干什么 |
| --- | --- | --- |
| `session-start.js` | SessionStart | 重注入目标循环状态，新会话接续上一个。 |
| `trigger.js` | UserPromptSubmit | 分层触发匹配；命中发起则注入 zw 引导。 |
| `comment-checker.js` | PostToolUse（Edit/Write） | 对新内容中的 `TODO`/`FIXME`/`XXX`/`HACK` 标记与调试残留（`console.log`、`console.debug`、`debugger`）做提示。每次至多 5 处、300 字符、只提示不阻断——且只在有开放目标循环的工作区生效。 |
| `stop.js` | Stop | 循环开着时带剩余步骤上下文请求续跑（每会话至多 2 次）。 |；一次性消费交接标记并放行（不耗预算）。 |
| `tripwire.js` | PostToolUseFailure（`^mcp__`） | 同一 MCP 工具在 10 分钟窗内连续失败 2 次时提示一次（成功不重置连击，TTL 才重臂）——引向换工具或 `lzy loop handoff` 干净收尾；只提示不阻断，用户手动取消不计，仅在有开放目标时生效。 |

五条命令都经 `plugin/hooks/run-hook.sh` 启动：引擎用*自己的*环境拉起钩子，而
GUI 直启的 ZCode 可能 PATH 里没有 `node`——启动器兜底 nvm（取最高版本）与
Homebrew 位置，落空则记 `/tmp/lzy-hook-launcher.log` 并以 0 退出（fail-open）。
`lzy doctor` 的 `hook-node` 检查报告解析结果。

## 限流纪律

GLM 套餐实行**账号级**并发限流（`[1302]` / 429）。没有可以配置绕开的固定阈值：
实测余量随套餐档位、时段、账号状态浮动——`lzy doctor` 从引擎日志（近 2 日）实测，
报告去重后的 429 **回合**、判死回合、最长连撞，以及（数据连贯时）经验并发带
（「N 会话干净 / M 会话撞线」）。仅警告，不翻退出码。

zw 技能承载的行为规则：

- **一次只跑一个目标循环**；并行主会话宜少。
- 子代理并行度**靠实测、不靠猜**：`lzy loop start` 用同一份实测数据打印
  「并发纪律」行——刚撞线或处于实测集中段→串行；连贯干净经验带→≤2。
- **风险压过配额**：配额压力可以在 triage 时选 LIGHT，但绝不降低 HEAVY 的风险
  门槛。
- 被 429 判死（引擎重试耗尽判回合死）后：干净收尾，等几分钟，`zw 继续`——
  循环状态还在。
- **传输死亡是另一族**：请求根本没出本机（`ENETDOWN` 等，引擎常误标
  「不可重试」）。恢复契约同款——干净收尾即可，`.lazyzcode/` 分毫无损；
  `lzy doctor` 的 `transport` 行给它单独记账（不与限流混算）。

**无人值守（宿主自动化）**：挂载方式与只继续协议见[无人值守](#无人值守)；错峰
窗口来自 `lzy doctor` 的 `schedule` 行——从你自己的实测集中段反推，不是拍脑袋。

## CLI 参考

项目记忆：`lazyzcode:init-deep` 技能生成分层 AGENTS.md 地图（根 + 有资格子目录），
**草稿先行**——未经你点头不落任何盘；`lzy doctor` 每次跑都巡逻覆盖。

```
lzy install                     部署插件 + 注册表 + 官方启用
lzy sync [--watch]              重新部署载荷（热重载；--watch 持续监听）
lzy status                      快速体检（退出码 0 = 无 fail 级检查）
lzy doctor                      深度本地诊断（零遥测）
lzy uninstall                   删缓存 + 注册表条目
lzy loop register <slug> --title <标题>    建目标（planning）
lzy loop plan <文件> [--review <判决>] [--force]   采纳 N/F 清单
lzy loop start                  planning → executing；记录基线 tree hash + 打印实测并发纪律行
lzy loop status                 进度、下一步、证据新鲜度
lzy loop verify                 证据时效审计（退出码 1 = 过期/未绑定/无目标）
lzy step done <ID> [--note <注记>] [--evidence <证据>] [--evidence-file <文件>]…
lzy loop finish                 终验门：全部 done + 全部证据新鲜；自动归档证据包
lzy loop export                 重导出证据包（<slug>.report.md）
lzy loop list [--root <目录>]   跨仓目标循环清单（只读）
lzy loop abandon                放弃，留档
lzy loop reset                  清循环状态（含会话计数、孤儿临时文件）
lzy agents-md                   AGENTS.md 分层审计（退出码 1 = 缺口/超限）
lzy version                     打印版本
```

旗标：`--note` 上限 300 字符、`--evidence` 上限 4000、`--evidence-file` 可重复
（每 F 项 ≤4 个、单个 ≤20MB）；`--force=true` 与 `--force` 等价；`--watch=<值>`
会警告（它不吃值）。

## 诊断

`lzy status` 跑基础检查；`lzy doctor` 在其上加跑深度项。退出码：**fail** 级
发现翻成 1；**warn** 与 **skip** 永不翻。

| 检查 | 含义 |
| --- | --- |
| `payload` | 仓库插件清单可读 |
| `install` | 注册表条目在且健康 |
| `files` | 部署缓存与仓库载荷逐文件一致 |
| `enabled` | 引擎把插件列为已启用 |
| `codegraph` | Codegraph MCP/CLI 在场性（缺席 = `skip`） |
| `loop` | 本目录目标循环进度（无循环 = `skip`；循环开着为 `warn`） |
| `hooks` | 钩子语法自检（worker 内 vm 解析）+ `hooks.json` 注册校验 |
| `node` | Node 版本下限（≥ 20） |
| `hook-node` | 钩子启动器从哪条路径解析 node |
| `lzy-path` | `lzy` 能否在 PATH 上解析 |
| `state` | `.lazyzcode/` 卫生（孤儿临时文件、goal 状态） |
| `claims` | 认领巡逻：谁认领了进行中目标、stuck 停拉标记；零认领 = 「待认领」提示（warn，不翻退出码） |
| `ledger` | 提交账本巡逻：goal 起点后提交缺 `Goal:` 尾注的比例（warn，不翻退出码） |
| `platform` | 平台提示（仅 macOS 探测） |
| `agents-md` | AGENTS.md 分层覆盖审计（根缺失 = `skip`；`lzy agents-md` 详单） |
| `rate-limit` | 近 2 日引擎日志的 GLM 套餐 429 压力 |
| `transport` | 传输死亡（请求未达服务端类故障，如 ENETDOWN）：独立分族计数，绝不进并发带数学 |
| `schedule` | 错峰窗口建议：从实测集中段反推自动化挂载时段（无集中段证据 = `skip`） |

## 状态与配置

LazyZCode **没有配置文件**。一切皆推导：

| 路径 | 内容 |
| --- | --- |
| `.lazyzcode/loop/goal.json` | 当前目标：步骤、状态、证据绑定 |
| `.lazyzcode/loop/sessions/<sessionId>.json` | 每会话 Stop 钩子计数 |
| `.lazyzcode/loop/salvage/<slug>.md` | 可回收工件存根（循环 reset/abandon 时盘点：未提交改动、带尾注提交、资产指针）；`lzy loop status` 在无 goal 与有 goal 两种视图下都会显示 |
| `.lazyzcode/plans/<slug>.md` | 计划文档 |
| `.lazyzcode/evidence/` | 归档的取证材料 |
| 引擎插件缓存 | 已部署载荷（`lzy install`/`sync` 管理） |
| LazyZCode 注册表 | 安装记录（安装器管理） |

环境变量：`LZY_ZCODE_ENGINE` 整体替换默认引擎候选列表（默认：
`/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`）。这就是全部配置面。

隐私：零遥测；诊断本地计算、本地输出。

## 兼容性与限制

- 引擎探测**仅 macOS**；其他平台报「未找到」，不盲猜。
- **headless**（`--prompt`）驱动引擎需要桌面端注入的模型凭据；机制已经探针
  验证，活体 headless 验收顺延。
- **每个项目目录一个目标循环**，且已完成的循环占位直到 `lzy loop reset`。
- 触发匹配有意分层——想从句中进循环，用 `lazyzcode:zw` 或 `ultrawork`。

---

*LazyZCode 以 MIT 许可发布。工作流受
[lazycodex](https://github.com/code-yeongyu/lazycodex)（MIT）启发；
[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)（OmO，
SUL-1.0）仅贡献思想。文档结构参照 lazycodex 文档并注明出处。*
