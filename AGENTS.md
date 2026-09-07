# LazyZCode — 项目宪法（Agent 与贡献者必读）

给 ZCode 造一个 lazycodex 同款的「AI 编码工作流纪律层」：让 AI 不只写代码，而是**计划 → 执行 → 拿证据 → 不做完不停**。本文件是本仓库的单一事实入口：ZCode 原生自动读取（无需任何配置），模型读完即可在本仓正确干活；细节引用 `docs/`，不在此复制。

## 1. 北极星

做 ZCode 版的 [lazycodex](https://github.com/code-yeongyu/lazycodex)（OmO 引擎的 Codex 发行版，MIT）。形态：**ZCode 插件 + 轻量 CLI（`lzy`）**——插件承载 skills/hooks/agents（纪律层），CLI 承载目标循环状态机与安装器。完整背景与论证见 `docs/reports/index.html`。

## 2. 当前状态与下一步（2026-09-06）

- 调研、逆向源码复核、六项关键决策拍板：**已完成**（见 §4）。
- **P0 首日三 spike 全部完成**（2026-09-06，结果与证据：`docs/spikes/p0-day1.md`；五个探针与仓库 `test/spike/` 均已按约删除）：
  - Spike 1（Edit old_string）：✅ hashline 不需要（P3 观察项关闭）；新红线「old_string 必须带原样精确缩进」。
  - Spike 2（四风格清单）：✅ 安装型插件 **.zcode/.claude/.codex 三风格免改名装载成立，cursor 风格 cache 路径拒绝**（仅工作区可用）；**安装型插件必须「安装+启用」两步**（启用写 config `plugins.enabledPlugins`，只装不启用=没装）。
  - Spike 3（Stop 注入/预算）：✅ 非空注入续跑、**≤3 硬顶**均活体实锤；同池扣减维持源码结论；新设计约束「Stop 钩子状态须按 sessionId 隔离」。
- P0 骨架已落地（2026-09-06）：`plugin/ + core/ + cli/`，`lzy install/sync/status/uninstall` 端到端实测，本机已自举安装（`lazyzcode:zw` 技能可装载）；ADR-0001 已拍板：启用走引擎官方 `plugins enable`，**lzy 对 config.json 零写入**。`core/engine.js`（lzy→引擎调用层）已落位（2026-09-06）：此前被 Mimosa 守卫内容级拦截（凡 spawn/exec 即 deny、安全形态亦拦、无 UI 放行入口），**经授权跑深度安全扫描取得封印（0 findings）后写入放行**——「扫描封印」是解拦正道；实现为安全形态（路径解析归 paths 模块、执行归 engine 模块，每调用点字面量子命令数组 + `shell:false`），install/uninstall/status 全生命周期实弹验证（官方 enable/uninstall 路径均通），引擎环节全自动、不再走指引式回退。
- **P1 核心已落地（2026-09-06）**：`lzy loop/step` 目标循环状态机（注册→计划门[决策完备，TBD 拦截]→逐步收口→F 项证据绑 `HEAD^{tree}`→finish 终验[证据过期即拦]；状态在 `.lazyzcode/loop/`）+ 插件 SessionStart/Stop 钩子（`hooks/hooks.json`，sessionId 隔离计数、Stop 预算 ≤2 预留 1、异常一律 fail-open）+ `zw` SKILL.md 全量编排文本（英文）。实证：scratch 仓全状态机 E2E 全绿；钩子 stdin 行为矩阵全绿；引擎 `plugins list` 注册 `hooks:2`。已知限制：headless 驱动引擎需登录/API-key 配置（V4 签名凭据，桌面端运行时注入），活体注入由 Spike 3 背书，真实会话验收顺延。
- **P2 角色与纪律已落地（2026-09-06）**：三只读子代理角色 `plugin/agents/`（explorer 侦察 / plan-reviewer 计划评审 / qa-executor 证据执行，英文 prompt + 固定输出契约，引擎对 agents/ 目录自动发现无需 manifest 声明）+ 计划评审门（`lzy loop plan --review` 记录评审，**REVISE 判决拒绝采纳且 --force 不越过**；HEAVY 强制过门、LIGHT 自查）+ UserPromptSubmit 触发词钩子（zw/ulw/ultrawork 注入 zw 引导，词边界匹配防误触）。实证：触发词矩阵/评审门三态/引擎注册 hooks:3 全绿。
- **MVP 活体验收通过（2026-09-06）**：五项检查全 ✅——检查 1 活体（真实会话 `zw 继续` 首行 `**ZW** engaged`）、检查 4 活体（Stop 拉回 1/2→2/2 后止，用户明令优先）、检查 2/3/5 CLI 实证（评审门 PASS+--review、F 项无证据拒绝、改码后「过期 1 finish 会被拦」）；记录在探针仓 `ACCEPTANCE-RECORD.md`（探针可删）。**Mimosa deep 复扫 0 findings（seal sha256:81151e73…，依赖面 partial 如实记账）**。
- **P3 资产整合已落地（2026-09-06）**：comment-checker PostToolUse 轻钩子（goal.json 在场闸门、命中 TODO/FIXME/XXX/HACK 与调试残留经 additionalContext 轻提示不阻断、上限 5 处 ≤300 字符、fail-open；PostToolUse 输出契约逆向实锤 zcode.cjs:36794-36796）+ codegraph 接线（zw SKILL.md/explorer.md 补索引侦察指引；status.js 增 codegraph 诊断，**缺席=skip 不翻转退出码**；paths.js 增 userCliConfigPath 只读解析）+ browser-use 取证面文本（SKILL.md/qa-executor 补 ego-browser/curl 手法，control-browser 仅主代理）。实证：模拟 stdin 三场景 + status 检查行 + 引擎注册 hooks:4。
- **P4 发布就绪已落地（2026-09-06）**：`lzy doctor`（status 全套 + hook 语法自检[vm 解析 worker，含 hooks.json 注册校验]/node 下限/lzy 解析/状态卫生/平台立场，零遥测）+ 发布材料（LICENSE、package.json 去 private + files 排除 .mimosa、CHANGELOG、npm scripts 补全）+ README 用户 10 分钟快速开始 + docs 脱敏；`npm publish --dry-run` 实证 24 文件零敏感物。**真发布待用户动作**。
- **五轮双审核 + 修复轮已落地（2026-09-06/07）**：报告 `docs/reviews/`（41 发现：0 P0/2 P1/15 P2/24 P3，红线全部活体证实）；修复轮收口全部 P1+P2（abandon 修复、注册表防损坏、原子部署、跨进程锁等），新增契约测试三件套 + GitHub Actions 与发布备料（repository 元数据 + `docs/release-checklist.md`）；剩余 24 条 P3 按「顺带修」记账（评审报告处置记录）。
- **P3 清账 + 钩子环境加固已落地（2026-09-07，goal p3-sweep-hook-env）**：评审剩余 17 条 P3 全修（R2-12 维持不修）；实锤「GUI 直启场景引擎 env PATH 无 node → 裸 `node` 钩子静默全灭」（`docs/diagnostics/2026-09-07-hook-spawn-env.md`）→ 四钩子改走 `run-hook.sh` 启动器（nvm/homebrew fallback）+ doctor 增 `hook-node`；契约测试增至 22 用例。
- **限流纪律已落地（2026-09-07，goal rate-limit-discipline）**：用户 zw 会话撞 GLM 套餐账号级 1302/429（多会话并发打满；实测 ≤5 活跃会话安全、≥6 持续撞线）。`lzy doctor` 增 `rate-limit` 体检（近 2 日引擎日志只读流式扫描：429 计数/判死/lastAt/经验并发带，warn-only；自适配=经验测量，决策 #16）；zw SKILL.md 增 Rate-limit discipline 段（一次一循环/子代理默认串行/risk trumps quota/429 判死恢复）。底稿 `docs/research-glm-plan-rate-limit.md`（A/B 双审定稿）。
- **限流体检 v3 + 触发词分层已落地（2026-09-07，goal rl-v3-trigger-strata）**：doctor rate-limit 升级回合计数
  （turnId 复合键去重，覆盖率不足降级首撞口径）/脏桶直方图/最长连撞/集中段三门槛/三分支话术，建议行改实测边界
  （固定 ≤3 废除）；触发词分层=bare zw 仅句首、lazyzcode:zw 显式全名、ulw/ultrawork 不变，注入文案条件双路（R4-4 变更记账）。
- **钩子启动器活体复验通过（2026-09-07，GUI 直启新会话）**：zw 触发词 UserPromptSubmit 注入恢复
  （原文到达对话）；本会话四类钩子事件 hook.run.failed=0，当日旧会话对照 551 条/20 会话全灭
  （PostToolUse 469/UPS 33/Stop 29/SessionStart 20）；doctor hook-node 实锤启动器兜底解析
  nvm node。诊断记录 §4 复验口径三条全数兑现。
- **文档站与品牌资产已落地（2026-09-07，goal docs-site-redesign）**：双语 guide（lazycodex.ai/docs 同构，en/zh 各 18 节锚点）+ Jekyll Pages 站（source=/docs，GFM 渲染）+「Verified Mark」品牌资产（mark/logo/favicon SVG，Z 末笔收于证据圆点）+ 版面重设计（暗色设计系统/侧栏五组图标/scrollspy）；验证工具链入库 `scripts/docs-preview/`（构建/爬链/锚点三脚本，dev-only 独立依赖，根包零依赖不破）。后续增量：开发者图文页、三态主题+多端适配、全局语言胶囊、头部顺序（92649d6…e0dafbf）。
- **tier-2 增量已落地（2026-09-08，狗粮驱动）**：F 项证据附件（`--evidence-file` 复制入 `.lazyzcode/evidence/` 绑 sha256，≤4/项）+ 证据包导出（finish 自动归档 + `lzy loop export`，reset 不清）+ 带内调度建议（`bandAdvisory` 实测数据→并行上限，`lzy loop start` 打印并发纪律行，fail-open）+ finish 收尾写项目 memory（技能文本承载，零新钩子）；狗粮：10 目标全流程、钩子失败 568→1、限流集中本地 0–3 点。
- **tier-1 init-deep 已落地（2026-09-08，ADR-0002）**：独立技能 `lazyzcode:init-deep`（分层 AGENTS.md 项目记忆；草稿先行、人点头才写、已有文件只出补丁）+ `core/agentsmd.js` 确定性资格谓词/覆盖审计 + `lzy agents-md` 详单 + doctor `agents-md` 检查（warn-only，根缺失=skip）；深度 3 零旗标；只写 AGENTS.md 层（仓库面），memory 归 zw 收尾。
- **tier-1 无人值守已落地（2026-09-08，ADR-0003）**：调度走宿主自动化、lzy 零写入零调度代码；唤起协议六条在 zw SKILL.md Unattended 段（句首「zw 继续」、只推进 executing、planning 态不立新计划干净退出、Stop 预算/429 判死自然封顶、≥1h 间隔）；doctor 增 `schedule` 行（`scheduleAdvisory` 从实测集中段反推错峰窗口，无证据=skip）。
- 下一步：真发布（用户按 `docs/release-checklist.md` 择机执行）；运行期反馈迭代。

## 3. 硬约束（ZCode v3.11.2 引擎源码实锤，设计前必读）

1. 钩子恰为 **7 事件**（SessionStart/UserPromptSubmit/PreToolUse/PermissionRequest/PostToolUse/PostToolUseFailure/Stop）。对比 Codex 原生 12 事件**缺 6 个**：无 SubagentStop/SubagentStart/PreCompact/PostCompact/SessionEnd/Interrupt。
2. Stop 续跑 **≤3 次**，且必须带**非空** additionalContexts（输出空 JSON 永不续跑）；exit 2 在 Stop 上 = block = 强制续跑（reason 注入为上下文）。
3. 3 次预算是**共享池**：ZCode 后台任务通知也发 continue:true 抢同一预算——本项目的 Stop 钩子预算要与后台通知互相预留。
4. ZCode **原生自动读 AGENTS.md**（逐级向上查找 + `~/.zcode/AGENTS.md` 多源合并 + 100KB 截断，以 `# agentsMd` 注入）→ 规则注入钩子不需要做。
5. 宿主内置**多模型目录**（10 provider，默认 GLM 套餐）→ tier 预算护栏可借模型维度，不自研模型路由。
6. 工作区钩子**信任门已在引擎灰度**（`workspace_hooks_*` 策略码，文档未提）→ 永不改写用户 config.json（见 §5 红线）。
7. 事实源优先级：**reversed-zcode 引擎源码 > zcode-guide 官方文档**（文档存在滞后，已实证 4 处）。
8. **cache 安装型插件默认禁用**：装载需「安装+启用」两步，启用态在 config `plugins.enabledPlugins`（Spike 2 实测）；cache 清单候选仅 `.zcode/.claude/.codex` 三种，`.cursor-plugin` 仅工作区 walk-up 路径接受。

## 4. 决策速查表（2026-09-06 拍板，变更须同步本表）

| # | 决策 | 定案 |
|---|------|------|
| 1 | 总体路径 | **D 全自研**；lazycodex（MIT）作底稿借鉴，OmO（SUL-1.0）只学思想 |
| 2 | 范围投入 | **开源完整版 P0~P4**（约 2 个月，单人+AI 结对）；MVP（P0+P1，2~3 周）为首个验收里程碑 |
| 3 | 许可证 | **MIT**，不预留商业版 |
| 4 | 产品形态 | **插件 + 轻量 CLI**（Stop≤3 等硬约束推出，见 §3） |
| 5 | 命名 | 项目 **LazyZCode**；npm 包 `lazyzcode`；CLI 命令 `lzy`；触发词 **`zw` 主词 + `ulw`/`ultrawork` 兼容别名** |
| 6 | 状态目录 | **`.lazyzcode/`**（plans/drafts/loop/evidence；与宿主 `.zcode/` 划清边界） |
| 7 | 技能文本语言 | **英文 SKILL.md + 中文文档**；manifest `description_i18n` 折中 |
| 8 | P3 范围 | **只整合现有资产**：codegraph 接线、comment-checker（PostToolUse 轻钩子）、内置 browser-use 取证面、原生 scheduler 记入备选；规则注入钩子已砍 |
| 9 | 遥测 | **完全无遥测**；诊断由 `lzy doctor` 本地输出承担 |
| 10 | 验证排期 | 三 spike 已完成（2026-09-06）：Edit / 四风格装载 / Stop 注入与 ≤3 硬顶均实证，详见 `docs/spikes/p0-day1.md` |
| 11 | 设计红线 | 见 §5，两条，直接生效 |
| 12 | 安装器路线 | 装 = cache 落位 + 注册表幂等写；启用 = 引擎官方 `plugins enable`；**config.json 零写入**（ADR-0001，2026-09-06） |
| 13 | Stop 预算细分 | lzy Stop 钩子每会话最多请求 **2 次**续跑，预留 1 次给引擎后台通知（红线 #2 具体化；计数按 sessionId 隔离，2026-09-06） |
| 14 | 证据时效语义 | F 项证据绑 `HEAD^{tree}`（提交粒度）：**先提交再取证**；未提交改动不入 hash，工作区脏时 CLI 警告（`.lazyzcode/` 自身不计脏，2026-09-06） |
| 15 | P2 纪律阵容 | 三只读角色（explorer/plan-reviewer/qa-executor）；计划评审门 **REVISE 拒绝采纳、--force 不越过**，HEAVY 强制过门 / LIGHT 自查；触发词钩子做（UserPromptSubmit，词边界防误触）（用户拍板 2026-09-06） |
| 16 | 限流自适配路线 | **经验测量**，非声明式配置：套餐档位本地不可探测（2026-09-07 实查），doctor 从本地日志实测 429 压力与经验并发带，零新增配置面（用户拍板 2026-09-07） |

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
  reports/                   ← 报告中心（index.html + full/pm/dev 三份 HTML）+ 逆向源码复核记录
  guide/ developers/         ← 用户文档 + 开发者图文页（lazycodex.ai/docs 同构，双语；Pages 内容源）
  _layouts/ _includes/ assets/ _config.yml index.md  ← GitHub Pages 骨架（Jekyll/GFM，source=/docs）
  spikes/p0-day1.md          ← P0 首日三 spike 结果（Edit/四风格/Stop 预算，已全部完成）
  adr/000{1,2,3}-*.md         ← 安装器 enable 走引擎 CLI、config 零写入 / init-deep 角色分配 / 无人值守走宿主自动化
  reviews/ release-checklist.md  ← 评审报告/处置记录（2026-09-06/07/08）+ 发布清单（13 步含 Pages）
  diagnostics/               ← 运行环境诊断记录（钩子 spawn env / shell PATH，2026-09-07 起）
plugin/ core/ cli/           ← P0 骨架：插件载荷 / 共享逻辑 / lzy CLI（见 README）
test/  .github/              ← 契约测试三件套（node:test 零依赖）+ CI 骨架
scripts/docs-preview/        ← 文档站本地预览与校验工具链（dev-only 独立依赖，根包零依赖）
README.md（英）+ README.zh-CN.md（中）LICENSE CHANGELOG.md  ← 开源门面（lazycodex 同构双语说明）
artifacts/                   ← 本地产物（已 gitignore，不入库）
```

## 8. 语言（先查此表再造词；与本表冲突以本表为准）

**纪律层（discipline layer）**：本产品的价值层——计划门、证据验证、防半途而废。
_Avoid_: 工作流强化层

**目标循环（goal loop）**：`lzy loop` 驱动的「注册目标→逐步派发→证据验证→完成」状态机循环。
_Avoid_: 深循环（仅架构讨论语境）、ulw-loop（上游名）

**证据（evidence）**：绑定 tree hash 的真实表面取证（HTTP 返回/截图/CLI stdout）。
_Avoid_: 测试结果（测试全绿≠证据）

**tree hash**：`git rev-parse "HEAD^{tree}"` 的内容快照哈希；代码一变，旧证据作废。
_Avoid_: commit hash（不同物）

**实现项 / 终验项（N 项 / F 项）**：计划行语法的两类条目；F 项强制真实表面证据。
_Avoid_: 普通 todo

**tier（轻重分级）**：LIGHT 默认精简 / HEAVY 全套纪律；只升不降。
_Avoid_: 模式切换

**决策完备（decision-complete）**：计划无任何「待定」，执行者无需再问即可开工。
_Avoid_: 草稿

**触发词（trigger）**：`zw` 主词；`ulw` / `ultrawork` 为兼容别名。
_Avoid_: 单用 ulw 指代本项目触发词

**经验并发带（empirical concurrency band）**：doctor 从本地日志实测的「无 429 桶最高活跃
会话数 / 有 429 桶最低活跃会话数」；连贯且样本足量才输出。
_Avoid_: 并发上限（平台侧数值，本地测不到）

**回合（turn）**：一次去重后的模型请求；引擎重试产生多条限流事件仍属一回合，doctor 限流标题按回合计。_Avoid_: 请求次数（含重试的原始条数）

**项目记忆（init-deep）**：init-deep 技能生成的分层 AGENTS.md 地图（根 + 有资格子目录），
随 git 入库=仓库/团队面；个人教训归内置 memory（zw 收尾）。资格谓词=构建入口/文件数>40/根提及（纯代码可判）；写盘必经草稿先行（ADR-0002）。_Avoid_: 项目知识库、复杂度打分

**无人值守模式（unattended）**：宿主自动化定时唤起、只推进 executing 目标、绝不立新计划的
运行形态（ADR-0003）。_Avoid_: 全自动模式、自动驾驶

**错峰窗口（off-peak window）**：doctor 从实测限流集中段反推的建议自动化挂载时段（对侧净弧中央 8h）。_Avoid_: 并发上限、空闲时段

## 9. 维护规则

1. **决策变更 → 必须同步 §4 速查表**（一行一条 + 日期）；阶段推进 → 更新 §2 当前状态。
2. 文件预算 **≤150 行**（远低于 ZCode 100KB 注入截断线）；细节一律引用 `docs/`，不复制正文。
3. 新术语先查 §8；需要新词时按 CONTEXT-FORMAT 风格（定义 + _Avoid_）补入。
4. **与本文件冲突的旧约定，以本文件为准。**
5. 开发期新决策满足「难逆 / 无背景会费解 / 真取舍」三条件时，逐条立 `docs/adr/NNNN-*.md`（一段话即可）；已有拍板不补 ADR（rationale 已在报告）。
