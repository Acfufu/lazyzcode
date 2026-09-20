# ADR-0016: forward-only attempt 世系与失效传播 query-time 收口

日期：2026-09-18（goal v010-batb-protocol-headless，承 roadmap §⑪ Q6 拍板与 GPT 蓝图
0.1.0 原案、V3 处置节 PLAN_DIRTY 改判）

**世系（supersede attempt）**：执行中改计划不回卷当前 attempt——旧代次置 superseded、
开 attempt+1 新代次，完整采纳门（HEAVY PASS 评审/快照+planHash 绑定/计划节点）重走，
INV-06（material 变更使 H1 失效）在 supersede 模型下自然成立：新代次必须重新被批准。
`attempt.json` 世系账本走 dag.json 全套纪律（校验和/原子写/errno fail-closed）；缺席时
从中央账本 plan 节点 attempt 戳派生只读视图（不回填），首次写才落盘。material 边界拍板：
**触发=executing 期 planHash 变更**；subject 增删维持 ADR-0013 语义（证据全体过期+重取）
不作 supersede 触发——subject 集是证据视野不是工作契约，若实测出现滥用再收窄。跨 reset
同 slug 重注册=追加并保 supersede 链（旧 active 降级 superseded→新 n）。

**传播=query-time**：拍板 Q6 预授权「计划期证实被动指纹比对已覆盖语义则降档为查询面收
尾」。计划期证实成立：(1) verify 入口与 finish 原子窗的指纹直比覆盖全部失效判定（且比
任何写时标记更强——不可漂移）；(2) stalePreview+dependents 已应答「什么失效了/什么依赖
X」；(3) lzy 不观察 commit（提交发生在 CLI 之外），无写时挂点。故 `lzy dag stale` 作为
只读预览命令收口，写时失效（invalidate_after_mutation）不建；预览永不进门。

**INV-08/09 执法点=HEAVY finish**：豁免收紧（缺红不得以补绿收口）与 harness 冻结（红绿
取证程序同源核对）都落在对照绑定检查之后、同一 `LZY_ABLATE_ATTEST` 守卫内——消融变体 D
的「五闸门全灭」组成随之变化（机器门族一体的诚实记账）；LIGHT 不设机器门（协议文本承
载）。恢复机制=recordEvidenceHalf 反向配对：绿落地后补录红/waive 当场加 red_of 指向锚定
绿，查找原语（findGreenByGeneration 代次语义）与 finish 检查同源——孤儿 ghost 角两处自然
收敛。红后录绿的 rebind（已发布版当红面等既有实践）保持合法：执法点=finish 时点两半或豁
免在场，非禁止后补红。

**INV-09 口径收窄（ADJ-47，2026-09-21 0.2.1 五轮双审核）**：上文「成对取证」是**协议**
陈述；机器门的判据只有**在场**。补记两处边界，防文本与机器门各说一半：

1. **在场即过**：锚定绿有 red_of 指向的 red/waived 节点即过门，`seq`/代次不参与判定
   （`core/loop.js` 的 halves 检查只查边）。故**上一代红半可点亮后代锚定绿**——rebind 时
   `pairReds` 对同 slug+step+attempt 的全部 red/waive 无条件再配新绿（ADR-0014「多条
   red_of 合法、最新为现行」）是**有意语义**而非漏洞；「这条红半瞄准的是哪一代」属审计
   读面（`lzy evidence list` 的 gen 标签），不是门。
2. **同源靠 `--harness` 申报与协议，非机器强制**：INV-08 只在**两半俱有** `harnessHash`
   且不等时拦；`--harness` 是可选申报，缺省不写字段 ⇒ 默认形态下两半没有任何机器可验的
   同源证明。凡「同一断言在改前/改后」这一主张承重之处，**两半都必须显式 `--harness`**
   ——申报即把协议承诺升级为机器可查。

执法层级（沿 SKILL Red lines 的 L0-L3 口径）：INV-09 的机器半=L1（在场检查），其同源半
=L0（协议文本+申报）。**不把 L0 说成机器门。**
