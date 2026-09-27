# v040-m1 策略身份与统一只读门报告

goal `v040-m1-gate`（0.4.0 M1 策略与统一门骨架）· 2026-09-27。依据
`docs/plan-v040-engineering-policy.md` §3/§6/§7/§8 与设计拍板
`docs/design-v040-engineering-policy.md`；计划 `.lazyzcode/plans/v040-m1-gate.md`
（N8 附注=全量 sweep 归类与接线收口）。

取证时宿主树冻结：报告提交前 HEAD `0eef965` · tree `cbf449d8`（本报告与 harness D5/D6 观察面扩展
同批提交，为其后一提交；F 项终验读数按收口树重采，指针见 §5）。
工具：契约测试 `test/policy.contract.test.js`（8 例）· `test/unified-gate.contract.test.js`（7 例）·
零会话矩阵 `scripts/v040/qa.mjs --case gate-matrix`（15 断言）· 红绿同源入口
`scripts/v040/m1-gate-harness.mjs`（INV-08）。开发跑全量 **676/676 绿**（M1 起点 659）。

**本阶段正确形态**：受控评审运行器属 M2 ⇒ 评审义务（`review.general-correctness`，底线）在 M1
恒不可满足＝**诚实阻塞**；本报告与全部产物不含任何伪造的评审完成声明／占位 PASS。

## 1. 反例矩阵（八体 + 基态）

`lzy gate explain` 活体（同一「已批准契约 + 真实成功回执」v2 基态逐体注入单缺陷；
真实 UPS 批准走钩子，成功回执=真跑 `verify run` + 假 gh 替身读回 `verify ci`）：

| # | 反例体 | 命中面（逐体对应） | 退出码 |
| --- | --- | --- | --- |
| 基态 | 无注入 | 唯一 unsatisfied=评审底线；check/ci 义务 satisfied「三轴满足」；零失败子句 | 1 |
| b1 | 失败但可复用的回执 | `exit.code==3（非 0）——失败回执可复用仅构成适用性事实，不满足成功义务（V03）` | 1 |
| b2 | 错契约 | `[a.contract-unmutated] 契约已变（新哈希=新授权请求）` + 策略输入身份漂移 | 1 |
| b3 | 错候选 | `候选已前移（回执 head≠现行）——对现行候选重验`（check 义务层面） | 1 |
| b4 | CI 漏项 | `必需检查「ci / test (24, windows-latest)」missing：不能拿别的绿项顶替` | 1 |
| b5 | 授权撤回 | `[b.authorized] 契约授权已被用户撤回（撤回于 …, 短码 …）` | 1 |
| b6 | 评审缺席 | `受控评审运行器未接入（M2）——评审义务诚实阻塞` | 1 |
| b7 | v2 目标契约缺席 | `[a.contract-readable] 契约文件不可读或结构非法` | 1 |
| b8 | 契约在案但验收映射缺项 | `验收覆盖缺口：契约验收项 A2 无任何 F 项 accepts 引用`（脱节腿：`F2→A9` 同测） | 1 |

原始读数：`artifacts/v040/m1-report-evidence/result-gate-matrix.json`（逐体
`unsatisfiedObligations` / `failedClauses` 全文）与 `scripts/v040/qa.mjs --case gate-matrix` 活体 stdout。
b8 的注入面=夹具 goal 对象覆盖（`evaluateGate` 的测试注入缝，CLI 面永不传）与 goal.json 步骤覆盖
（零会话矩阵），两处都在计划 N8/N9 的明示注入面内。

## 2. 接线矩阵（四入口 + v1 对照半）

| 入口 | v2（带策略身份）阻断形态 | v1 对照半（既有成功路径） | 测试位置 |
| --- | --- | --- | --- |
| `loop finish` | 退出码 1、报文含「统一门阻塞（政策层, gate …）」+ 评审义务、`status` 保持 executing | v1 降级夹具 finish 照常过（本报告 §3 V09 行） | unified-gate 真 CLI 例 / qa.mjs `ENTRY-finish` |
| `loop queue dispatch`（done 记录） | 条目非 completed + 回 `ready` + tx `killed` + 成因含「done 记录不免核」 | 同夹具降 v1 → 条目 completed、tx settled | unified-gate「缝 queue 1182」/ queue-delivery ⑧ |
| `queue reconcile`（done 追认） | 不追认：条目保持未决（非 completed）、verdict 字面含阻塞原因、tx 留 `open` | 降 v1 → `settled（补结算）`+completed | unified-gate「缝 reconcile 853-858」 |
| `delivery act B`（外发前置） | 错误面「外发前置统一门（ep B）阻塞」、**外发替身计数 0**、意图零落账、contractPending 原样保留 | 降 v1 → 意图落账至 done（mergeSha 读回权威） | unified-gate「缝 delivery beginAct」/ delivery-gate ⑩ |

