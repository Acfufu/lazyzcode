# 0.4.0 M3 报告：发现与复判闭环（goal v040-m3-findings）

日期：2026-09-28 · 主方案：docs/plan-v040-engineering-policy.md §8-M3 / §8.1 `finding-lifecycle` / §10 V06·V07·V12 ·
前置：M2（docs/spikes/v040-m2-report.md）· 契约：.lazyzcode/contracts/v040-m3.md（contractHash 1a61311b…，endpoint A）

## 1. 交付面（14N 全落）

- **发现账本**（core/findings.js 新建，家族 `.lazyzcode/findings/<slug>.json`，loop 外 reset 不清）：
  指纹=sha256(severity|title|location 规范化)；状态机 open/resolve-requested/closed-fixed/closed-falsified/
  diagnosis-required；occurrences+history 全程留痕（回归重开历史不改写）；relink 别名闭包并集读（查环+路径穿越
  slug 拒）；形状闸+校验和 fail-closed；doctor `checkFindings` 行（损坏=fail 级，沿 checkReview 口径）。
- **统一门 findings 子句**（gate.js 占位替换）：本 slug+别名链存在未关闭阻塞发现 ⇒ 逐因 `[findings]` blocked
  （报文点名指纹/状态/首见/累计+指路）；账本损坏=blocked（fail-closed）；review 义务满足串同步（八合取语义）；
  职责表 v2→v3 翻面同批（rulesHash 随动，本 goal a1 记录漂移由 N14 supersede 收口——翻面前提如实入计划 N5）。
- **关闭通道唯一性**（V06）：`lzy finding resolve-request` → `lzy review recheck`（同职责新独立会话、facts-only
  不注入旧结论、闭候选对账）→ `lzy finding close --outcome fixed|falsified --basis … --recheck <runId>`；
  close 的 recheck 引用三校验（valid/同职责/不报该指纹）；无任何手工关闭或手工 PASS 逃生。
- **重复根因诊断**（V12）：连续两次无效修复（声称后再现）⇒ diagnosis-required（resolve 拒）；`lzy finding
  diagnose --root-cause` 记根因+重置计数后重入关闭通道。
- **义务复判**（V07，ADR-0033）：`lzy policy reassess <id> --impact … --cancel-reason … --basis …` 三件套入
  obligationsLog（event=reassess，历史只追加）；三拒面=baseline / 现行推导仍含（取消无独立依据）/
  review 型绑定未关闭阻塞发现（借取消删发现被拒，发现关闭后解除）；POLICY_VERSION v1→v2（v1 档读侧放宽）；
  取消后 expand 无删除抛错可重同步。
- **评审预算执法**（决策 #32 近似限制）：LEDGER_KINDS 增 `review`（绑 (slug, contractHash)；无契约 goal 保持
  运行档 durable 面；metered 才写；dedup=runId 幂等）；budgetView 增 reviewPoints 独立分项；契约
  `budget-ref: points:N` 绑定 → 累计超限 preflight 拒（budget-exhausted），在途超额如实记账。
- **M2 转入缺陷批 #5/#7–#13 全修**（逐条真表面读数见 §3）：#7 多 subject 前移 exit3 不落档；#8 认证腿按隔离
  HOME 会话创建门判；#9 输入包证据面（非文本附件引用+steps 含 s.evidence+disclosure 披露块）；#10 计量
  distinct sessionId 去重/缺席不算零/落库延迟有界重试/逐会话分解；#11 写前缀 withLock 单写者；#12 phantoms
  落档；#13 字节精确截断；#5 unpriced 指路 `lzy loop cost` 与 MODEL_ALIASES。
- **CLI/文档**：`lzy finding` 六命令（退出码 0/1/2 契约）+`lzy review recheck`；guide 双语 + CHANGELOG +
  decisions #39/#41 翻已实施；测试 697/697（基线 688+9）。

## 2. 反例矩阵与绿例（qa `--case finding-lifecycle`，exit 0 · 20 断言）

