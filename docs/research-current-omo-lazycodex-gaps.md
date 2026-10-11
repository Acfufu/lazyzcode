# 当前 OmO / LazyCodex 与 LazyZCode 的差距核对

日期：2026-10-11。性质：研究记录与规划建议，未改变现行 ADR、采纳结论或默认行为。未运行付费对照实验。

## 比较对象与证据边界

| 对象 | 本次核对锚点 | 证据限制 |
| --- | --- | --- |
| OmO | `dev`：`769b62ba97f093bed96e25e0e61e81657725443b` | 当前 Senpi 实现与源码契约，不代表全部进入 Codex 发行载荷 |
| LazyCodex | `main`：`ad9a2421cecfdfb78095b142be25c3267dbd33c6`；实际 `plugins/omo` 清单为 5.1.29；`src` 子模块为 `65715d1c2c35e27ccf2195ef688b0909dddb403c` | 以实际发行目录为准；角色、工具、流程存在不证明任务收益 |
| LazyZCode | 0.5.0，研究起点 `6c2853c` | 本仓源码与既有报告；没有新增交付率测量 |
| 本机 ZCode | 壳 3.15.1；引擎 0.16.9 | 已检查安装版本和随包技能；灰度能力、插件装载与目标实验会话仍须核实 |

ZCode 版本检查命令：

```sh
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' /Applications/ZCode.app/Contents/Info.plist
node /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs --version
```

宿主源码辅助锚点：本机 `zcode-origain/ZCode` 提交 `872ad960de7ec172591f7e1952f7849229f94521`。源码支持某能力、应用携带某插件、当前会话已启用该能力、真实任务成功，是四种不同证据，不互相替代。

## 已确认差异与责任边界

| 维度 | 上游实际资产 | 本仓现状 | 建议责任与优先级 |
| --- | --- | --- | --- |
| 角色与专业工具 | LazyCodex 有具名工作者、探索、规划、代码评审、QA、gate 等角色；LSP 编辑诊断、AST grep、文档查询等集成 | `zw` 已有分阶段配方、原生代理协作与独立评审；没有证据表明所有上游工具在目标 ZCode 会话均有等价供给 | 工具与代理执行由宿主提供；lzy 可补能力检查和技能指引。M0 先盘点，M1 证明缺工具或误路由才进 M2 |
| 持久编排 | OmO Senpi 有依赖就绪调度、WAL、检查点、任务重试与恢复；LazyCodex 有计划续跑、目标循环和显式 Team 工作流 | lzy 已有图、认领、目标状态、证据和恢复；ADR-0036 把执行编排交给宿主 | 宿主负责进程与运行恢复，lzy 负责结果和纪律。不新增第二套调度器；记录宿主故障及交接缺口 |
| 上下文与记忆 | OmO `memory-core` 提供 Git-backed Markdown、会话检索、后台事实提取等 | 已有按阶段加载 recipes、项目规则与结束时沉淀项目经验；这不等于完整自动记忆系统 | 属于真实能力广度差异，但尚无收益证据。记忆存储、检索、压缩归宿主；lzy 至多规范何时写入、何时读取 |
| 真实表面 QA | LazyCodex 提供专门 QA/gate 角色与现场验证流程 | `finish` 配方已有真实表面、对抗检查、受控独立评审、证据复用/复判和具名收束 | 已有制度，不能列成“缺 QA”。待测的是能否选对表面、实际执行、可靠归档；技能接线可归 lzy，浏览器/模拟器归宿主 |
| 生命周期续跑 | LazyCodex 清单含 Stop、SubagentStop、PostCompact 等钩子 | ZCode 事件更少，Stop 与后台通知共享 3 次池；现有 lzy 已做预算约束 | 属于宿主硬边界。通过持久状态和明确续跑入口缓解，不能承诺无限自动继续，也不新增 Stop 抢预算 |
| 模型选择 | OmO Senpi 有代理/类别模型解析和 fallback；LazyCodex 有角色配置 | ZCode 有模型目录与代理模型选项，但目录存在不等于完整类别路由 | 模型运行时、限流、fallback 归宿主；先固定对照主模型，不以新增路由扩大本轮范围 |
| 产品收益测量 | 上游能力清单只能证明存在 | 旧评估器测版本间的 lzy 流程，不能回答原生 ZCode vs 完整插件的价值 | 已确认 P0：修共同交付判定、环境/授权公平性、插件真实装载、全链路成本与终止边界 |

本仓证据入口：[zw](../plugin/skills/zw/SKILL.md)、[执行](../plugin/skills/zw/recipes/execute.md)、[完成](../plugin/skills/zw/recipes/finish.md)、[图](../core/graph.js)、[钩子](../plugin/hooks/hooks.json)、[宿主编排边界](adr/0036-host-orchestration-base.md)、[文书协议](adr/0035-document-protocol.md)。按阶段加载、独立评审、图、comment checker、MCP 故障提示均已存在，不应重复建设。

## ZCode 当前底座的额外约束

随包 `dynamic-workflows/SKILL.md` 已描述 `CreateWorkflow`、类型化结果、fan-out、pipeline、独立上下文、模型选择及修订缓存。它明确要求：只有用户显式指定 workflow/工作流作为手段才启动 `CreateWorkflow`；少量独立委派使用 `Agent`。旧 `Workflow` 是另一功能，不能混称。

宿主源码存在灰度策略、并发 governor、journal 与恢复工具；随包可见浏览器、iOS、Android、CUA 载荷。以上不能证明目标实验会话已启用、可授权执行或完成真实 QA。CodeGraph 是本机已安装条件，不应写成所有 ZCode 默认提供。

