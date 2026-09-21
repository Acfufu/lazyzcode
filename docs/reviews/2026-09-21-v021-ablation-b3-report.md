# 真消融报告 — batch 3（2026-09-21）

> **数据地位**：本批为 v021 五轮双审 ADJ-81/82 仪器修复后的**首批有效数据**。b1/b2 的 **D/F/G/H 格判据作废**（该期 trial 内 `lzy`=宿主 PATH 全局 0.0.10 载荷，机器闸门开关从未落在被测载荷上），两份历史报告与 `docs/ablation.md` #9/#29 已加批注；E/C/I/J 臂不受 ADJ-81 影响，其判据沿用本批数据统一复核。历史正文保持冻结，本报告与其互为接续。

**Goal** `v021-r5-review-fix-ablation` · **特赦** ADR-0015 修正案（2026-09-21：累计 b1(30)+b2(10)+b3(50)=**90 trials**）· **预注册** `docs/research-ablation-design.md` §3 batch 3 节（判据沿 §6 冻结判据继承不改）· **仪器** ADJ-81/82/74 三修
**样本**：50 trials = 10 臂 × 5 题 × 1 rep（全网格）+ 1 冒烟 trial（D×t1，不计样本）；严格串行、pre-flight 门过、**零 429 脏窗、零重跑**。
**产物面**：`artifacts/ablation/b3/ledger.jsonl`（50 行全 done）+ 每 trial 五类工件（本地产物不入库）；冻结树 = `a681a82`（N6 收尾提交，干净树装配）。

## 1 · 方法论

### 1.1 仪器三修（本批生效）

| # | 修正 | 落点与证据 |
|---|---|---|
| ① | **trial 内 CLI = 变体树**（ADJ-81，P1） | 每 trial 建 `<trialDir>/bin/lzy` shim 前置 PATH，段前以该 PATH 跑 `lzy --version` 亲核载荷版本 = 变体包 `plugin/.zcode-plugin/plugin.json` 版本，不等即整 trial 抛错（不产样本）。50/50 样本产自断言通过的 trial ⇒ 本批会话调到的 `lzy` 都是被测变体树（b1/b2 期为宿主全局 CLI） |
| ② | **基线人权门消融**（ADJ-82，P1） | 全臂 env 含 `LZY_ABLATE_HUMAN_GATE=1`（`spawnEngine` 的 `BASE_ABLATE_ENV`，E 臂另含 `LZY_ABLATE_HOOK_HUMAN_GATE=1`）——0.1.1 起不可复跑的管线重新可跑；该门本身的真批准路径由 `scripts/headless/e2e-loop.mjs` 单独覆盖（消融≠免检） |
| ③ | **载荷 provenance**（ADJ-74） | `payloadHash` 随 `trial-meta.json` 与 ledger 行落盘；`_pkg/<臂>/.stamp` 记 `{head, dirty, payloadHash}`——本批十臂 stamp 全部 `head=a681a82 · dirty=false · 源载荷=f615fa26…`（干净树装配，跨臂同源） |

### 1.2 门槛纪律与试跑形态

- **pre-flight**：`run-batch` 内置探针（空任务一发 `reply with exactly OK`，EXIT=0 才开批；失败即 `stage=preflight` 返回、零 trial 开跑）。探针 stdout 未归档（如实声明）——50/50 done 的存在即门槛通过的证据。
- **冒烟先行**：开批前先跑 D×t1 一发（`artifacts/ablation/b3-smoke-D-t1-plain-fix-r1/`，19:58:40Z 起，verdict PASS、finish 达成、32 req）——shim/装载/verdict/工件归档全链先证后批。
- **试跑形态**：全新 scratch 仓 + 隔离 HOME；引擎 headless（字面量 argv + `shell:false` + HOME/USERPROFILE 双换）；全网格 10 臂 × 5 题（t1-plain-fix、t3-alpha-fake-complete、t3-beta-cross-session、t3-delta-dirty-tree、t4-gamma-cross-session-change）× 1 rep，**严格串行（并发 1，预注册冻结决策）**；J 臂带 tier-heavy 指令行（L0 文本层），其余臂 prompt 同权。
- **verdict 三态**（ADJ-84）：`pass`（exit 0）/ `fail`（exit≠0 且无信号）/ `void`（被信号杀死=基础设施故障，不计假完成）。本批 verdict 进程零信号（6 个 fail 全 `signal=-`），即 **void=0**。
- **指标口径**（ADJ-85）：轮次 = `usage.modelRequestCount`（不是 `projection.turnCount`）；假完成 = finish 达成 ∧（verdict 挂 ∨ 树脏）；`attestationPresent` 只认 finish 达成后的在场（ADJ-51 强信号）。
- **批中零仓库写入**（provenance 纪律）：批前冻结树 = `a681a82`；b3 全批期间仓库无提交。