工件：artifacts/v040/M3/finding-lifecycle/result-finding-lifecycle.json（+result.json）。

- **替身链 A**（确定性）：阻塞入账（valid 落档+upsert 1）→ 替身绿运行翻满足 review 义务后 `[findings]` 成唯一
  残因 ⇒ **finish 必拒**（报文点名 findings）→ resolve → recheck 仍报=无效修复 1（回 open）→ 二轮 ⇒
  **diagnosis-required** → resolve 拒（exit 1）→ diagnose 重置 → fix 提交+F1 rebind → recheck 绿 ⇒ 闭候选 1 →
  close fixed → gate PASS → **finish 过门落 attestation**。
- **替身链 B**：证伪分支 close falsified（替身腿 fixture 标记）。
- **替身链 C**（存续三面，单工作区）：reset 后同 slug 重注册发现链存续；改名 relink 后并集可读且 gate 仍拦；
  supersede attempt2 不洗发现。
- **替身链 D**：reassess baseline 拒 / 推导仍含拒 / endpoint B→A 影响变化落地后取消活体（show 义务集不再列）。
- **真会话腿**（能力探测后；预算 §4）：
  - R1 真实评审对注缺陷夹具（auth.js 撤回检查缺席种子体）：valid metered **0.250 分**/127s，
    **verdict=blocked**——真实评审模型确实发现种子缺陷并阻塞入账（findingsLedger.upserted 如实记录）。
  - R2 真实 recheck 收口链：替身播种阻塞→fix 提交+F1 rebind→resolve→**真实 recheck**（pass，0.302 分/152s）
    闭候选 1 → close fixed → gate PASS → **finish 过门 attestation**——V06 全链真实表面贯通。

## 3. INV-08 红绿同源（scripts/v040/m3-findings-harness.mjs）

红半树=写定时钉定 `6b4f7fb1e0edda11dbfad9d6ab503e4ccf89d6db`（M2 收口冻结树，git archive 提取）；同一脚本
两半读数（artifacts/v040/M3/harness/{red,green}.json）：

| 观察 | 红半（改前行为） | 绿半（工作树） |
| --- | --- | --- |
| D1 植入未关闭阻塞发现+review 义务已满足 | gate **PASS**·finish 0·不点名指纹（占位不拦） | gate **BLOCKED**·finish 1·`[findings]` 点名指纹 |
| D2 finding 命令族 | 未知命令 exit 1 | exit 0 且枚举到在案发现 |
| D3 relink 别名链 | 未知命令 exit 1 | exit 0 且 gate 仍拦同名发现 |
| D4 reassess 面 | 拒 + removed 档读不出（现算显示「未落档」） | usage 拒在案 + removed reassess 形档「记录在案」可读 |

## 4. 预算账（契约 budget-ref：预注册 ≤12 次真实会话，超注如实记账）

| 消耗 | 会话数 | 点数 | 说明 |
| --- | --- | --- | --- |
| N7 recheck CLI 冒烟 | 1 | 0.167 | 意外真 spawn（漏带 LZY_ZCODE_ENGINE 抑制）——如实入账 |
| N11 QA R1 | 1 | 0.250 | 注缺陷夹具真实评审（verdict=blocked） |
| N11 QA R2 | 1 | 0.302 | 真实 recheck 收口链 |
| **小计（本报告时点）** | **3** | **0.719** | N14 自审收口（1-2 次）与其韧性余量在预留内 |

## 5. 威胁边界（如实声明不冒充）

- 发现账本与运行族同位阶：同权限进程可篡改盘上字节——补偿控制=校验和 fail-closed+doctor fail 级+审计环；
  不抵御同权限篡改（沿 M2 口径）。
- 关闭通道的「独立性」=独立评审会话（隔离 HOME+facts-only+同职责），非独立信任根：评审模型误判的可能性
  由 falsified 分支的 basis 必填与账本 history 留痕承载，不宣称判断必然正确。
- `policy reassess` 的三件套是 L0 纪律记录（非独立复核模型执行）；机器拒面（baseline/推导仍含/未解决阻塞
  发现）为 L1。
