# ADR-0027: 有界队列家族位阶、预算绑定键与积分近似限制记账形态

日期：2026-09-25（goal v030-m3 实施期拍板）。状态：已接受并落地（core/queue.js）。

主方案（docs/plan-v030-agent-first.md §5）要求队列状态与累计预算「独立于可 reset 的当前
goal……reset 当前目标不能删除它们」，但未钉死存储位阶、绑定键与计量记账三件事。M3 实施
拍板如下，全部为已在代码中生效的形态：

1. **家族位阶：loop/ 外。** `.lazyzcode/queue/`（queue.json 状态+dispatch.json 派发事件账）
   与 `.lazyzcode/budget/`（ledger.json 消耗事实账）置于 loop/ 外，位阶同 authorizations/、
   verify/。理由：主方案 §5.2「独立于可 reset 的当前 goal」的直读 + `doResetLoop` 现状
   （loop.js:2387-2407）只清 loop/ 内家族——放 loop/ 外则 reset 语义天然成立、无需改 reset；
   登记义务仅 ANY_TMP_SCAN_DIRS 增补（观测面与清扫面同一判据，M2 verify/ 先例）。备选
   （放 loop/ 内+EXEMPT 双清单）被否：多两份手工清单、且与「reset 不能删除」的意图相悖。

2. **预算绑定键：(slug, contractHash)，不另铸授权 id。** 授权账本（M1）无独立 id 字段，
   批准对象本体即 contractHash（ADR-0024/#33）。铸造第二身份体系（authId）会引入两套
   可独立漂移的引用；预算条目以 authorization:{slug, contractHash} 绑定、以批准记录文件名
   作 provenance，「授权批次」=同 contractHash 条目集合，撤回该哈希即停批次派发。
   「追加额度」=queue budget 新值+新注记行，历史不覆写。

3. **积分近似限制的记账形态（#32 落地）：** 结算粒度=受控段（sessionId），每段结算查宿主
   model_usage 完成行折积分（ADR-0023 计价表）；dedupKey（kind:txId:sessionId）保证重复
   结算不重复扣账。三类「不算零」显式记录：metering-absent（零完成行/宿主 db 不可读）、
   未计价模型（同停类）、killed-inflight（SIGKILL 在途消耗不可知——假零申报）。三者触发
   「受积分限额约束的派发停止」；纯墙钟批次如实记录后可继续（#32 语义限定「受积分限额
   约束」）。人工恢复（--resume-points）以账本 seq 为单调基：只豁免确认时点前的在案记录，
   其后新增重新停止。达限即停止下一次派发（绝不杀在途），在途超额以 overrun 条目如实入账。

4. **派发事务=占用登记（dispatch.json 事件账，锁内 pre-spawn 写）。** 预算门联合判定：
   已耗实值（ledger）∪ 未决占用（open tx 登记上限保守计入）——崩溃时未决占用不当零消耗。
   恢复判定表（先核对后动作）含活性半：未决 tx×goal executing 且租约在握且持租进程存活
   （holderPidAlive）=busy-live 不核销；持租进程已死（ESRCH）=killed+killed-inflight 申报+
   僵尸租约回收。队列绝不 reset 它不拥有的 goal。

已知边界（诚实声明）：首版单工串行（workers 不入队列）、无自动重试（重试不变量〔仅暂时性
错误、≤2 次、计入原预算〕为未来启用时硬约束）、endpoint 仅 A、队列项 goal 恒 LIGHT
（HEAVY 终验 comparator 面不入首版队列）、「未知外部结果单独核对状态」收窄为 failed+人工
指路（M4 交付面重评）。

## 修正节（2026-09-26，0.3.1 棒2 待实施）：积分执法 gauge 归因口径

本文第 3 条的积分计量（受控段 sessionId 计量）为队列预算执法面；drive 侧积分硬顶的执法
gauge 当时沿用**账号级 5h 滚动水位**（core/drive.js 头注自认「不是本 run 的消费累计」）。
zpigeon 试点实伤（债 O）：宿主交互会话自身消耗即把账号级水位顶过硬顶（默认 400），夹具/
兄弟 goal 被误伤收束（如实记账见 docs/spikes/v030-zpigeon-ios-pilot-report.md 债 O；
处置当时靠 env `LZY_DRIVE_POINTS_BUDGET` 放宽缓解）。修正三条（0.3.1 棒2 落地）：

1. **执法面=逐段 sessionId usage 查询**（与本文第 3 条队列积分执法同一查询面，M0 §5.3
   并发可分性已证）；账号级水位退役为 doctor 建议行——读数照显、不再执法。
2. **budget-ref=none 契约语义收口=跳积分执法只留墙钟**（显式语义，不再靠 env 放宽缓解）。
3. **#32 近似限制语义不变**（逐请求完成检测+停止下一次派发+在途超额如实记账），本次仅变更
   归因口径（谁的水位），不改执法语义。

## 修正节（2026-09-26，0.3.1 棒1）：两行边界随之修订

本文「已知边界」段的两条已被 0.3.1 棒1（ADR-0030）修订，原文保留作历史：

1. **「endpoint 仅 A」→ endpoint 支持 A|B|C**（item.endpoint=目标终点；矩阵：A 禁交付契约 /
   B 须 B 契约 / C 须 B∧C 两契约；add 门 + assertItem 读侧同判）。ADR-0030 §〇.4。
2. **「队列项 goal 恒 LIGHT」→ tier 由契约/入队参数定**（HEAVY 入队凭入队前评审 PASS +
   计划哈希双件，派发时透传 adoptPlan 的 review 字符串；worker 侧限制不变）。ADR-0030 §一.G。
3. 其余边界**原样有效**：单工串行（workers 不入队列）、无自动重试（重试不变量保持「未来
   启用时硬约束」——ADR-0030 修正节第 2 条如实申报前半不兑现）、「未知外部结果」按
   failed+人工指路（与交付链的 unknown 读回收束并存）。
