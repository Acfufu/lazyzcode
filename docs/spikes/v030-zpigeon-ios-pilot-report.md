# v030-zpigeon-ios-pilot — 0.3.0 zpigeon-ios 原生腿试点 A 报告

goal `v030-zpigeon-ios-pilot`（HEAVY/risk med，契约 `.lazyzcode/contracts/v030-zpigeon-ios.md`，contractHash 64e91dd7…，UPS 批准 2026-09-25）。
路线：主方案 `docs/plan-v030-agent-first.md` §9/§10-M2；M0 报告 `docs/spikes/v030-m0-report.md` §4.3/§7；拍板 5 串行序第三腿（lazyzcode 腿已由 v030-m2/m3 落地、openchamber 腿已由 v030-openchamber-pilot 落地）。出口判据：受控缺陷被真引擎驱动修复 + 实际展示行列表变化 + 重启恢复测试现场（V03/V04 子集）→ 三仓 A 出口推进至 3/3。

## 1. 冻结基线（N1，2026-09-25）

| 项 | 值 |
| --- | --- |
| 宿主 HEAD | `543a7edf2a70519b836d9390044ddd164dc7823a`（tree `161ea40b2a5a158f1d42e5ff985f9d7d5d7cc700`，树清洁） |
| 夹具 HEAD | `e5735163b86459306c2edc525ee847b7c7c4ff78`（tree `1a968ecaf0884301c1455a0e7f581b0f92f26d95`，detached 清洁） |
| 兄弟 ZCodeKit | `188991ad9cf11dade0e67ad299023c04c9463bfd`（只读冻结，经符号链接 `v030-fixtures/zpigeon` 解析相对路径契约） |
| 工具 | node v24.19.0 · Xcode 27.0（27A266a）· iOS 26.5 模拟器运行时（23F77） |
| 专用模拟器 | `v030-probe-sim`（iPhone 17 · iOS 26.5，UDID `2D3A1192-E7B0-47FF-BC33-B51993082B03`）在场断言 ✔ |
| 中继端口 | 18787 空闲断言 ✔（`lsof -i :18787` 零行；`artifacts/v030-zp/baseline/pins.txt`） |
| 宿主 npm test 改前计数 | 见 §1.1（`baseline/host-npm-test-baseline.txt`） |
| 夹具 build/dd 增量探针 | 见 §1.1（`baseline/build-probe.txt`）——裁决复用或清重建 |

## 2. 侦察事实表（explorer 八问，计划期 2026-09-25）