- budget-ref points 执法为近似限制：超限拒「下一次启动」，不中途杀在途会话；子账本落库延迟以有界重试
  缓解（3 读×750ms），残余窗口如实记账。

## 6. 收口相位与文档行拆分（沿 M1/M2 先例）

N14 收口相位：计划增补收口节 → plan-reviewer 复审 → supersede 重采纳（含 N5 翻面后本 goal a1 记录漂移的
再采纳收口）→ F 证据按现行代次采集（自审收口 F8 含一次真实自审运行）→ 规则内容冻结。
AGENTS §2 M3 行与 docs/history.md 里程碑行在 finish 收口 chore 提交落终值（本报告 §2/§4 数据为其唯一事实源）。

## 7. M4 输入清单（本阶段如实声明不冒充的出口）

1. **翻面波及面复盘**（M2 输入 #4 顺延）：职责模板三条专项职责扩面与范围资格面（qualify/reuse）同批。
2. **评审范围资格与复用**（ADR-0032）：qualify/reuse/复用结果判断——ADR-0033 §7 的「复用结果」记录形态
   与本阶段取消事件的对账面。
3. **recheck 定向粒度**：--fingerprint 已支持定向复核；多发现并发闭候选的批量 close 体验（逐条 close 可用，
   批量未做——本阶段取舍如实记录）。
4. **本目标自审非阻塞发现**：F8 自审运行产出的 P2/P3 非阻塞发现按收尾纪律转录（见收口 chore/附录）。
5. **替身围栏转义潜伏缺陷**（N11 随修）：M2 替身引擎围栏腿 `\\n` 转义链致围栏内 JSON 不可解析（r1/r8 期望
   面在 M2 收口后不可复达）——本阶段随修并复验；同类转义面（模板字面量嵌套）值得一次专项清扫。
6. **评审预算视图的 drive 侧读数行**：本阶段 budgetView/queue budget 行已落；drive 段报文行未并入（执法面
   已在评审前置生效，drive 视图行为展示性补齐）。

## 附录 A：本目标自审发现转录与处置（v040-m3-findings.a2.r2 · blocked · 候选 333b6f7）

自审会话（metered 10.273 分，超时废跑 1 次如实入档）对本仓 M3 候选树评审判 blocked（1×P1 阻塞）+4×P2+2×P3。
处置：P1 与两处廉价项（P3-F-5 口径、P2-F-2 drive 行）随收口提交修正后经 resolve-request→recheck 独立复核
关闭；其余如实转录 M4 输入（非阻塞不拦截 finish）：

| # | 级 | 一句话 | 处置 |
| --- | --- | --- | --- |
| F-1 | P1·blocking | 新契约测试预算腿调真 preflightReview 未注入 detectAuth/sqliteProbe——CI/无凭据机器必失败 | **随收口修正**（deps 注入两替身），resolve→recheck 后关闭 |
| F-2 | P2 | 契约 A7「drive 预算视图评审行」未落地与报告 §7-6 表述冲突 | **随收口修正**（doctor drive 行增评审分项读数），报告 §7-6 相应改写 |
| F-3 | P2 | close 的 recheck 引用不绑目标代次/时序——任意在案 valid 运行可作依据 | M4 输入（收口期不扩面） |
| F-4 | P2 | relink 方向无校验且改名未 relink 静默失效（fail-open 形态） | M4 输入（查环已有；方向/未 relink 检测补面） |
| F-5 | P3 | 发现入账只认 blocking===true 与门判 P0/P1 即阻塞口径不一 | **随收口修正**（入账口径与门同源） |
| F-6 | P3 | cmdFinding 退出码文档漂移（歧义/不在账变更子命令 1、show 2） | M4 输入（文档行措辞统一） |
| F-7 | P3 | finish 相位账本 upsert 与 review 入账在 withLock 外——并发可丢更新 | M4 输入（#11 锁覆盖面扩到落账相位） |
