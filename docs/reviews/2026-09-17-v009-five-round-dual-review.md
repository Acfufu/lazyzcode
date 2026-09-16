# 0.0.9 五轮高精度双审查报告

**目标**：对 LazyZCode 0.0.9 发布内容（`v0.0.8..HEAD`）执行五轮 A/B 双镜审查（每轮 2 名独立只读评审、互相不可见），主代理对合并发现集逐条亲核，产出本报告与结果 checklist。

**日期**：2026-09-17 · **tier**：HEAVY · **计划**：`.lazyzcode/plans/v009-five-round-dual-review.md`（planHash `a732336aab…`，plan-reviewer 记录 VERDICT: PASS）
**范围锚点**：tag `v0.0.9` = 6c1d099；审阅窗口内 HEAD 由 f2a6b4c 前进至 116eade（另一会话 docs 提交，见方法论 §5）
**结论速览**：79 条原始发现 → **44 条唯一发现**（P0×1 · P1×4 · P2×18 · P3×21）；判定 成立 43 · 部分成立 1 · 证伪 0 · 需压测确认 0。**本目标零修复写入**——发现与修法建议全部入报告，修复归后续目标/用户拍板。

## 方法论

### 1 · 评审结构（五轮 × A/B 双镜）

| 轮次 | 范围 |
|---|---|
| R1 | DAG 内核存储层：`core/dag.js` + `core/loop.js` 调用点 + `lzy dag dependents` + dag-kernel 测试 + ADR-0014 存储节 |
| R2 | 红绿 manifest 与 evidence CLI：`lzy evidence red/waive-red/list` 实现 + evidence-manifest 测试 + SKILL 机器账本句 |
| R3 | 统一权威与门：verifyEvidence/finishLoop 锚定 + `core/attest.js` + HEAVY 门 + 终验 attestation + `core/git.js` + doctor payload-ver + dag-authority 测试 |
| R4 | 测试质量与发布/文档面：四套测试断言强度、版本三体、CHANGELOG、README/guide 双语、checklist、SEO 四件、build.mjs、spike 报告 |
| R5 | 跨面回归与宪法一致性：0.0.8→0.0.9 兼容、旧形 goal、包内容、AGENTS §2/§4/§8、ADR 声明 vs 代码、红线、SKILL 契约句、债③处置 |

每轮 **A 镜=正确性**（规格 vs 实现、边界、错误分类、读面真伪、off-by-one、legacy 分歧）、**B 镜=对抗**（可及的破坏面、假 finish 逃逸、静默数据损坏、无出口状态、文档承诺 vs 未兑现执法）；A/B 派发互不可见（任务书不携带他镜内容，契约禁读他人 `r*-*.md`）。10 名评审全部 `general-purpose` 只读派发：禁写仓库、禁 git add/commit、活体探针限各自独立 scratch 根 `/tmp/v009-review-R<N>-<A|B>/`。

### 2 · 并发实验（狗粮数据点，用户 2026-09-17 指令）

- 建议行原文（`lzy loop start`，06:01）：`子代理并行上限 1 —— 11 分钟前仍在撞线——建议串行，等窗口回落`。
- 实际：Wave1（A 镜×5）与 Wave2（B 镜×5）各 **5 并发单消息派发**——**10/10 完成，零判死、零中断、零补位**（派发形态实证：harness 未串行化）。
- 观测（doctor `rate-limit`/`band-by-provider` 波前波后 diff）：Wave1 窗口 +15 限流回合 / +580 失败请求（**混算窗口**，含另一会话 116eade 提交活动）；**Wave2 纯窗口：零新增限流回合、零失败请求增量、零死亡**；new-provider 桶 226 净/2 脏 → 273 净/3 脏。
- 判定：5 并发在本 session（`new-provider/deepseek-v4.1-flash`）可持续；账号级混算的建议行对本场景过保守——与 roadmap §⑩ 第 6 条「多 provider 限流建议混算」债互为印证（附记已落）。代价面如实记账：两波子代理 token 用量显著（乘性），5 并发宜配「波次上限 + 判死补位」纪律。
- 全程记账：`artifacts/v009-review/concurrency-log.md`。

### 3 · 只读纪律与越权核验

每波后核树：`git status --porcelain` 全空；`find -newer` 标记扫出的全部写入均归因明确（另一会话的 116eade 提交与 roadmap 附记、本目标自身记账文件、会话钩子在 `.lazyzcode/` 的计数、codegraph daemon 日志）——**零评审越权写入**（沿用历史只读越权事件的核树纪律）。

### 4 · 亲核判定口径

- 判定 ∈ {成立, 部分成立, 证伪, 需压测确认}；**P0/P1 必有主代理活体探针**（亲跑 scratch，stdout 存档）；P2/P3 以引用行实读 + 采纳评审活体为主（探针未逐条复跑——如实记账）。
- 主代理亲跑六条：ADJ-01（chmod 000 毁账）、ADJ-24（红半附件覆写）、ADJ-02（对照先于证据→finish 放行）、ADJ-08（零 F 死锁）、ADJ-10（done 态死端）、ADJ-34（引擎行数争议条）；另加文档面六处 grep 实读。存档见 `artifacts/v009-review/probes/`。
- **A/B 分歧裁定**：79 条中直接分歧仅 1 条——ADJ-34（spike 报告「zcode.cjs 单行」声明）：实测 `wc -l` = 3583 行，裁定 **R4-A 正确**；R4-B 该条「无夸大」为未实测的转述性复核（评审偏差记档）。

### 5 · 偏差与记账

1. **HEAD 中途前进**：审阅窗口内另一会话落地 116eade（`AGENTS.md` + `docs/release-checklist.md`，win32 VM 复测收尾）——各镜行号可能基于 f2a6b4c 或 116eade 两棵树（R4-A 报告明确标注其行号基于 116eade）；因本目标当时尚无 F 证据，无证据时效影响；范围随之增记第三笔 tag 后提交。
2. **编号归一**：R1-B 原件仅首条带规范编号（V009-R1-B-1），判定表按原文出现顺序补全 V009-R1-B-2..7——原件正文未改字。
3. **检查模式微调**：计划 F2 起草时预想沿用评审编号（`^### V009-R`）；实际判定表采用去重编号 `V009-ADJ-xx`，对应计数模式为 `^### V009-` / `^\| V009-`——计数等式与断言强度不变（如实记账）。
4. **报告收录口径**：十份评审原件**全文逐字**收录（含「已查无发现」与「开放问题」两区），判定表为其上层的去重亲核层；原件正文与存档 `artifacts/v009-review/r{1..5}-{a,b}.md` 字节一致。
5. **本目标不做修复**：范围边界=报告 + AGENTS §2 收尾行 + roadmap 附记，零代码改动（见「修复建议优先级」）。

### 6 · 范围覆盖

`git diff --stat v0.0.8..HEAD` 的 30 个变更文件全部进入五轮 scope：`core/dag.js`、`core/attest.js`、`core/loop.js`、`cli/lzy.js`、`core/doctor.js`、`core/git.js`、四套新/改测试、ADR-0013 增补节/ADR-0014、`SKILL.md` 四个 hunk、guide 双语、README 双语、CHANGELOG、release/narrative checklist、marketplace.json、package.json、plugin.json、`docs/spikes/headless.md`、SEO 四件、`scripts/docs-preview/build.mjs`、AGENTS §2/§4/§8。

## 五轮评审原件（verbatim）

### R1 · DAG 内核存储层（core/dag.js + 调用点）

#### R1-A

# R1-A · DAG 内核存储层（正确性镜）— 原件

- [P1] V009-R1-A-1 `dag.json` 存在但不可读 → 被静默当空账本 → 下一次写命令整库覆盖（不可重算的红/waive 半丢失；本工具自己的恢复指引就是覆写路径）
  证据：`core/dag.js:39-45` — `try { text = readFileSync(dagPath(cwd), "utf8"); } catch { return { dagVersion: DAG_VERSION, nodes: [], edges: [] }; }`（catch 无 `err.code` 判别，ENOENT 与 EACCES/EISDIR/EPERM/EMFILE 同流）；配合 `core/dag.js:67-75` saveDag（把内存库原样 `writeFileSync(tmp)+renameSync`，无「本次 load 是否降级为空」守卫），调用点 `core/loop.js:780`（loadDag）→ `core/loop.js:791`（saveDag）。
  故障场景：某次以 sudo/容器/备份还原后 `.lazyzcode/loop/dag.json` 属主或权限漂移（或 Windows AV 持句柄给 EPERM、磁盘瞬时 EIO）。此时：①`lzy evidence list` 打印「0 节点」并 exit 0；②`lzy dag dependents <id>` 打印「命中 0」并 exit 0；③`lzy loop verify/finish` 报「证据账本不一致：F1 记录第 N 代绿半但中央 DAG 无对应节点…恢复：重跑 lzy step done F1 --evidence」——把权限问题误诊为账本-目标分歧；④用户照该指路重取证，`loadDag` 仍得空库，追加单节点后 `renameSync` 直接盖掉原文件：全部历史节点/边（含只存在于该文件、丢失不可重算的红半）无声毁灭，命令还打印「✔ 红半账本已记」。ADR-0014 与 `core/dag.js:38` 承诺「绝不静默当空库」，实测只有 JSON/校验和/版本三类 fail-closed，IO 错误类整体漏网。
  最小探针（已跑，`/tmp/v009-review-R1-A/s1`，库中 3 节点 4 边已含 plan/red/green/red_of）：`chmod 000 .lazyzcode/loop/dag.json && node cli/lzy.js evidence list`（→「0 节点」，exit 0）`&& node cli/lzy.js dag dependents n2`（→「命中 0」）`&& node cli/lzy.js evidence red F1 --evidence x`（→ EXIT=0，之后账本只剩 1 节点 1 边）。同族已实测：`dag.json` 为目录（EISDIR）同样得「0 节点」。`chmod 600` 恢复后原数据已不存在。
  附带测试缺口：`test/dag-kernel.contract.test.js:135-153` 只覆盖 JSON/校验和/版本三态（`writeFileSync(p, "{corrupt")`），未覆盖「在册但不可读」类，故该缺陷无回归网。

- [P1] V009-R1-A-2 HEAVY 对照机器门可被**上一次 attempt** 的 comparator 记录满足（同 slug+同 planHash）→ 未对照的新证据拿到 finish 放行，且 LOOP_COMPLETE attestation 引用外地节点
  证据：`core/loop.js:1003` — `comparator = findLatestComparator(dag, goal.slug, goal.planHash);`（门的三判据：存在 + `MATCH` + `comparator.fingerprint === fingerprint`，见 `core/loop.js:1004-1020`）；`core/dag.js:217-223` — `findLatestComparator` 的键只有 `(kind==="comparator" && n.slug === slug && n.planHash === planHash)`，**无 attempt 身份**；账本又按设计跨 reset 常驻（ADR-0014）。
  故障场景：HEAVY 目标跑完 → `lzy loop reset`（保留 dag.json）→ `lzy loop register <同一 slug> --tier heavy` + 采纳**字节相同**的计划（`loop/snapshots/<slug>.md` 未被 reset 清除，重采纳天然同 hash）→ 重新取证（证据文本可与上次完全不同）→ `lzy loop finish`：`findLatestComparator` 命中上一 attempt 的 MATCH 节点，指纹又因树未变而相等 → 门放行，本次 attempt 的 F 项证据文本从未被任何 qa-executor 对照过；写出的终验 attestation 里 `comparator.nodeId` 指向上一次 attempt 的节点。
  最小探针（已跑，`/tmp/v009-review-R1-A/s3`）：attempt1 `register --tier heavy → plan --review "plan-reviewer: PASS — ok" → start → evidence red F1 → step done F1 --evidence "green attempt1" → attest comparator --file cmp.json（F1:MATCH）→ loop finish`；随后 `loop reset → register p1 --tier heavy → plan 同一文件 --review PASS → start → step done F1 --evidence "DIFFERENT evidence text in attempt2, never compared" → loop finish` → **EXIT=0**（无任何本 attempt 的对照记录）；`.lazyzcode/attestations/p1-20260916T220514Z.json` 的 `comparator` = `{"nodeId":"n5",...}`，与 attempt1 的 `p1-20260916T220513Z.json` 同一 nodeId。

- [P2] V009-R1-A-3 `lzy evidence list` 无 attempt 作用域：上一次 attempt 的红/绿半被当作当前目标的 manifest 呈现（可致错误判断）
  证据：`cli/lzy.js:456` — `const nodes = dag.nodes.filter((n) => n.slug === slug || (n.kind === "review" && dag.nodes.some((p) => p.id === reviewPlanIdOf(dag, n) && p.slug === slug)));`（只按 slug 过滤，无 planHash / 代数 / attempt 判据）；孤儿判定 `cli/lzy.js:503-507` 也只覆盖「green 且 seq 超前」，红/waive 节点永不判孤儿（注释明说「本就不入 goal.json」），rebind 链 `cli/lzy.js:496-498` 同样跨 attempt 合并。而 SKILL.md:208/215 把该视图定为 manifest 第一来源、comparator 配对/在场的读取面。
  故障场景：reset 后以同 slug 重开（同 P1-2 前置），本次只做了 F1 的绿半、从未记录红半，`lzy evidence list` 却打印 `F1 · 绿 ✓ gen1（…） · 红 ✓ n3 gen1（…）`（n3 是上一 attempt 的 red）→ 模型据此判定「红绿两半齐备」；另一次运行里 `rebind 链 2 代（gen1→gen1，现行 gen1）`、`评审 n2/n7` 把两 attempt 的节点混成一份链。
  最小探针（已跑）：上述 s3 attempt2 `lzy evidence list` → 输出含 `红 ✓ n3 gen1（指纹 e488360c81）`，而 attempt2 未执行过任何 `evidence red`（`.lazyzcode/loop/dag.json` 中 gen1 红节点为 n3，attempt2 的绿节点为 n8）。

- [P2] V009-R1-A-4 rebind 后新 green **永不获得 red_of 配对** → 「什么依赖当前绿」查询漏掉红半；与 `core/dag.js` 头注及 ADR-0014 §E-01 文本相反，且测试把该行为固化为期望
  证据：`core/dag.js:172-183` — `const paired = new Set(dag.edges.filter((e) => e.type === "red_of").map((e) => e.from)); … if (paired.has(node.id)) continue;`（一旦某红节点有过任一 red_of，后续代次一律跳过）；头注 `core/dag.js:170-171` — 「同一 red 节点多条 red_of 合法（rebind 后新配对），查询取最新为现行、全部留作历史」；ADR-0014 §E-01 同款句「同一 red 节点多条 red_of 边合法（最新为现行、全部留史）」。生产该「多条」的唯一代码路径不存在，`test/dag-kernel.contract.test.js:172` 反而断言 `pairReds(...) === 0`。
  故障场景：F1 红半绑 base 指纹 → 绿半 gen1 → 代码变更 → 重取证绿半 gen2（`completeStep` 追加 supersedes）→ 账本里 gen2 绿节点只有 `captured_on`+`supersedes` 两条出边，红节点仍指向**已历史代次**的 gen1 绿节点。于是 `lzy dag dependents <当前绿>`（失效传播查询的本职）报「命中 2」且不含红半；`evidence list` 同一块里却并列打印「绿 ✓ gen2 … 红 ✓ n2 gen1」，读起来像已配对。任何未来读 red_of 判「红绿是否齐备」的消费者会继承此漏。
  最小探针（已跑，`/tmp/v009-review-R1-A/s2`）：`evidence red F1 → step done F1 → 改 a.txt 提交 → step done F1` 后 `node cli/lzy.js dag dependents n4` → `命中 2：→ captured_on … / → supersedes n3`（无 red_of；账本 edegs 中 red_of 仅 `n2 -> n3`）。

- [P3] V009-R1-A-5 `dag dependents` 分不清「节点不存在」与「无依赖」，且**形如节点 id 的表面值不可查**
  证据：`core/dag.js:237-244` — `if (/^n\d+$/.test(ref)) { … return { kind: "node", id: ref, hits: out }; }`（无 `nodeById` 存在性检查，直接按 id 字符串比对）；`core/dag.js:246-251` 的表面分支只在 ref 不匹配节点形状时才走；`cli/lzy.js:575` 一律打印「命中 N」。
  故障场景：①`lzy dag dependents n999` 报「node n999 · 命中 0」并 exit 0（该节点不存在，用户会读成「无依赖」）；②`lzy evidence red F1 --evidence … --surface n2` 记下的外部表面值恰为节点 id 形状时，`lzy dag dependents n2` 只走节点分支，永远查不到该 `captured_on` 表面。
  最小探针（已跑，`/tmp/v009-review-R1-A/s1`）：`node cli/lzy.js dag dependents n999` → `node n999 · 命中 0`；`node cli/lzy.js evidence red F1 --evidence x --surface n2` 后 `node cli/lzy.js dag dependents n2` → 命中 2（均为节点 n2 的边，账本里 `n4 → captured_on surface "n2"` 未被列出）。

- [P3] V009-R1-A-6 校验和合法但结构不合法的账本 → 原始 JS TypeError，无恢复指路（fail-closed 保住，但消息不可行动）
  证据：`core/dag.js:52-62` — 只做 `checksum`/`dagVersion` 两项判定，`payload.nodes/edges` **无类型校验**即返回；随后首个读取点 `cli/lzy.js:456` `dag.nodes.filter(...)`。
  故障场景：手改账本（或未来版本写出的不同 schema）并把 `nodes` 写成对象而非数组、按同一算法补上校验和 → `lzy evidence list`/`lzy loop status` 输出 `[lzy] dag.nodes.filter is not a function`（内部标识符泄漏、无 `DagError` 家族文案、无「恢复」段），用户不知道该怎么办。
  最小探针（已跑）：以 `node -e` 把 `nodes` 置为 `{}` 并按 `sha256(JSON.stringify({dagVersion,nodes,edges}))` 重算校验和后 `node cli/lzy.js evidence list` → 上述 TypeError；`lzy loop status` 同。

- [P3] V009-R1-A-7 `evidence list` 的「现行 genN」取最高 seq，而权威锚定取 `goal.evidenceSeq-1`（两者可指向不同节点）
  证据：`cli/lzy.js:483-486` — `const greens = halves.filter((n) => n.half === "green").sort((a, b) => a.seq - b.seq); … const cur = greens[greens.length - 1];`；权威判据在 `core/loop.js:926-927` — `const gen = s.evidenceSeq ? s.evidenceSeq - 1 : 1; const node = findGreenByGeneration(dag, goal.slug, s.id, gen);`。
  故障场景：dag-first 半失败残留（saveDag 成功、writeGoal 失败）留下 seq 超前的幽灵绿节点时，manifest 首行把该幽灵标为「绿 ✓ gen2（指纹 deadbeef · 过期）…现行 gen2」，而 verify/finish 实际锚定 gen1 并判「新鲜、可 finish」——读面与裁决面指向两个不同节点。缓解事实：同一次输出里会打印「⚠ 孤儿节点 …」一行，故非静默。
  最小探针（已跑，`/tmp/v009-review-R1-A/s3`，手工补 `{slug:p1,step:F1,seq:2,half:green}` 节点并重算校验和）：`lzy evidence list` → `绿 ✓ gen2（指纹 deadbeef · 过期）…现行 gen2` + 孤儿告警；同刻 `verifyEvidence()` → `fresh ["F1"] stale [] unbound []`。

- [P3] V009-R1-A-8 恢复指引要求「人工抢救记录后重建」，但手工重建的账本必被拒——无 repair/import 面，校验和算法与归一规则也未写入 ADR
  证据：`core/dag.js:32` — `RECOVERY = "先备份并人工抢救需要保留的红/waive 记录（红半边只存在于此文件、丢失不可重算），然后删除该文件重建账本…"`；判定点 `core/dag.js:52-61`（校验和对象是**归一后**的 `{dagVersion, nodes, edges}`，且 nodes 内部键序原样参与 `JSON.stringify`）；`cli/lzy.js` 的 `dag` 子命令只有 `dependents`（无 import/rebuild/repair）。
  故障场景：用户按指路把抢救出的红/waive 记录手写回 `dag.json`（无 `checksum` 字段，或按文档语义重排了内部键序）→ 一切读账本命令报「校验和不符（内容与落盘时态不一致）」并再次指向同一段「人工抢救后删除」的死循环文案；ADR-0014 只写「载荷 sha256 校验和」，未给出算法/归一/键序约束。
  最小探针（已跑）：`node cli/lzy.js evidence list` 前执行 `delete obj.checksum`（其余字节不动）→ `[lzy] 中央 DAG 账本校验和不符…恢复：…然后删除该文件重建账本`，exit 1。

## 已查无发现

- **原子写与 tmp 家族**：`saveDag`（`core/dag.js:67-75`）tmp 与目标同目录、`writeFileSync`+`renameSync`；tmp 名 `.dag.json.<pid>.<ts>.tmp` 与清扫/巡逻家族同源（`core/loop.js:1341` `tmpFamilies = [".goal.json.", ".dag.json."]`、`core/doctor.js:210-216`），写后无残留（测试 126-133 实测）。同一进程内不存在 tmp 名碰撞（同步串行 + 首个 rename 已消费 tmp），跨进程 pid 不重号。
- **fail-closed 三态（解析/校验和/版本）**：零字节文件→「JSON 解析失败」；篡改载荷→「校验和不符」；重算校验和并改 dagVersion=99→「版本不兼容」；均 exit 1 且带恢复段。校验和先行于版本门（`core/dag.js:52-61`），新版文件不会被误报为「损坏」。
- **读取归一**：顶层 `{checksum, ...rest}` 剥离后只取三键 → 手加顶层键会被归一丢弃、不污染状态；`saveDag(loadDag())` 字节级稳定（测试 102-124 断言逐字节一致，我复跑 12/12 绿）。
- **锁纪律**：全部账本写路径都在 `withLock` 临界段内且「load→append→save」同段——`doAdoptPlan` `core/loop.js:570-582`（外层 `adoptPlan:478-480`）、`doCompleteStep` `core/loop.js:706-724`（`completeStep:606-608`）、`doRecordEvidenceHalf` `core/loop.js:780-791`（`recordEvidenceHalf:734-736`）、`recordComparatorAttestation` `core/attest.js:27-28,60-75`。读面（verify/dependents/evidence list）无锁，但 rename 原子性保证整文件读，未发现半写可见窗口或 lost-update 路径。
- **追加式/不可变性**：全仓 grep 无对已载入 `dag.nodes/edges` 的赋值、splice、pop、delete；节点只经 `push` 追加，边只追加；`reset/abandon/cleanupLoopResidue` 不触碰 `dag.json`（测试 257-265 断言 reset 后逐字节不变，我复跑通过）；`doctor` 的 EXEMPT 含 `dag.json`（无疤痕误警）。
- **id 单调性**：`nextId` 取全体匹配 id 的最大值再 +1，与节点顺序无关；即便手工账本含重复 id/非数字 id，也不会被 append 复制出新重复 id（非匹配形态只影响 max 取值，不产生碰撞）。真重复 id 只能来自手改文件本身。
- **`lzy dag dependents` 的边端点**：`plans` 边的字符串端点按原样打印（`→ plans p1`），悬空节点端点走 `shortNode(null)` → 「（对端不在账本）」；未发现崩溃或错误的边型路由。
- **`lzy loop status` 对损坏账本确实拒绝**（实测 exit 1 并带恢复段），与 ADR-0014 增补节「verify/status/finish 一律拒」一致；`stalePreview` 五态优先级（superseded > external/null > 指纹）与测试一致，`supersedes` 边方向（to=旧代次）与「被指向即历史代次」语义自洽。
- **增长量级**：`nextId` O(nodes)、`pairReds` O(nodes+edges)，每次追加整文件重写；万边级阈值已由 ADR-0014 预注册为已知未知，现实规模下未见 O(n²) 悬崖。
- **`test/dag-kernel.contract.test.js`**：12/12 在本机绿（8.5s）；夹具大多有牙——dag-first 用 goal.json 的 sha256 前后比对、双跑用 stdout 逐字节、锁竞争用实测等待时长，非空转。仅 `:202` 的 `assert.equal(nextId(dag), \`n${dag.nodes.length + 1}\`)` 近乎恒真（改用 `nodes.length+1` 实现也会通过），未覆盖头注宣称的「最大序号+1」有空洞账本的情形。
- 写面纪律自证：所有探针只在 `/tmp/v009-review-R1-A/` 内执行；全程未在仓库写任何文件（`git status --porcelain` 为空），未跑任何变更命令。

## 开放问题

- **comparator 跨 attempt 复用是设计还是漏洞**：ADR-0014 增补节把「现行」定义为「按 slug+planHash 取最新」且只显式要求「指纹未过期」，与实测行为一致；但同一 slug+同 planHash 复用是否被接受（尤其 swap 掉证据文本后），文本里找不到判据。定论需要维护者表态，或在 comparator 节点里加 attempt 身份（如 goal 注册时间戳/尝试号）并把门判据扩到该字段。
- **崩溃耐久性（tmp→rename 无 fsync）**：README/ADR 只承诺「原子写」，未申明掉电语义；`writeFileSync`+`rename` 在延迟分配文件系统上掉电可留零字节/半截 `dag.json`，读面会 fail-closed 而恢复=丢红半。需要一台可控掉电/pkill 时点（或明示「接受该风险」）才能定论；同样形状自 0.0.8 的 `writeGoal` 沿用，属既有家族而非 0.0.9 新引入。
- **win32 上的不可读类**：我只在 macOS/POSIX 复现了 EACCES/EISDIR 触发的整库覆盖；Windows 上 AV/句柄导致 EPERM 时 `renameSync` 是否同样成功（从而同样丢库）无法在本机判定，需要 CI windows 腿或 VM 复测。
- **red_of 配对缺口的现实影响**：当前全仓无任何消费者读 red_of（仅 `dependents` 展示），故 P2 目前是「查询/文档层」缺陷；若后续把「红绿齐备」做成机器门或 comparator 配对来源，该缺口会升级为裁决缺陷——需要一次显式取舍（重新配对 vs 修 ADR 文本）。

#### R1-B

# R1-B · DAG 内核存储层（对抗镜）— 原件

## 发现

