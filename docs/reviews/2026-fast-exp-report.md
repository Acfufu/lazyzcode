# `--fast` 三门槛实验报告（v024-fast-exp，2026-09-23）

roadmap §⑭ `--fast` 多 worktree 并行调度层的预注册三门槛采数（方向性签名，家法 #25）。结论先行：

- **判据①（写型双工人收益）＝灰带交用户终拍**：f1-dual-wave 速度比 0.63×（双工反慢，无收益区）；h3-clean-refactor 1.12×（灰带 1.1–1.3）。无任务达 1.3× 收益线，也无任务 <1.1× 的全负（h3 落灰带）。
- **判据②（多 provider 双带分流）＝未采（证伪降级）**：N2 探针实证 headless 缺省模型解析不随 personal providerOrder（`Select a model before continuing`），引擎 CLI 无 `--model` 旗标——spawn 期跨带分流本代不可达。记录 `artifacts/ablation/fast-probe/probe-record.md`。
- **判据③（N 工人锁排队窗）＝PASS**：K=8 max 276ms / timeouts 0（预注册线 <1000ms）。锁窗不构成形态约束。

**对 goal B（调度器）的预注册含义**：无任务达收益线 ⇒ 不满足「有收益候选」自动立项条件；h3 落灰带 ⇒ 终拍归用户。数据同时给出一个独立于墙钟的**成本反证**：双工臂模型请求数≈串行 2 倍（下文 §1.3），按计价轴是净亏——倾向保守。

## §1 门槛①：写型双工人受控实测

12 发（2 任务 × 2 臂 serial/dual × 3 rep），全载荷变体 A、LIGHT 缺省、认领制、兄弟 worktree-as-subject。12/12 verdict pass、12/12 finish、假完成 0、主仓零脏树。

### 1.1 对照表（run-fast-pair `--report --batch fast` 原文）

```
f1-dual-wave | serial | n=3 | wallMs med=92172 | verdict pass=3/3 | finish ok=3/3 | supersedes med=0 | mergeRebind med=0 | lock timeouts=0
f1-dual-wave | dual   | n=3 | wallMs med=145981 | verdict pass=3/3 | finish ok=3/3 | supersedes med=1 | mergeRebind med=1 | lock timeouts=0
h3-clean-refactor | serial | n=3 | wallMs med=112651 | verdict pass=3/3 | finish ok=3/3 | supersedes med=0 | mergeRebind med=0 | lock timeouts=0
h3-clean-refactor | dual   | n=3 | wallMs med=100454 | verdict pass=3/3 | finish ok=3/3 | supersedes med=1 | mergeRebind med=1 | lock timeouts=0
```

### 1.2 逐发读数

| trial | 墙钟 s | 工人墙钟 s | turns | supersedes（工人窗） | merge 屏障 rebind | lock max ms |
|---|---|---|---|---|---|---|
| f1 serial r1/r2/r3 | 140.8 / 86.7 / 92.2 | —（单工人） | 23 / 21 / 21 | 0 / 0 / 0 | 0 | 0 |
| f1 dual r1/r2/r3 | 146.0 / 201.2 / 138.2 | 甲 162+乙 181 等 | 38 / 35 等 | 1 / 1 / 1 | 1 / 1 / 1 | 0 |
| h3 serial r1/r2/r3 | 96.8 / 112.7 / 113.5 | — | 23 / 21 / 22 | 0 / 0 / 0 | 0 | 0 |
| h3 dual r1/r2/r3 | 114.1 / 84.8 / 100.5 | — | 20+26 等 | 1 / 1 / 1 | 1 / 1 / 1 | 295 / 0 / 0 |

（逐发全字段见 `artifacts/ablation/fast-ledger.jsonl`；各 trial 目录含 trial-meta-fast.json、双工人 stdout、verdict/finish 原文、merge log。）

### 1.3 判据①落判与效应边界

