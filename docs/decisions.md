# LazyZCode 决策速查表（自 AGENTS.md §4 迁出，2026-09-24，goal v030-m1#N10）

本文件是决策记录的单一事实源（原 AGENTS.md §4 全表，迁移零删改）。
**决策变更 → 必须同步本表**（一行一条 + 日期）；AGENTS.md §4 只保留现行摘要与指针。

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
| 14 | 证据时效语义 | F 项证据绑 `HEAD^{tree}`（提交粒度）：**先提交再取证**；未提交改动不入 hash，工作区脏时 CLI 警告（`.lazyzcode/` 自身不计脏，2026-09-06；0.0.8 警告升格闸门，单树升复合指纹） |
| 15 | P2 纪律阵容 | 三只读角色（explorer/plan-reviewer/qa-executor）；计划评审门 **REVISE 拒绝采纳、--force 不越过**，HEAVY 强制过门 / LIGHT 自查；触发词钩子做（UserPromptSubmit，词边界防误触）（用户拍板 2026-09-06） |
| 16 | 限流自适配路线 | **经验测量**，非声明式配置：套餐档位本地不可探测（2026-09-07 实查），doctor 从本地日志实测 429 压力与经验并发带，零新增配置面（用户拍板 2026-09-07） |
| 17 | 拉回资格归属 | **认领制**：goal 目录级共享 + 会话认领集（触发词写 claimedAt）；多认领集合语义（无 SessionEnd，独占会死锁）；**空集回退废止（2026-09-19 修正案四）**——拉回资格=会话持未过期 claimedAt，空集=无人可拉，旁路结构性免拉，standdown（UPS「zw standdown」）为显式豁免通道〔参与触发清旗标、reset 清、归 TRIGGER 消融轴〕；进度感知振数（无进展两振写 stuck，拉回上限仍 2 红线不破）；`lzy loop claim` 写面与跨项目清单记备选（ADR-0004，2026-09-08；写面 09-09 收窄至唤起级，见 #19；修正案四 2026-09-19） |
| 18 | 透明账本 | **提交尾注 `Goal: <slug>#<步号>`**（人和 AI 遵守，历史不补）+ doctor `ledger` 行巡逻覆盖率（warn-only）；证据 opt-in 入库（计划声明+人点头→docs/evidence/）；AI 署名不加（ADR-0005，2026-09-09） |
| 19 | 宿主工作区 | **跨仓目标循环寄宿主仓**：`.lazyzcode/` 与 `lzy` 只在宿主根，严格 cwd 不 walk-up；写命令 fail-fast（防空壳疤痕，reset 豁免）+ 无 goal 出口恢复式报错；证据时效门只见宿主树（多树绑定记债，升格=跨仓漏判误 finish；多树债已由 #23 subject 集收口〔未声明兄弟仓=声明纪律残差，ADR-0013〕，2026-09-16）；ADR-0006（2026-09-09） |
| 20 | 已知未知与消融 | **HEAVY 计划强制「已知未知」节**（未验证前提≠推迟决策，1–3 条各带证伪途径，「无」须一行说明）+ 影子消融记账（评审差集按 P0-P3；预注册判据：连续 5 HEAVY 目标独有 P1/P2≈0 → 只许「维持现状或真消融终审」绝不降档）；门禁词黑名单不动（ADR-0007，2026-09-09） |
| 21 | 依赖图并行认领 | **最小链已落地（2026-09-14，goal v005-core）**：计划项 deps 依赖边解析[存在/自指/成环门检]+匿名步级认领 `lzy loop claim`（48h 互斥、认领受依赖阻塞门、done 自清、--release、无参可认领集、status claimed/blocked 读面；收口与 finish 不看 deps——依赖只影响可认领集与 status 标注）+worktree 派工走宿主目录（§3.5 不推翻，zw SKILL Parallel dispatch）+doctor 按 provider 分桶测带[band-by-provider：completed 完成面×429 脏面，窗内有 429 且 ≥2 provider 才出行，自身无 429 的行如实标注「无脏面样本」]；不做：多模型分发、角色指模型（前置件未齐）；已知边界=认领匿名（未过期认领只能 --release 释放；过期自然可再认领）；需求侧证据：pisper premise=并行会话编排、vibe-kanban 28.1k★/happy 23.8k★（2026-09-13 实取，docs/research-competitor-watch.md）（ADR-0004 修正案三，2026-09-14；修正案二预注册触发器经 09-13 grilling 拍板②提前升格） |
| 22 | 交接放行 | **目录级匿名标记+原子消费**：模型收尾前 `lzy loop handoff --snapshot <file>` 落 `loop/handoff.json`，Stop 一次性 unlink 消费（恰一赢家）后显式 `continue:false` 放行——不入 3 池不耗预算；消费清本会话振数/stuck；匿名=模型在 Bash 拿不到自己 sessionId，拒绝一切转抄身份设计；滥用对冲=快照必填（存在+mtime≤24h）；多认领撞窗记已知边界（ADR-0009，2026-09-10） |
| 23 | 完整性内核 | finish 完整性闸门（{host}∪subjects 任一根 dirty/missing/fail-closed 即拒、无逃生 flag）；证据=复合指纹（subject 集每根头树哈希 sha256 复合，legacy treeHash 回退单树）；plan snapshot+planHash（采纳即快照、review 绑哈希、复采纳换哈希须重评审）；tier 落盘+HEAVY 机器门（采纳时点无 PASS 拒、--force 不越过、只升不降）（ADR-0013，2026-09-16） |
| 24 | 失效 DAG 与红绿 manifest | **中央 DAG 存储**：`loop/dag.json` 跨 reset 常驻、JSON 原子写+校验和 fail-closed（node:sqlite 否决：无旗标仅 22.13+/23.4+ 与 engines >=22 冲突）、节点不可变/边追加、取证与评审时注册边、dag-first（账本写失败整命令拒）；**红绿各绑各面**（E-01 调和：red 缺省绑复合指纹/`--surface` 外部面、waive-red=一行豁免机器形态、机器只记账不裁决、rebind=supersedes 链+red_of 最新现行）；**统一权威=棒2** 切 verify/finish（届时图不可读即拒、无逃生 flag 沿 ADR-0013；legacy 双轨与 0.0.8 全同）（ADR-0014，2026-09-17） |
| 25 | 真消融实验 | **受控跳部件跑真目标**：`LZY_ABLATE_*` env kill-switch（机器五闸门+钩子五短路，默认关=行为逐字段同、契约测试钉红绿；dag.js 不设开关）×陷阱任务集×headless 隔离-HOME 试跑；batch1=六臂×4 题×1 rep=24 trials 串行、batch2 预注册扩展；判据=方向性签名、不裸奔 p 值；结果只作拍板输入绝不自动降档（沿 #20）（ADR-0015 特赦窗口，2026-09-17） |
| 26 | 0.1.0 棒B（世系+传播+headless） | **forward-only 世系**：executing 期改计划=lzy loop supersede（旧 attempt superseded→新 attempt+1、完整采纳门照走、同哈希拒、旧快照归档；跨 reset 同 slug 重注册追加保链；subject 增删维持 ADR-0013 语义不作触发）；**传播=query-time**（计划期证实被动指纹直比已覆盖失效语义、lzy 不观察 commit 无写时挂点→lzy dag stale 只读预览，门不读预览）；**INV-08/09 执法点=HEAVY finish**（harness 错配拒/缺红拒，恢复=recordEvidenceHalf 反向配对或 waive；门序在对照绑定后、同 ablate 守卫；红后录绿 rebind 仍合法）；**headless=原语+E2E 脚本+doctor 行**（无人值守语义 budget/lease/fencing/wake 全留 0.2.0）（ADR-0016/0017，2026-09-18） |
| 27 | UPS exact-hash 人权门 | **H1 单门双档**：计划采纳（plan/supersede/存量重采纳同门）须 UserPromptSubmit 钩子批准记录（slug+planHash 双键；`.lazyzcode/loop/approvals/` append-only、reset 不清）；批准 UX=用户原句「批准 <planHash 前 8 位>」、pending 短码由模型转述；`--force` 不越过（无逃生 flag）；批准后改计划=批准作废重出码；消融开关 LZY_ABLATE_HUMAN_GATE+LZY_ABLATE_HOOK_HUMAN_GATE（恰 "1"，ADR-0015 形态）；威胁边界=防偷懒不防伪证（沿 dag/attestation 本地账本边界，执法点=协议+审计环）；H3R 留 L0、机器门随 0.2.0 risk_class 机器面升格（ADR-0018，2026-09-19） |
| 28 | 0.2.0 runtime kernel | **runtime.json 账本三件一体**（ADR-0020，§⑮ 拍板）：lease 运行级认领（分钟级+心跳+结束释放，匿名 handle=fence 令牌）／fencing 写路径守卫（opt-in 申报制——带 fence 必须与现行租约相符，失效=停手不写；交互直通；边界四项入 ADR）／budget 墙钟+积分双硬顶（缺省 30min/400pt env 可覆，超顶拒=drive 收束信号）；risk 机器面=register 落盘+`lzy loop risk` 只升不降+assertDriveEligible drive 入口门（HIGH 拒/RESTRICTED 硬禁出口=重建；棒2 接线）；ADR-0003 修正节=宿主唯一定时唤起面不变+lzy 零调度零写入红线不变（2026-09-20） |
| 29 | 推进信号口径（0.2.2 棒1） | **状态集口径**：drive 段循环的推进判据=done 步数 ∪ subject 头树集（提交）∪ 证据账本绿节点数 ∪ handoff/salvage 登记数——任一前进即清零振数，**不含脏树**（只写不提交不算推进）；单源 `core/progress.js`；**仪器先于实验**：ADJ-34 是 H3R 判据③的**测量仪器缺陷**（stuck 与 H3R 停摆共用 `windDown(true, …)` 干净收束通道），故 0.2.2 棒1 先于棒2；Stop 钩子拉回判据仍是 done-only（同一概念的弱执法点，由协议文本承载，见 §8「推进信号」）（2026-09-21） |
| 30 | H3R 高危步门（0.2.2 棒2；0.2.3 执法点前移） | **原型落主线、默认休眠、车道边界=无人值守段循环**。三原型件（ADR-0022 增补节）：段起点门（判定数据源，`LZY_ABLATE_H3R_GATE` 恰 "1" **唤醒**——与家族「恰 1 消融」语义相反）→ **一段一步门**（0.2.3 goal v023-h3r-enforcement#N2：`LZY_SEGMENT_ID` 申报+`loop/segment.json`，同段异步 `step done` 即拒、同 rebind 放行）→ **命令层门**（h3r-pretool.js PreToolUse/Bash，`LZY_ABLATE_H3R_PRETOOL` 恰 "1" 唤醒；段标形状校验 `<整数>:seg-<整数>`——残留 env 降级无门，「构造上免门」订正为「以 env 卫生为前提」，v023-fix-round ADJ-22）。交互会话免门且为恢复路径。**执法层级=L0**（休眠态下不是任何用户的机器门；SKILL 句按此措辞，禁把 L0 说成机器门）。**实验结论**：0.2.2 门被绕过（15/24 单段跑完）→ 0.2.3 前移后判据①决定性分化（D/E 4/4 停摆、高危 0/4；报告 `docs/reviews/2026-09-22-h3r-enforcement-report.md`，末附重导勘误：deny 真 4、oneStep 真 11、A-h1-r1 改判 leaseLost）；E 臂误停 1/4=子串匹配结构性假阳性（临时目录清理）记账；去留拍板（2026-09-23）=**短期维持休眠**，误停根解〔命令解析器面，与债 H 同轴〕落地后再议升格 B——**根解半已落地**（v024-debt-bundle#N1：分段+词元序列匹配，ADR-0022 增补节 2026-09-23），网格复验误停归零未跑，去留仍 A——**绝不自动升格/降档**，结论在 ADR-0022 增补节 ‖ **词法绕过族已收口**（v024-fix-round#N6/N7，2026-09-23）：段数截断·记账前缀换行·词中引号劈词三轴修复+弧号/方向句订正（E 臂误停实测于 0.2.3 非 0.2.2、两读者判定集互不包含）、ADR-0026 立 workers 车道四边界（HEAVY 拒入/重锚≠复验/认领按 run 释放/哨兵=删除授权） |
| 31 | fast 形态保留（0.2.4 收口） | **`--workers N`/`--fast` 波编排保留为主线实验形态**（拍板 2026-09-23，`docs/reviews/2026-fast-exp-report.md` §4）：判据①写型双工人=灰带（0.63×/1.12×，交用户终拍）、判据②多 provider 分流=证伪降级（引擎无 `--model` 旗标）、判据③锁排队窗=PASS；**LIGHT only**（HEAVY 入口拒，结构性死端）；成本反证=turns≈2×（计价轴净亏）故不默认化、不做跨带分流；收束/回收/认领边界见 ADR-0026（2026-09-23） |
| 32 | 0.3.0 积分预算执法语义（M0 V08 探针后拍板） | **带在途超额的近似限制**：逐请求完成粒度检测（账本行请求完成才落库——在途不可见、SIGKILL 在途消耗账本假零）+ 停止下一次派发，在途超额如实记账；V08「已批准上限约束执行」验收据此修订为近似限制语义、M3 解阻；墙钟 SIGKILL 硬顶不变；事后统计单独=诊断能力不算执法（用户拍板 2026-09-24，探针与判定 `docs/spikes/v030-m0-report.md` §5） |
| 33 | M1 契约授权（0.3.0 M1） | **批准对象=contractHash（ADR-0024 落地）**：register `--contract` 绑定不可变需求契约；契约 goal 采纳走契约门五查（磁盘哈希/授权有效/验收覆盖 accepts/subjects⊆scope/配方一致），批准与撤回唯一写入口=UPS 钩子（「批准/撤回 <短码>」，authorizations/ 追加式后到者赢，损坏 fail-closed）；契约内 supersede 重走评审门免人权门；无契约 goal 保持 #27 planHash 门逐字段不变（迁移归 M5）。机器门同受 LZY_ABLATE_HUMAN_GATE、钩子双分支同受 LZY_ABLATE_HOOK_HUMAN_GATE（消融矩阵钉） |