因此能力盘点只检查版本、安装、注册、启用、授权、可用表面及明确限制；涉及模型调用的探针必须计入已约定预算，不能以“预检”另开付费额度。不得改写用户 config.json，不强启灰度，不自动把普通任务转成动态工作流。实验任务未明确指定 workflow 时，两臂均不得通过额外提示开启；若指定，必须给两臂相同指令并限定结论范围，技能接线不得绕过该条件。

## 评估器的已确认问题与待验证项

源码入口：[run-pairs](../scripts/evaluation/run-pairs.mjs)、[headless](../core/headless.js)、[成本](../core/cost.js)、[独立评审](../core/review.js)。

- 两臂提示均显式要求 lzy 注册、计划、证据和完成；这不是原生宿主对照。
- 现有路径使用人权门消融，不能直接称作完整产品评估；新对照须使用真实且等价的授权条件。
- 启动代码不足以确认目标会话插件确实加载；自动发现也不能凭空否定，须取装载证据。
- 成本查询主要绑定主会话，独立评审隔离 HOME 和失败/替换尝试需另行汇总；报告把缺失值当零求和会低估成本。
- `lzy` goal done 是本产品状态，不是两臂共同交付判定。独立验收与明确交付须分别记录。
- 当前父进程超时处理不足以证明所有子进程、独立评审和在途请求均受同一全链路截止约束；M0 硬验收须验证本次运行所属后代和评审的停止派发、终止与回收，远端在途费用和超额如实记账。父进程返回不等于消耗停止。

这些是本轮最直接的工程缺口；它们影响结论可信度，不能用再加角色或流程替代。

## 对既有迭代规划的建议

主问题保留：完整 LazyZCode 相对原生 ZCode，能否提高正确交付或减少假完成，同时每次正确交付成本不升。已有 14 项选择不变。

1. **M0 增加能力与边界清单。** 每项标注宿主原生、本仓已有、确实缺失或未验证；重新锚定 3.15.1 会话。完成中性共同要求、真实授权、插件装载证据、共同结果分类、全尝试计费及截止约束。无模型调用的检查先做。
2. **M1 增加失败归因。** 三仓 CLI/Web/iOS 各一对；区分宿主执行/工具、纪律与完成、QA、上下文/续跑、测量问题。只诊断，不作采纳结论。
3. **M2 保持条件式优化。** 只修实际观察、可复现的原因。优先小幅技能指引、工具检查、证据与计量修复；已有机制执行不到位时先查触发与成本，不再加一层同类制度。没有可靠原因可以跳过。
4. **M3/M4 保持独立正式评估与有边界结论。** 不新增 OmO/LC 付费实验臂，不扩大任务类型；冻结候选与统计判据后再跑，证据不足须如实结论。

开发预算仍是最多 3 对 / 6 次，每次全链路 45 分钟，共享 100 估算积分，失败、子代理、评审、重试均计入；优化后的额外付费验证和正式评估另行冻结预算。跨会话记忆、默认团队化、类别路由等没有本轮任务证据前不进入实现承诺。

## 固定版本的上游来源

- [LazyCodex 实际插件清单 5.1.29](https://github.com/code-yeongyu/lazycodex/blob/ad9a2421cecfdfb78095b142be25c3267dbd33c6/plugins/omo/.codex-plugin/plugin.json)
- [LazyCodex 目标循环实现说明](https://github.com/code-yeongyu/lazycodex/blob/ad9a2421cecfdfb78095b142be25c3267dbd33c6/plugins/omo/components/ulw-loop/README.md)
- [LazyCodex 计划续跑](https://github.com/code-yeongyu/lazycodex/blob/ad9a2421cecfdfb78095b142be25c3267dbd33c6/plugins/omo/components/ulw-execute-continuation/README.md)
- [LazyCodex Team 显式入口](https://github.com/code-yeongyu/lazycodex/blob/ad9a2421cecfdfb78095b142be25c3267dbd33c6/plugins/omo/components/teammode/skills/teammode/SKILL.md)
- [LazyCodex 真实 QA 流程](https://github.com/code-yeongyu/lazycodex/blob/ad9a2421cecfdfb78095b142be25c3267dbd33c6/plugins/omo/components/ultrawork/README.md)
- [LazyCodex LSP 与编辑诊断](https://github.com/code-yeongyu/lazycodex/blob/ad9a2421cecfdfb78095b142be25c3267dbd33c6/plugins/omo/components/lsp/README.md)
- [OmO Senpi 适配层](https://github.com/code-yeongyu/oh-my-openagent/blob/769b62ba97f093bed96e25e0e61e81657725443b/packages/omo-senpi/AGENTS.md)
- [OmO 持久 DAG](https://github.com/code-yeongyu/oh-my-openagent/blob/769b62ba97f093bed96e25e0e61e81657725443b/packages/senpi-task/src/dag/AGENTS.md)
- [OmO 记忆系统](https://github.com/code-yeongyu/oh-my-openagent/blob/769b62ba97f093bed96e25e0e61e81657725443b/packages/memory-core/AGENTS.md)
- [OmO 模型要求](https://github.com/code-yeongyu/oh-my-openagent/blob/769b62ba97f093bed96e25e0e61e81657725443b/packages/model-core/src/agent-model-requirements.ts)

上游文档中的流程要求不等于每个用户任务都被运行时强制检查；本次没有证明任何一方交付率、成本或记忆收益优于另一方。OmO 主仓仅供思想和能力研究，不复制代码或契约文本；许可证边界保持本仓宪法。
