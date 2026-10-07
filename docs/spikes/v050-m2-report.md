# 0.5.0 M2 报告——设计与候选冻结（v050-m2-freeze，2026-10-08）

goal `v050-m2-freeze`（HEAVY · risk med）· 2026-10-08 · 计划快照 sha256 `322d8280500dd6ab…`（.lazyzcode/plans/v050-m2-freeze.md；plan-reviewer 三轮收敛终版 PASS——修订面：条目标题 ≤300／F6 完整调用面／cpSync 集合定死 7 处／F6·F8 红半补齐／deps 邻接；人权门短码 **322d8280** 批准）。弧定位：0.5.0＝#42 重评兑现版（ADR-0034）第三棒，范围=docs/plan-v050-closure-and-evaluation.md §6 M2 行；拍板依据=决策 #47–#51（2026-10-07）。开工基线：npm test **800/800** 全绿 exit 0 · 214.4s（artifacts/v050/m2-baseline-test.log，当前树实跑）。

## 1 · 冻结面处置对照表（决策 #51：M1 deferred 8 条全修带测试）

| # | M1 deferred（原文锚=评审 JSON） | 处置 | 提交 |
|---|---|---|---|
| 1 | 回执环境指纹缺 TZ 生效时区/PATH 工具链轴（a1.r5 F-1） | envFingerprint 加 tzEffective（TZ 缺席取 Intl 生效时区）＋toolchain（node execPath@version／git --version／sqlite3 探测，逐项 sha256/探测结论）；judgeReuse 文案同步；VERIFY_VERSION 不 bump（追加字段 checksum 绑全文，旧回执照读） | 6de965f |
| 2 | 回执不记录跳过腿（a1.r5 F-2） | runCheck receipt 加 `legs[]`（node --test 摘要计数腿＋TAP `# SKIP` 名单腿；无摘要配方如实空数组）＋raw log 逐腿行——skip 绿与全腿跑过绿在回执面可区分 | 6de965f |
| 3 | verify 配方 cwd/outputs 收容（a1.r13 F-1） | project.js 配方校验补 cwd/outputs 收容（writePaths/inputPaths 同族：绝对拒＋逃逸拒）；inputPaths 回归仍拒 | 6de965f |
| 4 | run-hook /tmp 固定名日志（**a1.r3 F-5**／a1.r13 F-3） | launcher_log 迁 `$HOME/.cache/lzy-hook/launcher.log`（POSIX）／`%APPDATA%\lzy-hook\`（.cmd）——世界可写共享固定名写点整个消失（比计划「/tmp＋uid 掺名」更彻底：预置符号链接改道面不存在）；fail-open 语义不变 | 85e884e |
| 5 | cpSync 符号链接改道（#51「符号链接改道」半） | 七处 recursive 树拷贝补 verbatimSymlinks:true（run-trial 2＋docs-preview build 2＋h3r-trial 2＋run-fast-pair 1）；run-trial.mjs:146 与 qa.mjs:289 为无 recursive 单文件拷贝（flag 对其 no-op）**显式豁免**（本行即报告豁免记录） | 85e884e |
| 6 | classifyCause workers 径落 other（a1.r10 F-3） | 词表补 workers 六族（装配失败/工人段失败/整合验证×3/波间心跳→segment-failed；波间门拒/finish 失败/高危步停摆→gate；波数尽→segments-exhausted）＋单工人两漏族（段间心跳失败→segment-failed）；收束串原文一字不动（git diff 实证零收束串行删除——extract-metrics.mjs 仪器面零牵连，Known-unknown #2 兑现） | 03d2718 |
| 7 | 无人值守缺省 yolo 未在帮助声明（a1.r13 F-4） | drive usage 行补「--mode 缺省 yolo（自动批准工具调用）」＋build\|edit\|plan\|yolo 枚举；zw unattended recipe 同步披露；drive-prompt 契约测试钉两处 | 33fc26a |
| 8 | SECURITY.md 状态清单未涵盖仓外账本/兄弟工作根（**a1.r3 F-3**／a1.r13 F-5） | Design posture 补两声明例外（`~/.zcode/cli/lzy-usage/YYYY-MM.jsonl` 与 `<同级>/<repo>-fast/`）＋钩子日志私有化注记；README/README.zh-CN/CHANGELOG 各补句 | 33fc26a |

**标注勘误**：M1 报告 ：69 行把 run-hook 日志标 a1.r3 F-3、仓外账本标 a1.r3 F-5——与评审 JSON 一手账交叉错（实为 F-5=run-hook 日志、F-3=仓外账本）；本表以评审 JSON 为准（决策 #51 分组语义不受影响）。红半全带：F1 探针 6 断言败／F2 同探针打 0.4.1 发布树 10 断言败（red-green 经发布版当旧行为，红绿同点可重跑）。

## 2 · 收束分类读面（决策 #47 M2 必落）

- classifyCause 补族（§1 行 6）＋收束分类持久化：handoffGoal 登记带 cause 族（marker.cause＋metrics.json `cause:<族>` 计数，跨 reset 永续，永不抛契约同族）；
- 读面：status --json 新增 `handoff-causes` checks 行（分族计数 detail；无登记=skip 免疤痕误警）；doctor 面经 collectStatus 内嵌同享；观察面契约不破（schemaVersion=1、顶层四键、checks 三键——既有契约测试零改动全过）；
- 红半：同探针打 0.4.1 发布树——classifyCause 导出整个缺席＋读面行缺席（exit 1）；绿：工作树 5 断言全过（含 doctor 面在场）。

## 3 · A3 预算定值（决策 #48）

**lz 腿墙钟=45 分/腿**（`wallMsPerRun: 2700000`）。定值来源=artifacts/v040/M5/eval/frozen/journal.jsonl 逐腿 startedAt/endedAt（74 行去回声后 **52 run**；全量数据 artifacts/v050/m2/a3-wallclock.json，sha `a86874f5c751a4f1`）。未删失腿 n=40：p50=15.6／p95=25.9／max=26.6 分；12 腿撞 30 分删失顶（旧批饿死实锤）。规则（预注册）＝ceil5(max(45 分, p95×1.2))＝ceil5(max(45, 31.1))＝**45**。积分帽 400/腿不动（实测 3.3–19.1 分非约束面）。单列额度入 PREREGISTRATION §3：评审 30 分/会话×≤4（沿 a1.r12 实测配置）、失效重跑每腿 ≤1、canary 封存正负各 1＋复跑 1。产品缺省 30 分/400 不动（A3 为评估臂面）。〔Known-unknown #1 兑现：attribution.json 无墙钟字段，定值改用 v040 批逐腿实测——精度升格非降级。〕

## 4 · A4 预注册（决策 #49）

`scripts/evaluation/PREREGISTRATION-v050.md`：§1 主门五条逐字（关键反例全过／新臂关键错误完成=0／每任务≥2/3／正确交付不低于基线／一项严格改善）＋§2 产品标准四件（质量不劣／合法收束率 100%／完成率≥1/2〔9/18〕／积分不升）＋措辞禁令；§3 预算与单列（上节）；§4 实验设计（主比较=v0.4.1 vs 0.5.0 候选；#42 既有默认策略比较**另列段**；trial=3；seed 20261008 交错序；重跑/停止/判读代次统一；独立性纪律）；§5 冻结点（收口回填）。随 M2 收口冻结，冻结后只增补记不改既有文本。

## 5 · 评估集重锚（决策 #50）

- **全新任务集 generation 1**：独立上下文子代理封存三仓×2（artifacts/v050/evalsets/，18 文件＋MANIFEST）；**宿主零阅读**（独立性纪律），机械面=18/18 文件 sha256 复算对表＋MANIFEST 自身校验（sha `8e759cc7ca3356827102c3f9d9391c74100a4b591a3300147fc07e807f77a0d5`）＋盘面/清单文件集相等核验。
- **canary 双向 6/6**：正（修复态）全 pass、负（缺陷态）全 fail——封存侧 mktemp 克隆真实执行（含 zpigeon 两任务 xcodebuild 真模拟器跑）。实现方不复跑：复跑须读判据=破坏独立性；复跑属 M3 批前预飞（PREREGISTRATION §3 canary 单列的「复跑 1」即指彼）。
- **快照**：lazyzcode `1296d18`／openchamber `63bd5070c`／zpigeon-ios **`92ff0922`**（live HEAD rev-parse 实锤——计划记录 96ed3d1 已过时，按封存纪律以实锤封存，偏差记 MANIFEST perRepo.snapshotCommitNote）；三 commit 本地 cat-file 实证在场；zpigeon 兄弟依赖 pin 前移 8541ebca（project.yml 引用 ../zpigeon，夹具兄弟目录家法）记 MANIFEST。
- **排除面**：devSet 六家族＋M0 六任务＋oracle-v3 覆盖缺陷均不相交（封存侧实读核对，宿主免读）；覆盖类别 error-handling/state-restore/boundary。
- freeze manifests：`scripts/evaluation/manifests/v050-freeze-{index,lazyzcode,openchamber,zpigeon-ios}.json`（镜像 m0 形态，budget=N10 定值）＋README 登记节；M0 清单与旧批记录原样保留（重封存不覆盖旧失败记录纪律）。
- **冻结后修正（收口相位，F6 预飞抓出）**：封存 MANIFEST 初版按 perRepo+files 形产出，run-pairs preflight 消费的是 M0 evalsets 形（`repos.<repo>.tasks[{id,briefSha256,defectSpecSha256,oracleSha256}]`，run-pairs.mjs:281-292）——实现方对既有元数据（路径+哈希+canary 判定，均已在案）做**机械重排**（任务内容文件零触碰，18 文件 sha 逐一对表不变；任务文件三 sha 自校验 0 差），MANIFEST sha `8e759cc7ca335682…`→`062a6b6a36862448…`，四份 freeze manifest 同步重钉。候选包身份不受影响（pack=产品载荷；本修正属评估侧清单，预飞随过：batch 冻结 m5eval-20261007200807、36 runs、seed 20261008）。
- **开发材料转挂**（决策 #50）：M0 六任务＋oracle-v3 转开发材料的消费位=A3 墙钟定值（本报告 §3）；语义位记录在 v050-freeze manifests 的 devSet.note。

## 6 · 树外证据重放通道（a1.r5 F-3／a1.r11 F-4 通道半）

`scripts/v050/replay-artifacts.mjs`＋机器索引 `scripts/v050/artifact-index/v050-m1.json`（M1 六工件全 sha256；两条探针逐字节收编树内 scripts/v050/probes/f1-attribution.mjs·f2-metering.mjs）。**首跑实锤 M1 报告 §6 两处索引漂移**：盘面 attribution.json=`c9ed6864a7354053`、attribution.md=`53fe42de5beadc60` 与报告记录 `e86a61e140df4231`/`3e5bea62cfac6841` 不符（修复轮重生成未回填；旧密封记录不改，M1 报告 §6 已补 M2 补记注明 drift 与重放权威）——通道第一次运行就兑现了它存在的理由。

## 7 · 候选冻结（决策 #51 冻结点）

- package.json **0.5.0**＋plugin.json 0.5.0（守护测试钉定的同步点恰此三点：package/plugin/CHANGELOG——test/package.surface.test.js）；**marketplace.json/home.html/sitemap 有意不动**：三者是 release-checklist 第 11 步发布面同步点（ref 钉发布 tag，M4 打 tag 前提前 bump=悬空 install pin）；此口径为本棒对计划「版本同步逐点」的执行解释（按守护测试逐点=守护测试覆盖的点）。
- 基线=v0.4.1 发布包（registry npm pack，tag 9171d2407125）：sha256 `ed0c5285304e9108…`（全量见 PREREGISTRATION §5）。
- 候选包=npm pack（修复轮终树；评审修复轮属 M2 收口内，前轮包 d0ccad722f7e…〔冻结提交 a48d0e1〕被取代）：sha256 `9901ddd9a983b99268fa5d9b696a9de88849e5e4378a1f69f245414324c2ce0b`（§5 文本在包内故 sha 记包外——候选身份=修复轮终树 cbed7aa 之 pack）。
- 冻结后纪律：候选冻结点=M2 收口；M3 零改动（#51）；突破须重新冻结。

## 8 · 证据索引（工件持久家法，M0 口径）

计划快照 `322d8280500dd6ab…`；`.lazyzcode/loop/snapshots/v050-m2-freeze.md` 同内容。工件 sha256（前 16 位）：`a86874f5c751a4f1` a3-wallclock.json · `ed0c5285304e9108` lazyzcode-0.4.1.tgz（基线包）· `062a6b6a36862448` evalsets/MANIFEST.json（重钉后现行值；初版 `8e759cc7ca335682` 为冻结提交时形态，重排记见 §5 冻结后修正）· 红半日志 f1/f2/f3/f5/f6/f7-red.log（artifacts/v050/m2/，sha 见 `lzy evidence list` 账本绑定）。树内正本：scripts/v050/probes/{f1-verify-receipt.mjs,f2-reroute-probe.sh,f3-cause-readface.mjs}＋scripts/v050/artifact-index/v050-m1.json（重放=`node scripts/v050/replay-artifacts.mjs --index scripts/v050/artifact-index/v050-m1.json`）。

本棒提交链（1296d18 后）：`6de965f` N1-N3 → `85e884e` N4-N5 → `03d2718` N6 → `33fc26a` N7-N8 → `e5ab779` N9 → `fb66624` N10 → `f41c7fa` N11 → `a90669d` N12 → 冻结提交＋收口提交（N13）。

## 9 · 验证限制（如实）

- 未跑 M3 正式配对（本棒只到冻结；run-pairs preflight 为 F6 终验面）；评审/canary 复跑的真会话额度留 M3（PREREGISTRATION §3 单列）。
- run-hook .cmd 孪生与 win32 全套未在 Windows 活体复测（源面 grep 钉面；VM 复测属 M4 发布域，v030 先例）。
- 封存侧 canary 依赖环境：node v24.19.0／bun 1.3.14／Xcode 27.0（27A266a）/iPhone 17 Pro 模拟器——M3 批前预飞须复核同代环境在位。
- npm test 全量终验读数见 F8（终树活体 stdout）。
- **评审快照形态读数（a1.r1 F-2，如实注记）**：评审候选快照（git archive 无 .git）跑 npm test=806/809——三条红均系 evaluation-runner/package.surface 三测要求本地 `.git`（plan-v050 §8 v0.4.1 导出同一形态已记）；真仓读数以 F8/test-suite 回执（809/809）为权威，两数并存口径沿 v041 先例。
- **node 轴半兑现 disposition（a1.r1 F-7）**：toolchain.node 取 process.execPath@version——execPath 即本进程实际解析面（argv[0] 字面量解析的结果），git/sqlite3 探针覆盖 PATH 解析变化；PATH 变量原文**有意不入指纹**（跨 shell/会话 PATH 抖动会令回执复用判定恒失效，背离 ADR-0025 复用经济性）——a1.r5 F-1 的「工具链解析面纳入」语义以此口径为满足，记录在案不另改码。

## 10 · 评审收敛与发现处置（a1.r1 blocked → 修复轮 → 待 a1.r2）

a1.r1（2026-10-07，真评审会话，--timeout-ms 1800000）：**blocked**——F-1〔阻塞〕新评估集冻结索引缺 `keyCounterexampleIds` 预注册（run-pairs 报告层资格门硬要求，M3 将先付整批再被拒）；P2×3（F-2 快照形态读数／F-3 报告 §8 残留旧 MANIFEST sha／F-4 收束分类写面无断言）＋P3×3（F-5 N1/N2/N3/N5 零仓内覆盖／F-6 outputs 空白项 EISDIR／F-7 node 轴半兑现）。评审总评确认八冻结项实现本体无伪实现/死代码。

**修复轮（d7eb431 后单提交）**：F-1=keyCounterexampleIds 由封存侧指定三 id（lazyzcode/task-2、openchamber/task-1、zpigeon-ios/task-1，跨三仓核心判读位，理由入 index.keyCounterexampleRationale；宿主仍零任务内容阅读）写入 v050-freeze-index.json；F-3=报告 §8 改列重钉后 sha；F-4=handoff-cause-readface 增写面两断言（marker.cause 落盘＋metrics cause:* 计数/旧签名不产键）；F-5=verify-receipt 增回执补轴仓内回归（tzEffective/toolchain/legs）＋project-manifest 增 cwd/outputs 收容断言；F-6=outputs 空白项前置拒（project.js，与 env/writePaths 非空语义拉齐）；F-2/F-7=处置注记入 §9（不改码）。修复后全量 F 证据重采（提交=指纹作废纪律）。
