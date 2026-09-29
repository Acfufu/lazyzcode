# 0.4.0 策略正式配对评估报告（M5 · N10）

- goal：v040-m5-eval-release · 批次 `m5eval-20260929013548`（seed 20260927，交错序冻结）
- 基线臂：`baseline-lazyzcode-0.3.1-gitarchive.tgz` sha256 `569e1e10…754a7`（git archive v0.3.1 tag 94a46df）
- 候选臂：`candidate-worktree-f2622d1.tgz` sha256 `be03b258…51863`（工作树 f2622d1，N1–N7 全落后；版本元数据未 bump，R6 双身份）
- 环境：node v24.19.0 · 引擎 Resources/glm/zcode.cjs（0.16.9 代）· darwin · 预算单 run ≤400 分/≤30 分墙钟（R2）
- 判定器：oracle v2（2026-09-29 仪面修复后代次，`oracleJudge=2` 全批一致；修复=harness `evalOracle` 注入 `$FIXTURE` + expect 结构化解析 + r2 作用域 + runDir 复位，详见仓内 `scripts/evaluation/manifests/m5-batch.json` harnessChanges 第 3 条，提交 106a540）
- 账面：journal 74 行（原批 38 + 失效重跑 14 + 存量重判 22），sha256 链验证 PASS
  - report.json `97f3f4c9…78435` · journal.jsonl `365fea9b…23b2` · batch.json `574827e2…b1ed`
  - 原始轨迹根：`artifacts/v040/M5/eval/frozen/`（本地产物，不入库；本报告为其哈希索引）

## §1 执行账

- 36/36 真运行全部入账、18/18 对齐（三仓 × 2 任务 × 3 trial × 2 臂）；R1 判据=齐备（无阻塞腿）。
- 失效重跑 14 seq（旧行保留=尝试账，report 按 seq 取末行 supersede）：6 对因引擎间歇性 Authentication failed / 击杀无转录 / harness 崩溃整对重跑（17/32、36/21、31/18、15/19、25/20、34/35）+ seq1/2 因 materializeRepo 叠加污染连带重跑；重跑全部在 runDir 整目录复位后执行（单基线提交、零残留实证）。
- 存量重判 22 run：oracle 判读腿重跑（agent 会话不重跑），22 行 supersede 入账。
- 计量：29/36 metered（子账本逐会话读回），7 absent=全部为墙钟超时行（击杀后无可结算请求，如实标 absent）；旧臂 170.83 分 / 新臂 98.43 分。
- canary 超注：基线臂冒烟预注册 ≤1 会话、实际 3 会话（0.3.1 CLI finish 被评审义务门如实拦截重试），超注已在 m5-batch.json baselineCanary 节如实落账。

## §2 质量门逐条读数（§9.2；判定器读数为准）

| # | 判据 | 读数 | 判 |
|---|------|------|----|
| 1 | 独立 oracle 确认的正确交付 | 旧 12/18 · 新 12/18（oc 6/6·zp 6/6 两臂全过；lz 两臂 0——见 §4 check-2 限制） | 平 |
| 2 | 关键反例全过（oracle 内负例断言） | oc/zp 12 对全过判读的 checks 含混合大小写凭据不转发、逐跳头过滤、authority 清理不复活等负例 | ✓（过判读腿） |
| 3 | 新臂关键错误完成=0 | falseCompletionsNew=0（新臂 18 次 goal 声明=0，无一次宣称未达成的完成） | ✓ |
| 4 | 每任务新臂正确交付 ≥2/3 | oc task-1 3/3 · task-2 3/3 · zp task-1 3/3 · task-2 3/3 ✓；**lz task-1 0/3 · task-2 0/3 ✗** | ✗ |
| 5 | 正确交付总数不低于基线 | 12 ≥ 12 | ✓（平） |
| 6 | 错误完成减少或正确交付增加至少一项严格改善 | 错误完成 0=0（判定器读数下两臂均 0）；正确交付 12=12——**无严格改善** | ✗ |
| 7 | 误阻断 · 复用 · 人工介入 · 重验量 | finish 门拒面：新臂 gate 拒 19 次（其中 oracle 已确认交付仍不宣称 done 的保守拦截 12 次）/旧臂 0 次（dirty 拒 7·stale 拒 3 两臂同量级）；复用分类：0.3.1 臂无评审复用机制=不适用如实注记，新臂夹具任务未触发 reuse 腿；人工介入=0（headless 受控消融语境，LZY_ABLATE_HUMAN_GATE=1 同 M0/M4 夹具）；重验量=重跑 14+重判 22（详见 §1） | 如实转录 |
| 8 | 耗时 | 旧臂均值 18.4 分（合计 330 分）· 新臂 23.1 分（415 分）；超时 7 次全在 30 分墙钟 | — |
| 9 | 成本分账 | 旧 170.83 分 · 新 98.43 分（秒与积分不相加；成功数均非零故不适用零成功例外）；canary 3 会话超注另计 | — |
| 10 | 逐对原始结果与差值 | 见 §3 十八对全表 | — |

**质量门结论：不满足**（判据 4 两条 + 判据 6 一条未过）⇒ **尚无质量收益证据——不宣称通过，不产晋级材料**（§9.2 末条）。

## §3 逐对原始结果（十八对；oracle=独立判读 · goal=循环宣称 · 分=子账本积分）

