# v050 M1 报告——无人值守可完成、用量可追

goal `v050-m1-completion`（HEAVY · risk med）· 2026-10-07 · 计划快照 sha256 `7edf80092c4eea38…`（artifacts/v050/m1-plan.md；评审 plan-reviewer 四轮：前三轮 REVISE 修 deps 成环/N5/F 裸奔/TITLE_MAX/deps 错位，终版 PASS；人权门短码 7edf8009 批准）。弧定位：0.5.0＝#42 重评兑现版（ADR-0034）第二棒，范围=docs/plan-v050-closure-and-evaluation.md §6 M1 行；A3/A4 与评估集重锚归 M2 未入本棒。

## 1 · 19 次 gate 拒绝逐次归因（N1，A2 前置）

数据=artifacts/v040/M5/eval/frozen/（36 run 的 metrics.json 机器计数＋15 条带拒轨迹），解析器与产物：`artifacts/v050/m1/parse-attribution.mjs` → `attribution.json`/`attribution.md`。计数权威=metrics.json `finish_reject_gate`（轨迹有回声放大，实证一例 4 次出现对计数 3，只分类不计数）。

**硬对表全过**：new 臂 19／old 臂 0／分布（一 run 3 次、两 run 各 2 次、12 run 各 1 次）与 v040 报告 §2 判据 7 及 M0 报告逐项吻合。

**义务面归因**：
- **15/15 带拒 run 全部拦在 `review.general-correctness`**——评审义务是唯一普遍阻塞面；
- **13 次保守拦**（oracle 已确认交付正确的 9 run）：拒因全为「评审无在案运行」或「评审运行无效（墙钟 120–200s SIGKILL）」——交付已完成、满足路径存在但无人指引且评审墙钟预算过紧；末次门阻块均在会话 93–98% 处；
- **6 次四义务合取拦**（oracle 失败的 6 run）：review×2＋check.help-smoke＋check.test-suite 同 block，属门正确拒绝（交付本身不完整）。
- **差异注记**：v040 报告与 debts A2 记保守拦 **12**；本次按「oraclePassed run 内拒绝」口径实测 **13**，时点定义（末次门阻位置）同样得 13，seq30 为唯一单尝试边界案，差 1 无法从冻结工件重建任何可复现口径。处置：不改旧密封记录，两数并存（debts A2 行已注记），拍板时以归因表为准。

## 2 · 计量/provider 候选收口（N2–N5，plan-v050 §4 五条件台账）

候选件 `wip-v050-metering-provider`（单提交 56bd802，+700/−16）零冲突并入（merge-tree 预演兑现；core/review.js 自动合流语义两保，全量绿背书）。并入后基线 **791/779＋12 逐项吻合**。

| # | 条件 | 处置 | 证据 |
|---|---|---|---|
| ① | fail-closed 兼容与恢复 | **N3**（78a9817）：不可读/非 JSON/结构不可识别三点同判据前置拒，报文带恢复指路（修配置或移除 env）；env 缺席（BUILTIN-only）保持 null 合法面 | F2-P2＋契约测试 7 用例（preflight 双拒因） |
| ② | 未计价不渲染零成本 | wip 已立（aggregateUsageRows 未计价组保留 tokens 计 0、无 usage 不入账），本棒回归保持不弱化 | wip 测试＋F5 全量绿 |
| ③ | 去重与恢复/运行档事实源 | **N4**（2096812）：appendSandboxUsage 增 runId 幂等去重（跨月全账查重，语义对齐 queue.js dedupKey 族）；project 由 basename 升仓库根全路径（同名项目不混账）；无 runId 不去重如实保留 | F2-P3＋契约测试三态 |
| ④ | 宿主库缺席沙盒账可达 | **N5**（9eb2691）：formatCost 两处早返回与 doctor checkWaterline 两降级分支不再短路沙盒段；宿主账在场时输出逐字节不变 | F2-P1＋活体（隔离 HOME 无账本 doctor 双行齐出） |
| ⑤ | 预算跨轮累计 | 既有 (slug, contractHash) 预算面与 #32 近似限制语义**不动**（沙盒侧跨运行累计由 wip 全局账本承载）；以回归全绿＋queue-metering 契约为证，不新建计费面 | F5＋既有契约测试 |