| # | 事实 | 证据 |
| --- | --- | --- |
| 1 | 注入面=宿主视图 `RemoteHomeView` 的 toggle 汇聚点：`@State expanded: Set<String>`（:26）、toggle 处理器（:281-285）、卡头 `onToggle` 接线（:267）；最小注入=函数体熔断（展开/收起两向失效），收起全部钮 `expanded.removeAll()`（:295-303）独立路径不受影响；defaultExpansion 直改集合不经 toggle（:188-192）故注入态首卡默认展开仍渲染 | 夹具 `ZPigeon/Sources/Features/Home/RemoteHomeView.swift:26,188-192,267,281-285,295-303` |
| 2 | UI 测试 `testSmokeWorkspaceCardExpandCollapse`（:90-122）：守门断言 :28 `homeCollapseAll` 20s 等待→收起全部→行数 0→点卡头→行数>0（:113）→再点→行数 0（:121）；前置=Keychain 至少一条配对（否则空态壳 DrawerShell.swift:63-72）+cards 非空（否则「暂无任务」） | 夹具 `ZPigeonUITests/ZCodeWebParitySmokeUITests.swift:3-7,13-29,90-122` |
| 3 | 配对三路：相机扫码/粘贴 UI/`-PairingURL` launch 参数自动入库（AppShell.swift:23-29 读、DrawerShell.swift:83-86 `.task` 写）——XCUITest 传参即可配对，无需 UI 输入；持久于 Keychain（service `io.zpigeon.app`/account `pairings.v1`）；URL 解析要求查询参数 sid/hash/t（必有）+mid/name/app_version/theme（可选）；**web 面=配对 URL host 派生 ws(s)://host/ws 的 ZCode 中继，非 openchamber**（oc 腿债 L 预判修正） | 夹具 `ZPigeon/Sources/AppShell.swift:23-29`、`ZPigeon/Sources/Features/Shell/DrawerShell.swift:83-86`；ZCodeKit@188991a `Remote/RemoteURL.swift:38-61,63-75` |
| 4 | 任务数据=桌面 bootstrap 应答按设备落盘快照：UserDefaults 键 `zpigeon.bootstrapSnapshot.<deviceSid>`（deviceSid=配对 record.id=sid），上限 50 条；DeviceSession.init 先播种缓存（「启动先画」）；卡列表在 `.idle/.connecting` 缓存态即渲染，`.failed` 才被 failedView 盖掉；pairTimeout=60s | 夹具 `ZPigeon/Sources/Support/BootstrapSnapshotCache.swift:38-40`、`ZPigeon/Sources/Features/Devices/DeviceSession.swift:27-32,50-53`、`ZPigeon/Sources/Features/Home/RemoteHomeView.swift:196-213` |
| 5 | 连接状态机：RelayClient（terminal sid+passHash）→RemoteClient→`waitPaired(timeout:60)`→`rem.bootstrap()`；帧构造器 RelayClient.swift:564-607；深链 `zpigeon://session/<id>` 与配对无关 | ZCodeKit@188991a `Relay/RelayClient.swift:564-607`；夹具 `DeviceSession.swift:63-109` |
| 6 | 构建链：`scripts/dev-setup.sh` 只读三查零写入（kit 目录/Package.swift/git 树）→`xcodegen generate`（xcodeproj 不入库，project.yml 唯一约束面，Kit 相对路径 `../zpigeon/Packages/ZCodeKit`）→`xcodebuild -scheme ZPigeo -destination id=… build/test`；**单工人 drive 无 worktree（core/drive.js:246 N=1 现行行为）→Kit 相对路径契约保真** | 夹具 `scripts/dev-setup.sh:14-50`、`project.yml:7-9,13-14`、`.gitignore:1-2`；宿主 `core/drive.js:246` |
| 7 | 仓规则：夹具与兄弟仓均无 AGENTS.md/CLAUDE.md；夹具 CONTRIBUTING.md 纪律=配对 hash 绝不入 git（:91）/零多余网络面（:92）/INFRA-RED 不发活体测试不清桌面任务（:84）/冒烟离线类模拟器可跑（:75-76）；兄弟仓 README「逆向产物永不入本仓」「凭据永不入 git」——**无 openchamber 式禁 git 条款**，宿主契约仍明示本地 git 授权面 | 夹具 `CONTRIBUTING.md:75-115` |
| 8 | 重启恢复语义：持久=Keychain 配对+bootstrap 快照 UserDefaults+@AppStorage（organizeBy/sortBy/preferredAgent）；不持久=展开态（@State 重启回 defaultExpansion 首卡）/userDisconnected/selectedDeviceId；快照覆写仅发生在 connect/refresh 成功时（:95,:210）——「重启恢复测试现场」=Keychain+快照仍在→卡列表行集合原样重现 | 夹具 `RemoteHomeView.swift:23-24,26,188-192`、`DeviceSession.swift:27-29,95,210` |

## 3. 评审轮记录（HEAVY 计划门，lazyzcode:plan-reviewer）

