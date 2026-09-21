# 对抗类清单（adversarial checklist）——九类逐项处置交代

- 日期：2026-09-15（goal v006-quality-batch1#N2）
- 定位：0.0.6 质量面交付（gap-roadmap §⑦ 第 2 项）；后续 README 对比表「唯家/差距」叙事的事实源之一。
- 规则形态（与我方纪律同构）：**适用必探、排除记理由，一类不漏**——HEAVY 目标收尾自查时可按本清单逐类核对，命中类须有证据或豁免理由。

## 出处与许可证边界

九类分类学取自竞品 OhMyZcode（djt889/OhMyZcode，`commands/ulw.md` 与 `skills/ulw-execute/SKILL.md`，commit `4f751637`，取证日 2026-09-15）：malformed input / prompt injection / cancel-resume / stale state / dirty worktree / hung commands / flaky tests / misleading success output / repeated interruptions；其 DESIGN 文档自述该分类学系自 OmO（oh-my-openagent，SUL-1.0）ultraqa 九类全量移植。

**边界声明**：本仓对 OmO 只学思想、不搬文本（SUL-1.0）；对 OMZ 仅引分类学事实（类别短语与「适用必探/排除记理由」规则形态），本文全部行文（类定义转述、防护点指认、判决）为本仓自写。若边界认定需更强隔离，退路=自创九类命名并保留与本表的对照。

## 九类逐项

判决三态：**已有防护**（指认现存防护点）／**当轮小修**（本计划已列的文本层改动收紧）／**记账新债**（代码级缺口，本轮不修，附升格条件）。

1. **malformed input（畸形输入）**——垃圾/越界输入不得使状态损坏或静默错行。判决：**已有防护**。计划门逐行语法+依赖边校验+禁词黑名单（`core/loop.js:175-207`：未知引用/自指/成环/孤儿 deps 一律拒）；manifest 名版本白名单 `core/paths.js` installPathFor（`OK_RE`，防缓存目录逸出）；证据附件三重拒绝（非文件/超限/超量，`core/loop.js:372-392`）。
2. **prompt injection（提示注入）**——不可信文本不得借道计划/证据驱动执行者越权。判决：**已有防护**（残余记账债 A）。计划评审门 REVISE 判决拒绝采纳且 `--force` 不越过（ADR 评审门语义）；触发词词边界匹配防误触（`plugin/hooks/trigger.js`）；工具空转逃逸契约（zw SKILL，源起 sess_95421d3d 事故）。残余：计划文件内容本身无来源标记（见「记账新债」A）。
3. **cancel-resume（中断续起）**——会话死/引擎重启后状态可续、不重不漏。判决：**已有防护**。Stop 续跑预算按 sessionId 隔离、预留后台通知池（决策 #13，`plugin/hooks/stop.js`）；交接放行一次性 unlink 恰一赢家、放行清振数防重入误振（ADR-0009，`stop.js:131-133` 一带）；SessionStart 状态重注入（`session-start.js`）；无人值守继起协议（zw SKILL Unattended 段）。
4. **stale state（过期状态）**——旧证据/旧缓存/死认领不得冒充现况。判决：**已有防护**。F 项证据绑复合指纹（{host}∪subjects 每根 `HEAD^{tree}` 头树哈希的 sha256 复合，任一根/集合变化即过期；legacy 证据回退单树比对，0.0.8 起）+ finish 完整性闸门（dirty/missing/fail-closed 三拒，决策 #23）；status 缓存载荷逐文件 sha256 内容比对（路径比对对「在而旧」失明已根治，`core/status.js:89-106`）；交接快照 mtime ≤2h 强制；步级认领 48h TTL 退役（`core/loop.js:463-470,871`）。
5. **dirty worktree（脏工作区）**——未提交改动不得混入证据或被他人销毁。判决：**已有防护**。证据先提交后取证（红线 #2/决策 #14）；step done 检出脏树即告警「证据应跟随提交」（2026-09-15 本目标 N1 执行中活体目击）；交接脏树清单约束接收者、先对账后清理（zw SKILL Dirty-tree inheritance）。
6. **hung commands（命令悬挂）**——一切子进程有确定性上界。判决：**已有防护**。引擎调用 30s 超时+argv 字面量+`shell:false`（`core/engine.js:9,42,52`）；钩子 10s timeout（`plugin/hooks/hooks.json` 五处）；限流日志扫描 64MB/文件+10s 时间盒、truncation 如实标注（`core/ratelimit.js:47-48`）；循环锁 5s 等待后持锁 LoopError（`core/loop.js` withLock）。
7. **flaky tests（不稳定测试）**——绿必须是确定性的绿。判决：**已有防护**。测试发现面收窄治幻影 pass（`package.json:46` glob 形态，v005-core#N6）；时区敏感断言钉宿主 `TZ=Asia/Shanghai`（`.github/workflows/ci.yml:17`）；e2e 隔离 HOME+引擎探测抑制（`LZY_ZCODE_ENGINE`，债③根治）；滚动窗口断言强制漂移从句+时点戳（协议约定）。
8. **misleading success output（误导性成功）**——「看起来做完了」不等于做完了。判决：**当轮小修**（本计划 N3 落地中）。comparator 协议：HEAVY finish 前 qa-executor 逐对判匹配/不匹配、不匹配协议级阻断（CLI 零代码）；零推进两振 stuck 弃拉防空转 padding（`stop.js:6`）；status 遇损坏 goal.json 单项降级 warn（R6 修复）。本轮 N3 红绿两半（改前态失败+改后态通过）把「成功」的证据义务再收紧一档。
9. **repeated interruptions（反复中断）**——中断风暴不得耗尽预算或伪装进度。判决：**已有防护**。Stop 预算 ≤2+预留 1（决策 #13）；限流三族分诊（429/传输死亡/内容杀流各走各的恢复契约，doctor `transport`/`content` 行分族计数、绝不进并发带数学，ADR-0008）；同工具失败连击绊线 TTL 10min、WARN_AT=2 warn-once（`plugin/hooks/tripwire.js:23-24`）。