done 旧记录不免核读面：done 目标的 `lzy gate explain` 恒 BLOCKED（v2）；无契约 v2 目标同样生成
评审义务（拍板 7：不存在「无契约→免评审」旁路）。

## 3. 兼容矩阵（V13 的 M1 面，活体实录）

| 场景 | 观察 | 判 |
| --- | --- | --- |
| v2 新注册 | `goal.json` = `version:2` + `policy.schemaVersion:1`；采纳后 `.lazyzcode/policy/<slug>.a<n>.json` 在案（形状闸全过） | ✔ |
| v2 缺身份（删 `policy` 字段，保 `version:2`） | 读面 fail-closed：`v2 目标缺策略身份字段或形状损坏（policy.schemaVersion 须为 1）…不猜测补齐`，退出码 1 | ✔ 拒 |
| v1 延续（盘上 `version:1`） | `loop status`／`gate explain` 退出码 0，裁决行逐字「政策裁决不适用（v1 旧规则延续）」；首次状态写操作落兼容锚 `.lazyzcode/policy/compat-<slug>.a<n>.json`（kind=compat-goal-v1，观测快照非授权面） | ✔ |
| reset 后同名新建 | 恒 v2 带策略身份，采纳照常，`gate explain` 退出码 1（**不继承** v1 豁免资格） | ✔ |

**已知口径附记**：v1/v2 判别式=**盘上版本字段**；手写 v1 夹具与「真实旧目标」在盘上不可区分
（同为本阶段有意口径——兼容按「盘上记录」而非「来源可信度」判）。因此 V13 的断言面钉在
**register 恒产 v2**（新建目标无法以任何 CLI 路径产生 v1 记录），而非「来源检测」。记忆体中的
「新任务缺策略不能走 legacy」由此闭合：新增 legacy 记录的唯一路径是人工改盘，属伪造面不在本层防。

## 4. 变式证据指针（V01/V03/V09/V10/V13 的 M1 面）

| 变式 | M1 面证据 |
| --- | --- |
| V01 | 同冻结输入两同构工作区记录**逐字节恒等**；`lzy policy explain` 两次输出逐字节同；在案+输入一致=零写；影响扩大 expand 追加并入 `obligationsLog`（只增不删，删除即 `PolicyError`）；底线义务读侧形状闸拒删/拒降格 |
| V02 | 契约漂移/撤回在 gate explain、finish、外发前置三面拒绝（§1 b2/b5、§2 四入口）；`inputsHash` 漂移不重导、不自动替换在途策略 |
| V03 | 失败但可复用回执=适用≠成功（§1 b1）；错契约/旧 null 契约绑定/缺验收映射三类同拒（b2/b7/b8）；契约启用前的 null 归属回执在 `judgeReceiptIdentity` 契约轴上如实判不符，不猜测补齐 |
| V09 | done 重入（finish 复走）、queue 追认、手工 delivery 三入口均不能绕门（§2 全行）；v1 对照半证明既有成功路径不变（拍板 6 三分法：全量 sweep 见计划 N8 附注） |
| V10 | CI 严判唯一事实源 `judgeRequiredCiChecks`＋`judgeCiRunsStrict`：仅 `conclusion==="success"` 计绿；neutral/skipped/cancelled/缺项/空结果/查询失败全非绿；`checkRunsVerdict` 收敛复用（红半见 §5） |
| V13 | §3 兼容矩阵四行 |

## 5. 红绿同源取证（INV-08）

入口 `scripts/v040/m1-gate-harness.mjs`（冻结件；`--root` 注入被测树，两半同脚本同 env）：