- **R1 REVISE**（一条 MUST-FIX+三条非阻塞）：N1/N3 两条清单项标题超 `TITLE_MAX=300` 机器硬上限（309/474 字符，ITEM_RE core/loop.js:524 + JS `.length` 口径，超限即 LoopError 拒采纳）；WARN=中继端口未钉死建议钉候选值、三处 ZCodeKit 文件引用缺仓限定、（已实证面清单供 R2 免查：契约哈希/subjects/accepts 覆盖/deps 链/驱动机械引用/注入面与数据面行号全核实属实）。
- **R2 PASS**：MUST-FIX 核销（N1 309→240、N3 474→292，全部 12 条机器同口径复测 ≤300）；三条 WARN 采纳落盘（端口钉 18787+顺延规则、兄弟仓引用补 `ZCodeKit@188991a` 前缀、`.git/info/exclude` 冗余句删除改引夹具 .gitignore 事实）；全量复扫无回归（UNDECIDED_RE 零命中、deps/accepts 形健、subjects 可过、契约字节未动）。
- 计划快照 sha256 `acec729df1…`（`.lazyzcode/loop/snapshots/v030-zpigeon-ios-pilot.md`）；契约 UPS 批准 2026-09-25（短码 64e91dd7）。

## 4. F 面预注册

| F | 面 | 表面（取证器具） | 红半 |
| --- | --- | --- | --- |
| F1 | 数据面配方与基线锚 | simctl/xcodebuild stdout+截图 sha256+夹具 git log | N1 复捕：无配对无数据冒烟测试红于 :28 分区头断言原文 |
| F2 | 注入红半与修复绿半 | xcodebuild test stdout+xcresult+夹具 git log | N4 注入后断言死于「点卡头应展开」stdout+xcresult |
| F3 | 真引擎驱动与中断恢复 | 夹具 CLI stdout+夹具 git log | N5 SIGKILL 中断原文+僵尸租约处置前活体 |
| F4 | UI 实流取证与重启恢复 | 截图 sha256+xcresult+simctl stdout | N4 注入态红 xcresult 附件/红截图（行列表不恢复实证） |
| F5 | 整合验证与回归聚合 | CLI stdout | waive（回归聚合面，反态=人为造红无意义） |

## 5. 实施记录（随步追加）

- N1：本节即骨架；基线钉版回执 `artifacts/v030-zp/baseline/pins.txt`（16 行）。

### 1.1 两项基线计数与探针（N1 实测）

- 宿主 npm test 改前计数：**567 pass / 0 fail**（90.8s，exit 0；与 oc 腿收口计数一致）——`baseline/host-npm-test-baseline.txt`。
- 夹具 build/dd 增量探针：`xcodebuild build`（destination id=2D3A1192…，-derivedDataPath build/dd）→ **BUILD SUCCEEDED，21.4s**（M0 残留增量复用成立，不清重建）——`baseline/build-probe.txt`。
- 红态复捕（M0 阻塞活体）：无配对无数据当前态下冒烟测试 **failed（26.5s）**，断言原文 `ZCodeWebParitySmokeUITests.swift:28: XCTAssertTrue failed - 远程面 web 首页分区头应存在(收起全部钮)`——与 M0 报告 §7 阻塞原文逐字同形——`red/red-m0-state-test.txt`（F1 红半）。

### 5.1 N2 数据面配方与 M0 阻塞解阻（2026-09-25）

- **配方三件按拍板 7 顺位一次通过，零换级**（KU1/KU2 首选支直接成立）：
  1. 假中继：`pilot-relay.mjs`（零依赖 Node，silent 模式）起 127.0.0.1:18787 → app 连接回执 `[relay] upgrade accepted path=/ws`——http→ws 派生与静默升级窗成立（app 停 `.connecting` 显示「正在连接,先显示上次的任务列表」横幅，缓存卡列表持续渲染）。
  2. 快照播种：`simctl spawn defaults write io.zpigeon.ZPigeon zpigeon.bootstrapSnapshot.v030zpilot -string '<合成 JSON>'`——**首试无 `-string` 类型被 defaults 旧式 plist 解析拒（如实记），显式 `-string` 后读数回执逐字节一致**；JSON 形状按消费端反推一次命中（workspaces[workspaceKey/workspacePath/label/kind]+tasks[taskId/title/displayStatus/createdAt/updatedAt/workspacePath]）。
  3. 配对注入：`simctl launch io.zpigeon.ZPigeon -PairingURL 'http://127.0.0.1:18787/remote/v4?sid=v030zpilot&hash=<合成>&t=<毫秒>'`（ProcessInfo.arguments 通道）——Keychain 入库+设备切换器现「未命名设备」。