- [P1] V009-R1-B-1 loadDag 的裸 catch 把一切读错误都当「账本缺席」——在场但不可读（EACCES/EISDIR/ELOOP/EMFILE/EIO）的账本被静默当空库，读面 exit 0 说谎，下一次写把整本账原子覆盖成单节点（红/waive 史不可恢复 + id 回收）
  证据：core/dag.js:41-45 — `try { text = readFileSync(dagPath(cwd), "utf8"); } catch { return { dagVersion: DAG_VERSION, nodes: [], edges: [] }; }`（无 `err.code` 判别）；core/dag.js:67-75 `const payload = { … dag.nodes … }; … renameSync(tmp, p)`（按内存态全量重写，无「盘上非空而内存空」护栏）；对照 doctor.js:199-201 对 goal.json 就按 `err?.code === "ENOENT"` 分流，同仓家法已有正确写法。ADR-0014 §fail-closed 明写「账本解析/校验和失败→一切读账本命令拒绝并给恢复指路（**绝不静默当空库**）」。
  故障场景：`.lazyzcode/loop/dag.json` 存在但不可读（chmod 000、属主/ACL 只读、被同步工具换成自指 symlink、或 `.lazyzcode/loop` 权限被收紧）。① `lzy evidence list` → `证据账本 · 目标 s · 0 节点` + `红 ✗（未录）`，**EXIT=0**；`lzy dag dependents <红节点id>` → `命中 0`，**EXIT=0**（ADR 指定 `evidence list` 为 comparator 配对/在场的第一来源，即执法面被喂假数据）。② 随后任一写命令（`lzy step done`/`evidence red`/`attest comparator`）走 loadDag→空→追加单节点→saveDag，rename 无需目标文件写权限，成功以**只含新节点的文件覆盖整本账**：实测账本从 2 节点（plan n1 + 红半 n2）变 1 节点（新绿半还被回收成 n1），EXIT=0、无一行警告、文件 mode 变 600 掩盖痕迹。红半按本模块自述「只存在于此文件、丢失不可重算」= 不可恢复的数据丢失。
  最小探针：`cd /tmp/v009-review-R1-B/s9`（账本已就绪）→ `chmod 000 .lazyzcode/loop/dag.json`（或 `ln -s dag.json .lazyzcode/loop/dag.json`）→ `node <repo>/cli/lzy.js evidence list`（EXIT=0，「0 节点」）→ `node <repo>/cli/lzy.js step done F1 --evidence green`（EXIT=0，账本被替换为单节点）。两种 errno 类（EACCES/ELOOP）均已活体复现；EISDIR 变体读面同样说谎（`0 节点` EXIT=0），写面因 rename 落在目录上而以裸 `EISDIR` 失败（拒得下但无恢复指路，见 V009-R1-B-4）。
  分级理由：按简报表「data loss = P0」可上判；我给 P1 是因为写面（才是销毁点）需要「文件不可读而目录可写」这一非默认 FS 状态，且后果是拒绝 + 丢账，不是假 finish。`lzy doctor` 全程盲视该状态（只报孤儿 tmp）。

- [P2] `lzy evidence list` 的节点筛选是 O(R×N×E) 嵌套扫描——ADR 自己假设的「万边级」规模下该读面会挂死
  证据：cli/lzy.js:456 — `const nodes = dag.nodes.filter((n) => n.slug === slug || (n.kind === "review" && dag.nodes.some((p) => p.id === reviewPlanIdOf(dag, n) && p.slug === slug)));`：`reviewPlanIdOf`（内部 `dag.edges.find`，无 early-exit）被放在 `.some` 谓词内，每个 `p` 迭代重算一次 → 非本 slug 的每个 review 节点要扫 N 个节点 × E 条边。
  故障场景：跨目标常驻账本（ADR 明确设计为跨 reset 常驻）累积到数千节点 + 各代目标的 review 节点后，`lzy evidence list`（含 `--goal <旧 slug>`）停摆：模型/comparator 的第一来源直接不可用。实测（纯 CPU，同表达式隔离计时）：N=2005/R=5/E=2000 → 313ms；N=2025/R=25 → 501ms；N=2100/R=100 → 1720ms；N=15000/R=5000/E=10000 → 25s 未完成（按实测速率外推数小时）。当前真仓账本仅 21 节点 → 实测 0ms（潜伏债，非现网炸）。
  最小探针：`cd /tmp/v009-review-R1-B/s7`（15k 节点/10k 边账本）→ `timeout 25 node <repo>/cli/lzy.js evidence list`（超时；同目录 `lzy evidence red F1 --evidence x` 正常）。一行修法：把 `reviewPlanIdOf(dag, n)` 提到 `.some` 外。

- [P2] red_of 配对：文档/注释/测试标题承诺「同一 red 多条 red_of，最新为现行」，代码永不产生第二条——rebind 后**现行绿半没有任何配对边**，且「红半依赖谁」永远指向被 supersede 的旧绿
  证据：core/dag.js:170-183 — 注释「同一 red 节点多条 red_of 合法（rebind 后新配对），查询取最新为现行」vs 实现 `const paired = new Set(dag.edges.filter((e) => e.type === "red_of").map((e) => e.from)); … if (paired.has(node.id)) continue;`（只看 from，不看指向哪代绿）；ADR-0014 第 23-24 行同口径。
  故障场景：F1 取红（n2）→ 绿 gen1（n3，red_of n2→n3）→ 改码 → 重取证绿 gen2（n4）。实测边集：`red_of n2 → n3`（旧绿）、`supersedes n4 → n3`，**n4 无 red_of 入边**。于是 `lzy dag dependents n2` 答 `→ red_of n3`（历史代次），`lzy dag dependents n4`（现行、即 verify 锚定的那个）只有 `captured_on`+`supersedes`——「什么依赖现行绿」漏掉那条红半。测试同题反证：test/dag-kernel.contract.test.js:162 标题「多条 red_of 取最新」，正文 170-178 断言 `pairReds(...greenId: g2.id) === 0` 且 `redOfs.length === 1`，从未构造多条 red_of 情形。
  最小探针：`cd /tmp/v009-review-R1-B/s6 && node <repo>/cli/lzy.js dag dependents n2 && node <repo>/cli/lzy.js dag dependents n4 && lzy evidence list`（rebind 后逐字如上）。
  注：`paired` 的全局 from 集合顺带防了「reset 后同 slug 跨世配错对」，故这更可能是**文档/测试口径**与实现的错位而非纯 bug——但读者契约（最新为现行）在全仓无实现者。

- [P2] 校验和合法但形状畸形的账本：只校 checksum + 版本，不校形状——裸 TypeError 取代 ADR 承诺的「拒绝并给恢复指路」，且畸形节点被静默丢弃后读面照样 exit 0
  证据：core/dag.js:52-62 — `const payload = { dagVersion: rest.dagVersion, nodes: rest.nodes, edges: rest.edges }; if (checksum !== checksumOf(payload)) …; if (payload.dagVersion !== DAG_VERSION) …`（无 `Array.isArray`/元素类型检查）。
  故障场景：人工抢救账本（RECOVERY 文案本身就指导「人工抢救后删文件重建」）或工具改写后重算 checksum，漏一个 `edges` 键 → `lzy evidence list` 先打印 `0 节点`（stdout 已污染）再以 `[lzy] Cannot read properties of undefined (reading 'filter')` 退出；`nodes: null` → `Cannot read properties of null`；`nodes: [null]` → 所有查询（`0 节点`/`命中 0`）EXIT=0 静默假答。ADR-0014 的「一切读账本命令拒绝并给恢复指路」只覆盖 JSON/校验和/版本三态。
  最小探针：`cd /tmp/v009-review-R1-B/scratch && node /tmp/v009-review-R1-B/mkdag.mjs .lazyzcode/loop/dag.json '{"dagVersion":1,"nodes":[]}' && node <repo>/cli/lzy.js evidence list`（部分输出后 TypeError，无恢复指路）。

- [P3] id 分配器无格式校验 + 浮点自增：可产出非单调、重复、正则不成立的 id，`dependents` 把该 id 误路由到表面分支
  证据：core/dag.js:82-89 — `const m = /^n(\d+)$/.exec(n.id); if (m) max = Math.max(max, Number(m[1])); … return `n${max + 1}`;`（Number 溢出/正则不成立的 id 一律被忽略）；core/dag.js:237 `if (/^n\d+$/.test(ref))`。
  故障场景：账本含 `n9007199254740993`（2^53+1）→ 连续两条真实命令 `lzy evidence red F1` 都分配到 **n9007199254740992**（比现值小、且互相重复）：实测文件 `[n9007199254740993, n9007199254740992, n9007199254740992]`，dup=true；含 `n999999999999999999999`（1e21）→ 新 id 串是 `"n1e+21"`（正则不成立，`nextId` 永不再前进，后续全同名），`dependents("n1e+21")` 落入表面分支答 `surface … 命中 0`。nodeById 取首个匹配 → 身份歧义。
  最小探针：`node --input-type=module -e "import {emptyDag,appendEvidenceNode,nextId,dependents} from '<repo>/core/dag.js';…"`（两行分别复现重复 id 与 `n1e+21` 误路由）。

- [P3] `dependents <节点id>` 对不存在的 id 答「命中 0」，与「存在但无依赖」不可区分
  证据：core/dag.js:237-244 — 命中集合为空时直接 `return { kind: "node", id: ref, hits: out }`，从不校验 `nodeById(dag, ref)` 是否存在（而边对端缺席是有话术的：cli/lzy.js:433 `if (!node) return "（对端不在账本）"`）。
  故障场景：ADR 的招牌能力「什么依赖 X」——模型打错 id（`lzy dag dependents n99`）读到 `依赖查询 · node n99 · 命中 0`（EXIT=0），据此断言「没有东西依赖它」。
  最小探针：`cd /Users/acfufu/Codehub/lazyzcode && node cli/lzy.js dag dependents n999`（真仓实测：`node n999 · 命中 0`）。

- [P3] dag-kernel 契约测试的标题/正文缺口：两条标题声称钉住的不变量实际未断言（其一恰好是 V009-R1-B-1 的空洞）
  证据：test/dag-kernel.contract.test.js:189 标题「stalePreview **五态**：fresh/stale/superseded/external/null 指纹」但 196-201 只断言 superseded/fresh/external/unknown——`stale` 分支（决定清单「过期」标签的那条）无一断言；:162 标题「多条 red_of 取最新」但正文断言单条（见 V009-R1-B-3）；:135「fail-closed 三态」只覆盖 JSON/校验和/版本，**无 IO 类与形状类**（正是 V009-R1-B-1/-4 的落点）。
  故障场景：把 `stalePreview` 的 `===` 写成 `!==`（或把 IO 类错误继续当缺席）可全绿通过——测试对这两类缺陷没有探测力。
  最小探针：`node --test test/dag-kernel.contract.test.js`（现状全绿）后对照 `grep -n '"stale"' test/dag-kernel.contract.test.js`（0 命中）。

## 已查无发现

- **崩溃窗口/半写**：对多 MB 账本连续 6 次 SIGKILL（30–200ms 随机落点于 writeFileSync→rename 之间）——dag.json 每次都是「旧态或新态、JSON 可解析、checksum 相符」，无一次半写；留下 1 个孤儿 `.dag.json.<pid>.<ts>.tmp`，doctor `state` 行如实报「孤儿 tmp 1 个」，cleanupLoopResidue 的 tmp 家族含 `.dag.json.`。rename 原子性主张成立。
- **并发写与锁旁路**：全部 4 个 DAG 写点（adoptPlan:571-581 / completeStep:706-724 / recordEvidenceHalf:780-791 / attest comparator:60-75）都在 `withLock` 内，无锁旁路；实测 6 个进程并发 `evidence red`（3×F1+3×F2）全部串行成功，6 节点 id 唯一（n2…n7）、checksum 合法、零丢更新。锁被偷（>10s 持锁）是 ADR 已记的已知未知。
- **ADR 预注册阈值**：15k 节点/10k 边（5.6MB）账本的锁内临界段实测 `loadDag 50-128ms + saveDag 51-63ms`，远低于「万边级写 >1s 即触发修」的触发线（早前 1.73s real 是 Node 启动 + 沙箱 FS 开销，非临界段）。
- **代次锚定不可被 ghost 顶替**：`findGreenByGeneration` 按 goal.json 的 `evidenceSeq-1` 锚定，同代次按 (seq, at) 决胜；孤儿（更高代次）在 verify/finish 中天然非入参（CLI 有 ⚠ 标注），锚定方向安全。
- **读账本命令的 fail-closed 面**：不可读/分歧账本下 `lzy loop status`、`loop verify`、`loop finish` 一律拒（EXIT=1，带恢复指路）——说谎的只有 `evidence list`/`dag dependents` 两条只读旁路面。
- **畸形/悬空边**：`supersedes`/`red_of` 指向不存在的端点只影响展示（`nodeById` 返回 null →「对端不在账本」）；无任何门读边做裁决，伪造边无法造成假 finish。
- **敌意键序 / 额外键 / 篡改**：checksum 在归一化重建 `{dagVersion,nodes,edges}` 上计算，顶层杂键被丢弃、键序不影响判读；重算 checksum 的篡改可绕过（本地文件固有，实现与测试都明知），但 verify 会重取 goal.json 代次 + 从 git 重算指纹，伪造节点无法独立造成假 finish。
- **跨 reset 常驻**：abandon/reset 均不触碰 dag.json；契约测试断言 reset 后字节不变。
- **无界增长**：账本无容量上限、无修剪，但成本线性（15k 节点 5.6MB，load≈50ms）。

## 开放问题

- 「同一 red 多条 red_of（最新为现行）」到底是要写面实现（改 `pairReds` 允许按代次追加）还是仅读者容忍（改 ADR 注释 + 测试标题）？定调者：ADR-0014 E-01 段作者；我倾向后者（现有 `paired` 跳过同时防了 reset 同 slug 跨世错配），但当前没有实现者也无断言。
- `writeFinalAttestation` 对 legacy 或无锚定节点的 F 项写 `nodeId: null`（core/loop.js:1097-1098）——这在 LOOP_COMPLETE 机器证明里是否算合法空值？（属 attestation 语义，本轮未深挖；既然 fingerprint 形态会被 verify 拦成「账本不一致」，理论上到不了这里。）
- 我无法在 fd 耗尽/IO 错误下做真实探针（`ulimit -n` 过低会让 libuv 先死），EMFILE/EIO 归类为「同一裸 catch、无 errno 判别」的代码推理；要坐实需要注入式 fs 替身测试。建议在 test/dag-kernel.contract.test.js 里加 EACCES/EISDIR/形状三态用例作为回归钉。
- `evidence list` 的 O(R×N×E) 是否需要升级为发布阻断：现网账本 21 节点（0ms），触发放大需要数千节点 + 若干历史 review 节点——按 ADR 自己的「万边级」规划尺度，我认为应修（一行提位），但严重度取决于账本增长预期。

（写作纪律自检：真仓 `git status --porcelain` 为空、HEAD=116eade、`.lazyzcode/loop/dag.json` mtime 保持 05:59 未被触碰；全部活体探针只落在 `/tmp/v009-review-R1-B/`，对真仓只有 `git log/status/ls`、`dag dependents`、`--help` 等只读命令。）

### R2 · 红绿 manifest 与 evidence CLI

#### R2-A

# R2-A · 红绿 manifest + evidence CLI（正确性镜）— 原件

## 发现

- [P0] V009-R2-A-1 dag.json「在册但读失败」被静默当空账本，下一条写命令整文件覆写 → 红/waive 账本全灭且两条命令都 exit 0
  证据：`core/dag.js:41-45` — `try { text = readFileSync(dagPath(cwd), "utf8"); } catch { return { dagVersion: DAG_VERSION, nodes: [], edges: [] }; }`（注释 `core/dag.js:38` 自述语义应是「缺席=空账本；**在册**但解析失败…=拒绝」，实现把「任何读错误」都当缺席）；`core/dag.js:67-75` saveDag 无条件 tmp→rename 覆写；`plugin/skills/zw/SKILL.md:212-213`「an unreadable ledger … fails closed」；`docs/adr/0014-invalidation-dag-red-green-manifest.md:30`「绝不静默当空库」、`:42-43`「红/waive 边只存在 DAG（丢失不可重算）」
  故障场景：dag.json 存在但 readFileSync 非 ENOENT 失败（chmod/属主变更——本仓文档自身演练过 root/SYSTEM 上下文混跑、杀软短暂持有句柄、被同名目录占位、EIO/EMFILE）→ `lzy evidence list` 报「0 节点 … 红 ✗（未录）」exit 0；紧接着 `lzy evidence red F1 --evidence x` exit 0，用空基底重写 dag.json（id 从 n1 重新起算）→ 此前所有红半/waiver（唯一副本）永久消失，全程无任何警告。已确认 parse/checksum/version 三条路都正确 fail-closed（garbage JSON 与篡改 checksum 均 exit 1 + 恢复指路），**只有读错误这一条 fails open**，而它恰好是唯一会毁数据的那条。判定 P0 依据=P0 定义中的「data loss」；修法一行：`catch (e) { if (e?.code !== "ENOENT") throw new DagError(...); return empty; }`
  最小探针：`/tmp/v009-review-R2-A/p6` — register/plan/start → `evidence red F1 --evidence "PRECIOUS red half"` + `evidence waive-red F1 --reason "precious waiver"` → `chmod 000 .lazyzcode/loop/dag.json` → `lzy evidence list`（exit 0，「0 节点」，红 ✗）→ `lzy evidence red F1 --evidence "new red"`（exit 0）→ `chmod 600` → loadDag 只剩 `n1:red:new red after transient read failure`，两条旧记录消失。

- [P1] V009-R2-A-2 `lzy evidence list` 的「现行绿」取 max(seq)，与统一权威的 goal.json 代次锚定不一致：会渲染权威永不会用的节点、并**完全不显示 finish 真正用的节点**
  证据：`cli/lzy.js:483` `const greens = halves.filter((n) => n.half === "green").sort((a, b) => a.seq - b.seq);` + `cli/lzy.js:486` `const cur = greens[greens.length - 1];` + `cli/lzy.js:496-498`「rebind 链 N 代（gen…→gen…，现行 gen${cur.seq}）」；权威侧 `core/loop.js:926-927` `const gen = s.evidenceSeq ? s.evidenceSeq - 1 : 1; const node = findGreenByGeneration(dag, goal.slug, s.id, gen);`；`docs/adr/0014-…md:52-53`（孤儿 ghost「从不是判定入参；list 的 ⚠ 标注兜底」）；`plugin/skills/zw/SKILL.md:215-217`（comparator 的配对/在场核对以 `lzy evidence list` 为第一来源）
  故障场景 A（同一次注册内，dag-first 半失败）：`step done` 的 saveDag 成功而 writeGoal 失败 → 账本留下 seq=evidenceSeq 的 ghost，goal.json 停在上一代 → list 把 ghost 显示成**唯一/现行**绿并打出「现行 gen2」，被锚定的真节点一行都不出现；随后 finish 放行的正是被隐藏的那个节点。探针实测终验 attestation 写的是 `{"fid":"F1","generation":1,"nodeId":"n3"}`，而 list 里只有 n4（gen2·伪造面 deadbeef·过期）。故障场景 B（`reset` 后同 slug 重注册，正常命令即可达）：新目标 F1 尚 `pending`、零取证，list 却已报「F1 · 绿 ✓ gen2（指纹 … · 新鲜） · 红 ✓ n2 gen1」——上一轮注册的红绿被当作本轮的两半展示（comparator 的 red-green 在场核对会被这行直接骗过）；新目标取证一次后（新节点 gen1 < 旧 gen2）显示的现行仍是旧 superseed 节点，链行为「rebind 链 3 代（gen1→gen2，现行 gen2）」；两处旧绿同时被打上「dag-first 部分失败残留」的错归因。根因=视图没有「注册轮次/锚定代次」概念（`cli/lzy.js:503-507` 的孤儿谓词只以 goal.json 当前代次为基准）。
  最小探针：A = `/tmp/v009-review-R2-A/p3`（capture 后 `appendEvidenceNode(seq = goal.evidenceSeq)` + saveDag 模拟半失败，再 `evidence list` vs `loop finish` + 读 attestation）；B = `/tmp/v009-review-R2-A/p2`（capture → rebind → `loop reset` → 同 slug register/plan/start → `evidence list`，再 `step done` 后复看）。

- [P2] V009-R2-A-3 `pairReds` 永不二次配对：已配对的 red/waive 拿不到第二条 `red_of`，rebind 后当前代次没有任何配对半——与 ADR/注释声明相反
  证据：`core/dag.js:173` `const paired = new Set(dag.edges.filter((e) => e.type === "red_of").map((e) => e.from));` + `core/dag.js:178` `if (paired.has(node.id)) continue;` 对照 `core/dag.js:170-171`「同一 red 节点多条 red_of 合法（rebind 后新配对），查询取最新为现行、全部留作历史」与 `docs/adr/0014-…md:23`（同句）；测试把矛盾钉进了断言：`test/evidence-manifest.contract.test.js:109` `assert.equal(redOfs.length, 1, "已配对 red 不重复配（历史经 supersedes 链可见）")`（用例名却写「多条最新现行」）
  故障场景：red(gen1) → green gen1（`red_of n2→n4`）→ 改码提交 → green gen2（`supersedes n5→n4`）后，当前代次没有 red_of；`lzy dag dependents n2` 仍只答「→ red_of n3」=指向**已被 supersede 的代次**（失效 DAG 的核心查询给出过时依赖），`evidence list` 则显示「红 ✓ n2 gen1」配「绿 ✓ gen2」。E-01 想要的「rebind 后新配对、最新为现行」在机器上不可达。
  最小探针：`/tmp/v009-review-R2-A/p7` — 同序列后 `lzy dag dependents n2`（唯一 red_of 指向 gen1）与 `lzy evidence list`（红标 gen1、绿标 gen2）。

- [P2] V009-R2-A-4 同代次两条红半互相覆写附件：前一条节点记录的 sha256 与它自己记录路径下的文件不再相符
  证据：`core/loop.js:816` `const dest = join(outDir, \`${goal.slug}.${step.id}.${half}.${seq}.${i + 1}${ext}\`);`（`seq = step.evidenceSeq`，在绿半落地前不变）+ `core/loop.js:795-796` 注释只防了红/绿互撞；对照绿半路径 `core/loop.js:636`/`core/loop.js:681` 的 captureGen 每次自增（不会撞名）
  故障场景：`lzy evidence red F1 --evidence … --evidence-file /tmp/red1.txt` 后再录一条带 red2.txt 的红半 → 两节点都指 `.lazyzcode/evidence/t.F1.red.1.1.txt`，目录里只剩 red2 内容，节点 n2 的 `sha256=a4df04…` 变成对文件的假声明（原件按设计已不可依赖）；同形态还出现在 writeGoal 失败后重试 `step done`（captureGen 未推进 → 覆盖 ghost 附件）。
  最小探针：`/tmp/v009-review-R2-A/p1` — `sha256sum .lazyzcode/evidence/t.F1.red.1.1.txt`（951d8b…=red2）对比 n2 账本记录（a4df04…=red1）。

- [P2] V009-R2-A-5 SKILL 机器账本句有两处与代码字面不符（SKILL 是 agent 照着执行的协议文本）
  证据：`plugin/skills/zw/SKILL.md:212-213`「an unreadable ledger or a fingerprint-form record with no ledger node fails closed」——读错误一档不成立（见 V009-R2-A-1）；`plugin/skills/zw/SKILL.md:214-215`「The ledger only records — it adjudicates nothing」与同段 `:209-211`「the ledger is the unified validity authority」自相矛盾，且与 `core/loop.js:915-936`、`core/loop.js:1003-1020` 的机器门（fail-closed 拒 finish）冲突
  故障场景：agent 读到「只记账、不裁决」→ 把账本拒绝当建议、或认为 dag.json 可删可忽略（而它恰是红/waive 唯一副本；ADR 自身写明「丢失不可重算」）；读到「unreadable=fail-closed」→ 在真出现读失败时把空账本当成真实状态处理。
  最小探针：`sed -n '209,217p' plugin/skills/zw/SKILL.md` 三句对照；行为面对照=`p6` 的 garbage JSON（拒，exit 1）vs mode 000（静默 0 节点，exit 0）。

- [P3] V009-R2-A-6 `lzy evidence list` 把 comparator 节点计入「N 节点」却从不渲染
  证据：`cli/lzy.js:456` 的 `nodes` 过滤含 `n.slug === slug` 的 comparator 节点，而渲染只覆盖 `cli/lzy.js:459-460`（plan/review）与 `:470`（evidence）
  故障场景：`lzy attest comparator --file …` 之后 `evidence list` 报「7 节点」而只打印 6 行；HEAVY finish 机器门唯一采信的对照记录在「账本视图」里不可见，人工按 manifest 重建账本内容时数目对不上、且看不到对照结论。
  最小探针：`/tmp/v009-review-R2-A/p4` — attest 后 `lzy evidence list`（「7 节点」实际 6 行）。

- [P3] V009-R2-A-7 `--surface` 对 `waive-red` 被接受但静默丢弃
  证据：`cli/lzy.js:528` 对两种动作统一传 `surfaceExternal`；`core/loop.js:762-773` 只在 `!isWaive` 时建面，无警告
  故障场景：`lzy evidence waive-red F2 --reason "why" --surface "published:v1"` exit 0、节点 surface=null、无任何回显——用户以为豁免已绑定所声明外部面（E-01「各绑各面」语境下尤易误解），manifest 只显示「why」。
  最小探针：`/tmp/v009-review-R2-A/p4` 上述命令 + `node -e` 读节点 surface（null）。

## 已查无发现

