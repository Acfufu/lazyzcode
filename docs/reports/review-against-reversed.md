# 报告复核：基于 ZCode / Codex Desktop 逆向源码的事实核验

> 复核日期：2026-09-05
> 证据源：`/Users/acfufu/Codehub/ohmyzcode/reversed/reversed-zcode`（ZCode Desktop v3.11.2，build 89817f5b，Electron 41.0.3）
> 　　　　`/Users/acfufu/Codehub/ohmyzcode/reversed/reversed-chatgpt`（OpenAI Codex Desktop 26.901.31953，Chromium 152）
> ※ 2026-09-06 起逆向源码统一以 **`/Users/acfufu/Codehub/reversed/`** 为准（zcode.cjs sha256 与复核时副本一致，本文全部行号继续有效）。
> 被复核对象：本目录 `lazyzcode-report-{full,pm,dev}.html` 与 `index.html`（事实来源为 docs/ 下两份调研底稿）
> 方法：报告中的每条 ZCode / Codex 事实主张 → 在逆向还原源码（prettier 反压缩，字符串/控制流与发布版一致）中逐条 grep 定位。

---

## 总评

报告的**核心架构结论全部经源码检验成立，且更强了**：ZCode 钩子确为 7 事件、Stop 续跑硬上限确为 3、Codex 侧钩子面比报告写的还要大（12 事件 vs ZCode 7 事件）。"深循环下沉 CLI 状态机 + 钩子只做轻触发"这条最重要的架构决策不但没错，理由反而更硬。

但报告有 **4 处事实错误需要修正**（全部源于把 zcode-guide 官方文档当作引擎现状，而 v3.11.2 引擎已领先文档），并有 **6 项逆向新发现**是报告未覆盖的机会/细节，其中两项直接改变 Phase 0/P3 的工作量估算。

---

## 一、报告主张 → 源码证据对照（证实部分）

| 报告主张 | 源码证据（reversed-zcode/source/cli/zcode.cjs） | 结论 |
|---|---|---|
| 钩子恰为 7 事件，无 SubagentStop/PreCompact | 事件枚举 `on = {SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, PostToolUseFailure, Stop}`（:36716），events 对象 `.strict()` 校验，多写即拒 | ✅ 精确证实 |
| Stop 续跑硬上限 3 次 | `Idi = 3`（:483805）；`shouldContinueAfterStopHooks: stopShouldContinue && additionalContexts.length > 0 && count < 3`（:483767） | ✅ 精确证实 |
| 模板变量只认 ZCODE_PROJECT_DIR / CLAUDE_PROJECT_DIR / CLAUDE_SESSION_ID / ZCODE_PLUGIN_ROOT | switch 分支 ：241439-241448、:459970-459984 | ✅ |
| matcher 别名 Task↔Agent、Write/Edit←ApplyPatch | `JUo = new Map([["Agent",["Task"]],["Task",["Agent"]],["ApplyPatch",["Write","Edit"]]])`（:280240） | ✅ |
| command 型 timeout 单位秒、process 型 timeoutMs 毫秒且优先 | schema：command 同时有 `timeout`(正数) 与 `timeoutMs`(正整数)；process 仅 `timeoutMs`（:36772-36790） | ✅ |
| stdout JSON 严格校验，多余 key 出错 | zod strict 解析失败即抛 `Hook stdout failed HookJSONOutput schema validation`（:460724） | ✅ |
| 配置钩子需 enabled:true，插件钩子自动启用 | `e.config.enabled ? zni(e) : []`（:460787）；官方 diagnosing-hooks SKILL.md 同文 | ✅ |
| 内置 agent：general-purpose、Explore | `DOt = {GeneralPurpose:"general-purpose", Explore:"Explore"}`（:38841） | ✅ |
| Codex 有 SubagentStop / PostCompact 等钩子 | Codex Desktop 原生 Settings→Hooks UI，12 事件全集（见下文 §3.2） | ✅ 且差距更大 |
| Codex 的 spawn_agent / multi_agent_v1\|v2 协议 | renderer 特性门 `features.multi_agent_v2.max_concurrent_threads_per_session`（min 8，app-primary chunk） | ✅ |
| ZCode 内置记忆 / codegraph / computer-use 独有资产 | 记忆注入段 `MEMORY.md` 与 AGENTS.md 同段注入系统提示词（:278759）；cua-helper + ax_native.node（NATIVE-ASSETS.md） | ✅ |