- **M0 阻塞解阻实证截图**：`baseline/launch-paired-cards.png`（sha256 绑 F1）——分区头「当前设备上的工作区和任务 2 个工作区 · 2 个任务」+v030-ws-a 卡片「1 个任务」+任务行「v030 expand collapse probe」在场；通知权限弹框由 XCUITest runner 自然处理（M0 同款）。
- **注入前基线绿 ×2**（KU1 连续一致性判据）：`testSmokeWorkspaceCardExpandCollapse passed` **13.347s**（run1）/ **11.110s**（run2），均 exit 0——`baseline/green-run1.txt`/`green-run2.txt`；对照红态复捕 :28 失败=配方前红、配方后绿，F1 红绿两半齐。
- 配方回执汇总 `baseline/n2-recipe-receipt.txt`（relay 日志+seed 读数+截图 sha256）；回执文件 sha256：n2-recipe-receipt `f4a4aea447c10148…`、screenshot `168d2b34cf3e4881…`（终值绑证据账本）。

### 5.2 N3 契约与夹具清单落库（2026-09-25）

- 夹具分支 `v030-zp-pilot`（基点 e573516）→ 五件统一 commit **aef973a**（lzy.project.json〔check=pilot-build/pilot-ui-smoke〕+scripts/pilot-check.sh〔中继探活拉起+幂等重播种+两 xcodebuild〕+scripts/pilot-relay.mjs〔零依赖 silent/handshake 双模〕+contracts/pilot.md〔recipe 0c2025fa〕+plans/pilot.md）——提交首版尾注误标 `#N0` 已 amend 订正为宿主执行步 `#N3`（引擎未起、分支独占，如实记）。
- 夹具 goal `v030-zp-pilot`（LIGHT/risk low）register 回执：契约绑定 contracts/pilot.md（contractHash 3a43b108…）。
- **无授权 adopt 拒原文**（负路径回执，`baseline/fixture-noauth-reject.txt`）：`[lzy] 人权门未过（契约授权，ADR-0024）：契约 contracts/pilot.md（短码 3a43b108）等待人类批准。…禁令：不得手写 authorizations/ 记录、也不得自跑命令冒充批准…`。
- recordAuthorization 受信写者落账：`.lazyzcode/authorizations/approval-3a43b108-v030-zp-pilot-seed-1790306527100.json`（**如实声明：非 UPS 人工事件**——批准派生自宿主契约 64e91dd7 的 UPS 批准，受测面=驱动机械；M3 N10+oc N2 家法）。
- adopt 过（4 项：N:2 F:2）+start 回执：基线 tree 0eb11cd6ff；夹具 .lazyzcode/ 经夹具 .gitignore 天然排除（评审核实在案）。

### 5.3 N4 注入与红半预捕（2026-09-25）

- 注入：RemoteHomeView.swift toggle 处理器体 `if…remove/insert` 行替换为 `_ = id // 试验注入注释`——**恰一行 diff**（1 insertion/1 deletion）；注入 commit `4182d45`（消息如实标注「试验注入——工作区卡片 toggle 熔断（受控缺陷，试点红面）」+尾注）。
- **红半精确命中**：pilot-ui-smoke failed（10.8s），断言原文 `ZCodeWebParitySmokeUITests.swift:113: XCTAssertTrue failed - 点卡头应展开(任务行出现)`——与计划预注册失败点逐字同形；**收起全部/行数 0 前段断言照常通过**=注入只熔断 toggle 交互路径，判别面干净（`red/red-injected-test.txt`，sha256 38c22c81…）。
- 红态视觉件：xcresult 附件导出（xcresulttool export attachments）获**测试全程屏幕录制 mp4**（2.28MB，sha256 2bf567b5…——收起全部生效→点卡头行不出现全程在案）+3 事件件；xcresult `build/dd/Logs/Test/Test-ZPigeon-2026.09.25_11-23-15-+0800.xcresult`。