| 对 | 旧臂 oracle/goal/分 | 新臂 oracle/goal/分 |
|----|--------------------|---------------------|
| lz task-1 t1 | false / true / 12.69 | false / false / —（超时） |
| lz task-1 t2 | false / true / —（超时） | false / false / —（超时） |
| lz task-1 t3 | false / true / 15.06 | false / false / 18.94（resume-failed） |
| lz task-2 t1 | false / true / 11.84 | false / false / —（超时） |
| lz task-2 t2 | false / true / 9.59 | false / false / —（超时） |
| lz task-2 t3 | false / true / 6.26 | false / false / 7.54（resume-failed） |
| oc task-1 t1 | true / true / 12.05 | true / false / 8.43 |
| oc task-1 t2 | true / true / 12.77 | true / false / —（超时） |
| oc task-1 t3 | true / true / 9.93 | true / false / 16.55 |
| oc task-2 t1 | true / true / 12.25 | true / false / 5.79 |
| oc task-2 t2 | true / true / 5.85 | true / false / 3.58 |
| oc task-2 t3 | true / true / 5.06 | true / false / 3.49 |
| zp task-1 t1 | true / true / 9.61 | true / false / 7.58 |
| zp task-1 t2 | true / true / 19.05 | true / false / —（超时） |
| zp task-1 t3 | true / true / 7.46 | true / false / 7.62 |
| zp task-2 t1 | true / true / 6.37 | true / false / 5.15 |
| zp task-2 t2 | true / true / 10.62 | true / false / 10.44 |
| zp task-2 t3 | true / true / 4.35 | true / false / 3.34 |

形态读数：openchamber 与 zpigeon-ios 八任务**两臂 oracle 全过**（交付正确性平）；差异全在「宣称完成」——旧臂 18/18 宣称 done（其中 lz 腿见 §4 保留意见），新臂 0/18 宣称（finish 门拦截 19 次 + 超时）。新臂耗时均值 +4.7 分、单分积分成本更低（完成同量交付 98.43 vs 170.83 分）。

## §4 完整性门活体与威胁边界

**完整性门活体（V14）**：scratch 拷贝 journal（74 行）删第 20 行后重入 report 通道 ⇒ `[run-pairs] BLOCKED：完整性门拒（{"journalChain":false,"journalEntries":73,"packagesMatch":true,"envMatch":true}）`、exit 3——删改结果账必拒，实证在案。

**威胁边界（如实列出）**：

1. **lz oracle check-2 在本批环境机械不可过**：密封判据命令 `node --test test/` 在 Node ≥22 的位置参数 glob 语义下对目录参数恒 MODULE_NOT_FOUND（两臂同损，与仓状态无关）。诊断实证：同仓裸 `node --test` 与 glob 形式 `node --test "test/*.test.js"` 均 662/662 绿（seq14 存量仓实测）——即 lz 旧臂 6 次goal=done 的「check-2 失败」是环境性假阴性，**lz 腿 oracle 读数应按 check-1（probe）级理解：lz probe 两臂 12/12 全过**。质量门结论对此稳健：即便按 probe 级反事实（两臂 18=18），判据 6（无严格改善）仍不满足，结论不变。密封判据不可改（oracleSha256 钉死）；**重封存时改 glob 形式命令=0.5.0 输入**。
2. **harness 代际漂移**：36 次运行跨 4 代 harness（批中两次仪面缺陷修复+失效重跑通道），状态/计量/终验语义未变，failNote 注记与 oracleJudge 标记代次可辨；判定器全批最终统一为 v2（存量 22 行重判）。
3. **metering absent 7 行**：全部为墙钟超时（击杀后无已结算请求可读），如实标 absent 不冒充；子账本口径与引擎最终结算可能存在已知差异（M2 计量缝口径）。
4. **小样本**：每任务 3 trial，**不宣称任何总体错误率为零**；所有比例仅为本批读数。
5. **评估集快照**：物化锚清单钉值（zpigeon-ios HEAD 漂移已复核落档，m5-batch zpigeonDrift 节）；受控消融 LZY_ABLATE_HUMAN_GATE=1 与生产人权门语义不同（评估语境专用）。

## §5 结论与采纳提案材料（采纳=维护者决定）

**结论：质量门不满足——尚无质量收益证据。** 按计划 §9.2 末条：不宣称通过、不产晋级材料；本报告与 release-ready 物料照常产出，发布与采纳拍板归维护者。

给维护者的决策材料（如实两面）：

- **不建议以本批为依据切换默认策略**：判据 4/6 未过，正确交付与基线打平，无收益证据。
- **候选发布不被本批阻断**：B/C 回归全绿（N7）与评估负结论正交；评估绑候选包 sha `be03b258…`，0.4.0 发布包按 R6 双身份差异=版本元数据+文档。
- **本批测得的候选纪律面实据**（供 0.5.0 复议）：①错误完成 0（旧臂 lz 腿在 check-1 级也为 0，两臂均无可证伪的错误完成）；②finish 门拦下 19 次未满足义务的收尾尝试、其中 12 次发生在交付已正确完成后——「保守不宣称」是双刃：零假完成，代价是 headless 语境下 goal 永不 done（0.5.0 候选输入=义务在 headless/评估语境的降阶满足路径）；③同量交付积分成本新臂更低（98.43 vs 170.83）但墙钟更长（+4.7 分均值）。
- **0.5.0 输入清单**：密封 oracle check-2 glob 形式重封存；lz 腿 30 分预算×自宿主任务的设计复核（新臂 0/6 完成 vs 旧臂 6/6）；finish 门 headless 降阶满足路径；gate 阈值（≥2/3·严格改善）在平局形态下的复议素材。