## 记账新债（代码级缺口，本轮不修）

- **债 A（注入残余）**：计划文件内容无来源标记/信任分级——门只扫词法（禁词、语法），不问内容从哪来。升格条件：出现「计划内容部分合成自外部不可信文本（网页/外部 issue/他人报告）」的真实工作流时，做来源标注或门级内容来源扫描。
- **债 B（跨平台钩子 spawn）**：~~`plugin/hooks/hooks.json` 五处 `/bin/sh` 硬编码 + `run-hook.sh` POSIX sh，Windows 无解释器且失败静默 fail-open；`core/paths.js:70-74` 引擎定位 darwin-only。~~ **已 discharged（2026-09-16）**：crossplatform-support 落地 run-hook/`run-hook.cmd` 对偶孪生（hooks.json 五处一行清单跨双平台）+ `core/paths.js` 三平台引擎候选表（win32/linux 实测），见 docs/design-crossplatform.md 与 0.0.6 发布记录。
- **债 C（证据附件读取面）**：`--evidence-file` 接受任意可读路径（`core/loop.js:382-392` 校验文件性/大小/数量，不约束根目录）——本地单用户 CLI 威胁模型下是操作员自供面而非漏洞。升格条件：`lzy` 面向多用户/受控环境分发时，加工作区根约束。
- **债 D（subject 集完整性边界残差，2026-09-16 随 0.0.8 增记）**：finish 闸门 git spawn 与并发提交间的 TOCTOU 窗口（锁内检查、锁外 commit——ms 级窗口，结局=对较旧树 finish 而非伪造工作）；`VERDICT:` 标记形态是 N8 机器门的载荷（parseVerdict 无标记回退串可 spoof——评审协议要求标记形态，ADR-0013 记名）。升格条件：真实多工人/多仓误用或事故时按项升格。
- **债 E（人权门批准分支 cwd 漂移静默，2026-09-20 随 sess_c50032a7 活体事故增记）**：~~UPS 批准分支（`plugin/hooks/trigger.js` approvalVerdict）按引擎投递的 `input.cwd` 就地读 `<cwd>/.lazyzcode/loop/goal.json`（ADR-0006 不 walk-up）——模型规划期 cd 漂移后用户发批准句，readGoal 为 null 即静默落回：零写入零注入，L2 人权门的失败完全无声（门安全侧失效：缺批准=门保持关闭，修 cwd 重发即恢复，正确性无损、可诊断性缺损）。~~ **已 discharged（2026-09-20）**：goal v021-engine-surface#N2——批准正则命中而 goal/pending 读不到时改注入诊断报文（三支：goal 读不到且祖先探测命中→点名宿主根／goal 读不到且祖先无目标→未找到文案／goal 在场无 pending→报 slug + 「非本意请忽略」子句），只提示不阻断、`approvals/` 恒不写。探测 `probeHostRoot` 只读、深度≤8、仅验路径存在性（ADR-0018 修正案四条边界）。事故出处：2026-09-20 zpigeon-ios-0.1.2-dev 宿主 goal batch2-pool-closeout 首次「批准 762893eb」未落盘，当时误诊「引擎 hook 调度未生效」，修 cwd 后重发 48ms 内落盘。测试：`test/human-gate.contract.test.js` 16→22（+6 例含漂移点名宿主根/日期串误命中/双跑字节一致/优先序代价钉）。

