# LazyZCode 工程工作流

用于 0.3.0 工作流设计：从用户确认需求到代理完成约定交付的领域术语。

## Language

**需求契约（task contract）**：用户确认的任务目标、验收标准和授权边界，是判断该任务是否履约的依据。
_Avoid_: 执行计划、任务标题、实现步骤清单

**执行计划（execution plan）**：代理为履行需求契约选择的实施路径；在契约边界内可以调整。
_Avoid_: 需求契约、授权范围

**已授权待办（authorized work item）**：需求、验收标准和权限已获用户批准，可以由代理主动接取执行的一项工作。
_Avoid_: 任意 issue、任务标题、未批准提案

**待办队列（work queue）**：保存和组织后续工作的集合；只有已授权且满足执行条件的条目可以被代理接取。
_Avoid_: 唤起时刻表、当前执行计划

**队列授权预算（queue authorization budget）**：用户为一批已授权工作给出的累计资源额度；跨任务、重启和重试持续计入，增加额度需要新的用户授权。
_Avoid_: 单次运行预算、每次唤起刷新额度、订阅剩余配额

**工作提案（work proposal）**：代理发现问题后形成的待决建议；在获得授权前不代表执行承诺。
_Avoid_: 已授权待办、自动立项

**验证依赖（verification dependencies）**：一个验收结果成立所依赖的被测产物、验证程序及相关条件的集合；集合内容变化会影响该结果的适用性。
_Avoid_: 仅修改文件、仅生产源码、代理认为相关的文件

**验证回执（verification receipt）**：一次实际检查的可追溯记录，说明检查了什么、如何检查以及观察到的结果。
_Avoid_: 完工声明、证据摘要、仅更新指纹

**交付终点（delivery endpoint）**：一个任务经授权必须达到的结果状态；验证通过、合并主干、上线并验证是不同终点。
_Avoid_: 完成（未说明达到哪一层）、发布（泛指所有交付状态）

**可合并变更（merge-ready change）**：实现满足验收、独立评审无阻塞、CI 通过且附有验证证据的变更；这是默认交付终点。
_Avoid_: 已合并、已上线、代码写完

**合并交付（merged delivery）**：经过验证和评审的变更已合入约定主干；采用此终点需要项目明确授权。
_Avoid_: 可合并变更、生产发布

**上线交付（deployed-and-verified delivery）**：变更已部署到约定线上环境并完成约定线上验证；采用此终点需要项目明确授权。
_Avoid_: 部署命令成功、已合并、未经验证的上线

---

# 产品术语表（自 AGENTS.md §8 迁入，2026-09-24，goal v030-m1#N10——唯一来源）

先查此表再造词；与本表冲突以本表为准。新术语按本表风格（定义 + _Avoid_）补入。