- **dag-first 次序与失败原子性**：两处写路径（`core/loop.js:724` saveDag → `:726` writeGoal；`:791` saveDag）都先账本后 goal.json；用只读 loop 目录实测 ledger 写失败时 goal.json 与失败前逐字节相同、无绿节点追加（报错来自 withLock 的 `.lock` mkdir，未落任何盘）。
- **账本三档 fail-closed 读**：JSON 损坏、校验和不符（含篡改 checksum 自造文件）均 exit 1、消息带「红半边只存在于此文件…」恢复指路，且写命令此时拒改 goal.json。
- **输入校验全绿**：无 goal 目录（零 `.lazyzcode` 疤痕、exit 1、恢复式报错）、非 F 项、不存在的步 id、缺 `--evidence`/`--reason`、超长 4001/301、>4 附件、不可读路径、目录当文件、21MB 超限——全部 exit 1 且不留痕。
- **非 git 宿主**：`evidence red` 无 `--surface` 给出「无绑定表面可记…用 --surface」的指路；绿半 surface=null；`finish` 按 unbound 拒（0.0.8 语义一致）；list 如实显示「（无表面）」。
- **并发写**：两个并行 `evidence red` 走 withLock 串行，两节点均在账、checksum round-trip 通过（无丢更新）。
- **rebind 记账正确的一半**：supersedes 方向（新→旧）与链式累积正确；`stalePreview` 把旧代次标「历史代次」；`findGreenByGeneration` 的 (seq, at) 决胜在「同代次重录」（0.0.8 在途 goal 升级恢复、写失败重试）下取最新节点，权威侧判定正确（p3 的 finish 只因此才放行）。
- **代次对齐（正常路径）**：绿 seq=captureGen（读前自增），红 seq=当时 evidenceSeq（即下一绿将落的代次），附件 seq 段与节点 seq 一致（除 V009-R2-A-4 的覆写）。
- **reset 语义**：dag.json、`.lazyzcode/attestations/`、`evidence/<slug>.report.md` 均跨 reset 存活（SKILL「survives reset as history」为真）；无 goal 时 `--goal` 必填且历史读面照常（「无孤儿判定基准」）；doctor state 行对 dag.json 不误报疤痕、孤儿 `.dag.json.*.tmp` 计数与 reset 清扫正确。
- **测试与语法**：`node --test test/evidence-manifest.contract.test.js` 8/8 绿；`node --check` core/dag.js、core/loop.js、cli/lzy.js 全过。
- **工作区卫生**：全部活体探针在 `/tmp/v009-review-R2-A/`（p1–p8）；仓库 `git status --porcelain` 空；未在被审仓执行任何写命令（`loop start` 的限流建议行只读宿主日志，属只读扫描）。

## 开放问题

- **跨注册轮的账本视图**（V009-R2-A-2B）该按什么修：DAG 按 slug 常驻是 ADR 明示设计（「跨 reset 常驻」），所以旧轮节点是合法历史；问题在视图无「轮次」概念。是给 goal.json 加 registration/attempt 轴并在节点上落轮次、还是让视图只认「本轮 plan 节点之后的节点」，属设计拍板，我无法从代码单方判定。
- **`shortNode` 的 comparator 分支**（`cli/lzy.js:432-439`）：一个 comparator 节点若被某条边指向会被打印成「review」；现有代码只产生 from=comparator 的边，我构造不出活体序列，故未列为发现——若未来给 comparator 加被引边（如 evidence→comparator），这就是个真错标。
- **V009-R2-A-1 在目标平台的触发频率**：我只用 POSIX chmod 000/EISDIR 家族证明了语义；Windows 上杀软持有句柄导致的 EPERM/EBUSY 读失败是否常见，需要在 win32 VM 上复现（`lzy evidence red` 前保持 dag.json 被外部进程打开）才能定量——但语义本身（读失败→清空重写）已由探针钉死。
- **`evidence list` 的 red 面「配对代次」是否要显示**：ADR 说 comparator 以 list 为第一来源做配对核对，但 list 现在只印 red 自己的 seq，不印它配到的 green；若 comparator 的 prompt 依赖配对（而非在场），则 V009-R2-A-3 的实际后果会更大——需要看 qa-executor 的实际对照协议文本（不在本轮代码范围）才能定级。

#### R2-B

# R2-B · 红绿 manifest + evidence CLI（对抗镜）— 原件

## 发现

- [P1] V009-R2-B-1 `lzy evidence list` 无尝试/代次锚定：上一次（已 reset）尝试的绿节点被当作「现行」，本次尝试从未取过的红半被报「红 ✓」
  证据：`cli/lzy.js:483` — `const greens = halves.filter((n) => n.half === "green").sort((a, b) => a.seq - b.seq);` + `cli/lzy.js:486` — `const cur = greens[greens.length - 1];`（`halves` 来自 `byStep`＝按 slug 聚合的全账本节点，无尝试/代次过滤；只按 seq 取最后，不按 goal.json 的 `evidenceSeq-1` 锚定）；`cli/lzy.js:490` — `const redPart = reds.length ? \`红 ✓ ${reds.map(…)}\``（红/waive 只判「同 slug+step 是否存在节点」）；`cli/lzy.js:497` — `现行 gen${cur.seq}`；`cli/lzy.js:505` — `const st = stepsById.get(n.step); return !st || n.seq > (st.evidenceSeq ?? 1) - 1;`（孤儿判定以 goal.json 为基准，证明视图本就该相对当前 goal，却把上次尝试的绿判成「dag-first 部分失败残留」）。对照门与机器证明：`core/loop.js:926-928`（`const gen = s.evidenceSeq ? s.evidenceSeq - 1 : 1; const node = findGreenByGeneration(dag, goal.slug, s.id, gen)`）与 `core/loop.js:1093-1096`（终验 attestation 同锚定）。
  故障场景：attempt1 对 F1 取证两次（绿 gen1、gen2）后 `loop reset`；同 slug 重新 `register`+`plan`+`start`；本次只做一次 `step done F1`（从未记红）。`lzy evidence list` 输出 `F1 · 绿 ✓ gen2（指纹 5a91ad4610 · 历史代次） · 红 ✓ n2 gen1（指纹 45cebba75e）`＋`rebind 链 3 代（…现行 gen2）`＋`⚠ 孤儿节点 n4（t/F1 gen2）：…dag-first 部分失败残留`——绿槽指向死尝试的 n4（非现行，且现行绿 n6 根本不出现），红槽是把 attempt1 另一棵树上的红当成本次的红半，孤儿诊断亦为误报。同一份账本上，终验 attestation 记的是 `{"fid":"F1","generation":1,"nodeId":"n6"}`、`verify` 报 `新鲜 1：F1`（指纹 5a91ad4610），即门与机器证明用 n6、manifest 视图用 n4——两个面互相矛盾，而 ADR-0014 §E-01 明定 comparator 的配对/在场核对以 `lzy evidence list` 为第一来源（`docs/adr/0014-…md:24-26`），可由误判「红绿两半在场」诱出 HEAVY 的 MATCH 对照。测试缺口：`test/evidence-manifest.contract.test.js:146-155` 只测了 reset 后**无 goal** 的 `--goal` 读面，未覆盖「goal 在场且 slug 相同」这一含毒分支。
  最小探针：`/tmp/v009-review-R2-B/probe8`（已建好）：`node cli/lzy.js evidence list` → 见上（n4/「现行 gen2」）；`node -e "…readFileSync('.lazyzcode/attestations/'+…)"` → `evidence anchors: [{"fid":"F1","generation":1,"nodeId":"n6",…}]`。修向：绿槽按 `findGreenByGeneration(dag, slug, fid, (step.evidenceSeq??1)-1)` 锚定（与门同源），红/waive 与孤儿判定同样受当前代次/尝试约束。
- [P1] V009-R2-B-2 `attachHalfFiles` 目标路径非唯一：同代次第二份红半附件静默覆写第一份（账本里的 sha256 永久对不上），失败的命令同样覆写并把文件留在磁盘
  证据：`core/loop.js:777` — `const seq = step.evidenceSeq ?? 1;`（同一代次内重复记红，seq 恒同）＋`core/loop.js:816` — `const dest = join(outDir, \`${goal.slug}.${step.id}.${half}.${seq}.${i + 1}${ext}\`);`（目标名不含节点身份）＋`core/loop.js:817` — `copyFileSync(src, dest);`＋`core/loop.js:780` — `const dag = loadDag(cwd);`（读账本在拷贝**之后**，故账本不可读时的「整命令拒」也会先落地拷贝）。对照绿半：`core/loop.js:636` 用 `captureGen` 且每次收口自增，故绿半同尝试内不覆写——红半没有这个保护。
  故障场景：（a）`evidence red F1 --evidence "first" --evidence-file r1.txt` 后再 `evidence red F1 --evidence "second" --evidence-file r2.txt`（同代次、同扩展名、同序号）→ r2 覆盖 `t.F1.red.1.1.txt`，n2 记录的 `sha256 71315f1d…` 与盘上内容（`RED-CAPTURE-TWO`，`5775e3b2…`）永久不符，第一份归档取证被销毁（ADR-0014 自述红半「丢失不可重算」）；（b）`dag.json` 损坏（JSON 解析失败）时再跑同样的 `evidence red … --evidence-file`：命令 `exit=1` 报「账本损坏…整命令拒」，但 `t.F1.red.1.1.txt` 已被换成第二份内容；若目标名是新的（如 `.png`），则留下一个任何账本节点都不引用、也永不出现在证据包里的孤儿文件。
  最小探针：`/tmp/v009-review-R2-B/probe3`（已建好状态）：`node -e "…n.files 逐条重算 sha 对比"` → `n2 red seq1 …/t.F1.red.1.1.txt recorded=71315f1d8c60 onDisk=5775e3b2c549 *** MISMATCH ***`；损坏账本变体见 `/tmp/v009-review-R2-B/probe5`。
- [P2] V009-R2-B-3 `pairReds`/`addSupersedes` 跨尝试连线：把上一次尝试的红半配给本次的绿半，且 supersedes 出现代次倒挂
  证据：`core/dag.js:173` — `const paired = new Set(dag.edges.filter((e) => e.type === "red_of").map((e) => e.from));`＋`core/dag.js:176-180` — 只按 `slug+step` 找**尚无 red_of 边**的 red/waived 节点并配给本次绿（无尝试/代数过滤）；`core/loop.js:719` — `if (priorGreen) addSupersedes(dag, priorGreen.id, greenNode.id);`（`priorGreen = findLatestGreen(...)` 跨 reset 取全账本最新绿）。
  故障场景：attempt1 记红后未收口（红永远没有 red_of）→ `loop reset` → 同 slug 重注册 → 本次 `step done F1`（本次从未记红）→ 账本产生 `red_of:n2->n4`，把另一棵树上的红声明为本次绿的红半，completing 了「配对」这一机器痕迹；视图据此显示 `红 ✓ n2 gen1`。同根因的另一半：probe1 中 `supersedes:n7->n4`（新尝试 gen1 supersede 旧尝试 gen2），使 `stalePreview` 把死尝试的 gen2 标成「历史代次」，正是 R2-B-1 中「绿槽＝n4」现象的来源。
  最小探针：`/tmp/v009-review-R2-B/probe2`：`node -e "…d.edges.filter(e=>e.type==='red_of'||e.type==='supersedes')"` → `red_of:n2->n4`（本次全流程未记红）。
- [P2] V009-R2-B-4 manifest 视图无 legacy 轨道：legacy treeHash 证据被报「绿 ✗（未录）」，而门按 legacy 双轨接受它（可把 HEAVY 对照引到 MISMATCH）
  证据：`cli/lzy.js:483-487`（绿槽只从账本节点取，函数内无 `goal.json`/`step.evidence` 回退分支）；对照 `core/loop.js:937-943`（`// legacy 单树轨（0.0.7 证据对象，无账本节点）：行为与 0.0.7/0.0.8 全同`）。
  故障场景：一个 0.0.7 时代在途 goal（F 项为 `{text,treeHash}`、无 `evidenceSeq`）升级到 0.0.9：`lzy loop verify` 报 `新鲜 1：F1`、`lzy loop finish` 通过并写 LOOP_COMPLETE，而 `lzy evidence list` 同一时刻输出 `F1 · 绿 ✗（未录） · 红 ✗（未录）`——视图声称该 F 项没有绿半。HEAVY 目标下 comparator 以该视图为第一来源，会得到「绿半缺席」→ 记 MISMATCH → finish 机器门（`core/loop.js:1002-1019`）永久拒绝一个门本身接受的终验；ADR-0014 只承诺 verify/finish 的 legacy 双轨，视图这条轨道没有任何说明。
  最小探针：`/tmp/v009-review-R2-B/probe11`（goal.json 已改写为 legacy 形态、账本只留 plan 节点）：`node cli/lzy.js loop verify` → `新鲜 1：F1`；`node cli/lzy.js evidence list` → `F1 · 绿 ✗（未录） · 红 ✗（未录）`。
- [P3] V009-R2-B-5 `--surface` 的三处静默降级：无值/空值悄悄改绑复合指纹；`<节点id>` 形状的外部表面不可查；`waive-red --surface` 被丢弃
  证据：`cli/lzy.js:77-85`（值旗标无值或下一参数以 `--` 开头时 `push(k, true)`）＋`cli/lzy.js:528` — `surfaceExternal: typeof f.surface === "string" ? f.surface : null`＋`core/loop.js:763-772` — `if (!isWaive) { if (surfaceExternal) {…external…} else { …fingerprint… } }`＋`core/dag.js:237` — `if (/^n\d+$/.test(ref)) {`（先判节点 id）。
  故障场景：`lzy evidence red F1 --evidence "已发布版 0.0.8 上失败" --surface`（忘带值，或值以 `--` 开头）→ `exit=0`，节点绑定的是**复合指纹**而非操作者声明的外部表面，视图随后把它显示成「指纹 …」（即 E-01 的 base 树义），操作者以为记的是外部面；`--surface ""` 同。`--surface n9` 记账成功且视图显示 `external:n9`，但 `lzy dag dependents n9` 返回 `依赖查询 · node n9 · 命中 0`（被当节点 id 处理），该外部表面无法用自身值查询。`lzy evidence waive-red F1 --reason … --surface "published:0.0.8"` → exit 0，表面被静默丢弃（无任何提示）。
  最小探针：`/tmp/v009-review-R2-B/probe4`（`--surface n9` → `dag dependents n9` = `node n9 · 命中 0`）与 `/tmp/v009-review-R2-B/probe6`（第 6/7 项：dangling `--surface` 落 `fingerprint:`；`waive-red --surface` 无输出）。
- [P3] V009-R2-B-6 视图静默吞掉已入账数据：同代次 waiver 被红半遮蔽；红半附件在所有读面与证据包中不可达
  证据：`cli/lzy.js:490-494` — `const redPart = reds.length ? \`红 ✓ …\` : waives.length ? \`红 ➖ waived…\` : "红 ✗（未录）"`（存在红时 waived 节点不再输出）＋`cli/lzy.js:493`（红半只印 surface 短码，不含 `files`）＋`core/loop.js:1161-1162`（证据包附件只来自 `goal.json` 的 `s.evidence.files`，即只含绿半）。
  故障场景：对同一 F 项先 `evidence waive-red F1 --reason "纯可达性面构造不出反态"`（n5）再记红（n2/n3/n4）→ `lzy evidence list` 只见 `红 ✓ n2 n3 n4`，豁免记录（连同理由）在唯一视图里消失，账本里却仍在；另：`evidence red … --evidence-file shot.png` 记入的附件路径只出现在记录当时的 stdout，`evidence list`、`dag dependents`、`loop export` 都读不到它，人会以为红半取证已归档进证据包。
  最小探针：`/tmp/v009-review-R2-B/probe6`（`evidence list` 三条红、无 waived 行；`ls .lazyzcode/evidence/` 有 `t.F1.red.1.1.bin`、`t.F1.red.1.1.txt` 而任何命令都不显示它们）。
- [P3] V009-R2-B-7 账本查询面把 comparator 节点标成 review，出边只印裸 id
  证据：`cli/lzy.js:432-440` — `return \`${node.id} review ${String(node.planHash).slice(0, 10)} ${String(node.verdict ?? "").slice(0, 40)}\`;`（非 evidence/plan 的节点一律按 review 渲染，comparator 节点落此）＋`cli/lzy.js:576-580`（outgoing 打印 `h.edge.to` 原文）。
  故障场景：记对照 attestation 后 `lzy dag dependents n1` 输出 `← attests n3 review 611bfd179a MATCH` —— 一条 attests 边、comparator 节点被标成 review，读者会把对照结论误认成计划评审节点（`shortNode` 又对 outgoing 只印 `→ attests n1` 裸 id，同一行的可读性两侧不一致）。kind 是「什么依赖 X」查询的全部语义所在。
  最小探针：`/tmp/v009-review-R2-B/probe4`：`node cli/lzy.js dag dependents n1` → `→ plans t` / `← attests n3 review 611bfd179a MATCH`。

## 已查无发现

- 门侧代次锚定的跨尝试碰撞：构造 attempt1 两代绿 + attempt2 一代绿（probe8）、attempt1 一代 + attempt2 一代（probe2）等组合，`findGreenByGeneration` 恒选中新尝试节点（`(seq, at)` 决胜 + `at` 单调），`verify`/`status`/终验 attestation 三者一致。
- 0.0.8 在途 goal 升级的 fail-closed 与文档恢复链全通（probe7）：`loop status`/`loop verify` 拒（exit 1、带恢复指路）→ `step done F1 --evidence` 重录 → `verify` 新鲜 → `finish` 通过并出 attestation。
- 账本不可读 fail-closed 全读面：`evidence list`/`dag dependents`/`loop status`/`loop verify` 均 exit 1 并给同一恢复文案（probe9）；写面 `evidence red` 同样拒（probe5）。校验和能挡住内容级篡改（改 `text` 即拒）。
- 锁纪律：`withLock` 全部 14 个调用点（`core/loop.js:168/205/443/459/480/590/608/736/850/966/1196/1315/1333` + `core/attest.js:28`）逐一复核，全部 DAG 写点（`loop.js:571/706/780`、`attest.js:60`）都在锁内 load→save，无嵌套加锁、无锁外写；读面（`status`/`verify`/`dag dependents`）无锁读依赖原子写。
- 敌意输入：目录、FIFO、21MB 文件、无扩展名、带空格与括号的名字、symlink → 全部按既有语义拒或安全归档（probe6）；扩展名正则 `(\.[a-z0-9]{1,9})$` 白名单（`core/loop.js:815`）不含 `.`/`/`，无法构造路径穿越。
- 前置与上限拒：未知 id、非 F 项、缺 `--evidence`、4001 字符证据、5 个附件、301 字符豁免理由 → 全部 exit 1 且文案带指路（probe9 a–f）。
- 红/绿附件同代次互不覆写（`half` 段隔离）：probe6 中同代次并存 `.bin` 与 `.txt` 两份互不影响（同 half 的覆写已单列为 R2-B-2）。
- 无 goal 的写/读路径零疤痕：`evidence list`、`evidence red` 在空目录均 exit 1 且不建 `.lazyzcode/`（probe12；契约测试 `test/evidence-manifest.contract.test.js:137-144` 同结论）。
- `reset` 的 `.dag.json.*.tmp` 家族清扫与 doctor 豁免按契约测试路径复核一致（`core/loop.js:1341-1344`）。

## 开放问题

- 我判 R2-B-1 为 P1 的依据是 adr-0014:24-26 与 SKILL §4 把 `lzy evidence list` 定为 comparator 的配对/在场第一来源；若维护者认为该视图只在同一 goal 生命周期内被读（reset 后必换 slug），则它降为 P2。可定夺的判据：是否存在「reset 后同 slug 重注册」的官方流程承认——ADR-0014 增补节自述「同 slug 重注册再 finish 天然新 id」，我据此认为该流程在册。
- R2-B-2 的定性（P1 归档件损毁 vs P2 边界缺陷）取决于是否承认 `.lazyzcode/evidence/` 的副本是红半的「证据本体」。ADR-0014 写「红/waive 边只存在 DAG（丢失不可重算）」——但附件本体不在 DAG 里，只在磁盘上；需要一个明确的「红半附件是否属不可重算资产」定义。
- 我未能触及（需维护者知识）：0.0.7 时代真实在途 goal 的存量规模——R2-B-4 的实际影响面取决于此；可用一次全盘扫描（各仓 `.lazyzcode/loop/goal.json` 中 F 项是否含 `treeHash` 且无 `evidenceSeq`）定夺。
- 范围外但顺带观察（未展开、未计入发现）：`docs/guide/en.md:344-366` 的 Evidence-discipline 节仍把双证据写成纯文本纪律，未提机器账本/`lzy evidence red`/`evidence list`（本轮 diff 只在该文件的 CLI 命令围栏里加了一行注释）。
- 写纪律：本轮全部实弹探针在 `/tmp/v009-review-R2-B/probe{1..12}` 内；仓库内只做 git 读/grep/Read，`git status --porcelain` 为空，仓库根 `.lazyzcode/`（goal `v009-five-round-dual-review`，mtime 06:18）非我创建，我未在其内写入。

### R3 · 统一权威 + 门 + attestation

#### R3-A

# R3-A · 统一权威 + 门 + attestation（正确性镜）— 原件

## 发现

- [P1] V009-R3-A-1 HEAVY 目标在「计划无 F 项」时死锁：finish 强制对照 attestation，而 `lzy attest comparator` 拒绝无 F 项的目标，两侧都无逃生门
  证据：`core/loop.js:1002-1008` — `if ((goal.tier ?? "light") === "heavy") { comparator = findLatestComparator(dag, goal.slug, goal.planHash); if (!comparator) { throw new LoopError("HEAVY finish 需对照 attestation 且 MATCH：…机器门无逃生 flag") } }`；`core/attest.js:86-89` — `const fIds = goal.steps.filter((s) => s.kind === "F").map((s) => s.id); if (fIds.length === 0) { throw new LoopError("本目标无 F 项——对照 attestation 无对象可记（无终验项的目标无需对照）") }`。计划门只要求 `items.length > 0`（`core/loop.js:526`），无 F 项要求；`setTier` 允许 executing 态升 heavy（`core/loop.js:203-229`）；`loop finish` 无 `--force`（`cli/lzy.js` 仅 `loop plan` 收 `--force`）。
  故障场景：`lzy loop register t-heavy --title x --tier heavy` → 采纳只含 N 项的计划（实测门输出「N:1 F:0」）→ `step done N1` → `loop finish` 被 HEAVY 门拒 → 按提示执行 `lzy attest comparator --file ...` 被「本目标无 F 项」拒。中途升级路径同样可达：light 目标跑到最后一步 → `lzy loop tier heavy` → finish 同拒、attest 同拒。唯二出口是 abandon/reset（目标销毁，只剩 salvage 存根）。
  最小探针（/tmp/v009-review-R3-A/probe1 与 /tmp/v009-review-R3-A/G 实测）：
  ```
  printf -- "- [N1] do a thing\n" > /tmp/p.md
  lzy loop register t-heavy --title x --tier heavy && lzy loop plan /tmp/p.md --review "plan-reviewer: VERDICT: PASS"
  lzy loop start && lzy step done N1 --note x
  lzy loop finish                            # exit=1 「HEAVY finish 需对照 attestation 且 MATCH」
  lzy attest comparator --file /tmp/v1.json  # exit=1 「本目标无 F 项——对照 attestation 无对象可记」
  ```
  修复方向二选一：计划门对 heavy 强制 ≥1 F 项，或对照门对「无 F 项」放行一行豁免说明。

- [P2] V009-R3-A-2 comparator 门只绑树、不绑证据：一次对照记录可背书从未被对照过的 F 证据（两条常规流程可达）
  证据：`core/loop.js:1003` — `comparator = findLatestComparator(dag, goal.slug, goal.planHash)`；`core/dag.js:218-223` — `findLatestComparator` 仅按 `kind/slug/planHash` 过滤后取 `at` 最新；`core/loop.js:1016` — `if (comparator.fingerprint !== fingerprint)` 是唯一新鲜性判据（复合指纹=树）；`core/attest.js:61-69` + `core/dag.js:138-157` — comparator 节点只持 `slug/planHash/fingerprint/fileSha256/items`，**不含任何绿节点 id / generation / 证据文本 sha**，而门里本已能算出当前锚定绿节点（`core/loop.js:1096-1098` 的 `findGreenByGeneration`）。
  故障场景 A（同树重取证）：heavy 目标 F1 取证 "v1" → 录 MATCH（basis 写 'v1'）→ 代码未变（指纹不变）时重跑 `lzy step done F1 --evidence "SWAPPED…"` → `finish` 通过；终验 attestation 的 anchor 指向新绿节点（text=SWAPPED），而 comparator 记录是按 v1 做的对照。
  故障场景 B（reset 后复用计划——被协议鼓励的流程，`core/loop.js:1419` 存根明写「PASS 评审文本可复用重采纳」）：跑完一个 heavy 目标留下 MATCH → `lzy loop reset` → 同 slug 重新 register + 采纳**同一份计划文件**（planHash 相同）+ 同一棵树 + 全新证据文本 → finish 直接通过，用的是**上一个实例**的对照记录（dag.json 跨 reset 常驻）。
  最小探针：`node /tmp/v009-review-R3-A/probe-a.mjs`（C 段）与 `probe-c.mjs`；实测输出：`finish status: done — gate satisfied by instance 1's comparator record`；`comparator basis: [{"fid":"F1","verdict":"MATCH","basis":"compared against 'v1 evidence text'"}]` vs `anchored green node text: "TOTALLY DIFFERENT EVIDENCE v2"`。
  说明（避免过度指认）：实现与 ADR-0014 增补节逐字一致（ADR 把新鲜性锚定在指纹上），故记为门覆盖范围缺口而非实现反例；后果是 HEAVY 机器门可对「从未被对照过的那份证据」出 MATCH。

- [P2] V009-R3-A-3 终验 attestation 的「各根头树」与「复合指纹」采样时刻不同：finish 窗口内落地的提交可产出自我矛盾的 LOOP_COMPLETE，把未验证过的树记为完成树
  证据：`core/loop.js:917` — `const fingerprint = fingerprintSubjects(cwd, goal.subjects ?? []);`（此刻采样，`core/loop.js:981` 用于判新鲜与对照门）；`core/loop.js:1027-1047`（完整性闸门，预算内逐根 spawn）；`core/loop.js:1053-1061`（报告渲染时又 `git.headTreeHash()` 一次）；`core/loop.js:1107-1110` — `subjects: [resolve(cwd), ...(goal.subjects ?? [])].map((root) => ({ root, headTreeHash: createGit(root).headTreeHash() }))`（**再次**采样）。没有任何代码把二者对齐或复核。
  故障场景：另一会话在 finish 窗口（指纹计算 → 闸门 → 报告渲染 → attestation 写入，含 1+N 次无预算 git spawn）内提交 → 闸门看 `git status` 干净（提交不留脏）→ finish 放行 → attestation 里 `headTreeHash` 是新树、`fingerprint` 是旧树，F 证据被判定新鲜的树从未包含这次提交；`报告 sha256` 对应的报告的「当前 tree」行同样自相矛盾。
  最小探针：`node /tmp/v009-review-R3-A/probe-a.mjs`（B 段）——把提交放在 `writeReport` 回调里模拟并发提交：
  ```
  finishLoop(d, createGit(d), { writeReport: ({cwd,git,goal}) => { writeFileSync(...); git commit -am race; return writeGoalReport(cwd,git,goal) } })
  ```
  实测：`finish status: done`；`fingerprint recorded: c49fdbe643…` ≠ `composite of recorded head tree: ceb4885f57…`；attestation 记录的头树已是提交后的新树。窗口与 ADR-0013 记名的「ms 级 TOCTOU 残差」不同量级（0.0.9 又把报告+attestation 放进同一窗口）。修复方向：attestation 用刚读到的头树复算指纹并断言相等，或把 stale 复核挪到报告/attestation 之后。

