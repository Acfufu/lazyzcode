# 0.5.0 M3 正式重评报告（v050-m3-reval，2026-10-10）

goal `v050-m3-reval`（HEAVY · risk med）· 计划快照 sha256 `6cb15e7846e0f4bb…`（人权门短码 6cb15e78，用户批准 2026-10-08；plan-reviewer 两轮收敛 PASS——5 条必修全消后过）。判读依据＝`scripts/evaluation/PREREGISTRATION-v050.md`（含 §5 增补记 1 重冻结记录）。开工基线：npm test 819/819 绿（2026-10-08 实跑 249s，HEAD 5ce2778）。

## 1 · 批参数与身份绑定

- **批**：`m5eval-20261008160054`（2026-10-08 冻结）· 36 腿（三仓×2 任务×3 trial×2 臂）· seed 20261008 · manifest sha `4a08f0c4637244db…` · baseline `ed0c5285…`（v0.4.1 registry 包）· candidate **`4db51559…`**（M3 批前重冻结，取代 9901ddd9——事故修复 5da050a 动 pack 白名单内文件，PREREG §5 增补记 1）。
- **环境轴实读与封存标签对账**：node v24.19.0／bun 1.3.14／Xcode 27.0 (27A266a)／iPhone 17 Pro 模拟器在场；壳 Info.plist **3.14.5**（2026-10-08 13:58 自动更新，计划写预期 3.14.4——漂移注记）；引擎权威 `zcode.cjs --version` **0.16.9 未变** ⇒ 无引擎代际漂移（AGENTS §3 分线）。封存清单标签「ZCode 3.14.0 代」按注记对账，非暂停条件。
- **腿钉定**：批 1 因执行侧事故未带允许表 env（见 §7）；批 2 起 `LZY_SANDBOX_PROVIDERS=bigmodel-api`。全 36 腿隔离计量行 provider 唯一＝**bigmodel-api**（模型 GLM-5.3-Flash），两臂同腿成立。**计费口径（2026-10-10 用户更正）**：本机 bigmodel-api 腿走 GLM 套餐 API 通道，批消耗实际扣减套餐额度；harness points 为本仓计价表估算面。
- **canary 独立复跑**（N1，独立子代理通道，宿主零阅读）：**正 6/6 pass · 负 6/6 fail**，与封存判定表逐任务一致；回执＋12 存证在 `artifacts/v050/m3/canary/`。一次性偏差＝zpigeon-ios/task-2 首负跑撞 120s 单检测超时（冷构建方差，预热后 59s 干净通过）——环境抖动，非仪面/密封集缺陷。
- **修复 delta 聚焦评审**（N3）：`v050-m3-reval.a1.r2` **valid pass**（metered 4.0 分）——非阻塞 P2×1（`--rejudge-oracle` 对已盖本代次戳但判读缺席的行永久跳过，remedy 指路死路；实操绕行＝`--force-seq`）＋P3×1（run-pairs 计量回退 SQL 内插 sessionId 未净化）；记档不阻进批，处置见 §8。首跑 a1.r1 invalid（opencode-go-chat 腿上游 deepseek-v4.1-flash 对 thinking 长会话确定性 400，`x-zen-model` 头实证）→ 换腿后复跑即过。

## 2 · 执行账面

journal **39 行**（append-only 尝试账；现行 36 seq）· 分三批＋1 次中断续跑（批 3 执行体会话被杀后断点续跑，跨会话 resume 安全）· **3 个重跑对**（seq3/10/12，单列失效额度各 1 次；原因与全部成本见 §7）。腿状态：33 ok＋3 timeout（seq2/30/33，均墙钟 2700s 耗尽 SIGKILL，oracle 均 true）。缺计量 3 腿（即 3 条超时腿，metering absent）——**缺失不记零**。

## 3 · 主门判读（PREREG §1 五条，逐字）

| # | 条目 | 判定 | 依据 |
|---|---|---|---|
| 1 | 关键反例全过 | **✓** | 三 id（lazyzcode/task-2、openchamber/task-1、zpigeon-ios/task-1）新臂错误完成均 0（report counterexamples「守住」×3） |
| 2 | 新臂关键错误完成=0 | **✓** | 新臂 wrong-done = 0 |
| 3 | 每任务 ≥2/3 | **✓** | 六任务新臂均 **3/3** oracle 正确交付 |
| 4 | 正确交付不低于基线 | **✓** | 18/18 vs 18/18（打平，不低于成立） |
| 5 | 至少一项严格改善 | **✗** | newOk(18)>oldOk(18) 假 ∧ 新臂错误完成(0)<基线(0) 假 ⇒ **完全打平，无严格改善** |

**主门结论：不满足**——report 原文「尚无质量收益证据（§9.2 不满足——不宣称通过，不产晋级材料）」。沿 ADR-0034/#42：本结果**不构成采纳证据，维持 0.4.1 旧默认，不宣称质量提升**。

## 4 · 产品标准判读（PREREG §2 四件，供默认切换决策参考；不得据此宣称质量提升）

| # | 条目 | 判定 | 依据 |
|---|---|---|---|
| 1 | 质量不劣 | **✓** | 正确交付 18≥18 ∧ 关键错误完成 0→0 不增 |
| 2 | 预算内合法收束率 100% | **✓** | 预算内腿 33/33 全部 done（goalDone）；3 条超时腿越墙钟被 harness SIGKILL，不在「预算内」分母（同中断腿击杀不计口径），逐腿 failNote 如实在账 |
| 3 | 新臂完成率 ≥1/2（9/18） | **✓** | 新臂 goalDone **17/18**（旧批新臂 0/18） |
| 4 | 积分成本不升 | **✗** | old 89.13 vs new **121.31**（+32.18，+36%；缺计量 3 腿不计零、即使按 0 计结论不变） |

