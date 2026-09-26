# v040-m0 能力探针与冻结报告

goal `v040-m0-capability`（0.4.0 M0 能力与实验预注册）· 2026-09-27 · 零产品代码改动。
依据 docs/plan-v040-engineering-policy.md §8 M0 行与 §8.1 capability 案例；计划
`.lazyzcode/plans/v040-m0-capability.md`（快照 c01240a0，评审两轮 PASS）。
探针工具 `scripts/v040/qa.mjs`（capability / capability-meter 双案例）；冻结清单
`scripts/evaluation/`。本报告数=开发跑累计；终验跑（F1–F3 取证，冻结树上）以
`artifacts/v040/M0/capability/result-capability.json` 为准。

## 1. 四能力判定表

| # | 能力 | 判定 | 证据 |
| --- | --- | --- | --- |
| 1 | 独立会话（隔离 HOME 可启动、凭据非 HOME 绑定） | **成立** | ISO-A1/B1：spawnHeadless(home=隔离夹具) 完成且事实标记入答 |
| 2 | 读取轨迹可核验（已知未知#1） | **成立（证伪成功）** | ISO-A2/A3、B2/B3：转录落**隔离 HOME** `.zcode/cli/rollout/model-io-<sid>.jsonl`（真实 HOME 零同 sid 文件），含 `file_path` 工具读取记录且必要事实文件被读取 |
| 3 | 首轮结论隔离（canary 泄露检测） | **成立** | ISO-A4/B4：对方 canary 零入 prompt/轨迹/输出；NEG-1 负对照（毒化输入）检测器命中（红半在案） |
| 4 | 逐 sessionId 计量归因 | **成立（在账本落点）** | MET-1/MET-2：子账本读数 0.0423/0.0408 积分非零、二次读数恒等；**宿主侧结构性盲区**见 §2 发现一 |
| 5 | 超时/重启诚实恢复 | **成立** | KILL-1/2/3/4：转录在场后 SIGKILL；子账本只反映已完成请求（run1=纯在途 absent 形态、run2=partial 0.0217 已完成行，两形态各实证）；`--resume` 同 sessionId 续跑并入计量（0.0435）；前后清单零 PASS/attestation 形态产物 |

隔离/计量/恢复三出口全部成立，无 M0 级阻塞；发现一为 M2 执行器契约的设计输入（非阻塞）。

## 2. 真发现（M1/M2 设计输入）

### 发现一：HOME 隔离连计费账本一起隔离（宿主侧归因结构性失明）

每个隔离 HOME 会话自生长完整计费库 `<home>/.zcode/cli/db/db.sqlite`（实测 421KB/库），
宿主库对探针 sid **零行**。`querySessionPoints` 钉死宿主 `billingDbPath()`
（core/cost.js:255-258），故 0.3.1 落地的逐段归因面对隔离会话**恒 metering-absent**。
影响面：M2 受控评审执行器若以 home 隔离换取结论隔离（本报告证明隔离有效且必要），
则「评审成本不另开免费预算」（§4.1）在宿主账本口径下不可见。

**解法（M2 落地，M0 不改产品）**：执行器按子账本路径计量——`queryHostDb(db, sessionSql)`
+ `computePoints`（均已有导出面，qa.mjs 已实证同形 SQL 可指路子账本）；或 M2 内产品化
参数化 `querySessionPoints(sessionId, dbPath)`。两者都不动隔离面。

### 发现二：killed-inflight 假零的双形态

击杀时点决定子账本形态：纯在途击杀=absent（run1）；首请求完成后击杀=partial（run2，
0.0217 已完成行如实入账）。两种都是「账本只反映击杀前已完成请求」的诚实读回——
预算账本的 killed-inflight 申报语义（0.3.1 #32 家法）覆盖两形态，不需要新机制。

## 3. 探针预算对账（预注册 ≤8，超注如实）

| 跑 | 会话数 | 用途 | 积分（子账本口径） |
| --- | --- | --- | --- |
| run1（qa.mjs v1） | 5 | 隔离×2+负对照+击杀+续跑；产出宿主盲区发现、result.json 被复跑覆写（工具缺陷） | ≈0.17 |
| capability-meter | 0 | 对 run1 会话零会话复读；计量正判首证 | 0 |
| run2（双边读数版） | 5 | 隔离×2+负对照+击杀+续跑全绿（KILL-2 谓词语义修正待终验） | ≈0.17 |
| 终验跑（F 取证） | 5（计划） | 冻结树上最终 harness 一跑定音 | 终验时入账 |
| **累计** | **10（+终验 5）** | 预注册 ≤8 为单案例探针预算；**超注成因**=工具缺陷（result 覆写→按案例命名修复）+计量面重设计+谓词语义修正，失败即数据 | 开发跑 ≈0.34 |

侦察/计划评审子代理（explorer/plan-reviewer/封存员）消耗按宿主账本另行可见，
不属探针预注册口径。

## 4. 冻结清单（scripts/evaluation/manifests/）

- 三仓冻结 HEAD（盘点时点钉值，`frozenAt` 2026-09-27T03:20+08:00）：
  lazyzcode `54cb376`（本仓）· openchamber `63bd5070c`（release v2.0.1）·
  zpigeon-ios `08ebd3ea`（**当日仍被其他会话推进**：晨观测 2981358→冻结时 08ebd3ea，
  M5 执行前须复核重冻结）。
- CI 现实（只读 gh 实查）：lazyzcode=real（ci.yml 最近 run success@94a46df，
  deliveryCap=mergeable）；openchamber=fork-without-runs（工作流 17 件在场但主链
  oc-integration/release/mobile-ci/opencode 在 fork 零运行，deliveryCap=local-verified-only）；
  zpigeon-ios=none（workflow 0 件、Actions 运行总数 0，deliveryCap=local-verified-only）。
  两仓 M5 前须准备真实对应 CI，或全程按 §6 本地候选口径——不伪装。
- 开发集任务映射（每仓 3 项，全部已知事故/试点材料，带出处指针）入各仓清单。
- 评估集：独立子代理会话封存至 artifacts/v040/M0/evalsets/（6 任务：3 仓×2），
  覆盖类别+文件数+MANIFEST sha256 录入 `m0-freeze-index.json`；封存内容实现方不读
  （泄露即作废该批独立性，§9.1）。旧已见缺陷排除表已下达封存员（scrollbar 映射、
  workspace 卡片、--workers 0、授权账本互覆、回执绑定、交付谓词六族）。
- 运行序规则：seed=20260927 确定性交错序，M5 `run-pairs.mjs` 消费（README §运行序）。

## 5. 失败即数据（过程账）

1. run1 后 result.json 被 capability-meter 复跑覆写（断言表只剩控制台转录）——修复为
   按案例命名 `result-<case>.json`；首跑工件迁 capability-run1/ 保留。
2. KILL-2 谓词误钉 absent 单形态（run2 partial 形态暴露）——修正为 absent/partial 双形态
   同判+假零申报字段入 result（发现二的产出）。
3. 计量腿初版只查宿主库→blocked（M0 出口的诚实形态）——双边读数改造后正判。