- [P2] V009-R3-A-4 attemptId 秒粒度：同 slug 的第二次 finish 落在同一秒时静默覆写上一份 LOOP_COMPLETE，与 ADR「追加不覆写」不符
  证据：`core/loop.js:1083` — `const attemptId = \`${goal.slug}-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}\``；`core/loop.js:1119-1122` — `writeFileSync(tmp, …)` + `renameSync(tmp, p)`（同名即覆盖，无存在性检查/序号退避）；`docs/adr/0014-invalidation-dag-red-green-manifest.md:70` — 「attemptId（=`<slug>-<finish 时刻 UTC 紧凑串>`，秒粒度，追加不覆写）」（同 slug 重注册再 finish 的「天然新 id」依赖两次 finish 不落在同一秒）。
  故障场景：`reset` 后同 slug 重注册、按同一计划跑到 finish——上一实例的 goal.json 已被 reset 销毁，`attestations/<slug>-<秒>.json` 是它留在盘上的**唯一机器完成证明**；第二次 finish 落在同一秒即把它 rename 覆盖掉，无任何提示。
  最小探针：`node /tmp/v009-review-R3-A/probe-b.mjs`（A2 段，6 连跑，核心直调重跑耗时 253–508ms）实测 **5/6 覆写**：
  ```
  run 0: OVERWROTE (re-finish took 253ms) — 1 attestation file left
  ...
  overwrite runs: 5/6
  ```
  （CLI 逐条 spawn 更慢、命中率更低，但这是边界条件而非互斥保证。）修复方向：`existsSync(p)` 时追加 `-2`/纳秒后缀，或把 attemptId 改为计划完成时刻+序号。

- [P3] V009-R3-A-5 attestation 写失败时报告已按 done 落盘：goal 仍 executing，而 `lzy loop history` 报 done
  证据：`core/loop.js:1051-1053`（内存置 `goal.status="done"`）→ `core/loop.js:1053-1061`（writeReport 落盘，报告头写 `- 状态 done · … · 完成 <ts>`）→ `core/loop.js:1064-1071`（attestation 写失败即 LoopError，`goal.json` 不落盘、保持 executing）；`core/loop.js:1686`（`formatHistory` 从报告头 `- 状态 (\S+)` 取状态）。
  故障场景：任何 attestation 写失败（目录被同名文件占位、权限、磁盘满）→ finish 拒且状态保持 executing，但盘上证据包已声明 done，`lzy loop history` 对人报 `done`——人读面对未完成目标说谎。
  最小探针：`node /tmp/v009-review-R3-A/probe-b.mjs`（D 段）——把 `.lazyzcode/attestations` 换成同名普通文件后 `finishWithReport(d)`，实测：
  ```
  finish threw: 终验 attestation 写失败（finish 未置 done，状态保持 executing）…
  goal.json status: executing
  report on disk says: - 状态 done · 创建 … · 完成 2026-09-16T22:05:27Z
  lzy loop history: d1  done  —  证据包✓
  ```
  仓库测试只固化了反向分支（报告先败=无 attestation 残留，`test/dag-authority.contract.test.js:307-326`），本条为测试缺口。

- [P3] V009-R3-A-6 0.0.9 在 finish 锁内新增无预算 git spawn：「8s 共享墙钟预算（< LOCK_STALE_MS 留余量）」不再成立
  证据：`core/loop.js:1025-1034`（`GATE_BUDGET_MS = 8_000`，仅 `remaining <= 0` 才 fail-closed）vs `core/git.js:68` — `const to = Math.max(1_000, Math.min(10_000, timeoutMs))`（同一 `to` 供 rev-parse 与 status **两次** spawn，单根最坏 2×`to`）；`core/loop.js:1107-1110` attestation 每根再 spawn 一次 `headTreeHash()`（10s 超时，完全在预算外）；`core/loop.js:73-74` `LOCK_STALE_MS = 10_000`、`LOCK_WAIT_MS = 5_000` 与 `core/loop.js:97-100` 的抢锁分支。
  故障场景：多 subject + 慢仓 → finish 持锁 >10s → 另一进程此刻开始等待即命中 `ageMs > LOCK_STALE_MS`，rm 锁进入临界区 → 两边并发改 goal.json；finish 末尾 `writeGoal(cwd, goal)`（`core/loop.js:1072`）写的是**本进程开头读到的内存 goal**，静默覆盖对方刚落盘的 step/evidence 更新（丢更新）。
  最小探针（实测超发，非大仓构造）：用慢 git 垫片把 `integrity` 的剩余预算设成 50ms，
  ```
  printf '#!/bin/sh\nsleep 0.4\nexec /usr/bin/git "$@"\n' > /tmp/shimbin/git
  PATH=/tmp/shimbin:$PATH node -e '…createGit(process.cwd()).integrity(50)…'
  ```
  实测 `elapsed ms: 1261`（两次 spawn 各吃 1000ms 地板）；另一变体（git sleep 3）实测 50ms 预算烧掉 1013ms 后以 `state:"error"` 收尾。即「共享 8s 预算」对余量 ≤1s 的分支不具约束力，多根累加可超 `LOCK_STALE_MS`。修复方向：把 1s 地板改为「余量被耗尽即直接 fail-closed」，并把 attestation 的根树读取纳入同一预算。

## 已查无发现

- **代次算术全序对照**：`captureGen = step.evidenceSeq ?? 1`（`core/loop.js:680`）与 `gen = s.evidenceSeq ? s.evidenceSeq - 1 : 1`（`:926`/`:1096`）严格同源；`evidenceSeq` 首次取证后恒 ≥2（`:700`），gen=0 只在手改状态文件时出现且 fail-closed。
- **dag-first 半失败四种交错**都无假新鲜：①首取中断（goal 无 evidence，步非 done→跳过）；②rebind 中断（goal 保留旧代次+旧指纹 → 锚定旧绿节点 → 代码已变即 stale 拒）；③账本写失败（命令整拒，goal.json 字节不动）；④账本被截断（fingerprint 形态无节点 → `core/loop.js:931-936` fail-closed 带 rebind 指路）。
- **同代次多绿节点**：`findGreenByGeneration` 按 `(seq, at)` 取最后一条（`core/dag.js:208-215`），Array.sort 稳定 → 后追加者胜，重试路径判定正确；孤儿 ghost（更高代次）不可现行也不阻断（`test/dag-authority.contract.test.js:195-211` 实测通过）。
- **`fingerprintSubjects` 语义**（`core/loop.js:421-437`）：host 恒用 `resolve(cwd)` 且参与 realpath 归一；按 realpath 排序对声明顺序免疫；`null`/非数组 roots 归 `[]`（`Array.isArray` 守卫）；根消失时以存储路径参与排序、哈希记 `"missing"`（不可能是 40-hex 头树，无碰撞）；重复 subject 在三个入口（头解析 `:398-402`、`addSubject`、`validateSubjectRoot` 的包含关系门）都被 realpath 去重。
- **`?? []` 归一一致性**：`verifyEvidence`（`:917`）、finish 闸门遍历（`:1027`）、`writeFinalAttestation`（`:1107`）、`attest.js:56` 全部归一；`doCompleteStep`/`doRecordEvidenceHalf` 直接把可能 undefined 的 `goal.subjects` 交给 `fingerprintSubjects`，该函数内部归一。`goal.subjects` 被手改成字符串时闸门遍历字符→逐字符 not-git 必拒（fail-closed，不构成绕过）。
- **legacy 双轨无跨树漏洞**：`treeHash` 形态走单树比对（`:942-947`），但该形态只可能来自 ≤0.0.7（当时无 subjects 特性，`goal.subjects` 必空），故不存在「声明了 subject 却按单树判」的假新鲜路径；0.0.8 起证据恒写 `fingerprint`。
- **planHash 绑定**：复采纳（含同内容再采纳）使 planHash 变化或不变都语义正确——变化后旧 comparator 记录因 `core/dag.js:219` 的 `planHash ===` 过滤不可命中（`test/dag-authority.contract.test.js:265-267` 实测）；MISMATCH 记录不可被旧 MATCH 覆盖（取 `at`/id 最新）。
- **tier 只升不降**：`setTier` 拒绝 heavy→light（`core/loop.js:212-214`）；手改 goal.json 属用户自有状态，不计缺陷。
- **`.lazyzcode/` 豁免范围**：按根各自适用（host 与 subject 各自的 `.lazyzcode/` 都不计该根脏），porcelain 下未跟踪 `.lazyzcode/` 以 `?? .lazyzcode/` 形态出现并被 `startsWith(".lazyzcode/")` 命中。我假设的「用带 ` -> ` 的文件名把脏文件伪装成豁免路径」经探针证伪：豁免要求末段以 `.lazyzcode/` 开头，而文件名不能含 `/`（`touch "a -> .lazyzcode/zzz"` 直接失败，porcelain 仅出 `?? .lazyzcode/`）。
- **doctor payload-ver**：三态与代码一致（本机实测 `✔ payload-ver 缓存 [0.0.1…0.0.9] · CLI 0.0.9 一致`；warn/skip 由契约测试覆盖），缓存路径常量与真实安装布局一致（`~/.zcode/cli/plugins/cache/lazyzcode-local/lazyzcode/<ver>`），版本两侧实读无写死。
- **`attest.js` schema 面**：slug 不符 / 未知 fid / 非法 verdict / 重复 fid / 漏项五拒齐备（`attest.js:83-113`），空 items 与「本目标无 F 项」互不遮蔽；`attests` 边在 plan 节点缺席时静默跳过（`attest.js:73-74`）不影响任何判定（门不读该边）。
- **基线回归**：`node --test test/dag-authority.contract.test.js` 16/16 绿（25.0s，Node v24.19.0），含「权威翻转」「legacy 双轨」「分歧 fail-closed」「损坏账本双拒」「孤儿 ghost」「HEAVY 四态」「终验字段齐」「payload-ver 三态」。
- **仓库零写入**：全程只读；`git status --porcelain` 保持空，`.lazyzcode/` 下无 2h 内改动。所有探针写入都在 `/tmp/v009-review-R3-A/`（含 `node --test` 的 mkdtemp 目录）。

## 开放问题

1. **comparator 门的覆盖范围是否算缺陷**：ADR-0014 增补节把新鲜性锚定在指纹（树）上，实现逐字一致；「记录未覆盖被交付证据」是否在 0.0.9 的承诺之内，需要维护者裁决（P1 还是 P2 取决于此）。若要收口：门里已能算出当前锚定绿节点 id，把它写进 comparator 节点并在门里比对即可。
2. **终结 attestation 是否应自证一致**：`fingerprint == sha256(排序后各根 realpath\0headTreeHash)` 这条不变量目前无人校验（本次是外部脚本复算发现的，见 V009-R3-A-3）。需要在实现侧（复算+断言）还是在审计侧（外部校验器）落地，属设计取向。
3. **三处「无 F 项 HEAVY」的意图**：是「heavy 必须含 F 项」（那计划门/`tier heavy` 升级点应拦），还是「允许无 F 项」（那对照门需要一行豁免语义）？静态无法判定，需拍板。
4. **锁抢窗的实际可达性**：`LOCK_STALE_MS` 抢锁需 finish 实测 >10s。本机没有 5 万文件级大仓，我只测到「50ms 预算烧 1261ms」这一超发证据；真正 >10s 的 finish 需要在大仓/慢盘上计时。
5. **attestation 的读面**：除 finish 的回执单行外，没有命令读取/校验 `.lazyzcode/attestations/*.json`（`loop history` 不看），其完整性（sha、篡改）也无人复核——是否需要 `lzy attest verify`/history 列示，属 0.0.10 范围问题。

#### R3-B

# R3-B · 统一权威 + 门 + attestation（对抗镜）— 原件

## 发现

- **[P1] V009-R3-B-1 HEAVY comparator attestation 只绑 slug+planHash+指纹，不绑它裁决过的证据：可先于证据落账、可在 rebind 后复用、可跨 reset/重开复用**
  证据：`/Users/acfufu/Codehub/lazyzcode/core/loop.js:1002-1005` — `if ((goal.tier ?? "light") === "heavy") { comparator = findLatestComparator(dag, goal.slug, goal.planHash); if (!comparator) throw …`；`/Users/acfufu/Codehub/lazyzcode/core/dag.js:219` — `const nodes = dag.nodes.filter((n) => n.kind === "comparator" && n.slug === slug && n.planHash === planHash);`（唯一现行判据）；`/Users/acfufu/Codehub/lazyzcode/core/attest.js:61-69` 入账节点只含 `{slug, planHash, verdict, fingerprint, fileSha256, itemsCount, items}`——**没有任何 evidence 节点 id / 代数 / 证据 sha**；`/Users/acfufu/Codehub/lazyzcode/core/loop.js:1093-1099` 与 `:1113-1115` 终验 attestation 里的 `evidence[]`/`comparator` 也**不带 `at`**，所以「对照先于证据」这个事实连最后那份「机器证明」都自含不出来（只能回 dag.json 重建）。
  故障场景（三条都活体跑通，同一根因）：
  ①**先落账后取证**：HEAVY 目标 `loop start` 之后、任何一步未做时即 `lzy attest comparator --file`（schema 只校验 slug/F id 覆盖/verdict 词形，不要求 F 步已 done），随后随便写什么 `--evidence` 文本，`finish` EXIT=0。
  ②**合法 rebind 后复用**：真实取证 → qa-executor 对照 MATCH 入账 → 同一棵树（未提交）上重取证据换文本（`↻ 步骤重取证`），指纹不变 → 旧 MATCH 仍是「现行」→ finish EXIT=0；attestation 里 `comparator.nodeId=n4`（at=1789597303571）与 `evidence nodeId=n5 gen2`（at=1789597303701）并排落盘，顺序颠倒且无人校验。
  ③**跨 reset/重开复用**：`loop reset` → 同 slug 重新 register → **逐字相同的计划**（planHash 不变）→ 同树 → 上一轮的 MATCH 节点仍是现行 → 全新一轮的 `finish` EXIT=0，`lzy evidence list`/回执里那一轮的 basis 还是上一轮写的 `"judged the REAL evidence text"`。HEAVY 门宣称的「现行记录且 MATCH」全部成立，实际零对照。
  最小探针（scratch 仓，无 dirty 干扰）：`lzy loop register t --title d --tier heavy; lzy loop plan P --review "plan-reviewer: PASS"; lzy loop start; lzy attest comparator --file '{"slug":"t","items":[{"fid":"F1","verdict":"MATCH","basis":"premature"}]}'; lzy step done N1 --note x; lzy step done F1 --evidence "unrelated"; lzy loop finish` → `✔✔ 目标完成`（本轮实测）；②在 `step done F1 --evidence "REAL…"` 后入账再 `step done F1 --evidence "FABRICATED…"`；③在 finish 后 `loop reset` 再走一轮同计划。**缓解方向**：入账/门控时把 items 扩成 `{fid, evidenceNodeId|generation, verdict}` 并要求锚定节点在场且 `<节点.at` 早于对照记录，同时把 `at` 写进终验 attestation。
  （可再评级讨论：若「机器只记账不裁决、对照结论由主代理转抄」是既定威胁模型，本条降 P2；但 ①②③ 都不需要伪造任何东西，属于门自身的可满足性缺口。）
- **[P2] V009-R3-B-2 HEAVY finish 门存在「无解状态」：零 F 项目标要不到 attestation；0.0.7 在途目标拿不到 planHash——两条提示互相打脸，且唯一的出路是 abandon/reset**
  证据：`/Users/acfufu/Codehub/lazyzcode/core/loop.js:1002-1009`（HEAVY 无记录即拒）+ `/Users/acfufu/Codehub/lazyzcode/core/attest.js:86-89` — `const fIds = goal.steps.filter((s) => s.kind === "F").map((s) => s.id); if (fIds.length === 0) { throw new LoopError(\`本目标无 F 项——对照 attestation 无对象可记…\`) }`；`/Users/acfufu/Codehub/lazyzcode/core/attest.js:33-35` — `if (!goal.planHash) { throw …「先重新采纳计划」}` 而 `/Users/acfufu/Codehub/lazyzcode/core/loop.js:484` `doAdoptPlan → requireActive(cwd, "planning")`；`core/loop.js:212-214` tier 只升不降。
  故障场景：①`lzy loop register t --tier heavy` + PASS 评审 + 全 N 计划（计划门自己打印 `N:1 F:0` 也照收）→ 全部步骤 done → `finish` 要对照 attestation → `attest comparator` 拒「本目标无 F 项」→ tier 降不回、plan 重采纳要求 planning → 目标永久卡 executing，只剩 `abandon`/`reset`（另一会话在多会话场景里可能正在跑）。②同样的卡死也由 LIGHT→`lzy loop tier heavy`（executing 允许、仅 warn）触发。③0.0.7 在途目标（0.0.7 无 planHash/tier 键，goal 形状见 `git show v0.0.7:core/loop.js:155-167`）升级后在 executing 里升 heavy → `finish` 要对照 → `attest` 说「先重新采纳计划」→ `loop plan` 回「当前状态 executing，此操作要求 planning」→ 死循环。
  最小探针：`lzy loop register t --title x --tier heavy; lzy loop plan P --review "plan-reviewer: VERDICT: PASS"; lzy loop start; lzy step done N1 --note x; lzy loop finish; lzy attest comparator --file '{"slug":"t","items":[]}'` → 两条消息分别为 `HEAVY finish 需对照 attestation…`（EXIT 1）与 `本目标无 F 项…`（EXIT 1）；`lzy loop tier light` → `tier 只升不降`；`lzy loop plan P` → `要求 planning`。③的配方：把 goal.json 改写成 0.0.7 形状（同 `test/dag-authority.contract.test.js:148` 的 legacy 配方）+ `rm dag.json` + `lzy loop tier heavy`。
- **[P2] V009-R3-B-3 legacy（treeHash 形态）证据是「统一权威」的按步退出口，且 `subject add` 打印的作废承诺对它不成立——升级路径上可产出假 finish**
  证据：`/Users/acfufu/Codehub/lazyzcode/core/loop.js:942-946` — `// legacy 单树轨（0.0.7 证据对象，无账本节点）… if (!s.evidence?.treeHash || !current) unbound.push(s); else if (s.evidence.treeHash === current) fresh.push(s);`（只看宿主单树，账本与 subject 集都不进判定）；`/Users/acfufu/Codehub/lazyzcode/cli/lzy.js:336` 打印 `集合变化=复合指纹变化：全体已录 F 证据过期，重取后才可 finish`；`cli/lzy.js:252` finish 成功语 `F 项证据绑复合指纹`。
  故障场景：0.0.7 在途目标升级到 0.0.9 → `lzy loop subject add ../sub` 打印「全体已录 F 证据过期」（实际未过期：`verify` 仍报 `新鲜 1`）→ 兄弟仓再来一个无关提交（`verify` 仍 `新鲜 1`）→ `finish` EXIT=0 并打印「F 项证据绑复合指纹，subject 集全 clean」——该 F 证据从未覆盖 subject 树，且 subject 变更/提交对它完全不可见。同一退出口随时可由模型自取：goal.json 是模型可写状态（把 `step.evidence` 改写成 `{text,treeHash,at}` 并删 `evidenceSeq` 即让该步脱离账本权威），实现无法区分真 0.0.7 记录与手改记录（既有测试 `test/dag-authority.contract.test.js:143-162` 把 legacy 轨钉成预期行为，但没有版本/来源标记）。
  最小探针：0.0.7 形状 goal（同 legacy 配方，`rm dag.json`）→ `lzy loop subject add ../sub10` → 在 sub10 里 `git commit` → `lzy loop verify`（期望「过期」实得 `新鲜 1`）→ `lzy loop finish` → EXIT=0。**缓解方向**：legacy 轨加目标级「pre-0.0.9 冻结」标记（一旦本目标发生过任一 fingerprint 形态取证/发生过 subject 变更即拒绝 legacy 形态），或至少在 subject 变更后对 legacy 步报警。
- **[P2] V009-R3-B-4 finish 窗口内指纹只采一次样：树在窗口里变动即产出「完成瞬间已过期」的 LOOP_COMPLETE，终验 attestation 可自相矛盾且无人校验**
  证据：`/Users/acfufu/Codehub/lazyzcode/core/loop.js:917`（`fingerprint = fingerprintSubjects(...)` 唯一采样点）→ `core/loop.js:1027-1047`（完整性闸门，独立的 git 读取）→ `core/loop.js:1107-1110`（attestation 逐根**重新**读 `headTreeHash: createGit(root).headTreeHash()`）→ `core/loop.js:1113-1115`（`fingerprint:` 用的是前面那次采样值）；写入前无任何一致性复核。
  故障场景：多会话工作区（本版 SKILL 新增 "Same-workspace multi-session" 一节）里另一会话在 A 的 finish 窗口内提交（我的探针把提交打在闸门 rev-parse 与闸门 status 之间）：闸门看到的是 H' 的 clean 树 → 放行 → H 上取的新鲜证据被当成 H' 的新鲜证据，finish EXIT=0；紧随其后的 `lzy loop verify` 立刻报 `过期 1：F1`，即「已完成」目标的状态与其自身证据时效互相矛盾。终验 attestation 记录 `fingerprint`（H 的复合）与 `subjects[].headTreeHash`（H'），二者不自洽（本轮实测：`fingerprint=71ea3295…` vs 由记录头树重算 `25d6ee32…`，`equal False`）——「LOOP_COMPLETE 机器证明」自身可被证伪而落盘时无校验。ADR-0013 后补记只承认「ms 级 TOCTOU，结局=对较旧树 finish 而非伪造」，但 0.0.9 的产物把两次采样都写进了同一份「证明」，且报告/attestation 各自的 git 读取（`core/loop.js:1182`、`:1109`）在慢仓上会把该窗口拉长到秒级。
  最小探针：scratch 仓 + PATH 前置 git shim（第 3 次 `rev-parse HEAD^{tree}` 时先 `git add a.txt && git commit` 再委派真 git，即提交落在闸门内）→ `lzy loop finish`（EXIT=0）→ `lzy loop verify`（`过期 1`）→ 按记录头树重算 attestation 指纹（不相等）。**缓解方向**：writeGoal 前重采一次复合指纹并要求等于判定值（不等则拒、给出「另有会话提交」指路），或在 attestation 写入时校验自身自洽。
- **[P2] V009-R3-B-5 finish/step 临界段可超 `LOCK_STALE_MS`（10s），对端抢锁后其 goal.json 更新被静默丢失**
  证据：`/Users/acfufu/Codehub/lazyzcode/core/loop.js:73` `const LOCK_STALE_MS = 10_000;`、`:97-99` `if (ageMs > LOCK_STALE_MS) { rmSync(lock, …); continue; }`（owner.json 写一次不心跳）；`:1023-1025` 注释假设「8s 闸门预算 < 10s 留余量」，但同一临界段里 0.0.9 又加了 `writeFinalAttestation` 的逐根 `headTreeHash()`（`:1107-1110`，`core/git.js:39-49` 每次 spawn 超时 10s）与报告侧 `core/loop.js:1182` 的 `headTreeHash()`——单根也要 1+1 次、subject 越多越长。
  故障场景（本轮实测时间线）：A=`lzy step done F1 …`（subject 根上 git 慢，shim 每次 rev-parse 睡 9.5s，仍在该调用 10s 超时内）持锁 19.6s；B 在 t=5.5s 发 `lzy loop claim N2`，在 t≈10.0s 判定 owner 陈旧、`rm -rf` 抢锁并成功写 claim（B 回执 `✔ 步骤已认领`）；A 在 t≈19.6s 用自己锁内读到的旧 goal 覆盖写 goal.json → **B 的认领无痕消失**（终态 `N2 claim = None`），决策 #21 的 48h 互斥在无声中失效。真实触发面=大仓/网络盘/多 subject 的 git 慢调用，而 finish 的临界段本身就是「闸门 ≤8s + 报告 + attestation」叠加。
  最小探针：scratch 仓（含 1 个 subject）把 PATH 前置 git shim，让前两次 `rev-parse HEAD^{tree}` 各睡 9.5s；后台起 `lzy step done F1 --evidence x`，5.5s 后前台 `lzy loop claim N2`，再 `wait` → `python3 -c` 读 goal.json 的 `steps[N2].claim`（得 `None`；不带 shim 的对照组保留 `{at: ...}`）。**缓解方向**：长临界段内刷新 owner.json mtime（心跳），或把 steal 阈值抬到临界段上界之上。
- **[P3] V009-R3-B-6 终验 attestation 的 attemptId 是秒粒度：同秒内两次 finish 静默覆写，与 ADR「追加不覆写」相悖**
  证据：`/Users/acfufu/Codehub/lazyzcode/core/loop.js:1083` `const attemptId = \`${goal.slug}-${new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z")}\`` 与 `:1119-1122` `writeFileSync(tmp,…); renameSync(tmp, p);`（同路径 rename 即原子覆写）；`docs/adr/0014-…md` 增补节声明「秒粒度，追加不覆写」。
  故障场景：同 slug 两轮目标（reset → 重注册 → 全流程）在同一个 UTC 秒内各自 finish（本轮 in-process 两轮实测 723ms；CLI 路径约 5 进程/轮，临界但可达；同秒抢跑的第二个 finish 亦同），第二份 LOOP_COMPLETE 证明把第一份替换掉，审计面上只剩一份，无告警。
  最小探针：两轮 `register→plan→start→step done→finish`（中间 `resetLoop`），比对 `finish.attestation.attemptId` 与 `.lazyzcode/attestations/` 文件数 → `collision: true | count: 1`。**缓解方向**：id 加毫秒/pid 或存在即拒绝（`mkdirSync` 拿独占名）。