产品标准 **2/4**：收束顺畅两硬指标全过＋质量不劣，但积分成本显著上升。按 #49 措辞禁令：即使产品标准全过也不得称质量提升；本批主门未过，**两口径都不支持采纳**。

## 5 · 四格与逐对差值

具名工件 `artifacts/v050/m3/quadrants.json`（`scripts/v050/quadrants.mjs` 生成，源=report.json＋journal，sha 绑定）：

- 四格（按臂）：old＝正确完成 16／正确未完成 2／错误完成 0／错误未完成 0；new＝**17／1／0／0**。
- 逐对 18 对：oracle 判定 **18/18 一致**（两臂全对——本评估集对两臂都偏易，区分度集中于收束与成本面）；goalDone 分歧 3 对（new 更优 2：lazyzcode t1t1、t2t1；old 更优 1：lazyzcode t2t2——该对 old done 而 new 超时）；积分：可比 15 对中 new 更贵 11 对／更省 4 对。

## 6 · 关键负例逐项

三 id 全部「守住（0 次新臂错误完成）」：lazyzcode/task-2（状态恢复弱判读位）、openchamber/task-1（边界族反过度修正位）、zpigeon-ios/task-1（构建链判据位）——新臂在三核心判读位零错误完成，未入选三任务照常逐项入 report.counterexamples。

## 7 · 特殊腿归因与 harnessChanges／事故节（全如实）

1. **执行侧 env 事故（批 1）**：N5 启动 shell 漏导出 `LZY_SANDBOX_PROVIDERS` → 新臂腿内评审义务不可满足（空允许表前置拒族；旧臂 0.4.1 无此机制不受影响）。实锤 seq12 首跑：agent HEAVY 全链走完（6/6 步、oracle=true）后 finish 被义务评审拦，**按 ADR-0037 具名收束**（handoff、如实报告、目标保持 executing）——义务阻塞收束的真会话样本。处置：批 2 起带 env；seq3/10/12 按单列额度 `--force-seq` 重跑（各 1 次），原行保留＝尝试账；三条重跑后全部 ok/goalDone=true/oracle=true（9.39/8.32/2.90 分）。档案 `artifacts/v050/m3/preflight/leg-incident.md`。
2. **超时腿×3**（seq2 old、seq30 new、seq33 old）：墙钟 2700s 耗尽 harness SIGKILL；oracle 均 true（交付物已在夹具）但 goal 循环未及 finish；计量 absent（WAL 脏＋immutable 直读无行）——缺失不记零。其中 lazyzcode/task-2::t2 对（seq33 old done vs seq30 new timeout）是唯一 old 臂 goalDone 占优对。
3. **评审 a1.r1 invalid**：opencode-go-chat 腿上游 deepseek-v4.1-flash 对 thinking 长会话确定性 400（`reasoning_content must be passed back`；单/双轮探针过、评审级长会话必死）——换 bigmodel-api 腿后复跑过。该腿随后周额度耗尽（用户报），对批无影响（批已钉 bigmodel-api）。
4. **壳版本漂移注记**：3.14.4→3.14.5（2026-10-08 13:58 自动更新，N1②③ 之间）；引擎权威 0.16.9 未变，非代际漂移；批内两臂同引擎。
5. **harness 修复两件（批前，M2 收口后）**：兄弟仓 pin 方言回退＋物化 fail-closed＋预飞前置拒（P0，防 zpigeon 12 腿静默打废——批内 zpigeon 12 腿全过即其量产验证）；`ORACLE_JUDGE=3` 代次常量（P1）。均 commit 3d38113，819/819 绿。
6. **非阻塞发现处置**：a1.r2 P2（rejudge remedy 死路指路）——登记为 M4 前小修候选（修法：跳过条件加「oraclePassed 为 null 不跳」或 remedy 文案分叉）；P3（SQL 净化）——同列。均不涉本批数据有效性。

## 8 · 结论

0.5.0 候选相对 v0.4.1 基线：**质量完全打平（18/18 vs 18/18、零错误完成）、收束面大幅改善（预算内 33/33 全 done、新臂完成率 17/18）、积分成本上升 36%、无一项严格改善**。按预注册主门：**尚无质量收益证据——不采纳、不宣称、不产晋级材料**（ADR-0034 维持，0.4.1 保持旧默认）。产品标准 2/4 不构成采纳依据（#49 措辞禁令）。0.5.0 的纪律层价值在本批显示为「同质量下的收束诚实化与可观测化」（具名收束、义务门、逐腿计量），其采纳与否留待用户以产品标准面另行决断；#42 既有默认策略比较仍按 PREREG §4 另列段处理（本次未启动）。

## 9 · 验证限制（如实）

- 评估集对两臂区分度不足：18/18 对全一致，质量面天花板效应——「严格改善」判据在此集上不可分，后续版本评估若复用本集需换集或提高任务难度（换集＝重新封存，独立性纪律照走）。
- 单机单代环境（macOS/arm64、引擎 0.16.9）；win32 未测；zpigeon 依赖 xcodebuild 真模拟器（已跑通）。
- 3 腿缺计量（超时击杀形态）；重跑腿 3 条的首次尝试行与现行行并存于尝试账。
- 批 1 的 env 事故使新臂 3 腿首跑在不对称条件下执行（已按额度重跑对冲；首跑行保留在账，两行并读）。
- 两轮收尾职责评审（verification-deps/external-side-effects）与对照 attestation 属 goal 收口义务，随本 goal finish 相执行（见 `.lazyzcode/review/` 与 attestation）。