**新增证实（报告没写到的实现细节，对 lzy loop 设计重要）：**

1. **Stop 续跑需要非空注入**：`additionalContexts.length > 0` 是续跑的必要条件。Stop 钩子输出空 JSON 永远不会触发续跑；要续跑必须带 `additionalContext`，或 exit 2（reason 会变成注入文本）。
2. **3 次预算是共享的**：ZCode 自身的后台任务通知（task-notification 邮箱，drain 上限 20）也在 Stop 事件上发 `continue:true` 抢同一个 3 次预算（:460924-460948）。lzy loop 的 Stop 钩子预算要与后台 Agent 通知互相预留。
3. **钩子输出里 `hookSpecificOutput.hookEventName` 必须与事件名一致**，不一致直接抛错（:460150）。

---

## 二、需要修正的 4 处事实错误

### 修正 1（影响路径 D 论证）："GLM 单栈"不成立

- 报告：§9 工具翻译表 "model-catalog.json 多模型路由 → 不需要（GLM 单栈）"；路径 D 优势 "GLM 单模型定价简化模型路由"。
- 源码：v3.11.2 内置模型目录 `models_catalog_china_llm_zcode_2026-06-03.json` 含 **10 个 provider**：GLM（zai / bigmodel 各 4 通道，23 模型）、Kimi（11）、MiniMax（8）、DeepSeek（2）、Qwen（国内/国际各 6）、小米 MiMo（5），协议以 Anthropic Messages 为主。
- 修正表述：ZCode 默认走 GLM 编码套餐，但**宿主本身是多模型目录架构**。"简化模型路由"不能作为路径 D 的优势项；LazyZCode 若做多模型预算护栏（tier 分级、3× token 防线），模型维度反而是可用抓手。
- 涉及文件：full §5/§9、pm §4.4/路径 D、dev §6 对照表。

### 修正 2（避坑 #9 过时）：`async` 字段现在真的生效

- 报告：避坑 #9 "async 字段当前无效果，钩子全部内联执行"。
- 源码：command 钩子 `async: true` → `runBackgroundHook()` **后台执行、不阻塞回合**（:460404-460421），执行完只发生命周期遥测。**但 stdout 输出被丢弃**——后台钩子的 JSON 注入不生效。
- 修正表述："async 生效为后台 fire-and-forget：不阻塞会话，但输出不注入。想要注入必须同步。" 对 LazyZCode 这是**新能力**：PostToolUse 异步取证钩子（截图/日志归档）可以不占主循环时间；同步注入类钩子仍必须快。
- 注：该条与官方文档冲突，属文档滞后于引擎。

### 修正 3（避坑 #11 不完整）：exit 2 在 Stop 上有意义——正是"拒绝停止"

- 报告：避坑 #11 "exit 2=拦截（仅 PreToolUse/PermissionRequest 有意义）"。
- 源码：exit 2 的事件映射（:460745-460763）：PreToolUse→deny；PermissionRequest→deny；**Stop→`decision:"block"`，即拒绝结束回合并强制续跑**，reason/systemMessage 注入为上下文（:460138-460147）；其余事件→continue:false。
- 修正表述：exit 2 在 **PreToolUse / PermissionRequest / Stop** 三处有语义；Stop 上它就是 Claude Code 同款的"block = 再跑一轮"。这是比 additionalContext 更强的续跑原语，lzy loop 的 Stop 轻钩子可直接用它（同样受 3 次预算约束）。

### 修正 4（dev 版"坑位预告"）：清单里的 hooks 字段并未被拒