**纪律层（discipline layer）**：本产品的价值层——计划门、证据验证、防半途而废。_Avoid_: 工作流强化层
**目标循环（goal loop）**：`lzy loop` 驱动的「注册目标→逐步派发→证据验证→完成」状态机循环。_Avoid_: 深循环（仅架构讨论语境）、ulw-loop（上游名）
**证据（evidence）**：绑定 tree hash 的真实表面取证（HTTP 返回/截图/CLI stdout）。_Avoid_: 测试结果（测试全绿≠证据）
**双证据（red-green evidence）**：F 项断言默认双半取证——红半=改动前状态上断言失败的取证（先于改动取得）+绿半=改动后通过的取证；构造不出反态的面一行豁免（须给理由，非静默跳过）；comparator 增查红绿在场（goal v006-quality-batch1，2026-09-15）；0.1.0 起红绿可各绑 harness（--harness 程序串 sha256 入节点，错配 HEAVY finish 拒+list ⚠，INV-09 缺红 finish 拒、恢复=反向配对或 waive）。_Avoid_: 测试先行（TDD 是代码层，此为取证层）、回归测试（泛化）
**红绿 manifest（red-green manifest）**：红绿两半的机器账本（中央 DAG 中 half=red/green/waived 的证据节点+captured_on/red_of 边）——red/green 各绑各面（base 树指纹或 `--surface` 外部表面均合法），rebind=supersedes 链+red_of 最新现行；机器只记账不裁决，缺半不拦门，执法仍在协议文本+comparator（ADR-0014，2026-09-17）。_Avoid_: 测试报告（另一物）、运行日志（无结构无边）
**失效 DAG（invalidation DAG）**：中央依赖边账本（`loop/dag.json`，跨 reset 常驻）——取证/评审时注册边、变更时图上传播失效、可答「什么依赖 X」；hash 比对是边型之一非权威本体，统一权威切换（棒2）后 verify/finish 整体读图、图不可读即 fail-closed；存储介质=JSON 原子写（node:sqlite 因 Node 22.0–22.12 无旗标缺席而否决）；0.1.0 计划期证实被动指纹直比已覆盖失效语义→传播=query-time（lzy dag stale 只读预览，写时失效不建）（ADR-0014）。_Avoid_: 哈希推导式（拍板已否决）、缓存（它是权威候选非旁路）
**世系（attempt lineage）**：forward-only 的 attempt 代次账本（loop/attempt.json，校验和+原子写+errno fail-closed，跨 reset 常驻）——执行中改计划不回卷当前 attempt，旧代次置 superseded、开新代次并重过全部采纳门（INV-06 自然成立）；账本缺席时从中央账本 plan 节点 attempt 戳派生只读视图（不回填）。_Avoid_: 重试日志（无代次语义）、回卷（in-place re-plan 已否决）
**tree hash**：`git rev-parse "HEAD^{tree}"` 的内容快照哈希；代码一变，旧证据作废。_Avoid_: commit hash（不同物）
**实现项 / 终验项（N 项 / F 项）**：计划行语法的两类条目；F 项强制真实表面证据。_Avoid_: 普通 todo
**换路注记（attempt note）**：步骤重做（换方案/返工）时在计划文件对应条目下追加的一行弃用账——第几次尝试、为何弃用、改走何路；计划文件即尝试历史，接手会话不重蹈已证伪路径。_Avoid_: 重试日志、返工备注（无格式无归属）
**tier（轻重分级）**：LIGHT 默认精简 / HEAVY 全套纪律；只升不降。_Avoid_: 模式切换
**决策完备（decision-complete）**：计划无任何「待定」，执行者无需再问即可开工。_Avoid_: 草稿
**触发词（trigger）**：`zw` 主词；`ulw` / `ultrawork` 为兼容别名。_Avoid_: 单用 ulw 指代本项目触发词
**经验并发带（empirical concurrency band）**：doctor 从本地日志实测的「无 429 桶最高活跃会话数 / 有 429 桶最低活跃会话数」；连贯且样本足量才输出。_Avoid_: 并发上限（平台侧数值，本地测不到）

