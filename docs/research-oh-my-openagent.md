# 调研：oh-my-openagent (OmO) 引擎深读

> 日期：2026-09-05。前置文档：[research-lazycodex-to-zcode.md](./research-lazycodex-to-zcode.md)（lazycodex 与 ZCode 扩展面）。
> 对象：https://github.com/code-yeongyu/oh-my-openagent ，默认分支 `dev`，68.7k stars，主页 omo.dev，日更级别活跃。

## 一、定位

OmO 是一个**宿主无关的 agent harness 引擎**，口号 "Drop your tokens. Ultrawork. Done."。从 oh-my-opencode 改名而来（npm 双包过渡中），当前发行三个版本：

| 版本 | 宿主 | 规模 | 安装 |
|---|---|---|---|
| **Ultimate** | OpenCode | 11 agents、54+ hooks（Team Mode 下 61）、5 个内置 MCP、Team Mode、`/goal`、IntentGate、Hashline | `bunx oh-my-openagent install` |
| **Light** | Codex CLI | 便携组件（rules/comment-checker/git-bash/LSP/ultrawork/ulw-loop/continuation/telemetry/teammode）+ 8 个 agent TOML | `npx lazycodex-ai install`（即 lazycodex） |
| **Senpi**（beta） | 独立 CLI | 内嵌引擎的 `omo` 命令 + 平台原生二进制（`oh-my-opencode-darwin-arm64` 等） | `npm i -g omo-ai@beta`（故意只走 beta） |

维护方式特殊：作者 + Jobdori（跑在 OpenClaw 定制 fork 上的 AI 助手）"Building in Public"，"99% of this project was built with OpenCode"。

## 二、⚠️ License：两个仓库不一样（对 lazyzcode 最关键的发现）

| 仓库 | License | 含义 |
|---|---|---|
| **oh-my-openagent**（引擎主仓库） | **SUL-1.0**（Sustainable Use License，非 OSI 开源） | 仅允许**个人/非商业/内部业务**使用与修改；再分发必须**免费且非商业**；衍生品必须带显著修改声明、不得移除版权声明 |
| **lazycodex**（Codex 发行仓库） | **MIT**（Copyright (c) 2026 Yeongyu Kim） | 可自由使用/修改/再分发，只需保留版权声明 |

**对 lazyzcode 的结论**：
- lazycodex 仓库内的全部内容（`plugins/omo/` 的 26 个技能文本、hooks 定义、安装器、`.codex-plugin` 清单）**可以合法借用/改写**，注明出处即可。
- OmO 主仓库的内容（core 包代码、Ultimate 版 agent/hook/文档/manifesto 之外的技能等）**只能学思想，不能搬文本或代码做再分发**。
- LazyZCode 应全部自写 + 选自己的开源 license（建议 MIT/Apache-2.0），README 注明 inspired by OmO/lazycodex。

## 三、设计哲学（manifesto + ROADMAP）——lazyzcode 应直接采纳的几条

1. **"Human intervention is a failure signal"**——HUMAN IN THE LOOP = BOTTLENECK。人接管=系统失败（自动驾驶类比）。目标是大任务整块交接，不是小任务加速。
2. **"Indistinguishable code"**——agent 产出要和 senior 工程师无法区分：贴既有模式、完整错误处理、没有 AI slop（过度抽象/范围膨胀）。
3. **表达层级：Skill（静态知识，零运行时）> MCP > Tool > Hook**——能用技能文本解决的绝不写 hook；hook 是注入 agent 循环的最后手段。
4. **架构为 agent 的推理优化，不为人类可读性**："If that makes the directory structure messy for a human, the directory structure is wrong for humans and right for agents."
5. **对跨 harness 统一抽象公开怀疑**——不搞 grand unified plugin interface；"an agent can write a new adapter in one shot"，宁可适配器间重复也不过早抽象；每个组件用 markdown 文档表达行为，不用 interface 定义。
6. **Why Not OpenCode-Native 的教训**：允许向主循环任意注入的插件系统必然出现竞态、重复注入、死循环、状态污染（`session.prompt` 先返回后失败、多 hook 抢同一 idle 边沿）。→ **ZCode 的 Stop hook 续跑（≤3 次）和 additionalContext 注入是同类风险面，lazyzcode 的深循环必须放 CLI 状态机，hook 只做轻触发**——与上一份调研结论互相印证。

