# LazyZCode — 项目宪法（Agent 与贡献者必读）

给 ZCode 造一个 lazycodex 同款的「AI 编码工作流纪律层」：让 AI 不只写代码，而是**计划 → 执行 → 拿证据 → 不做完不停**。本文件是本仓库的单一事实入口：ZCode 原生自动读取（无需任何配置），模型读完即可在本仓正确干活；细节引用 `docs/`，不在此复制。

## 1. 北极星

做 ZCode 版的 [lazycodex](https://github.com/code-yeongyu/lazycodex)（OmO 引擎的 Codex 发行版，MIT）。形态：**ZCode 插件 + 轻量 CLI（`lzy`）**——插件承载 skills/hooks/agents（纪律层），CLI 承载目标循环状态机与安装器。完整背景与论证见 `docs/reports/index.html`。

## 2. 当前状态与下一步（2026-09-10）

- **P0 首日三 spike 全部完成**（2026-09-06，结果与证据：`docs/spikes/p0-day1.md`；探针均已按约删除）：Spike 1 Edit 免 hashline（新红线「old_string 原样精确缩进」）；Spike 2 安装型插件 `.zcode/.claude/.codex` 免改名装载成立（cursor cache 拒）+「安装+启用」两步；Spike 3 Stop 非空注入续跑 + ≤3 硬顶 + 同池扣减（设计约束「状态按 sessionId 隔离」）。
- P0 骨架已落地（2026-09-06）：`plugin/ + core/ + cli/`，`lzy install/sync/status/uninstall` 端到端实测，本机已自举安装（`lazyzcode:zw` 技能可装载）；ADR-0001 已拍板：启用走引擎官方 `plugins enable`，**lzy 对 config.json 零写入**。`core/engine.js`（lzy→引擎调用层）已落位（2026-09-06）：此前被 Mimosa 守卫内容级拦截（凡 spawn/exec 即 deny、安全形态亦拦、无 UI 放行入口），**经授权跑深度安全扫描取得封印（0 findings）后写入放行**——「扫描封印」是解拦正道；实现为安全形态（路径解析归 paths 模块、执行归 engine 模块，每调用点字面量子命令数组 + `shell:false`），install/uninstall/status 全生命周期实弹验证（官方 enable/uninstall 路径均通），引擎环节全自动、不再走指引式回退。
- **P1 核心已落地（2026-09-06）**：`lzy loop/step` 目标循环状态机（注册→计划门[决策完备，TBD 拦截]→逐步收口→F 项证据绑 `HEAD^{tree}`→finish 终验[证据过期即拦]；状态在 `.lazyzcode/loop/`）+ 插件 SessionStart/Stop 钩子（`hooks/hooks.json`，sessionId 隔离计数、Stop 预算 ≤2 预留 1、异常一律 fail-open）+ `zw` SKILL.md 全量编排文本（英文）。实证：scratch 仓全状态机 E2E 全绿；钩子 stdin 行为矩阵全绿；引擎 `plugins list` 注册 `hooks:2`。已知限制：headless 驱动引擎需登录/API-key 配置（V4 签名凭据，桌面端运行时注入），活体注入由 Spike 3 背书，真实会话验收顺延。
- **P2 角色与纪律已落地（2026-09-06）**：三只读子代理角色 `plugin/agents/`（explorer 侦察 / plan-reviewer 计划评审 / qa-executor 证据执行，英文 prompt + 固定输出契约，引擎对 agents/ 目录自动发现无需 manifest 声明）+ 计划评审门（`lzy loop plan --review` 记录评审，**REVISE 判决拒绝采纳且 --force 不越过**；HEAVY 强制过门、LIGHT 自查）+ UserPromptSubmit 触发词钩子（zw/ulw/ultrawork 注入 zw 引导，词边界匹配防误触）。实证：触发词矩阵/评审门三态/引擎注册 hooks:3 全绿。
- **MVP 活体验收通过（2026-09-06）**：五项检查全 ✅——检查 1 活体（真实会话 `zw 继续` 首行 `**ZW** engaged`）、检查 4 活体（Stop 拉回 1/2→2/2 后止，用户明令优先）、检查 2/3/5 CLI 实证（评审门 PASS+--review、F 项无证据拒绝、改码后「过期 1 finish 会被拦」）；记录在探针仓 `ACCEPTANCE-RECORD.md`（探针可删）。**Mimosa deep 复扫 0 findings（seal sha256:81151e73…，依赖面 partial 如实记账）**。
- **P3 资产整合已落地（2026-09-06）**：comment-checker PostToolUse 轻钩子（goal.json 在场闸门、命中 TODO/FIXME/XXX/HACK 与调试残留经 additionalContext 轻提示不阻断、上限 5 处 ≤300 字符、fail-open；PostToolUse 输出契约逆向实锤 zcode.cjs:36794-36796）+ codegraph 接线（zw SKILL.md/explorer.md 补索引侦察指引；status.js 增 codegraph 诊断，**缺席=skip 不翻转退出码**；paths.js 增 userCliConfigPath 只读解析）+ browser-use 取证面文本（SKILL.md/qa-executor 补 ego-browser/curl 手法，control-browser 仅主代理）。实证：模拟 stdin 三场景 + status 检查行 + 引擎注册 hooks:4。
- **P4 发布就绪已落地（2026-09-06）**：`lzy doctor`（status 全套 + hook 语法自检[vm 解析 worker，含 hooks.json 注册校验]/node 下限/lzy 解析/状态卫生/平台立场，零遥测）+ 发布材料（LICENSE、package.json 去 private + files 排除 .mimosa、CHANGELOG、npm scripts 补全）+ README 用户 10 分钟快速开始 + docs 脱敏；`npm publish --dry-run` 实证 24 文件零敏感物。**真发布待用户动作**。
- **五轮双审核 + 修复轮已落地（2026-09-06/07）**：报告 `docs/reviews/`（41 发现：0 P0/2 P1/15 P2/24 P3，红线全部活体证实）；修复轮收口全部 P1+P2（abandon 修复、注册表防损坏、原子部署、跨进程锁等），新增契约测试三件套 + GitHub Actions 与发布备料（repository 元数据 + `docs/release-checklist.md`）；剩余 24 条 P3 按「顺带修」记账（评审报告处置记录）。
- **P3 清账 + 钩子环境加固已落地（2026-09-07，goal p3-sweep-hook-env）**：评审剩余 17 条 P3 全修（R2-12 维持不修）；实锤「GUI 直启场景引擎 env PATH 无 node → 裸 `node` 钩子静默全灭」（`docs/diagnostics/2026-09-07-hook-spawn-env.md`）→ 四钩子改走 `run-hook.sh` 启动器（nvm/homebrew fallback）+ doctor 增 `hook-node`；同日活体复验通过（四钩子 hook.run.failed=0，对照旧会话 551 条全灭）。
- **限流纪律 + 体检 v3 已落地（2026-09-07，goal rate-limit-discipline → rl-v3-trigger-strata）**：GLM 账号级 1302/429 应对——doctor `rate-limit`（近 2 日引擎日志只读扫描：429 回合计数/脏桶直方图/最长连撞/集中段三门槛/实测边界建议，warn-only，经验测量=决策 #16）+ zw SKILL.md Rate-limit discipline 段（一次一循环/子代理默认串行/429 判死恢复）+ 触发词分层（bare zw 仅句首、显式全名、ulw/ultrawork 不变，R4-4）。底稿 `docs/research-glm-plan-rate-limit.md`。
- **文档站与品牌资产已落地（2026-09-07，goal docs-site-redesign）**：双语 guide（lazycodex.ai/docs 同构，en/zh 各 18 节锚点）+ Jekyll Pages 站（source=/docs，GFM 渲染）+「Verified Mark」品牌资产（mark/logo/favicon SVG，Z 末笔收于证据圆点）+ 版面重设计（暗色设计系统/侧栏五组图标/scrollspy）；验证工具链入库 `scripts/docs-preview/`（构建/爬链/锚点三脚本，dev-only 独立依赖，根包零依赖不破）。后续增量：开发者图文页、三态主题+多端适配、全局语言胶囊、头部顺序（92649d6…e0dafbf）。
- **tier-2 增量已落地（2026-09-08，狗粮驱动）**：F 项证据附件（`--evidence-file` 复制入 `.lazyzcode/evidence/` 绑 sha256，≤4/项）+ 证据包导出（finish 自动归档 + `lzy loop export`，reset 不清）+ 带内调度建议（`bandAdvisory` 实测数据→并行上限，`lzy loop start` 打印并发纪律行，fail-open）+ finish 收尾写项目 memory（技能文本承载，零新钩子）；狗粮：10 目标全流程、钩子失败 568→1、限流集中本地 0–3 点。
- **tier-1 双增量已落地（2026-09-08）**：init-deep（ADR-0002，分层 AGENTS.md 项目记忆：草稿先行、人点头才写、已有文件只出补丁；`core/agentsmd.js` 资格谓词 + `lzy agents-md` 详单 + doctor warn-only）+ 无人值守（ADR-0003，调度走宿主自动化、lzy 零写入零调度代码；唤起协议六条在 zw SKILL.md Unattended 段；doctor `schedule` 错峰窗口行，无证据=skip）。
- **产品叙事完整性已落地（2026-09-08）**：单主轴三节拍（做完/记住/接着走）——README 双语补齐 0.0.2 事实（NOTE 弧线、两技能自述、「之后的路」、CLI/doctor 清单、架构树）+ 首页特性卡 4→6（护栏式 Unattended 句式）+ 双语 guide 新增项目记忆/无人值守概念节（锚点 18→20）；并入 0.0.2 发布提交，push/publish 留用户。
- **竞品调研已收口（2026-09-08，goal competitor-landscape，零仓库写入）**：direct 2 家（glm-hammer 17★ 自述「lifted from lazycodex hook system」、OhMyZcode 1★ 但 6 天到 v1.7.2 且主命令 `/ulw` 与我方别名撞名）、adjacent 4 家（ouroboros 5.8k★ 最大威胁）；官方市场 `zai-org/zcode-plugins` 全清单零纪律层=赛道空位；`lazyzcode` 名字全网干净；上游 lazycodex 仍 Codex-only、OmO 无原生 ZCode。
- **会话级拉回粒度已落地（2026-09-08，goal claim-scoped-pull，ADR-0004/决策 #17）**：认领制全链——UPS 触发词（executing 闸门）写 claimedAt、Stop 认领闸门（空集=现状单调收紧）、进度振数（零推进两振 stuck 弃拉不耗预算，上限仍 2 红线不破）、读面（status 认领/stuck 行 + doctor `claims` 检查 + SessionStart CTA）；55/55 测试绿、F1 八场景活体证据。
- **透明账本纪律已落地（2026-09-09，goal ledger-discipline，ADR-0005/决策 #18）**：提交 `Goal: <slug>#<步号>` 尾注 + doctor `ledger` 巡逻 + 证据 opt-in 入库（docs/evidence/）；全部未推提交已 squash 同线推远程。
- **宿主工作区纪律已落地（2026-09-09，goal host-workspace-discipline，ADR-0006/决策 #19）**：跨仓目标循环寄宿主仓（严格 cwd 不 walk-up）+ 写命令 fail-fast（withLock 空壳疤痕根治，reset 契约豁免）+ 无 goal 出口恢复式报错（统一文案源：绝对路径+回宿主根指引）+ 认领写面收窄至唤起级（ADR-0004 修正案，/ulw 提及误认领 specimen）+ doctor 疤痕巡逻；多树证据绑定记名债务（升格=跨仓漏判误 finish）。下一步：真发布 + 官方市场卡位（用户按 `docs/release-checklist.md` 择机执行）；运行期反馈迭代。
- **已知未知显性 + 消融账本已落地（2026-09-10，goal ablation-confidence，ADR-0007/决策 #20）**：HEAVY 计划强制「已知未知」节（1–3 条假设各带证伪途径，「无」须一行扫过说明；LIGHT 建议）+ 影子消融制度化（计划自查→评审门→差集按 P0-P3 记账，预注册判据防降档；天然消融被动补录），协议与账本 `docs/ablation.md`；计划门零代码改动（禁词黑名单不动，「未知」二字永不入表——契约钉三枚）；首验即正名：影子实验评审独有 P1×1+P2×1 → 门挣得成本；65/65 测试绿、文档站锚点双语 21/21。
- **传输死亡诊断面已落地（2026-09-10，goal doctor-transport-deaths，ADR-0008）**：doctor `transport` 行与限流分族计数（errno 主判据在 statusMessage——实锤 ENETDOWN 事故 reason=unknown，按 reason 白名单必漏触发事故本身；fake-ip 198.18.0.0/15 命中给 TUN 直连提示；绝不进并发带/错峰窗数学）；429 谓词零语义变化（真日志基线 diff 字段级为空作护栏）；69/69 测试绿。
- **会话失控护栏已落地（2026-09-10，goal incident-guardrails，ADR-0009/决策 #22）**：Stop 交接放行（`lzy loop handoff` 目录级匿名标记+unlink 原子消费+放行不耗预算，消费清振数防重入误振）+ PostToolUseFailure 空转绊线（`^mcp__` TTL 连击 warn 一次，hooks:4→5）+ status files 逐文件 sha256 内容比对（路径集合比对对「文件在而内容过期」失明——09-09 事故实锤）+ zw SKILL.md 工具空转逃逸契约；源起 sess_95421d3d 空转事故，探针活体实证 Failure 注入通道；86/86 测试绿；顺手修 writeSessionCounter 潜伏 bug（全收口 finish 提醒自 0.0.2 必炸走 failOpen）。
- **证据对照与工件回收已落地（2026-09-10，goal comparator-salvage，费马启示三件包）**：HEAVY finish 前派 qa-executor 证据对照（断言×证据逐对判匹配/不匹配，协议级阻断，CLI/doctor 零代码）+ 步骤自含指引与评审 WARN 检查点 + reset/abandon 盘点可回收工件入存根（status 双分支读面）+ 依赖图并行认领记债（决策 #21，ADR-0004 修正案二）；74/74 测试绿、锚点双语 21/21。
- **无人值守真实挂载（2026-09-10）**：宿主自动化 automation-a8aba356 挂 lazyzcode 工作区（cron `0 23,0-8 * * *` 十整点），时刻表依据计价地图而非纯限流反推——GLM 高峰周一至五 14–18 + 夜间 23–09 Flash 不限量 ∩ DeepSeek 高峰 9–12/14–18；人肉冒烟四环验证通过（唤起消息逐字/触发词装载/读盘/干净退出）。ADR-0003 的「用户配宿主自动化」自此发生。**09-11 整夜三目标连发实证收官**（8 次整点唤起链式推进：narrative-pricing-alignment reset 00:31 → dual-review-r6 finish+reset 04:56 → r6-fix-round 注册起全链 N1–N6+comparator finish 06:27，尾注全合规、证据包自动归档、done 占槽空转唤起干净退出）；同日用户拍板暂停挂载（自动化已删、槽位已 export+reset，复挂待限流扫描体积预算修复目标落地，唤起协议见 zw SKILL.md Unattended 段）。**09-13 二次拍板：挂载全清 + 开关语义确立**（unbound 版 10 颗逐小时 automation 重建两夜后全删，canary 同日退役——语义验收本已通过：两夜 13 run/13 互异 session 零失败；拍板理由=槽空空转会话过多 + 「无人值守是用户可自行开关的能力，非常驻默认」——ADR-0003 语义自此澄清：挂载=开、清空=关，开关动作归用户在 App 界面，复挂配方在 plan-v2 报告 §6；canary（zcode 工作区）留用户手动删）。
- **doctor schedule 计价感知已落地（2026-09-10，goal doctor-schedule-pricing，ADR-0003 修正案）**：scheduleAdvisory 升级「限流错峰 ∩ 计价感知」——PEAK_WINDOWS/SAFE_WINDOW 写死本地（UTC+8、人工维护、活动期免责），候选窗逐小时对照输出重叠段+安全窗，now 注入沿 bandAdvisory 先例；首验即活体演示修正价值（旧 09–17 建议全落高峰零提示）；评审门 REVISE 抓 e2e 周几漂移（重叠句真值收归固定 now 纯函数测试）；94/94 中 92 绿（2 失败=既有环境 flake：引擎探测子进程写日志污染空 HOME e2e，stash 实证记债）。
- **放行可观测与跨仓清单已落地（2026-09-10，goal handoff-meter-crossrepo-list）**：交接放行匿名计数（`.lazyzcode/loop/metrics.json` registered/consumed，目录级匿名无会话身份、无锁近似 ≥ 语义、跨 reset 永续、status/doctor 双面读）+ `lzy loop list [--root]` 跨仓目标清单（只读旁视、每仓独立容错、executing 前置）+ 疤痕巡逻豁免清单全枚举（salvage/metrics.json/空 sessions——F3 取证显形既有缺口）；狗粮依据=7/12 会话拉回预算打满而消费痕迹为零；93/93 测试绿。
- **README 叙事面计价措辞收口已落地（2026-09-10，goal narrative-pricing-alignment）**：README 双语八处 schedule 表述跟齐「限流实测 ∩ 计价高峰对照」口径（镜像 guide 已发文案；评审门抓出 doctor 段 zh 第 8 处漏点，F1 断言组对位补齐）+ 叙事 checklist 六类计数位点回归（顺手修双语 README 架构树「hooks 4 个」残留→5）；纯文档零代码；公开/publish/push 留用户。
- **第六轮高精度双审核已落地（2026-09-11，goal dual-review-r6）**：A/B 双审沿 09-06 家法，按限流纪律降并行为串行单发+探针收窄（偏差如实记入报告方法论节）；**14 发现 0P0/1P1/5P2/8P3（含 F1 终验实跑翻出的元发现），14/14 主代理亲核**——P1=README 双语安装主路径 `npm view lazyzcode` 404 无未发布提示（随发布自消解）、P2=registerGoal 唯一无锁 goal.json 变更（R2-5 漏网）/裸 status 遇损坏 goal.json 丢全部诊断/handoff 锁外交写×reset 锁内清理孤儿标记竞态/决策#7 description_i18n 从未落地/R6F-1 overlapSegments 窗尾锚线性枚举溢出窗外误报「窗内落高峰计价」（工作日 02–03 时波段，固定 now 四对照实锤，恰是无人值守活跃时段）；红线九靶全过（引擎源码实证 continue:false 不入 3 池，债务⑥升源码级消解）；六类计数位点零漂移、历史处置 16 抽查零虚记、cache 载荷字节级一致、债③实证为确定性测试隔离缺陷非随机 flake；报告 `docs/reviews/2026-09-11-r6-dual-review.md`，修复另立目标；94 中 91 绿（=2 既有 flake+R6F-1 波段失败，皆已入账）。
- **R6 修复轮 P2 五条已收口（2026-09-11，goal r6-fix-round）**：registerGoal 查重+写入入锁（并发双 null 互覆盖竞态闭环）/status 遇损坏 goal.json 单项降级 warn（对齐 doctor fail-soft，warn 不翻码=criticalFail 既有语义）/handoffGoal 写入入锁（×reset 孤儿标记竞态闭环，锁外预检防疤痕保持）/决策 #7 订正「manifest 单语 description，双语由 docs 站承载」（P1 README 未发布提示拍板不加、随发布自消解）/overlapSegments 沿窗弧回卷枚举（窗尾锚溢出伪报+漏检同根治，回卷点断段防跨日伪合并，固定 now 四对照钉）；各配持锁/损坏/回卷回归钉。新发现记账（修复另立目标）：`loop start`/doctor 限流扫描近两日引擎日志无体积预算（实测 263MB 扫 18-50s），无人值守活跃段 e2e 全链确定性超 60s spawn 预算（债③家族新形态，干净树 stash 实证非本轮回归）。
- **限流扫描体积预算 + 测试隔离收口已落地（2026-09-13，goal ratelimit-scan-budget）**：`collectRateLimitStats` 加 64MB/文件尾部读 + 10s 时间盒（truncation 字段如实标注，doctor rate-limit 行与 loop start 并发纪律行透出，样本可信度声明在 300 字符预算内优先于集中段/游程；小 fixture 输出零语义变化护栏钉）+ 债③根治（doctor 的引擎探测子进程 mid-run 向 scratch log 写当天日志——活体实证——测试 spawn 统一 `LZY_ZCODE_ENGINE` 抑制，3 轮 19/19 零翻）+ 三 e2e helper 隔离 HOME（e2e 不再随宿主日志量波动；R6A-2 改对照式断言消除「本机已安装」隐性依赖）；ADR-0010（unbound wake）+ plan-v2 成本评审报告 + ablation #5 随 N1 入库。

## 3. 硬约束（ZCode v3.11.2 引擎源码实锤，设计前必读）

1. 钩子恰为 **7 事件**（SessionStart/UserPromptSubmit/PreToolUse/PermissionRequest/PostToolUse/PostToolUseFailure/Stop）。对比 Codex 原生 12 事件**缺 6 个**：无 SubagentStop/SubagentStart/PreCompact/PostCompact/SessionEnd/Interrupt。
2. Stop 续跑 **≤3 次**，且必须带**非空** additionalContexts（输出空 JSON 永不续跑）；exit 2 在 Stop 上 = block = 强制续跑（reason 注入为上下文）。
3. 3 次预算是**共享池**：ZCode 后台任务通知也发 continue:true 抢同一预算——本项目的 Stop 钩子预算要与后台通知互相预留。
4. ZCode **原生自动读 AGENTS.md**（逐级向上查找 + `~/.zcode/AGENTS.md` 多源合并 + 100KB 截断，以 `# agentsMd` 注入）→ 规则注入钩子不需要做。
5. 宿主内置**多模型目录**（10 provider，默认 GLM 套餐）→ tier 预算护栏可借模型维度，不自研模型路由。
6. 工作区钩子**信任门已在引擎灰度**（`workspace_hooks_*` 策略码，文档未提）→ 永不改写用户 config.json（见 §5 红线）。
7. 事实源优先级：**reversed-zcode 引擎源码 > zcode-guide 官方文档**（文档存在滞后，已实证 4 处）。
8. **cache 安装型插件默认禁用**：装载需「安装+启用」两步，启用态在 config `plugins.enabledPlugins`（Spike 2 实测）；cache 清单候选仅 `.zcode/.claude/.codex` 三种，`.cursor-plugin` 仅工作区 walk-up 路径接受。

## 4. 决策速查表（2026-09-06 拍板，变更须同步本表；#11 已并入 §5 红线，编号不回收）

| # | 决策 | 定案 |
|---|------|------|
| 1 | 总体路径 | **D 全自研**；lazycodex（MIT）作底稿借鉴，OmO（SUL-1.0）只学思想 |
| 2 | 范围投入 | **开源完整版 P0~P4**（约 2 个月，单人+AI 结对）；MVP（P0+P1，2~3 周）为首个验收里程碑 |
| 3 | 许可证 | **MIT**，不预留商业版 |
| 4 | 产品形态 | **插件 + 轻量 CLI**（Stop≤3 等硬约束推出，见 §3） |
| 5 | 命名 | 项目 **LazyZCode**；npm 包 `lazyzcode`；CLI 命令 `lzy`；触发词 **`zw` 主词 + `ulw`/`ultrawork` 兼容别名** |
| 6 | 状态目录 | **`.lazyzcode/`**（plans/drafts/loop/evidence；与宿主 `.zcode/` 划清边界） |
| 7 | 技能文本语言 | **英文 SKILL.md + 中文文档**；manifest 单语 description，双语由 docs 站承载（R6B-2 订正 2026-09-11：原 `description_i18n` 折中从未落地） |
| 8 | P3 范围 | **只整合现有资产**：codegraph 接线、comment-checker（PostToolUse 轻钩子）、内置 browser-use 取证面、原生 scheduler 记入备选；规则注入钩子已砍 |
| 9 | 遥测 | **完全无遥测**；诊断由 `lzy doctor` 本地输出承担 |
| 10 | 验证排期 | 三 spike 已完成（2026-09-06）：Edit / 四风格装载 / Stop 注入与 ≤3 硬顶均实证，详见 `docs/spikes/p0-day1.md` |
| 12 | 安装器路线 | 装 = cache 落位 + 注册表幂等写；启用 = 引擎官方 `plugins enable`；**config.json 零写入**（ADR-0001，2026-09-06） |
| 13 | Stop 预算细分 | lzy Stop 钩子每会话最多请求 **2 次**续跑，预留 1 次给引擎后台通知（红线 #2 具体化；计数按 sessionId 隔离，2026-09-06） |
| 14 | 证据时效语义 | F 项证据绑 `HEAD^{tree}`（提交粒度）：**先提交再取证**；未提交改动不入 hash，工作区脏时 CLI 警告（`.lazyzcode/` 自身不计脏，2026-09-06） |
| 15 | P2 纪律阵容 | 三只读角色（explorer/plan-reviewer/qa-executor）；计划评审门 **REVISE 拒绝采纳、--force 不越过**，HEAVY 强制过门 / LIGHT 自查；触发词钩子做（UserPromptSubmit，词边界防误触）（用户拍板 2026-09-06） |
| 16 | 限流自适配路线 | **经验测量**，非声明式配置：套餐档位本地不可探测（2026-09-07 实查），doctor 从本地日志实测 429 压力与经验并发带，零新增配置面（用户拍板 2026-09-07） |
| 17 | 拉回资格归属 | **认领制**：goal 目录级共享 + 会话认领集（触发词写 claimedAt）；多认领集合语义（无 SessionEnd，独占会死锁）；无认领=现状行为单调收紧；进度感知振数（无进展两振写 stuck，拉回上限仍 2 红线不破）；`lzy loop claim` 写面与跨项目清单记备选（ADR-0004，2026-09-08；写面 09-09 收窄至唤起级，见 #19） |
| 18 | 透明账本 | **提交尾注 `Goal: <slug>#<步号>`**（人和 AI 遵守，历史不补）+ doctor `ledger` 行巡逻覆盖率（warn-only）；证据 opt-in 入库（计划声明+人点头→docs/evidence/）；AI 署名不加（ADR-0005，2026-09-09） |
| 19 | 宿主工作区 | **跨仓目标循环寄宿主仓**：`.lazyzcode/` 与 `lzy` 只在宿主根，严格 cwd 不 walk-up；写命令 fail-fast（防空壳疤痕，reset 豁免）+ 无 goal 出口恢复式报错；证据时效门只见宿主树（多树绑定记债，升格=跨仓漏判误 finish）；ADR-0006（2026-09-09） |
| 20 | 已知未知与消融 | **HEAVY 计划强制「已知未知」节**（未验证前提≠推迟决策，1–3 条各带证伪途径，「无」须一行说明）+ 影子消融记账（评审差集按 P0-P3；预注册判据：连续 5 HEAVY 目标独有 P1/P2≈0 → 只许「维持现状或真消融终审」绝不降档）；门禁词黑名单不动（ADR-0007，2026-09-09） |
| 21 | 依赖图并行认领 | **记债不实现**：计划依赖边+无阻塞步认领（同目标多工人，worktree 覆盖不了的形态）；升格触发器=并行带实测≥2/同目标撞槽再发/多模型分发现实化，前置件=角色指模型走宿主目录（§3.5 不推翻）+doctor 按 provider 分桶测带（ADR-0004 修正案二，2026-09-10） |
| 22 | 交接放行 | **目录级匿名标记+原子消费**：模型收尾前 `lzy loop handoff --snapshot <file>` 落 `loop/handoff.json`，Stop 一次性 unlink 消费（恰一赢家）后显式 `continue:false` 放行——不入 3 池不耗预算；消费清本会话振数/stuck；匿名=模型在 Bash 拿不到自己 sessionId，拒绝一切转抄身份设计；滥用对冲=快照必填（存在+mtime≤24h）；多认领撞窗记已知边界（ADR-0009，2026-09-10） |

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
  adr/000{1..9}-*.md          ← enable 走引擎 CLI+config 零写入 / init-deep 角色分配 / 无人值守宿主自动化 / 拉回走认领制 / 透明账本尾注 / 宿主工作区就地语义 / 已知未知申报+消融账本 / 传输死亡诊断面 / 交接放行
  reviews/ release-checklist.md  ← 评审报告/处置记录（2026-09-06/07/08）+ 发布清单（13 步含 Pages）
  diagnostics/               ← 运行环境诊断记录（钩子 spawn env / shell PATH，2026-09-07 起）
plugin/ core/ cli/           ← P0 骨架：插件载荷 / 共享逻辑 / lzy CLI（见 README）
test/  .github/              ← 契约测试三件套（node:test 零依赖）+ CI 骨架
scripts/docs-preview/        ← 文档站本地预览与校验工具链（dev-only 独立依赖，根包零依赖）
README.md（英）+ README.zh-CN.md（中）LICENSE CHANGELOG.md  ← 开源门面（lazycodex 同构双语说明）
artifacts/                   ← 本地产物（已 gitignore，不入库）
```

## 8. 语言（先查此表再造词；与本表冲突以本表为准）

**纪律层（discipline layer）**：本产品的价值层——计划门、证据验证、防半途而废。_Avoid_: 工作流强化层
**目标循环（goal loop）**：`lzy loop` 驱动的「注册目标→逐步派发→证据验证→完成」状态机循环。_Avoid_: 深循环（仅架构讨论语境）、ulw-loop（上游名）
**证据（evidence）**：绑定 tree hash 的真实表面取证（HTTP 返回/截图/CLI stdout）。_Avoid_: 测试结果（测试全绿≠证据）
**tree hash**：`git rev-parse "HEAD^{tree}"` 的内容快照哈希；代码一变，旧证据作废。_Avoid_: commit hash（不同物）
**实现项 / 终验项（N 项 / F 项）**：计划行语法的两类条目；F 项强制真实表面证据。_Avoid_: 普通 todo
**tier（轻重分级）**：LIGHT 默认精简 / HEAVY 全套纪律；只升不降。_Avoid_: 模式切换
**决策完备（decision-complete）**：计划无任何「待定」，执行者无需再问即可开工。_Avoid_: 草稿
**触发词（trigger）**：`zw` 主词；`ulw` / `ultrawork` 为兼容别名。_Avoid_: 单用 ulw 指代本项目触发词
**经验并发带（empirical concurrency band）**：doctor 从本地日志实测的「无 429 桶最高活跃会话数 / 有 429 桶最低活跃会话数」；连贯且样本足量才输出。_Avoid_: 并发上限（平台侧数值，本地测不到）

**回合（turn）**：一次去重后的模型请求；引擎重试产生多条限流事件仍属一回合，doctor 限流标题按回合计。_Avoid_: 请求次数（含重试的原始条数）
**项目记忆（init-deep）**：init-deep 技能生成的分层 AGENTS.md 地图（根 + 有资格子目录），
随 git 入库=仓库/团队面；个人教训归内置 memory（zw 收尾）。资格谓词=构建入口/文件数>40/根提及（纯代码可判）；写盘必经草稿先行（ADR-0002）。_Avoid_: 项目知识库、复杂度打分
**无人值守模式（unattended）**：宿主自动化定时唤起、只推进 executing 目标、绝不立新计划的
运行形态（ADR-0003）。_Avoid_: 全自动模式、自动驾驶
**错峰窗口（off-peak window）**：doctor 建议的自动化挂载时段——实测限流集中段对侧净弧中央 8h 与计价高峰表（写死本地、UTC+8、人工维护）相交核对，附计价安全窗。_Avoid_: 并发上限、空闲时段
**认领（claim）**：会话对进行中目标循环的接管登记（唤起级触发命中时 UPS 写 `claimedAt` 入会话文件；句中提及不写——ADR-0004 修正案）；Stop 拉回只作用于认领会话，集合语义可多会话并存。**旁路会话（bystander session）**=同目录未认领循环的会话（如纯问答），不受 Stop 拉回、SessionStart 广播照收。_Avoid_: 会话独占、锁定（无 SessionEnd，独占会死锁）、脏会话
**交接快照（handoff snapshot）**：模型主动收尾时写入计划文件的精确续跑状态（剩余路径+下一步动作），经 `lzy loop handoff` 登记为目录级匿名标记后，Stop 钩子消费即放行（一次性、不耗预算，ADR-0009）——交接是把执行权交还用户，非半途而废。_Avoid_: 认领（注册表侧登记）、Handoff-able steps（计划步自含性）、放弃（无放行，直接弃目标）
**宿主工作区（host workspace）**：跨仓目标中寄宿 `.lazyzcode/` 状态与循环命令的仓库——会话以它为根，代码可在兄弟仓；严格 cwd 不 walk-up（ADR-0006）。_Avoid_: 元仓库、主仓、状态目录、代码仓
**提交账本（commit ledger）**：提交尾注 `Goal: <slug>#<步号>`，每条改动可回溯目标循环（ADR-0005）；doctor `ledger` 行巡逻覆盖率。_Avoid_: AI 署名尾注（另议）、提交即日志
**已知未知（known unknowns）**：HEAVY 计划末尾强制申报的未验证前提节（1–3 条各带证伪途径；「无」须一行说明扫过哪里）——与门禁词互补：前提可申报，决策不可推迟（ADR-0007）。
_Avoid_: 待定事项、风险管理清单
**传输死亡（transport death）**：引擎 turn 在网络传输层失败、请求未达服务端（ENETDOWN/ECONNRESET 等 errno 族，主判据在 statusMessage；引擎常误标 retryable=false）；doctor `transport` 行分族计数、绝不进并发带/错峰窗数学（ADR-0008）。_Avoid_: 断网（过泛）、网络繁忙（服务端杀流另一族）、网络错误（与 429 混淆）
**证据对照（comparator）**：F 项断言与已取证据的相关性核验——存在性与新鲜度是机器门，真证明断言所言归对照；HEAVY finish 前 qa-executor 逐对判「匹配/不匹配」，不匹配协议级阻断（CLI 零代码）。_Avoid_: 证据验证（泛化，存在性+新鲜度义已占用）、测试全绿
**可回收工件（salvageable artifacts）**：被 reset/abandon 终止的目标循环残留的可复用产出（未提交改动、带尾注提交、计划与证据包）；销毁时盘点入 `.lazyzcode/loop/salvage/` 存根，status 双分支显示。_Avoid_: 废弃物、垃圾（负资产谬）

## 9. 维护规则

1. **决策变更 → 必须同步 §4 速查表**（一行一条 + 日期）；阶段推进 → 更新 §2 当前状态。
2. 文件预算 **≤150 行**（远低于 ZCode 100KB 注入截断线）；细节一律引用 `docs/`，不复制正文。
3. 新术语先查 §8；需要新词时按 CONTEXT-FORMAT 风格（定义 + _Avoid_）补入。
4. **与本文件冲突的旧约定，以本文件为准。**
5. 开发期新决策满足「难逆 / 无背景会费解 / 真取舍」三条件时，逐条立 `docs/adr/NNNN-*.md`（一段话即可）；已有拍板不补 ADR（rationale 已在报告）。