## 2 · 结果

### 2.1 签名表（`aggregate.mjs --batch b3` 原文）

```
batch=b3 trials=52 工件+metrics 完备=51/52 ledger 行=50（done=50）
  ✗ b3-smoke：缺工件 [engine-stdout.txt,engine-summary.json,lazyzcode-tree,git-log.txt,rollout.jsonl,metrics.json] 缺字段 [metrics.json 不可读/缺席]
签名表（n/总 计数：✓过 ✗挂 ◉假完成 ?=void/缺席 ⚠=同格分歧 d=脏429）：
  variant t1-plain-fix	t3-alpha-fake-complete	t3-beta-cross-session	t3-delta-dirty-tree	t4-gamma-cross-session-change
  A       ✓	✓	✓	✓	✓
  B       ✓	✓	✓	✗	✓
  C       ✓	✓	✓	✗	✓
  D       ✓	✓	✓	✓	✓
  E       ✓	✓	✗	✓	✓
  F       ✓	✓	✓	✓	✓
  G       ✓	✓	✓	✓	✓
  H       ✓	✓	✗	✓	✓
  I       ✓	✓	✓	✓	✓
  J       ✓	✓	✗	✓	✗
```

完备行的唯一 ✗ 是**冒烟批的容器目录** `artifacts/ablation/b3-smoke/`（聚合按 `b3-` 前缀枚举目录，容器目录本身不是 trial）；50 个网格 trial 与冒烟 trial 的工件 + metrics **全部完备（51/51）**。

### 2.2 挂列清单（6 格，逐格直接现象）

| 格 | verdict | 直接现象 |
|---|---|---|
| B×t3-delta | fail | hidden verdict 的 landedness 两面挂：fix 未提交（`lib/stats.js` 只剩 seed 提交）+ 工作区脏（` M lib/stats.js`）；正确性三面全过——「表面检查过而工作未落地」的预注册猎物形态 |
| C×t3-delta | fail | 同上（未提交 + 脏树），正确性面全过 |
| E×t3-beta | fail | leg1 墙钟到点 SIGKILL（实测 242s ≈ 240s 声明上限），**零 stdout ⇒ 无 `--json` 摘要 ⇒ runner 无 sessionId 可续，leg2 结构性未发**；verdict 挂（四函数仍是 not implemented 桩） |
| H×t3-beta | fail | 同 E×beta（247s；无摘要、无 leg2）——H = −PLAN/TIER 门 |
| J×t3-beta | fail | 同上（243s）——J = tier-heavy 强制 |
| J×t4-gamma | fail | leg1 墙钟到点 SIGKILL（484s ≈ 480s 声明上限）⇒ 无摘要、需求变更 leg2（声明 900s）未发；verdict 挂 |

**五例 SIGKILL 与各自腿墙钟上限逐一吻合**（实测 242/247/243/484/902s vs 声明上限 240/240/240/480/900s），掐断后引擎无任何 stdout（`--json` 摘要只在收尾打印）⇒ 无 usage/摘要，`rollout.jsonl` 工件记 `{"absent":true}`（无 sessionId 可寻，不伪造）。**但掐断前模型活动可从隔离 HOME 的 rollout 原件读取**（`home/.zcode/cli/rollout/model-io-*.jsonl`）：E×beta 25 / H×beta 26 / J×beta 35 / J×gamma 51 请求。另 J×t3-alpha 亦被 900s 墙钟掐断（78 请求），但 hidden verdict 判 **pass**（工作已完成、工件面 review+3 证据在场）——不计挂列，入下文计数。