## 四、Monorepo 分层架构（ROADMAP 重构中）

```
Core（19 个纯 TS 包，宿主无关，可独立测试）
  ├─ omo-config-core    omo.json schema + walked 多层加载 + 原子写（senpi-first 落地）
  ├─ rules-engine       规则发现/匹配/排序/格式化/缓存（AGENTS.md + .omo/rules/**）
  ├─ agents-md-core     AGENTS.md 发现/注入/缓存
  ├─ skills-loader-core 技能加载 + builtin skills
  ├─ boulder-state      goal 状态机（ulw-loop 的核心：plan checklist/进度/会话存储）
  ├─ delegate-core      category→model 选择 + 重试指导
  ├─ team-core          team mailbox（ack/consumed-ledger/lease）+ tmux 布局
  ├─ hashline-core      LINE#ID 内容哈希锚定编辑
  ├─ memory-core        事实抽取/编译渲染/双进程并发（192 个文件，最大的 core 包）
  ├─ prompts-core / model-core / comment-checker-core / telemetry-core
  ├─ lsp-core / mcp-stdio-core / mcp-client-core / tmux-core
  └─ claude-code-compat-core / openclaw-core / utils
MCP 层：lsp-tools-mcp, lsp-daemon, ast-grep-mcp, git-bash-mcp
Adapters：omo-opencode(2708 文件) / omo-codex(745) / omo-senpi(934)+senpi-task / pi-goal / pi-webfetch
Platform：生成的 launcher 包（按平台二进制）
Web：omo.dev 站点
```

依赖规则：Adapters → Core/MCP/Skills，禁止反向；已知的两条例外边（senpi 同层、opencode→codex 过渡）都标注为待清除。**迁移方式是"纯移动"：拷进 Core→原位置 re-export→测试过→删重复**。这套分层纪律值得 lazyzcode 从第一天照抄（哪怕代码量小得多）。

## 五、核心组件细读（对 lazyzcode 有直接参考价值的）

- **boulder-state**（石头=目标）：ulw-loop 的状态机。plan checklist 有严格行语法（`- [ ] N. <title>` 实现项 / `- [ ] F<number>. <title>` 终验项，脚本校验非手写）；证据绑定 `git rev-parse HEAD^{tree}`；resume-safe 脚本（`scaffold-plan.mjs --draft-only` 先写草稿，批准后落正式 plan）。
- **hashline-core**：编辑工具是 harness 问题的根源（引 Can Bölük "The Harness Problem"）。`行号#哈希` 标签让模型引用稳定标识符编辑，文件变了哈希不匹配直接拒绝——Grok Code Fast 1 成功率 6.7%→68.3%。ZCode 的 Edit 工具自带 old_string 匹配机制，价值存疑，列为观察项。
- **delegate-core + 类别系统**：委托按 **category**（visual-engineering/deep/quick/ultrabrain，另有 artistry/writing/unspecified-low/high/自定义）而非直接选模型，category→model 自动映射；`quick` 类用便宜快速模型。GLM Coding Plan 单模型场景下降级为「轻/重分级」提示。
- **team-core**：mailbox 语义（ack、consumed-ledger、consumer-lease、lease 续租）、每成员独立 git worktree、按工作单元合并、冲突由 lead 裁决。Team Mode 默认关，两个骑乘技能：hyperplan（5 个敌意计划评审）、security-research（3 猎手 + 2 PoC 工程）。
- **memory-core**：事实抽取（人名生命周期、路由门控）+ 编译渲染（golden fixtures 回归）+ writer/reflection 双进程并发。Ultimate 版功能，Light 版没有——lazyzcode 首版可用 ZCode 内置 memory + AGENTS.md 覆盖。
- **rules-engine + agents-md-core**：AGENTS.md + `.omo/rules/**` 在每次 prompt 前注入，有距离/排序/缓存机制。ZCode 对应物：SessionStart hook 注入 + 工作区配置（ZCode 是否原生读 AGENTS.md **待验证**）。
- **omo-codex 适配器**（745 文件）：`src/install/` 是大量原子化小模块（cache-install/cleanup/config-toml/marketplace/permissions/telemetry…每个带 `.test.ts`），把「安装一个插件进宿主」拆成可测试的纯函数——lazyzcode 的 `lzy` CLI 安装器照这个组织方式。

