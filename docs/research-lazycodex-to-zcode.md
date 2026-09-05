# 调研：lazycodex → LazyZCode

> 日期：2026-09-05。北极星：做一个适用于 ZCode 的、类似 [lazycodex](https://github.com/code-yeongyu/lazycodex) 的 agent harness。

## 一、lazycodex 是什么

**一句话**：给 OpenAI Codex 装的「agent harness / 工作流强化包」，类比 LazyVim 之于 lazy.nvim。它是 [oh-my-openagent (OmO)](https://github.com/code-yeongyu/oh-my-openagent) 引擎的 Codex 发行版（仓库里 OmO 以 git submodule vendor 在 `src/`），通过 `npx lazycodex-ai install` 安装，装完后在 Codex 里表现为一个插件 `omo@sisyphuslabs`（v4.19.4，MIT）。

### 1. 仓库结构

```
lazycodex/
├── bin/lazycodex-ai.js        # npm CLI：install / doctor / uninstall
├── plugins/omo/               # 真正的产品：一个 Codex 插件
│   ├── .codex-plugin/plugin.json   # 清单：skills/hooks/mcpServers/interface
│   ├── skills/                # 26 个技能
│   ├── hooks/                 # 23 个 hook 定义（覆盖 7 类生命周期事件）
│   ├── components/            # 16 个 TS 组件（bootstrap/codegraph/lsp/rules/ultrawork/ulw-loop/teammode/telemetry…）
│   ├── agents → ~/.codex/agents/   # 8 个子代理角色（explorer/librarian/plan/momus/metis/code-reviewer/qa-executor/gate-reviewer）
│   ├── model-catalog.json     # 按复杂度路由模型（"quota discipline"）
│   ├── shared/ + scripts/     # 共享代码 + 构建/安装/自动更新脚本
│   └── test/                  # 大量契约测试（skill-contract、hook-contract、payload-equivalence…）
├── .agents/plugins/marketplace.json
├── packages/web/              # Next.js 15 + Tailwind v4 文档站（lazycodex.ai，Cloudflare Workers）
└── src/                       # OmO 引擎 submodule
```

### 2. 核心工作流（用户可见的四个命令）

| 命令 | 角色 | 做什么 |
|---|---|---|
| `$init-deep` | — | 生成**分层 AGENTS.md** 项目记忆：根目录 + 按复杂度打分的子目录，深度默认 3 |
| `$ulw-plan` | Prometheus（规划顾问） | 探索优先，把模糊需求变成**一份决策完备的计划**写入 `.omo/plans/<slug>.md`；只写 plan 不碰代码。有 CLEAR/UNCLEAR intent routing（决定是否 interview 用户）、审批门、可选「高精度双评审」（momus + 独立 CLI review） |
| `$start-work` | — | 按 plan checklist 执行到全部完成；Stop hook 负责「续跑」 |
| `$ulw-loop` / `ulw` | Sisyphus（编排） | 目标循环直到「Oracle-verified completion」：目标注册进 `.omo/ulw-loop/` CLI 状态机、每步证据绑定 `git rev-parse HEAD^{tree}`、RED→GREEN、subagent 委派（TASK:/WORKING:/BLOCKED: 协议）、可选 team mode（每成员一个 worktree，按工作单元合并）。ultrawork 普通上限 100 轮、ultrawork 模式 500 轮 |

`ultrawork` 是一个**模式指令技能**：prompt 含 `ulw`/`ultrawork` 时由 UserPromptSubmit hook 注入 bootstrap 指向该技能；要求本轮第一条用户可见行是 `ULTRAWORK MODE ENABLED!`；先做 tier triage（LIGHT/HEAVY，决定流程重量），强调 "TESTS ALONE NEVER PROVE DONE"——必须用真实表面（HTTP/浏览器/CLI stdout）取证。

### 3. 靠什么机制粘合（对移植最重要）

- **Hooks 做自动触发与纪律**：23 个 hook 挂在 session-start（加载项目规则/遥测/自动更新/bootstrap）、user-prompt-submit（识别 `ulw` 触发词、ulw-loop steering）、pre-tool-use（goal 预算、spawn 守卫）、post-tool-use（comment 检查、LSP 诊断、项目规则匹配）、post-compact（重置缓存）、**stop / subagent-stop（start-work 续跑、executor 证据校验）**。
- **子代理做隔离与并行**：Codex 的 `spawn_agent` / `multi_agent_v1|v2` 工具面，`fork_context:false` 冷启动子代理，角色以 `agent_type` 传入（或写进 message）。
- **MCP 做代码智能**：codegraph、lsp-tools、git-bash 等 MCP 组件。
- **`.omo/` 目录做持久状态**：plans/、drafts/、ulw-loop/（goal 状态机 + evidence）、规则缓存。
- **技能文本本身是"宪法"**：26 个 SKILL.md 全是高强度行为约束（强制开场白、协议、禁令），配合 hook 注入保证被读到位。

## 二、ZCode 的扩展面（本机逐一验证）

### 1. 插件体系

- 清单：`.zcode-plugin/plugin.json`，字段与 Codex 的 `.codex-plugin/plugin.json` 高度同源：`name/version/skills/mcpServers/description_i18n/author/license`。已验证官方插件（document-skills）用 `skills:"skills"` + manifest 内嵌 `mcpServers`。
- 插件目录可含：`skills/`、`agents/`、`hooks/hooks.json`、`.mcp.json`、`scripts/`、`assets/`。
- Marketplace：`~/.zcode/cli/plugins/known_marketplaces.json`，源支持 **GitHub 仓库**和 **URL zip**（官方 CDN `cdn-zcode.z.ai`，目前 14+ 插件）。本机还添加了 `anthropics/claude-plugins-official`——说明插件体系与 Claude Code/Codex 生态同源，生态可借鉴。
- 安装记录：`installed_plugins.json`（含 sha256 校验、scope、cacheTransactionId）。
- ⚠️ 本地 plugin-creator 技能提示 manifest 的 `hooks` 字段会被 validation 拒绝——**hooks 走 `hooks/hooks.json` 文件更稳**（zcode-guide 明确支持该方式，且插件带 hook 会自动启用 hook runner）。

### 2. Hooks（与 Codex 大体对应，但有三个关键缺口）

- **7 个事件**：`SessionStart`（matcher: startup/resume/clear/**compact**）、`UserPromptSubmit`（matcher: prompt 文本）、`PreToolUse` / `PostToolUse` / `PermissionRequest` / `PostToolUseFailure`（matcher: 工具名正则，`Task`↔`Agent` 别名）、`Stop`（matcher: 回复预览）。
- 行为：stdout JSON 严格校验（`additionalContext` 注入对话；PreToolUse 可返回 allow/ask/deny；**Stop 可请求续跑，最多 3 次**）；exit 2 = block；模板变量 `${ZCODE_PROJECT_DIR}`、`${ZCODE_PLUGIN_ROOT}`；timeout 单位坑（command 秒 / process 毫秒）；`async` 无效。
- **缺口**：
  1. ❌ 无 `SubagentStop` —— lazycodex 的 subagent 证据校验/续跑需改为在主循环里 Agent 返回后处理；
  2. ⚠️ 无 `PreCompact` —— 但 `SessionStart(matcher=compact)` 可顶替 post-compact 场景；
  3. ⚠️ **Stop 续跑上限 3 次** —— lazycodex 的 100/500 轮循环不能靠 Stop hook 实现，深循环必须放在技能驱动的 CLI 状态机层（像 OmO 的 `omo ulw-loop` 那样），Stop hook 只做「轻提醒续跑」。

### 3. 子代理（agents/）

- 插件可带 `agents/*.md`，frontmatter 格式（已验证 document-skills 的 judge）：`name`、`description`、`tools`（白名单）、`color`，正文是 system prompt。
- 通过 Agent 工具调用，插件代理名为 `plugin-name:agent` 形式；有 `run_in_background` + `SendMessage` 通信 —— 能力上可覆盖 Codex `spawn_agent` + `wait_agent` 的用法，但**没有 `agent_type`/`fork_context` 参数**，所有技能里的 spawn 协议文本需要重写为「Agent 工具 + 子代理 prompt 自包含」。
- 内置：`general-purpose`、`Explore`（只读搜索）。

### 4. 其他可用底座

- **MCP**：用户级 `~/.zcode/cli/config.json` 的 `mcp.servers`（stdio/http+headers/env）；插件级 `.mcp.json`。本机已装 codegraph MCP —— OmO 的 codegraph 组件在 ZCode 上已有现成等价物。
- **内置 Memory**：per-project 持久记忆（`~/.zcode/cli/memories/projects/<hash>/memory/`），init-deep 的项目记忆可以和它互补（AGENTS.md 面向仓库/团队，memory 面向本机个人）。
- **内置 WebSearch/WebFetch、TodoWrite（计划 checklist 可镜像）**、computer-use/android/ios 插件（visual-QA 类技能有现成抓手）。
- **配置层级**：用户级 `~/.zcode/cli/config.json` + 工作区 `<repo>/.zcode/config.json` / `zcode.json` → 项目规则（rules 组件）可以落在工作区配置或 AGENTS.md。
- 技能来源：`~/.zcode/skills`、`~/.agents/skills`、插件 `skills/`、（可推断）工作区目录；技能即可被 `/name` 调用，等于 Codex 的自定义 slash command。

## 三、概念映射表

| lazycodex（Codex） | LazyZCode（ZCode 对应） | 备注 / 风险 |
|---|---|---|
| `.codex-plugin/plugin.json` | `.zcode-plugin/plugin.json` | 字段同源；hooks 用 `hooks/hooks.json` 而非 manifest 字段 |
| 23 hooks / 7 类事件 | 7 事件（见上） | SubagentStop→主循环处理；post-compact→SessionStart(compact)；Stop 续跑≤3 次→深循环下沉到 CLI 状态机 |
| `spawn_agent`/`multi_agent_v1|v2` + `~/.codex/agents/*.toml` | 插件 `agents/*.md` + Agent 工具（run_in_background/SendMessage） | 无 fork_context/agent_type 参数；角色 prompt 需自包含，spawn 协议文本全部重写 |
| AGENTS.md 分层记忆（init-deep） | 原样可用 + 内置 memory 互补 | 直接移植 |
| `.omo/` 状态目录（plans/ulw-loop/evidence） | 保留（建议改名 `.lazyzcode/` 或沿用 `.omo/` 以兼容习惯） | CLI 状态机照搬思路 |
| `omo` CLI（goal 状态机、doctor） | 自带 `lazyzcode`（或 `lzy`）CLI，Node/TS 实现 | 状态机放 CLI 层绕开 Stop 3 次限制 |
| model-catalog 多模型路由 | 基本不需要——模型由 ZCode host/GLM Coding Plan 管理 | 可降级为「复杂度分级」提示语 |
| codegraph / lsp-tools / git-bash MCP | codegraph MCP 已有现成；LSP 可评估 ZCode 内置能力后决定 | 首版可不做 |
| `npx lazycodex-ai install` | ZCode marketplace（GitHub 源或 URL zip）+ 轻量 CLI | doctor/uninstall 对等实现 |
| 遥测（PostHog）、自动更新 | 非必需，后置 | |

## 四、建议的落地路线

**Phase 0 — 骨架**：定插件包结构（`.zcode-plugin/plugin.json` + `skills/` + `hooks/` + `agents/` + `cli/`），本地安装/重载流程跑通（marketplace.json + cachebuster）。

**Phase 1 — 核心工作流（最大价值）**：移植五个核心技能并全面改写工具面：
- `ultrawork-z`（模式指令 + UserPromptSubmit hook 触发词注入 bootstrap）
- `ulw-plan-z`（Prometheus：探索→intent routing→审批→决策完备计划）
- `start-work-z`（checklist 执行 + Stop hook 轻续跑）
- `ulw-loop-z`（`lzy` CLI goal 状态机 + 证据绑定 git tree）
- `init-deep-z`（分层 AGENTS.md）

**Phase 2 — 角色与纪律**：`agents/` 角色（planner / reviewer / explorer / librarian 等价物）、plan 评审门、`.lazyzcode/evidence/` 取证规范。

**Phase 3 — 代码智能与规则**：接现有 codegraph MCP、项目规则（工作区配置 + AGENTS.md）、comment-checker、LSP 评估。

**Phase 4 — 分发**：`lzy doctor/uninstall`、marketplace 发布（GitHub 源）、文档站可选。

## 五、开放问题（需拍板）

1. **命名与触发词**：`lazyzcode`？CLI 叫 `lzy`？触发词用 `ulw`（沿用习惯）还是 `zw`？
2. **状态目录**：沿用 `.omo/` 还是新起 `.lazyzcode/`？
3. **单插件 vs 双仓**：OmO 是「插件仓 + 引擎 submodule」；我们首版可以单仓单插件（技能即产品），CLI 状态机作为插件内 `scripts/` 随包分发，不引 submodule 复杂度。
4. **多语言**：ZCode 用户群中文居多，技能文本用英文（模型遵循更稳）+ 中文文档，还是双语 frontmatter（plugin manifest 已支持 `description_i18n`）？
5. **版权姿态**：OmO 是 MIT；结构可借鉴，但技能文本建议重写并注明 inspiration，避免整段搬运。

## 附：信息来源

- lazycodex 仓库（GitHub API 全量文件树 + raw 关键文件：plugin.json、ultrawork/ulw-loop/ulw-plan/init-deep SKILL.md）
- oh-my-openagent README
- 本机 ZCode 实测：`~/.zcode/cli/config.json`、`installed_plugins.json`、`known_marketplaces.json`、官方 marketplace CDN、document-skills（plugin.json + agents/judge.md）、zcode-guide 的 `diagnosing-hooks` 技能（hooks 全schema）、plugin-creator 技能
