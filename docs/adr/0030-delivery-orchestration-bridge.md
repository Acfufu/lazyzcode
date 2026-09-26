# ADR-0030：交付编排桥（队列项挂 delivery 契约，0.3.1 棒1）

日期：2026-09-26。状态：已拍板待实施（goal v031-roadmap-grill 记账；落地归 0.3.1 棒1，落地后翻「已接受」）。

0.3.0 把 delivery B/C（ADR-0028）与有界队列（ADR-0027）分别落地，两能力彼此隔离：queue 在
add 时硬拒 endpoint≠A（core/queue.js:108 拒语「B/C 外部交付归 M4」），M4 实施期保持隔离并记
债 M4-3「queue×B/C 编排后续版本归并」。0.3.1 棒1 落地桥接，形态拍板如下：

1. **桥接形态=队列项挂 delivery 契约**（否决「B/C 独立队列项类型」）：`queue add` 增可选
   delivery 契约短码；dispatch 在 goal 达可合并候选后自动走 delivery request→act→readback，
   读回=done 才记队列项 completed；批准面复用 M4 UPS contractPending 通道（钩子批准分支零改动
   先例）。理由：交付链与候选生产是同一目标身份的延续（B=把该候选合并主干、C=发布并验证该
   发布）；拆独立队列项会断裂 goal 身份、预算绑定 (slug, contractHash) 口径重定义、批准面翻倍。
2. **债 I 解封=HEAVY 入队**：队列项 tier 由契约/入队参数定（core/queue.js:766 恒 LIGHT 硬编码
   退役）；ADR-0027 预留「未来启用时硬约束」（重试不变量=仅暂时性错误 ≤2 次计入原预算、
   unknown 外部结果单独核对收窄为 failed+人工）随解封兑现。理由：B/C 外发动作（合并主干/发布
   上线）前置质量门槛应是 HEAVY 全套（独立评审+对照+attestation）；LIGHT-only×自动外发=风险错配。
3. **债 M4-4 多页爬核**：pages-verify 契约加可选 pages 数组（页路径→期望标记），readback 逐页
   核对；缺省=单页现状逐字段不变。理由：编排后 C 链变无人值守自动动作，单页标记验证面太薄
   （发布成功但内页坏而未察）。
4. **记账口径**：交付链轮询（gh/Pages）不计积分、计入墙钟；编排失败记账沿意图账本五态
   （intended/acting/done/failed/refused/unknown）与 #32 近似限制语义，零重复计费；队列项
   completed 的判据=读回 done（unknown/open re-arm 不入 completed）。

与 ADR-0027/0028 的关系：本件是两件的接续而非重定义——0027 的「endpoint 仅 A」「队列项恒
LIGHT」与 0028 的 delivery 动作面各自保鲜，桥只加编排；本件落地时两件的相应行加修正引用注记。

## 修正节（2026-09-26，0.3.1 棒1 实施期）：两处显式偏离申报

本文 §2 的两句在实施期复核后须修订，如实申报（不静默改）：

1. **钩子批准分支由「零改动」修订为「增 queue-pending 解析支」**。UPS 钩子的批准解析只认
   活体 goal 的 contractPending（plugin/hooks/trigger.js:74-121），而入队时 goal 尚不存在
   （queue add 不注册 goal）——「入队前预批准」在零钩子改动下不可达，替代路径是
   register→start→request→批准×2→reset 八命令舞。故 trigger.js 增一个**附加解析来源**：
   goal 侧 contractPending 与 approvalPending **皆缺席**（或 goal 缺席）时，扫
   `.lazyzcode/queue/queue.json` 非终态条目的 `delivery[ep].hash` 前 8 位；命中经 exact-hash
   复核后写**同族记录**（`{version,kind:"approval",slug,contractHash,at,sessionId}`、
   同 `.lazyzcode/authorizations/` 目录、同命名族）。**零新门**：同短语、同记录形状、同
   目录、同消融轴（LZY_ABLATE_HOOK_HUMAN_GATE）。边界：多命中=拒猜列候选零写入（同
   ADR-0028 8hex 碰撞家法）；读面异常（queue.json 缺席/损坏/校验和不符）=fail-open 落回
   既有诊断支；有候选而不匹配=列待批准短码的可诊断文案。实施与测试见
   plugin/hooks/trigger.js + test/delivery-hook.contract.test.js ⑥–⑪。
2. **本文 §2 的「ADR-0027 预留硬约束随解封兑现」只兑现后半**：`unknown 外部结果单独核对
   收窄为 failed+人工` 已兑现（交付未竟=failed+指路+reconcile 追认）；**前半（重试不变量：
   仅暂时性错误、≤2 次、计入原预算）不兑现**——队列仍无自动重试，自动重试面属 drive/后续
   版本，ADR-0027 的该条保持「未来启用时硬约束」原状。

相关件修正引用：ADR-0027 的「endpoint 仅 A」「队列项 goal 恒 LIGHT」两行已随之修订
（见其修正节）；ADR-0028 增「状态判据放宽一档 executing ∨ (done ∧ bound)」修正节。
