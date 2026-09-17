# 真消融实验预注册（true ablation pre-registration）

状态：**冻结**（2026-09-17，goal true-ablation-full-flow#N1 提交即冻结点） · 特赦文书：`docs/adr/0015-true-ablation-window.md` · 影子/天然账本：`docs/ablation.md`（本实验是其「真消融」形态的第一次落地）

冻结含义：任务集、变体矩阵、逐格判据、指标、预算自本提交起不可静默更改；确须更改时在计划文件对应条目下留 attempt note（第几次、为何弃用、改走何路），并在报告「偏差节」如实记账。

## 1. 研究问题

- RQ1（整体效力）：完整纪律层（A 臂）相对裸引擎基线（B 臂）在陷阱任务集上的完成质量提升，是否值得其轮次/token 开销？
- RQ2（归因）：逐部件消融（C–J 臂）各自贡献什么？哪些部件的缺位不改变任何预注册指标（裁撤/降档候选）？
- RQ3（元问题）：真消融结果与影子账本 #1–#8 的预测偏差多大（影子方法校准）？

## 2. 消融单元与 kill-switch

10 个 env 开关 + 1 个装载面操作，全部默认关。**默认关 = 行为与改动前逐字段同**（契约测试红绿钉，F1 收口）。行号引用为 2026-09-17 wt/wt1 基线，执行时以符号定位为准：

| 开关 | 注入点 | 消融效果 |
|---|---|---|
| `LZY_ABLATE_PLAN_GATE` | core/loop.js `doAdoptPlan` 禁词扫描块（约 :541-556） | 计划含 TBD 族词也可采纳 |
| `LZY_ABLATE_TIER_GATE` | core/loop.js `doAdoptPlan` heavy PASS 门（约 :526-534） | HEAVY 无 PASS 评审也可采纳 |
| `LZY_ABLATE_VERIFY` | core/loop.js `doFinishLoop` stale/unbound 两处拒绝（约 :1040-1057） | 过期/未绑证据不拦 finish。**范围钉死**：`lzy loop verify` 独立报告面不在消融内 |
| `LZY_ABLATE_INTEGRITY` | core/loop.js `doFinishLoop` integrity 循环（约 :1100-1125） | 脏树/缺根不拦 finish（≈0.0.7 形态的一半） |
| `LZY_ABLATE_ATTEST` | core/loop.js `doFinishLoop` comparator attestation 门（约 :1062-1099） | HEAVY finish 无现行 MATCH 证明也放行 |
| `LZY_ABLATE_HOOK_STOP` | plugin/hooks/stop.js try 顶部、`readStdinJson()` 之后（约 :72-74） | Stop 拉回全灭（短路=emit `{}` + exit 0，failOpen 同款） |
| `LZY_ABLATE_HOOK_TRIGGER` | plugin/hooks/trigger.js（约 :27-30） | 触发词注入与 claimedAt 写入全灭 |
| `LZY_ABLATE_HOOK_SESSION_START` | plugin/hooks/session-start.js（约 :12-14） | 循环态广播 CTA 全灭 |
| `LZY_ABLATE_HOOK_TRIPWIRE` | plugin/hooks/tripwire.js（约 :27-29） | 空转绊线全灭 |
| `LZY_ABLATE_HOOK_COMMENT_CHECKER` | plugin/hooks/comment-checker.js（约 :40-42） | 注释巡逻全灭 |
| （装载面）减配 bundle | scripts/ablation/install-variant.mjs：整包树拷贝（排除 `.git/.lazyzcode/node_modules/artifacts/dist`）→剪 `plugin/skills` 与/或 `plugin/agents`→`<scratch>/cli/lzy.js install` 入 trial HOME→引擎 plugins enable | 文本层/角色层物理缺席 |

实现纪律：机器开关在各闸门块前 env 守卫（五处全为 throw-before-write 或只读分类，不破坏状态文件一致性）；钩子开关在 stdin 吃净后短路（防管道悬挂）；**dag.js 不设开关**——账本既是 fail-closed 权威也是指标源。

**红半约定（钉死）**：kill-switch 的红半 = 开关开启态的 fixture 表面捕获。开关态无法先于改动存在，依 ADR-0014「红绿各绑各面」此配对合法；绿半 = 默认关与改动前 fixture 行为一致。

## 3. 变体矩阵

batch 1（冻结，24 trials）：

