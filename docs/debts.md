# 挂帐单源账本（debts ledger）

本文件是 LazyZCode 挂帐内容的**库内唯一权威单源**（2026-10-01 立账，goal `debts-ledger`，grill 五拍板 Q1）。旧位置（decisions.md 行内、spike 报告债面节、artifacts 本地底稿）从此只留指针，不承载现行状态。

**维护规则：**

1. 债变更（新记 / 清账 / 升格 / 触发）→ 即时同步本表，并按决策面家法同步 `docs/decisions.md` 相应行。
2. 关账留痕不删行：理据 + 日期 + 指针全保留（§3 已关账档案），防再议。
3. 版本入口 grill 前必核本表一遍，代替全仓考古（v031 拍板「初盘三条全假」教训的制度化解药）。
4. 引用历史底稿 `artifacts/gap-roadmap-2026-09.md`（本地产物，gitignored 不对外）条目时，必须连带核对其后入口节的收口补记，不能只读原始正文。
5. 本表无机器绊线（无 JSONL 消费者，不过度工程）；完整性靠维护规则 3 的人肉纪律 + doctor 既有巡逻面。

---

## §1 现役账（11 件）

### A 线 · 0.5.0 评估重评五项（决策 #42 / ADR-0034 钉死；输入清单底稿 = `docs/spikes/v040-m5-report.md` §8）

| # | 项 | 性质 |
|---|---|---|
| A1 | 密封 oracle check-2 改 glob 形式重封存（Node ≥22 语义；独立子代理 sealedBy 先例；重锚 = 评估集新版次） | 工程件 |
| A2 | finish 门 headless 降阶满足路径——义务在无人值守语境的部分满足语义（本批新臂 0/18 宣称 done，19 次门拦中 12 次为交付已正确后的保守拦）**草案已落：`docs/adr/0037-headless-partial-satisfaction.md`（v050 M1，2026-10-07，三禁边界＋classifyCause 具名收束；归因实测保守拦 13，与历史记 12 差 1 两数并存待拍板）** | **ADR 级拍板**（草案待拍板） |
| A3 | lz 腿评估设计复核：30 分预算 × 自宿主任务对新臂过紧（0/6 完成 vs 旧臂 6/6 宣称）；预算分级或任务瘦身二选一 | 设计拍板 |
| A4 | gate 阈值复议素材：≥2/3 与「一项严格改善」在平局 + 零假完成形态下的解释（本批 = 正确交付平、假完成 0=0、成本 -43%） | 拍板 |
| A5 | oracle 判定器代次治理经验沉淀进 evaluation README（oracleJudge 标记 + --rejudge-oracle 通道） | 文档件 |

### B 线 · 两件终拍（2026-10-01，grill Q3/Q4）

| # | 项 | 终拍结论 |
|---|---|---|
| B1 | H3R 高危步门去留 | **维持休眠 A 态，复验不排期、触发器化**。升格前置=网格复验误停归零（根解半已落地：v024-debt-bundle#N1 分段+词元序列匹配；词法绕过族已收口 v024-fix-round#N6/N7；复验未跑）。触发器 = ① 用户点名升格 B；② 首例无人值守高危误操作真实事故（届时复验+升格一起议）。理据：复验结论唯一消费者是升格拍板，无升格需求则复验无人消费——「结果只作拍板输入」纪律下不跑。决策 #30 / ADR-0022 增补节 |
| B2 | fast 形态判据①（写型双工人灰带） | **灰带按实测归档、不再主动投入**。实测读数入档：f1 0.63×（无收益区）/ h3 1.12×（灰带）；计价反证已强（双工 turns ≈ 串行 2×，即便速度坐实也不翻案）。既定拍板不变：`--workers` 保留主线实验形态、LIGHT only、不默认化（决策 #31 / ADR-0026）。触发器 = 引擎出现 `--model` 旗标 / 计价模型改按会话或墙钟计费时复评一次 |