### 5.4 N5 真引擎驱动与中断恢复（2026-09-25）

- **drive#1（fence 1）**：段 1（sess_dcf0f5b6…，272.2s，exit 0）引擎段内自主完成 N1 修复 commit `9080d13`（「试点修复——恢复工作区卡片 toggle 处理器原实现」）+N2 标记 commit `29347c3`+**F1 靶向验证全绿自采证据**（pilot-check.sh build+ui-smoke 全绿、blob 全同，指纹 e78d9a480c·附件 2）——KU3 证立（引擎段内能跑通 check 配方并自主交付）；段后收束：**M3 积分预算执法活体**「积分预算尽（近 5h 滚动水位 414.1 ≥ 积分硬顶 400）」+handoff 快照自写。
  - **计划外事件（如实记账）**：drive 默认积分硬顶 400 的执法 gauge=**账号级** 5h 滚动水位（drive.js 头注自认「不是本 run 的消费累计」）——宿主交互会话自身消耗即把水位顶过 400，夹具 goal 被误伤收束；与本 goal 契约 budget-ref「不设执法上限」错位。处置=重驱带 `LZY_DRIVE_POINTS_BUDGET=4000`（runtime.js 文档化 env 钮，drive 每 run 重开预算 spent 归零重计）；预算记账照走（spent 不丢），gauge/target 语义错位记债 O。
- **drive#2（fence 2）**：段 1（sess_e4c85151…，104.3s，exit 0）完成 F2 认领取证；段后 gate 窗口内驱动进程树被 SIGKILL（84621+引擎 91989 全树）——**击杀点在段间（段 1 已退、段 2 未起），租约持有者死亡=僵尸租约态，语义与段中击杀一致（如实记）**。附带发现：首轮 kill 因 zsh `kill` 不收换行 pid 列表而失败（`illegal pid` 原文在 drive2 演练记录），逐 pid 重杀成功——SIGKILL 演练本身两态（失败尝试+成功）全程 CLI/ps 活体在案。
- **重驱被拦（僵尸租约门活体）**：`[lzy] 另一运行时持租（fence 2，至 2026-09-25T04:06:16.774Z）——单运行时互斥；持租进程 pid 84621 已不存在（僵尸租约）——回收：lzy loop lease reclaim`。
- **lease reclaim**：`✔ 租约已回收：fence 2（持有进程已不存在）——下次 acquire 发新号`。
- **drive#3（fence 3）**：段 1（sess_82bf22dd…，144.5s）→ `✔ goal done（v030-zp-pilot）——终验 attestation：.lazyzcode/attestations/`（`v030-zp-pilot-20260925T033940Z.json`）。
- **断言清单（零重复交付）**：试点分支 e573516..HEAD 恰 4 commit（基础设施 aef973a/注入 4182d45/修复 9080d13/标记 29347c3）——**修复 commit 恰一条**；`git diff e5735163 HEAD -- RemoteHomeView.swift` **0 行（blob 全同）**；goal done 4/4；三次 drive 段记录枚举无第二条修复提交。
- **消耗实记**：墙钟=272.2+104.3+144.5=521.0s（drive 段记录）；积分=hostdb model_usage 按 sessionId 只读查询、core/cost.js ADR-0023 口径折算：drive#1 **3.27** + drive#2 **1.976** + drive#3 **1.74** = **6.986**（引擎模型 deepseek-v4.1-flash；`drive/points-summary.txt`+`drive/points-rows.txt`）。
