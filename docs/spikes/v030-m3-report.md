# v030-m3 实施报告：0.3.0 M3 有界队列与 lazyzcode 队列试点

goal `v030-m3`（0.3.0 M3：授权队列状态机 + 累计预算账本 + 派发恢复 + lazyzcode 队列试点）· 2026-09-25 开工。
主方案 docs/plan-v030-agent-first.md §5/§7/§10-M3；ADR-0024（契约授权）/ADR-0020（runtime 原语）；计划 `.lazyzcode/plans/v030-m3.md`（快照 sha256 c93dba980e…，19 项：N:12 F:7）；契约 `.lazyzcode/contracts/v030-m3.md`（contractHash 0b01eafd…，UPS 批准在案 2026-09-25）。

## 1. 冻结基线

| 面 | 冻结值 |
| --- | --- |
| 本仓 HEAD（开工时点） | `9f3e7aa7b9405511b8251ac61a1486101fb2f99d` chore(loop): v030-m2 close-out |
| 计划快照 | `.lazyzcode/loop/snapshots/v030-m3.md` · sha256 c93dba980e… |
| node | v24.19.0（nvm；M3 纯 Node CLI 面） |
| 测试基线（F7 锚点） | `npm test` **538 绿 / 0 红**（改前实测 2026-09-25，52.6s，EXIT=0） |
| 夹具 | `~/Codehub/v030-fixtures/lazyzcode@4b54f77` 分支 `v030-m2-pilot` HEAD `fe139ea`（M2 修复合并态：workers 守卫已修+夹具清单在场）· clean · 槽位含 done goal `v030-m2-pilot`（7/7，报告已归档，N10 export+reset 腾槽） |
| 计划外事件 | 无（开工时宿主树清洁，git status porcelain 空） |

## 2. 接线点事实表（explorer 八问侦察，代码级，2026-09-25）