- **速度比（串行/双工）**：f1 = 92.2/146.0 = **0.63×**；h3 = 112.7/100.5 = **1.12×**。按预注册三态（≥1.3 有收益候选 / 1.1–1.3 灰带 / <1.1 无收益）：f1 落无收益区，h3 落**灰带**。
- **重取证成本＝有限可枚举**：每次 dual run 的级联过期恰好=1 次工人窗口 supersede（双工人对同一 F 项先后取证）+1 次 merge 屏障 rebind（恒在）；merge 本身 96–100ms/次零冲突。级联成本实测**极小**——不是瓶颈。
- **墙钟的诚实结构**：双工墙钟=最宽工人（乙）+组装。f1 上波乙（N3+N4）单独就≈串行全程，双工净亏；h3 上波乙仅 N3（README 步），波甲持 N1+N2 才出现 12% 净省。**收益上限=最宽独立波，且被每工人的 re-orientation 开销（读计划/认领/重取语境，turns 20–38）侵蚀**。
- **成本轴（预注册判据外的诚实观测）**：双工臂 turns≈串行 2 倍（h3：46 vs 22；f1：73 vs 21-23）——即使墙钟小赚（h3 11%），按模型请求数计价也是**净亏**。这与 §⑭ 预注册收益模型「墙钟≈最宽独立波」一致，并补上该模型没写的请求成本项。

**判据①结论：灰带交用户终拍；附成本反证（turns≈2×）。**

## §2 门槛②：多 provider 双带狗粮＝未采（证伪降级）

N2 探针（单发 headless，`ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 重绑为 Commandcode/DeepSeek-only 过滤副本）失败：`Model creation failed` ← cause `Select a model before continuing`（CONFIGURATION_ERROR@model_creation）；归因隔离对照臂（同 harness 不重绑）成功，harness 无罪；引擎 `--help` 实证无 `--model` 旗标（仅会话内 /model）。**根因=headless 缺省模型解析不跟随 personal providerOrder，spawn 期模型钉扎面缺席**。完整记录与两条升格路径：`artifacts/ablation/fast-probe/probe-record.md`。按预注册：②记「仪器备、数据未采」，①③不受影响；paired 2 发不跑。

## §3 门槛③：N 工人锁排队窗＝PASS

`lock-queue-bench.mjs`（budget spend 写面，全程 withLock）：

| K | M | waits | waitMs 合计 | waitMs max | timeouts | spend ok |
|---|---|---|---|---|---|---|
| 2 | 20 | 1 | 52 | 52 | 0 | 40/40 |
| 4 | 20 | 10 | 652 | 109 | 0 | 80/80 |
| 8 | 20 | 59 | 5947 | 276 | 0 | 160/160 |

doctor 锁行原文：`获锁 294 次 · 需等待 71 次 · 等待合计 6702ms · 最长 276ms · 超时 0 次（对照 LOCK_WAIT_MS 5000ms）`。**判据③：K=8 max 276ms <1000ms 且 timeouts=0 → 锁窗不构成 `--workers N` 形态约束**（N 工人同槽写命令在现锁语义下排队安全）。

## §4 对 `--fast` 旗标形态终拍的输入汇总

1. 墙钟：小计划夹具上收益≤灰带（1.12×）且可反转为净亏（0.63×）；收益上限=最宽独立波，随计划变宽才可能打开。
2. 请求成本：双工≈2× turns——计价轴独立否决「小任务也并行」。
3. 级联过期：实测极小（1 次 supersede+1 次屏障 rebind）；锁窗：PASS。这两项**不构成**反对理由。
4. 分流：spawn 期跨带不可达（本代引擎），调度器若立项仅同带多工人。
5. 机器面完备度：runner/认领/worktree-as-subject/merge 组装/屏障重取证全链在 12 发中零机械故障——若终拍继续，底座已验证。

## §5 偏离与事故记账（attempt 注记转录）

1. 「并发上限 1 冻结决策」与「OUT_ROOT 永不设置」两条冻结的偏离/规避：runner 头注 attempt 注记（预注册=本 goal 计划判据节）。
2. 串行臂=同 runner 单链（非 run-trial 路径）：h3/f1 是 plan 形夹具（非 legs.json t 形），runner 内建 serial 臂使两臂夹具/判据/变体逐字段同——比计划文本的「run-trial 现行路径」更严格的同口径。
3. pilot 一发（fastpilot 批）：`taskId` 未定义 bug（修复）；f1 verdict 树检未豁免 `.lazyzcode/`（决策 #14 家法豁免补上）。正式批 12 发零机械故障。
4. h3 夹具变更：plan.md 增 F1+split.json+README 增补节（词表反向核验零命中），delta 在案（docs/ablation.md #34）。

## §6 账本

- docs/ablation.md #34＝并行轴首数据点（本报告为源）。
- roadmap §⑭ 门槛状态行更新：① 有数（0.63×/1.12× 灰带）② 未采（证伪降级）③ 有数 PASS。