## 3 · 完成路径补齐与诚实停止（N6–N7，commit 01b99ee）

缺口（侦察实证）：`lzy review run` 全链在 main 已可用，但 drive 段提示词从不提评审义务、zw 全部载荷 grep 零命中评审序列——无人值守会话只能靠 finish 拒绝报文发现义务，19 次拒绝的循环机制面即此。

修法：①`composeSegmentPrompt` 第 3 步补义务路径（先 `gate explain` 读数→评审义务 `lzy review run`、候选漂移走 `qualify/reuse` 复用腿、消失义务 `policy reassess` 复判、核查义务按指路补回执→对照门→finish）；②zw recipes 三件（finish/execute/unattended）补满足序列文本；③**诚实停止语义落地**（ADR-0037 草案的代码面）：`classifyCause` 收束因具名十一类＋段自报 `[drive] 义务阻塞：<义务 id>` 标记→立即干净收束（exit 0＋快照，绝不写 done，预算耗尽诚实停止同族；记账不裁决边界与 ADR-0022 同型）；快照携带具名收束类。契约测试钉 prompt 内容、分类映射与端到端收束（test/drive-prompt.contract.test.js）；drive 既有套件 19/19 无回归。

## 4 · A2 语义 ADR 草案（N8，commit c65e6bc）

`docs/adr/0037-headless-partial-satisfaction.md`（**草案·待拍板**）：降阶停止与 LOOP_COMPLETE 边界=三禁（不写 done／不授权合并部署／不绕 B,C 与发现门）；停止原因用现有文本表达（具名收束类＋7 字段快照，零新状态枚举）；被否替代=新增状态机／headless 豁免评审／底线义务降档；对 M2 的影响=评审预算须单列（A3 输入）。debts A2 行已补草案指针。

## 5 · 锚点订正（N9，commit 7bb3388）

M0 报告「对 M1 输入」引 v040 报告「§9」系悬空锚（该文仅 §1–§5＋勘误节）；两候选锚（v040-m5 §9／plan-v040 §9.2）存在但不承载 19 拒材料，真锚=**§5「保守不宣称」段**。订正一行＋订正注记，check-docs-links 114 文件通过。

## 6 · 证据索引（工件持久家法，M0 口径）

计划快照 `7edf80092c4eea38…`；`.lazyzcode/loop/snapshots/v050-m1-completion.md` 同内容。工件 sha256（前 16 位）：
`535576eceedcc336` parse-attribution.mjs · `e86a61e140df4231` attribution.json · `3e5bea62cfac6841` attribution.md · `492af5f3b1470f4b` probe-f2.mjs · `159cc851ccc8e9d4` f1-red.log · `05fa183141c666f2` f2-red.log（正本在 artifacts/v050/m1/，证据副本随 F 项入 .lazyzcode/evidence/）。

M1 提交链（f8e494f 基线后）：`f09cb59` merge 计量候选 → `78a9817` N3 fail-closed → `2096812` N4 去重 → `9eb2691` N5 宿主账可达 → `01b99ee` N6+N7 完成路径＋cause 具名 → `c65e6bc` N8 ADR 草案 → `7bb3388` N9 锚点订正 → 本报告（N10）。

## 7 · 验证限制（如实）

- 未跑真付费评审会话与真实 drive 无人值守实弹——义务满足路径的活体验证以契约测试＋提示词/recipes 钉面为准（真会话烧分，属 M2 受控评审设计输入）；
- npm test 读数以各步记录为准，终验（F5）以终树全量活体 stdout 为权威；
- Windows/发布面未测（M4 范围）。