**回合（turn）**：一次去重后的模型请求；引擎重试产生多条限流事件仍属一回合，doctor 限流标题按回合计。_Avoid_: 请求次数（含重试的原始条数）
**项目记忆（init-deep）**：init-deep 技能生成的分层 AGENTS.md 地图（根 + 有资格子目录），随 git 入库=仓库/团队面；个人教训归内置 memory（zw 收尾）。资格谓词=构建入口/文件数>40/根提及（纯代码可判）；写盘必经草稿先行（ADR-0002）。_Avoid_: 项目知识库、复杂度打分
**无人值守模式（unattended）**：宿主自动化定时唤起、只推进 executing 目标、绝不立新计划的运行形态（ADR-0003）。_Avoid_: 全自动模式、自动驾驶 ‖ **错峰窗口（off-peak window）**：doctor 建议的自动化挂载时段——实测限流集中段对侧净弧中央 8h 与计价高峰表（写死本地、UTC+8、人工维护）相交核对，附计价安全窗。_Avoid_: 并发上限、空闲时段
**认领（claim）**：会话对进行中目标循环的接管登记（唤起级触发命中时 UPS 写 `claimedAt` 入会话文件；句中提及不写——ADR-0004 修正案）；Stop 拉回只作用于认领会话，集合语义可多会话并存。步级认领（2026-09-14）=`lzy loop claim` 对单步的匿名互斥登记（48h、受依赖阻塞门、done 自清），服务同目标多工人。**旁路会话（bystander session）**=同目录未认领循环的会话（如纯问答），不受 Stop 拉回、SessionStart 广播照收。_Avoid_: 会话独占、锁定（无 SessionEnd，独占会死锁）、脏会话
**交接快照（handoff snapshot）**：模型主动收尾时写入的精确续跑状态（7 字段强制模板：剩余步骤/下一步动作/目标与进度/脏树清单[内嵌 git status --porcelain]/tree hash/风险与坑/复归指令；内容 lint 强制、mtime ≤2h、模板在 zw SKILL.md），经 `lzy loop handoff` 登记为目录级匿名标记后，Stop 钩子消费即放行（一次性、不耗预算，ADR-0009；plan-v2 Phase 2-5）——交接是把执行权交还用户，非半途而废。_Avoid_: 认领（注册表侧登记）、Handoff-able steps（计划步自含性）、放弃（无放行，直接弃目标）
**水位警戒线（water-level watch）**：stop 钩子读本地计费账本折算近 5h 滚动积分，超自参照定标阈值（写死+env `LZY_WATERLINE_POINTS` 覆盖）每窗注入一次收尾 nudge；计价折算走「常设系数+带日期区间促销 overlay」（`lzy loop cost`，退役自然回落常设）（plan-v2 Phase 2）。按档位智能调记债不做（事实源缺席，2026-09-20 复核实证：账本零档位字段+引擎 quota 全响应式；升格条件=引擎本地暴露档位/配额→池位百分比口径，roadmap 底稿 §⑯）。_Avoid_: 水位 tripwire（与空转绊线 tripwire.js 撞名）、并发上限、套餐池位百分比（档位本地不可探测，决策 #16）
**宿主工作区（host workspace）**：跨仓目标中寄宿 `.lazyzcode/` 状态与循环命令的仓库——会话以它为根，代码可在兄弟仓；严格 cwd 不 walk-up（ADR-0006）。_Avoid_: 元仓库、主仓、状态目录、代码仓
**提交账本（commit ledger）**：提交尾注 `Goal: <slug>#<步号>`，每条改动可回溯目标循环（ADR-0005）；doctor `ledger` 行巡逻覆盖率。_Avoid_: AI 署名尾注（另议）、提交即日志
**已知未知（known unknowns）**：HEAVY 计划末尾强制申报的未验证前提节（1–3 条各带证伪途径；「无」须一行说明扫过哪里）——与门禁词互补：前提可申报，决策不可推迟（ADR-0007）。_Avoid_: 待定事项、风险管理清单 ‖ **高危步门（H3R gate）**：无人值守段循环里的步级高危拦截**原型族**——三件：段起点判定（数据源，`LZY_ABLATE_H3R_GATE` 恰 "1" 唤醒）、一段一步门（同段异步 `step done` 即拒、同 rebind 放行）、命令层门（PreToolUse deny+命中标记，段标形状校验 `<整数>:seg-<整数>`）；命中即不 spawn/不执行、干净收束+交接快照；**默认休眠**（开关语义与家族相反，ADR-0022）；交互会话以免门为常态（前提 env 卫生）且为恢复路径。_Avoid_: 机器门（休眠态下只是原型，SKILL 句仍是 L0）、批准门（本原型不建批准面）、风险词表（判定面之一非本体）
**传输死亡（transport death）**：引擎 turn 在网络传输层失败、请求未达服务端（ENETDOWN/ECONNRESET 等 errno 族，主判据在 statusMessage；引擎常误标 retryable=false）；doctor `transport` 行分族计数、绝不进并发带/错峰窗数学（ADR-0008）。_Avoid_: 断网（过泛）、网络繁忙（服务端杀流另一族）、网络错误（与 429 混淆） ‖ **内容审核杀流（content kill）**：请求 HTTP 200 正常开流、模型生成中途被服务端内容审核掐断（1301 族，输入或生成内容皆可触发；引擎常误标 reason=unknown；retryable=false 原地重试必复现）；doctor `content` 行分族计数、绝不进并发带/错峰窗数学（ADR-0008 同款测量纯度）。_Avoid_: 敏感内容拦截（平台话术）、断网（传输族另一事）、限流（配额另一事）
**证据对照（comparator）**：F 项断言与已取证据的相关性核验——存在性与新鲜度是机器门，真证明断言所言归对照；HEAVY finish 前 qa-executor 逐对判「匹配/不匹配」，不匹配协议级阻断（CLI 零代码）。_Avoid_: 证据验证（泛化，存在性+新鲜度义已占用）、测试全绿
**可回收工件（salvageable artifacts）**：被 reset/abandon 终止的目标循环残留的可复用产出（未提交改动、带尾注提交、计划与证据包）；销毁时盘点入 `.lazyzcode/loop/salvage/` 存根，status 双分支显示。_Avoid_: 废弃物、垃圾（负资产谬）
**启动器（hook launcher）**：钩子命令与 node 解析之间的垫片层——`plugin/hooks/run-hook` 家族（POSIX sh 本体 + `.cmd` 对偶孪生：一行清单跨双平台，Windows 经 cmd PATHEXT 解析；fail-open 契约与 nvm/homebrew 回退链不变）。0.0.6 三平台支持主题，方案与证据见 docs/design-crossplatform.md。_Avoid_: 包装脚本（泛化）、shim（npm 语义已占用）
**完整性内核（integrity kernel）**：finish 前机器闸门族（dirty/missing/fail-closed+快照哈希+tier 门）的总名——证据链完整性由机器强制，非自觉。_Avoid_: 质量门（泛化）、测试覆盖
**证据主体 subject**：纳入证据时效与 finish 闸门视野的 git 树根集合元素（host 恒在；兄弟仓经声明追加；只追加树根不切 host 子路径）。_Avoid_: 子模块、依赖仓
**复合指纹（composite fingerprint）**：subject 集每根 HEAD 头树哈希按 realpath 排序串接的 sha256——任一根树变即整体过期；legacy 证据仍按单树 treeHash 比对。_Avoid_: tree hash（单物）、多仓哈希
**人权门（human gate）**：计划采纳（含 supersede 重采纳、双档全适用）的 L2 机器门——批准记录只能由 UserPromptSubmit 钩子在含「批准 <planHash 前 8 位>」短码的真实用户消息上写入；模型经 CLI/手写文件自批即假人权门（已证伪前提，永不建 approve 命令）；exact-hash 对人可见，批准后改计划即作废（ADR-0018）。_Avoid_: CLI approve（假人权门形态）、口头点头（L0 协议句，非本门）
**standdown（旁观声明）**：会话级 UPS 触发词（「zw standdown」）写的显式退出旗标（sessions/<id>.json 常驻）——Stop 读到即只读放行（零写盘、不耗拉回预算、不消费 handoff 标记）；参与触发（写认领）即清、reset 清（sessions/ 整目录）；只声明自己不点名他人（ADR-0009 修订节，2026-09-19）。_Avoid_: 交接（精确一次性快照另物）、弃目标（无放行直接弃）、暂停（无恢复语义）
**波（wave）**：`lzy loop drive --workers N` 的一次工人民工分派-组装单元（一波=一段，每波把可认领 pending 步均分给 N 条工人链，波终 merge 回宿主+屏障重锚）——收束/清理/回收的所有权边界见 ADR-0026。_Avoid_: 段（段=单工人径的引擎会话单元，两词在账本与报文里分用） ‖ **无人值守运行时（unattended runtime）**：0.2.0 无人值守形态的执行面——`lzy loop drive`（棒2）在一次唤起内编排多段 headless 会话推进 executing 目标，段间查 budget/lease/risk 三门，收束=handoff 干净交回；与「无人值守模式」（唤起面，宿主自动化）分词：唤起归宿主、执行归 lzy（ADR-0003 修正节/0020）。_Avoid_: 全自动模式、常驻 daemon ‖ **运行预算（drive budget）**：每次 drive 的墙钟+积分双硬顶（缺省 30min/400pt，env `LZY_DRIVE_*_BUDGET` 覆盖），超顶拒=收束信号；宿主外生上限（闲时墙钟掐断）为一等输入（ADR-0020）。_Avoid_: 套餐池位百分比、并发上限
**运行级认领（lease）**：drive 运行期的机器互斥——分钟级 TTL+心跳续期+结束释放，匿名 handle=fence 令牌不存 sessionId；区别步级 claim（48h 占步）；单运行时互斥（ADR-0020）。_Avoid_: 步级认领（另一层）、会话锁（独占死锁） ‖ **防伪令牌（fencing token）**：单调递增的写路径申报凭证——写命令带 `--fence`（或 env）申报且必须与现行租约相符，失效=已被接管立即停手不写；交互不带 fence 恒直通（opt-in 申报制，ADR-0020）。_Avoid_: 附件指纹（另一物）、session id（匿名立场禁存） ‖ **引擎面（engine surface）**：lzy 消费引擎 CLI 输出的固定触点集合，共五处（`--version`／`plugins enable`／`plugins uninstall`／`plugins list --json`／headless `--json` 摘要）——每面即契约面，形状差异只在 `core/engine.js` 唯一边界归一（`normalizePluginList`），调用方不感知代际；每面须有契约测试（`test/engine-surface.contract.test.js`）（ADR-0021）。_Avoid_: 引擎接口（泛化）、适配层（无契约义） ‖ **代际漂移（generation drift）**：引擎换代时某输出面的形状/语义变化而载荷未同步——典型=0.16.9 的 `plugins list --json` 由对象包封改裸数组致 `enabled` 行 fail 级误报；代际复核须核 JSON 面而非只核版本锚（ADR-0021，§3）。_Avoid_: 版本错配（那是 CLI/载荷版本对照，另一物）、兼容性问题（泛化） ‖ **推进信号（progress signal）**：drive 段循环判「本段有无推进」的状态集口径——done 步数 ∪ subject 头树集（提交）∪ 证据账本绿节点数 ∪ handoff/salvage 登记数，任一前进即清零振数；**不含脏树**。与 Stop 拉回的 no-op detection 是**同一概念的两个执法点，强度不同**：段循环=L1 机器（全集合，`core/progress.js` 单源），Stop 钩子目前只读 done 计数（弱执法点，靠协议文本承载）。_Avoid_: 心跳（另一物）、活性探针、F 项证据指纹集（旧 SKILL 措辞，0.2.2 棒1 已正名）