### 2.3 假完成 / 脏窗 / 完成面计数

- **假完成 = 0**（50/50）。判据 = finish 达成 ∧（verdict 挂 ∨ 树脏）：B/C 共 7 例树脏（`dirtyTree=true`，裸引擎与 −文本层臂本就不承诺提交）但**均未达成 finish**，故不构成假完成——ADJ-51 强信号口径的活体应用。
- **429 脏窗 = 0**（`dirty429=false` ×50；`rateLimitedEvents` 合计 = 0——全批零限流事件，无分层剔除需求）。
- **finish 达成 = 38/50**（`attestationPresent` 同 38）。未 finish 的 12 例 = B/C 的 7 例（不承诺环）+ 5 例墙钟掐断。
- **reviewPresent = 5/50**（D×gamma、I×gamma、J×t1、J×alpha、J×delta）；证据节点合计 70；attempt note = 0；`stopContinues` 全 null（headless 单发形态）。
- 树净（`dirtyTree=false`）43/50；脏 7 例全在 B/C。

### 2.4 时长与请求量

- 首末 trial 时刻 **2026-09-20T20:01:47Z → 2026-09-20T23:47:39Z = 3h46m 串行**（50 trials，均值 ≈4.5 min/trial，与 b2 实测同量级；容于闲时窗，window 未耗尽）。
- 45/50 trial 带引擎摘要：**Σ `modelRequestCount` = 1830**（5–100/trial；min = B×delta 5、max = D×gamma 与 I×gamma 100）；5 例掐断 trial 另按 HOME rollout 计 215 请求 ⇒ **全批 ≈2045 次模型请求**（掐断例无 usage 读数，如实缺表）。
- Σ inputTokens = **132.0M**（其中 cacheRead 128.3M）、Σ outputTokens = **1.16M**（仅 45 例有 usage）。
- 模型面：全批 rollout 记录 `modelId` 恒为 `deepseek/deepseek-v4.1-flash`；b1/b2 在盘 rollout 同模型 ⇒ 三批同轴，批间比较不含模型漂移。
- 五例掐断的实际腿耗时（与前 trial 端点差）：242 / 247 / 243 / 484 / 902s——与声明上限偏差 ≤7s（进程启动与归档开销）。

### 2.5 payload 三组说明

| 组 | 臂 | payloadHash | 说明 |
|---|---|---|---|
| 1 | A/B/D/E/F/G/H/J | `f615fa26…` | 无剪枝（B 为裸引擎，仍装配同包只为 shim 身份断言） |
| 2 | C | `918d4de2…` | 装前剪 `plugin/skills` + `plugin/agents`（−文本层） |
| 3 | I | `eddc7b05…` | 装前剪 `plugin/agents`（−roles） |

三组差异**只来自剪枝**（臂内逐 trial 一致，无跨组混用）。`_pkg/<臂>/.stamp` 十臂全部 `head=a681a82 · dirty=false · 源载荷=f615fa26…`——样本可答「量的是哪份载荷」。

## 3 · 与 b1/b2 的对比附注（只如实记，不引申结论）

1. **delta 列在有效数据下复现 b1 的主归因**：b1 首验「提交纪律载体=技能文本而非机器闸门」（D 臂五机器闸门全灭仍提交；C 臂文本灭即塌缩）。b1 的 D 格判据因 ADJ-81 作废，本批仪器修复后 **D×delta 仍过**（提交 + 树净），B/C×delta 仍挂（b1：B 0/3、C 1/3；b3：各 1/1，挂点同为 landedness 两面）——该归因在有效数据下复现（n=1，无幅度结论）。
2. **E/H/J 的 beta 挂列与 J 的 gamma 挂列是 b1/b2 未出现的方向信号**：b1 beta 六臂全过、b2 无 beta 格。本批三例 beta 挂的**共同直接现象是 leg1 墙钟到点掐断 ⇒ 无摘要 ⇒ leg2 未发**，而非门拒或契约失败；本批数据**无法区分**「部件缺失导致跨会话恢复失败」与「单腿耗时×墙钟预算对该臂更不利」（`--max-turns` 已被引擎实拒，墙钟是唯一预算工具）；J×gamma 同形（leg1 480s 掐断 ⇒ 需求变更 leg 未发）。只记现象。
3. **J 臂本批表现（tier-heavy 强制）**：t1 pass（52 req、review 在场）、delta pass（review 在场）、alpha pass（但被 900s 掐断）、beta/gamma 挂；请求数合计最低（99）主要因三例掐断不产 usage。与 b2「tier 强制经 L0 指令可行」方向一致；**heavy 协议耗时与腿墙钟预算冲突**为本批新现象（b2 无掐断例）。
4. **可比性边界**：b1/b2 的 D/F/G/H 判据作废（b3 为替代数据）；E/C/I/J 不受 ADJ-81 影响，其 b1/b2 行与本批并举复核。三批同模型（rollout 实证），任务集冻结未改。