## 结论一行（供 README 对比表引用）

九类全数有对应防护面：8 类已有防护（其中 2 类带残余记账）、1 类当轮小修（N3 红绿证据收紧中）；记账新债 3 条（A/C/D 在册；B/E 已 discharged）各带升格条件。与竞品的差距不在防护存在性，而在**清单的显式化**——本文即补此账。

## 逐目标应用记录

### 2026-09-22 · goal `v022-bat2-h3r`（H3R 步级高危门 + 仪器/账本加固）

本目标新增面：一个**休眠的机器门**（`core/h3r.js` + `core/drive.js` 段循环检查块）与一个**词表子串判定面**。逐类核对：

1. **malformed input**——**已有防护（本目标新增面自带）**：`h3rMatches` 对非字符串/空文本返回空数组，`h3rStepVerdict` 对无 steps / 无 pending 的 goal 返回空判定，`h3rStopVerdict` 全程不抛——门的存在本身不得成为 drive 的新崩溃面（契约测试含「无 pending 不停」「空文本零命中」两例）。消融管线侧：`authEnvCheck` 对两枚 provider env 做「在场且指向真文件」双判，缺任一则该发**不产样本**而非产假样本。
2. **prompt injection**——**不适用（本目标不引入新的不可信输入面）**：门的判定面是**计划文本**（`goal.steps[].title`），而计划文本的来源与信任边界与 0.0.6 清单债 A 所记**完全相同**，本目标未扩大它。新增一句相关观察：词表把「计划里写没写危险字样」当作判据，故**计划作者可以靠换词绕过**——这不是注入，是判定面的已知语义边界，已写进 ADR-0022「真实边界」节与报告 §10。
3. **cancel-resume**——**已有防护 + 本目标补一缺口**：drive 收束因族新增 `h3r` 后仍走既有 `windDown` → 7 字段快照 → `handoffGoal` 登记 → 下一唤起/人工 `zw 继续` 续起（实弹：诊断发 55 ms 收束并落快照）。**同时暴露一处未修缺陷**：目标级门拒（`assertDriveEligible`）走的是 `skipHandoff: true` 的**接管语义**通道，于是打「已被接管/租约失效」（假话）且**不写交接快照**——续跑信息因此缺失。已记债（见下），本目标边界内不修（改动载荷会污染刚取的证据）。
4. **stale state**——**已有防护（并再次印证）**：本目标全程受复合指纹约束，24 发网格的 `payloadHash` 单值可答「量的是哪份载荷」；「trials 跑在发布身份树上」的**边界**（N9 文本改动发生在 trials 之后）已在报告 §9.6 如实限定，不冒充全版一致。
5. **dirty worktree**——**已有防护**：实验在隔离 scratch（`/tmp` + `artifacts/`，gitignored）内进行，宿主工作树全程清洁；24 trials 的破坏性动作（`rm -rf`、凭据搬运）全部发生在 scratch 仓内。
6. **hung commands**——**已有防护 + 本目标补上界**：消融管线此前只有 `core/headless.js` 有墙钟硬顶而**管线自身的 spawn 没有**（ADJ-38 未下沉），棒1 已对齐；本目标 24 发全部落在声明墙钟内（段级 实耗/请求 比值 max 0.777，无撞顶）。
7. **flaky tests**——**本类实测命中一次（且是自查漏网后才被抓到的）**：新增契约测试用 deps 注入假引擎、零真引擎零网络，首次跑 10/10 全绿——但收口重取证据时同一文件变成 **9 绿 1 红**，失败原文为「实得：积分预算尽（近 5h 滚动水位 421.8 ≥ 积分硬顶 400）」。root cause：该测试未注入 `deps.rollingPoints`，于是 drive 的积分联动执法读了**账号真实消费水位**；本目标 24 发网格花了约 940 turns，把水位从 273 顶到 421.8，越过了默认硬顶 400，段间收束于是先于 H3R 检查触发。**这是「测试依赖环境状态」的典型形态，不是我代码逻辑错**——但它在首次取证时伪装成全绿，正是本清单第 7/8 两类要拦的东西。处置：`passDeps` 显式注入 `rollingPoints: null`（drive 的「读数缺席→跳过积分联动执法」哨兵形态）并写明不得删除的理由；修后连跑三次 10/10。对照组：既有的 `test/drive.contract.test.js` **每一处**进段循环的 deps 都显式传了 `rollingPoints`（0 或 null），故从未受此影响——本目标漏的是这一条家法。
8. **misleading success output**——**本目标的核心命中，且是我们自己的新代码**：C 臂门**看起来**是保护，实测 24 发**一次都没开火**——不是门坏了，而是执法点（段起点判定）粗于实际工作单元（24 发里 15 发单段跑完全部步骤），门被**绕过而非击败**。若只看「门在线且契约测试全绿」就宣布防护成立，正是本类要拦的那种误导。处置：单发诊断把「机制正常」与「执法点失效」两件事分开取证（2 s 零引擎调用停摆 vs 网格 0/4 停摆），报告 §0/§5.1/§11 显式裁定预注册的「任务集无测量力」标签**不适用**，未据此升格或降档。**另一处同族命中**：收束因分类首版把「目标级门拒」（防护生效）与「段 infra 失败」（噪声）混进同一个 `driveVoid`，会把本批最有价值的读数归成基础设施噪声——收口比对时抓获并拆成 `gateReject`/`segmentFailed`。
9. **repeated interruptions**——**不适用（本目标不触碰中断预算面）**：Stop 预算、拉回资格、standdown 均未改动；`h3r` 收束走的是 `ok:true` 干净通道，不消耗拉回预算。