| 臂 | 构成 | 钓什么 |
|---|---|---|
| A | 全量对照（插件全装、零开关、HEAVY tier） | 基准面 |
| B | 裸引擎（trial HOME 不装插件） | RQ1 基线 |
| C | −文本层（减配 bundle：去 plugin/skills 全部 + plugin/agents/，留 hooks 与 CLI） | zw 技能文本的独占贡献（表达层级之问） |
| D | −机器闸门（五个 `LZY_ABLATE_*` 机器开关全开） | 机器执法层整体贡献 |
| E | −钩子层（五个 `LZY_ABLATE_HOOK_*` 全开） | 拉回/注入/绊线的贡献 |
| F | −完整性内核（仅 `LZY_ABLATE_INTEGRITY`+`LZY_ABLATE_ATTEST`） | 0.0.8 增量的独立贡献（≈0.0.7 形态） |

batch 2（预注册扩展，逐项命中 §6 判据且闲时预算允许才跑）：

- G −VERIFY 单开 ×任务 γ；H −PLAN_GATE+TIER_GATE（过程签名为主，见 §6）；I −roles（减配 bundle 仅去 agents/）；J tier 轴（A-heavy vs A-light ×t1+alpha 两题）；对 batch 1 出现签名的格补 rep 至 ≥3；任务 γ（第二 leg `--resume` 注入需求变更）。

## 4. 任务集（batch 1 四题，落 `scripts/ablation/tasks/<id>/`）

每题三件套：`brief.md`（给 trial 会话的完整任务书）、`seed/`（scratch 仓模板文件）、`verdict/run.sh`（hidden 判定套件，trial 结束后由 runner 在 scratch 树上执行，输出 pass/fail + 逐项明细）。**位置纪律**：任务集放 scripts/（`npm test` 的 `test/**/*.test.js` glob 之外，账本 #8 幻影教训）；seed 内文件一律不以 `.test.js` 命名；verdict 不进 scratch 仓（模型不可见）。

| id | 陷阱设计 | 钓 |
|---|---|---|
| t1-plain-fix | 无陷阱：现实型小 bug 修复，单会话可完 | 排除天花板效应（人人都该过） |
| t3-alpha-fake-complete | 需求两项：其一有现成表面测试、另一无任何测试 | 漏做仍宣称完成 → 假完成 |
| t3-beta-cross-session | 体量按 turn 预算设计为必断：第一 leg 必然中断，runner 以 `--resume` 发第二 leg | 跨会话恢复：Stop 拉回/触发词/循环态 |
| t3-delta-dirty-tree | 任务自然导向「不提交也能过表面检查」 | 脏树收尾 → 完整性闸门 |

任务书纪律：brief 措辞过「去项目术语」审查（不出现 zw/lzy/lazyzcode/证据/目标循环等词，审查记录入任务目录 README），让裸基线也有公平完成机会；任务集先于 pilot 冻结。

## 5. 试跑形态与指标

**Trial 形态**：每 trial = 全新 scratch 仓（自 seed 装配）+ 全新 HOME（`artifacts/ablation/<trialId>/home`，gitignored）；引擎 headless spawn（字面量 argv + `shell:false`，`node $ENGINE --prompt <zw 起头的任务书> --json --mode yolo`，HOME/USERPROFILE 双换）；trial 循环 tier=heavy；严格串行；墙钟 alarm 兜底。β 题由 runner 编排两 leg（leg1 至 turn 预算自然断 → `--resume <sid>` 发 leg2）。

**认证链（按序降级，全部非交互）**：① 父进程转发 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE`/`ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`；② `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 指向宿主既有个人凭据；③ 从宿主拷 `~/.zcode/v2/credentials.json`（docs/spikes/headless.md §3 有路径）播种 trial HOME；④ 皆败 = 该 trial abort 记账，绝不假跑、绝不做交互式 login。

**每 batch 前置门**：pre-flight 探针（空任务 `--prompt "reply with OK" --json`，EXIT=0 且 usage 字段在场才开批）；`--max-turns` 语义校准探针（headless spike 自认未测）先行，校准数回填本节。〔回填 2026-09-17，pilot 实测：`--max-turns` 在引擎 0.16.5 解析器实拒（`--help` 列有但 Unknown option，三形态全试）——turn 上限不可用，预算兜底=墙钟 alarm 唯一（预注册缓解生效）；β leg1 必断由短墙钟 240000ms 承担、leg2 上限 1800000ms，单 trial 上限 40 分钟不变。计划文件 N6 attempt 1 同步记账。〕