- 报告：dev §2① "官方 plugin-creator 技能写明，清单里的 hooks 字段会被校验拒绝：钩子要放 hooks/hooks.json，不要写在 plugin.json 里"。
- 源码：引擎把 `manifest.hooks` 作为**一等加载源**：支持字符串路径 / 路径数组 / 内联对象，与 `hooks/hooks.json` 并行读取并按 realpath 去重（`iit`，:241528-241598）。只有事件名非法时降级为 warning（`plugin_hook_unsupported_event`，跳过该事件而非整个插件失效）。
- 修正表述："文档口径建议 hooks/hooks.json，引擎实际两者都支持（v3.11.2 实测源码）"。工程上仍建议随大流放 hooks/hooks.json，但"直接照搬会翻车"的表述应撤下。

---

## 三、逆向新发现（报告未覆盖）

### 3.1 ZCode 插件发现层原生兼容四种清单风格 —— 路径 C 重大利好

`NodeSkillAdapter` 的清单候选：**`.zcode-plugin/plugin.json`、`.claude-plugin/plugin.json`、`.codex-plugin/plugin.json`、`.cursor-plugin/plugin.json`**（:240428-240433）。即 Claude Code / Codex / Cursor 插件可能**免改名装载**（skills 至少如此；hooks 挂 `hooks/hooks.json` 相对路径即可，事件名不支持只 warning）。

- 对路径 C：lazycodex 的 `.codex-plugin` 清单结构可能无需翻译即可被 ZCode 识别 → "插件清单结构可合法改写"升级为"可能免改写"，P0 工作量下修。
- 对产品：LazyZCode 可维持 Claude Code 兼容形态双宿主分发，成本近乎零。
- **待真机验证**：清单字段 schema（skills/mcpServers 字段名差异）、四种风格的加载优先级。

### 3.2 Codex 原生钩子是 12 事件，不是 7 —— 缺口更大，架构决策更稳

Codex Desktop 26.901 设置内有原生 Hooks UI（`hooks-settings-copy-*.js` 全量文案）：PreToolUse / PermissionRequest / PostToolUse / **PreCompact / PostCompact** / SessionStart / **SessionEnd** / UserPromptSubmit / **SubagentStart / SubagentStop** / Stop / **Interrupt**。

- ZCode 7 事件缺：SubagentStart、SubagentStop、PreCompact、PostCompact、SessionEnd、Interrupt —— 报告 §7 缺口表只列了 2 个，实为 **6 个**。
- 不影响"CLI 状态机"结论（反而强化：靠钩子补齐更不可能）；其中 SessionEnd/Interrupt 若 ZCode 未来补齐，可用于状态机"中断落盘"审计，可记入 P3 观察项。

### 3.3 AGENTS.md 待验证项①可以关闭：ZCode 原生自动读 AGENTS.md

报告 §6/§13 留了两个待验证项。逆向直接关闭第一个：

- 引擎有完整 context source 管线：从工作目录**逐级向上**查找 `AGENTS.md`（候选 `Q3n = ["AGENTS.md"]`），优先试 `~/.zcode/AGENTS.md` 用户级与 `.zcode/AGENTS.md`，多源合并，**100KB 截断**（`X3n = 100*1024`，:56193-56330）。
- 合并结果作为 `# agentsMd` 段注入系统提示词，与内置记忆 `MEMORY.md` 同段（`xUo`，:278743-278762）；另有官方 /init 命令生成 AGENTS.md（:23960）。
- 结论：**P3 的"项目规则自动注入钩子"不用做了**（原生已做）；init-deep-z 技能应按"生成分层 AGENTS.md + 依赖原生加载"设计。
- 待验证项②（Edit old_string 稳定性）逆向未覆盖渲染层编辑器实现，维持待真机验证。

### 3.4 工作区钩子正长出"信任门"——避坑 #12 的前提在松动

引擎已实现完整的工作区钩子准入体系（`WorkspaceHookRuntimeAdmission`，:461375-461500）：`workspace_hooks_pending_trust` / `blocked_by_policy` / `policy_requires_pretrust` / `trust_store_corrupt` / `snapshot_mismatch` / `bundle_changed`，带 digest 指纹与安全修订校验。当前官方文档仍写"无信任门"，但灰度面已在（feature disabled 遥测分支）。

