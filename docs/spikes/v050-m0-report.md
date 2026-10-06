# 0.5.0 M0 报告——基线与仪器可信

goal `v050-m0-instrument`（HEAVY）· 2026-10-06 · 计划快照 sha256 8491bea6cf…（评审：plan-reviewer PASS，must-fix 无）。弧定位：0.5.0＝决策 #42 重评兑现版（ADR-0034），完整弧 M0→M4 的第一棒；依据 `docs/plan-v050-closure-and-evaluation.md` §4/§6 与 debts A 线（A1/A5 本棒消费；A2/A3/A4 属 M1/M2 拍板件不在本棒）。

## 逐项判定

| 项 | 判定 | 证据指针 |
|---|---|---|
| N1 资格判定 | **成立** | `qualificationGate`（scripts/evaluation/run-pairs.mjs）：六类拒因＋冻结面三要素；commit 885a899 |
| N2 报告完整合取＋反例绑定 | **成立** | writeReport 资格先于质量门（stage=evaluation-qualification 可判别）；`keyCounterexampleIds` 冻结进 batch；反例逐项判读入 report.counterexamples；门槛=⌈2/3×预注册 trial 数⌉ |
| N3 异议书哈希绑定 | **成立** | runReview 复判路径三类前置拒（缺席/漂移/超长）带重交指路；全文下传消 TOCTOU；commit 9a713ff |
| N4 历史报告勘误 | **成立** | v040-policy-evaluation.md §2 判据 6 矛盾三条订正，8 行纯追加 0 删改；commit c88266a |
| N5 A1 oracle 重封存 | **成立（重锚半随 M2）** | 独立子代理通道：oracle-v3 六件（lz 两件单行 glob 改写、四件逐字节同密封）；canary 正例 exit 0/负例 exit 1；sealedUntouchedVerified=true；新 MANIFEST sha256 ec79c4ab8323 · 密封区 fa6adba9b908 前后一致 |
| N6 A5 README 沉淀 | **成立** | 判读代次/重判通道/两层判定/独立性规则四要点；commit 23c0209 |
| N7 本报告 | **成立** | 本文件 |
| F1 资格判定活体 | **过** | 红 n738（改前 worktree 28d5bc2，十案例 0/10）→ 绿十案例 10/10 exit 0；契约 21/21（新增 evaluation-qualification 12 用例） |
| F2 文书绑定活体 | **过** | 红 n740（四类篡改 NOT-REFUSED）→ 绿四类逐类前置拒＋对照 valid；契约 24/24（新增 grounds 绑定 5 用例） |
| F3 勘误终验 | **过** | 红 n741（锚点 grep 0）→ 绿锚点 :87 在场＋diff 8 行纯追加 0 删改 |
| F4 oracle 重封存终验 | **过** | 红 n739（产物全缺席）→ 绿宿主侧 8/8 机械对账（generation/canary 双向 exit/封存未动/逐文件 sha/改写面） |
| F5 README 沉淀终验 | **过** | 红 n742（四要点 grep 0）→ 绿逐条在场＋diff 22 行纯追加 |
| F6 回归终验 | 见下节（终树采集后执行） | npm test 全绿（安静环境口径）＋spawn flake 家族说明 |

## 已知未知段处置（计划三条）

1. **A1 独立通道可转换性**——证伪未触发：子代理完成 glob 形转换＋canary 双向正确，无阻塞。
2. **六类形态可构造性**——证伪未触发：全部从现有 journal/report 数据形态构造（重复 trial 经行面同格双行＋冻结面重复格位双查）。
3. **§2 外无其他实质矛盾**——证伪未触发：N4 全文复核未见新增实质矛盾（矛盾集中于 §2 判据 6 一处）。

## 失败即数据（过程如实记录）

- F1 探针初版含三处断言缺陷（④突变 no-op、⑦谓词措辞、⑧期望形态混淆）——修正后经 HEAD 28d5bc2 临时 worktree **重采红半**（n738 取代 n736；n737 为脏树指纹误绑的外部面重录中间态）；红绿同 harness 字符串（278701c2）。
- npm test 基线首跑（816s，机器高负载）741/760，19 败全为 spawn 夹具负载 flake（goal.json ENOENT/git 不可用族）；同日安静环境单文件复跑同 8 文件 109/109 绿（94s）。基线口径＝安静环境 760 全绿；F6 按同口径执行。
- N5 子代理过程性脚本错误一例（canary 脚本 ESM env 误当全局绑定），修正后重跑通过，未影响落盘物（子代理回报如实入账）。

## 边界遵守与实耗

- **零付费引擎会话（主题面）**：本 goal 全部取证为直调导出函数/runReview stub 引擎/CLI 场景/机械回执，未运行任何真实付费引擎会话；finish 环节的职责评审为目标纪律的统一门义务（lzy 自身执法面），非主题面引擎消耗。
- **旧批零触碰**：m5eval-20260929013548 记录与 journal 链未动（F4 封存区 sha 前后一致佐证）。
- 子代理两枚（plan-reviewer 47 万 tokens 级 / A1 重封存 92 万 tokens 级，均非引擎会话）。
- 测试基线 760 → 本棒新增 17 用例（12 资格＋5 绑定），F6 目标=777 全绿。

## 工件哈希索引（本地 artifacts/，gitignore；证据副本在 .lazyzcode/evidence/）

| 工件 | sha256 前 12 |
|---|---|
| artifacts/v050/m0-plan.md（计划快照同文） | 8491bea6cf（快照账本值） |
| artifacts/v050/probe-f1.mjs / probe-f2.mjs | 见 evidence 附件 |
| artifacts/v050/f1-red2.log / f1-green.log | bf6e53e1f8… / e11cb0f349… |
| artifacts/v050/f2-red.log / f2-green.log | 6c6dba4524… / 7c6b8a0388… |
| artifacts/v050/f3-green.log / f5-green.log | d3c4b983699… / 07cb9a725d… |
| artifacts/v050/oracle-v3/MANIFEST.json | ec79c4ab8323 |
| 密封区 MANIFEST.json（未动） | fa6adba9b908 |

## 对 M1 的输入清单

1. **19 次 gate 拒绝归因**（A2 前置）：底稿=v040 报告 §2 判据 7 与 §9；本棒资格判定/勘误已把评估面噪音清出，归因可聚焦义务面。
2. **计量/provider 增量收口**：候选件在 `wip-v050-metering-provider` 分支（领先本棒基线 1 提交，772/772 绿）；收口条件清单=plan-v050 §4 第三枚 P0 节（fail-closed 兼容路径/未计价不渲染零成本/去重恢复/宿主库缺席可达性/预算跨轮累计）。
3. **A2 语义 ADR 草案**（拍板件）：finish 门 headless 降阶满足语义——「部分满足」与 LOOP_COMPLETE 的区别边界（不写完成、不授权合并/部署、不绕 B/C 与发现门）。
4. **A3/A4 拍板件**：新评估集预算分级 vs 任务瘦身；gate 阈值（≥2/3·严格改善）平局形态解释。
5. **评估集重锚**：M2 冻结新集时以 oracle-v3 代次为判读基线（MANIFEST 在案）。