| 观察 | 绿（工作树） | 红（改前树） |
| --- | --- | --- |
| D1 done 分支直放 | 条目 `ready` + tx `killed`（统一门拒） | `completed` 直放（pre-N5 `3fe6055`） |
| D2 reconcile 直放 | 条目不追认（非 completed） | `completed` 追认（pre-N5 `3fe6055`） |
| D3 CI neutral 计绿 | `ok=false` 严判 | `ok=true` 计绿（pre-N3 `aabf39d`） |
| D4 gate explain 面 | 裁决行在案（退出码按契约） | `未知命令`（pre-N5 `3fe6055`） |

三份读数：`artifacts/v040/m1-harness-{green-dce3ee2,red-preN5-3fe6055,red-preN3-aabf39d}.json`
（F 项终验时按现行树重采绿半）。契约测试侧的严判翻转（delivery-state ⑤）与 done 免核两缝
（unified-gate）同批在案。

## 6. 执行期收口三项（N8 测试暴露后同批修，均非新旁路）

1. **采纳落策略档断线**：N4/N7 承诺的「接线面 `ensurePolicyRecord` 首门落档」在 N5 四处接线里
   **没有调用点**——真 CLI `register→plan→start` 后 `.lazyzcode/policy/` 全缺（探针实录），统一门对
   v2 目标恒 blocked 于「策略记录缺席」，逐义务矩阵不可达。收口=`doAdoptPlan` 在写 goal 前
   `ensurePolicyRecord(..., { expand:true })`（采纳=授权的重规划时点；失败=采纳拒，与 dag-first 同家法；
   v1 返回 `applicable:false` 零写；supersede 开新代次自然落新记录）。
2. **ci 回执清单轴结构性非绿**：`judgeReceiptIdentity` 原对 `kind=ci` 也核 `recipe.manifestHash`，而
   `queryCiChecks` 如实记 `null` ⇒ ci 义务（须清单声明才生成）恒判「清单漂移」不可满足。收口=清单轴
   只适用清单配方回执（kind∈run/reuse/qualification）；ci 的清单身份由 repo+sha 候选轴承载。
3. **清单解析失败不容忍**：落档使「清单坏」成为采纳面新前置（会误伤只看字节哈希的契约门查 e 夹具）。
   收口=`computePolicyIdentity` 记 `manifestInvalid` 旗、统一门 `policyIdentity` 子句据此阻塞——
   失败面不变（仍 fail-closed），但规则不再加到采纳门序上。

## 7. M2 输入清单

1. **受控评审运行器**（§4.1）：M1 的评审义务恒阻塞＝M2 的唯一放行缺口；交付后 v2 目标收口走
   「运行器自审」（真实运行记录落评审回执家族），`REVIEW_RUNNER_FACE.available` 翻面须同批 bump
   `DUTY_TABLE_VERSION`（该旗参与 `rulesHash`）——翻面=新策略版本，不自动替换在途记录。
2. **M0 发现一（计量缝）待确认**：隔离 HOME 自账本 ⇒ 执行器按子账本路径计量或参数化
   `querySessionPoints(sessionId, dbPath)`（M0 报告 §2 发现一；本阶段未动产品）。
3. **发现面**（M3 建账）：统一门 `findings` 子句现如实报「未建立＝无可声明」，M3 建账后接入阻塞发现。
4. **策略变化通道**：`expand` 现由采纳面调用；`reassess`（额外义务独立复判取消，ADR-0033）与
   规则版本翻面的采纳提案通道属 M3——M1 无 CLI 出口（漂移即阻塞，诚实）。
5. **v1 兼容锚的回收**：`compat-<slug>.a<n>.json` 现只增不清（观测面）；M5 迁移时与迁移机器一并定义回收。

## 8. 附记：N5② done 分支的 churn 语义观测（无 drive 不烧预算）

真 CLI `lzy queue dispatch`（引擎抑制）对 **done v2** 目标的实录：

- 恢复核对腿：残留 open tx 被 reconcile 判 `blocked（统一门：[义务 review.general-correctness] …）`
  ——不追认、不假零。
- 新派发腿：驱动前置自检拒「drive 只推进 executing 目标（现状 done）——无人值守边界：绝不立新计划」，
  tx 保持未决（未决占用不作零消耗申报），条目回 `ready`，命令退出码 1。

即：**done 且被政策层阻塞的目标不会被无人值守车道反复驱动**（无引擎会话、无预算燃烧，只留 tx 未决）
——churn 面由「drive 前置自检 + 统一门」双重收口；夹具实录见
`artifacts/v040/m1-report-evidence/churn-dispatch.txt`。