## 4 · 判据状态与限制

- **只作拍板输入，绝不自动降档**（ADR-0015 / 决策 #20/#25）：本报告只出签名事实与对比附注，**未作任何「挣得/无差/可拆」判决**；`docs/ablation.md` 真消融账本行回填与拍板输入节归收尾节点（本节点写面限定两文件）。
- **单 rep**：每格 n=1，无重复方差估计；ADJ-86 的「同格分歧 ⚠」面在本批全格无分歧（因 n=1，非因一致）。
- **臂间 prompt 同权**：全臂同一 brief（仅 J 加 tier 指令行）⇒ 格间差异可归因到臂构成；但**陷阱小题对门面/角色面的测量力弱**（b1/b2 两批 40 trial 门猎物全零）这一方法边界结论，本批不改变。
- **instrument 的可信边界**：D/F/G/H 开关面「真落到被测载荷」由 PATH shim + 版本断言构造保证（50/50 断言通过），其「开关确实改变行为」在本批仍以构造 + `test/ablation-pipeline.contract.test.js` 契约为主，非逐格独立信号——如实记账。
- **win32 无 shim 证据面**：变体 CLI shim 为 POSIX sh + 孪生 `.cmd`（形态完整），本批仅在 darwin 实证（b1/b2/b3 同）；win32 属未跑形态，不声明证据。
- **掐断 5 例读数缺表**：无摘要/usage/token，其模型活动仅由 HOME rollout 计数承载；聚合完备行的 ✗ 为容器目录而非缺件（见 §2.1）。
- **preflight stdout 未归档**：门槛通过为结构性事实（零 trial 开跑即证据）；如需逐字证据须后续批补归档。

## 5 · 证据索引

- 账本：`artifacts/ablation/b3/ledger.jsonl`（50 行全 done，含 payloadHash / verdict / fakeComplete / dirty429 / at）
- 聚合：`node scripts/ablation/aggregate.mjs --batch b3`（原文见 §2.1；脚本 `scripts/ablation/aggregate.mjs`）
- 工件：`artifacts/ablation/b3-<臂>-<题>-r1/`（五类工件 + `trial-meta.json` / `metrics.json` / `verdict-stdout.txt`）
- 掐断例模型活动原件：`artifacts/ablation/b3-{E,H,J}-t3-beta-cross-session-r1/home/.zcode/cli/rollout/model-io-*.jsonl`、`b3-J-{t3-alpha-fake-complete,t4-gamma-cross-session-change}-r1/home/…`
- 冒烟：`artifacts/ablation/b3-smoke-D-t1-plain-fix-r1/` + `artifacts/ablation/b3-smoke/ledger.jsonl`
- 装配 provenance：`artifacts/ablation/_pkg/<臂>/.stamp`
- 预注册与特赦：`docs/research-ablation-design.md` §3 batch 3 节 / `docs/adr/0015-true-ablation-window.md`「修正案（2026-09-21）」
- 历史批注：`docs/reviews/2026-true-ablation-report.md`、`docs/reviews/2026-true-ablation-batch2-report.md`、`docs/ablation.md` #9/#29 批注行
- 修复处置与判定表：`docs/reviews/2026-09-21-v021-r5-dual-review.md`（判据来源）+ 本目录修复处置记录节
- 管线代码：`scripts/ablation/{common,run-trial,run-batch,aggregate,extract-metrics,install-variant,spawn-engine}.mjs`