- **[P3] V009-R3-B-7 subject 根消失时：先报「证据过期请重取」（错误药方），而文档指路的 `subject remove <path>` 拒收用户申报的那种路径写法**
  证据：`/Users/acfufu/Codehub/lazyzcode/core/loop.js:983-989`（过期分支先于 missing 分支，药方「重新取证」对根消失无效）；`:463-469` — `try { rp = realpathSync(resolve(cwd, path)); } catch { rp = resolve(cwd, path); } const idx = subjects.indexOf(rp);`（根存在时 realpath 归一，根消失时只做 lexical `resolve`，与存储的 realpath 不等即 `该路径不在 subject 集合`）；`:1042` 的指路文案 `复原路径，或 lzy loop subject remove <path> 移出集合`。
  故障场景（macOS `/tmp→/private/tmp` 全命中）：`lzy loop subject add /tmp/…/sub`（存储为 `/private/tmp/…/sub`）→ 该根被清掉 → `finish` 先拒 `证据已过期…重新取证`（白跑一轮取证）→ 按提示 `lzy loop subject remove /tmp/…/sub` 被拒「该路径不在 subject 集合」，同一命令用 `/private/tmp/…` 写法才成功；只剩 abandon。
  最小探针：`lzy loop subject add /tmp/v009-review-R3-B/sub1; rm -rf /tmp/v009-review-R3-B/sub1; lzy loop finish; lzy loop subject remove /tmp/v009-review-R3-B/sub1`（EXIT 1，文案 `该路径不在 subject 集合：/tmp/…`）→ 换 `/private/tmp/…`（EXIT 0）。（该行早于本次 diff，但 0.0.9 的 finish 指路文案继续承诺它，故记账。）

## 已查无发现

- **0.0.8 在途目标升级的 fail-closed 与其恢复路径可用**：删掉 DAG 后 `status`/`verify`/`finish` 一律拒（`证据账本不一致…恢复：重跑 lzy step done F1 --evidence`），照提示 rebind 后 `verify` 转 `新鲜 1`，后续 F2 正常取证、finish EXIT=0（实测全链）。不是死胡同。
- **孤儿 ghost 不可现行**：更高代次绿节点在场时 `findGreenByGeneration(slug,step,gen)` 锚定不变、`verify` 判定不翻（复跑既有用例 ⑤ 通过）；`lzy evidence list` 标 ⚠ 孤儿。
- **账本篡改/损坏 fail-closed**：校验和、JSON、版本三路在 `loadDag` 拒并带恢复指路；`test/dag-authority.contract.test.js` 16/16 通过（含损坏账本下 goal.json 字节不动、status 保持 executing）。
- **comparator 入账 schema**：slug 不符、未知/非 F 的 fid、重复 fid、空 items、未覆盖全部 F 项、verdict 词形非法全拒（CLI 与既有用例双证）；MISMATCH 如实入账、最新为现行（先 MATCH 后 MISMATCH 会被门拦）。
- **账本-goal 真分歧（无锚定节点）**与 **账本不可读**在 verify/status/finish 三读面全拒、无逃生 flag。
- **subject 集合变更对 fingerprint 形态证据确实作废**（add/remove 后 `verify` 报过期——fingerprint 轨行为正确，问题只在 legacy 轨，见 R3-B-3）。
- **重采纳不同计划文本 → planHash 变 → 旧 comparator 节点不再现行**（`findLatestComparator` 按 planHash 过滤，实测 `planHash` 不符查询返回 null）。
- **verify/finish 的退出码与无 goal 出口**：`loop verify` 过期/未绑定置 1，无 goal 报统一恢复文案；`evidence red`/`loop claim` 无 goal 时 pre-lock 拦截不留 `.lazyzcode/` 空壳。
- **doctor payload-ver 三态**（一致 ok / 错配 warn 带 `lzy sync` 指路 / 缓存缺席 skip）随 `test/dag-authority.contract.test.js` 一并通过；`attestations/` 目录对疤痕巡逻零接触（reset 后存活实测）。
- **闸门预算穷尽分支**（`remaining <= 0` → error → fail-closed 拒）与 `missing`/`error` 分支：仅代码阅读，未构造活体超时（未发现可绕）。

## 开放问题

- **对照 attestation 的威胁模型**：若「机器只记账、结论由主代理转抄」是刻意设计，R3-B-1 应降 P2（门只保证「有人对 slug+planHash+当前树交过一份 MATCH」）。定夺所需：一份写明的威胁模型（是否把主代理视为不可信）——ADR-0014 只写了「机器只记账不裁决」，没写「不绑证据」是接受项。
- **全 N 项的 HEAVY 计划是否算合法输入**：SKILL 未禁止、计划门照收并打印 `F:0`、plan-reviewer 契约是否强制 F 项未见文本级判定。若评审门本来就该拦下零 F 计划，则 R3-B-2 的影响面收窄；否则 HEAVY 门与 attest schema 的这条互斥必须修（例如零 F 时自动免除 comparator 门）。
- **0.0.9 升级队列里 legacy 形态目标的实际存量**（R3-B-3/R3-B-2 ②的暴露面）：本地无法测量；需要用户侧 `goal.json` 的 `planHash`/`evidenceSeq` 存在性抽样（只读脚本即可定）才能定这两条的严重度权重。
- **`git` 慢调用的真实分布**（R3-B-5）：探针用 shim 模拟；大仓/网络盘/Windows 上单次 spawn 的 P99 我没有实测数据。三 VM 上跑一次带 3 个 subject 的 finish 计时（记录锁持有时长）即可结清。
- **`lzy evidence list` 的红半代数展示**：红半在绿半之后登记时会取「下一代」`seq`（`core/loop.js:776` `const seq = step.evidenceSeq ?? 1`），展示面可能把红半挂到它并未验证的那一代；配对真值在 `red_of` 边，机器不裁决，故未升级为发现——需要一次「红后登记」的活体对照才能判定是否真的误导。

### R4 · 测试质量 + 发布机械件 + 文档

#### R4-A

# R4-A · 测试质量 + 发布机械件 + 文档（正确性镜）— 原件

## 发现

- [P2] V009-R4-A-1 「孤儿 ghost 不可现行」——棒2 头条语义零测试保护（变异探针全量 211 测全绿）
  证据：`core/loop.js:926-927` — `const gen = s.evidenceSeq ? s.evidenceSeq - 1 : 1; const node = findGreenByGeneration(dag, goal.slug, s.id, gen);`；`test/dag-authority.contract.test.js:195-211`（`:203-204` 植 ghost 时 `surface: { kind: "fingerprint", value: fp }` 用的是 `verifyEvidence(...).fingerprint` 即**当前活指纹**，`:208` 断言 `fresh.map(...) === "F1"`）
  故障场景：把代次锚定换成 latest-wins（`findLatestGreen`）后，任何"账本里存在更高代次 ghost"的现场（dag-first 半失败残留、跨进程交叉写）都被当成现行：ghost 面值=旧值→把 goal.json 锚定的正确代次判过期；ghost 面值=当前指纹→未按代次锚定的记录判新鲜。测试 ⑤ 恰好把 ghost 面值设成当前活指纹，因此"锚定代次"与"最新代次"两条实现路径给出同一结论——断言无法区分，属"通过得对但测错了东西"。
  最小探针：scratch 副本（`/tmp/v009-review-R4-A/mut/repo`，与仓库 `core/loop.js` sha256 同为 `7064c218…`）把 `core/loop.js:927` 与 `:1097` 改成 `findLatestGreen(dag, goal.slug, s.id)` → `npm test` = tests 211 / pass 210 / fail 1，唯一失败项与 pristine 副本完全相同（`.mimosa` 夹具，因复制体无 `.git`）。对照：同副本把 `verifyEvidence` 改成读 `s.evidence.fingerprint`（M3）或放开 HEAVY MISMATCH 门（M2）都能被抓住（15/16）——说明是这一条语义缺保护，不是探针环境问题。

- [P2] V009-R4-A-2 `stalePreview` 的 `stale` 分支零断言（测试标题谎报五态）→ manifest「过期」列可静默退化为永远「新鲜」
  证据：`core/dag.js:267` — `return { node: n, status: n.surface.value === currentFingerprint ? "fresh" : "stale" };`；`test/dag-kernel.contract.test.js:189` 标题「stalePreview 五态：fresh/stale/superseded/external/null 指纹」但 `:197-200` 只断言 superseded / fresh / external / unknown——fixture（`:191-195`）里没有任何节点会落 `stale`（唯一的候选 n1 因被 supersede 而返回 `superseded`）
  故障场景：`stalePreview` 的唯一消费面是 `lzy evidence list`（`cli/lzy.js:469` 与 `:479-488`），它把判定渲染成「新鲜/过期/历史代次/外部表面、机器不可查」。若 `stale` 分支退化，人/模型在 manifest 上读到「绿 ✓ gen2（指纹 … · 新鲜）」而该证据实际已过期，因此误判"不必重取"。机器门不受影响（verify/finish 用自己的比对），所以不会假完成，只会误导取证据决策。
  最小探针：scratch 副本把 `core/dag.js:267` 改为恒 `status: "fresh"` → `npm test` = tests 211 / pass 210 / fail 1（失败项同 pristine 的 `.mimosa` 夹具），零测试检出。

- [P2] V009-R4-A-3 发布件与 tag 分叉：tag v0.0.9 之后仍有提交改"随包发布"的文件 → npm 0.0.9 载荷/README 缺 0.0.9 命令面
  证据：`git log --oneline v0.0.9..HEAD --name-only` — `f2a6b4c` 改了 `README.md`、`README.zh-CN.md`、`plugin/skills/zw/SKILL.md`（另 `docs/release-checklist.md:210` 本次 runbook 自己写着「CI 全绿再 tag（tag 最后切）」）。实测：全局 npm 0.0.9 载荷 `…/lib/node_modules/lazyzcode/plugin/skills/zw/SKILL.md` sha256 = `aaca4c62…` == `git show v0.0.9:plugin/skills/zw/SKILL.md`，而仓库 HEAD 同文件 = `4da71bc0…`（多出 `lzy evidence red · waive-red · list`、`lzy dag dependents <id|surface>` 两行速查）；`git show v0.0.9:README.md | grep -c "Red-green manifest"` = 0（npm README CLI 表 16 行，仓库 0.0.9 README 19 行）
  故障场景：`npm i -g lazyzcode` 的用户（以及 npmjs.com 渲染的 README）拿到的命令表停在 0.0.8 口径，`plugin/` 载荷缺 0.0.9 命令速查；载荷缓存按版本目录落位（`.zcode/cli/plugins/cache/lazyzcode-local/lazyzcode/0.0.9/`），0.0.9 号版本内 `lzy sync` 也补不齐——只能等 0.0.10。这是 release-checklist 自己记过的 0.0.6 lesson 的复发（tag 不是发布内容 tip；本次 audit target `v0.0.8..HEAD` 本身就含 tag 之后的三个提交 19aa0f9/f2a6b4c/116eade）。
  最小探针：`shasum -a 256 "$(npm root -g)/lazyzcode/plugin/skills/zw/SKILL.md" plugin/skills/zw/SKILL.md`（两值不同）；`git show v0.0.9:README.md | grep -c "Red-green manifest"`。registry 侧无误：`npm view lazyzcode dist-tags latest=0.0.9`、`dist.shasum 90ec541719bf73ed6565678db0687743665b5c29` 与 checklist 记的 `90ec5417…` 逐字一致——纯属"仓库 0.0.9 内容 ≠ 已发布 0.0.9 内容"。

- [P3] V009-R4-A-4 `lzy attest comparator` schema 校验分支大多零覆盖，空 items 断言用双分支或
  证据：`core/attest.js:102-103`（verdict 枚举）、`:105-107`（重复 fid）、`:110-113`（未覆盖全部 F 项）、`:33-35`（无 planHash）、`:44-53`（不可读/非 JSON）、`:87-89`（目标无 F 项）、`:57-59`（无指纹）全部无测试；`test/dag-authority.contract.test.js:257-259` 用 `assert.match(r.out, /缺 items|未覆盖全部 F 项/)`，而 `items: []` 只可能命中前一支，后一支的文案永不被验证
  故障场景：转抄自 qa-executor 文本报告的 verdict 词形（`REVISE`/`MATCH ` 带空格/大小写）若因校验回归而放行，会被 `doc.items.every(...)` 折成 `MISMATCH` 静默入账——方向是多拦一次（HEAVY finish 被拒），不会假完成，但门会退化成噪音源。反向：绑定 planHash 的校验若失效，复采纳旧计划的过期对照可能被当现行（该面由 `findLatestComparator` 的 planHash 过滤承担，同样无负例测试）。
  最小探针：scratch 副本把 `core/attest.js:102` 的 `if (it.verdict !== "MATCH" && it.verdict !== "MISMATCH")` 改为 `if (false)` → `node --test test/dag-authority.contract.test.js` = 16/16 全绿（零检出）。

- [P3] V009-R4-A-5 0.0.9 新增 CLI 面两条路径零覆盖：红半附件与红半脏树提示
  证据：`cli/lzy.js:527`（`files: evidenceFileArgs(cwd, f)`）、`:534-536`（附件回执）、`:537-539`（`⚠ 工作区有未提交改动：红半应绑定改前态…`）；`grep -rn "evidence-file" test/` 只命中 `test/loop.e2e.test.js`、`test/tier2.contract.test.js`（都是 `step done` 面），三个新测试文件对 `evidence-file|未提交改动|附件` 零命中
  故障场景：`lzy evidence red F1 --evidence … --evidence-file <f>` 的 CLI 侧接线（键名/复制/回执）与脏树提示写死文案，任何退化都不会被测试发现——而"红半应在改动前取证"正是 0.0.9 双证据纪律的核心提示。
  最小探针：`grep -rn "evidence-file\|未提交改动" test/dag-*.test.js test/evidence-manifest.contract.test.js`（0 命中）；scratch 仓实跑 `node cli/lzy.js evidence red F1 --evidence x --evidence-file <f>` 可见附件行，但无测试镜像它。

- [P3] V009-R4-A-6 CHANGELOG [0.0.9] 出现两个 `### Added` 段
  证据：`CHANGELOG.md:8` `### Added`（DAG/manifest/attestation/payload-ver/fail-fast）、`:59` `### Changed`、`:69` 又一个 `### Added`（同工作区多会话纪律 + worktree-as-subject 契约测试）
  故障场景：Keep-a-Changelog 风格下同版本重复分组标题，读者与 release-notes 工具会把第二段当成新段或漏读；实际第二段承载 0.0.9 的多会话纪律条目（该文本同时是 AGENTS §2 与 guide 的叙述源）。
  最小探针：`awk '/^### /{print NR": "$0}' CHANGELOG.md | head -4`。

- [P3] V009-R4-A-7 headless spike 报告引「zcode.cjs 11.4MB 单行」与事实不符（3583 行），计数法前提失效
  证据：`docs/spikes/headless.md:42` — 「引擎包内对这两个 env 名各实读一次（`grep -c` 均 = 1；zcode.cjs 11.4MB 单行，计数法沿 minified-grep 家规）」；实测 `wc -l /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs` = **3583**（11,416,833 bytes）
  故障场景：`grep -c` 数"命中行数"而非出现次数——文件非单行时该计数不足以支撑"实读一次"（同报告 §3 的 `keychain` 38 处亦按行计）。本例结论侥幸成立（`grep -o … | wc -l` 两 env 名各 = 1），但"单行"被写进证据链当作方法论前提，后续 spike 照抄会得错数。
  最小探针：`grep -o "ZCODE_BUILTIN_PROVIDER_CONFIG_FILE" "$ENGINE" | wc -l`（=1）与 `grep -c`（=1）同值，但 `wc -l "$ENGINE"` = 3583 ≠ 1。

- [P3] V009-R4-A-8 两处测试标题声明的语义既无断言也无实现
  证据：`test/dag-kernel.contract.test.js:162` 标题「…多条 red_of 取最新」——`:170-179` 只构造单条 red_of（`pairReds` 第二次返回 0，即生产侧根本不允许一个 red 配两条红边），"最新为现行"从未被任何用例或消费方验证；`test/dag-kernel.contract.test.js:120` — `assert.ok(red.id && green.id && red.id !== green.id)` 在 id 由 `nextId` 生成的前提下近乎恒真（与 V009-R4-A-2 同族：标题/断言强于实际测量）
  故障场景：narrative-checklist 与评审计数把测试标题当覆盖叙事；后续若有人按标题假设"多条 red_of 取最新"已被保护，改动 `pairReds`/manifest 的取最新语义不会被拦。
  最小探针：`grep -n "red_of" test/dag-kernel.contract.test.js`（无多边 fixture）；`node --test test/dag-kernel.contract.test.js` 全绿。

## 已查无发现

- 版本三体+发布面全一致：`package.json:3` / `plugin/.zcode-plugin/plugin.json:3` / `CHANGELOG.md` [0.0.9] 三者同步（`test/package.surface.test.js` 拦截面在场且真断言），`.claude-plugin/marketplace.json:31` version `0.0.9` + `:63` ref `v0.0.9`，`docs/_layouts/home.html:17` `softwareVersion 0.0.9`，`git show v0.0.9:package.json` = 0.0.9。
- 发布事实活体核验：`npm view` → `dist-tags.latest=0.0.9` 且 `dist.shasum 90ec541719bf73ed6565678db0687743665b5c29` 与 `docs/release-checklist.md:254` 记录逐字一致；`npm pack --dry-run` = 36 文件 / 161.9 kB，无 `.mimosa`、无 test/、无 artifacts/、零 dependencies；CHANGELOG 与 marketplace manifest 本就不入包（与既有设计一致）。
- narrative-checklist 计数钉全部实测相符：对比表 `grep -c '^| [0-9][0-9]* |'` = 11/11 双语；README CLI 表 19 行（16+3，双语各 19）；guide 快启栅栏 21/21 双语；`lzy --help` loop 族 17 条 + 证据账本块 4 条 + 对照 attestation 块 1 条（canonical 18 含 handoff 豁免）。
- 文档命令语法/退出码抽查（scratch 仓 `/tmp/v009-review-R4-A/probe1` 实跑）：`evidence red`（缺省绑 `fingerprint:`、`--surface` 绑 `external:`）、`waive-red` 缺 `--reason` exit1、N 项被拒 exit1、`evidence list` manifest 文案（含「机器只记账不裁决」）、`dag dependents`、`attest comparator` 用法/schema 报错、`loop verify` 退出码——与 README 双语表 3 行、guide 双语栅栏 3 行所述一致。
- 0.0.9 新增多会话纪律的文档断言可证：in-tree worktree 使宿主 `git status --porcelain` 出 `?? inside-wt/`（会被 finish 闸门拦），worktree 建在宿主树外则宿主保持 clean——与 `CHANGELOG.md:74-79`、`docs/guide/en.md:607-614`、`docs/guide/zh.md:495-501` 的写法一致。
- 变异对照（真断言存在，非空转）：M2 放开 HEAVY MISMATCH 门 → 15/16 检出；M3 让 verify 改读 `goal.json` 指纹而非账本节点面 → 15/16 检出。`integrity-kernel` 新增的 dirty 命中路径断言（`:109` `deepEqual(paths, ["uncommitted.txt"])`、`:376-378` 三条文案正则）同样可辨真伪。
- 测试隔离家法：三个新 suite 与旧 suite（`test/integrity-kernel.contract.test.js:27-31`）同款——模块级隔离 HOME + `USERPROFILE` 双 env + `LZY_ZCODE_ENGINE` 抑制；无 npm registry / 宿主引擎日志 / 本地时区 / 预装全局包依赖（attestation id 走 `toISOString`，TZ 无关；锁测试只断言单调下界 ≥4.5s）；无 win32 雷形态（无 `split("/")`、无绝对路径前缀断言）。
- SEO/站点：`docs/_includes/seo.html:1` canonical = site.url+baseurl+page.url（`_config.yml:5-6` 相符）且 `_config.yml:13-15` 未排除 robots/sitemap；`docs/robots.txt:39` Sitemap URL 正确，其"内部工程记录页自带 noindex 头"有 `docs/_layouts/bare.html:6` 佐证；`docs/sitemap.xml` lastmod 与各页最近内容提交日逐条相符（guide 09-17、home 09-17 经 home.html、developers 09-15）。
- `scripts/docs-preview/build.mjs:96` 的改动正确：robots.txt 与 llms.txt/sitemap.xml 同列入根级静态文件复制，输出目录 `dist/` 已被 `.gitignore:11` 忽略。
- `docs/spikes/headless.md` 的量化断言逐条对档（`artifacts/headless-spike-probes/`）：help dump 62 行、`keychain` 38、两 env 名各 1 次、token `12025+12052`、cacheRead `768`(首轮)/`11904`(resume)、P0 三形态/P3a/P3a2 拒文与 EXIT 码——除 `:42` 的"单行"外全部与存档原文一致；`§4` 的「11904/12052 = 前缀整命中」与 p4 存档相符。
- 审阅期无仓库写入：全程 `git status --porcelain` 为空（我所有实跑都在 `/tmp/v009-review-R4-A/`；`npm pack --dry-run` 未落 tgz）。

## 开放问题

- **HEAD 在审阅窗口内前进**：任务书给的 `HEAD=f2a6b4c`，实际在我开工后 2026-09-17 06:03:05 落到 `116eade`（"docs(release): 0.0.9 win32 VM retest closed…"，只改 `AGENTS.md`+`docs/release-checklist.md`）；我此前观察到的工作树 2 文件脏态即该提交的内容，随后转为干净。本报告所有行号基于 `116eade` 的树；若 wave 期间再有提交，行号可能漂移。
- **无法离线核验的外部事实**：CI run `35150826600` 四腿结果、GitHub Release v0.0.9 的 notes、Pages 站点是否已按 f2a6b4c 重建、以及 `docs/release-checklist.md:257` 的 win32 VM 复测（含 payload-ver 双态、`lzy update` 链、终验 attestation 942B）——均为外部机器/平台自报记录，我无法复现（本机只有 darwin）。
- 我无法判定 finding 3（npm 0.0.9 README/载荷落后于仓库 0.0.9）在维护者口径里是否可接受：如果接受，`docs/release-checklist.md:34` 的「每发布同步」与 `:210` 的「tag 最后切」需要写明"tag 之后只许改不入包文件"的判据；如果不接受，需要一个 0.0.10（或把 f2a6b4c 内容单独发版）来消除 npm 侧陈旧文档。
- `test/dag-authority.contract.test.js:195-211` 的 ghost 用例若要真正咬合，需要把植 ghost 的面值改成与当前指纹**不同**的值（例如全 0），或直接断言"选中的 nodeId == goal.json 代次对应节点"——这属于修复方案，我未改仓，留给修复轮判断。

#### R4-B

# R4-B · 测试质量 + 发布机械件 + 文档（对抗镜）— 原件

## 发现

- [P2] V009-R4-B-1 代次锚定的唯一 ghost 夹具把孤儿表面设成「活指纹」——latest-wins 突变三套件全存活
  证据：`test/dag-authority.contract.test.js:203-204` — `const fp = verifyEvidence(d, createGit(d)).fingerprint;` / `appendEvidenceNode(dag, { slug: "t", step: "F1", seq: 2, half: "green", surface: { kind: "fingerprint", value: fp }, text: "ghost" })`；被测语义在 `core/dag.js:210` — `... && n.slug === slug && n.step === step && n.seq === seq`
  故障场景：删掉 `n.seq === seq`（锚定退化为 latest-wins）后 `node --test dag-authority + dag-kernel + evidence-manifest` = 36/36 全绿。该夹具里 ghost 的表面值恰好等于活指纹，所以「判定不随 ghost 翻」这句断言对 latest-wins 同样成立——它证明的是「值相同则判定相同」，不是「代次相等才现行」。真实后果（探针实测）：任一代次更高的账本残留（dag-first 半失败 ghost）成为判定入参，ghost 表面≠活指纹时 `lzy loop verify` 从「新鲜 1：F1」翻成「过期 1：F1」（假拒）；反向排列（锚定代次已过期、ghost 表面=当前指纹）即 ADR-0014 明令禁止的假 finish 窗口。
  最小探针：把 `core/dag.js` 的 `n.seq === seq` 改成 `n.seq >= 0` → `node --test test/dag-authority.contract.test.js test/dag-kernel.contract.test.js test/evidence-manifest.contract.test.js`（36 pass）；scratch 仓 `step done F1` 后植 `seq=2 / value=deadbeef…` 的绿节点 → `lzy loop verify`（mutated「过期 1：F1」vs pristine「新鲜 1：F1」，EXIT 0）。
- [P2] V009-R4-B-2 comparator schema 的两条校验分支无测试——部分覆盖的对照结论可让 HEAVY finish 出 done
  证据：`core/attest.js:110-113` — `const missing = fIds.filter((id) => !seen.has(id)); if (missing.length > 0) { throw new LoopError(...未覆盖全部 F 项...) }`；`core/attest.js:105-107` — `if (seen.has(it.fid)) { throw ...重复 fid... }`。测试侧只有 `test/dag-authority.contract.test.js:257` 的 `items: []`，命中的是更早的空数组分支 `core/attest.js:91-93`。
  故障场景：把 missing 检查改成 `if (false)`（或删掉 seen 去重），dag-authority 16/16 全绿。两 F 项目标交付只含 F1 的结论文件时：`lzy attest comparator --file partial.json` 打印「已入账：n5 · MATCH · 1 项」（EXIT=0），随后 `lzy loop finish` EXIT=0 出 done——F2 的断言×证据对照从未发生，而「HEAVY finish 机器强制现行 MATCH」的卖点被满足（verdict 用 `items.every(...)` 计算，缺项不减分）。pristine 两命令分别拒：`对照结论未覆盖全部 F 项：缺 F2` / `HEAVY finish 需对照 attestation 且 MATCH`。
  最小探针：`if (missing.length > 0)` → `if (false)` 后 `node --test test/dag-authority.contract.test.js`（28 pass 含 dag-kernel）；scratch HEAVY 两 F 项链：`lzy attest comparator --file '{"slug":"t","items":[{"fid":"F1","verdict":"MATCH"}]}'` + `lzy loop finish`（mutated 双 0，pristine 双 1）。
