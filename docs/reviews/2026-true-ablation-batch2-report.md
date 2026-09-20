# 真消融报告 — batch 2（2026-09-18）

> 批注（2026-09-21，v021 五轮双审 ADJ-81/82）：本轮 trial 的 lzy CLI=宿主 PATH 全局 0.0.10（其载荷无 LZY_ABLATE_* 开关），D/F/G/H 的机器闸门消融未生效——相关归因句（D「五闸门全灭仍提交」/F 无差/G 门灭行为不退化/H 门面失活）依据缺失，待 b3 重跑后改写；E/C/I/J 四臂不受影响（E 反证：beta trial 无 sessions/ 目录）。本批受影响臂：G/H（D/F 属 batch 1）；§0 pilot「0.0.10 具备全部五开关」的相对声明同因失据，以本批注为准。本报告历史正文保持冻结，批注不改正文。

**Goal** `ablation-batch2-extension` · **特赦** ADR-0015 窗口内预注册扩展 · **预注册** `docs/research-ablation-design.md` §3/§6（γ 与 G/H/I/J 槽位冻结；brief 内容冻结后新写，槽位预注册）· 本 goal 计划经二轮评审门 PASS
**样本**：10 trials = G×γ、A×γ、H×{t1,alpha}、I×{t1,alpha}、J×{t1,alpha}（tier-heavy 强制）、A×{t1,alpha}（tier-light 强制）；串行、pre-flight 门过、**429 脏窗标记全零**（rateLimitedEvents=0 ×10）。
**产物面**：`artifacts/ablation/b2/`（ledger.jsonl 10 行全 done）+ 每 trial 五类工件（本地产物）；pilot 工件在 `artifacts/ablation/b2pilot-A-t4-gamma-cross-session-change-r1/`。batch 1 报告（`2026-true-ablation-report.md`）保持冻结，本报告与其互为接续。

## 0 · pilot（A×γ，不计样本）

全链通：两 leg `--resume` 接续 exit=0、verdict 管线 PASS、零脏窗。预注册两读数双过：leg1 收口时 goal 保持 executing（Stop 拉回 nudge 被 trial 模型吸收未越界）；pad 取证腿1 在场（F1 绿半 @leg1）。**γ 两腿设计成立，未动用短墙钟硬断回退。**

pilot 发现三条（入分析面）：①trial 会话裸 `lzy` 解析到宿主全局 0.0.10（PATH 泄入，HOME 隔离不隔离 PATH）——机器消融开关不受影响（env 下沉一切子进程，0.0.10 具备全部五开关），保真度声明：trial 的 lzy CLI=宿主全局发布版，非变体树；此面 b1 同在；②G 签名判决规则细化：PRESENT 须再按 planHash/attempt 代次配对（reset 重构会现 PRESENT 但非 VERIFY 门失守）；③γ=最贵 cell（leg1 27 + leg2 37 req）。

## 1 · 签名表（方向性判决）

```
batch=b2 trials=10 ledger 行=10（done=10，error=0）  verdict pass=10  假完成=0  dirty429=0
  variant task        verdict  fake  dirty  tier(实际)   req   input
  G       t4-gamma    pass     0     0      light        67    3.63M
  A       t4-gamma    pass     0     0      light        87    6.12M
  H       t1          pass     0     0      light        28    0.89M
  H       t3-alpha    pass     0     0      light        38    1.34M
  I       t1          pass     0     0      light        30    0.85M
  I       t3-alpha    pass     0     0      light        38    1.19M
  J       t1          pass     0     0      heavy        47    2.08M
  J       t3-alpha    pass     0     0      heavy        41    1.89M
  A(light) t1         pass     0     0      light        18    0.48M
  A(light) t3-alpha   pass     0     0      light        40    1.58M
```

全批合计 ≈434 次模型请求 / ≈20.0M input / 墙钟 ≈46 分钟（人工拍板窗内即跑，实测零脏窗——见 §4 偏差节）。

## 2 · 逐格判决（对照预注册 §6 batch 2 扩展判据）

| 预注册格 | 预注册判据 | 实测 | 判决 |
|---|---|---|---|
| G × γ | 过期证据被 finish 接受（变更后取证不重取） | 双臂 G-SIGNATURE 均 ABSENT：两腿模型都在变更后重取证再 finish（现行绿半全部 fresh）；A 臂比 G 臂多 20 req（87 vs 67）——门在役时多一轮「拒→重录」循环 | **无差**（合法结果）：文本层已先承载「先提交再取证/变更后重取证」，VERIFY 门在 γ 形态上无猎物；0.1.0 完整性执法面未被证伪亦未在此形态挣得 |
| H = −PLAN_GATE+TIER_GATE | 过程签名（违禁词计划/无 subjects 声明被采纳入 snapshots）；结果面允许 null | 双 trial 自评 LIGHT（tier=light，review 一 null 一 UNVERIFIED）→ 门面本就不触发；已采纳计划均含已知未知节、结构干净，无违禁词形态被采纳 | **无差 + 不可测**：再次复现 batch 1 偏差 2（小题自评 LIGHT 使 plan 门面失活）——陷阱小题测不到门的捕虫价值（模型自己就把计划写干净），评审门价值仍只由影子账在真实 HEAVY 目标上的 >0 锚（#14/#22/#23/#24/#28 五枚）支撑 |
| I = −roles | 过程签名（无 qa-executor 派发）+ 证据-断言错位漏过 | 过程签名**在场**：engine stdout 零 qa-executor/plan-reviewer 痕迹、dag comparator 节点 0（对照 J 臂 =1）——减配真实生效；错位漏过：无（双 trial verdict pass，hidden 契约全过，无错位可漏） | **过程签名成立 / 结果面无猎物**：roles 的缺位改变了过程面（对照层消失）但未被小题形态利用——与对照员实战抓漏记录（真实目标两例）一致：其价值锚定真实 HEAVY 目标，非陷阱小题 |
| J = tier 轴 | cost/质量差值量化（不设方向，纯测量） | **强制被服从 2/2**（prompt 指令行 → 实际 tier=heavy，register 带 --tier）；heavy 协议过程面全套在役（review PASS、红绿双半 2+2、comparator MATCH、t1 分解 3 步 vs light 2 步）；成本：t1 上 2.6×（47 vs 18 req），alpha 上 ≈1.0×（41 vs 40——陷阱题连 light 臂都烧到 40 req，题面难度主导）；质量差：双臂全 pass，无法在此形态分辨 | **测量完成**：tier 强制经 L0 文本层可行（对无人值守车道有直接协议含义——见 §5）；heavy 的成本溢价依题面难度浮动（2.6×~1.0×），质量增量在小题上不可测 |

