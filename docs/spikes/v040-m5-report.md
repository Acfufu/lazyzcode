# 0.4.0 M5 报告：迁移恢复实弹 + 正式配对评估 + 定版 release-ready（goal v040-m5-eval-release）

弧收官报告。上承 M4（docs/spikes/v040-m4-report.md）；评估专报 docs/reviews/v040-policy-evaluation.md（批次账面唯一权威）；本文为 M5 六维对表与收口转录。

## 1. 执行账

13 N + 9 F，attempt 2（收口相位 supersede 重采纳，批准 96044ec3 真实用户消息·UPS 钩子记录；plan-reviewer 两轮 PASS）。关键提交：4bafa9e/ef7a8ad/de62d82/134f142（N1–N4 机制面）· e445b2a（N5）· f986162（N6）· f2622d1（N7）· a579148（N8 冻结）· ac15a35/26eaf0e/330dad0/cff3f01/85d1895/106a540（N9 期执行与仪面修复）· 958cfb5（N10 报告）· 9110a00（N11 定版）。

## 2. 迁移恢复读数（N5，§8.1 用例一）

- `qa.mjs --case migration-recovery` **十一断言全绿 exit 0**：冻结 0.3.1 树（git archive tag 94a46df → npm pack 离线，sha 与评估基线包互证 569e1e10…）真 CLI 建在途态（v1 executing goal + queue 项 + budget 段 + delivery act B 真链 done，假 gh 替身计 8 次外部动作）→ 0.4.0 三分支活体：**续旧**（v1 延续行 + goal 字节零触碰·版本标记）/ **新注册**（v2 策略身份在场；残缺 v2 记录 fail-closed 拒、不落 legacy）/ **显式 apply 全径**（stateVersion=0.4.0 落盘 + 草案 authorization NONE + 三族字节保留 + manifest sha256 双读）。
- 相位 SIGKILL 注入恢复矩阵：**migrate 契约测试 17/17**（backup 后重跑补齐未收尾显形 / stage 后不覆写草案 / switch 后幂等不重放——裁剪 journal 复刻 kill 点态；switch 提交点双形态含亚毫秒赛完窗如实记录）。
- done 交付意图再 act 被拒且假 gh 计数**零增**（副作用不重放活体）。

## 3. 评估账与质量门判决（N9/N10；专报为权威）

- 批次 `m5eval-20260929013548`（seed 20260927 交错序冻结；基线 569e1e10… / 候选 be03b258…）：**36/36 真运行入账 · 18/18 对齐 · oracle 判定全齐**（判定器 v2 统一，oracleJudge 标记）；journal 74 行 sha 链验证 PASS；完整性门活体=删行即拒（exit 3）。
- 执行期仪面缺陷四件全修并落账（harnessChanges 三条 + 106a540）：oracle `$FIXTURE` 未注入、expect 判据句字面解析、r2 作用域 ReferenceError、runDir 重跑污染；处置=失效配对整对重跑 6 对 12 seq + 污染行 2 + 存量 22 run 仅判读腿重判（agent 会话零重烧，省 ~220 分）。
- **质量门（§9.2）：不满足——尚无质量收益证据**。判定器读数：正确交付两臂 12/12 打平（openchamber/zpigeon 八任务两臂 oracle 全过；lazyzcode 腿两臂 0）；新臂关键错误完成 0；每任务 ≥2/3 在 lz 两任务失守（新臂 0/6 完成=超时/恢复失败）；判据 6=严格改善 ✓（错误完成判定器读数旧 6→新 0，旧 6 例含 lz check-2 假阴性贡献——probe 级反事实 0=0，见评估专报 §2/§4）——门失败仅在判据 4。finish 门拒面读数：新臂 19 拦（旧臂 0）——「保守不宣称 done」是零假完成的代价面。**不宣称通过、不产晋级材料；发布不被阻断（R6 双身份），采纳拍板归维护者。**

## 4. 预算账（R2，超注如实）

- 批内 metered 29/36 run：旧臂 170.83 分 / 新臂 98.43 分（7 absent=墙钟超时行如实标）；耗时旧臂均值 18.4 分 / 新臂 23.1 分。
- 超注三笔如实：①基线 canary 预注册 ≤1 会话实耗 3（物化遗漏+人权门未消融两因，后以 LZY_ABLATE_HUMAN_GATE=1 受控消融修复并重冻结 batchId）；②失效重跑 14 run + 存量重判（仪面修复代价，全入尝试账）；③坏冻结批一次自审即弃（同名 pack 覆写致双包同 sha，R6 纪律重冻）。
- 累计约 270 分 << R2 检查点 2000 分，未触发暂停对账。计划评审/F 取证会话另计（同 M4 先例分账）。

## 5. 威胁边界