- [P2] V009-R4-B-3 终验 attestation 的「账本锚定证据」只有形状断言——节点绑错全套存活
  证据：`core/loop.js:1097` — `const node = findGreenByGeneration(dag, goal.slug, s.id, gen);`（writeFinalAttestation 的 evidence 映射）；断言在 `test/dag-authority.contract.test.js:292` — `assert.match(doc.evidence[0].nodeId, /^n\d+$/, "锚定账本节点")`，夹具是单代次目标（任何绿节点都满足）。
  故障场景：把该行换成 `findLatestGreen(dag, goal.slug, s.id)`（不查代次），16/16 全绿。植一个代次更高的 ghost 后 finish，机器证明写成 `{"fid":"F1","generation":1,"nodeId":"n3","surface":{"value":"deadbeef…"}}`——generation 与 nodeId 互相矛盾、证据引用指向账本残留而非 goal.json 锚定的 n2；LOOP_COMPLETE 是发布叙事第 11 条卖点，此文件是它的唯一物证。
  最小探针：`writeFinalAttestation` 内改用 findLatestGreen → `node --test test/dag-authority.contract.test.js`（16 pass）；scratch LIGHT 链植 ghost 后 `lzy loop finish`，读 `.lazyzcode/attestations/*.json`（mutated nodeId=n3，pristine nodeId=n2）。
- [P2] V009-R4-B-4 attest 路径的 pre-lock 守卫无测试——删掉即在无 goal 目录重新留疤
  证据：`core/attest.js:27` — `requireGoalPreLock(cwd);`（注释自称「无 goal 目录 fail-fast 不留空壳，ADR-0006 家法」）；fail-fast 用例 `test/dag-authority.contract.test.js:358-366` 只跑 `evidence red` 与 `loop claim` 两条路径。
  故障场景：删掉该行，dag-authority + evidence-manifest 24/24 全绿；`lzy attest comparator --file x` 在没有 goal 的目录报同一句恢复式错误但留下 `.lazyzcode/loop/` 空壳（withLock 先 mkdir）——正是 0.0.9 CHANGELOG「fail-fast hardening」宣布闭合的疤痕族，doctor 的 state 行随后会把它当残留/疤痕报出来。
  最小探针：删 `core/attest.js:27` 后 `node --test test/dag-authority.contract.test.js test/evidence-manifest.contract.test.js`（24 pass）；scratch 空仓跑 `lzy attest comparator --file <json>` 后 `find .lazyzcode`（mutated 有 `.lazyzcode/loop`，pristine 无目录）。
- [P2] V009-R4-B-5 「同一 red 多条 red_of、最新为现行」三处文档声明 vs pairReds 结构性禁配
  证据：`core/dag.js:171` — `// 同一 red 节点多条 red_of 合法（rebind 后新配对），查询取最新为现行、全部留作历史。` 与 `core/dag.js:178` — `if (paired.has(node.id)) continue;`；`docs/adr/0014-invalidation-dag-red-green-manifest.md:23`；`CHANGELOG.md:21` — `greens (multiple edges legal, latest wins)`；`test/dag-kernel.contract.test.js:162` 标题「多条 red_of 取最新」但 `:172` 断言 `pairReds(...) === 0`（`test/evidence-manifest.contract.test.js:109` 同）。
  故障场景：rebind 后同一 red 节点永远不会得到第二条 red_of（实现有意如此，测试还把它锁死为「不重复配」），且全仓无任何「red_of 最新为现行」解析（`dependents` 只罗列全部命中，无 latest 语义）——按 ADR 写 baton-3 失效传播的人会依赖一种不存在的边累积语义；公开 CHANGELOG 对用户宣称的行为也与实现相反。两侧必有一侧要改（ADR/CHANGELOG 措辞或 pairReds 语义），现状是契约文档与代码互斥。
  最小探针：`grep -rn "red_of" core/ cli/`（只有 pairReds/dependents，无 latest 解析）；`grep -n "多条 red_of 取最新" test/dag-kernel.contract.test.js` 对照 `:172` 的 `=== 0`。
- [P2] V009-R4-B-6 stalePreview「五态」测试只覆盖四态——stale 分支无可达夹具
  证据：`test/dag-kernel.contract.test.js:189` 标题 `stalePreview 五态：fresh/stale/superseded/external/null 指纹`，而 `:197-200` 只断言 `superseded/fresh/external/unknown`——四个绿节点里没有「表面值≠当前指纹」的那个（`h1` 被 supersedes 短路、`h2` 相等、`pub@1` 是 external、`null` 是 unknown）；判定行 `core/dag.js:267`。
  故障场景：把该行改成恒返回 `"fresh"`，20/20 全绿。同一账本上两个读面随即自相矛盾（探针实测）：`lzy loop verify` 说「过期 1：F1」，`lzy evidence list` 同一节点标「新鲜」——manifest 的 stale 列是 0.0.9 新增的用户可见读面，测试标题声称覆盖却从未构造 stale 样本。
  最小探针：`core/dag.js:267` 改为 `status: "fresh"` → `node --test test/dag-kernel.contract.test.js test/evidence-manifest.contract.test.js`（20 pass）；scratch 链 `step done F1` → 再提交一次 → 两命令输出对照（mutated：verify 过期 / list 新鲜）。
- [P3] V009-R4-B-7 docs/robots.txt 落在项目子路径，对爬虫不生效（根路径实测 404）
  证据：`docs/robots.txt:39` — `Sitemap: https://acfufu.github.io/lazyzcode/sitemap.xml`（文件头注释自称「传统搜索引擎：全站放行」，含 10 个 AI 爬虫 UA 段）；`docs/_config.yml:5-6` — `url: https://acfufu.github.io` / `baseurl: /lazyzcode`。
  故障场景：robots.txt 的取用路径只能是源站根（https://acfufu.github.io/robots.txt，实测 HTTP 404）；站点实际发布到 https://acfufu.github.io/lazyzcode/robots.txt。于是 GEO 立场声明与 robots 里的 Sitemap 广告零生效，而 release-checklist 第 13 步的改名同步清单（`_config.yml` baseurl）也没提这个新文件；只有 Search Console 手工提交 sitemap 才能补上发现路径。
  最小探针：`curl -sI https://acfufu.github.io/robots.txt`（404）对照 `curl -s https://acfufu.github.io/lazyzcode/robots.txt`（200，Sitemap 行在）。
- [P3] V009-R4-B-8 AGENTS.md 仓库地图仍写 adr/0001..0012，两个 0.0.8/0.0.9 架构拍板不在图内
  证据：`AGENTS.md:95` — `adr/0001..0012-*.md ← enable 走引擎 CLI+config 零写入 / … / lzy update 子进程 sync`；实际 `docs/adr/0013-integrity-kernel.md`、`docs/adr/0014-invalidation-dag-red-green-manifest.md` 在场并被 §4 决策 #23/#24 引用。
  故障场景：新会话（或另一个审查者）按 §7 地图枚举 ADR 时会漏掉完整性内核与失效 DAG 两份拍板——而这两份正是本轮 0.0.8/0.0.9 的语义来源；AGENTS.md 自称「单一事实入口」，§9 维护规则要求阶段推进即更新。
  最小探针：`ls docs/adr/ | tail -2` 对 `sed -n '95p' AGENTS.md`。
- [P3] V009-R4-B-9 CHANGELOG [0.0.9] 出现两个 `### Added` 段（结构契约破裂）
  证据：`CHANGELOG.md:8` `### Added`、`:59` `### Changed`、`:69` `### Added`（0.0.8/0.0.7 均单 Added 段）。
  故障场景：按 Keep a Changelog 抽取版本段的工具/人读到第二段 Added 会截断（「Same-workspace multi-session discipline」「worktree-as-subject contract test」两条落在 Changed 之后）；narrative-checklist.md:46 明写「版本切分遵循 Keep a Changelog」。纯结构性缺陷，无功能影响。
  最小探针：`sed -n '8p;59p;69p' CHANGELOG.md`（或 `sed -n '/^## \[0.0.9\]/,/^## \[0.0.8\]/p' CHANGELOG.md | grep '^### '`）。
- [P3] V009-R4-B-10 发布后仓库载荷漂移：doctor 的 `files` 处方会把未发布内容写进已发布的 0.0.9 版本目录
  证据：`git diff v0.0.9..HEAD --stat -- plugin/` = `plugin/skills/zw/SKILL.md | 2 ++`；HEAD 实跑 `node cli/lzy.js doctor` 第 4 行 `⚠ files 缓存载荷与仓库不一致（内容差异 1、缓存多余 0，如 skills/zw/SKILL.md；运行 lzy sync）`，而 `diff -r <tag 树>/plugin <本机缓存>/0.0.9` 为空、doctor `payload-ver` 报 `✔ 缓存 [0.0.1…0.0.9] · CLI 0.0.9 一致`。
  故障场景：按 doctor 指引 `lzy sync`，未发布的 HEAD 载荷（含 2 行 SKILL 命令表）被部署进 0.0.9 版本目录；`payload-ver`（ADR-0012 中间态自查面）只比版本号，看不见「版本目录内容≠该 tag 载荷」这一态，真实会话读到的纪律文本与发布物脱钩。发布后的常态漂移在设计上可解释（dev checkout），但两个检查面的组合恰好对最危险的一格失明。
  最小探针：`git diff v0.0.9..HEAD --stat -- plugin/` + `node cli/lzy.js doctor | grep files` + `diff -r plugin "$HOME/.zcode/cli/plugins/cache/lazyzcode-local/lazyzcode/0.0.9"`。

## 已查无发现

- 突变杀伤力（对照实验，证明存量断言确有牙齿）：失活 finish 的 HEAVY comparator 门 `core/loop.js:1002` → dag-authority 3 个用例翻红（HEAVY 门/指纹过期门/终验 attestation）；跳过 `loadDag` 校验和 `core/dag.js:54` → fail-closed 三态用例翻红；清空 `dirtyPathHint` `core/loop.js` → integrity-kernel 脏分支用例翻红；反转 `checkPayloadVersion` 的 ok 分支 `core/doctor.js` → payload-ver 三态用例翻红。
- 版本/发布面全绿：`package.json` = `plugin/.zcode-plugin/plugin.json` = `.claude-plugin/marketplace.json` `version` = 0.0.9，市场 `ref` = v0.0.9（tag 在场）；`CHANGELOG` 含 0.0.9；`docs/_layouts/home.html` softwareVersion 0.0.9；`docs/sitemap.xml` lastmod 与四页末次内容提交逐一对上（guide 2026-09-17 / developers 2026-09-15）；`npm pack --dry-run` 36 文件、无 `.mimosa`/`.lazyzcode`/`docs` 夹带；registry `latest=0.0.9` 且 `dist.shasum=90ec5417…` 与 release-checklist 记录逐字一致；`gh run view 35150826600` = success @ 6c1d099（= tag 树）；`gh release view v0.0.9` published 2026-09-16T21:13Z；本机缓存 0.0.9 与 `git archive v0.0.9 -- plugin` 逐文件零差异。
- 计数位点与叙事面：README 对比表 11/11（含第 11 行 attestation）、guide 锚点 21/21、guide 快起栅栏 21 行、README CLI 表 19 行、首页特性卡与 doctor 清单描述由实跑核对；三处 0.0.9 新增命令族的双语表行/栅栏行/帮助块互等。
- headless spike 报告可证：`artifacts/headless-spike-probes/` 六份存档与报告摘录逐条吻合（0.16.5/EXIT=0、`--mode` 缺省 yolo、p2 inputTokens 12025/output 2、p4 inputTokens 12052/cacheRead 11904 复述指定词、p3a/p3a2 拒因原文）；§3 的包内计数现场复算 `ZCODE_BUILTIN/PERSONAL_PROVIDER_CONFIG_FILE` grep -c 各 = 1、`keychain` = 38 命中、`credentials.json` 在场、`.node-bundle-meta.json` 四字段一致、桌面壳 plist 3.12.2、引擎 11.4MB 单行——无夸大。
- 新套件隔离家法：`HOME`/`USERPROFILE` 双 env + `LZY_ZCODE_ENGINE` 抑制与 integrity-kernel/ratelimit 同款；未发现 `split("/")`/`startsWith("/")` 类 win32 雷，attemptId 用 `toISOString()`（无时区依赖），worktree 用例 finally 清理；`evidence list` 双跑字节一致用例无环境依赖。
- 写盘纪律：`git status --porcelain` 全程为空；全部突变/探针在 `/tmp/v009-review-R4-B/` 副本内（收尾已还原 pristine）。仓库内唯一变动是忽略路径 `.lazyzcode/`（`loop/` 的 goal.json/sessions mtime 06:03-06:18、baseline 会话计数 0 → 现 2），由其他并行会话的 Stop 钩子写入，非本审查命令所为（本审查只跑了 git 读、`--help`、`doctor`、`npm pack --dry-run`、`npm view`、`gh view`）。

## 开放问题

- SKILL 同一 bullet 内自相矛盾：`plugin/skills/zw/SKILL.md:211-213` 先写「the ledger is the unified validity authority」（棒2 事实），紧接写「The ledger only records — it adjudicates nothing」。前者指绿面时效裁决、后者指红绿配对不拦门——需要一句话把「什么被裁决/什么只记账」两分；`cli/lzy.js:457` 的 manifest 头行「机器只记账不裁决」同源于棒1 口径。属产品语言拍板，我无法单方判定哪句为准。
- guide 双语的 0.0.9 新概念（红绿 manifest / 失效 DAG / comparator attestation / 终验证明）只有命令栅栏行，无概念节；narrative-checklist 只要求「新概念先入 AGENTS.md §8 术语表」。是否补 guide 概念节属叙事面拍板（0.1.0 前无人反对即可搁置），本轮不作缺陷计。
- headless spike 的原始探针存档在 gitignore 的 `artifacts/`（报告明示「不入 git」），外部复核者无法从发布物验证 §3/§4 的数字；是否需要把 p2/p3a/p4 摘要（脱敏后）落 `docs/`，由维护者拍板。本轮我用本机引擎包复核了可复算部分（env 计数/keychain/版本/meta），但两次模型调用的 usage 数字只能取信存档。
- 本轮未覆盖（避免重复其他审查者与 scope 约束）：ratelimit/hooks/claim/tripwire 等其余套件、Windows/Ubuntu 实机重跑（CI 四腿已绿且 gh 复核过 run 结论）、真实会话侧的 DAG 读面活体验收。

### R5 · 跨面回归 + 宪法一致性

#### R5-A

# R5-A · 跨面回归 + 宪法一致性（正确性镜）— 原件

## 发现

- **[P1] V009-R5-A-1 `done` 态 goal 与账本分歧后 `loop status`/`loop verify` 永久拒，且报错里的恢复指令在该状态不可执行（0.0.8 完成的每个目标升级后即中招）**

  证据：`core/loop.js:926-935` — `const gen = s.evidenceSeq ? s.evidenceSeq - 1 : 1; const node = findGreenByGeneration(dag, goal.slug, s.id, gen); if (!node) { throw new LoopError('证据账本不一致：… 恢复：在当前代码上重跑 lzy step done ${s.id} --evidence …（rebind 即重注册账本节点）。') }`；而 `core/loop.js:648` `const goal = requireActive(cwd, "executing");`（`doCompleteStep` 入口）配合 `core/loop.js:144-146` 的 `目标 ${goal.slug} 当前状态 ${goal.status}，此操作要求 ${states.join("/")}` —— 所以 `step done` 对 `done` 态目标必然拒绝。同口径文案还在三处承诺该恢复路径：`docs/adr/0014-invalidation-dag-red-green-manifest.md:55`「恢复=重跑 `lzy step done <id> --evidence` rebind 即重注册节点」、`plugin/skills/zw/SKILL.md:213`「(recovery = re-record via `step done`)」、`docs/release-checklist.md:226`「(re-record to re-register)」。`lzy loop status` 的读面调用点：`core/loop.js:1565`（`formatLoopStatus` 内 `verifyEvidence`）。

  故障场景：(1) 用户在 0.0.8 上完成目标（`evidence` 为 fingerprint 形态、`evidenceSeq=2`，无 dag.json）；(2) `lzy update` 升到 0.0.9；(3) 该 done goal 按宪法继续占槽（SKILL 明说「a `done` goal keeps the slot until `lzy loop reset`」）；(4) 用户跑 `lzy loop status`（最常用只读命令）→ EXIT=1「证据账本不一致」；(5) 照报错执行 `lzy step done F1 --evidence …` → EXIT=1「当前状态 done，此操作要求 executing」。唯一出口是 `lzy loop reset`（销毁槽位、留 salvage 存根）或手改 goal.json/dag.json；`lzy doctor` 的 state 行还把这行指向 `loop status`「详查」。对比：`executing` 态的同分歧恢复是**可用**的（我实测 rebind 后 status/verify 全绿），所以缺陷不在 fail-closed 本身，而在文案与状态不匹配、done 态无出口。

  最小探针：用 0.0.8 CLI 造一个完成的目标（`git archive v0.0.8 cli core package.json | tar -x -C /tmp/v008`，`node /tmp/v008/cli/lzy.js loop register done08 --title t && … loop plan plan.md && loop start && step done N1 --note x && step done F1 --evidence g && loop finish`），再在 HEAD 上：`node cli/lzy.js loop status`（EXIT=1/账本不一致）→ `node cli/lzy.js step done F1 --evidence x`（EXIT=1/要求 executing）。我在 `/tmp/v009-review-R5-A/repoD` 原样复现（0.0.8 完成 → 0.0.9 两个命令分别 EXIT=1）。

- **[P2] V009-R5-A-2 「rebind 后新配对 / 多条 red_of 最新现行」是五处文档的共同断言，实现与自家测试都明确拒绝（red 半边永远钉在已被 supersede 的绿节点上）**

  证据：`core/dag.js:170-178` — 注释「同一 red 节点多条 red_of 合法（rebind 后新配对），查询取最新为现行、全部留作历史」紧接 `const paired = new Set(dag.edges.filter((e) => e.type === "red_of").map((e) => e.from)); … if (paired.has(node.id)) continue;`；同断言在 `AGENTS.md:69`（§4 #24「rebind=supersedes 链+red_of 最新现行」）、`AGENTS.md:111`（§8 红绿 manifest）、`CHANGELOG.md:22-24`（「`red_of` pairs red halves to greens (multiple edges legal, latest wins)」）、ADR-0014。实现侧被 `test/evidence-manifest.contract.test.js:109` 与 `test/dag-kernel.contract.test.js:172` 固化为「已配对 red 不重复配」（返回 0）。

  故障场景：红半 → 绿 gen1 → 改码 rebind 绿 gen2 之后，账本里 `red_of` 仍指向 gen1 绿（`supersedes` 才指向 gen2）。`lzy dag dependents <red 节点>` 于是回答「red_of n3（历史代次）」，而 `lzy evidence list` 把「红 ✓ n2 gen1」与「绿 ✓ gen2（现行）」并排显示、不标该配对已过期——按 SKILL/ADR 的说法 comparator 的配对核对以 `lzy evidence list` 为第一来源，读者会得到「红绿当前成对」的错误印象。我在 `/tmp/v009-review-R5-A/repoG` 实测：`red_of: [{"from":"n2","to":"n3"}]`、`supersedes: [{"from":"n4","to":"n3"}]`、`dag dependents n2 → red_of n3`。

  最小探针：`lzy evidence red F1 --evidence r && lzy step done F1 --evidence g1 && git commit -am c2 && lzy step done F1 --evidence g2 && node -e 'console.log(JSON.parse(require("fs").readFileSync(".lazyzcode/loop/dag.json")).edges.filter(e=>e.type==="red_of"))'` → 只有一条且 to 为 gen1 绿。

- **[P2] V009-R5-A-3 升级路径上的终验 attestation 可以是空壳（`planHash: null`、`nodeId: null`、`surface: null`），而 CLI/CHANGELOG/Release notes 仍宣称它是「LOOP_COMPLETE 机器证明：planHash+账本锚定证据」**

  证据：`core/loop.js:1097-1098` `const node = findGreenByGeneration(dag, goal.slug, s.id, gen); return { fid: s.id, generation: gen, nodeId: node?.id ?? null, surface: node?.surface ?? null };`、`core/loop.js:1106` `planHash: goal.planHash ?? null`（legacy/旧形 goal 两者皆 null，且无任何提示）；`cli/lzy.js:253` 无条件打印「终验 attestation：…（LOOP_COMPLETE 机器证明：planHash+各根头树+指纹+对照记录）」；`CHANGELOG.md:46` 与 `docs/release-checklist.md:239` 声称该文件含「ledger-anchored evidence refs」。

  故障场景：legacy 双轨（ADR-0014 明文允许「legacy 证据双轨回退行为与 0.0.8 全同」）下 finish 照过，落盘 `{"planHash": null, "evidence":[{"fid":"F1","generation":1,"nodeId":null,"surface":null}], "comparator":null}` —— 一个将来要按「机器证明」消费该文件的人/AI 读到的是锚点全空、且没有任何字段说明这是降级形态；把 null 当「账本无记录」还是「未锚定」无法区分。

  最小探针：`/tmp/v009-review-R5-A/repoC`（0.0.8 造的 goal，把 F1 证据覆写为 treeHash 形态）→ `node cli/lzy.js loop finish`（EXIT=0）→ `cat .lazyzcode/attestations/*.json` 显示 `planHash`/`nodeId`/`surface` 全 null，stdout 仍报「planHash+…」。`repoE`（手写旧形 goal.json，无 planHash）同形。

- **[P3] V009-R5-A-4 doctor `payload-ver` 把市场名/插件名写死为 `lazyzcode-local`，README 记录的「市场 B 路」安装会被报成「未安装」**

  证据：`core/doctor.js:51` `const cacheBase = join(pluginsRoot(), "cache", MARKETPLACE, PLUGIN_NAME);`（`MARKETPLACE = "lazyzcode-local"`，`core/paths.js:9`），`core/doctor.js:56-57` `versions.length === 0 → push("payload-ver","skip","载荷缓存缺席（未安装）——安装后真实会话才读得到载荷…")`。而 README（`README.md:62-65`）明写第二条安装路 `/plugin marketplace add Acfufu/lazyzcode`，其市场名是 `.claude-plugin/marketplace.json` 的 `lazyzcode-marketplace`；registry 证据显示缓存目录段=市场名（`~/.zcode/cli/plugins/installed_plugins.json` 中 `"marketplace": "zcode-plugins-official"` ↔ `cache/zcode-plugins-official/…`）。

  故障场景：只走市场 B 路的用户插件是启用的，`lzy doctor` 却输出「载荷缓存缺席（未安装）」，并把读者推向 `lzy install`（会在 `lazyzcode-local` 下再造一份同 id 载荷）。同函数的三态文档（CHANGELOG「ok/warn/skip」）没有覆盖这一态。

  最小探针：`HOME=/tmp/x mkdir -p /tmp/x/.zcode/cli/plugins/cache/lazyzcode-marketplace/lazyzcode/0.0.9 && HOME=/tmp/x node cli/lzy.js doctor | grep payload-ver` → `➖ payload-ver 载荷缓存缺席（未安装）`（我在 `/tmp/v009-review-R5-A/homeC` 实测）。

- **[P3] V009-R5-A-5 HEAVY 目标缺 `planHash`（0.0.7 目标被 `loop tier heavy` 升格）三重死锁，报错给的补救路径本身不可执行**

  证据：`core/loop.js:1002-1008` HEAVY 门在 `findLatestComparator(dag, slug, goal.planHash)` 返回 null 时拒，文案指向 `lzy attest comparator --file`；`core/attest.js:33-35` `if (!goal.planHash) throw new LoopError('活跃目标无 planHash（计划未快照）…先重新采纳计划')`；而 `core/loop.js:484` 采纳要求 `requireActive(cwd, "planning")`，`lzy loop tier light` 又被「只升不降」拒——即三个建议（attest / 重新采纳 / 降 tier）全部不可执行。

  故障场景：0.0.7 时代注册并 adopted（无 `planHash` 键）的 in-flight 目标，在 0.0.9 上 `lzy loop tier heavy` 后所有步骤 done，`finish` 被 HEAVY 门拒 → 按文案跑 `attest comparator` 被 planHash 拒 → 无路可走（只剩 abandon/reset）。LIGHT 的同一 goal 不受影响（`repoE` 实测 finish 通过）。

  最小探针：手写 `{"status":"executing","tier":"heavy","steps":[{"id":"F1","kind":"F","status":"done","evidence":{"treeHash":"<HEAD^{tree}>"}}]}` 的 goal.json（无 planHash），依次 `lzy loop finish` → HEAVY 门拒；`lzy attest comparator --file v.json` → 「无 planHash…先重新采纳计划」；`lzy loop tier light` → 「只升不降」（我在 `/tmp/v009-review-R5-A/repoF` 实测三连拒）。

- **[P3] V009-R5-A-6 校验和有效但结构不全的 dag.json（人工抢救时删键）→ `evidence list`/`dag dependents` 抛原始 TypeError，而 `verify` 照过——ADR 承诺的「fail-closed 带恢复指路」不覆盖此形态**

  证据：`core/dag.js:52-56` 只校验 `checksum`/`dagVersion`，`payload = { dagVersion, nodes, edges }` 不做结构校验就直接返回；`core/dag.js:257-258` `stalePreview` 内 `dag.edges.filter(...)`、`core/dag.js:236-247` `dependents` 内 `for (const e of dag.edges)`。ADR-0014 与 dag.js 头注承诺「账本解析/校验和失败→一切读账本命令拒绝并给恢复指路」，且 `RECOVERY` 文案本身鼓励人工抢救该文件。

  故障场景：用户照 RECOVERY 手改账本（改完必须重算 checksum 才能被接受），若漏/拼错 `edges` 或 `nodes` 键，`lzy evidence list` 报 `Cannot read properties of undefined (reading 'filter')`、`lzy dag dependents n1` 报 `dag.edges is not iterable`（无恢复指路）；同时 `lzy loop verify`/`finish` 不读 edges，照常放行——同一份坏账本在不同命令下三种姿态。

  最小探针：`node -e 'const fs=require("fs"),c=require("crypto"),p=".lazyzcode/loop/dag.json",o=JSON.parse(fs.readFileSync(p));delete o.edges;const q={dagVersion:o.dagVersion,nodes:o.nodes};fs.writeFileSync(p,JSON.stringify({...q,checksum:c.createHash("sha256").update(JSON.stringify(q)).digest("hex")},null,2))'` → `lzy evidence list`（TypeError）、`lzy dag dependents n1`（TypeError）、`lzy loop verify`（EXIT=0）。我在 `repoG` 实测三条一致。