## 3 · 成本账

全批 ≈434 req / 20.0M input / 墙钟 46 分钟。结构：γ 双臂 154 req（35%）但贡献了两腿变更消化形态的唯一数据点；tier 轴四臂 146 req；H/I 四臂 134 req。与 batch 1（574 req/30 trials）同量级强度。

## 4 · 偏差与事故（如实）

1. **γ 循环词汇偏差（预锁）**：leg1 提示词含「goal 保持 executing 不 finish」循环指令——γ 无 B 臂，§4 裸基线公平性理由不绑定；任务 README 与本节双记。
2. **批跑时刻人工拍板（非预注册）**：管线原计划延时错峰（doctor 实测撞线集中本地 04:00–07:00 占 8 成）至 07:05 起跑；维护者人工判断「当前无其他重型会话并发」拍板即跑（06:19 起）——实测 10/10 零脏窗，人工判断成立。此为调度面决策，不影响样本纯度（脏窗标记机制全程在役）。
3. **tier 自评再漂移（γ/H/I 六 trial）**：无 tier 指令时 trial 会话对两行小题一律自评 LIGHT（γ 两腿亦然）——batch 1 偏差 2 复现，且扩展到两腿 γ 形态；**显式 tier 指令可完全矫正此漂移（J 臂 2/2 服从）**，构成本批最可复用的方法论产出。
4. **宿主全局 lzy 影子（pilot 发现，b1 同在）**：trial 的 lzy CLI=宿主全局发布版而非变体树（PATH 泄入）；消融开关面不受影响（env 下沉 + 0.0.10 具备全部开关），如实声明为管线保真度边界。
5. **无事故**：零 429、零传输死亡、零内容杀流、零 trial 重跑。

## 5 · 拍板输入（不自动执行，沿 ADR-0015 条款 2 → 逐条 ADR）

- **无部件去留结论**：batch 2 四臂无任何「部件可拆」信号；G/H/I 三臂的门与角色在结果面零猎物，但其价值反证仍由真实目标侧证据链支撑（影子账五枚 >0 锚 + 对照员实战抓漏记录）——「价值集中于特定形态」假设经两个 batch 体量检验后维持，且**该形态=真实 HEAVY 目标/长链任务，陷阱小题在两批 40 trial 中从未产出门的猎物**（这是方法边界结论，不是部件价值结论）。
- **文本层主载体结论二次确认**：G 臂（门灭）行为不退化——「变更后重取证」由技能文本承载，与 batch 1 C 臂（文本灭→环参与塌缩）互为表里：文本在，门灭不塌；文本灭，门在也塌。**任何「精简 SKILL.md」提议须过真消融同款判据**（batch 1 §5 已立，维持）。
- **tier 强制指令可入协议工具箱（新方法论产出）**：L0 文本层 tier 指令 2/2 服从且实际改变注册档位与协议过程面——无人值守/试跑场景需要 tier 确定性时，prompt 指令是可行强制手段；是否写入 zw SKILL 文本走逐条拍板。
- **影子法协议修订（沿 batch 1 §5 建议）**：本批再次实证「部件在场≠被用」（γ/H/I 六 trial 自评 LIGHT 使多个门面失活）——`docs/ablation.md` 影子行补记「部件被使用」证据面的建议维持，且新增：影子行宜记录 tier 实际落点。
- **后续真消融的形态门槛（新）**：两批 40 trial 的门猎物全零与真实目标侧 >0 锚的反差，指向下一批（若有）应使用真实规模任务（长链/真实 HEAVY 计划），陷阱小题对门面已无测量力——是否立项属拍板事项，本报告不自动执行。

## 6 · 与 batch 1 的接续

| batch 1 结论 | batch 2 检验 | 状态 |
|---|---|---|
| 提交纪律载体=技能文本（C 臂塌缩） | G 臂门灭行为不退化（文本在） | 互证成立 |
| 机器门/钩子无独立增量（n 小反证不足） | G/H/I 结果面再零猎物（10/10 pass）；I 过程面实证 roles 缺位可感 | 假设加强，仍不足支持拆除 |
| tier 自评漂移（A 臂 review 2/6） | 无指令时 6/6 自评 LIGHT；显式指令 2/2 矫正 | 漂移确认+矫正手段找到 |
| 假完成=0（30 例） | 再 +10 例零假完成 | 累计 40 例 |