### C 线 · 编排纪律四项（2026-10-01 grill「四象限评估与补齐」；对照底稿 = `zcode/omo-lzy-compare-report/report.html` 表 6/7；拍板 #43–#46）——**已全部实施并随 0.4.1 发布**（原列 0.5.0 候选，提前收口；goal orch-discipline，2026-10-02：C1=core/graph.js 单源+waveSplit 关键路径 c22f6ef；C2=contested 原语 b293e0a；C3=status/doctor --json 8228746；C4=loop graph 双图视图 2c736f2；实现规格与红绿证据见该 goal attestation）

| # | 项 | 性质 |
|---|---|---|
| C1 | ~~执行图单源核心+三执法点~~ → 已实施（core/graph.js 单源：validateDeps 迁入+就绪谓词单源删手抄副本+波分派关键路径优先；ADR-0036） | 已关账 |
| C2 | ~~异议原语~~ → 已实施（findings open→contested 边+adjudicate 复判+recheck --contested；决策 #44） | 已关账 |
| C3 | ~~观察面契约~~ → 已实施（status/doctor --json schemaVersion 1 只增不改；决策 #46） | 已关账 |
| C4 | ~~loop graph 双图视图~~ → 已实施（执行图×失效 DAG 证据现行性；决策 #46） | 已关账 |

**C 线不追平项**（触发器站岗，勿再议）：mass-ulw 式产品级并行编排/wire 协议/viewer 生态——触发 = 首个需要推送的第三方观察者出现；调度器 grant 派发（与 claim 职责重叠已否，ADR-0036）；消息层（终局宣言 ADR-0035，推翻 ADR 才可再议）。

---

## §2 休眠账（8 件，带触发器站岗，未触发不动）

| # | 项 | 触发器 | 源指针 |
|---|---|---|---|
| S1 | 债 K：engine `--json` usage 摘要作第二计量源的对账 | 真实低延迟计量需求出现（M4 交付面以 CI 轮询为主面，未需亚段计量） | v030-m3-report:86；v030-m5-closeout-report §7 |
| S2 | 债 M4-1：CI flake 根因（push-to-main 腿三次偶发零就绪） | 复发（readiness 原因明细已随 5dfcc83 落地，自诊断面在案；观察窗零复现） | v030-m4-delivery-report:92 |
| S3 | 债 M4-2：d5 账本纠错路径产品化 | 第二例发生或用户点名（correction attempt 留痕路径已足） | v030-m4-delivery-report:92 |
| S4 | §⑫-五：npm provenance（publish 包来源证明，sigstore trusted publishing）迁移（2FA 人闸 vs 自动证明） | npm 生态签名成为分发事实标准，或下游渠道对 provenance 提出要求 | artifacts/gap-roadmap §⑫-五 |
| S5 | §⑫-八：evidence-scope 应用面指纹第二轴（绿证据可选绑声明子域，默认关） | 原节升格条件触发 | artifacts/gap-roadmap §⑫-八 |
| S6 | §⑯：水位警戒线按订阅档位智能调 | 引擎某代本地暴露订阅档位/配额（升「池位百分比」口径） | artifacts/gap-roadmap §⑯ |
| S7 | 非 git 降级形态④（全 `--surface` 外部面 + LIGHT-only + 无 attestation） | 先拍板前置问题「非 git 宿主的 finish 是否该存在」（与 LOOP_COMPLETE 机器证明语义冲突）；现行 = 入口硬拒（`core/loop.js:387-393`，ADR-0019） | artifacts/gap-roadmap §⑫-二 修法候选④ |
| S8 | §⑩ 机制面④：status 同目录并行工作树提示（受匿名立场约束只能到工作树级） | 文本面缓解（①②③ 已落）之后仍频发误判 | artifacts/gap-roadmap §⑩ 收口记录 |

---

## §3 已关账档案（防再议，只增不删）

### 2026-10-01 关账三件（grill Q2「三清八留」）

