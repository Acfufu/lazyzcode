# ADR-0028: 交付授权模型——B/C 独立契约经 contractPending 复用 UPS 通道

日期：2026-09-25（goal v030-m4-delivery 实施期）。状态：已接受。

主方案 §6 要求 B（合并主干）与 C（上线验证）外部动作各获明确授权、分别记录，且只有 B 授权时
拒绝合并（本仓 main 为 Pages 发布源，合并即触发部署）。M1 授权账本（ADR-0024）的记录形状
`{version, kind, slug, contractHash, at, sessionId}` 两侧同钉（钩子 inline 写者 +
test/contract-gate.contract.test.js），扩 schema 须同时改动可信事件面。

本决策：**不扩记录形状**。B 与 C 各立独立 delivery 契约（宿主树内 markdown，endpoint 键
=B/C，endpoint 入哈希）；`lzy delivery request <ep>` 校验 endpoint 匹配后把
goal.delivery[ep]={path,hash} 落 goal.json 并置 contractPending（三字段 {contractHash,
contractPath, requestedAt} 逐字镜像契约门家法 core/loop.js:873-877）——UPS 钩子批准分支只读
contractPending（无 status 闸，trigger.js:74-88），批准即对 delivery 契约哈希生效，钩子批准
分支零改动。撤回分支最小扩展：短码匹配集合=[goal.contract, …goal.delivery 各哈希]，零命中
列全部合法短码，双命中（8hex 前缀碰撞）拒猜；记录仍同形状（目标身份由契约本体承载，无
scope 字段）。生效判定照走 effectiveAuthorization 后到者赢；act 门序每次现读账本
（fail-closed），B 面须 B∧C 双授权。批准后 pending 清除归 CLI（beginAct 门过即清，锁内）。

替代案否决记录：授权记录加 scope 字段=触碰 UPS inline 写者+两侧形状测试，可信面改动大；
同哈希计数多批准区分 B/C=记录不可区分且可伪仿；B/C 交付入队列项=M3 队列已明拒 B/C
（core/queue.js:351-353 指路 M4），首版交付链单条不排队。代价：一个交付两份契约文件+两次
批准短语（用户侧成本换授权粒度）；8hex 前缀碰撞概率 ~2^-32 每对，拒猜兜底。

## 修正节（2026-09-26，0.3.1 棒1 实施期）：状态判据放宽一档 executing ∨ (done ∧ bound)

本文原判「delivery 面在执行期运作」（requireDeliveryContext 只认 goal `executing`）。队列桥
（ADR-0030）的编排顺位=drive → finish → **交付 act/readback → completed**：交付链只在 goal
已 `done` 时开跑（读回 done 才记队列项 completed），故状态判据放宽一档：

1. **可 act 两态**：`executing`，或 `done` 且本面（ep）delivery 契约**已绑**。「done∧bound」
   只在同一次尝试内可达——reset 清 goal.json 整件 ⇒ 绑定必属本尝试，不放宽 abandoned /
   planning / 未绑定三态（各自照拒，错误文案列明当前态与绑定态）。
2. **不变面**：授权门（B∧C 双授权）、PR head/base 漂移复核、CI 全绿门、意图账本 done 恒终、
   读回恒拒再执行——状态放宽不触及任何授权或身份判据。
3. **记账口径**：交付链耗时以 wall 条目入队列 ledger（ADR-0030 §4「不计积分、计入墙钟」）；
   `DELIVERY_CHAIN_MAX_MS` 常量导出供队列 reconcile 的「在途是否已死」活性兜底。

实施与测试：core/delivery.js requireDeliveryContext（done∧bound 一档）+ test/delivery-gate
⑧⑨⑩（状态矩阵/done 未绑拒/planning 拒）；人驱 CLI 路径（M4 契约流程）行为不变。
