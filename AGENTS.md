# LazyZCode — 项目宪法（Agent 与贡献者必读）

给 ZCode 造一个 lazycodex 同款的「AI 编码工作流纪律层」：让 AI 不只写代码，而是**计划 → 执行 → 拿证据 → 不做完不停**。本文件是本仓库的单一事实入口：ZCode 原生自动读取（无需任何配置），模型读完即可在本仓正确干活；细节引用 `docs/`，不在此复制。


## 1. 北极星

做 ZCode 版的 [lazycodex](https://github.com/code-yeongyu/lazycodex)（OmO 引擎的 Codex 发行版，MIT）。形态：**ZCode 插件 + 轻量 CLI（`lzy`）**——插件承载 skills/hooks/agents（纪律层），CLI 承载目标循环状态机与安装器。背景见 `docs/reports/index.html`。


## 2. 当前状态（2026-09-26 短表；完整历史档案 → docs/history.md）

- **已发布**：npm `lazyzcode` **0.3.0**（registry latest；升级见 README）。
- **0.3.0 agent-first 弧发布收官（09-26）**：M0 能力基线、M1 项目与授权、M2 三仓 A 试点、M3 队列与累计预算、M4 有限 B/C 交付、M5 迁移与发布收口；决策 #32–#36，各步证据 → docs/spikes/。
- 历史里程碑、消融账本与双审报告索引 → docs/history.md。
- **下一迭代规划（09-26，已确认待实施；本轮不执行）**：0.3.1 收口 → docs/plan-v031-closeout.md；0.4.0 机器闭环与同期评估 → docs/plan-v040-engineering-policy.md；逐问共识 → docs/design-v040-engineering-policy.md。
- 发布机械件（定版/tag/publish/pages）按 docs/release-checklist.md 执行；docs/reviews/ 为评审报告库。

## 3. 硬约束（ZCode v3.14.0 实锤复核 2026-09-19；引擎 CLI `--version` 与壳版本分线不变、runtime 值随代际漂移〔3.12.x 代 0.16.5→3.14.0 代 0.16.9，「恒 0.16.5」证伪；判别轴=壳 Info.plist，引擎权威=Resources/glm/zcode.cjs --version〕，设计前必读）；**输出面同样随代际漂移**——`plugins list --json` 0.16.5 出对象包封、0.16.9 出裸数组（插件记录字段逐字相同），lzy 侧由 `core/engine.js normalizePluginList` 唯一边界归一兜住（ADR-0021）；代际复核**须核 JSON 面，不能只核版本锚**——0.1.2 期 engine-3140-sync 即因只锚版本而漏检，代价是 0.16.9 宿主上 status/doctor 的 `enabled` 行 fail 级误报翻退出码

1. 钩子恰为 **7 事件**（SessionStart/UserPromptSubmit/PreToolUse/PermissionRequest/PostToolUse/PostToolUseFailure/Stop）。对比 Codex 原生 12 事件**缺 6 个**：无 SubagentStop/SubagentStart/PreCompact/PostCompact/SessionEnd/Interrupt。
2. Stop 续跑 **≤3 次**，且必须带**非空** additionalContexts（输出空 JSON 永不续跑）；exit 2 在 Stop 上 = block = 强制续跑（reason 注入为上下文）。
3. 3 次预算是**共享池**：ZCode 后台任务通知也发 continue:true 抢同一预算——本项目的 Stop 钩子预算要与后台通知互相预留。
4. ZCode **原生自动读 AGENTS.md**（逐级向上查找 + `~/.zcode/AGENTS.md` 多源合并 + 100KB 截断，以 `# agentsMd` 注入）→ 规则注入钩子不需要做。
5. 宿主内置**多模型目录**（zai/bigmodel 双厂商×计划档，默认 GLM 套餐；3.12.1 复核）→ tier 预算护栏可借模型维度，不自研模型路由。
6. 工作区钩子**信任门已在引擎灰度**（`workspace_hooks_*` 策略码，文档未提）→ 永不改写用户 config.json（见 §5 红线）。
7. 事实源优先级：**reversed-zcode 引擎源码 > zcode-guide 官方文档**（文档存在滞后，已实证 4 处）。
8. **cache 安装型插件默认禁用**：装载需「安装+启用」两步，启用态在 config `plugins.enabledPlugins`（Spike 2 实测）；cache 清单候选仅 `.zcode/.claude/.codex` 三种，`.cursor-plugin` 仅工作区 walk-up 路径接受。3.12.3 起应用随包内置官方插件目录 `Resources/glm/packages/`（3.14.0 代 **14 载荷**：document-skills 拆 documents/pdf/presentations/spreadsheets 四件各 0.1.7，新增 image-search 0.1.1/node-repl-host 0.6.0/plugin-creator 0.1.1，bump browser-use 0.5.1/computer-use 0.6.1/zcode-guide 0.2.0；`defaultEnabled` 自 manifest 迁入引擎内置 seed 表〔14 个 manifest 全无此键；表值 10 真 4 假〕；seed 进用户 cache 前缀 `official/`，marketplace 安装为 `cache/` 前缀；`plugins list` 活体 15 条=官方 13 显+video2code 市场装+lazyzcode 本地，zcode-guide 知识包仍不入列）；启用态=seed 缺省×用户覆盖、仍归引擎管理，config.json 零写入红线不涉。


## 4. 决策速查表（现行摘要；全表 → docs/decisions.md；变更须同步该表+日期）

| # | 决策 | 一句话定案 |
|---|------|------|
| #25 | 真消融 | LZY_ABLATE_* 受控跳部件跑真目标；结果只作拍板输入绝不自动降档 |
| #26 | 0.1.0 棒B | forward-only 世系 + 传播=query-time + headless 原语 |
| #27 | UPS 人权门 | 批准绑定 exact-hash（L2）；--force 不越过；0.3.0 起契约 goal 批准对象=contractHash（ADR-0024） |
| #28 | runtime kernel | lease/fencing/budget 三件一体 + risk 机器面 |
| #29 | 推进信号 | 状态集口径（done∪头树∪绿节点∪登记数；不含脏树）；单源 core/progress.js |
| #30 | H3R | 原型休眠、执法点前移三级、去留=短期 A |
| #31 | fast 形态 | --workers 波编排保留主线、LIGHT only、不默认化 |
| #32 | 积分预算执法 | 近似限制语义（逐请求完成检测+停止下一次派发+在途超额如实记账） |
| #33 | M1 契约授权 | 批准对象=contractHash、撤回=UPS 短码、契约内重规划免人权门、无契约 goal 保持现行门 |
| #34 | M3 队列与累计预算 | 家族在 loop/ 外（reset 不清）；预算绑定 (slug, contractHash) 不另铸授权 id；近似限制记账=逐段计量+三类「不算零」+seq 基人工恢复（ADR-0027） |
| #35 | M4 交付授权 | B/C 各立 delivery 契约（endpoint 入哈希）；批准复用 UPS contractPending；撤回短码=[主契约, …delivery]；合并前置=B∧C+漂移复核+CI；意图账本 done 恒终（ADR-0028） |
| #36 | M5 迁移机器 | state.json 最后写=提交点；apply=备份/暂存/校验/原子切换+journal 幂等续跑；在途→drafts 授权 NONE；执法=goal 损坏写前停/preserve 保字节；update/sync 永不自动迁移（ADR-0029） |
| #37 | 交付编排桥 | 队列项挂 delivery 契约+endpoint B/C+HEAVY 入队解封+多页爬核；批准复用 UPS 通道（ADR-0030） |
| #38 | 积分 gauge 归因 | 执法面=逐段 sessionId usage；账号级水位降 doctor 建议行；budget-ref=none=只留墙钟（ADR-0027 修正节） |
| #39 | 受控独立评审 | lzy 发起独立会话、绑定候选与预算；阻塞发现须独立复核关闭；能力探针前置，待实施（ADR-0031，2026-09-26） |
| #40 | 评审复用 | 按职责授范围资格并对抗验证；未知重评（ADR-0032，2026-09-26；待实施） |
| #41 | 义务复判 | 额外要求可独立复判取消，契约与分级底线不变（ADR-0033，2026-09-26；待实施） |

其余 #1-#24 全表 → docs/decisions.md。

## 5. 设计宪法与红线

**表达层级：Skill > MCP > Tool > Hook**（OmO 官方原则）。能用技能文本（Markdown）解决的不写 MCP，前三层覆盖不了才写钩子。自检：这功能「不在线会不会世界崩塌？」不会 → 别放钩子。

**两条红线（源码复核推导，任何实现不得违反）：**
1. 安装器坚持「**装插件**」，永不改写用户 `config.json`——工作区钩子信任门灰度后，手改配置路径会被信任确认拦截。
2. `lzy loop` 的 Stop 钩子预算与 ZCode 后台任务通知**互相预留**（3 次共享池，见 §3.3）。


## 6. License 边界

- **lazycodex 仓库（MIT）**：插件结构、技能契约文本、安装器模式可合法借用改写，须注明出处；素材白名单制，只准引该仓。
- **OmO 主仓 oh-my-openagent（SUL-1.0）**：只学思想（分层架构、行为契约风格、设计哲学），**一行代码/文本都不搬**。
- **本仓库**：MIT。全部代码与文本自写；PR 审查清单含许可证项。


## 7. 仓库地图

```
AGENTS.md                    ← 本文件：单一事实入口（宪法）
docs/
  research-*.md              ← 调研底稿（报告的事实来源）
  history.md decisions.md    ← 历史里程碑档案 / 决策速查全表（0.3.0 知识路由自 AGENTS 迁出）
  reports/                   ← 报告中心（index.html + full/pm/dev 三份 HTML）+ 逆向源码复核记录
  guide/ developers/         ← 用户文档 + 开发者图文页（lazycodex.ai/docs 同构，双语；Pages 内容源）
  _layouts/ _includes/ assets/ _config.yml index.md  ← GitHub Pages 骨架（Jekyll/GFM，source=/docs）
  spikes/p0-day1.md          ← P0 首日三 spike 结果（Edit/四风格/Stop 预算，已全部完成）
  adr/0001..0033-*.md         ← 架构决策原文（现行摘要见 §4、全表见 decisions.md）；0031=受控独立评审、0032=评审范围复用、0033=策略义务复判，均待实施
  reviews/ release-checklist.md  ← 评审报告/处置记录（2026-09-06/07/08）+ 发布清单（13 步含 Pages）；narrative-checklist.md=叙事面 checklist（2026-09-13）
  diagnostics/               ← 运行环境诊断记录（钩子 spawn env / shell PATH，2026-09-07 起）
plugin/ core/ cli/ test/ .github/  ← P0 骨架：插件载荷 / 共享逻辑 / lzy CLI（见 README）+ 契约测试（node:test 零依赖）+ CI 骨架
scripts/docs-preview/        ← 文档站本地预览与校验工具链（dev-only 独立依赖，根包零依赖）
README.md（英）+ README.zh-CN.md（中）LICENSE CHANGELOG.md  ← 开源门面（lazycodex 同构双语说明）
artifacts/                   ← 本地产物（已 gitignore，不入库）
```


## 8. 语言（高频词速查；完整术语表 → 根 CONTEXT.md——唯一来源，新词按其风格补入）

**纪律层（discipline layer）**：计划门、证据验证、防半途而废的价值层。_Avoid_: 工作流强化层
**目标循环（goal loop）**：`lzy loop` 的「注册→派发→证据→完成」状态机循环。_Avoid_: ulw-loop
**证据（evidence）**：绑定 tree hash 的真实表面取证；测试全绿≠证据。_Avoid_: 测试结果
**双证据（red-green）**：F 项断言红半（改前失败）+绿半（改后通过）；豁免须一行理由。_Avoid_: 测试先行
**tier（轻重分级）**：LIGHT 精简 / HEAVY 全套纪律；只升不降。_Avoid_: 模式切换

其余全部术语（失效 DAG、世系、认领、交接快照、人权门、H3R、复合指纹、wave、lease、fencing 等）→ CONTEXT.md。

## 9. 维护规则

1. **决策变更 → 必须同步 docs/decisions.md 全表**（一行一条 + 日期）并刷新本文件 §4 摘要行；阶段推进 → 更新 §2 短表。
2. 根 AGENTS.md 体积预算 **≤12 KiB**（0.3.0 知识路由，2026-09-24 自「≤150 行」升级）；历史/决策/术语已外迁 docs/history.md、docs/decisions.md、CONTEXT.md，细节一律引用 `docs/`，不复制正文。
3. 新术语先查根 CONTEXT.md（§8 只留高频五词）；需要新词时按其 CONTEXT-FORMAT 风格（定义 + _Avoid_）补入 CONTEXT.md。
4. **与本文件冲突的旧约定，以本文件为准。**
5. 开发期新决策满足「难逆 / 无背景会费解 / 真取舍」三条件时，逐条立 `docs/adr/NNNN-*.md`（一段话即可）；已有拍板不补 ADR（rationale 已在报告）。