- **[P3] V009-R5-A-7 用户 guide 的 CLI reference 栅栏未收 0.0.9 三个命令族，`loop finish` 描述仍是 0.0.8 口径（双语）**

  证据：`docs/guide/en.md:506-540`（CLI reference 栅栏 25 行）与 `docs/guide/zh.md:404-430` 不含 `lzy evidence`/`lzy dag`/`lzy attest` 任何一行（`grep -n "lzy evidence\|lzy attest\|lzy dag" docs/guide/*.md` 只命中快起栅栏 232-234 / 198-200）；`docs/guide/en.md:529` `lzy loop finish  final gate: all done + fresh composite fingerprint + all {host}∪subjects trees clean; atomic archive`、`docs/guide/zh.md:421` 同口径——未提 HEAVY 强制 MATCH attestation 与终验 attestation 落盘（README 表 161 行与 SKILL 已覆盖）。

  故障场景：只读 guide（Pages 站的主用户文档）的读者会以为 finish 的门仍是「全 done+指纹新鲜+树 clean」，HEAVY 目标第一次跑 finish 时才撞上 attestation 门；同时 guide 里查不到 `evidence red`/`attest comparator` 的用法（`docs/narrative-checklist.md` 的三面计数只钉了快起栅栏/README 表/帮助枚举，CLI reference 栅栏不在账内）。`docs/guide/en.md:121` 与 `:152`（FAQ「为什么 finish 拒了我的证据」）同样只讲 tree-hash 过期一种拒因。

  最小探针：`sed -n '/^## CLI reference/,/^## Diagnostics/p' docs/guide/en.md | grep -c "evidence red\|attest\|dag dependents"` → 0，而 `lzy --help | grep -c "evidence red\|attest comparator\|dag dependents"` → 3。

- **[P3] V009-R5-A-8 发布的载荷内含 `sess_` 标识（tripwire 注释），与发布清单的「残留外带检查」口径不符**

  证据：`plugin/hooks/tripwire.js:5` — `// 事故背景：sess_95421d3d 同工具空转 79 连调 47 分钟。`；`npm pack --dry-run` 文件清单含 `plugin/hooks/tripwire.js`（36 文件中之一）。`docs/release-checklist.md:3` 的检查项原文要求「输出中 grep 不到 …`sess_`…任何一处」——它只覆盖 dry-run 的**文件名输出**，而 token 在文件**内容**里随包发出。

  故障场景：`npm i -g lazyzcode` 的用户在 `~/.zcode/…/cache/lazyzcode-local/lazyzcode/0.0.9/hooks/tripwire.js` 里读到他人（维护者）会话 id 片段；这属于清单自称要拦的本地残留面，且是未来把完整 `sess_…`／本地路径写进注释时不会被拦的同一条缝。

  最小探针：`npm pack --dry-run 2>&1 | grep tripwire && grep -n "sess_" plugin/hooks/tripwire.js`。

## 已查无发现

- **红线 #1（永不改写用户 config.json）/ 红线 #2（Stop 预算）**：`git diff v0.0.8..HEAD` 新增的全部写点只有 4 处 —— `core/dag.js:71-74`（`.lazyzcode/loop/dag.json` 原子写）、`core/loop.js:946/960`（`.lazyzcode/evidence/` 红半附件）、`core/loop.js:1112/1151-1152`（`.lazyzcode/attestations/`）；diff 内 `config.json` 命中全在文档；`plugin/hooks/*` 逐行未动（文件列表可证），Stop 计数与 3 池互留语义零触碰。
- **升级路径（实弹，非静态）**：0.0.8 `executing` 目标（fingerprint 形态、无 dag.json）→ 0.0.9 `status/verify/finish` 一致拒「账本不一致」；按文案 rebind 一次即恢复，其后 `status/verify` 全绿（`repoA`）。legacy `treeHash` 形态证据**不查账本**，`verify=0`、`finish=0`（`repoC`），与 ADR「legacy 双轨与 0.0.8 全同」相符。缺 `tier/subjects/evidenceSeq/deps/planHash/review` 的旧形 goal.json 在 LIGHT 下 `status/verify/finish/evidence list` 全通（`repoE`）。
- **统一权威实现（读代码 + 复现）**：`findGreenByGeneration` 按 `evidenceSeq-1` 锚定、同代次 `(seq,at)` 决胜；孤儿 ghost（更高代次）不可现行也不阻断；节点 `surface` 为权威、goal.json 的 `evidence.fingerprint` 已不参与判定（`test/dag-authority.contract.test.js:124-140` 用合法校验和翻转 surface 证明判定随账本翻）；`dag-first` 成立（损坏账本时 `step done` 整命令拒且 goal.json 字节不动）。`dag.json` 缺席=空库，只在 fingerprint 形态触发分歧拒——设计如此。
- **HEAVY 门无逃生**：`lzy loop finish --force`、`finish --tier light` 均被同一门拒；`lzy loop tier light` 被「只升不降」拒（`repoA` 实测三连），`--force` 不是绕过面；`attest` 的 schema 校验（slug 不符/未知 fid/空 items/非法 verdict/重复 fid/未覆盖全部 F）我逐条读过 `core/attest.js:79-113` 并与 `test/dag-authority.contract.test.js:248-268` 对齐。
- **doctor 0.0.8→0.0.9 语义 diff**：`git show v0.0.8:core/doctor.js` 对 diff 逐行核过——`push()` 名单差异**只有** `payload-ver` 两个分支；其余改动仅 `orphanTmp` 家族加 `.dag.json.` 前缀、`EXEMPT` 集加 `dag.json`（防疤痕误警），未动任何既有检查的判定。
- **债 #3 的三态声明成立**（scope 点名的问题）：`payload-ver` 三态我实跑四组 HOME —— 缓存含 CLI 版本=✔ ok、只含旧版（`[0.0.7,0.0.8]` 对 CLI 0.0.9）=⚠ 带 `lzy sync` 指路、只含更新版（`[0.1.0]`）=⚠、缓存目录不存在=➖ skip；两侧版本实读（`core/loop.js` 同款 `packageRoot/package.json` 读法），无写死。唯一未覆盖态见发现 V009-R5-A-4。
- **包内容 vs 声明**：`npm pack --dry-run` = 36 文件（cli/2 + core/14 + plugin/15 + CHANGELOG/LICENSE/README×2/package.json），与 `package.json` `files` 白名单、`docs/release-checklist.md` 第 3 步「只含 cli/ core/ plugin/ + README/LICENSE/CHANGELOG/package.json」一致；输出中 grep 不到 `.mimosa`（`plugin/hooks/.mimosa/` 虽在盘上但被 gitignore 语义排除）、`.lazyzcode`、`docs/`、`sess_`、`acfufu`（除包名/文件名）。
- **叙事计数与三面互等**：README 对比表 11/11（双语）、README CLI 表均为 19 数据行（含表头 21 行）、guide 快启栅栏 21/21、CLI reference 栅栏 25/25（`node` 脚本逐栅栏计数）、帮助枚举 17 个 loop 族 + 证据账本 4 条 + 对照 1 条——与 `docs/narrative-checklist.md` 的钉法一致；`AGENTS.md` 149 行（§9 ≤150 预算成立）。
- **SEO/站点**：`docs/robots.txt` 的 `Sitemap:` URL = `docs/_config.yml` 的 `url+baseurl`；`docs/sitemap.xml` 五个 `lastmod` 与对应页改动日一致；`docs/_layouts/home.html:16-20` 的 JSON-LD `softwareVersion=0.0.9`（=package.json）、三平台 `operatingSystem`、`downloadUrl` npm 页；`scripts/docs-preview/build.mjs:96` 同步 robots.txt（本地预览保真）。
- **headless spike 报告 vs 存档**：逐条对 `artifacts/headless-spike-probes/`（p1-help-full.txt 62 行；P2/P3a/P3a2/P4 原文）——`--prompt/-p/--json/--resume/-c/--max-turns/--allowed-tools/--attach/--target/--surface/--mode(缺省 yolo)/login/--no-browser` 全部在 `--help` 出现；token 数（12,025 / 12,052 / cacheRead 11,904）、EXIT 码、sessionId 复用、错误原文与报告 §2-§4 相符；「未测面」如实申报，报告引用的未入库 artifacts 自身有标注。
- **契约句 vs 实现（scope 点名三句）**：same-workspace multi-session（二次 `register` 被拒= `core/loop.js:168-179`、done 占位=同处 `existing` 分支、worktree 出树= `validateSubjectRoot` 双向包含拒 + 树内 worktree 会以未跟踪文件拦 finish、步级认领=claim 族）逐句成立；worktree-as-subject 句有真实契约用例（`test/integrity-kernel.contract.test.js:653-688`，三断言非空壳）；final attestation 句（路径、内容、`reset` 不清、loop/ 外零疤痕）与实现一致。
- **测试现状**：`npm test` 全绿 **211/211**（`AGENTS.md:30` 记的 195/195 是 `test(dag-authority)` 16 例（commit 8803d95）落地前的计数，属陈账非虚报）。
- **写纪律**：本次审计未对仓库做任何写操作；`git status --porcelain` 收尾为空。观察到的唯一写入是**本仓当前会话自身钩子**在忽略路径内的活动：`.lazyzcode/loop/goal.json`（22:05Z 的 claimedAt）与 `.lazyzcode/loop/sessions/sess_*.json` 计数文件——`git check-ignore` 确认 `.lazyzcode/` 全忽略，非我的命令所致，如实报备。

## 开放问题

1. **V009-R5-A-1 的修法取向**（需拍板，因为触碰 finish/协议语义）：可选 (a) 放行 `done` 态目标的 `step done --evidence`（仅 rebind，不置状态变更）——最小改动且让既有文案成真；(b) 报错文案状态感知（done 态给 `lzy loop reset` 或手修指引，不承诺不可执行的命令）；(c) 在 `verifyEvidence` 里把「无锚定节点」的 legacy-一致语义再放宽（有回声成 false pass 的风险，我倾向否决）。settle 方式：维护者定形后我可用 repoD 复跑三命令做验收。
2. **ADR-0014「篡改 fail-closed」的实际边界**：校验和是无密钥 hash，手改者重算即可通过；我尚未测「重算校验和 + 伪造 `surface.value=当前指纹` 的绿节点」是否会被 finish 接受（静态推理=会接受，且与 goal.json 无保护同族）。若要更准的口径，settle 方式=一次活体伪造探针 + 在 ADR 里把该边界写成「防误损非防同主体改写」。
3. **市场 B 路的缓存目录名**：我依据 registry 的 `marketplace` 字段与官方市场目录同构推断为 `cache/lazyzcode-marketplace/lazyzcode/<ver>`，本机无该目录故未实弹。settle 方式=在一次真机 `/plugin marketplace add Acfufu/lazyzcode` 安装后 `ls ~/.zcode/cli/plugins/cache/` 对照。
4. **升级摩擦是否要在 README「Upgrade」段提示**：0.0.9 对 in-flight/done 的 0.0.8 目标有「先 rebind 才能看/收口」的门；README Upgrade 段（`README.md:116-137`）只讲载荷目录语义，未提该摩擦。是否补一句（以及 done 态是否给专门指引）属叙事裁决，非代码缺陷。
5. **终验 attestation 是否要带一个 `ledgerMode`/`anchored` 标记**（把 V009-R5-A-3 的空锚形态显性化）——涉及 0.0.10 新字段，属协议演进决策。
6. **`sess_` 片段在公开包的取舍**（V009-R5-A-8）：若口径是「注释引用事故可接受」，则发布清单那条 grep 项应写明只查文件清单而非内容；若口径相反，则需清洗 tripwire 注释——两条路都需维护者定，我不代裁。

#### R5-B

# R5-B · 跨面回归 + 宪法一致性（对抗镜）— 原件

## 发现

- **[P1] V009-R5-B-1 HEAVY 对照门可被「旧记录」满足：comparator 记录不绑它所裁决的证据，重取证/重注册即失效**
  证据：`core/loop.js:1003` — `comparator = findLatestComparator(dag, goal.slug, goal.planHash);`；`core/dag.js:218-223` 只按 slug+planHash 取最新；`core/loop.js:1016` — `if (comparator.fingerprint !== fingerprint) {`（唯一新鲜度判据=树指纹）；`core/loop.js:731-745` rebind 只追加新 green 代次、不改指纹；`plugin/skills/zw/SKILL.md:255-259` — "a current MATCH attestation whose fingerprint matches the tree"。
  故障场景：(a) 同一 goal 内：F1 取证 → `attest comparator` MATCH → 在同一棵树上重取 F1 证据（`step done F1 --evidence "x"`，代次 gen2）→ `finish` 放行，attestation 记 `comparator: n4`（对照的是旧证据）+ `evidence: gen2/n5`（新证据从未被对照）。(b) `reset` 后同 slug 重注册 + 逐字相同计划 + 同一棵树：上一实例的 MATCH 直接满足新实例的 HEAVY 门（此路径我已实测 finish 通过，evidence 文本是 `"x"`）。两案例中 finish 都打印「全部步骤收口，F 项证据绑复合指纹，subject 集全 clean」。
  最小探针：`mkdir -p /tmp/r5b && cd /tmp/r5b && git init -q . && git config user.email a@b.c && git config user.name t && printf -- '- [F1] f\n' > plan.md && echo h>h.txt && git add -A && git commit -qm init` 然后 `lzy loop register heavyrebid --title x --tier heavy` → `lzy loop plan plan.md --review "VERDICT: PASS - ok"` → `lzy loop start` → `lzy step done F1 --evidence "STRONG v1 evidence"` → `printf '%s' '{"slug":"heavyrebid","items":[{"fid":"F1","verdict":"MATCH","basis":"v1"}]}' > /tmp/v.json && lzy attest comparator --file /tmp/v.json` → `lzy step done F1 --evidence "x"` → `lzy loop finish`（EXIT=0，attestation 里 comparator=n4 / evidence=gen2）。实测输出：`✔✔ 目标完成：heavyrebid — x`。
- **[P2] V009-R5-B-2 无 planHash 的目标被 `loop tier heavy` 升级后 finish 死锁，四个命令互相推诿、无破坏性出口之外的出路**
  证据：`core/loop.js:203-232`（setTier：planning/executing 可升，只升不降，warn 只提评审）；`core/loop.js:1002-1005`（HEAVY 门按 planHash 取 comparator）；`core/attest.js:33-35` — `` 活跃目标无 planHash（计划未快照）——对照 attestation 绑定现行计划，先重新采纳计划 ``；`core/loop.js:484` — `const goal = requireActive(cwd, "planning");`；`core/loop.js:212-214` — `tier 只升不降：heavy 目标不可降为 light`。
  故障场景：0.0.7 时代注册、仍 executing 的 goal（无 planHash；其 legacy treeHash 证据在 0.0.9 下 verify/finish 本可正常通过——我实测该 goal 单独 finish 成功）→ 用户跑 `lzy loop tier heavy`（输出只 warn 评审，不提 planHash）→ 此后 finish 恒拒「HEAVY finish 需对照 attestation」；照指路跑 `attest comparator` 被拒「先重新采纳计划」；`loop plan` 被拒「要求 planning」；`loop tier light` 被拒「只升不降」。唯一出口 `abandon`/`reset`（销毁 executing 状态）。
  最小探针：scratch 手写 0.0.7 形状 goal.json（executing、legacy `evidence.treeHash`=HEAD 树、无 planHash/tier/subjects）→ `lzy loop tier heavy` → `lzy loop finish`（拒）→ `lzy attest comparator --file v.json`（拒）→ `lzy loop plan plan2.md`（拒）→ `lzy loop tier light`（拒）。实测四条输出如上引用。
- **[P2] V009-R5-B-3 done 态 0.0.8 goal 升级后 `lzy loop status` 恒拒，且给出的恢复命令在该状态下永远失败**
  证据：`core/loop.js:926-937` — `` `证据账本不一致：${s.id} 记录第 ${gen} 代绿半但中央 DAG 无对应节点` … `恢复：在当前代码上重跑 lzy step done ${s.id} --evidence …` ``；`core/loop.js:1566-1572` formatStatus 在 `executing|done` 分支调 `verifyEvidence` 且无 catch；`core/loop.js:648` — `const goal = requireActive(cwd, "executing");`；`docs/adr/0014-…md` 增补节把该状态限定描述为「0.0.8 在途 goal 升级」。
  故障场景：0.0.8 已 finish 的 goal（status=done，按 SKILL:168-169 的契约「a `done` goal keeps the slot until `lzy loop reset`」正常占槽）升级 0.0.9 后：`lzy loop status` 抛上述错误 → 照指路 `lzy step done F1 --evidence …` 反拒「目标 … 当前状态 done，此操作要求 executing」→ `loop finish` 同拒。要让 status 恢复，只能 abandon/reset 一个**已完成**的目标。（顶层 `lzy status`、`loop history/list/export`、`evidence list` 均不受影响。）
  最小探针：scratch 写 0.0.8 形状 goal.json（status `done`、fingerprint 形态 F 证据、无 dag.json）→ `lzy loop status`（EXIT=1）→ `lzy step done F1 --evidence x`（EXIT=1「要求 executing」）→ `lzy loop finish`（EXIT=1）→ `lzy loop abandon`（EXIT=0，状态变 abandoned）。
- **[P2] V009-R5-B-4 多会话契约与 CLI 报错互斥：槽位报错教人做 SKILL 明令禁止的 abandon/reset**
  证据：`plugin/skills/zw/SKILL.md:170-172` — `**Never `reset`/`abandon` a slot another session is actively running** — that destroys its executing state (only a salvage stub survives); the slot error means "move to a worktree", never "clear the slot".`；`core/loop.js:171-173` — `` `已有进行中的目标 ${existing.slug}（${existing.status}）；先 finish/abandon，或 lzy loop reset` ``。
  故障场景：会话 A 正在 executing；会话 B `register` → 唯一可见的指引是「先 finish/abandon，或 lzy loop reset」；模型或人照做 → A 的循环被销毁（SKILL 原话：只剩 salvage 存根），A 的下一步 `step done` 失败、Stop 拉回失效。0.0.9 新增的这条红线没有落进任何机器面（报错文本是 0.0.8 遗留，未被本版同步）。
  最小探针：`lzy loop register slotowner --title owner && lzy loop plan plan.md && lzy loop start && lzy loop register intruder --title intruder` → 实测输出即上述原文。
- **[P2] V009-R5-B-5 已发布 0.0.9 载荷 ≠ 仓库 HEAD：发布版 SKILL.md 少两行速查表，全文不含 `dag dependents`**
  证据：`git archive v0.0.9 | tar -x -C /tmp/t && cd /tmp/t && npm pack --dry-run` → `shasum: 90ec541719bf73ed6565678db0687743665b5c29` = registry `dist.shasum`（发布物=tag 树）；而 `git diff v0.0.9..HEAD -- plugin/skills/zw/SKILL.md` 增 2 行（`| lzy evidence red <Fid> · waive-red …` 与 `| lzy dag dependents <id|surface> |`）；tag 树内 `grep -c dag plugin/skills/zw/SKILL.md` = 0（正文与速查表都没有该命令）。
  故障场景：从 npm 装 0.0.9 的真实会话读到的技能文本对 `lzy dag dependents` 零提及，而同一版本的 CLI 提供该命令；同一版本号下仓库树与 registry 载荷内容不同，任何「版本号一致=载荷一致」的推理（doctor payload-ver 的 `一致`、status 的版本比对）对此失明。市场 B 路更甚：`.claude-plugin/marketplace.json` 的 `ref: v0.0.9` 会把 tag 树（缺行版）作为载荷发给用户，而 manifest 自身来自 HEAD。
  最小探针：上述两条命令。
- **[P2] V009-R5-B-6 `red_of`「多条合法、最新为现行」三处文档承诺，代码永不重配对**
  证据：`core/dag.js:171` — `// 同一 red 节点多条 red_of 合法（rebind 后新配对），查询取最新为现行、全部留作历史。`，但 `core/dag.js:172-183` — `const paired = new Set(dag.edges.filter((e) => e.type === "red_of").map((e) => e.from)); … if (paired.has(node.id)) continue;`；`AGENTS.md:30 / :69 / :111`（「rebind=supersedes 链+多条 red_of 最新现行」）；`docs/adr/0014-…md:23`；`CHANGELOG.md:21` — `greens (multiple edges legal, latest wins)`。
  故障场景：实测序列 red(n2)→green(n3,gen1) 配对成立；改码后 rebind → green(n4,gen2) 落地，n2 的 `red_of` 仍指**已被 supersede 的** n3，现行 green n4 没有任何 red 配对；想查「现行红半」的 `lzy dag dependents n4` 返回 0 命中。文档描述的多边状态只能靠手改账本产生。
  最小探针：`lzy evidence red F1 --evidence "pre-fail"` → 改码提交 → `lzy step done F1 --evidence "post-ok"` → 再改码提交 → `lzy step done F1 --evidence "post-ok v2"` → `lzy dag dependents n2`（只回 `→ red_of n3`）+ 读 `dag.json` 的 edges（无第二条 red_of）。
- **[P3] V009-R5-B-7 `payload-ver` 的 ok 判据是「缓存目录集包含 CLI 版本」，不等于「会话加载的载荷是新版」**
  证据：`core/doctor.js:46-76` — `if (cliVersion && versions.includes(cliVersion)) { push("payload-ver", "ok", … 一致) }`；引擎实读 `function lPt(e,t){let r=t.installPath||yPt(e,t.marketplace,t.name,t.version)`（`/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`，installPath 来自 `installed_plugins.json`）→ 实际加载面是 registry 的 installPath，payload-ver 完全不读它。
  故障场景：①`~/.zcode/cli/plugins/cache/lazyzcode-local/lazyzcode/` 内同时有 0.0.8/0.0.9 目录、而 registry installPath 仍指 0.0.8（`sync` 的 `deployFiles`→`upsertRegistryEntry` 之间崩溃/kill 即得此态）→ payload-ver `✔ 缓存 [0.0.8, 0.0.9] · CLI 0.0.9 一致`（fake HOME 实测，整跑 exit 0），会话读的却是 0.0.8 载荷；该态的唯一线索是同跑的 `install` warn 行。②只走市场 B 路安装的机器，载荷落 `cache/lazyzcode-marketplace/lazyzcode/<ver>`，而检查硬编码 `MARKETPLACE = "lazyzcode-local"` → 报 `payload-ver ➖ 载荷缓存缺席（未安装）`（fake HOME 实测）。
  最小探针：`HOME=/tmp/fh LZY_ZCODE_ENGINE=/nonexistent node cli/lzy.js doctor`，HOME 内构造 `plugins/cache/lazyzcode-local/lazyzcode/{0.0.8,0.0.9}` + `installed_plugins.json` 的 installPath 指 0.0.8。注：其**文档所述**状态（npm 升了但没 sync，缓存只有旧版）实测正确报 warn（`缓存 [0.0.8] 无 CLI 0.0.9 的载荷目录：跑 lzy sync`），三态 skip 也正确。
- **[P3] V009-R5-B-8 「read `lzy loop status`（claims, dirt）」——status 从不显示 dirt**
  证据：`plugin/skills/zw/SKILL.md:179` — `` `lzy loop status` (claims, dirt) before you claim the finish.``；`docs/guide/en.md:618` — `claims and dirt first).`；`core/loop.js:1569-1573` 只印 `tree <hash>` 与「证据时效：新鲜/过期/未绑定」；`docs/guide/zh.md` 同句。
  故障场景：多会话协作的最后一步「先看 status 的脏面再领 finish」落不了地——实测把工作树改脏后 `lzy loop status` 输出对 `dirty|脏|clean` 零命中（dirt 只出现在 `lzy loop verify` 的逐树行与 finish 拒绝文案里）。0.0.8 的 status 同样没有 dirt 行，所以这不是回归，而是新契约句指向了不存在的信号。
  最小探针：`echo dirty >> h.txt && lzy loop status | grep -icE "dirty|脏|clean"` → `0`；对照 `lzy loop verify` 印 `树 … DIRTY`。
- **[P3] V009-R5-B-9 终验 attestation 在状态翻转之前落盘：写失败/kill -9 会留下自称 LOOP_COMPLETE 的证明而 goal 仍 executing；`attestations/` 的孤儿 tmp 无清扫、无体检**
  证据：`core/loop.js:1066` 写 attestation，`:1072` 才 `writeGoal(cwd, goal);`（两者之间的失败/kill -9 无任何回滚或校验）；`core/loop.js:1080-1097` attestation 用 tmp+rename（`.<attemptId>.<pid>.<ts>.tmp`）；`core/loop.js:1343` — `const tmpFamilies = [`.${goalName}.`, ".dag.json."];`（只登记 `loop/` 内两族）；`core/doctor.js:215-217` orphanTmp 也只扫 `loop/`。
  故障场景：finish 在 attestation rename 之后、writeGoal rename 之前进程死掉 → `.lazyzcode/attestations/<slug>-<ts>.json`（自称 LOOP_COMPLETE 机器证明）与 `goal.json`（仍 executing）互相矛盾，且没有任何读面交叉核对（`history`/`status`/`doctor` 都不读 `attestations/`，其缺席或无对应 done 状态也无告警）。同类窗口残留的 attestation tmp 文件不在 doctor 孤儿计数里、`reset` 不清。
  最小探针：无（窗口需故障注入；代码行即证据，未做活体重放）。
- **[P3] V009-R5-B-10 legacy goal 的 attestation 是弱证明，但 CLI 成功行统一宣称含 planHash**
  证据：`core/loop.js:1106` — `planHash: goal.planHash ?? null,`；`cli/lzy.js:253` — `` console.log(`  终验 attestation：${attestation.path}（LOOP_COMPLETE 机器证明：planHash+各根头树+指纹+对照记录）`); ``；`AGENTS.md:30` 同款表述（「LOOP_COMPLETE 机器证明〔planHash+…〕」）。
  故障场景：0.0.7/0.0.8 前采纳计划的 goal（无 planHash）finish 成功 → 实测 attestation 为 `"planHash":null`、`evidence:[{…,"nodeId":null,"surface":null}]`，即该证明既无计划绑定也无账本锚点，但 CLI 打印的文案把它说成含 planHash 的完整证明。
  最小探针：`/tmp/v009-review-R5-B/probeA/.lazyzcode/attestations/legacy-goal-20260916T222202Z.json`（或复现：无 planHash 的 legacy goal 直接 `lzy loop finish`）。
- **[P3] V009-R5-B-11 同 slug 跨实例的证据节点在 `evidence list` 里被显示成 rebind 链**
  证据：`cli/lzy.js:478-497`（按 step 汇总该 slug 全部 evidence 节点，`if (greens.length > 1)` 即印 `rebind 链 N 代`）；`core/dag.js:11-12` + `AGENTS.md:69`（dag.json 跨 reset 常驻）。
  故障场景：实测 `finish` → `loop reset` → 同 slug 重注册 → 重新取证 → `evidence list` 印 `F1 · 绿 ✓ gen1（…）` + `rebind 链 2 代（gen1→gen1，现行 gen1）`：两个节点其实来自两个不同目标实例，被叙述成同一次重取证。SKILL:214-215 又把 `evidence list` 定为 comparator 的「first source」，误导面被体制化。
  最小探针：同一 slug 做两遍完整 loop（中间 `loop reset`）后 `lzy evidence list`。

