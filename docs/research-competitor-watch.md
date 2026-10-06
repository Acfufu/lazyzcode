# 竞品观察信号（competitor watch）

> 方法增补（pisper-absorption#N5，2026-09-13，源自 pisper 调研报告 O3 的「可观察信号」手法）：
> 竞品复扫除记快照外，每次留下**带截止时间的可观察信号**——下次复扫先核销旧信号，再立新信号。
> 快照答「现在怎样」，信号答「往哪走」。信号判死不扣分：预期错了就订正预期，不掩盖。

## 首批信号（立入 2026-09-13，复核窗口 3 个月 → 2026-12-13 前）

| # | 信号 | 判真含义 | 判真动作 |
|---|------|----------|----------|
| W1 | 官方市场（zai-org/zcode-plugins）出现投稿入口或上架纪律层插件 | 卡位窗口关闭，官方分发面易主 | 重估「自建市场 B 路」投入，竞品叙事改为官方生态兼容 |
| W2 | 引擎原生做目标循环/纪律层（计划门、证据绑定、续跑预算任一内置） | 本产品核心价值被上游吞并（对应 pisper 报告 R1 同款风险） | 转向引擎差异化缺口面（限流纪律/计价/无人值守），或上游化贡献 |
| W3 | 引擎钩子事件扩容（如 SubagentStop/PreCompact 落地） | 红线 #1 松动：子代理级纪律、压缩前留痕成为可能 | 重开「角色级拉回」「压缩前快照」等被 7 事件限制否决的备选 |

## 第二批信号（立入 2026-09-27，复核窗口 3 个月 → 2026-12-27 前）

| # | 信号 | 判真含义 | 判真动作 |
|---|------|----------|----------|
| W4 | harness 条件标注/敏感性被评测体系从「披露惯例」升格为「计分维度」（首个倡议：akitaonrails v2 提议把 harness-insensitivity 当成熟度信号基准化） | 「提升质量」话术失效——scaffolding 已被实证为 per-model 双向乘数，选型叙事必须带 per-model scaffolding delta | lzy ablation 立项（HEAVY vs 裸跑，书面 rubric+±1 噪声带+禁中途改判据）；公开 per-model 数据 |
| W5 | zcode harness 在第三方评测的覆盖面扩大（现状=仅 akitaonrails v4 一处、仅 GLM 家族；判真=出现第二家评测，或 v4 把非 GLM 模型也跑上 zcode） | zcode 生态进入公开可比空间：机遇=公开任务集+成文 rubric 可直接自评晒 delta；风险=lzy 用于评测工作流若不带条件隔离，会污染第三方数据甚至被点名 | 环境溯源证据节点+shield 配方（整改 P0）；公开任务集自测立项（整改 P3） |

## OmO 家族被第三方 benchmark 实证（快照，2026-09-27 补录）

**事件**：akitaonrails（oh-my-opencode-slim orchestrator 作者本人）发现其插件从 `~/.config/opencode/` 静默加载、无视 `OPENCODE_CONFIG` 环境变量，且 home 配置禁用 stock agents——2026-07-28 前的全部 opencode run 都跑在 orchestrator 条件下而不自知。作者随后做 11 模型隔离复测（orchestrator vs XDG 裸跑），两套条件全存档、永不混榜。

- **主发现**：agent scaffolding = per-model 双向乘数，摆幅 106 点。MiniMax M3 +67（24→91，「幽灵委派」系 persona 诱发而非模型本性）、Qwen3.7 +29、K2.6 +14；反向 Grok 4.3 −39、Gemini 3.1 Pro −22（脚手架依赖型，裸跑 48 秒弃建）；强模型 ±1（harness-insensitivity 或为成熟度信号）。方向由模型「文化」决定：delegation-prone 系把编排措辞读成「委派然后等待」并空手退出。
- **编排协议层**（强制委派 traces）：空 `<task_result>` 信封=harness 解析 bug，reasoning 透传等配置修复全部无效；救援靠 planner 纪律——Opus 每次派发后读盘对账，空信封+零落盘即换通道；GPT 5.5 则重派循环或直接放弃。跨 provider 卡死=首调慢初始化被 6 分钟 watchdog 误杀（15 分钟即愈，慢≠挂）。
- **计分纪律**（lzy 门禁可引用的同类）：「诚实进 fidelity，不得双扣 capability」（Astra 翻案）；自评凭记忆重建目标编号重扣（必须核 brief 原文）；未证运行时声明封顶约 60%；书面扣分目录+机器一致性审计（6 处错误 3 上 3 下，人眼评分必漂移）；污染 run 保留不删，以 `.contaminated-*` 命名留证。
- **zcode 入场**：v4 sabotage 基准已把 zcode 列为一等被测 harness——GLM 5.3=94.0（zero-caveat）、5.3 Flash=84.25、5.2=77.0，均 zcode 跑法（2026-09-13）。v4 定律：「检测率跟随伪装度，不跟随严重度」。
- **对 lzy**：这是 lzy 直系血亲（LazyCodex/OmO 家族）核心卖点（多代理编排 persona）的第三方压力测试。防御=evidence-first 账本的天然优势（「measurement-safe orchestration」是 OmO 拿不出的差异化）。整改方向已立：P0 环境溯源证据节点+doctor 环境快照；P1 宣布vs落盘对账、子代理空信封降级、诚实经济学条款；P2 ablation+per-model sensitivity profile；P3 公开任务集自测——随迭代提案落仓。执行编排 DAG 对比（mass-ulw wire 协议 vs lzy ADR-0014）仍欠一篇正式笔记，待补。

## #21 需求侧证据（决策表附注的展开）

决策 #21（依赖图并行认领，记债不实现）的升格判据是工程侧信号（并行带实测 ≥2 /
同目标撞槽）。市场侧证据 2026-09-13 实取如下，供下次评审 #21 时对照：

- **pisper**（295★，8 周龄）：整个产品 premise 就是「想法，不必排队」的并行会话编排
  （多 Agent 分屏、会话独享模型/目录/权限）；
- **vibe-kanban**（28,063★）：看板式把任务卡片派给多个编码 Agent 并行推进（面 A 领头羊）；
- **happy**（23,760★）：移动+Web 端多会话镜像接管。

读法：并行多会话编排的需求已被市场验证（三仓合计 5 万+ star），但 lazyzcode 的
约束不同——GLM 账号级限流是硬顶（经验并发带实测常为 1–2），市场热不构成升格理由，
只是说明「若升格，方向有先例」。

## 来源

- pisper 调研报告（pis-per-research-report/report.html，2026-09-13，GitHub API 实取）
- akitaonrails/llm-coding-benchmark：success_report.v2.md（harness 隔离战役 2026-07-28~08-15）、success_report.v4.per_model.md（zcode harness 入场）、orchestration_traces.md（强制委派 traces）；精读复盘 2026-09-27
- 既往复扫：competitor-landscape（2026-09-08）、competitor-rescan-2026-09（2026-09-09，artifacts/）