**执行回执（verification receipt）**：检查配方经受控执行器真实运行产生的自校验和记录（runId/checkId/契约哈希/候选身份/输入与环境指纹/退出/工件 sha256；`.lazyzcode/verify/`，reset 不清，篡改 fail-closed，原始输出与摘要分离）——由真实执行产生，改文本或改指纹不构成新执行（0.3.0 M2，主方案 §4.1）。_Avoid_: 测试结果、证据（红绿账本另物）
**范围档（scope tier）**：配方声明 inputPaths 且过对抗资格后按依赖复用回执的档位——四问（清单非空/资格在案/输入快照一致/清单与环境未变）任一不过即具名保守回退全树；复用只追加适用性判定不改写旧回执（ADR-0025）。_Avoid_: 增量测试、缓存（无资格语义）
**整合验证（integration verification）**：workers 波末对合并候选树真实执行 check 清单并落回执的屏障面——失败 windDownW(false) 阻塞交付 A；替代已退役的「屏障重锚」（重锚 ≠ 复验）。_Avoid_: 屏障重锚（已退役）、冒烟（泛化）
**候选（candidate）**：交付 A 的被测对象=工人变更整合后的本地可合并分支态（HEAD+复合指纹绑定）；无远端 CI 时如实标注「CI 缺席」，不冒充已合并。_Avoid_: 主干（未合入）、产物（泛化）
