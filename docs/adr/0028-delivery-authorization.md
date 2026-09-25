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
