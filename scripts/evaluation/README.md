# scripts/evaluation/ — M0 冻结清单与评估执行家法

0.4.0 M0（goal v040-m0-capability）起立。本目录承载评估面工具：冻结清单格式、
配对执行 `run-pairs.mjs`（M5 已落地；用法见 `--help`：预飞→batch 冻结→按 seed 交错序
执行→完整性 report）、独立判定与归因报告。**本目录不是产品授权写者**
（docs/plan-v040-engineering-policy.md §7 模块表）——清单记录事实与判据身份，
不构成任何 goal 的完成权威。

## 冻结清单格式（manifests/*.json）

- `schemaVersion: 1`；每仓一份 `m0-freeze-<repo>.json` + 汇总索引 `m0-freeze-index.json`。
- 字段族：`repo` / `frozenHeadSha`（盘点时点钉值，仓库后移不回改）/ `frozenAt` /
  `environment`（工具版本矩阵）/ `ci`（workflow 在场性 + 远端 run 现实 + `deliveryCap`）/
  `devSet`（开发集任务映射，全部源自已知事故与旧消融/试点材料，带出处指针）/
  `evalSet`（独立子代理封存，本目录只录 sha256 与覆盖类别，**封存内容不读**）/
  `budget`（每次运行预注册上限）/ `notes`。
- `deliveryCap` 语义（§6 延续）：`mergeable`=有真实对应 CI 且必需检查可核；
  `local-verified-only`=无远端 CI 时只报本地已验证候选，不得报可合并变更。
  缺 CI 不是伪装理由——M5 前须准备真实对应 CI，或如实按本地口径评估。

## 封存纪律（独立性）

- 评估集任务、缺陷注入配方与 oracle 判据由**独立子代理会话**产出并封存至
  `artifacts/v040/M0/evalsets/`（gitignore）；宿主只收覆盖类别 + 文件数 + sha256。
- 封存内容一经实现方（策略调参侧）读取，该批独立性作废（§9.1）；重评须重新封存
  未用于调参的新评估集，不覆盖旧失败记录。
- 旧已见缺陷（devSet 所列）不得包装成评估集任务。

## 运行序规则（M5 消费）

- 预注册交错序：`seed = 20260927`；`run-pairs.mjs` 以 seed 派生确定性交错序列
  （arm ∈ {old,new} × task × trial），执行前整批序列冻结进 batch manifest；
  无 RNG、可重放（同 scripts/ablation/run-batch.mjs 预注册 cells 家法）。
- 每对固定模型/引擎/工具/任务/输入/CI 要求与相同预算；失败/中断全入账，
  换失效配对须整对重跑并记录原因与全部成本。