## 六、技能体系

- **shared-skills（17 个，跨版本共享）**：ast-grep、coding-agent-sessions、data-scientist、debugging、frontend、git-master、init-deep、lsp-setup、programming、refactor、remove-ai-slops、review-work、ultimate-browsing、ulw-execute、ulw-plan、ulw-research、visual-qa。适配器用 `sync-skills.mjs` 同步进自己的插件目录（lazycodex 里的 start-work 等是 Codex 侧变体）。
- 仓库 `.agents/skills/` 是**开发 OmO 自身**的技能（publish、github-triage、codex-qa、opencode-qa、pre-publish-review、tech-debt-audit…），与产品技能分离——「吃自己狗粮」的结构值得学。
- 技能不只 prompt：领域指令 + 按需自带 MCP（skill-embedded MCPs，防上下文膨胀）+ 权限范围。
- 行为契约风格（应学习）：强制开场标记（`ULTRAWORK MODE ENABLED!`）、一次性 tier triage 只升不降、"TESTS ALONE NEVER PROVE DONE"、协议化子代理消息（`TASK:` / `WORKING:` / `BLOCKED:`）、等待退避（timeout 翻倍至 ~5 分钟而非空转）。

## 七、Agents 与编排

- 角色：**Sisyphus**（主编排，claude-opus-5/kimi-k3/gpt-5.6-sol/glm-5.2）、**Hephaestus**（自主深工，"给他目标不是菜谱"）、**Prometheus**（访谈式规划）、**Oracle**（架构/调试）、**Librarian**（文档/代码检索）、**Explore**（快速 grep）、Multimodal Looker、Metis（计划顾问）、Sisyphus-Junior（委托执行）。
- Ultimate 的 **IntentGate** 在分类前先分析真实意图；Light 只有 `ulw` 关键字识别（UserPromptSubmit hook）。
- **Background agents**：5+ 专家并行、上下文保持精简、完成时系统通知。
- 多 harness 子代理面差异极大（spawn_agent vs multi_agent_v1/v2 vs team_*），OmO 的解法是技能文本里写「工具映射表」+ 「if 与本节冲突以本节为准」——ZCode 版同样要写自己的映射段。

## 八、对 lazyzcode 的落地启示（在上一份报告基础上的增量）

1. **采纳「表达层级」为设计宪法**：SKILL.md 优先，hook 最少化。ZCode 7 个 hook 事件足够做触发/注入/守卫，其余全放技能与 CLI。
2. **分层照抄**：`core/`（纯逻辑：状态机、checklist 语法、证据哈希、配置）与 `plugin/`（skills/hooks/agents）与 `cli/`（安装器/doctor/loop）物理分目录，core 不 import 任何 ZCode API。
3. **深循环架构确认**：`lzy loop` CLI 状态机（boulder-state 思想自实现），ZCode Stop hook 只做 ≤3 次轻续跑与状态提醒——正好撞上 ZCode 的 3 次上限，两全。
4. **License 边界**：lazycodex（MIT）可借可改；OmO 主仓（SUL-1.0）只学思想。所有文本自写。
5. **待验证项**：ZCode 是否原生读取 AGENTS.md（决定 rules 注入做不做）；ZCode Edit 工具的 old_string 机制是否够用（决定要不要 hashline 类机制——大概率不需要）。
6. **差异化机会**：OmO 的多 harness 列表是 OpenCode/Codex/Pi/Senpi（Claude Code 都还在 exploratory），ZCode 不在其雷达上；且 ZCode 有内置 memory、codegraph MCP、computer-use/mobile 插件，是比 Codex CLI 更肥的宿主。

## 附：信息来源

- omc repo：README.md、ROADMAP.md、LICENSE.md、docs/manifesto.md、docs/reference/features.md（目录）、GitHub API 全量文件树（dev 分支，10,028 个 blob）
- 关键包结构：omo-codex/src/install、boulder-state、delegate-core、team-core、rules-engine、skills-loader-core、agents-md-core、memory-core
- lazycodex 仓库 LICENSE（MIT）