## 已查无发现

- **legacy 双轨**：0.0.7 形状 goal（`evidence.treeHash`、无 tier/subjects/planHash/evidenceSeq）`verify`/`finish` 全链通过并落 attestation；`status`/`verify` 的 legacy 分支与 0.0.8 逐字段同（0.0.7 与 0.0.8 都有 `evidenceSeq`，`?? 1` 归一使代次锚定自洽）。
- **0.0.8 在途 goal 的文档恢复路径可执行**：fingerprint 形态无节点 → verify/status/finish 全拒（单条恢复文案）→ `lzy step done F1 --evidence …` rebind 成功（`↻ 步骤重取证`，node seq=1）→ verify 新鲜 → finish 过（EXIT=0）。findings #3 只限 **done** 态。
- **账本损坏 fail-closed**：截断 dag.json 后 verify/finish/status/`evidence list` 全部 exit 1 + 单条恢复文案；`loop list`（跨仓）每仓 try/catch 不炸；doctor 照常出线（loop ✔/state ✔），不误报。
- **校验和不是签名**：手改节点并重算 checksum 的账本会被接受（首轮未重算时正确拒「校验和不符」）。文档只承诺「防落盘时态不一致/撕裂」，未承诺防篡改，且 `goal.json` 本身零校验和 → 未列为发现（信任模型问题见开放问题）。
- **dag tmp 家族三处接线**：doctor 孤儿计数（`.goal.json.`+`.dag.json.`=2）与 `loop reset` 清扫实测正确，非登记家族（`.other.123.456.tmp`）不误删；`loop/` 内 `dag.json` 不触发空壳疤痕。
- **红绿全链**：red 默认指纹面 / `--surface` 外表面 / `waive-red --reason`（缺 reason 拒、red 缺 --evidence 拒）/ green 自动镜像 / supersedes 链 / `evidence list` 表面短码与「历史代次」标签 / `dag dependents` 的 node 与 surface 两形态——均按文档工作；无 goal 目录下 `evidence red`/`attest` 不留 `.lazyzcode/` 空壳（fail-fast 补口实测）。
- **worktree-as-subject**：`test/integrity-kernel.contract.test.js` 的 `worktree-as-subject` 用例 25/25 过；活体：真实 `git worktree` 根可 `subject add`、脏态按根隔离（host clean / worktree DIRTY）、finish 拒文点名 subject 根并列 `命中：a.txt`；SKILL 的「树内 worktree = 未跟踪拦 finish」实测 `?? inw/`。
- **两条红线**：`git diff --name-only v0.0.8..HEAD` 不含 `plugin/hooks/`；全仓无 config.json 写入路径（仅 `core/status.js:208` 只读探测）+**；Stop 预算逻辑未动。
- **包内容**：`npm pack --dry-run` 36 文件 = cli/core/plugin（skills/hooks/agents/manifest）+ README×2 + CHANGELOG，无 `.mimosa/`、`artifacts/`、`test/`、`docs/`、`.lazyzcode/` 泄漏；tag 树打包 shasum 与 registry `dist.shasum` 逐字一致 → 发布物即 v0.0.9 tag 树（漂移点仅 finding #5）。
- **版本面**：package.json / plugin.json / marketplace.json 三体皆 0.0.9，registry latest=0.0.9，HEAD 已推 origin/main，Pages 站 `robots.txt`（含 Sitemap 行 + GPTBot 段）活体在场。
- **计数钉**：README 编号表 11/11（双语）、`lzy help` 新增证据账本 4 条 + 对照 attestation 1 条与 narrative-checklist 的三面口径一致；`narrative-checklist` 的 v009 刷新描述与实测计数相符。
- **测试基线**：`npm test` 211/211 绿（含 3 个新契约文件 25+16+…）。

## 开放问题

1. **账本与 attestation 的信任模型未定**：两者都无签名、同用户可写，god.json 更连校验和都没有。若「LOOP_COMPLETE 机器证明」将来要对第三方/CI（发布闸门、审计）有意义，就需要签名或 append-only 存储；如果它只服务本机的人/模型自查，现状足够。哪种？这决定 `checksum` 的定位要不要在 ADR 里写死。
2. **comparator 门的绑定面**：要不要把「F 证据节点 id / 证据文本 sha256 / evidenceSeq 代次」纳入 gate 的现行判据（finding #1 的直接修法）？这与「指纹=唯一新鲜度」的设计取舍相冲突，属拍板题。
3. **done 态 goal 的 divergence 出路**：是否给 `loop status` 一个降级读面（对齐 R6A-2 的「单项降级 warn 不连坐」家法），或给 done 态一条 re-attest 通道？现 ADR-0014 增补节写的是「status 一律拒」，与 finding #3 冲突，需要显式拍板哪一边让路。
4. **pre-0.0.8 goal 的 tier 升级**：应在 `setTier` 拦（无 planHash 不得升 heavy）还是提供 re-plan 通道？涉及宪法「只升不降」，不宜由实现自决。
5. **已发布 0.0.9 与 HEAD 的载荷漂移**（finding #5）：是发 0.0.10 修正（顺带补 `dag dependents` 的 payload 文档），还是接受「tag 即发布物、repo 可前进」？另需决定 `docs/release-checklist.md` 是否要把「发布后不改动 `plugin/` 下任何文件」写成硬规则（本版只改了 2 行速查表，正是这类漂移最容易再发生的形态）。
6. **`windows-11-aarch64` 的 payload-ver 双态活体已在 release-checklist 记账**（sync 前 ⚠ / sync 后 ✔），与我的 fake-HOME 结论一致；但 finding #7 的两个旁态（registry 落后 / 市场 B 路）在 VM 上未被覆盖——是否有计划补一次 VM 复测，还是接受为已知边界，需要裁决。

## 亲核判定表（44 条唯一发现）

（去重层：79 条原始 → 44 条唯一；每条的完整判定依据、探针与偏差记账见 artifacts/v009-review/adjudication.md，本节为索引表）

| 编号 | 严重度 | 判定 | 标题（摘） | 来源（原始评审编号） |
|---|---|---|---|---|
| V009-ADJ-01 | P0 | 成立 | 不可读账本被静默当空库，下一写命令整库覆写，红/waive 唯一副本被毁 | V009-R1-A-1 · V009-R2-A-1 · V009-R1-B-1 |
| V009-ADJ-02 | P1 | 成立 | HEAVY 对照门不绑证据：可先于证据落账、可在 rebind 后复用、可跨 reset 重开复用 | V009-R1-A-2 · V009-R3-A-2 · V009-R3-B-1 · V009-R5-B-1 |
| V009-ADJ-08 | P1 | 成立 | HEAVY + 零 F 计划死锁：finish 要对照、attest 拒无 F 项、tier 只升不降 | V009-R3-A-1 · V009-R3-B-2① |
| V009-ADJ-10 | P1 | 成立 | done 态 goal + 账本分歧：`loop status`/`verify` 恒拒，且报错的恢复命令在该状态不可执行 | V009-R5-A-1 · V009-R5-B-3 |
| V009-ADJ-24 | P1 | 成立 | 同代次第二条红半附件静默覆写第一条：账本 sha256 成假声明；失败命令同样落盘 | V009-R2-A-4 · V009-R2-B-2 |
| V009-ADJ-03 | P2 | 成立 | `evidence list` 无尝试/代次锚定：现行绿显示错节点、跨实例红绿混显、孤儿误诊、legacy 轨缺席 | V009-R1-A-3 · V009-R1-A-7 · V009-R2-A-2 · V009-R2-B-1 · V009-R2-B-4 · V009-R5-B-11 |
| V009-ADJ-04 | P2 | 成立 | `red_of` 永不重配对：rebind 后现行绿无配对边；五处文档/测试标题与实现互斥 | V009-R1-A-4 · V009-R2-A-3 · V009-R1-B-3 · V009-R4-B-5 · V009-R5-A-2 · V009-R5-B-6（六镜同报） |
| V009-ADJ-05 | P2 | 成立 | 校验和合法但结构畸形/不全的账本：裸 TypeError 或静默假答，无恢复指路 | V009-R1-A-6 · V009-R1-B-4 · V009-R5-A-6 |
| V009-ADJ-06 | P2 | 成立 | finish 窗口内指纹与各根头树两次采样：可产出自我矛盾的 LOOP_COMPLETE | V009-R3-A-3 · V009-R3-B-4 |
| V009-ADJ-09 | P2 | 成立 | 无 planHash 目标（0.0.7 在途/手写旧形）升 heavy 后 finish 三连拒死锁 | V009-R5-A-5 · V009-R5-B-2 · V009-R3-B-2③ |
| V009-ADJ-11 | P2 | 成立 | legacy（treeHash）证据是统一权威的按步退出口：subject 变更/提交对其不可见，可产出假 finish | V009-R3-B-3 |
| V009-ADJ-12 | P2 | 成立 | legacy goal 的终验 attestation 是空壳（planHash/nodeId/surface 全 null），CLI/CHANGELOG/AGENTS 仍称其含 planHash | V009-R5-A-3 · V009-R5-B-10 |
| V009-ADJ-13 | P2 | 成立 | finish/step 临界段可超 LOCK_STALE_MS（10s）：对端抢锁后其 goal.json 更新静默丢失 | V009-R3-A-6 · V009-R3-B-5 |
| V009-ADJ-15 | P2 | 成立 | 已发布 0.0.9 载荷/README ≠ 仓库 tag 后内容；doctor `files` 指引会把未发布内容同步进已发布版本目录 | V009-R4-A-3 · V009-R4-B-10 · V009-R5-B-5 |
| V009-ADJ-16 | P2 | 成立 | 「孤儿 ghost 不可现行」语义零测试保护：latest-wins 突变全绿 | V009-R4-A-1 · V009-R4-B-1 |
| V009-ADJ-17 | P2 | 成立 | `stalePreview` 的 `stale` 分支零断言（测试标题谎报五态） | V009-R4-A-2 · V009-R4-B-6 · V009-R1-B-7 |
| V009-ADJ-18 | P2 | 成立 | `attest comparator` schema 校验分支大多零覆盖（missing fid / 重复 fid / verdict 词形 / 无 planHash / 空 items 双分支） | V009-R4-A-4 · V009-R4-B-2 |
| V009-ADJ-19 | P2 | 成立 | 终验 attestation 的账本锚定只有形状断言：绑错节点全套存活 | V009-R4-B-3 |
| V009-ADJ-20 | P2 | 成立 | `attest` 路径的 pre-lock 守卫零测试：删掉即在无 goal 目录重新留疤 | V009-R4-B-4 |
| V009-ADJ-23 | P2 | 成立 | `evidence list` 节点筛选 O(R×N×E) 嵌套扫描：ADR 自设「万边级」规模下挂死 | V009-R1-B-2 |
| V009-ADJ-36 | P2 | 成立 | 槽位占用报错教人 abandon/reset，与 SKILL 多会话红线直接互斥 | V009-R5-B-4 |
| V009-ADJ-38 | P2 | 成立 | doctor `payload-ver` 的 ok 判据不含 registry installPath：会话实际加载旧载荷时仍报「一致」 | V009-R5-B-7① |
| V009-ADJ-44 | P2 | 成立 | `pairReds`/`addSupersedes` 跨尝试连线：上一实例的红半被配给本实例绿半；supersedes 代次倒挂 | V009-R2-B-3 |
| V009-ADJ-07 | P3 | 成立 | 终验 attestation attemptId 秒粒度：同秒二次 finish 静默覆写上一份 | V009-R3-A-4 · V009-R3-B-6 |
| V009-ADJ-14 | P3 | 成立 | 部分失败窗口的读面矛盾：attestation 写失败后报告/history 已报 done（goal 仍 executing）；attestation 先于 writeGoal 落盘，其 tmp 不入孤儿清扫 | V009-R3-A-5 · V009-R5-B-9 |
| V009-ADJ-21 | P3 | 成立 | 红半附件 CLI 路径与红半脏树提示零覆盖 | V009-R4-A-5 |
| V009-ADJ-22 | P3 | 成立 | 两处测试标题宣称语义既无断言也无实现（「多条 red_of 取最新」；`nextId` 恒真断言） | V009-R4-A-8（+ V009-R1-B-7 同族） |
| V009-ADJ-25 | P3 | 成立 | `--surface` 三处静默降级：悬空/空值悄悄绑复合指纹；`n<id>` 形状外部面不可查；`waive-red --surface` 被丢弃 | V009-R2-A-7 · V009-R2-B-5 · V009-R1-A-5(P3 半) |
| V009-ADJ-26 | P3 | 成立 | `dag dependents` 对不存在的节点 id 答「命中 0」，与「存在但无依赖」不可区分 | V009-R1-A-5 · V009-R1-B-6 |
| V009-ADJ-27 | P3 | 成立 | id 分配器无格式校验 + 浮点自增：可产重复/非单调 id，`n1e+21` 被误路由到表面分支 | V009-R1-B-5 |
| V009-ADJ-28 | P3 | 成立 | `evidence list` 把 comparator 节点计入「N 节点」却不渲染 | V009-R2-A-6 |
| V009-ADJ-29 | P3 | 成立 | 账本查询面把 comparator 节点渲染成 `review` | V009-R2-B-7 |
| V009-ADJ-30 | P3 | 成立 | 视图静默吞数据：同代 waiver 被红半遮蔽；红半附件在所有读面与证据包不可达 | V009-R2-B-6 |
| V009-ADJ-31 | P3 | 成立 | CHANGELOG [0.0.9] 两个 `### Added` 段 | V009-R4-A-6 · V009-R4-B-9 |
| V009-ADJ-32 | P3 | 成立 | AGENTS §7 仓库地图仍写 adr/0001..0012（0013/0014 不在图内） | V009-R4-B-8 |
| V009-ADJ-33 | P3 | 成立 | docs/robots.txt 落在项目子路径：对爬虫不生效（源站根 404） | V009-R4-B-7 |
| V009-ADJ-34 | P3 | 成立 | headless spike 报告「zcode.cjs 11.4MB 单行」与事实不符（实为 3583 行） | V009-R4-A-7 |
| V009-ADJ-35 | P3 | 部分成立 | SKILL 机器账本句两处与代码不符：①「unreadable ledger fails closed」为假 ②「authority」与「records/adjudicates nothing」同段张力 | V009-R2-A-5 · （V009-R4-B 开放问题同域） |
| V009-ADJ-37 | P3 | 成立 | doctor `payload-ver` 市场名硬编码 `lazyzcode-local`：市场 B 路安装被报「未安装」 | V009-R5-A-4 · V009-R5-B-7② |
| V009-ADJ-39 | P3 | 成立 | subject 根消失：先报「证据过期请重取」（错误药方），且 `subject remove` 拒收报错文案给的路径写法（/tmp vs /private/tmp） | V009-R3-B-7 |
| V009-ADJ-40 | P3 | 成立 | guide 双语 CLI reference 栅栏与 finish 描述停在 0.0.8 口径（三命令族缺席） | V009-R5-A-7 |
| V009-ADJ-41 | P3 | 成立 | 发布载荷内含 `sess_` 标识（tripwire 注释），发布清单「残留外带」检查只覆盖文件名 | V009-R5-A-8 |
| V009-ADJ-42 | P3 | 成立 | SKILL/guide 教「先读 status 的 dirt 再领 finish」，而 `loop status` 从不显示 dirt | V009-R5-B-8 |
| V009-ADJ-43 | P3 | 成立 | 恢复指引要求「人工抢救后重建」，但手改账本必被校验和拒；校验和算法/归一规则未文档化，无 repair/import 面 | V009-R1-A-8 |

统计：唯一发现 44 条；成立 43 · 部分成立 1 · 证伪 0 · 需压测确认 0（P0 1 / P1 4 / P2 18 / P3 21）。原始发现 79 条（A 37 + B 42），去重收敛率 55.7%。

## 亲核探针原始输出（P0/P1 全量 · 逐文件全文）

主代理亲跑（/tmp/v009-chief/ scratch）；存档原件 artifacts/v009-review/probes/。含 P0/P1 五条 + A/B 争议条一条。

### probes/adj01-chmod-destroy.txt — V009-ADJ-01（P0）不可读账本被静默当空库+覆写毁账

```text
== evidence red ==
✔ 红半账本已记：n3 · red · p01/F1 gen1
  表面（各绑各面）fingerprint:c3f6398838
EXIT=0
== evidence list under chmod 000 ==
证据账本 · 目标 p01 · 0 节点（机器只记账不裁决——缺半不拦门，执法在协议文本+comparator）
  F1 · 绿 ✗（未录） · 红 ✗（未录）
EXIT=0
== step done F1 under chmod 000 ==
✔ 步骤完成：F1 [F] f（1/1）
  证据已绑定 指纹 c3f6398838：green
  全部步骤已收口 → lzy loop finish 做终验
EXIT=0
== PRECIOUS survived count ==
0
== node count after ==
1
== evidence list after ==
证据账本 · 目标 p01 · 1 节点（机器只记账不裁决——缺半不拦门，执法在协议文本+comparator）
  F1 · 绿 ✓ gen1（指纹 c3f6398838 · 新鲜） · 红 ✗（未录）
```

### probes/adj24-attachment-overwrite.txt — V009-ADJ-24（P1）同代次红半附件覆写

```text
node n3 recorded 64ff67c1b91a277c onDisk aae1481c2c29ca9b MATCH false
file content: RED-TWO
EXIT=0
```

### probes/adj02-premature-attest.txt — V009-ADJ-02（P1）对照先于证据 → finish 放行

```text
== attest BEFORE any F evidence (file outside repo) ==
✔ 对照 attestation 已入账：n3 · MATCH · 1 项 · 指纹 c46e911c8e · 文件 sha256 93ccdedcd8b0…
  逐项：F1:MATCH
EXIT=0
== step done F1 (never-compared text) ==
✔ 步骤完成：F1 [F] f（1/1）
  证据已绑定 指纹 c46e911c8e：never compared text
  全部步骤已收口 → lzy loop finish 做终验
EXIT=0
== finish ==
✔✔ 目标完成：p02b — t
  全部步骤收口，F 项证据绑复合指纹，subject 集全 clean。不做完不停——这次真的做完了。
  终验 attestation：.lazyzcode/attestations/p02b-20260916T224018Z.json（LOOP_COMPLETE 机器证明：planHash+各根头树+指纹+对照记录）
  证据包已归档：.lazyzcode/evidence/p02b.report.md（人接管评审从这份材料开始）
  收尾：把本目标 2–3 条可复用教训写进宿主项目 memory，下个会话自动可用。
  提醒：若本工作区挂过 wake automation（无人值守唤起），到 App 自动化管理停用（空槽唤起=纯空转）。
EXIT=0
```

### probes/adj08-zerof-deadlock.txt — V009-ADJ-08（P1）零 F HEAVY 死锁

```text
== finish (zero-F heavy) ==
[lzy] HEAVY finish 需对照 attestation 且 MATCH：先派 qa-executor 对每个 F 项断言×证据逐对对照，再 lzy attest comparator --file <结论.json>（LIGHT 目标可 self-check 免录；机器门无逃生 flag）
EXIT=1
== attest comparator (empty items) ==
[lzy] 本目标无 F 项——对照 attestation 无对象可记（无终验项的目标无需对照）
EXIT=1
== tier light ==
[lzy] tier 只升不降：heavy 目标不可降为 light（宪法 Tier 规则）
EXIT=1
```

### probes/adj10-done-state-deadend.txt — V009-ADJ-10（P1）done 态恢复链死端

```text
== loop status (done state, ledger gone) ==
[lzy] 证据账本不一致：F1 记录第 1 代绿半但中央 DAG 无对应节点（疑 0.0.8 在途 goal 升级或账本缺改）。恢复：在当前代码上重跑 lzy step done F1 --evidence …（rebind 即重注册账本节点）。
EXIT=1
== recovery cmd: step done ==
[lzy] 目标 p10 当前状态 done，此操作要求 executing
EXIT=1
== finish ==
[lzy] 目标 p10 当前状态 done，此操作要求 executing
EXIT=1
```

### probes/adj34-engine-linecount.txt — V009-ADJ-34（P3）A/B 争议条：引擎包行数

```text
== zcode.cjs line/byte count ==
    3583 /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs
 11416833 /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs
== grep -c vs grep -o for env name ==
1
       1
```

## 结果 checklist

### 轮次与派发

- [x] R1 双审（A/B）完成 — 15 条原始发现（A 8 / B 7）
- [x] R2 双审（A/B）完成 — 14 条（A 7 / B 7）
- [x] R3 双审（A/B）完成 — 13 条（A 6 / B 7）
- [x] R4 双审（A/B）完成 — 18 条（A 8 / B 10）
- [x] R5 双审（A/B）完成 — 19 条（A 8 / B 11）
- [x] 合计 **79 条原始 → 44 条唯一发现**（去重收敛率 55.7%）
- [x] 5+5 两波并发派发零判死零中断（狗粮数据点，见方法论 §2）

### 亲核与判定（P0/P1 逐条活体）

- [x] ADJ-01 **P0** 不可读账本被静默当空库 + 下一写命令覆写毁红半 — 活体复现（chmod 000 → `evidence list`「0 节点」EXIT=0 → `step done` 覆写 → 红半 grep 计数 0、节点 id 回收）
- [x] ADJ-02 **P1** HEAVY 对照门不绑证据：先于证据落账 → finish 放行 — 活体复现（EXIT=0「目标完成」）
- [x] ADJ-08 **P1** 零 F HEAVY 死锁 — 活体复现（finish / attest / tier 三连拒）
- [x] ADJ-10 **P1** done 态恢复链不可执行 — 活体复现（`status` 拒 + 文档给的 `step done` 恢复命令被状态闸门反拒）
- [x] ADJ-24 **P1** 同代次红半附件覆写（sha256 成假声明） — 活体复现（recorded≠onDisk，MATCH=false）
- [x] ADJ-34 P3 争议条（A/B 唯一直接分歧）— 活体实测裁定（引擎包 3583 行，「单行」说法证伪）
- [x] 文档面六处 grep 实读（CHANGELOG 双 Added / AGENTS adr 地图 / tripwire sess_ / SKILL 机器账本句 / guide 栅栏 / status dirt 句）
- [x] 判定表 44 条全部落盘：**成立 43 · 部分成立 1 · 证伪 0 · 需压测确认 0**

### 交付面

- [x] 报告本文件（十份原件全文 + 44 条判定表 + 本 checklist）
- [x] `AGENTS.md` §2 收尾行（并入既有 0.0.9 行尾，守 ≤150 行预算）
- [x] roadmap 附记（`artifacts/gap-roadmap-2026-09.md` §⑩ 第 6 条：并发实验数据点）
- [x] 并发实验日志（`artifacts/v009-review/concurrency-log.md`）
- [x] 判定表与探针存档（`artifacts/v009-review/adjudication.md` + `probes/`）
- [x] 红绿半机器账本（`lzy evidence red F1/F2/F3` + `step done` 绿半镜像）
- [x] comparator attestation + 终验 attestation（`lzy attest comparator` + finish 落盘）
- [ ] 修复：**本目标不做**（范围边界；修复归后续目标/用户拍板）

### 修复建议优先级（供后续目标收口）

1. **ADJ-01 (P0)**：`loadDag` errno 判别（仅 ENOENT 当缺席，其余抛 DagError）+「盘上非空而内存空」写护栏 + EACCES/EISDIR/形状三态回归用例。
2. **ADJ-02 (P1)**：comparator 节点绑证据——items 扩为 `{fid, evidenceNodeId|generation, verdict}`，门要求锚定节点在场且对照晚于所锚节点；终验 attestation 记 `at`。
3. **ADJ-10 + ADJ-08/09 (P1/P2)**：done 态 / 零 F / 无 planHash 三族出口——状态感知报错或降级读面（拍板项，涉 ADR-0014 增补节口径）。
4. **ADJ-24 (P1)**：红半附件目标名带节点身份（或存在即拒覆写），失败路径先账本后落盘。
5. **ADJ-03/04/44 (P2)**：manifest 视图与权威同源锚定（`findGreenByGeneration`）+ `red_of` 重配语义与五处文档对齐（二选一拍板）+ 跨实例边据隔离。
6. **ADJ-13 (P2)**：锁临界段心跳或抬 steal 阈值 + attestation/报告 git 读取纳入 8s 预算。
7. **ADJ-06 (P2)**：`writeGoal` 前复采复合指纹并断言相等（不等给「另有会话提交」指路）。
8. **ADJ-15 (P2)**：发布规则（tag 后禁改随包文件）入 release-checklist + payload-ver 增内容级对照。
9. **ADJ-16~20 (P2)**：五种测试缺口补夹具（ghost 面值≠活指纹 / stale 样本 / attest 负例 / 锚定 nodeId 断言 / attest fail-fast）。
10. **ADJ-05/11/12/23/36/38 (P2)** 与 21 条 P3：见判定表逐条修法。

## 证据索引

- 基线：`artifacts/v009-review/baseline.txt`（npm test **211/211** 绿 + doctor 全套行）；原始输出 `npm-test-baseline.txt` / `npm-test-exit.txt`
- 并发实验：`artifacts/v009-review/concurrency-log.md`（建议行原文 / 两波结果 / doctor diff / dogfood 结论）
- 评审原件：`artifacts/v009-review/r{1..5}-{a,b}.md`（十份，与本报告 §二 字节一致）
- 判定表：`artifacts/v009-review/adjudication.md`（44 条 + 探针清单 + 偏差记账）
- 探针存档：`artifacts/v009-review/probes/`（adj01 / adj02 / adj08 / adj10 / adj24 / adj34 / red-F1..F3 / adj-doc-greps）
- 波前后 doctor：`doctor-pre-wave1.txt` / `doctor-post-wave1.txt` / `doctor-pre-wave2.txt` / `doctor-post-wave2.txt`
- 循环开始回执：`artifacts/v009-review/loop-start.txt`（含并发纪律建议行原文）
- 机器凭据：`.lazyzcode/attestations/v009-five-round-dual-review-<UTC>.json`（finish 落盘，LOOP_COMPLETE）