1. **lz oracle check-2 环境性假阴性**：密封命令 `node --test test/` 在 Node ≥22 位置参数 glob 语义下对目录参数恒 MODULE_NOT_FOUND（两臂同损）；同仓裸跑与 glob 形式实测 662/662 绿——lz 腿 oracle 读数应按 check-1（probe）级理解（两臂 12/12 过）。质量门结论对此稳健（即便按 probe 反事实 18=18 平局，判据 6 仍不满足）。密封判据不可改；**重封存改 glob 形式=0.5.0 输入**。
2. harness 跨 4 代演化（resume-skip/metering 回退/failNote/force-seq/106a540），语义面未变、oracleJudge 代次可辨、harnessChanges 全落账。
3. metering 7 行 absent（超时击杀后无可结算请求）；子账本与引擎最终结算存在已知口径差（M2 计量缝）。
4. 小样本（每任务 3 trial）：不宣称任何总体错误率为零。
5. 受控消融 LZY_ABLATE_HUMAN_GATE=1 为评估语境专用，生产人权门语义不变。
6. zpigeon-ios HEAD 漂移复核落档（78699fc 可达），物化仍锚清单钉值 08ebd3ea。

## 6. M4 九条输入对表（R5）

| 输入 | 处置 | 承接 |
|---|---|---|
| 1 套件 hint 语义代理 | M5 不做锁文件/必需 CI 硬判据，维持 M4 威胁边界口径 | 本文 §5 如实转录 |
| 2 cpSync 物化面复核 | containment+verbatimSymlinks | N4（134f142） |
| 3 计量缝复核 | 真运行逐会话子账本读数复证（29/36 metered） | N9 |
| 4 三专项推导成本预估 | 不新增队列/交付编排，不适用 | —（如实） |
| 5 声明面摩擦 | guide「范围声明过审模式清单」双语配方 | N11（9110a00） |
| 6 批量 close | 不实现（拍板 11 延续），逐条 close 可用 | —（如实） |
| 7 结构三轴恒真 | 真身份漂移注入+逐轴判定 | N1（4bafa9e） |
| 8 注入写越界 | containment 根解 | N4（134f142） |
| 9 验证面自动化三条 | 9①② 检查器+CI docs job+harness 出口；9③ env 轴 | N3（de62d82）/N2（ef7a8ad） |

## 7. V 矩阵 M5 六行对表

| ID | M5 表面与读数 |
|---|---|
| V02 | qa migration-recovery：残缺 v2 fail-closed 拒、act 副作用计数零重放、假 gh 计数零增；N4 越界注入 clean 拒 |
| V09 | N7 点名：unified-gate 跨入口三缝（queue dispatch done/reconcile 追认/delivery beginAct）+delivery-gate 三拒全绿 |
| V10 | ci-binding 两例（gh 缺席 blocked/origin 非 GitHub 拒）；三仓 CI verdicts 落档（两仓 local-verified-only 不伪装） |
| V11 | delivery-drift（head-base 漂移拒/超时 unknown→readback/幂等）；done 意图再 act 拒（N5） |
| V13 | 三分支=续旧 v1 带版本标记/新注册 v2 策略身份/残缺 v2 拒；STATE_VERSION 0.4.0 |
| V14 | 18 对完整可追溯（journal 链+完整性门活体）；调参与评价分开；失败成本全入账；预注册质量判据=不满足如实判决（专报） |

## 8. 0.5.0 输入清单

1. **密封 oracle 重封存**：lz check-2 命令改 glob 形式（Node ≥22 语义）；重封存走独立子代理（sealedBy 先例），重锚=评估集新版次。
2. **finish 门 headless 降阶满足路径**：评估实证新臂 0/18 宣称 done（19 次门拦中 12 次为交付已正确后的保守拦）——义务在无人值守语境的部分满足语义待设计（ADR 级拍板）。
3. **lz 腿评估设计复核**：30 分预算 × 自宿主任务对新臂过紧（0/6 完成 vs 旧臂 6/6 宣称）；预算分级或任务瘦身二选一。
4. **gate 阈值复议素材**：≥2/3 与「一项严格改善」在平局+零假完成形态下的解释（本批=正确交付平、假完成 0=0、成本新臂低 43%）。
5. **oracle 判定器代次治理**：oracleJudge 标记+--rejudge-oracle 通道经验沉淀进 evaluation README（仪面修复不重烧会话的既定通道）。

## 9. 文档与决策收口

- AGENTS §2 增 M5 行（M0–M3 从句压缩腾位，≤12KiB 保持）；history.md 增编年行；CHANGELOG [0.4.0] 定版节已含 M5 三条 Added 三条 Changed（N11 落，本次核验一致）；guide 双语 M5 面（migration 0.4.0 相位续跑/评估报告指针/范围声明配方）已落（N11），终对表=报告指针双向在档。
- **无新拍板**：不立 #42/ADR-0034——R6 冻结身份 vs 仪面的澄清以计划收口节为载体（治理文本已修订），oracle 判定器语义属仪面内部实现（harnessChanges 账）；无难逆且无背景会费解的新取舍。
- 对照与 finish attestation 于收口提交落账（Lzy-Attestation 头绑 finish 树）。
