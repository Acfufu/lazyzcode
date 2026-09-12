# 决策报告 · 工作流改进方案 v2.0（五轮双审定稿）

日期：2026-09-11 ｜ 状态：五题已拍板，待开工 session 执行 ｜ 关联：ADR-0010（unbound wake）、ADR-0003、ADR-0009、`docs/ablation.md` 账本 #5（A' 缓刑）

## §1 背景与账本

- GLM Coding Plan 2026-07-30 改版为积分制（5h 滚动 + 每周双周期，无月度额度池）；9/20 夜间免费活动退役后，夜间只剩非高峰五折。按官方系数（Flash 2.3/0.56/8，GLM-5.3 6.9/1.7/24）与本仓实测（09-04~09-10 周样本，`~/.zcode/cli/db/db.sqlite`），当前用量在标准规则下的反事实 ≈**16.2 万积分/周**，其中夜间 Flash ≈14.5 万——超 Max 周池（14 万）。
- 夜间账单 91% 来自 task_type=interactive 的长循环会话；缓存命中率 97.1%，账单 83% 是缓存重读。最恶性单点：「zw 继续」单会话 25.6h/1054 请求/均值 451k 上下文/4.75 亿 input token（sess_95421d3d）。
- 根因与修法的完整机制论证见 ADR-0010。本报告记录：五轮双审过程、拍板结论、方案终稿、开工 session 的执行清单。

## §2 五轮双审战果（每轮=独立新会话评审员第二审 + 主线程第一审轮间修订）

| 轮 | lens | 关键击穿点 |
|---|---|---|
| R1 | 事实核查 | 账本数字全部可复算（±1.2%）；非高峰=仅工作日 14-18 高峰（原表述「夜间+周末」过窄）；GitHub MCP 实为 245 次 |
| R2 | 机制有效性 | **「每步收尾→下班 wake 开新会话」是假的**：wake 被 target_task_id 钉死回同一会话；Stop 池 2-3 次 vs 实证 1054 请求 → 续命真面=调度 wake（无限次、不经 Stop 池）；空 target=每 run createTask（宿主代码实证） |
| R3 | 质量门可测性 | 四指标中 ①②③ 现状不可测（finish 拒绝不落盘、goal.json 单快照覆盖写、附件同名覆盖冲历史）；②③④ 会被改动本身机械性推高；n=3「任一恶化即回滚」统计无效 |
| R4 | 失效模式 | C-check 原判据可被 rebinding 机械刷进度（质量门自产造假激励）；任期制全局化误伤交互会话；换会话缓存经济学 breakeven ≈3-10k tok（第一步即超） |
| R5 | 红队总攻 | **A' 任期制整体缓刑**（unbound 后边际保护≈0，认知负荷最高、spec 洞最多、与 wake 模板「不做完不停」字面打架）；wake 加密 20-30min 违反 ADR-0003 且空转比 4:1，否决；Phase 0 探针验证后不得删除（转 canary） |

评审元成本：五轮 subagent 合计 ≈550 万 input token（免费窗口执行）。

## §3 拍板记录（2026-09-11，逐题确认）

| # | 议题 | 结论 |
|---|---|---|
| Q1 | A' 任期制 | **接受缓刑**：不进 Phase 1，入 ablation 账本 #5；四复活前置见 §4-缓刑条款 |
| Q2 | Phase 0/1.5 分工 | **授权代劳+文档指引**：探针/canary 由评审会话代建；wake automation 重建只能由人在 App 自动化管理界面做（会话内创建即自绑定，开工 session 也不行） |
| Q3 | Phase 2 排期 | **全量一次做**：埋点+cost 报表+tripwire+doctor 检查，开工 session 一次交付 |
| Q4 | 开工顺序 | **代码先行、切换收尾**：Phase 2 代码 → Phase 1 提示词层 → App UI 切换收尾；切换后第一个目标即入 veto 基线 |
| Q5 | 归档 | **三处**：ADR-0010 + 本报告 + ablation.md #5；五轮双审流程不制度化（按需手动触发） |

## §4 方案 v2.0 终稿

### Phase 0 影子验证 + canary（评审会话代办部分已完成，2026-09-11）

- **已实证（探针 A/B，2026-09-11）**：会话内经工具创建 automation **必然自动绑定当前会话**（探针 A 的 `target_task_id` 立即 = 创建会话 id），且引擎有「一会话一 automation」创建护栏（探针 B 报错 "Cannot create a scheduled task inside a session that already belongs to a scheduled task"）。**点火实运行复现钉定路径**：探针 A 于 07:26:21 派发，`automation_runs.session_id` = 创建会话本身（resume 回同一会话）。⇒ **unbound 版 wake automation 与 canary 都只能从 App 非会话上下文创建**，已并入 §6 人工步骤。
- **待验证（§6 步骤 3）**：App 自动化管理界面（非会话上下文）新建的 automation `target_task_id` 是否为空；为空 ⇒ 落点走 `createTask` 每 run 新会话（宿主 dispatchCronRun 代码已支持该分支）。
- **canary（人工建）**：App 界面建低频（周频）探针 automation——空 target、无害 prompt；每周比对 `automation_runs` 落点 session id 相异。宿主更新若使语义回退为钉定/停摆，canary 先于账单发现。