| 项 | 关账理据 |
|---|---|
| §⑫-七 计费面叙事弹药 | 弹药已由 0.4.0 M5 评估实据覆盖（同量交付积分 98.43 vs 170.83，`docs/reviews/v040-policy-evaluation.md` §5 在档）；且质量宣称受决策 #42 约束押后 0.5.0，义务载体已实质并入 §1 A 线 |
| §⑩ 候补① 8s 闸门墙钟预算误拒 | 本义「复现 `闸门墙钟预算 8000ms 耗尽` 再立账」；0.2.2 棒1 已仪器化（决策 #29）+ 0.0.9→0.4.0 四版本实弹零复现——按自身升格条款永不触发即不立账 |
| §⑩ 候补② CI 场景未 gitignore 构建产物拦 finish | 推断项（原文自注「未实测」）；CI 从不跑 finish，场景不存在；dirty 闸门 UX 已另有改善（报文列前 3 路径 + .gitignore 分句 + 多会话归因半句） |

### 历史核清件（2026-10-01 全仓考古结论，一行一件）

- §⑫-① 拉回空集语义 → 资格制 + standdown 豁免已落（决策 #17 修正案四；`plugin/hooks/stop.js` 资格制分支；ADR-0004/0009 修订）
- §⑫-② 非 git 宿主 → 入口前置硬拒已落（`core/loop.js:387-393`；ADR-0019）
- §⑫-③ attestation 外部锚定 → `Lzy-Attestation` 尾注 + doctor 巡逻已落（`core/doctor.js:1184` 起；SKILL 收尾仪式；ADR-0005 尾注族）
- §⑫-④ 安全信任面文档节 → README「Security & trust surface」+ guide 双语同节已落
- §⑫-⑥ install/sync 前置 Node 探测 → `assertNodeFloor` 已落（`cli/lzy.js:193/214`）
- 债 3 版本错配不可见 → 0.0.9 棒2 收口（doctor payload-ver 对照行）
- §⑩ 缺口 A/B/C（同目录多会话文本/worktree 树外/worktree-as-subject）→ goal multisession-discipline 收口（2026-09-16）
- §⑩-4 锁竞争窗口 → 0.2.2 棒1 仪器化升为可观测（决策 #29；fast-exp 判据③ PASS）
- 债 F（scope 逐写执法升格）→ 不升格，设计终局（v030-m5-closeout-report §7；威胁边界=不防同权限恶意代理）
- 债 G（win32 执行语义核验）→ 0.4.0 M5 前收口（CI 四腿真值 + 双语支持边界；ADR-0011 边界维持）
- 债 I（HEAVY 入队）+ 债 M4-3（queue B/C 编排）+ 债 M4-4（C 面多页爬核）+ 债 L → 0.3.1 棒1 消费（决策 #37 / ADR-0030）
- 债 O（积分 gauge 账号级水位误伤）→ 0.3.1 棒2 消费（决策 #38 / ADR-0027 修正节）
- 债 M（openchamber XDG）/ 债 N（opencode 版本钉线/dist 重 build 纪律）→ 0.3.1 棒1 配方文档化顺带
- C 线评估线（0.4.0 主轴候选预注册）→ 已消费：0.4.0 M5 run-pairs 配对评估收官（决策 #42）
- 0.4.0 内部输入链 M0→M5 全闭合：M2 自审 F-1..F-8 全进 M3；M3 缺陷批 F-3/F-4/F-6/F-7 进 M4（N6）；M4 九条输入在 M5 §6 对表逐条处置（7 落地 / 2 如实不适用）
- findings-ledger.jsonl 80 行（v023/v024 批）全部 fixed（行数钉 80 = 完整性绊线，回填新批次须显式扩钉）
- 宿主升级/sync → 已做（全局 lzy 0.4.0，载荷同版本）

---

## §4 维护者动作项（非代码，用户侧）

- GSC（Google Search Console）验证点击 + sitemap 提交——SEO 悬置，须用户在 GSC 界面操作。
- FAQ JSON-LD 与 guide 正文手工镜像：改 FAQ 须同步 `_includes`（流程性纪律，改动时生效）。