- 对**插件分发**（插件钩子走 `plugin.*` source）暂无影响 → 支持报告"插件 + CLI"形态。
- 对**让用户往 config.json 手挂钩子**的任何安装器设计是风险：未来可能需要 UI 信任确认。安装器应坚持"装插件"而非"改配置"。

### 3.5 原生取证与调度资产（报告只提了一半）

- **内置 browser-use 插件（MIT，v0.4.2）**：打开/导航/点击/截图/录 WebM/页面校验 —— 终验波 F 项"真实表面证据"的现成取证面，比报告提的"官方市场 computer-use 插件"更直接。内置 8 插件另有 zcode-cua（原生 AX 树桌面操控）、android-emulator、ios-simulator。
- **原生调度器**：独立 scheduler 进程 + `~/.zcode/v2/tasks-index.sqlite`，支持 automation（cron）与 off-peak 模式。"无人值守深循环"除外部 lzy loop CLI 外存在宿主内路径（用 ZCode 自动化定时唤起状态机下一步）——建议记入 Phase 3 备选，与外部 CLI 对比后再定。

### 3.6 签名 / 打包细节（补充置信度）

ZCode Desktop v3.11.2 为 Developer ID 签名 + asar 完整性 fuse；zcode.cjs（CLI 引擎，56.7 万行还原）即钩子/技能/插件的运行时权威。本次全部钩子结论以该引擎为准，**引擎版本领先本机 zcode-guide 文档**——报告后续更新时应"以逆向引擎为事实源、文档为辅"。

---

## 四、对三份报告的具体改法清单

| # | 位置 | 改法 |
|---|---|---|
| 1 | full §5 / pm §4.4 / dev §6："GLM 单栈" | 改为"默认 GLM 套餐、宿主内含 10 provider 多模型目录"；删除"简化模型路由"优势项 |
| 2 | 三版避坑 #9 | 改为"async 生效为后台 fire-and-forget（不阻塞、输出不注入）"，并补"异步取证钩子"用法 |
| 3 | 三版避坑 #11 | 补 Stop 的 exit 2 = block = 强制续跑语义（受 3 次预算约束） |
| 4 | dev §2① 坑位预告 | 改为"文档不建议、引擎 v3.11.2 实际支持 manifest.hooks（路径/数组/内联）" |
| 5 | full §6 / pm §4.4 "7 个生命周期钩子" | 补一句实现细节：续跑需非空 additionalContexts；3 次预算与后台任务通知共享 |
| 6 | full §7 缺口表 | 缺口从 2 个改为 6 个（SubagentStart/Stop、Pre/PostCompact、SessionEnd、Interrupt）；结论不变、理由更硬 |
| 7 | full §6/§13 待验证项① | 关闭：AGENTS.md 原生自动读已证实（含 100KB 截断与 # agentsMd 注入）；P3 砍掉规则注入钩子 |
| 8 | full §4.4 / dev §3 独有资产 | 补内置 browser-use（MIT）为取证面；补原生 scheduler 为 P3 备选 |
| 9 | 路径 C 优势 | 补"四风格清单兼容（.codex-plugin 可能免改名装载，待真机验证）"，P0 工作量下修 |
| 10 | 避坑 #12 / 风险登记册 R3 | 补工作区钩子信任门灰度（workspace_hooks_* 策略码）；安装器坚持插件分发 |

## 五、复核结论

- **架构决策（CLI 状态机 + 轻钩子 + 插件分发 + MIT）**：源码检验后全部维持，置信度提升。
- **事实错误**：4 处（§二），集中在"文档即现状"的假设，均已有源码行号级证据。
- **新增机会**：6 项（§三），其中清单四风格兼容与 AGENTS.md 原生加载直接下修工作量。
- **方法论建议**：报告口径统一改为"以 reversed-zcode（v3.11.2 引擎源码）为 ZCode 侧事实源"；zcode-guide 文档仅作 schema 参考并标注滞后风险。
