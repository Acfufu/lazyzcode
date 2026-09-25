# 0.3.0 Agent-first 工程工作流：研究与差距底稿

核验日期：2026-09-23。状态：规划输入，不是已批准的实施计划。
本地基线：`fb61809`，package.json 为 0.2.3；Unreleased 包含 0.2.4 搭车债清与 workers 编排。

## 用户目标与证据口径

用户要求完整改造为前沿 AI 开发工作流，参考包括但不限于 OpenAI 的 agent-first 实践。
访谈 Q1 已确认：**ZCode 优先的完整 AI 工程工作流**，现有流程设计可以重议。
这不自动决定默认合并、生产部署、计划批准策略、兼容迁移或本版交付范围。

本稿区分官方案例事实、本仓观察和规划推论。企业自报、受控实验与工程预览不能证明
某种流程对所有项目最优；也不能据此承诺在 ZCode 的模型与工具条件下复现收益。
外部材料只用于研究思想，不复制实现或提示词。未做产品改动、提交或发布。

## 一手实践

| 来源与日期 | 核实的实践及适用边界 |
| --- | --- |
| [OpenAI：Harness engineering](https://openai.com/index/harness-engineering/)，2026-02-11 | 短入口指向仓内知识；每个 worktree 可启动应用并提供浏览器和可观测反馈；结构约束由工具检查；持续修整知识和代码。案例的宽松合并策略依赖其吞吐与纠错条件，不能直接照搬。 |
| [OpenAI：长任务实验](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex)，页面本轮未见明确发布日期 | 规格、里程碑验收、运行规则与状态分别落盘，持续验证和修复。作者明确这是实验，不是生产推广结论；运行时长本身不等于产品收益。 |
| [OpenAI Symphony README](https://github.com/openai/symphony)，动态页面，2026-09-23 核验 | 把项目工作变成隔离执行任务，产出 CI、评审与演示材料；明确标为可信环境内的工程预览。 |
| [Symphony SPEC](https://github.com/openai/symphony/blob/main/SPEC)，Draft v1，2026-09-23 核验 | 工作流策略随仓库版本化；隔离工作区、并发限制、重试和恢复由调度器负责；成功运行可以止于人工评审，规范不规定统一批准政策。 |
| [OpenAI：Agent evals](https://developers.openai.com/api/docs/guides/agent-evals)，动态文档，2026-09-23 核验 | 用执行轨迹定位工具、交接与策略问题，再把已理解的成功标准做成可重复评估集。这里借鉴方法，不意味着引入其托管服务。 |
| [Anthropic：长任务 harness](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)，2025-11-26 | 新会话通过功能清单、进度、Git 与启动入口恢复现场，再增量实现并测试；案例针对 Web 应用。 |
| [Anthropic：长应用 harness 设计](https://www.anthropic.com/engineering/harness-design-long-running-apps)，2026-03-24 | 区分规划、生成、评价；执行前明确交付和验证契约，评价者实际操作应用；随着模型变化消融组件，包括撤掉不再必要的强制上下文重置。 |
| [Anthropic：Context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)，2025-09-29 | 保留轻量引用，按需获取上下文；控制工具重叠和无关信息加载。 |
| [Stripe：Minions Part 2](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2)，2026-02-19 | 固定程序步骤与代理步骤混合；先本地检查，再进入有界 CI 修复；隔离 devbox、权限限制与人工评审共同支撑无人值守。 |
| [Cursor：Scaling agents](https://cursor.com/blog/scaling-agents)，2026-01-14 | 大规模实验中，平级共享锁协调产生瓶颈；职责分离改善协调，随后移除整合角色减少瓶颈。不能把代理数量当收益指标。 |
| [Anthropic：Agent evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)，2026-01-09 | 区分任务、重复试验、轨迹、评分器和最终环境状态；结合程序、模型与人工评分并校准。 |

日期来自页面或研究子代理核验；未明确发布日期的页面只记录访问日，不推断发布时间。
Stripe 正文由研究子代理核验官方页面内嵌文章数据，普通文本抽取未显示正文。
上述内容是面向本规划的短摘要，不是外部实现审计。

## 本仓观察

以下均为本地文件读取所得，不把历史测试数字当作本轮验证结果。

| 面 | 已有能力或观测 | 0.3.0 应回答的问题 |
| --- | --- | --- |
| 意图与计划 | zw（`plugin/skills/zw/SKILL.md`，仓内载荷非站点页）以 LIGHT/HEAVY 分档，采纳 N/F 计划；[ADR-0018](adr/0018-ups-exact-hash-human-gate.md) 批准绑定计划哈希 | 产品验收与执行计划是否成为不同工件？实施路径改变但用户承诺不变时，是否应重新请求批准？ |
| 项目知识 | init-deep（`plugin/skills/init-deep/SKILL.md`）提供分层地图；本轮 `wc -lc`：AGENTS.md 为 150 行/88,236 字节，zw 为 720 行/47,126 字节 | 如何把现行规则、历史事实与操作配方分开检索，并控制实际注入体积？行数上限不足以解决长行堆积。 |
| 执行与恢复 | runtime（`core/runtime.js`）、drive（`core/drive.js`，均仓内源码非站点页）已有 lease、fencing、预算、段循环、交接；workers 分支用兄弟 worktree | 目标项目的启动、依赖、测试数据、应用实例与观测入口怎样成为可重复能力？worktree 本身不是权限沙箱。 |
| 验证与证据 | qa-executor（`plugin/agents/qa-executor.md`）有真实表面执行和对照协议；attest（`core/attest.js`）与 DAG（`core/dag.js`）已有机器账本 | 是否可从验收项直接执行验证并绑定结果？怎样区分证据存在、新鲜、相关与足以证明四种性质？ |
| 合并后验证 | `core/drive.js` 的 workers 合并后屏障调用 `step done --evidence` 重锚当前 F 项；该循环本身不执行 F 项验收程序 | 合并结果与工人原验证面不同，自动更新指纹不能替代重跑验证。需作为设计审查/复现实验输入；本轮未据此宣称端到端漏洞已实证。 |
| 并行效率 | [fast 实验](reviews/2026-fast-exp-report.md) 两题速度比 0.63×/1.12×，模型请求量约翻倍；本代跨 provider 选模路径未打通 | 根据可独立交付边界选择并行，并衡量总成功成本；不能把默认更多工人设为验收目标。 |
| 评审与持续改善 | [消融账本](ablation.md)、findings ledger（`docs/reviews/findings-ledger.jsonl`，仓内非站点页）与专项试验已经存在 | 能否形成维护者可重复运行的代表性任务集，使模型、技能、门禁变化都能比较实际表现？ |
| 交付 | CI 工作流（`.github/workflows/ci.yml`，仓内非站点页）有测试矩阵与 CLI 冒烟；[发布清单](release-checklist.md) 有维护者发布流程 | 目标完成、可审查、合并、发布和部署的责任如何分开？产品可编排现有工具到哪一层？ |

## 规划推论：值得重构的闭环

下列是本项目候选设计，不是外部来源的原话，也不是已拍板清单。

1. **明确意图**：保留用户问题、成功条件、非目标、约束与授权范围；执行计划可以在明确边界内演进。
2. **准备项目**：项目知识有可检索索引；启动、验证、观测和清理入口可发现且可复跑。
3. **执行与恢复**：默认单负责人；独立分片才并行；新会话能重建任务状态和环境健康状况。
4. **验证与评审**：确定性检查先行；语义判断处理其不能覆盖的部分；工人变更整合后的实际候选产物必须重新验证适用断言。默认可合并终点不因此要求先合入主干。
5. **交付与反馈**：依据授权完成明确的交付状态；失败或人工评审意见回到可执行检查、知识或评估用例。
6. **评估流程本身**：观察真实完成率、错误放行、误拦截、人工介入、耗时和费用；流程复杂度需要用结果解释。

应保留的候选资产是证据与世系账本、完整性检查和可恢复运行时；是否改变具体执法点与审批粒度由访谈决定。
把新术语、角色、配置文件和门禁越加越多，不足以构成 agent-first 改造。

## 访谈跟进

后续 Q1–Q7 已确认产品边界、人的批准粒度、默认交付终点、三类项目覆盖、演进式迁移、已授权队列与验证依赖失效方向。
决定及剩余问题统一记录在 [设计草案](design-v030-agent-first.md)，本研究稿不维护第二份决策账本。

旧决策在正式修订前仍有效。研究授权不等于实施、远端写入或部署授权。