| # | 面 | 事实 |
| --- | --- | --- |
| 1 | 预算原语现状 | lease/acquire-heartbeat-release-reclaim（runtime.js:180-278）+ fencing（:286-306）+ budget init/recordSpend（:329-428）全系**单文件** `.lazyzcode/loop/runtime.json`（{runtimeVersion, fenceCounter, activeLease, budget:{wallClockBudgetMs, pointsBudget, spentMs, spentPoints, lastOverrun?}}，:47-54）。记账是 **per-run**：initBudget 以 restart:true 每次 drive 归零（runtime.js:329-359；调用点 drive.js:344-348 单工/:881-882 workers）；points 恒 0——全部 recordSpend 调用 points:0（drive.js:461/:1126），points 轴只有账户级 5h 水位读数（cost.js:234-247，drive.js:536-541 只读）。**无任何跨 goal 累计、无授权绑定**——M3 累计账本为全新绿地；可复用=文件纪律（tmp+rename 0600 :139-159、载荷 sha256 fail-closed :104-134、单调写护栏 :148-153、超支先记账后 throw BUDGET_OVER :364-399）。 |
| 2 | reset 存活家族 | doResetLoop 只删 goal.json+loop 内 tmp（家族表）+sessions/* 内容+handoff.json+segment.json+h3r-hit.json（loop.js:2387-2407）；**存活**：runtime.json、dag.json、attempt.json、metrics.json、snapshots/、salvage/、approvals/ 及 loop/ 外 evidence/、attestations/、authorizations/、verify/、plans/——queue/budget 放 loop/ 外即天然 reset 不清（本报告评审员复核判定该断言为真）。 |
| 3 | 派发面 | runDrive 门序：readGoal→executing→assertDriveEligible（风险）→engine→headless 凭据（drive.js:262-281）；锁内 lease+per-run budget 一段（:340-355）；段循环门序=风险复查→lease 心跳→H3R 门→墙钟余量→spawnHeadless（:436-445，headless.js:68-73/:119，`--prompt/--json/--resume`）；结算=记账(:459-468)→h3r 消费→done/身份变化检测(:502-510)→进度签名(:523-529)→水位(:536-542)。windDown(ok)（:290-335）：true=干净收束 exit 0+7 字段 handoff；false=门/基建失败 exit 1；workers 侧平行 windDownW（:771-822）。workers 路径 pendingCount=0 自跑 finish（:1004-1014）；单工路径无自动 finish。resumeSession 仅内存（:446）——重启即新会话，恢复核对按 tx 记录×goal（slug/status/attempt，:507-510/:994-1002/:1088-1096）+lease slug 绑定（runtime.js:299-304）。 |
| 4 | 授权引用 | 账本 `.lazyzcode/authorizations/` 追加式 JSON、loop/ 外 reset 不清（contract.js:134-136）；记录 {version:1, kind:"approval"|"withdrawal", slug, contractHash(64hex), at, sessionId}（:138-159），文件名携 kind+hash8+sessionId+时戳（:212）。**无独立授权 id**——绑定键=(slug, contractHash)，effectiveAuthorization 末事件胜（:191-202）；recordAuthorization（:206-218）docstring 已许「测试与未来受信写者」复用（Known unknowns 2 回退有据）。goal.contract={path, contractHash} 注册时落（loop.js:338-342/:381）；契约门逐字节比对 hash（loop.js:886-930）。 |
| 5 | 计量与积分 | queryHostDb spawn `sqlite3 -readonly -json` fail-soft null（hostdb.js:12-28）；db=~/.zcode/cli/db/db.sqlite（paths.js:46-48）。USAGE_SQL：model_usage LEFT JOIN session，列=m.session_id/model_id/started_at(epoch ms)/status('completed')/input_tokens/cache_read_input_tokens/output_tokens+s.directory（cost.js:106-111）。usage 行**逐请求完成才落**；SIGKILL 在途=永久零行（M0 §5 实锤，#32 拍板语义的记账义务来源）。run 身份=spawnHeadless 返回 sessionId（headless.js:162）+usage 透传对象（:163，M0 §5.1 枚举未拍板=Known unknowns 1）。attributeGoalPoints 时间窗∩目录启发式明确**不复用**（cost.js:166-186）。 |
| 6 | CLI 分派 | top-level case（lzy.js:1267-1306）：install/sync/update/status/doctor/uninstall/loop/step/evidence/attest/dag/contract/project/migrate/verify/agents-md/version——**queue/task/delivery 均不存在**（绿地）；命名冲突零（仅 verify.js:449 局部变量 restoreQueue）。家法=VALUE_FLAGS(:76)/MULTI_FLAGS(:77)+cmdX 薄 handler→core+printHelp 块(:934-1049)+LoopError→exit 1。`lzy loop export` 存在（:315-319→loop.js:2095-2102）；finish 时报告归档（:303-311）；reset 写 salvage stub 后删 goal.json（loop.js:2404-2405）。 |
| 7 | 测试家法 | drive.contract.test.js：HOME 隔离(:36-37)+scratch 仓工厂(:39-50)+spawnSync CLI+LZY_ZCODE_ENGINE 抑制(:53-61)+passDeps 假引擎注入(:99-104)；drive-workers 加 withEnv(:42-53)。崩溃先例=僵尸租约三态（runtime-kernel.contract.test.js:296-330，spawnSync 构死 pid）+围栏僵尸写拒(:200-225)+孙进程 SIGKILL 存活（ablation-spawn）+verify SIGTERM 回执（verify-receipt:87）——**无真 drive 子进程中途 SIGKILL 先例**（队列单测以未决 tx 构造+注入为面，真 SIGKILL 归试点 N11）。消融门=LZY_ABLATE_HUMAN_GATE（loop.js:1110-1114，M0 §8 家法）。基线 538 绿/48 文件。 |
| 8 | 进度口径与夹具 | progress 签名={done, trees, greens, handoffs, salvage}（progress.js:47-66）——登记数仅 handoff/salvage，**不含队列登记**；队列项的正常工作本就经 trees/greens 喂给签名，首版不改 progress（拍板见计划 §设计拍板 3 尾注——HEAVY finish comparator 门为 HEAVY-only，loop.js:1795-1801，队列项 LIGHT 不涉）。夹具=分支 v030-m2-pilot@fe139ea clean，lzy.project.json 在场（check 类 test-suite），authorizations/ 空壳，verify 回执/attestation 为 M2 残档（reset 后随 goal 清理属夹具内家务）。 |

## 3. 计划评审轮记录

| 轮 | 判决 | 处置 |
| --- | --- | --- |
| R1 | PASS（零 MUST-FIX） | 1 P2+4 P3 建议全采纳：P2=ready 谓词对齐主方案 §5.1 五条件（补「工作区可取得租约」——租约占用时 item 留 ready 不派发不以 failed 收场）+队列项恒 LIGHT 声明（HEAVY comparator 终验面不入首版）；P3a=reconcile (c) 分支语义收窄披露（「未知外部结果单独核对状态」留 M4，completed 恒不可由 (c) 到达）；P3b=cwd 规则入拍板 9（queue/budget 按 cwd 的 .lazyzcode/ 解析，试点以夹具根为 cwd）；P3c/d=拍板区为必读指针备注。采纳后评审员续热复核：三处修订逐字验证+全扫描无回归（0 未决 token、19/19 项、deps/accepts 邻接与 A1-A6 覆盖完好）维持 PASS。 |

## 4. F 面预注册（红绿半与归属；F 项执行前冻结）

| F | 表面 | 红半 | 绿半 |
| --- | --- | --- | --- |
| F1 队列状态机活体 | 宿主 CLI stdout+queue.json | N2 捕获：queue 族未知命令原文 | add→proposed；无批准 dispatch 拒且不自动执行；批准→authorized→ready；deps 未完成不 ready；dispatch→running→completed(completedEndpoint=A)+终态不可逆反例 |
| F2 累计预算活体 | 宿主 CLI stdout+ledger.json | N2 捕获：跨目标 runtime.json spent 归零+无累计账本原文 | 两 goal 顺序执行 ledger 两段均入账且 runtime 归零不影响累计；同 dedupKey 重复 settle 拒；未决 tx 按登记上限保守计入（非零）；损坏账本 fail-closed |
| F3 积分近似限制活体 | 宿主 CLI stdout+ledger.json | N2 捕获：积分停派面缺位原文 | 隔离 HOME 无 db→metering-absent 显式记录+受积分限额约束派发停；未知价同停；达限停止下一次派发+在途超额如实；killed-inflight 显式申报 |
| F4 派发恢复活体 | 宿主 CLI stdout+dispatch.json | N2 捕获：dispatch 面缺位原文 | 恢复判定表三支活体（同 slug executing→killed+回 ready 不重注册；同 slug done→补 settle；goal 缺失→failed 带指路）；确认后才腾槽；未决 tx 拒新派发 |
| F5 失败依赖与取消活体 | 宿主 CLI stdout | N2 捕获：取消/批次面缺位原文 | 失败→依赖 blocked+独立项继续；撤回→批次停；cancel 保工件与历史 |
| F6 试点活体 | 夹具 CLI stdout+dispatch/budget 记录+git log | N2 捕获：queue 面缺位原文 | 两项队列全链：item1 完成+endpoint 注记→item2 真引擎段中 SIGKILL→重启 reconcile→item2 完成→累计预算跨重启只增→item1 零重复派发（记录枚举+工件不变）→假引擎/真引擎分列 |
| F7 回归聚合 | npm test stdout | 豁免一行：回归聚合面，反态=人为造红无意义，waive-red 记账 | 538 基线+新增全绿原文+四件套通过原文 |

## 5. 实施记录（随步追加）

- N1：基线冻结+骨架落盘（HEAD 9f3e7aa7…；npm test 538 绿改前实测 2026-09-25 EXIT=0）。
- N2 主机红半预捕（账本 n381-n386，附件 artifacts/v030-m3-red/ sha256 绑定，--surface external 各绑各面）：
  - **supersede 注记（attempt 1→2）**：执行期发现派发采纳步缺声明输入（item.planPath/queue add --plan），按 ADR-0024 契约内重规划走 supersede（评审员续热复核 PASS）；forward-only 世系代价=attempt 1 的步完成记账与红半锚定如实作废（旧 6 红半入他实例历史），N1/N2 在 attempt 2 下重完成、六红半原捕获文件重绑（捕获内容零变化，仍为改前态；捕获时点 2026-09-24T18:13-18:16Z 早于全部代码提交）。
  - **F1/F4/F5/F6 红**：queue 七子命令（add/list/show/budget/dispatch/reconcile/cancel）全为「未知命令：queue」+usage dump，exit 1×7 逐文件落盘——队列面整体缺位。
  - **F2 红**：scratch 注册态 goal，budget init(60000ms/10pts)→spend 12000ms/3pts（非零原文）→**drive 同形态 initBudget(restart:true, fence=1) 后 spent=0/0**、remaining 读 0/60000——消耗无任何跨 run 累计载体；scratch `.lazyzcode/` 仅 `loop`，无 budget/ 无 queue/ 家族。
  - **F3 红**：points 轴仅 per-run 账户读数（drive recordSpend 恒 points:0），无累计积分账本、无 metering-absent/killed-inflight 申报面、无达限停止下一次派发面。
  - 附带纪律活体：无租约直调 restart 形 initBudget 被 fencing 门拒（runtime.js:339「每-run 预算重开仅限持租的 drive」）——修正探针先 `lease acquire` 取 fence 1 再重放，收尾 `lease release` 无僵尸。
  - 消融记账：**零消融**——红半场地仅注册态 goal（register 非采纳门），未触人权门，无 LZY_ABLATE_* 使用。
- N3-N9 实现与测试（commit c6f94bd 单体落地+ade1926 四件套+4e454ac 租约活性补丁）：core/queue.js 三家族+状态机+预算账本+派发事务与恢复判定表+逐会话计量；drive.js 段记录 sink；loop.js ANY_TMP_SCAN_DIRS +queue/budget；CLI 七子命令。测试 29 新增全绿，npm test **567 绿/0 红**（538 基线+29）。
- N10 试点夹具准备（2026-09-25）：夹具槽位 export+reset（v030-m2-pilot 残档腾退，salvage 盘点在案）→分支 `v030-m3-pilot`（基点 fe139ea）→契约/计划落库 commit `21b60f2`→批准落账走 recordAuthorization 受信写者（**Known unknowns 2 证伪与回退**：LZY_ABLATE_HUMAN_GATE 只跳过门不落账，authorizations/ 无记录则队列授权门（零消融）恒拒——回退=contract.js:206 docstring 许可的受信写者路径，批准记录真实在案〔approval-0fa782a9/58f8fe3d〕、非 UPS 人工事件，如实记账：本试点受测面=队列机器非批准门）→queue add q1/q2（q2 deps q1）+queue budget 墙钟总额 900000ms→预检活体：q1=ready、q2=authorized（未就绪首因=依赖）。
- N11 试点驱动与交付（2026-09-25，真引擎，全部活体冻结 artifacts/v030-m3-red/n11-*.txt）：
  - **item1 全链**：dispatch→register/采纳（契约门零消融过）→真引擎段 1（sess_5411d3b8…，433449ms）→goal done→finish→结算 **积分 6.79 真实计量入账**（宿主 model_usage 逐请求完成行×ADR-0023 计价）→队列确认→腾槽→**自动续派 q2**（跨项墙钟累计：剩余 466551=900000−433449）。
  - **段中 SIGKILL**：q2 段中杀驱动进程树（孤儿引擎随父消亡；其死前已交付 marker-q2 提交 `4bac34a`+N1 done——真实部分工作形态）。崩溃态：q2 tx open+goal executing+僵尸租约（fence 5，hostPid 死）。
  - **重启恢复**：reconcile 判定表 (a) 活体——僵尸租约回收（fence 5）→tx killed+**killed-inflight 假零申报**→item 回 ready→**同 goal 续跑不重复注册**→引擎收 F1→goal done→完成（endpoint A，积分 5.02）→腾槽→队列排空 exit 0。
  - **断言清单全绿**：q1 tx 恰 1 条（零重复派发）；累计预算跨重启只增（墙钟 729028ms=433449+295579、积分 11.81=6.79+5.02，runtime.json per-run 归零不影响）；item1 工件零二次改写（恰 1 交付提交）；夹具树清洁+槽位腾空。假引擎用例（四件套 29 测试）与真引擎结果分列：两侧恢复判定表/计量/累计语义一致。

## 6. 对抗清单自查（docs/research-adversarial-checklist.md 九类，2026-09-25 收口）

本 goal 新增面：core/queue.js（三家族/状态机/派发事务/恢复判定表/逐会话计量）、drive.js 段记录 sink、CLI queue 七子命令、`.lazyzcode/queue/`+`.lazyzcode/budget/` 两家族。逐类：

1. **malformed input——已有防护（新面自带，测试钉）**：三家族校验和 fail-closed（篡改 ledger 字节→读面拒，budget ②）；schemaVersion 形状断言+写前形状校验（写侧毒化防护）；deps 未知/自指/环 add 即拒；endpoint B/C、计划缺位、非正预算值全拒（state ③④、budget ⑦）；querySessionPoints sessionId 白名单净化（引号/分号/越界→absent，metering ④——SQL 内插注入面防御）。
2. **prompt injection——不适用（攻击面未扩大）**：契约/计划信任级不变（批准流=M1 面）；队列读面（list/show/budget）全为本仓产生的状态文本；宿主 model_usage 行只折积分数字，不进任何命令构造。
3. **cancel-resume——本 goal 主题（真引擎活体在案）**：段中 SIGKILL→tx open 保留→重启 reconcile：僵尸租约回收（holderPidAlive 判死）→killed+killed-inflight 申报→同 goal 续跑不重复注册→完成（N11 活体）；busy-live（租约在握且持租进程存活）不核销不重驱（recovery ④）；孤儿引擎部分工作（marker-q2 提交+N1 done）被恢复链如实接管。
4. **stale state——已有防护**：三家族在 loop/ 外 reset 不清（位阶先例+reviewer 复核）；预算未决占用按登记上限保守计入（不假零，budget ③）；终态不可逆；supersede 世系切换后旧代红半锚定如实作废重绑（N2 注记）。
5. **dirty worktree——已有防护（试点实测）**：夹具夹具文件未提交→finish 完整性闸门拒→队列未竟路径 item 回 ready 不假完成（调试期实锤，后夹具补提交全链绿）；试点终态夹具树清洁+槽位腾空。
6. **hung commands——已有防护**：队列项 goal 沿 drive 既有墙钟/段上限/段超时；队列总额（wall/points）在派发门与占用登记双层约束；假 drive/真 drive 测试均 maxSegments 收束。
7. **flaky tests——已有防护+一处显式边界**：四件套 29 例全假 drive/deps 注入零触网；真实 sqlite3 面不进测试（缺席路径=HOME 隔离天然全平台；db-present 路径=注入 querySessionPoints）；真实引擎面只在试点活体（不在 npm test）。
8. **misleading success output——本 goal 主题（红绿全链在案）**：未授权提案永不 ready/零执行（recovery ⑥）；未竟不假完成（finish 拒→item 回 ready，非 failed 非 completed）；计量缺席/未计价/killed-inflight 三类显式记录不折零；overrun 如实入账（budget ⑤）；重复回执 dedup 拒；queue list 就绪面直陈未就绪首因。
9. **repeated interruptions——本 goal 主题（活体在案）**：killed tx 重驱同 goal（N11）；重复 dispatch 对 open tx busy-live/killed 判定收敛；dedupKey 幂等结算（重复 settle 全 duplicate=no-op）。

## 7. 债记账（收口时点）

- **债 F（M1 记，处置声明）**：scope 运行时执法缺位（writePaths/inputPaths 均不观察逐次写入）。M3 派发面落地后重评：首版派发=受控 argv 执行器（shell:false）+队列自有 goal 注册面，暴露面已收窄；文件系统级逐写观察成本/误伤比失衡。**债 F 继续挂账，升格条件改挂 M4 交付面**（外部动作前授权核对）。
- **债 G（M2 记，范围延伸）**：win32 执行语义未核——本 goal 计量测试已把「真实 sqlite3 CLI 缺席」纳入同族边界（缺席路径全平台活体；db-present 路径注入缝平台无关）；drive 段 SIGTERM/win32 gh 解析仍沿 M2 原债，CI 矩阵轮真值补核。
- **债 I（新记）**：队列项 goal 的 LIGHT 恒定+endpoint A 恒定为首版收窄——HEAVY 项（comparator 终验面）与 B/C endpoint 入队归 M4；「未知外部结果单独核对状态（主方案 §5.1）」首版收窄为 failed+人工指路，M4 交付面重评。
- **债 J（新记）**：孤儿引擎的段后工作不受队列控制——SIGKILL 后孤儿引擎可能继续写（本试点实测：死前完成 marker 提交+N1）。恢复链如实接管该形态，但「杀驱动即杀全部在途」不作承诺（进程组语义归宿主/引擎边界，ADR-0020 已知边界同族）。
- **债 K（新记）**：engine `--json` usage 摘要作第二计量源的对账（Known unknowns 1）未拍板——试点结算全走宿主 db 行（唯一权威），摘要未消费；M4 交付面若需低延迟计量再做对账拍板。