### Phase 1 提示词层（改 zw SKILL.md，开工 session 执行）

- **C no-op 判据（状态集合差）**：`{done 计数, F 项 evidence.treeHash 集, handoff 登记, salvage 存根}` 全零变化才判违规；treeHash 未变的 `step done` rebinding 显式计 no-op；**连续 2 次 handoff 登记且零推进亦违规**（封死「合法交接零推进」的免费弃坑通道）。
- **D diff-scope 重审**：REVISE 后重审派发必须携带上一轮 MUST-FIX 原文（plan-reviewer 无状态）；增量核销 + 全 checklist 扫尾；输出契约不变（VERDICT: PASS/REVISE）。
- **四条卫生规则**：① 禁止在会话内创建 wake automation（ADR-0010）；② goal finish/abandon 后停用对应 wake automation（finish 输出追加提示行）；③ 续命心智模型订正：引擎 3 次/turn（每 prompt 重置）、lzy 自限 2 次/session（持久计数）、调度 wake=无限次独立续命面；④ 脏树继承协议：交接快照强制内嵌 `git status --porcelain`，接手会话禁 `checkout`/`reset`，先对账快照清单。

### Phase 1.5 调度切换（人肉 App UI，收尾动作）

- 删旧 automation-a8aba356（钉 sess_233c0ae2），在 App 自动化管理界面重建 unbound 版本：cron `0 23,0-8 * * *` 不变、prompt 沿用「zw 继续（无人值守：…）」、**不绑定任何 task**。步骤清单见 §6。
- 验收：`automation_runs` 连续 ≥3 班落点 session_id 各不相同；切换后第一个真实目标即入 veto 基线。

### Phase 2 代码（lazyzcode 仓库，开工 session 第一批全量交付）

1. **埋点最小集**（复用 `incMetrics` 管线）：`finish_attempts` / `finish_rejects{pending|stale|unbound}`（loop.js 两 reject 分支 + doFinishLoop 入口）；证据 rebind 痕迹（append-only，附件名加 rebind 序号或 evidence 节点留 rebindOf 链）；wake step-delta（sessions/<sid>.json 或 incMetrics('wake_noop')）。
2. **`lzy loop cost`**：积分/目标 = Σ(tokens×系数)（人工系数表，对齐 ratelimit.js PEAK_WINDOWS 维护模式）；归因 = startedAt/finishedAt 时间窗 ∩ session.directory ∪ 认领旗标（**简化 OR 归因+人工复核**，红队否决了过巧的混合 ∩/∪ 公式）；按步数归一；对 db.sqlite 只读 spawn 声明为 loop.js「零 spawn」纪律的显式豁免。
3. **水位 tripwire**：stop hook 读本地 token 用量，超阈值注 nudge（上下文卫生的机械信号，替代 A' 缓刑期间的人格化水位判断）。
4. **orphan-wake doctor 检查**：只读 JOIN automations.workspace_path ↔ 该路径 goal 状态，连续 N 次干净退出即报 orphan。
5. **handoff 加固**：`lzy loop handoff` 增 7 字段快照 lint；mtime 上限 24h→2h；认领文件 48h TTL。
6. **trigger.js 哨兵旗标**：wake prompt 含「无人值守」→ 写 `unattended: true` 入会话状态（为 A' 复活预置技术强制）。

### 质量门

- **基线期**：切换后前 2 个目标为纯埋点观测，不行使 veto。
- **veto 规则**：绝对恶化超阈值 AND 连续 2 目标同向；阈值按报告附录判定式（① finish 首过率 P<min(B−0.20,0.60)；④ 积分/步 3 目标中位数>1.5×B 且每个>1.2×B）。
- **指标配对**：跨会话证据重采不 veto 调度改动（接管的机械产物）；MUST-FIX 修复提交不 veto D（设计意图）。
- **主观测哨兵（零埋点，即刻可用）**：弃坑率（abandoned/salvage/stuck/预算耗尽计数，全量已有持久化）+ 证据可辩护性（F 项附件覆盖率、done 后 verifyEvidence 重跑漂移、review PASS 占比）。

### 缓刑与否决