**本目标新记账债**：

- **债 G（前一条 green 的时效性由环境决定，2026-09-22 随本目标自查增记）**：任何**会读账号状态**的断言面（积分水位、限流读数、缓存载荷版本……）都必须由测试注入固定值，否则同一份代码在不同时间跑出不同结论。本目标踩了一次（上条第 7 类），升格条件=再出现一次同类「取证时全绿、复跑变红」；根治面=给 `runDrive` 一类接受 `deps` 的原语加「未注入环境读数」的自检（目前只靠家法与评审）。


- **债 F（风险门拒的交接面缺失，2026-09-22 随本目标实测增记）**：drive 段界的三门拒绝（`core/drive.js` 段首 try/catch）统一走 `windDown(..., { skipHandoff: true })`——那是为「租约已被接管」写的通道，于是**风险门拒也复用同一路径**：stdout 打「已被接管/租约失效」（假话），且不写 7 字段交接快照，无人值守链上没有任何可操作信息留下。实测触发 3/24 发（段内模型自行 `lzy loop risk high` → 段界硬拒）。**升格条件**：H3R 机器形态拍板若决定保留目标级门作为承重防护，则本债立即升为必修（门拒必须有「为什么拒/人该做什么/从哪续」的交接面）；根治=门拒与接管分走两个收束形态。