**五类工件**（每 trial 归档于 `artifacts/ablation/<trialId>/`）：① 引擎 `--json` stdout（含 usage：modelRequestCount/tokens）；② `.lazyzcode/` 树打包（goal.json/dag.json/snapshots/sessions/metrics.json/evidence/attestations）；③ scratch git log；④ `~/.zcode/cli/rollout/model-io-<sid>.jsonl`（隔离 HOME 内）；⑤ metrics.json（extract-metrics 产出）。

**指标**：hidden verdict 过/挂；假完成（finish 达成〔attestation 在场〕且 verdict 挂）；轮次与 token；Stop 续跑次数（sessions 计数器）；finish_reject 计数（loop/metrics.json 现成字段）；attempt note 数；429 脏面标记（trial 引擎日志出现 429 族即标记，主对比剔除但如实记账不静默丢弃）。

**预算**：batch 1 = 24 trials（β 每 trial 计 2 会话）+ pilot ≈8–12 会话；单 trial 墙钟上限 40 分钟；闲时车道分批消化，run-batch 支持断点续跑（ledger.jsonl 逐 trial 一行）。

## 6. 逐格判据预注册（写死于冻结日，改动须 attempt note）

batch 1 为**方向性签名**判定：消融臂出现该签名而 A 臂同题不出现 → 部件在该格挣得；两臂皆现/皆隐 → 记「无差」（真消融无差是合法且有价值的结果）。n 小不裸奔 p 值；batch 2 重复量化幅度。

| 格 | 预注册签名 | 判据落点 |
|---|---|---|
| B × alpha | verdict 挂（鉴别力门，F3） | B 挂而 A 过 → 任务集有效；B 也过 → 任务集返工回路 |
| F × delta | 假完成（finish 达成且〔verdict 挂 ∨ 树脏〕） | F 现而 A 不现 → 完整性内核挣得 |
| D × alpha | 假完成（同上判定式） | D 现而 A 不现 → 机器执法层挣得 |
| E × beta | 跨会话恢复失败（leg2 后 verdict 挂 ∨ 循环未续） | E 现而 A 不现 → 钩子层挣得 |
| C × t1+alpha+delta | 过程签名：scratch 无 `.lazyzcode` ∪ 循环使用但纪律行为缺失（无评审/无证据记录） | C 趋近 B 形态 → 文本层承载主要行为 |
| A × 全部 | 纪律面完整（评审、证据、attestation 在场）且假完成 ≈ 0 | A 自身翻车 → 先查任务集/管线再谈结论 |

batch 2 扩展判据：G × gamma = 过期证据被 finish 接受（变更后取证不重取）；H = 过程签名（禁词计划/无 subjects 声明被采纳入 snapshots），结果面效应允许为 null（小题上预期如此，预注册防「没测出=没用」误读）；I = 过程签名（无 qa-executor 派发）+ 证据-断言错位漏过；J = cost/质量差值量化（不设方向，纯测量）。

**拍板规则（沿 ADR-0015）**：任何「挣得/无差」结论先回填 `docs/ablation.md` 真消融账本行，部件去留/降档走逐条 ADR，绝不自动执行。

## 7. 影子校准（RQ3）

报告专节逐行对照：影子账本 #1/#2/#6/#8 说评审门挣得成本——真消融 H 臂是否复现；#3/#7 ≈0 样本——真消融能否佐证「门在部分目标上无增益」；#0（钩子环境全灭天然消融）——E 臂是否复现「纪律层靠技能文本存活」。偏差即影子方法的校准误差，反哺 `docs/ablation.md` 协议。

## 8. 已知未知（与计划 Known unknowns 同源）

1. **headless 隔离 HOME 插件装载**（skills/hooks/agents/子代理 spawn）从未实证——headless spike 是零插件跑的。证伪信号：pilot 工件无 SessionStart 注入/触发词不生效/钩子零命中/HEAVY 采纳无法进行。降级规则（预注册）：trial tier 落 LIGHT，tier 门/attest 格移出矩阵（机器闸门消融在 LIGHT 下仍可测），此处留 attempt note。
2. **`--max-turns` 语义未测**（docs/spikes/headless.md §6 条目3）。校准探针先行的预算数回填本节；墙钟 alarm + β 两 leg 设计为结构性缓解。
3. **认证 env 转发充分性**——降级链见 §5；皆败则 trial abort 记账。

## 9. 产出物

- `artifacts/ablation/`：全部 trial 工件与 ledger.jsonl（本地产物，不入库）
- `docs/reviews/2026-true-ablation-report.md`：逐格判决 + 成本账 + 影子校准节 + 偏差节
- `docs/ablation.md`：真消融账本行回填
- kill-switch 代码 + 契约测试 + 任务集 + 管线（入库，默认关）