- **A' 任期制（缓刑，ablation.md #5）**：复活前置四条——①删班时/ETA 边界（wake 会话无班时概念，ETA 是模型的体面早退借口）；②水位降定性（模型数不了自己的 token）或等 tripwire 给真实信号；③同步改写 wake 模板与 SKILL.md 的「不做完不停」字面冲突（援引 ADR-0009「交接是交还执行权非半途而废」）；④哨兵旗标（Phase 2-6）先行落地。
- **E 写手子代理（缓刑，原有）**：等 Phase 2 基线后单独立 ablation，仅机械 N 项试点。
- **H 夜间 5.3 清退（否决）**：225 请求/周可能是刻意升级，清退伤质量，收益仅 1.9k 积分/周。

## §5 开工 session 任务清单（按序）

1. Phase 2 全量代码（§4-Phase 2 六项）——第一批，纯增量观测先行。
2. Phase 1 提示词层（§4-Phase 1 三组）——C/D/卫生规则落 SKILL.md 与 plan-reviewer.md。
3. 收尾：提示用户执行 §6 App UI 切换；切换后 `automation_runs` 验收（≥3 班异会话）。
4. 验收门：切换后第 1-2 个目标 = 纯埋点基线期；此后 veto 规则生效。
5. 全程遵守：证据 tree-hash 门、plan-reviewer 门、认领纪律零让步。

## §6 App UI 重建步骤（人工；**as-built 2026-09-11 已完成**，见附记）

> **as-built 附记**：App GUI 调度编辑器为单行「每天 HH:mm」表单（无法表达跨午夜每小时区间），故按路线 3 落地为 **10 颗独立 automation**「unbound 版 zw wake {23,00,01,…,08}」，每颗 `0 H * * *`、空 target、workspace=lazyzcode、prompt 同原文；另建周频 canary（周一 11:00，zcode 工作区，空 target）。2026-09-11 验收：计数 10、小时集合 {23,0-8}、全量 unbound、旧 automation-a8aba356 已删、心跳未动。语义落点验证待首个夜间窗口后以 `automation_runs` 落点互异性收口。以下原始步骤留档：

1. App → 自动化管理 → 停用/删除「每天 23:00–08:00 整点 zw 继续无人值守」（automation-a8aba356）。✅
2. 同界面新建：cron `0 23,0-8 * * *`、工作区 `/Users/acfufu/Codehub/lazyzcode`、prompt 沿用「zw 继续（无人值守：只推进 executing 目标；无目标或 planning 态则干净退出并说明；不做完不停）」、**不选择/不绑定任何已有任务或会话**。
3. 建成后回验：`sqlite3 "file:$HOME/.zcode/v2/tasks-index.sqlite?mode=ro" "SELECT target_task_id FROM automations ORDER BY rowid DESC LIMIT 1"` 应为空；次夜看 `automation_runs` 落点 session 各不相同。
4. 同法建**周频 canary**：任意错峰时刻（如周一 11:00）、prompt「只回复 done」、不绑定 task；每周核对 `automation_runs` 落点 session 互异。若某周落点固定/不派发 ⇒ 宿主 dispatch 语义漂移，先查 wake 再看账单。
5. 若 App 界面强制绑定 task（新建即有 target）：停在这里，把 ADR-0010 的「宿主 feature request」提上日程（unbound 选项或 cron 派生 task 归组），勿退回钉定形态。

> 引擎护栏（2026-09-11 探针实证）：会话内创建 automation 必然绑定该会话，且一个会话只能拥有一颗 automation（第二次创建直接报错）。所以本节所有创建动作都不能在 zw/目标会话里做。

## §7 风险与边界

- unbound 语义依赖宿主 `dispatchCronRun` 黑盒实现，App 更新可能静默改变——canary（§4-Phase 0）+ doctor orphan 检查（Phase 2-4）双保险。
- 哨兵词在 Phase 2-6 落地前无技术强制：交互会话粘贴含「无人值守」文本可能误触条件式条款（已知边界，A' 缓刑期间无实际影响面）。
- unbound 每夜 ~10 个新 task 入 UI 列表（观感税）；宿主侧 feature request（cron 派生 task 归组/自动 paused）为 P2 待办。
- 本报告的成本数字为标准规则反事实口径；9/20 免费窗退役后应按实扣账本重算一次。

## 附记（2026-09-13）：§6 as-built 的挂载物已全清

10 颗 unbound wake + canary 于 09-13 经业主拍板全部下线（canary 在 zcode 工作区，留业主 App 界面手动删）——语义验收（两夜 13 run/13 互异 session）通过后仍予清退，理由与开关语义见 ADR-0010 附记。§6 重建步骤继续有效，作为**复挂配方**存档；Phase 2-4 orphan-wake doctor 检查的优先级随之下降（无挂载即无 orphan 空转面），六项清单本身不改。
